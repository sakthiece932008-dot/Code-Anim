import type { SyntaxHighlightGroup } from './languageRegistry';

export type SyntaxTokenType =
  | 'plain'
  | 'keyword'
  | 'string'
  | 'number'
  | 'comment'
  | 'type'
  | 'function';

export interface SyntaxToken {
  type: SyntaxTokenType;
  text: string;
}

const KEYWORDS_BY_GROUP: Record<SyntaxHighlightGroup, Set<string>> = {
  'js-ts': new Set([
    'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
    'switch', 'case', 'break', 'continue', 'class', 'constructor', 'new', 'this',
    'extends', 'super', 'try', 'catch', 'finally', 'throw', 'async', 'await',
    'import', 'export', 'from', 'default', 'typeof', 'instanceof', 'in', 'of',
    'true', 'false', 'null', 'undefined', 'interface', 'type', 'enum', 'readonly',
    'public', 'private', 'protected', 'as', 'implements', 'void',
  ]),
  python: new Set([
    'def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'not',
    'and', 'or', 'is', 'None', 'True', 'False', 'import', 'from', 'as', 'pass',
    'break', 'continue', 'try', 'except', 'finally', 'raise', 'with', 'lambda',
    'yield', 'global', 'nonlocal', 'self', 'end', 'do', 'then', 'local', 'puts',
  ]),
  'c-like': new Set([
    'int', 'long', 'short', 'float', 'double', 'char', 'bool', 'boolean', 'void',
    'auto', 'const', 'static', 'public', 'private', 'protected', 'class', 'struct',
    'enum', 'interface', 'extends', 'implements', 'new', 'return', 'if', 'else',
    'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'try', 'catch',
    'throw', 'using', 'namespace', 'package', 'import', 'include', 'func', 'fn',
    'fun', 'val', 'var', 'let', 'mut', 'impl', 'pub', 'match', 'true', 'false',
    'null', 'nullptr', 'nil', 'String', 'echo', 'typedef', 'sizeof', 'final',
  ]),
  markup: new Set(['DOCTYPE', 'html', 'head', 'body', 'div', 'span', 'script', 'style']),
  sql: new Set([
    'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET',
    'DELETE', 'CREATE', 'TABLE', 'DROP', 'JOIN', 'LEFT', 'RIGHT', 'INNER',
    'ON', 'GROUP', 'BY', 'ORDER', 'ASC', 'DESC', 'LIMIT', 'AS', 'AND', 'OR', 'NOT',
    'select', 'from', 'where', 'insert', 'into', 'values', 'update', 'set',
    'delete', 'create', 'table', 'join', 'group', 'by', 'order', 'limit', 'as',
  ]),
  shell: new Set([
    'if', 'then', 'else', 'elif', 'fi', 'for', 'in', 'do', 'done', 'while',
    'case', 'esac', 'function', 'echo', 'export', 'local', 'return', 'exit',
  ]),
  functional: new Set([
    'module', 'where', 'import', 'let', 'in', 'case', 'of', 'if', 'then', 'else',
    'data', 'type', 'defmodule', 'def', 'do', 'end', 'fn', 'match', 'with',
  ]),
  lisp: new Set([
    'defun', 'defn', 'define', 'lambda', 'let', 'if', 'cond', 'progn', 'module',
    'func', 'param', 'result', 'ns', 'format',
  ]),
  assembly: new Set([
    'section', 'global', 'mov', 'add', 'sub', 'mul', 'div', 'cmp', 'jmp', 'je',
    'jne', 'jg', 'jl', 'call', 'ret', 'push', 'pop', 'syscall', 'int',
  ]),
  plain: new Set(['program', 'begin', 'end', 'if', 'then', 'else', 'for', 'while', 'return']),
};

/**
 * Safe, zero-HTML tokenizer for rendering language-aware syntax highlighting via React spans.
 */
export function tokenizeSourceLine(line: string, group: SyntaxHighlightGroup): SyntaxToken[] {
  if (!line) return [{ type: 'plain', text: ' ' }];
  const tokens: SyntaxToken[] = [];
  const keywords = KEYWORDS_BY_GROUP[group] || KEYWORDS_BY_GROUP.plain;
  const lineCommentMarker =
    group === 'python' || group === 'shell'
      ? '#'
      : group === 'sql' || group === 'functional'
        ? '--'
        : group === 'lisp' || group === 'assembly'
          ? ';'
          : '//';

  let i = 0;
  const len = line.length;

  while (i < len) {
    // 1. Line comments
    if (line.startsWith(lineCommentMarker, i)) {
      tokens.push({ type: 'comment', text: line.slice(i) });
      break;
    }

    // 2. String literals
    const ch = line[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < len) {
        if (line[j] === '\\') {
          j += 2;
          continue;
        }
        if (line[j] === ch) {
          j++;
          break;
        }
        j++;
      }
      tokens.push({ type: 'string', text: line.slice(i, j) });
      i = j;
      continue;
    }

    // 3. Numbers
    if (/[0-9]/.test(ch) && (i === 0 || !/[A-Za-z_$]/.test(line[i - 1]))) {
      let j = i + 1;
      while (j < len && /[0-9._xXa-fA-F]/.test(line[j])) j++;
      tokens.push({ type: 'number', text: line.slice(i, j) });
      i = j;
      continue;
    }

    // 4. Identifiers / keywords / types / function calls
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1;
      while (j < len && /[A-Za-z0-9_$]/.test(line[j])) j++;
      const word = line.slice(i, j);
      if (keywords.has(word)) {
        tokens.push({ type: 'keyword', text: word });
      } else if (/^[A-Z][A-Za-z0-9_]*$/.test(word)) {
        tokens.push({ type: 'type', text: word });
      } else if (line[j] === '(') {
        tokens.push({ type: 'function', text: word });
      } else {
        tokens.push({ type: 'plain', text: word });
      }
      i = j;
      continue;
    }

    // 5. Plain punctuation / whitespace
    let j = i + 1;
    while (
      j < len &&
      !/[A-Za-z0-9_$"'`]/.test(line[j]) &&
      !line.startsWith(lineCommentMarker, j)
    ) {
      j++;
    }
    tokens.push({ type: 'plain', text: line.slice(i, j) });
    i = j;
  }

  return tokens;
}
