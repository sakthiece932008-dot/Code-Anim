import type {
  HeapObject,
  StackFrame,
  StateChange,
  TraceEvent,
  TraceEventType,
  ValueRef,
} from '../types/trace';

export type CLikeLanguage = 'java' | 'c' | 'cpp';

export interface CLikeLegacyStep {
  line: number;
  note: string;
  vars: Record<string, unknown>;
  print: string;
  scene: null;
  outText: string;
}

export type CLikeInterpretResult =
  | {
      status: 'ok';
      events: TraceEvent[];
      steps: CLikeLegacyStep[];
      output: string;
      truncated: boolean;
    }
  | {
      status: 'user_error';
      category: 'compiler_error' | 'runtime_error' | 'missing_input' | 'timeout';
      message: string;
      line: number | null;
      events: TraceEvent[];
      steps: CLikeLegacyStep[];
      output: string;
    }
  | {
      status: 'unsupported_construct';
      reason: string;
    };

// ---------------- Tokenizer ----------------

type TokenKind =
  | 'number'
  | 'string'
  | 'char'
  | 'ident'
  | 'op'
  | 'punct'
  | 'eof';

interface Token {
  kind: TokenKind;
  value: string;
  line: number;
}

class UnsupportedConstructError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedConstructError';
  }
}

class UserProgramError extends Error {
  category: 'compiler_error' | 'runtime_error' | 'missing_input' | 'timeout';
  line: number | null;
  constructor(
    category: 'compiler_error' | 'runtime_error' | 'missing_input' | 'timeout',
    message: string,
    line: number | null
  ) {
    super(message);
    this.name = 'UserProgramError';
    this.category = category;
    this.line = line;
  }
}

const MULTI_OPS = new Set([
  '++', '--', '+=', '-=', '*=', '/=', '%=',
  '==', '!=', '<=', '>=', '&&', '||', '<<', '>>', '::', '->',
]);

const SINGLE_OPS = new Set([
  '+', '-', '*', '/', '%', '=', '<', '>', '!', '&', '|', '^', '~', '?', ':', '.',
]);

const PUNCT = new Set(['(', ')', '{', '}', '[', ']', ';', ',']);

function tokenize(code: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  const n = code.length;

  while (i < n) {
    const ch = code[i];

    // Newline
    if (ch === '\n') {
      line++;
      i++;
      continue;
    }

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i++;
      continue;
    }

    // Single-line comment
    if (ch === '/' && code[i + 1] === '/') {
      while (i < n && code[i] !== '\n') i++;
      continue;
    }

    // Multi-line comment
    if (ch === '/' && code[i + 1] === '*') {
      const startLine = line;
      i += 2;
      let closed = false;
      while (i < n) {
        if (code[i] === '\n') line++;
        if (code[i] === '*' && code[i + 1] === '/') {
          i += 2;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) {
        throw new UserProgramError('compiler_error', `Line ${startLine}: Unterminated multi-line comment.`, startLine);
      }
      continue;
    }

    // Preprocessor directive (#include, #define, etc.)
    if (ch === '#') {
      const directiveStart = i;
      while (i < n && code[i] !== '\n') i++;
      const dir = code.slice(directiveStart, i).trim();
      if (/^#define\b/.test(dir)) {
        throw new UnsupportedConstructError('Preprocessor #define macros require AI simulation.');
      }
      continue;
    }

    // String literal
    if (ch === '"') {
      const startLine = line;
      i++;
      let out = '';
      let closed = false;
      while (i < n) {
        const c = code[i];
        if (c === '\n') {
          throw new UserProgramError('compiler_error', `Line ${startLine}: Unterminated string literal.`, startLine);
        }
        if (c === '\\') {
          i++;
          const esc = code[i] ?? '';
          if (esc === 'n') out += '\n';
          else if (esc === 't') out += '\t';
          else if (esc === 'r') out += '\r';
          else if (esc === '"') out += '"';
          else if (esc === '\\') out += '\\';
          else if (esc === '\'') out += '\'';
          else out += esc;
          i++;
          continue;
        }
        if (c === '"') {
          i++;
          closed = true;
          break;
        }
        out += c;
        i++;
      }
      if (!closed) {
        throw new UserProgramError('compiler_error', `Line ${startLine}: Unterminated string literal.`, startLine);
      }
      tokens.push({ kind: 'string', value: out, line: startLine });
      continue;
    }

    // Char literal
    if (ch === '\'') {
      const startLine = line;
      i++;
      let out = '';
      if (code[i] === '\\') {
        i++;
        const esc = code[i] ?? '';
        if (esc === 'n') out = '\n';
        else if (esc === 't') out = '\t';
        else if (esc === '0') out = '\0';
        else out = esc;
        i++;
      } else if (i < n) {
        out = code[i++];
      }
      if (code[i] !== '\'') {
        throw new UserProgramError('compiler_error', `Line ${startLine}: Unterminated character literal.`, startLine);
      }
      i++;
      tokens.push({ kind: 'char', value: out, line: startLine });
      continue;
    }

    // Number literal
    if ((ch >= '0' && ch <= '9') || (ch === '.' && code[i + 1] >= '0' && code[i + 1] <= '9')) {
      const start = i;
      while (i < n && code[i] >= '0' && code[i] <= '9') i++;
      if (code[i] === '.' && code[i + 1] !== '.') {
        i++;
        while (i < n && code[i] >= '0' && code[i] <= '9') i++;
      }
      if (code[i] === 'e' || code[i] === 'E') {
        i++;
        if (code[i] === '+' || code[i] === '-') i++;
        while (i < n && code[i] >= '0' && code[i] <= '9') i++;
      }
      const numText = code.slice(start, i);
      // Optional suffix like f, F, d, D, L, l, u, U, ll
      while (i < n && /[fFdDlLuU]/.test(code[i])) i++;
      tokens.push({ kind: 'number', value: numText, line });
      continue;
    }

    // Identifier
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$') {
      const start = i;
      while (
        i < n &&
        ((code[i] >= 'a' && code[i] <= 'z') ||
          (code[i] >= 'A' && code[i] <= 'Z') ||
          (code[i] >= '0' && code[i] <= '9') ||
          code[i] === '_' ||
          code[i] === '$')
      ) {
        i++;
      }
      tokens.push({ kind: 'ident', value: code.slice(start, i), line });
      continue;
    }

    // 2-char operators
    const two = code.slice(i, i + 2);
    if (MULTI_OPS.has(two)) {
      tokens.push({ kind: 'op', value: two, line });
      i += 2;
      continue;
    }

    // 1-char operators
    if (SINGLE_OPS.has(ch)) {
      tokens.push({ kind: 'op', value: ch, line });
      i++;
      continue;
    }

    // Punctuation
    if (PUNCT.has(ch)) {
      tokens.push({ kind: 'punct', value: ch, line });
      i++;
      continue;
    }

    throw new UserProgramError('compiler_error', `Line ${line}: Unexpected character '${ch}'.`, line);
  }

  tokens.push({ kind: 'eof', value: '', line });
  return tokens;
}

// ---------------- AST Types ----------------

type Expr =
  | { kind: 'number'; value: number; isFloat: boolean; line: number }
  | { kind: 'string'; value: string; line: number }
  | { kind: 'bool'; value: boolean; line: number }
  | { kind: 'null'; line: number }
  | { kind: 'ident'; name: string; line: number }
  | { kind: 'unary'; op: string; arg: Expr; prefix: boolean; line: number }
  | { kind: 'binary'; op: string; left: Expr; right: Expr; line: number }
  | { kind: 'ternary'; cond: Expr; thenExpr: Expr; elseExpr: Expr; line: number }
  | { kind: 'assign'; op: string; target: Expr; value: Expr; line: number }
  | { kind: 'member'; object: Expr; property: string; line: number }
  | { kind: 'index'; object: Expr; index: Expr; line: number }
  | { kind: 'call'; callee: Expr; args: Expr[]; line: number }
  | { kind: 'array_lit'; elements: Expr[]; line: number }
  | { kind: 'new_array'; elemType: string; size: Expr; line: number }
  | { kind: 'new_scanner'; line: number }
  | { kind: 'cast'; targetType: string; expr: Expr; line: number }
  | { kind: 'addr_of'; target: Expr; line: number };

interface VarDeclItem {
  name: string;
  isArray: boolean;
  arraySize?: Expr;
  init?: Expr;
}

type Stmt =
  | { kind: 'block'; body: Stmt[]; line: number }
  | { kind: 'vardecl'; varType: string; items: VarDeclItem[]; line: number }
  | { kind: 'expr'; expr: Expr; line: number }
  | { kind: 'if'; cond: Expr; thenBranch: Stmt; elseBranch?: Stmt; line: number }
  | { kind: 'while'; cond: Expr; body: Stmt; line: number }
  | { kind: 'do_while'; body: Stmt; cond: Expr; line: number }
  | { kind: 'for'; init?: Stmt; cond?: Expr; update?: Expr; body: Stmt; line: number }
  | { kind: 'return'; value?: Expr; line: number }
  | { kind: 'break'; line: number }
  | { kind: 'continue'; line: number }
  | { kind: 'cout'; parts: Expr[]; line: number }
  | { kind: 'cin'; targets: Expr[]; line: number }
  | { kind: 'empty'; line: number };

interface FunctionDef {
  name: string;
  returnType: string;
  params: Array<{ name: string; typeName: string; isArray: boolean }>;
  body: Stmt;
  line: number;
}

interface ProgramAst {
  functions: Map<string, FunctionDef>;
  topLevelStatements: Stmt[];
}

// ---------------- Parser ----------------

const BASE_TYPE_KEYWORDS = new Set([
  'int', 'long', 'short', 'byte', 'double', 'float', 'boolean', 'bool',
  'char', 'String', 'string', 'void', 'auto', 'size_t', 'unsigned', 'signed',
  'Scanner', 'vector',
]);

const MODIFIER_KEYWORDS = new Set([
  'public', 'private', 'protected', 'static', 'final', 'const', 'inline', 'constexpr',
]);

class Parser {
  private tokens: Token[];
  private pos = 0;
  private lang: CLikeLanguage;

  constructor(tokens: Token[], lang: CLikeLanguage) {
    this.tokens = tokens;
    this.lang = lang;
  }

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  private advance(): Token {
    const t = this.peek();
    if (this.pos < this.tokens.length - 1) this.pos++;
    return t;
  }

  private match(kind: TokenKind, value?: string): boolean {
    const t = this.peek();
    if (t.kind !== kind) return false;
    if (value !== undefined && t.value !== value) return false;
    this.advance();
    return true;
  }

  private expect(kind: TokenKind, value: string, message?: string): Token {
    const t = this.peek();
    if (t.kind === kind && t.value === value) {
      return this.advance();
    }
    throw new UserProgramError(
      'compiler_error',
      message || `Line ${t.line}: Expected '${value}' but found '${t.value || 'end of file'}'.`,
      t.line
    );
  }

  private isIdent(value: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t.kind === 'ident' && t.value === value;
  }

  parseProgram(): ProgramAst {
    const functions = new Map<string, FunctionDef>();
    const topLevelStatements: Stmt[] = [];

    while (this.peek().kind !== 'eof') {
      // Java package / import
      if (this.isIdent('package') || this.isIdent('import')) {
        while (this.peek().kind !== 'eof' && !this.match('punct', ';')) {
          this.advance();
        }
        continue;
      }

      // C++ using namespace std;
      if (this.isIdent('using')) {
        while (this.peek().kind !== 'eof' && !this.match('punct', ';')) {
          this.advance();
        }
        continue;
      }

      // Skip modifiers
      const savePos = this.pos;
      while (this.peek().kind === 'ident' && MODIFIER_KEYWORDS.has(this.peek().value)) {
        this.advance();
      }

      // Java class wrapper
      if (this.isIdent('class')) {
        this.advance();
        if (this.peek().kind !== 'ident') {
          throw new UserProgramError('compiler_error', `Line ${this.peek().line}: Expected class name.`, this.peek().line);
        }
        this.advance(); // class name
        if (this.isIdent('extends') || this.isIdent('implements')) {
          throw new UnsupportedConstructError('Class inheritance/interfaces require AI simulation.');
        }
        this.expect('punct', '{');
        while (this.peek().kind !== 'eof' && !(this.peek().kind === 'punct' && this.peek().value === '}')) {
          this.parseClassMember(functions, topLevelStatements);
        }
        this.expect('punct', '}');
        continue;
      }

      if (this.isIdent('struct') || this.isIdent('enum') || this.isIdent('template') || this.isIdent('interface')) {
        throw new UnsupportedConstructError(`'${this.peek().value}' definitions require AI simulation.`);
      }

      // Restore modifiers and check if this is a function definition or a top-level statement
      this.pos = savePos;
      const maybeFn = this.tryParseFunctionDef();
      if (maybeFn) {
        functions.set(maybeFn.name, maybeFn);
        continue;
      }

      // Top-level statements (e.g. Java/C snippets pasted without main())
      const stmt = this.parseStatement();
      if (stmt.kind !== 'empty') {
        topLevelStatements.push(stmt);
      }
    }

    return { functions, topLevelStatements };
  }

  private parseClassMember(functions: Map<string, FunctionDef>, topLevelStatements: Stmt[]): void {
    const maybeFn = this.tryParseFunctionDef();
    if (maybeFn) {
      functions.set(maybeFn.name, maybeFn);
      return;
    }
    const stmt = this.parseStatement();
    if (stmt.kind === 'vardecl') {
      topLevelStatements.push(stmt);
      return;
    }
    if (stmt.kind !== 'empty') {
      throw new UnsupportedConstructError('Complex class members require AI simulation.');
    }
  }

  private tryParseType(): { typeName: string; isArray: boolean } | null {
    const startPos = this.pos;

    while (this.peek().kind === 'ident' && MODIFIER_KEYWORDS.has(this.peek().value)) {
      this.advance();
    }

    // Optional std:: prefix
    if (this.isIdent('std') && this.peek(1).kind === 'op' && this.peek(1).value === '::') {
      this.advance();
      this.advance();
    }

    const first = this.peek();
    if (first.kind !== 'ident' || !BASE_TYPE_KEYWORDS.has(first.value)) {
      this.pos = startPos;
      return null;
    }

    let typeName = this.advance().value;
    let isArray = false;

    // Handle multi-word C/C++ types like "long long", "unsigned int", "long double"
    while (
      this.peek().kind === 'ident' &&
      (this.peek().value === 'int' || this.peek().value === 'long' || this.peek().value === 'double' || this.peek().value === 'char')
    ) {
      typeName += ' ' + this.advance().value;
    }

    // Handle vector<T>
    if (typeName === 'vector' && this.peek().kind === 'op' && this.peek().value === '<') {
      this.advance();
      const inner = this.tryParseType();
      if (!inner) {
        this.pos = startPos;
        return null;
      }
      if (!(this.peek().kind === 'op' && this.peek().value === '>')) {
        this.pos = startPos;
        return null;
      }
      this.advance();
      typeName = inner.typeName;
      isArray = true;
    }

    // Pointer syntax like int* or char* -> unsupported unless simple parameter
    if (this.peek().kind === 'op' && this.peek().value === '*') {
      throw new UnsupportedConstructError('Pointer types require AI simulation.');
    }

    // Array brackets after type (e.g. int[] or String[])
    if (this.peek().kind === 'punct' && this.peek().value === '[' && this.peek(1).kind === 'punct' && this.peek(1).value === ']') {
      this.advance();
      this.advance();
      isArray = true;
      // Multi-dimensional array -> unsupported
      if (this.peek().kind === 'punct' && this.peek().value === '[') {
        throw new UnsupportedConstructError('Multi-dimensional arrays require AI simulation.');
      }
    }

    return { typeName, isArray };
  }

  private tryParseFunctionDef(): FunctionDef | null {
    const savePos = this.pos;
    const startLine = this.peek().line;
    const parsedType = this.tryParseType();
    if (!parsedType) {
      this.pos = savePos;
      return null;
    }

    if (this.peek().kind !== 'ident') {
      this.pos = savePos;
      return null;
    }
    const name = this.advance().value;

    if (!this.match('punct', '(')) {
      this.pos = savePos;
      return null;
    }

    const params: Array<{ name: string; typeName: string; isArray: boolean }> = [];
    if (!(this.peek().kind === 'punct' && this.peek().value === ')')) {
      while (true) {
        // C void parameter: int main(void)
        if (this.isIdent('void') && this.peek(1).kind === 'punct' && this.peek(1).value === ')') {
          this.advance();
          break;
        }
        // C/C++ int argc, char* argv[]
        if (this.isIdent('char') && this.peek(1).kind === 'op' && this.peek(1).value === '*') {
          this.advance();
          this.advance();
          const pName = this.peek().kind === 'ident' ? this.advance().value : 'argv';
          if (this.match('punct', '[')) this.expect('punct', ']');
          params.push({ name: pName, typeName: 'string', isArray: true });
        } else {
          const pType = this.tryParseType();
          if (!pType) {
            this.pos = savePos;
            return null;
          }
          // Reference parameter like vector<int>& -> unsupported
          if (this.peek().kind === 'op' && this.peek().value === '&') {
            throw new UnsupportedConstructError('Pass-by-reference parameters require AI simulation.');
          }
          if (this.peek().kind !== 'ident') {
            this.pos = savePos;
            return null;
          }
          const pName = this.advance().value;
          let pIsArray = pType.isArray;
          if (this.match('punct', '[')) {
            this.expect('punct', ']');
            pIsArray = true;
          }
          params.push({ name: pName, typeName: pType.typeName, isArray: pIsArray });
        }
        if (!this.match('punct', ',')) break;
      }
    }
    this.expect('punct', ')');

    // Java "throws IOException"
    if (this.isIdent('throws')) {
      this.advance();
      while (this.peek().kind === 'ident') {
        this.advance();
        if (!this.match('punct', ',')) break;
      }
    }

    // Function forward prototype in C/C++ (e.g. int add(int a, int b);)
    if (this.match('punct', ';')) {
      return { name: `__proto_${name}`, returnType: parsedType.typeName, params, body: { kind: 'empty', line: startLine }, line: startLine };
    }

    if (!(this.peek().kind === 'punct' && this.peek().value === '{')) {
      this.pos = savePos;
      return null;
    }

    const body = this.parseBlock();
    return {
      name,
      returnType: parsedType.typeName,
      params,
      body,
      line: startLine,
    };
  }

  private parseBlock(): Stmt {
    const line = this.peek().line;
    this.expect('punct', '{');
    const body: Stmt[] = [];
    while (this.peek().kind !== 'eof' && !(this.peek().kind === 'punct' && this.peek().value === '}')) {
      body.push(this.parseStatement());
    }
    this.expect('punct', '}');
    return { kind: 'block', body, line };
  }

  private parseStatement(): Stmt {
    const tok = this.peek();

    if (tok.kind === 'punct' && tok.value === ';') {
      this.advance();
      return { kind: 'empty', line: tok.line };
    }

    if (tok.kind === 'punct' && tok.value === '{') {
      return this.parseBlock();
    }

    if (this.isIdent('if')) {
      this.advance();
      this.expect('punct', '(');
      const cond = this.parseExpression();
      this.expect('punct', ')');
      const thenBranch = this.parseStatement();
      let elseBranch: Stmt | undefined;
      if (this.isIdent('else')) {
        this.advance();
        elseBranch = this.parseStatement();
      }
      return { kind: 'if', cond, thenBranch, elseBranch, line: tok.line };
    }

    if (this.isIdent('while')) {
      this.advance();
      this.expect('punct', '(');
      const cond = this.parseExpression();
      this.expect('punct', ')');
      const body = this.parseStatement();
      return { kind: 'while', cond, body, line: tok.line };
    }

    if (this.isIdent('do')) {
      this.advance();
      const body = this.parseStatement();
      if (!this.isIdent('while')) {
        throw new UserProgramError('compiler_error', `Line ${this.peek().line}: Expected 'while' after 'do' block.`, this.peek().line);
      }
      this.advance();
      this.expect('punct', '(');
      const cond = this.parseExpression();
      this.expect('punct', ')');
      this.expect('punct', ';');
      return { kind: 'do_while', body, cond, line: tok.line };
    }

    if (this.isIdent('for')) {
      this.advance();
      this.expect('punct', '(');
      let init: Stmt | undefined;
      if (!this.match('punct', ';')) {
        const maybeDecl = this.tryParseVarDecl(false);
        if (maybeDecl) {
          init = maybeDecl;
        } else {
          const e = this.parseExpression();
          init = { kind: 'expr', expr: e, line: e.line };
        }
        // Check for enhanced for-each loop (e.g. for (int x : arr))
        if (this.peek().kind === 'op' && this.peek().value === ':') {
          throw new UnsupportedConstructError('Range-based / for-each loops require AI simulation.');
        }
        this.expect('punct', ';');
      }
      let cond: Expr | undefined;
      if (!this.match('punct', ';')) {
        cond = this.parseExpression();
        this.expect('punct', ';');
      }
      let update: Expr | undefined;
      if (!(this.peek().kind === 'punct' && this.peek().value === ')')) {
        update = this.parseExpression();
      }
      this.expect('punct', ')');
      const body = this.parseStatement();
      return { kind: 'for', init, cond, update, body, line: tok.line };
    }

    if (this.isIdent('return')) {
      this.advance();
      let value: Expr | undefined;
      if (!(this.peek().kind === 'punct' && this.peek().value === ';')) {
        value = this.parseExpression();
      }
      this.expect('punct', ';');
      return { kind: 'return', value, line: tok.line };
    }

    if (this.isIdent('break')) {
      this.advance();
      this.expect('punct', ';');
      return { kind: 'break', line: tok.line };
    }

    if (this.isIdent('continue')) {
      this.advance();
      this.expect('punct', ';');
      return { kind: 'continue', line: tok.line };
    }

    if (this.isIdent('switch') || this.isIdent('try')) {
      throw new UnsupportedConstructError(`'${tok.value}' statements require AI simulation.`);
    }

    // C++ std::cout / cout << ...
    if (this.isStreamStart('cout')) {
      return this.parseCout();
    }

    // C++ std::cin / cin >> ...
    if (this.isStreamStart('cin')) {
      return this.parseCin();
    }

    // Variable declaration
    const maybeDecl = this.tryParseVarDecl(true);
    if (maybeDecl) return maybeDecl;

    // Expression statement
    const expr = this.parseExpression();
    this.expect('punct', ';');
    return { kind: 'expr', expr, line: tok.line };
  }

  private isStreamStart(name: 'cout' | 'cin'): boolean {
    if (this.isIdent('std') && this.peek(1).kind === 'op' && this.peek(1).value === '::' && this.isIdent(name, 2)) {
      return true;
    }
    return this.isIdent(name);
  }

  private parseCout(): Stmt {
    const line = this.peek().line;
    if (this.isIdent('std')) {
      this.advance();
      this.advance();
    }
    this.advance(); // cout
    const parts: Expr[] = [];
    while (this.match('op', '<<')) {
      if (this.isIdent('std') && this.peek(1).kind === 'op' && this.peek(1).value === '::' && this.isIdent('endl', 2)) {
        this.advance();
        this.advance();
        this.advance();
        parts.push({ kind: 'string', value: '\n', line: this.peek().line });
        continue;
      }
      if (this.isIdent('endl')) {
        this.advance();
        parts.push({ kind: 'string', value: '\n', line: this.peek().line });
        continue;
      }
      parts.push(this.parseShiftOperand());
    }
    this.expect('punct', ';');
    return { kind: 'cout', parts, line };
  }

  private parseCin(): Stmt {
    const line = this.peek().line;
    if (this.isIdent('std')) {
      this.advance();
      this.advance();
    }
    this.advance(); // cin
    const targets: Expr[] = [];
    while (this.match('op', '>>')) {
      targets.push(this.parseUnary());
    }
    this.expect('punct', ';');
    return { kind: 'cin', targets, line };
  }

  private tryParseVarDecl(consumeSemi: boolean): Stmt | null {
    const savePos = this.pos;
    const line = this.peek().line;
    const parsedType = this.tryParseType();
    if (!parsedType) {
      this.pos = savePos;
      return null;
    }
    if (this.peek().kind !== 'ident') {
      this.pos = savePos;
      return null;
    }

    const items: VarDeclItem[] = [];
    while (true) {
      if (this.peek().kind !== 'ident') {
        throw new UserProgramError('compiler_error', `Line ${this.peek().line}: Expected variable name.`, this.peek().line);
      }
      const name = this.advance().value;
      let isArray = parsedType.isArray;
      let arraySize: Expr | undefined;
      if (this.match('punct', '[')) {
        isArray = true;
        if (!(this.peek().kind === 'punct' && this.peek().value === ']')) {
          arraySize = this.parseExpression();
        }
        this.expect('punct', ']');
      }

      let init: Expr | undefined;
      if (this.match('op', '=')) {
        if (this.peek().kind === 'punct' && this.peek().value === '{') {
          init = this.parseArrayLiteral();
          isArray = true;
        } else {
          init = this.parseAssignment();
        }
      } else if (this.lang === 'cpp' && this.peek().kind === 'punct' && this.peek().value === '{') {
        // C++ brace initialization: vector<int> v{1, 2, 3};
        init = this.parseArrayLiteral();
      }

      items.push({ name, isArray, arraySize, init });
      if (!this.match('punct', ',')) break;
    }

    if (consumeSemi) {
      this.expect('punct', ';');
    }
    return { kind: 'vardecl', varType: parsedType.typeName, items, line };
  }

  private parseArrayLiteral(): Expr {
    const line = this.peek().line;
    this.expect('punct', '{');
    const elements: Expr[] = [];
    if (!(this.peek().kind === 'punct' && this.peek().value === '}')) {
      while (true) {
        elements.push(this.parseExpression());
        if (!this.match('punct', ',')) break;
        if (this.peek().kind === 'punct' && this.peek().value === '}') break;
      }
    }
    this.expect('punct', '}');
    return { kind: 'array_lit', elements, line };
  }

  private parseExpression(): Expr {
    return this.parseAssignment();
  }

  private parseAssignment(): Expr {
    const left = this.parseTernary();
    const t = this.peek();
    if (
      t.kind === 'op' &&
      (t.value === '=' || t.value === '+=' || t.value === '-=' || t.value === '*=' || t.value === '/=' || t.value === '%=')
    ) {
      this.advance();
      const right = this.parseAssignment();
      return { kind: 'assign', op: t.value, target: left, value: right, line: t.line };
    }
    return left;
  }

  private parseTernary(): Expr {
    const cond = this.parseOr();
    if (this.match('op', '?')) {
      const thenExpr = this.parseExpression();
      this.expect('op', ':');
      const elseExpr = this.parseTernary();
      return { kind: 'ternary', cond, thenExpr, elseExpr, line: cond.line };
    }
    return cond;
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.match('op', '||')) {
      const right = this.parseAnd();
      left = { kind: 'binary', op: '||', left, right, line: left.line };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseEquality();
    while (this.match('op', '&&')) {
      const right = this.parseEquality();
      left = { kind: 'binary', op: '&&', left, right, line: left.line };
    }
    return left;
  }

  private parseEquality(): Expr {
    let left = this.parseComparison();
    while (this.peek().kind === 'op' && (this.peek().value === '==' || this.peek().value === '!=')) {
      const op = this.advance().value;
      const right = this.parseComparison();
      left = { kind: 'binary', op, left, right, line: left.line };
    }
    return left;
  }

  private parseComparison(): Expr {
    let left = this.parseAdditive();
    while (
      this.peek().kind === 'op' &&
      (this.peek().value === '<' || this.peek().value === '<=' || this.peek().value === '>' || this.peek().value === '>=')
    ) {
      const op = this.advance().value;
      const right = this.parseAdditive();
      left = { kind: 'binary', op, left, right, line: left.line };
    }
    return left;
  }

  private parseShiftOperand(): Expr {
    return this.parseAdditive();
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    while (this.peek().kind === 'op' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.advance().value;
      const right = this.parseMultiplicative();
      left = { kind: 'binary', op, left, right, line: left.line };
    }
    return left;
  }

  private parseMultiplicative(): Expr {
    let left = this.parseUnary();
    while (this.peek().kind === 'op' && (this.peek().value === '*' || this.peek().value === '/' || this.peek().value === '%')) {
      const op = this.advance().value;
      const right = this.parseUnary();
      left = { kind: 'binary', op, left, right, line: left.line };
    }
    return left;
  }

  private parseUnary(): Expr {
    const t = this.peek();

    // C-style type cast: (double) a, (int) x
    if (
      t.kind === 'punct' &&
      t.value === '(' &&
      this.peek(1).kind === 'ident' &&
      BASE_TYPE_KEYWORDS.has(this.peek(1).value) &&
      this.peek(2).kind === 'punct' &&
      this.peek(2).value === ')'
    ) {
      this.advance();
      const targetType = this.advance().value;
      this.advance();
      const expr = this.parseUnary();
      return { kind: 'cast', targetType, expr, line: t.line };
    }

    // Address-of &x (for C scanf)
    if (t.kind === 'op' && t.value === '&') {
      this.advance();
      const target = this.parseUnary();
      return { kind: 'addr_of', target, line: t.line };
    }

    if (t.kind === 'op' && (t.value === '-' || t.value === '+' || t.value === '!' || t.value === '++' || t.value === '--')) {
      this.advance();
      const arg = this.parseUnary();
      return { kind: 'unary', op: t.value, arg, prefix: true, line: t.line };
    }

    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();

    while (true) {
      const t = this.peek();
      if (t.kind === 'punct' && t.value === '(') {
        this.advance();
        const args: Expr[] = [];
        if (!(this.peek().kind === 'punct' && this.peek().value === ')')) {
          while (true) {
            args.push(this.parseExpression());
            if (!this.match('punct', ',')) break;
          }
        }
        this.expect('punct', ')');
        expr = { kind: 'call', callee: expr, args, line: t.line };
        continue;
      }

      if (t.kind === 'punct' && t.value === '[') {
        this.advance();
        const index = this.parseExpression();
        this.expect('punct', ']');
        expr = { kind: 'index', object: expr, index, line: t.line };
        continue;
      }

      if (t.kind === 'op' && (t.value === '.' || t.value === '::')) {
        this.advance();
        if (this.peek().kind !== 'ident') {
          throw new UserProgramError('compiler_error', `Line ${this.peek().line}: Expected property name after '${t.value}'.`, this.peek().line);
        }
        const property = this.advance().value;
        expr = { kind: 'member', object: expr, property, line: t.line };
        continue;
      }

      if (t.kind === 'op' && (t.value === '++' || t.value === '--')) {
        this.advance();
        expr = { kind: 'unary', op: t.value, arg: expr, prefix: false, line: t.line };
        continue;
      }

      break;
    }

    return expr;
  }

  private parsePrimary(): Expr {
    const t = this.peek();

    if (t.kind === 'number') {
      this.advance();
      const isFloat = t.value.includes('.') || t.value.includes('e') || t.value.includes('E');
      return { kind: 'number', value: Number(t.value), isFloat, line: t.line };
    }

    if (t.kind === 'string' || t.kind === 'char') {
      this.advance();
      return { kind: 'string', value: t.value, line: t.line };
    }

    if (this.isIdent('true')) {
      this.advance();
      return { kind: 'bool', value: true, line: t.line };
    }

    if (this.isIdent('false')) {
      this.advance();
      return { kind: 'bool', value: false, line: t.line };
    }

    if (this.isIdent('null') || this.isIdent('NULL') || this.isIdent('nullptr')) {
      this.advance();
      return { kind: 'null', line: t.line };
    }

    if (this.isIdent('new')) {
      this.advance();
      if (this.isIdent('Scanner')) {
        this.advance();
        this.expect('punct', '(');
        // consume System.in
        this.parseExpression();
        this.expect('punct', ')');
        return { kind: 'new_scanner', line: t.line };
      }
      const elemType = this.peek().kind === 'ident' ? this.advance().value : '';
      if (elemType && this.match('punct', '[')) {
        if (this.match('punct', ']')) {
          return this.parseArrayLiteral();
        }
        const size = this.parseExpression();
        this.expect('punct', ']');
        return { kind: 'new_array', elemType, size, line: t.line };
      }
      throw new UnsupportedConstructError(`Object construction 'new ${elemType}' requires AI simulation.`);
    }

    if (t.kind === 'ident') {
      this.advance();
      return { kind: 'ident', name: t.value, line: t.line };
    }

    if (t.kind === 'punct' && t.value === '(') {
      this.advance();
      const inner = this.parseExpression();
      this.expect('punct', ')');
      return inner;
    }

    throw new UserProgramError(
      'compiler_error',
      `Line ${t.line}: Unexpected token '${t.value || 'end of file'}'.`,
      t.line
    );
  }
}

// ---------------- Evaluator & Step Tracer ----------------

type RuntimeValue =
  | number
  | string
  | boolean
  | null
  | { __kind: 'array'; id: string; elemType: string; elements: RuntimeValue[] }
  | { __kind: 'scanner' };

interface VarSlot {
  typeName: string;
  value: RuntimeValue;
}

interface EnvFrame {
  frameId: string;
  name: string;
  line: number;
  scopes: Array<Map<string, VarSlot>>;
}

class ReturnSignal {
  value: RuntimeValue;
  constructor(value: RuntimeValue) {
    this.value = value;
  }
}
class BreakSignal {}
class ContinueSignal {}

const MAX_OPS = 2500;
const MAX_STEPS = 250;
const MAX_CALL_DEPTH = 64;

function isIntegerType(typeName: string): boolean {
  return /^(int|long|short|byte|size_t|unsigned|signed)/i.test(typeName.trim());
}

function coerceToType(typeName: string, val: RuntimeValue): RuntimeValue {
  if (val === null || typeof val === 'object') return val;
  if (isIntegerType(typeName)) {
    const num = Number(val);
    return Number.isFinite(num) ? Math.trunc(num) : 0;
  }
  if (typeName === 'double' || typeName === 'float') {
    const num = Number(val);
    return Number.isFinite(num) ? num : 0;
  }
  if (typeName === 'boolean' || typeName === 'bool') {
    return Boolean(val);
  }
  if (typeName === 'String' || typeName === 'string') {
    return String(val);
  }
  return val;
}

function defaultForType(typeName: string): RuntimeValue {
  if (isIntegerType(typeName) || typeName === 'double' || typeName === 'float') return 0;
  if (typeName === 'boolean' || typeName === 'bool') return false;
  if (typeName === 'String' || typeName === 'string' || typeName === 'char') return '';
  return null;
}

function formatPrintf(fmt: string, args: RuntimeValue[]): string {
  let argIdx = 0;
  return fmt.replace(/%([+-]?\d*(?:\.\d+)?)?(l{0,2}[diufFeEgGxXsc]|%)/g, (_match, flags: string | undefined, spec: string) => {
    if (spec === '%') return '%';
    const val = args[argIdx++];
    if (val === undefined || val === null) return 'null';
    if (spec.endsWith('d') || spec.endsWith('i') || spec.endsWith('u')) {
      return String(Math.trunc(Number(val)));
    }
    if (spec.endsWith('f') || spec.endsWith('F')) {
      const precMatch = flags?.match(/\.(\d+)/);
      const prec = precMatch ? Number(precMatch[1]) : 6;
      return Number(val).toFixed(prec);
    }
    if (spec.endsWith('g') || spec.endsWith('G')) {
      return String(Number(val));
    }
    if (spec.endsWith('s')) {
      return String(val);
    }
    if (spec.endsWith('c')) {
      return typeof val === 'number' ? String.fromCharCode(val) : String(val).slice(0, 1);
    }
    return String(val);
  });
}

class Evaluator {
  private lang: CLikeLanguage;
  private functions: Map<string, FunctionDef>;
  private frames: EnvFrame[] = [];
  private events: TraceEvent[] = [];
  private steps: CLikeLegacyStep[] = [];
  private outText = '';
  private opCount = 0;
  private nextObjId = 1;
  private nextFrameId = 1;
  private truncated = false;

  // Stdin token & line cursors
  private stdinRaw: string;
  private stdinTokens: string[];
  private stdinTokenIdx = 0;
  private stdinLines: string[];
  private stdinLineIdx = 0;

  constructor(lang: CLikeLanguage, functions: Map<string, FunctionDef>, stdin: string) {
    this.lang = lang;
    this.functions = functions;
    this.stdinRaw = stdin;
    this.stdinTokens = stdin.trim() ? stdin.trim().split(/\s+/) : [];
    this.stdinLines = stdin.length > 0 ? stdin.replace(/\r\n/g, '\n').split('\n') : [];
  }

  private tick(line: number): void {
    this.opCount++;
    if (this.opCount > MAX_OPS) {
      throw new UserProgramError(
        'timeout',
        `Execution stopped after ${MAX_OPS} operations (possible infinite loop near line ${line}).`,
        line
      );
    }
  }

  private currentFrame(): EnvFrame {
    return this.frames[this.frames.length - 1];
  }

  private pushScope(): void {
    this.currentFrame().scopes.push(new Map());
  }

  private popScope(): void {
    const f = this.currentFrame();
    if (f.scopes.length > 1) f.scopes.pop();
  }

  private declareVar(name: string, typeName: string, value: RuntimeValue): void {
    const scopes = this.currentFrame().scopes;
    scopes[scopes.length - 1].set(name, { typeName, value });
  }

  private lookupVar(name: string, line: number): VarSlot {
    const f = this.currentFrame();
    for (let i = f.scopes.length - 1; i >= 0; i--) {
      const slot = f.scopes[i].get(name);
      if (slot) return slot;
    }
    // Check global / main frame for class-level static variables
    if (this.frames.length > 1) {
      const root = this.frames[0];
      const slot = root.scopes[0]?.get(name);
      if (slot) return slot;
    }
    throw new UserProgramError('runtime_error', `Line ${line}: Undefined variable '${name}'.`, line);
  }

  private serializeValue(val: RuntimeValue, heap: Record<string, HeapObject>): ValueRef {
    if (val === null || typeof val === 'number' || typeof val === 'string' || typeof val === 'boolean') {
      return val;
    }
    if (val.__kind === 'scanner') {
      return 'Scanner(System.in)';
    }
    const elements: ValueRef[] = val.elements.map((el) => this.serializeValue(el, heap));
    heap[val.id] = {
      id: val.id,
      kind: 'array',
      className: `${val.elemType}[]`,
      elements,
      totalLength: elements.length,
    };
    return { __ref: val.id };
  }

  private serializeLegacyValue(val: RuntimeValue): unknown {
    if (val === null || typeof val === 'number' || typeof val === 'string' || typeof val === 'boolean') {
      return val;
    }
    if (val.__kind === 'scanner') {
      return 'Scanner(System.in)';
    }
    return val.elements.map((el) => this.serializeLegacyValue(el));
  }

  private recordStep(
    line: number,
    type: TraceEventType,
    changes: StateChange[],
    printChunk = '',
    note = ''
  ): void {
    if (this.events.length >= MAX_STEPS) {
      this.truncated = true;
      return;
    }

    const frame = this.currentFrame();
    frame.line = line;

    const heap: Record<string, HeapObject> = {};
    const locals: Record<string, ValueRef> = {};
    const legacyVars: Record<string, unknown> = {};

    for (const scope of frame.scopes) {
      for (const [k, slot] of scope.entries()) {
        if (slot.value && typeof slot.value === 'object' && slot.value.__kind === 'scanner') {
          continue;
        }
        locals[k] = this.serializeValue(slot.value, heap);
        legacyVars[k] = this.serializeLegacyValue(slot.value);
      }
    }

    const callStack: StackFrame[] = this.frames.map((fr) => {
      let count = 0;
      for (const s of fr.scopes) count += s.size;
      return {
        frameId: fr.frameId,
        name: fr.name,
        line: fr.line,
        localsCount: count,
      };
    });

    const seq = this.events.length + 1;
    this.events.push({
      id: `event-${String(seq).padStart(3, '0')}`,
      sequence: seq,
      line: Math.max(1, line),
      type,
      provenance: 'observed',
      scope: frame.name,
      functionName: frame.name,
      changes,
      objectIds: Object.keys(heap),
      heap,
      locals,
      callStack,
      print: printChunk,
      outText: this.outText,
      explanation: note,
      metadata: { runtime: `${this.lang}-subset-interpreter` },
      scene: null,
    });

    this.steps.push({
      line: Math.max(1, line),
      note,
      vars: legacyVars,
      print: printChunk,
      scene: null,
      outText: this.outText,
    });
  }

  run(topLevelStatements: Stmt[]): {
    events: TraceEvent[];
    steps: CLikeLegacyStep[];
    output: string;
    truncated: boolean;
  } {
    const mainFn = this.functions.get('main');

    if (mainFn) {
      this.frames.push({
        frameId: `frame-${this.nextFrameId++}`,
        name: 'main',
        line: mainFn.line,
        scopes: [new Map()],
      });

      // Execute any class-level static variable declarations first
      for (const stmt of topLevelStatements) {
        this.execStmt(stmt);
      }

      try {
        this.execStmt(mainFn.body);
      } catch (sig) {
        if (!(sig instanceof ReturnSignal)) throw sig;
      }
    } else if (topLevelStatements.length > 0) {
      this.frames.push({
        frameId: `frame-${this.nextFrameId++}`,
        name: 'main',
        line: topLevelStatements[0].line,
        scopes: [new Map()],
      });
      try {
        for (const stmt of topLevelStatements) {
          this.execStmt(stmt);
        }
      } catch (sig) {
        if (!(sig instanceof ReturnSignal)) throw sig;
      }
    } else {
      throw new UserProgramError(
        'compiler_error',
        'No main() function or executable statements were found in this program.',
        1
      );
    }

    return {
      events: this.events,
      steps: this.steps,
      output: this.outText,
      truncated: this.truncated,
    };
  }

  private execStmt(stmt: Stmt): void {
    this.tick(stmt.line);

    switch (stmt.kind) {
      case 'empty':
        return;

      case 'block': {
        this.pushScope();
        try {
          for (const s of stmt.body) {
            this.execStmt(s);
          }
        } finally {
          this.popScope();
        }
        return;
      }

      case 'vardecl': {
        const changes: StateChange[] = [];
        for (const item of stmt.items) {
          let val: RuntimeValue;
          if (item.init) {
            val = this.evalExpr(item.init);
            if (item.isArray && val && typeof val === 'object' && val.__kind === 'array') {
              val.elemType = stmt.varType;
            } else if (!item.isArray) {
              val = coerceToType(stmt.varType, val);
            }
          } else if (item.isArray) {
            const len = item.arraySize ? Math.max(0, Math.trunc(Number(this.evalExpr(item.arraySize)))) : 0;
            const def = defaultForType(stmt.varType);
            val = {
              __kind: 'array',
              id: `obj-arr-${this.nextObjId++}`,
              elemType: stmt.varType,
              elements: Array.from({ length: Math.min(len, 1000) }, () => def),
            };
          } else {
            val = defaultForType(stmt.varType);
          }
          this.declareVar(item.name, stmt.varType, val);
          if (!(val && typeof val === 'object' && val.__kind === 'scanner')) {
            changes.push({
              target: item.name,
              kind: 'create',
              newValue: this.serializeLegacyValue(val),
            });
          }
        }
        if (changes.length > 0) {
          this.recordStep(stmt.line, 'var_declare', changes);
        }
        return;
      }

      case 'expr': {
        const beforeLen = this.events.length;
        this.evalExpr(stmt.expr);
        // Ensure bare expressions with no recorded mutation/output still produce a step if needed
        if (this.events.length === beforeLen && stmt.expr.kind === 'call') {
          this.recordStep(stmt.line, 'statement', []);
        }
        return;
      }

      case 'if': {
        const condVal = Boolean(this.evalExpr(stmt.cond));
        this.recordStep(stmt.line, 'branch_decision', [
          { target: 'condition', kind: 'branch', newValue: condVal },
        ]);
        if (condVal) {
          this.execStmt(stmt.thenBranch);
        } else if (stmt.elseBranch) {
          this.execStmt(stmt.elseBranch);
        }
        return;
      }

      case 'while': {
        while (true) {
          this.tick(stmt.line);
          const condVal = Boolean(this.evalExpr(stmt.cond));
          this.recordStep(stmt.line, 'loop_iteration', [
            { target: 'condition', kind: 'branch', newValue: condVal },
          ]);
          if (!condVal) break;
          try {
            this.execStmt(stmt.body);
          } catch (sig) {
            if (sig instanceof BreakSignal) break;
            if (sig instanceof ContinueSignal) continue;
            throw sig;
          }
        }
        return;
      }

      case 'do_while': {
        while (true) {
          this.tick(stmt.line);
          try {
            this.execStmt(stmt.body);
          } catch (sig) {
            if (sig instanceof BreakSignal) break;
            if (sig instanceof ContinueSignal) {
              // proceed to cond
            } else {
              throw sig;
            }
          }
          const condVal = Boolean(this.evalExpr(stmt.cond));
          this.recordStep(stmt.line, 'loop_iteration', [
            { target: 'condition', kind: 'branch', newValue: condVal },
          ]);
          if (!condVal) break;
        }
        return;
      }

      case 'for': {
        this.pushScope();
        try {
          if (stmt.init) {
            this.execStmt(stmt.init);
          }
          while (true) {
            this.tick(stmt.line);
            const condVal = stmt.cond ? Boolean(this.evalExpr(stmt.cond)) : true;
            this.recordStep(stmt.line, 'loop_iteration', [
              { target: 'condition', kind: 'branch', newValue: condVal },
            ]);
            if (!condVal) break;
            try {
              this.execStmt(stmt.body);
            } catch (sig) {
              if (sig instanceof BreakSignal) break;
              if (sig instanceof ContinueSignal) {
                // run update
              } else {
                throw sig;
              }
            }
            if (stmt.update) {
              this.evalExpr(stmt.update);
            }
          }
        } finally {
          this.popScope();
        }
        return;
      }

      case 'return': {
        const val = stmt.value ? this.evalExpr(stmt.value) : null;
        this.recordStep(stmt.line, 'function_return', [
          { target: this.currentFrame().name, kind: 'return', newValue: this.serializeLegacyValue(val) },
        ]);
        throw new ReturnSignal(val);
      }

      case 'break':
        throw new BreakSignal();

      case 'continue':
        throw new ContinueSignal();

      case 'cout': {
        let text = '';
        for (const p of stmt.parts) {
          const v = this.evalExpr(p);
          text += this.stringifyOutput(v);
        }
        this.outText += text;
        this.recordStep(
          stmt.line,
          'console_output',
          [{ target: 'stdout', kind: 'output', newValue: text.replace(/\n$/, '') }],
          text.replace(/\n$/, '')
        );
        return;
      }

      case 'cin': {
        const changes: StateChange[] = [];
        for (const target of stmt.targets) {
          if (target.kind !== 'ident') {
            throw new UnsupportedConstructError('Complex cin targets require AI simulation.');
          }
          const slot = this.lookupVar(target.name, stmt.line);
          const rawToken = this.readNextStdinToken(stmt.line);
          const oldVal = this.serializeLegacyValue(slot.value);
          const newVal = this.parseTokenForType(rawToken, slot.typeName, stmt.line);
          slot.value = newVal;
          changes.push({
            target: target.name,
            kind: 'update',
            oldValue: oldVal,
            newValue: this.serializeLegacyValue(newVal),
          });
        }
        this.recordStep(stmt.line, 'var_assign', changes);
        return;
      }
    }
  }

  private readNextStdinToken(line: number): string {
    if (this.stdinTokenIdx >= this.stdinTokens.length) {
      throw new UserProgramError(
        'missing_input',
        `Missing Program Input (line ${line}): the program tried to read input, but Program Input had no more values. Enter values in the Program Input box and try again.`,
        line
      );
    }
    return this.stdinTokens[this.stdinTokenIdx++];
  }

  private readNextStdinLine(line: number): string {
    if (this.stdinLineIdx >= this.stdinLines.length || !this.stdinRaw.trim()) {
      throw new UserProgramError(
        'missing_input',
        `Missing Program Input (line ${line}): the program tried to read a line of input, but Program Input is empty. Enter values in the Program Input box and try again.`,
        line
      );
    }
    return this.stdinLines[this.stdinLineIdx++];
  }

  private parseTokenForType(token: string, typeName: string, line: number): RuntimeValue {
    if (typeName === 'String' || typeName === 'string') return token;
    if (typeName === 'char') return token.slice(0, 1);
    if (typeName === 'boolean' || typeName === 'bool') return token.toLowerCase() === 'true' || token === '1';
    const num = Number(token);
    if (!Number.isFinite(num)) {
      throw new UserProgramError(
        'runtime_error',
        `Line ${line}: Could not read "${token}" as a ${typeName} number from Program Input.`,
        line
      );
    }
    return isIntegerType(typeName) ? Math.trunc(num) : num;
  }

  private stringifyOutput(val: RuntimeValue): string {
    if (val === null) return 'null';
    if (typeof val === 'object') {
      if (val.__kind === 'array') {
        return '[' + val.elements.map((e) => this.stringifyOutput(e)).join(', ') + ']';
      }
      return 'Scanner';
    }
    return String(val);
  }

  private evalExpr(expr: Expr): RuntimeValue {
    this.tick(expr.line);

    switch (expr.kind) {
      case 'number':
        return expr.value;
      case 'string':
        return expr.value;
      case 'bool':
        return expr.value;
      case 'null':
        return null;
      case 'new_scanner':
        return { __kind: 'scanner' };

      case 'array_lit': {
        const elements = expr.elements.map((e) => this.evalExpr(e));
        return {
          __kind: 'array',
          id: `obj-arr-${this.nextObjId++}`,
          elemType: 'auto',
          elements,
        };
      }

      case 'new_array': {
        const size = Math.max(0, Math.trunc(Number(this.evalExpr(expr.size))));
        const def = defaultForType(expr.elemType);
        return {
          __kind: 'array',
          id: `obj-arr-${this.nextObjId++}`,
          elemType: expr.elemType,
          elements: Array.from({ length: Math.min(size, 1000) }, () => def),
        };
      }

      case 'ident':
        return this.lookupVar(expr.name, expr.line).value;

      case 'addr_of':
        return this.evalExpr(expr.target);

      case 'cast': {
        const v = this.evalExpr(expr.expr);
        return coerceToType(expr.targetType, v);
      }

      case 'unary': {
        if (expr.op === '++' || expr.op === '--') {
          const delta = expr.op === '++' ? 1 : -1;
          if (expr.arg.kind === 'ident') {
            const slot = this.lookupVar(expr.arg.name, expr.line);
            const oldNum = Number(slot.value);
            const newNum = oldNum + delta;
            slot.value = coerceToType(slot.typeName, newNum);
            this.recordStep(expr.line, 'var_assign', [
              { target: expr.arg.name, kind: 'update', oldValue: oldNum, newValue: slot.value },
            ]);
            return expr.prefix ? slot.value : oldNum;
          }
          throw new UnsupportedConstructError('Increment/decrement on complex targets requires AI simulation.');
        }
        const v = this.evalExpr(expr.arg);
        if (expr.op === '-') return -Number(v);
        if (expr.op === '+') return +Number(v);
        if (expr.op === '!') return !Boolean(v);
        return v;
      }

      case 'binary': {
        if (expr.op === '&&') {
          return Boolean(this.evalExpr(expr.left)) && Boolean(this.evalExpr(expr.right));
        }
        if (expr.op === '||') {
          return Boolean(this.evalExpr(expr.left)) || Boolean(this.evalExpr(expr.right));
        }
        const l = this.evalExpr(expr.left);
        const r = this.evalExpr(expr.right);

        if (expr.op === '+') {
          if (typeof l === 'string' || typeof r === 'string') {
            return this.stringifyOutput(l) + this.stringifyOutput(r);
          }
          return Number(l) + Number(r);
        }
        if (expr.op === '-') return Number(l) - Number(r);
        if (expr.op === '*') return Number(l) * Number(r);
        if (expr.op === '/') {
          const denom = Number(r);
          if (denom === 0) {
            throw new UserProgramError('runtime_error', `Line ${expr.line}: Division by zero.`, expr.line);
          }
          const lIsInt = typeof l === 'number' && Number.isInteger(l) && !(expr.left.kind === 'number' && expr.left.isFloat);
          const rIsInt = typeof r === 'number' && Number.isInteger(r) && !(expr.right.kind === 'number' && expr.right.isFloat);
          // Integer division semantics in Java/C/C++ when both operands are integer types/literals
          if (lIsInt && rIsInt && this.isIntTypedExpr(expr.left) && this.isIntTypedExpr(expr.right)) {
            return Math.trunc(Number(l) / denom);
          }
          return Number(l) / denom;
        }
        if (expr.op === '%') {
          const denom = Number(r);
          if (denom === 0) {
            throw new UserProgramError('runtime_error', `Line ${expr.line}: Modulo by zero.`, expr.line);
          }
          return Number(l) % denom;
        }
        if (expr.op === '==') return l === r;
        if (expr.op === '!=') return l !== r;
        if (expr.op === '<') return Number(l) < Number(r);
        if (expr.op === '<=') return Number(l) <= Number(r);
        if (expr.op === '>') return Number(l) > Number(r);
        if (expr.op === '>=') return Number(l) >= Number(r);
        throw new UnsupportedConstructError(`Operator '${expr.op}' requires AI simulation.`);
      }

      case 'ternary':
        return Boolean(this.evalExpr(expr.cond)) ? this.evalExpr(expr.thenExpr) : this.evalExpr(expr.elseExpr);

      case 'assign': {
        const rhs = this.evalExpr(expr.value);

        if (expr.target.kind === 'ident') {
          const slot = this.lookupVar(expr.target.name, expr.line);
          const oldVal = slot.value;
          let nextVal = rhs;
          if (expr.op === '+=') {
            nextVal = typeof oldVal === 'string' || typeof rhs === 'string'
              ? this.stringifyOutput(oldVal) + this.stringifyOutput(rhs)
              : Number(oldVal) + Number(rhs);
          } else if (expr.op === '-=') nextVal = Number(oldVal) - Number(rhs);
          else if (expr.op === '*=') nextVal = Number(oldVal) * Number(rhs);
          else if (expr.op === '/=') {
            if (Number(rhs) === 0) throw new UserProgramError('runtime_error', `Line ${expr.line}: Division by zero.`, expr.line);
            nextVal = Number(oldVal) / Number(rhs);
          } else if (expr.op === '%=') {
            if (Number(rhs) === 0) throw new UserProgramError('runtime_error', `Line ${expr.line}: Modulo by zero.`, expr.line);
            nextVal = Number(oldVal) % Number(rhs);
          }
          slot.value = coerceToType(slot.typeName, nextVal);
          this.recordStep(expr.line, 'var_assign', [
            {
              target: expr.target.name,
              kind: 'update',
              oldValue: this.serializeLegacyValue(oldVal),
              newValue: this.serializeLegacyValue(slot.value),
            },
          ]);
          return slot.value;
        }

        if (expr.target.kind === 'index') {
          const arrVal = this.evalExpr(expr.target.object);
          const idx = Math.trunc(Number(this.evalExpr(expr.target.index)));
          if (!arrVal || typeof arrVal !== 'object' || arrVal.__kind !== 'array') {
            throw new UserProgramError('runtime_error', `Line ${expr.line}: Cannot index a non-array value.`, expr.line);
          }
          if (idx < 0 || idx >= arrVal.elements.length) {
            throw new UserProgramError(
              'runtime_error',
              `Line ${expr.line}: Array index ${idx} out of bounds (length ${arrVal.elements.length}).`,
              expr.line
            );
          }
          const oldVal = arrVal.elements[idx];
          let nextVal = rhs;
          if (expr.op === '+=') nextVal = Number(oldVal) + Number(rhs);
          else if (expr.op === '-=') nextVal = Number(oldVal) - Number(rhs);
          else if (expr.op === '*=') nextVal = Number(oldVal) * Number(rhs);
          else if (expr.op === '/=') nextVal = Number(oldVal) / Number(rhs);
          else if (expr.op === '%=') nextVal = Number(oldVal) % Number(rhs);
          arrVal.elements[idx] = coerceToType(arrVal.elemType, nextVal);
          const arrName = expr.target.object.kind === 'ident' ? expr.target.object.name : 'array';
          this.recordStep(expr.line, 'array_update', [
            {
              target: `${arrName}[${idx}]`,
              kind: 'update',
              oldValue: this.serializeLegacyValue(oldVal),
              newValue: this.serializeLegacyValue(arrVal.elements[idx]),
              index: idx,
              objectId: arrVal.id,
            },
          ]);
          return arrVal.elements[idx];
        }

        throw new UnsupportedConstructError('Assignment target requires AI simulation.');
      }

      case 'index': {
        const arrVal = this.evalExpr(expr.object);
        const idx = Math.trunc(Number(this.evalExpr(expr.index)));
        if (typeof arrVal === 'string') {
          if (idx < 0 || idx >= arrVal.length) {
            throw new UserProgramError('runtime_error', `Line ${expr.line}: String index ${idx} out of bounds.`, expr.line);
          }
          return arrVal[idx];
        }
        if (!arrVal || typeof arrVal !== 'object' || arrVal.__kind !== 'array') {
          throw new UserProgramError('runtime_error', `Line ${expr.line}: Cannot index a non-array value.`, expr.line);
        }
        if (idx < 0 || idx >= arrVal.elements.length) {
          throw new UserProgramError(
            'runtime_error',
            `Line ${expr.line}: Array index ${idx} out of bounds (length ${arrVal.elements.length}).`,
            expr.line
          );
        }
        return arrVal.elements[idx];
      }

      case 'member': {
        const obj = this.evalExpr(expr.object);
        if (obj && typeof obj === 'object' && obj.__kind === 'array' && expr.property === 'length') {
          return obj.elements.length;
        }
        if (typeof obj === 'string' && expr.property === 'length') {
          return obj.length;
        }
        throw new UnsupportedConstructError(`Property '.${expr.property}' requires AI simulation.`);
      }

      case 'call':
        return this.evalCall(expr);
    }
  }

  private isIntTypedExpr(expr: Expr): boolean {
    if (expr.kind === 'number') return !expr.isFloat;
    if (expr.kind === 'ident') {
      try {
        const slot = this.lookupVar(expr.name, expr.line);
        return isIntegerType(slot.typeName);
      } catch {
        return false;
      }
    }
    if (expr.kind === 'cast') return isIntegerType(expr.targetType);
    if (expr.kind === 'binary') return this.isIntTypedExpr(expr.left) && this.isIntTypedExpr(expr.right);
    return false;
  }

  private evalCall(expr: Extract<Expr, { kind: 'call' }>): RuntimeValue {
    // Java System.out.println / print / printf
    if (expr.callee.kind === 'member') {
      const prop = expr.callee.property;
      const obj = expr.callee.object;

      if (
        obj.kind === 'member' &&
        obj.property === 'out' &&
        obj.object.kind === 'ident' &&
        obj.object.name === 'System'
      ) {
        if (prop === 'println' || prop === 'print') {
          const rendered = expr.args.map((a) => this.stringifyOutput(this.evalExpr(a))).join('');
          const chunk = prop === 'println' ? `${rendered}\n` : rendered;
          this.outText += chunk;
          this.recordStep(
            expr.line,
            'console_output',
            [{ target: 'stdout', kind: 'output', newValue: rendered }],
            rendered
          );
          return null;
        }
        if (prop === 'printf') {
          const vals = expr.args.map((a) => this.evalExpr(a));
          const fmt = String(vals[0] ?? '');
          const formatted = formatPrintf(fmt, vals.slice(1));
          this.outText += formatted;
          const trimmed = formatted.replace(/\n$/, '');
          this.recordStep(
            expr.line,
            'console_output',
            [{ target: 'stdout', kind: 'output', newValue: trimmed }],
            trimmed
          );
          return null;
        }
      }

      // Java Math.*
      if (obj.kind === 'ident' && obj.name === 'Math') {
        const vals = expr.args.map((a) => Number(this.evalExpr(a)));
        if (prop === 'max') return Math.max(vals[0], vals[1]);
        if (prop === 'min') return Math.min(vals[0], vals[1]);
        if (prop === 'abs') return Math.abs(vals[0]);
        if (prop === 'pow') return Math.pow(vals[0], vals[1]);
        if (prop === 'sqrt') return Math.sqrt(vals[0]);
        if (prop === 'floor') return Math.floor(vals[0]);
        if (prop === 'ceil') return Math.ceil(vals[0]);
        if (prop === 'round') return Math.round(vals[0]);
      }

      // Java Arrays.toString(arr)
      if (obj.kind === 'ident' && obj.name === 'Arrays' && prop === 'toString') {
        const v = this.evalExpr(expr.args[0]);
        return this.stringifyOutput(v);
      }

      // Evaluate receiver for instance methods (Scanner, String, vector)
      const receiver = this.evalExpr(obj);
      if (receiver && typeof receiver === 'object' && receiver.__kind === 'scanner') {
        if (prop === 'nextInt' || prop === 'nextLong') {
          return this.parseTokenForType(this.readNextStdinToken(expr.line), 'int', expr.line);
        }
        if (prop === 'nextDouble' || prop === 'nextFloat') {
          return this.parseTokenForType(this.readNextStdinToken(expr.line), 'double', expr.line);
        }
        if (prop === 'next') {
          return this.readNextStdinToken(expr.line);
        }
        if (prop === 'nextLine') {
          return this.readNextStdinLine(expr.line);
        }
        if (prop === 'close') return null;
      }

      if (typeof receiver === 'string') {
        if (prop === 'length' || prop === 'size') return receiver.length;
        if (prop === 'toUpperCase') return receiver.toUpperCase();
        if (prop === 'toLowerCase') return receiver.toLowerCase();
        if (prop === 'trim') return receiver.trim();
        if (prop === 'charAt') {
          const i = Math.trunc(Number(this.evalExpr(expr.args[0])));
          return receiver.charAt(i);
        }
        if (prop === 'substring') {
          const a = Math.trunc(Number(this.evalExpr(expr.args[0])));
          const b = expr.args[1] ? Math.trunc(Number(this.evalExpr(expr.args[1]))) : undefined;
          return receiver.substring(a, b);
        }
        if (prop === 'equals') {
          return receiver === String(this.evalExpr(expr.args[0]));
        }
      }

      if (receiver && typeof receiver === 'object' && receiver.__kind === 'array') {
        if (prop === 'size') return receiver.elements.length;
        if (prop === 'push_back') {
          const val = coerceToType(receiver.elemType, this.evalExpr(expr.args[0]));
          receiver.elements.push(val);
          const arrName = obj.kind === 'ident' ? obj.name : 'vector';
          this.recordStep(expr.line, 'array_append', [
            {
              target: `${arrName}[${receiver.elements.length - 1}]`,
              kind: 'create',
              newValue: this.serializeLegacyValue(val),
              index: receiver.elements.length - 1,
              objectId: receiver.id,
            },
          ]);
          return null;
        }
        if (prop === 'pop_back') {
          const popped = receiver.elements.pop() ?? null;
          const arrName = obj.kind === 'ident' ? obj.name : 'vector';
          this.recordStep(expr.line, 'array_remove', [
            {
              target: arrName,
              kind: 'delete',
              oldValue: this.serializeLegacyValue(popped),
              objectId: receiver.id,
            },
          ]);
          return null;
        }
      }

      throw new UnsupportedConstructError(`Method call '.${prop}()' requires AI simulation.`);
    }

    if (expr.callee.kind !== 'ident') {
      throw new UnsupportedConstructError('Dynamic function calls require AI simulation.');
    }

    const fnName = expr.callee.name;

    // C printf
    if (fnName === 'printf') {
      const vals = expr.args.map((a) => this.evalExpr(a));
      const fmt = String(vals[0] ?? '');
      const formatted = formatPrintf(fmt, vals.slice(1));
      this.outText += formatted;
      const trimmed = formatted.replace(/\n$/, '');
      this.recordStep(
        expr.line,
        'console_output',
        [{ target: 'stdout', kind: 'output', newValue: trimmed }],
        trimmed
      );
      return formatted.length;
    }

    // C puts
    if (fnName === 'puts') {
      const text = this.stringifyOutput(this.evalExpr(expr.args[0]));
      this.outText += `${text}\n`;
      this.recordStep(
        expr.line,
        'console_output',
        [{ target: 'stdout', kind: 'output', newValue: text }],
        text
      );
      return 0;
    }

    // C scanf("%d %d", &a, &b)
    if (fnName === 'scanf') {
      if (expr.args.length < 2) {
        throw new UserProgramError('compiler_error', `Line ${expr.line}: scanf expects a format string and target variables.`, expr.line);
      }
      const fmt = String(this.evalExpr(expr.args[0]));
      const specs = fmt.match(/%l{0,2}[diufsc]/g) || [];
      const changes: StateChange[] = [];
      for (let i = 0; i < specs.length && i + 1 < expr.args.length; i++) {
        const arg = expr.args[i + 1];
        const identNode = arg.kind === 'addr_of' ? arg.target : arg;
        if (identNode.kind !== 'ident') {
          throw new UnsupportedConstructError('Complex scanf targets require AI simulation.');
        }
        const slot = this.lookupVar(identNode.name, expr.line);
        const rawToken = this.readNextStdinToken(expr.line);
        const oldVal = this.serializeLegacyValue(slot.value);
        const newVal = this.parseTokenForType(rawToken, slot.typeName, expr.line);
        slot.value = newVal;
        changes.push({
          target: identNode.name,
          kind: 'update',
          oldValue: oldVal,
          newValue: this.serializeLegacyValue(newVal),
        });
      }
      this.recordStep(expr.line, 'var_assign', changes);
      return changes.length;
    }

    // C/C++ standard math functions
    if (fnName === 'abs' || fnName === 'fabs') return Math.abs(Number(this.evalExpr(expr.args[0])));
    if (fnName === 'sqrt') return Math.sqrt(Number(this.evalExpr(expr.args[0])));
    if (fnName === 'pow') return Math.pow(Number(this.evalExpr(expr.args[0])), Number(this.evalExpr(expr.args[1])));
    if (fnName === 'max') return Math.max(Number(this.evalExpr(expr.args[0])), Number(this.evalExpr(expr.args[1])));
    if (fnName === 'min') return Math.min(Number(this.evalExpr(expr.args[0])), Number(this.evalExpr(expr.args[1])));
    if (fnName === 'strlen') return String(this.evalExpr(expr.args[0])).length;
    if (fnName === 'to_string') return this.stringifyOutput(this.evalExpr(expr.args[0]));

    // User-defined function
    const fnDef = this.functions.get(fnName);
    if (!fnDef) {
      throw new UnsupportedConstructError(`Function '${fnName}()' is not defined in the local subset; using AI simulation.`);
    }

    if (this.frames.length >= MAX_CALL_DEPTH) {
      throw new UserProgramError(
        'runtime_error',
        `Line ${expr.line}: Maximum recursion depth (${MAX_CALL_DEPTH}) exceeded while calling ${fnName}().`,
        expr.line
      );
    }

    const argVals = expr.args.map((a) => this.evalExpr(a));
    const newScope = new Map<string, VarSlot>();
    for (let i = 0; i < fnDef.params.length; i++) {
      const p = fnDef.params[i];
      const v = i < argVals.length ? argVals[i] : defaultForType(p.typeName);
      newScope.set(p.name, {
        typeName: p.typeName,
        value: p.isArray ? v : coerceToType(p.typeName, v),
      });
    }

    this.frames.push({
      frameId: `frame-${this.nextFrameId++}`,
      name: fnName,
      line: fnDef.line,
      scopes: [newScope],
    });

    this.recordStep(fnDef.line, 'function_call', [
      {
        target: fnName,
        kind: 'call',
        newValue: argVals.map((v) => this.serializeLegacyValue(v)),
      },
    ]);

    let retVal: RuntimeValue = null;
    try {
      this.execStmt(fnDef.body);
    } catch (sig) {
      if (sig instanceof ReturnSignal) {
        retVal = sig.value;
      } else {
        this.frames.pop();
        throw sig;
      }
    }

    this.frames.pop();
    return fnDef.returnType === 'void' ? null : coerceToType(fnDef.returnType, retVal);
  }
}

export function interpretCLikeProgram(
  lang: CLikeLanguage,
  code: string,
  stdin = ''
): CLikeInterpretResult {
  try {
    const tokens = tokenize(code);
    const parser = new Parser(tokens, lang);
    const ast = parser.parseProgram();
    const evaluator = new Evaluator(lang, ast.functions, stdin);
    const result = evaluator.run(ast.topLevelStatements);
    if (result.events.length === 0) {
      return {
        status: 'unsupported_construct',
        reason: 'Program produced no traceable statements in the local interpreter.',
      };
    }
    return {
      status: 'ok',
      events: result.events,
      steps: result.steps,
      output: result.output,
      truncated: result.truncated,
    };
  } catch (err) {
    if (err instanceof UnsupportedConstructError) {
      return {
        status: 'unsupported_construct',
        reason: err.message,
      };
    }
    if (err instanceof UserProgramError) {
      return {
        status: 'user_error',
        category: err.category,
        message: err.message,
        line: err.line,
        events: [],
        steps: [],
        output: '',
      };
    }
    return {
      status: 'unsupported_construct',
      reason: err instanceof Error ? err.message : 'Local subset interpreter fell back to AI simulation.',
    };
  }
}
