import type { TraceEvent } from '../types/trace';

export interface ExpressionRange {
  start: number;
  end: number;
  text: string;
}

/**
 * Finds the index where a trailing single-line comment starts (outside quotes),
 * or returns line.length if there is no trailing comment.
 */
function findCommentStart(line: string): number {
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '/' && line[i + 1] === '/') {
      return i;
    }
    if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return i;
    }
  }
  return line.length;
}

/**
 * Finds the matching closing parenthesis for an opening '(' at openIdx,
 * respecting string literals and nested parentheses.
 */
function findMatchingParen(str: string, openIdx: number): number {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;
  for (let i = openIdx; i < str.length; i++) {
    const ch = str[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Trims leading/trailing whitespace and optional trailing statement terminators
 * (`;`, `{`, `:`) from a slice `[start, end)` of `line`.
 */
function trimSpan(line: string, start: number, end: number): ExpressionRange | null {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(line[s])) s++;
  while (e > s && /[\s;]/.test(line[e - 1])) e--;
  if (e <= s) return null;
  const text = line.slice(s, e);
  if (!text || text === '{' || text === '}' || text === '(' || text === ')') {
    return null;
  }
  return { start: s, end: e, text };
}

/**
 * Finds a top-level single `=` assignment operator (ignoring `==`, `!=`, `<=`,
 * `>=`, `=>`, and `=` inside quotes or parentheses/brackets).
 */
function findTopLevelAssignment(code: string): { opStart: number; opEnd: number; isCompound: boolean } | null {
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;

  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') {
      paren++;
      continue;
    }
    if (ch === ')') {
      paren = Math.max(0, paren - 1);
      continue;
    }
    if (ch === '[') {
      bracket++;
      continue;
    }
    if (ch === ']') {
      bracket = Math.max(0, bracket - 1);
      continue;
    }
    if (ch === '{') {
      brace++;
      continue;
    }
    if (ch === '}') {
      brace = Math.max(0, brace - 1);
      continue;
    }

    if (paren !== 0 || bracket !== 0 || brace !== 0) continue;

    if (ch === '=') {
      const prev = i > 0 ? code[i - 1] : '';
      const next = i + 1 < code.length ? code[i + 1] : '';
      if (next === '=' || next === '>') {
        i++;
        continue;
      }
      if (prev === '!' || prev === '<' || prev === '>' || prev === '=') {
        continue;
      }
      if (prev === '+' || prev === '-' || prev === '*' || prev === '/' || prev === '%' || prev === '&' || prev === '|' || prev === '^') {
        return { opStart: i - 1, opEnd: i + 1, isCompound: true };
      }
      if (prev === ':') {
        // Go short declaration `:=` or Pascal assignment
        return { opStart: i - 1, opEnd: i + 1, isCompound: false };
      }
      return { opStart: i, opEnd: i + 1, isCompound: false };
    }
  }
  return null;
}

/**
 * Extracts a reliable sub-expression span from a column offset provided by an
 * AST / runtime tracer.
 */
function rangeFromColumn(code: string, column: number): ExpressionRange | null {
  if (!Number.isFinite(column) || column < 0 || column >= code.length) return null;
  let start = Math.floor(column);
  while (start < code.length && /\s/.test(code[start])) start++;
  if (start >= code.length) return null;

  // Walk forward across a balanced expression until a top-level delimiter
  let paren = 0;
  let bracket = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;
  let end = start;

  for (let i = start; i < code.length; i++) {
    const ch = code[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      end = i + 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      end = i + 1;
      continue;
    }
    if (ch === '(') {
      paren++;
      end = i + 1;
      continue;
    }
    if (ch === ')') {
      if (paren === 0) break;
      paren--;
      end = i + 1;
      continue;
    }
    if (ch === '[') {
      bracket++;
      end = i + 1;
      continue;
    }
    if (ch === ']') {
      if (bracket === 0) break;
      bracket--;
      end = i + 1;
      continue;
    }
    if (paren === 0 && bracket === 0 && (ch === ';' || ch === '{' || ch === '}')) {
      break;
    }
    end = i + 1;
  }

  return trimSpan(code, start, end);
}

/**
 * Identifies the exact sub-expression inside `lineText` being evaluated or
 * animated on the current step (for example, `a * b` inside `int result = a * b;`).
 *
 * Returns `null` when no reliable sub-expression can be determined so the
 * caller can cleanly fall back to full-line highlighting.
 */
export function findActiveExpressionRange(
  lineText: string,
  event?: Pick<TraceEvent, 'type' | 'column' | 'changes' | 'metadata'> | null
): ExpressionRange | null {
  if (!lineText) return null;

  const codeEnd = findCommentStart(lineText);
  const code = lineText.slice(0, codeEnd);
  const trimmed = code.trim();
  if (!trimmed || trimmed === '{' || trimmed === '}' || trimmed === 'else' || trimmed === 'else {' || trimmed === 'else:') {
    return null;
  }

  // Skip pure structural declarations that have no active runtime sub-expression
  if (/^(?:public|private|protected)?\s*(?:static\s+)?(?:class|interface|struct|enum|package|import|using|namespace|#include)\b/.test(trimmed)) {
    return null;
  }

  // 1. Honor reliable tracer column metadata when it narrows down inside the line
  if (typeof event?.column === 'number' && event.column >= 0) {
    const leadingIndent = code.length - code.trimStart().length;
    if (event.column > leadingIndent) {
      const colRange = rangeFromColumn(code, event.column);
      if (colRange && colRange.text.length < trimmed.length) {
        return colRange;
      }
    }
  }

  // 2. Output / print calls (e.g., System.out.println(result); / console.log(x) / print(a * b))
  const printCallMatch = code.match(
    /\b(?:System\.out\.println|System\.out\.print|console\.log|console\.info|console\.warn|print|println|printf|puts|fmt\.Println|fmt\.Printf|Console\.WriteLine|Console\.Write)\s*\(/
  );
  if (printCallMatch && printCallMatch.index !== undefined) {
    const openParen = code.indexOf('(', printCallMatch.index);
    const closeParen = openParen >= 0 ? findMatchingParen(code, openParen) : -1;
    if (openParen >= 0 && closeParen > openParen + 1) {
      const inner = trimSpan(code, openParen + 1, closeParen);
      if (inner) return inner;
    }
  }

  // C++ stream output: `std::cout << expr << ...;`
  const coutMatch = code.match(/\b(?:std::)?cout\s*<<\s*/);
  if (coutMatch && coutMatch.index !== undefined) {
    const afterStream = coutMatch.index + coutMatch[0].length;
    const nextStream = code.indexOf('<<', afterStream);
    const spanEnd = nextStream >= 0 ? nextStream : code.length;
    const inner = trimSpan(code, afterStream, spanEnd);
    if (inner) return inner;
  }

  // 3. Return statement: `return n * fact(n - 1);`
  const returnMatch = code.match(/\breturn\s+/);
  if (returnMatch && returnMatch.index !== undefined) {
    const rhsStart = returnMatch.index + returnMatch[0].length;
    const rhs = trimSpan(code, rhsStart, code.length);
    if (rhs && rhs.text.length < trimmed.length) {
      return rhs;
    }
  }

  // 4. Conditional / loop header expressions:
  //    C-family: `if (score >= 70)`, `else if (...)`, `while (i < n)`, `for (int i = 0; i < n; i++)`
  const parenCtrlMatch = code.match(/\b(?:else\s+if|if|while|for|switch)\s*\(/);
  if (parenCtrlMatch && parenCtrlMatch.index !== undefined) {
    const openParen = code.indexOf('(', parenCtrlMatch.index);
    const closeParen = openParen >= 0 ? findMatchingParen(code, openParen) : -1;
    if (openParen >= 0 && closeParen > openParen + 1) {
      const innerText = code.slice(openParen + 1, closeParen);
      // For C-style `for (init; cond; step)`, highlight the condition clause
      if (/\bfor\s*\(/.test(parenCtrlMatch[0]) && innerText.includes(';')) {
        const firstSemi = innerText.indexOf(';');
        const secondSemi = innerText.indexOf(';', firstSemi + 1);
        if (firstSemi >= 0 && secondSemi > firstSemi) {
          const condSpan = trimSpan(code, openParen + 1 + firstSemi + 1, openParen + 1 + secondSemi);
          if (condSpan) return condSpan;
        }
      }
      const cond = trimSpan(code, openParen + 1, closeParen);
      if (cond) return cond;
    }
  }

  // Python / Ruby / Rust-style conditions without mandatory parens: `if score >= 70:` / `elif x > 0:` / `while n > 0:`
  const pyCtrlMatch = code.match(/^\s*(?:if|elif|while)\s+(.+?)\s*:?\s*$/);
  if (pyCtrlMatch && pyCtrlMatch[1]) {
    const exprText = pyCtrlMatch[1].replace(/\{$/, '').trim();
    const startIdx = code.indexOf(exprText);
    if (startIdx >= 0 && exprText.length > 0 && exprText.length < trimmed.length) {
      return { start: startIdx, end: startIdx + exprText.length, text: exprText };
    }
  }

  // 5. Assignments & variable declarations: `int result = a * b;`, `total += i;`, `x = a + b`
  const assign = findTopLevelAssignment(code);
  if (assign) {
    const rhs = trimSpan(code, assign.opEnd, code.length);
    if (rhs) {
      // If it's a compound assignment like `total += i;` and RHS is a single identifier/literal,
      // highlight the whole compound expression (`total += i`) only if there is a prefix,
      // otherwise highlight the RHS (`i` or `a * b`).
      if (rhs.text.length < trimmed.length) {
        return rhs;
      }
    }
  }

  // 6. Standalone function / method call expression: `swap(arr, i, j);` or `arr.push(val);`
  const callMatch = code.match(/([A-Za-z_$][\w$.]*\s*\()/);
  if (callMatch && callMatch.index !== undefined) {
    // Avoid highlighting function definitions like `public static void main(String[] args)`
    const prefix = code.slice(0, callMatch.index).trim();
    const isDefinition =
      /^(?:function|async\s+function|def|fn|func|public|private|protected|static|void|int|double|float|long|boolean|String|char)\b/.test(
        prefix
      );
    if (!isDefinition) {
      const openParen = code.indexOf('(', callMatch.index);
      const closeParen = openParen >= 0 ? findMatchingParen(code, openParen) : -1;
      if (openParen >= 0 && closeParen > openParen) {
        const callSpan = trimSpan(code, callMatch.index, closeParen + 1);
        if (callSpan && (event?.type === 'function_call' || callSpan.text.length < trimmed.length)) {
          return callSpan;
        }
      }
    }
  }

  return null;
}
