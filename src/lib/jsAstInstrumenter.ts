import * as acorn from 'acorn';

interface AstNode {
  type: string;
  start: number;
  end: number;
  loc?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  [key: string]: unknown;
}

interface TextEdit {
  start: number;
  end: number;
  order: number;
  text: string;
}

const RESERVED = new Set([
  'arguments', 'eval', 'undefined', 'NaN', 'Infinity', 'this', 'super',
  '__ca', '__ca_v', '__ca_o',
]);

function collectPatternNames(pattern: AstNode | null | undefined, out: Set<string>): void {
  if (!pattern) return;
  switch (pattern.type) {
    case 'Identifier': {
      const name = String(pattern.name || '');
      if (name && !RESERVED.has(name) && !name.startsWith('__ca')) {
        out.add(name);
      }
      break;
    }
    case 'AssignmentPattern':
      collectPatternNames(pattern.left as AstNode, out);
      break;
    case 'RestElement':
      collectPatternNames(pattern.argument as AstNode, out);
      break;
    case 'ArrayPattern':
      for (const el of (pattern.elements as Array<AstNode | null>) || []) {
        collectPatternNames(el, out);
      }
      break;
    case 'ObjectPattern':
      for (const prop of (pattern.properties as AstNode[]) || []) {
        if (prop.type === 'RestElement') {
          collectPatternNames(prop.argument as AstNode, out);
        } else {
          collectPatternNames(prop.value as AstNode, out);
        }
      }
      break;
    default:
      break;
  }
}

function collectScopeVars(root: AstNode, inherited: Set<string>): Set<string> {
  const vars = new Set<string>(inherited);

  // Add function parameters if root is a function node
  if (Array.isArray(root.params)) {
    for (const param of root.params as AstNode[]) {
      collectPatternNames(param, vars);
    }
  }

  const walk = (node: AstNode | null | undefined, isRoot: boolean) => {
    if (!node || typeof node !== 'object') return;

    if (!isRoot) {
      if (
        node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression'
      ) {
        if (node.type === 'FunctionDeclaration' && node.id) {
          collectPatternNames(node.id as AstNode, vars);
        }
        // Do not descend into child function's local declarations
        return;
      }
      if (node.type === 'ClassDeclaration' && node.id) {
        collectPatternNames(node.id as AstNode, vars);
        return;
      }
      if (node.type === 'VariableDeclarator') {
        collectPatternNames(node.id as AstNode, vars);
      }
      if (node.type === 'CatchClause' && node.param) {
        collectPatternNames(node.param as AstNode, vars);
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'type') continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object' && 'type' in item) {
            walk(item as AstNode, false);
          }
        }
      } else if (value && typeof value === 'object' && 'type' in value) {
        walk(value as AstNode, false);
      }
    }
  };

  walk(root, true);
  return vars;
}

function makeThunk(names: Set<string>): string {
  const parts: string[] = [];
  for (const name of names) {
    parts.push(`try{if(typeof ${name}!=='undefined')__o.${name}=${name}}catch(_){}`);
  }
  return `()=>{const __o={};${parts.join('')}return __o}`;
}

function makeArgsExpr(params: AstNode[]): string {
  const paramNames = new Set<string>();
  for (const p of params) {
    collectPatternNames(p, paramNames);
  }
  const parts: string[] = [];
  for (const name of paramNames) {
    parts.push(`try{if(typeof ${name}!=='undefined')__a.${name}=${name}}catch(_){}`);
  }
  return `(()=>{const __a={};${parts.join('')}return __a})()`;
}

function getFunctionDisplayName(node: AstNode, parent: AstNode | null): string {
  if (node.id && (node.id as AstNode).name) {
    return String((node.id as AstNode).name);
  }
  if (parent) {
    if (parent.type === 'VariableDeclarator' && parent.id && (parent.id as AstNode).name) {
      return String((parent.id as AstNode).name);
    }
    if (parent.type === 'MethodDefinition' && parent.key) {
      const keyNode = parent.key as AstNode;
      return String(keyNode.name || keyNode.value || 'method');
    }
    if (parent.type === 'Property' && parent.key) {
      const keyNode = parent.key as AstNode;
      return String(keyNode.name || keyNode.value || 'fn');
    }
    if (parent.type === 'AssignmentExpression' && parent.left) {
      const left = parent.left as AstNode;
      if (left.type === 'Identifier' && left.name) return String(left.name);
      if (left.type === 'MemberExpression' && left.property && (left.property as AstNode).name) {
        return String((left.property as AstNode).name);
      }
    }
  }
  return 'anonymous';
}

export interface InstrumentResult {
  code: string;
  astValid: boolean;
  error?: string;
}

export function instrumentJavaScriptAst(source: string): InstrumentResult {
  let ast: AstNode;
  try {
    ast = acorn.parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      locations: true,
      allowReturnOutsideFunction: true,
    }) as unknown as AstNode;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { code: '', astValid: false, error: `SyntaxError: ${msg}` };
  }

  const edits: TextEdit[] = [];
  let orderCounter = 0;

  const insertAt = (pos: number, text: string) => {
    edits.push({ start: pos, end: pos, order: orderCounter++, text });
  };

  const getLoc = (node: AstNode) => ({
    line: node.loc?.start.line ?? 1,
    col: node.loc?.start.column ?? 0,
  });

  const instrumentStatement = (
    stmt: AstNode,
    scopeVars: Set<string>,
    wrapSingleAsBlock: boolean
  ) => {
    const thunk = makeThunk(scopeVars);
    const { line, col } = getLoc(stmt);

    if (wrapSingleAsBlock && stmt.type !== 'BlockStatement') {
      insertAt(stmt.start, '{');
    }

    switch (stmt.type) {
      case 'BlockStatement': {
        for (const child of (stmt.body as AstNode[]) || []) {
          instrumentStatement(child, scopeVars, false);
        }
        break;
      }

      case 'VariableDeclaration': {
        visitExpressions(stmt, scopeVars);
        insertAt(stmt.end, `;__ca.stmt(${line},${col},'var_declare',${thunk});`);
        break;
      }

      case 'ExpressionStatement': {
        visitExpressions(stmt.expression as AstNode, scopeVars);
        insertAt(stmt.end, `;__ca.stmt(${line},${col},'statement',${thunk});`);
        break;
      }

      case 'ReturnStatement': {
        const arg = stmt.argument as AstNode | null;
        if (arg) {
          visitExpressions(arg, scopeVars);
          insertAt(arg.start, `__ca.ret(${line},${col},${thunk},(`);
          insertAt(arg.end, '))');
        } else {
          // Replace bare `return` / `return;` with `return __ca.ret(...)`
          const returnKeywordEnd = stmt.start + 6;
          insertAt(returnKeywordEnd, ` __ca.ret(${line},${col},${thunk},undefined)`);
        }
        break;
      }

      case 'IfStatement': {
        const test = stmt.test as AstNode;
        visitExpressions(test, scopeVars);
        insertAt(test.start, `__ca.branch(${line},${col},(`);
        insertAt(test.end, `),${thunk})`);
        instrumentStatement(stmt.consequent as AstNode, scopeVars, true);
        if (stmt.alternate) {
          const alt = stmt.alternate as AstNode;
          instrumentStatement(alt, scopeVars, alt.type !== 'IfStatement');
        }
        break;
      }

      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement':
      case 'WhileStatement':
      case 'DoWhileStatement': {
        const loopVars = collectScopeVars(stmt, scopeVars);
        const loopThunk = makeThunk(loopVars);
        if (stmt.init) visitExpressions(stmt.init as AstNode, loopVars);
        if (stmt.test) visitExpressions(stmt.test as AstNode, loopVars);
        if (stmt.update) visitExpressions(stmt.update as AstNode, loopVars);
        if (stmt.right) visitExpressions(stmt.right as AstNode, loopVars);

        const body = stmt.body as AstNode;
        if (body.type === 'BlockStatement') {
          insertAt(body.start + 1, `__ca.loop(${line},${col},${loopThunk});`);
          for (const child of (body.body as AstNode[]) || []) {
            instrumentStatement(child, loopVars, false);
          }
        } else {
          insertAt(body.start, `{__ca.loop(${line},${col},${loopThunk});`);
          instrumentStatement(body, loopVars, false);
          insertAt(body.end, '}');
        }
        break;
      }

      case 'TryStatement': {
        instrumentStatement(stmt.block as AstNode, scopeVars, false);
        if (stmt.handler) {
          const handler = stmt.handler as AstNode;
          const catchVars = collectScopeVars(handler, scopeVars);
          instrumentStatement(handler.body as AstNode, catchVars, false);
        }
        if (stmt.finalizer) {
          instrumentStatement(stmt.finalizer as AstNode, scopeVars, false);
        }
        break;
      }

      case 'SwitchStatement': {
        visitExpressions(stmt.discriminant as AstNode, scopeVars);
        for (const c of (stmt.cases as AstNode[]) || []) {
          for (const conseq of (c.consequent as AstNode[]) || []) {
            instrumentStatement(conseq, scopeVars, false);
          }
        }
        break;
      }

      case 'FunctionDeclaration': {
        instrumentFunction(stmt, null, scopeVars);
        break;
      }

      case 'ClassDeclaration': {
        const body = stmt.body as AstNode;
        for (const member of (body.body as AstNode[]) || []) {
          if (member.type === 'MethodDefinition' && member.value) {
            instrumentFunction(member.value as AstNode, member, scopeVars);
          }
        }
        break;
      }

      case 'ThrowStatement': {
        const arg = stmt.argument as AstNode | null;
        if (arg) {
          visitExpressions(arg, scopeVars);
          insertAt(arg.start, `__ca.err(${line},${col},${thunk},(`);
          insertAt(arg.end, '))');
        }
        break;
      }

      default:
        break;
    }

    if (wrapSingleAsBlock && stmt.type !== 'BlockStatement') {
      insertAt(stmt.end, '}');
    }
  };

  const NATIVE_HOF_METHODS = new Set([
    'from', 'map', 'filter', 'forEach', 'reduce', 'reduceRight',
    'sort', 'find', 'findIndex', 'some', 'every', 'flatMap',
  ]);

  const isNativeInlineCallback = (fnNode: AstNode, parent: AstNode | null): boolean => {
    if (fnNode.type !== 'ArrowFunctionExpression') return false;
    const body = fnNode.body as AstNode;
    if (body.type === 'BlockStatement') return false;
    if (!parent || parent.type !== 'CallExpression') return false;
    const callee = parent.callee as AstNode | undefined;
    if (callee?.type === 'MemberExpression' && callee.property) {
      const prop = callee.property as AstNode;
      if (prop.type === 'Identifier' && NATIVE_HOF_METHODS.has(String(prop.name))) {
        return true;
      }
    }
    return false;
  };

  const instrumentFunction = (
    fnNode: AstNode,
    parent: AstNode | null,
    outerVars: Set<string>
  ) => {
    if (isNativeInlineCallback(fnNode, parent)) {
      return;
    }
    const fnVars = collectScopeVars(fnNode, outerVars);
    const fnThunk = makeThunk(fnVars);
    const fnName = getFunctionDisplayName(fnNode, parent);
    const safeFnName = JSON.stringify(fnName);
    const { line, col } = getLoc(fnNode);
    const params = (fnNode.params as AstNode[]) || [];
    const argsExpr = makeArgsExpr(params);
    const body = fnNode.body as AstNode;

    // Skip instrumenting constructors that call super() before `this` would complicate enter,
    // still instrument statements cleanly!
    const isConstructor = parent?.type === 'MethodDefinition' && parent.kind === 'constructor';

    if (body.type === 'BlockStatement') {
      if (!isConstructor) {
        insertAt(
          body.start + 1,
          `__ca.enter(${safeFnName},${line},${col},${argsExpr},${fnThunk});try{`
        );
      }
      for (const child of (body.body as AstNode[]) || []) {
        instrumentStatement(child, fnVars, false);
      }
      if (!isConstructor) {
        insertAt(body.end - 1, `}finally{__ca.leave(${safeFnName},${line},${fnThunk});}`);
      }
    } else {
      // Expression-body arrow function: `(x) => expr` -> `(x) => { __ca.enter(...); try { return __ca.ret(..., (expr)); } finally { __ca.leave(...); } }`
      visitExpressions(body, fnVars);
      insertAt(
        body.start,
        `{__ca.enter(${safeFnName},${line},${col},${argsExpr},${fnThunk});try{return __ca.ret(${line},${col},${fnThunk},(`
      );
      insertAt(body.end, `));}finally{__ca.leave(${safeFnName},${line},${fnThunk});}}`);
    }
  };

  const visitExpressions = (node: AstNode | null | undefined, scopeVars: Set<string>, parent: AstNode | null = null) => {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      instrumentFunction(node, parent, scopeVars);
      return;
    }

    if (node.type === 'ClassExpression') {
      const body = node.body as AstNode;
      for (const member of (body.body as AstNode[]) || []) {
        if (member.type === 'MethodDefinition' && member.value) {
          instrumentFunction(member.value as AstNode, member, scopeVars);
        }
      }
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'type') continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object' && 'type' in item) {
            visitExpressions(item as AstNode, scopeVars, node);
          }
        }
      } else if (value && typeof value === 'object' && 'type' in value) {
        visitExpressions(value as AstNode, scopeVars, node);
      }
    }
  };

  const programVars = collectScopeVars(ast, new Set<string>());
  for (const stmt of (ast.body as AstNode[]) || []) {
    instrumentStatement(stmt, programVars, false);
  }

  // Apply edits from end to start so offsets never shift
  edits.sort((a, b) => {
    if (b.start !== a.start) return b.start - a.start;
    if (b.end !== a.end) return b.end - a.end;
    return b.order - a.order;
  });

  let transformed = source;
  for (const edit of edits) {
    transformed = transformed.slice(0, edit.start) + edit.text + transformed.slice(edit.end);
  }

  return { code: transformed, astValid: true };
}
