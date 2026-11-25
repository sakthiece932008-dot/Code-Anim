import { memo, useMemo } from 'react';
import { ArrowRight, Calculator, GitBranch, Repeat, Terminal } from 'lucide-react';
import type { ReconstructedFrame } from '../lib/replayEngine';
import { formatValue } from '../lib/explain';

export interface ParsedArithmeticOperation {
  kind: 'expression';
  targetVar: string | null;
  leftLabel: string;
  leftValue: string;
  operatorSymbol: string;
  rightLabel: string;
  rightValue: string;
  resultValue: string;
}

export interface ParsedUnaryOperation {
  kind: 'transition';
  targetVar: string;
  beforeValue: string;
  afterValue: string;
  label: string;
}

export interface ParsedBranchOperation {
  kind: 'condition';
  expression: string;
  outcome: boolean | null;
}

export interface ParsedLoopOperation {
  kind: 'loop';
  summary: string;
}

export type GenericVisualOperation =
  | ParsedArithmeticOperation
  | ParsedUnaryOperation
  | ParsedBranchOperation
  | ParsedLoopOperation;

const OP_DISPLAY: Record<string, string> = {
  '*': '×',
  '/': '÷',
  '//': '÷',
  '+': '+',
  '-': '−',
  '%': '%',
};

function resolveOperandDisplay(
  token: string,
  prevVars: Record<string, unknown>,
  currVars: Record<string, unknown>
): { label: string; value: string } {
  const t = token.trim();
  if (/^-?\d+(?:\.\d+)?$/.test(t)) {
    return { label: 'value', value: t };
  }
  if (/^["'].*["']$/.test(t)) {
    return { label: 'text', value: t };
  }
  if (Object.prototype.hasOwnProperty.call(prevVars, t)) {
    return { label: t, value: formatValue(prevVars[t]) };
  }
  if (Object.prototype.hasOwnProperty.call(currVars, t)) {
    return { label: t, value: formatValue(currVars[t]) };
  }
  return { label: t, value: t };
}

/**
 * Pure, data-driven extractor that derives generic visual operations
 * (arithmetic expressions, string concatenation, variable transitions,
 * conditions, loops) directly from the active source line and live trace values.
 * Zero hardcoded program examples — adapts to any variable names, numbers, or expressions.
 */
export function extractGenericVisualOperation(
  sourceLine: string,
  frame: ReconstructedFrame,
  prevFrame: ReconstructedFrame | null
): GenericVisualOperation | null {
  const line = sourceLine.trim().replace(/;$/, '');
  if (!line) return null;

  const currVars = frame.step.vars || {};
  const prevVars = prevFrame?.step.vars || {};

  // 1. Compound assignment: e.g. total += i, x *= 2
  const compoundMatch = line.match(
    /^(?:(?:let|const|var|int|double|float|long|short|auto|String|string)\s+)?([A-Za-z_]\w*)\s*([+\-*/%])=\s*(.+)$/
  );
  if (compoundMatch) {
    const [, target, op, rhs] = compoundMatch;
    if (Object.prototype.hasOwnProperty.call(currVars, target)) {
      const left = resolveOperandDisplay(target, prevVars, currVars);
      const right = resolveOperandDisplay(rhs, prevVars, currVars);
      return {
        kind: 'expression',
        targetVar: target,
        leftLabel: left.label,
        leftValue: left.value,
        operatorSymbol: OP_DISPLAY[op] || op,
        rightLabel: right.label,
        rightValue: right.value,
        resultValue: formatValue(currVars[target]),
      };
    }
  }

  // 2. Binary arithmetic / string assignment: e.g. int result = a * b, total = x + y, msg = first + " " + last
  const assignMatch = line.match(
    /^(?:(?:final|const|let|var|static|public|private|unsigned)\s+)*(?:(?:int|long|short|float|double|number|string|String|boolean|bool|char|auto|var|let|const)\s+)?([A-Za-z_]\w*)\s*=\s*(.+)$/
  );
  if (assignMatch) {
    const target = assignMatch[1];
    const rhs = assignMatch[2].trim();

    if (Object.prototype.hasOwnProperty.call(currVars, target)) {
      // Match simple binary expression: <left> <op> <right> (ignoring leading unary minus on operands)
      const binMatch = rhs.match(
        /^(-?[A-Za-z_]\w*|-?\d+(?:\.\d+)?|"[^"]*"|'[^']*')\s*(\/\/|[+\-*/%])\s*(-?[A-Za-z_]\w*|-?\d+(?:\.\d+)?|"[^"]*"|'[^']*')$/
      );
      if (binMatch) {
        const [, leftTok, op, rightTok] = binMatch;
        const left = resolveOperandDisplay(leftTok, prevVars, currVars);
        const right = resolveOperandDisplay(rightTok, prevVars, currVars);
        return {
          kind: 'expression',
          targetVar: target,
          leftLabel: left.label,
          leftValue: left.value,
          operatorSymbol: OP_DISPLAY[op] || op,
          rightLabel: right.label,
          rightValue: right.value,
          resultValue: formatValue(currVars[target]),
        };
      }

      // Multi-term expression (e.g. (a + b) * c or a + " " + b)
      if (/[+\-*/%]/.test(rhs)) {
        const substituted = rhs.replace(/\b([A-Za-z_]\w*)\b/g, (id) => {
          if (Object.prototype.hasOwnProperty.call(prevVars, id)) {
            return formatValue(prevVars[id]);
          }
          if (Object.prototype.hasOwnProperty.call(currVars, id)) {
            return formatValue(currVars[id]);
          }
          return id;
        });
        return {
          kind: 'transition',
          targetVar: target,
          beforeValue: substituted,
          afterValue: formatValue(currVars[target]),
          label: `Evaluate ${rhs}`,
        };
      }

      // Plain update where previous value existed and changed
      if (
        Object.prototype.hasOwnProperty.call(prevVars, target) &&
        formatValue(prevVars[target]) !== formatValue(currVars[target])
      ) {
        return {
          kind: 'transition',
          targetVar: target,
          beforeValue: formatValue(prevVars[target]),
          afterValue: formatValue(currVars[target]),
          label: `Update ${target}`,
        };
      }
    }
  }

  // 3. Increment / decrement: i++, ++i, count--
  const incMatch = line.match(/^(?:(\+\+|--)\s*([A-Za-z_]\w*)|([A-Za-z_]\w*)\s*(\+\+|--))$/);
  if (incMatch) {
    const varName = incMatch[2] || incMatch[3];
    if (varName && Object.prototype.hasOwnProperty.call(currVars, varName)) {
      const before = Object.prototype.hasOwnProperty.call(prevVars, varName)
        ? formatValue(prevVars[varName])
        : '?';
      return {
        kind: 'transition',
        targetVar: varName,
        beforeValue: before,
        afterValue: formatValue(currVars[varName]),
        label: (incMatch[1] || incMatch[4]) === '++' ? `Increment ${varName}` : `Decrement ${varName}`,
      };
    }
  }

  // 4. Branch / condition check
  if (frame.eventType === 'branch_decision' || /^(?:if|else\s+if|elif)\b/.test(line)) {
    const condMatch = line.match(/^(?:if|else\s+if|elif)\s*\(?([^:{]+?)\)?\s*(?:\{|:|$)/);
    const expr = condMatch ? condMatch[1].trim() : line;
    const outcome =
      typeof frame.event.metadata?.taken === 'boolean' ? frame.event.metadata.taken : null;
    return {
      kind: 'condition',
      expression: expr,
      outcome,
    };
  }

  // 5. Loop iteration
  if (frame.eventType === 'loop_iteration' || /^(?:for|while)\b/.test(line)) {
    return {
      kind: 'loop',
      summary: line.length > 72 ? `${line.slice(0, 69)}…` : line,
    };
  }

  return null;
}

interface GenericOperationStageProps {
  sourceCode: string;
  frame: ReconstructedFrame;
  prevFrame: ReconstructedFrame | null;
}

export const GenericOperationStage = memo(function GenericOperationStage({
  sourceCode,
  frame,
  prevFrame,
}: GenericOperationStageProps) {
  const sourceLine = useMemo(() => {
    const lines = sourceCode.split('\n');
    return lines[frame.line - 1] || '';
  }, [sourceCode, frame.line]);

  const visualOp = useMemo(
    () => extractGenericVisualOperation(sourceLine, frame, prevFrame),
    [sourceLine, frame, prevFrame]
  );

  const printedNow = (frame.print || '').trim();
  const isCallOrReturn =
    frame.eventType === 'function_call' || frame.eventType === 'function_return';

  if (!visualOp && !printedNow && !isCallOrReturn) {
    return null;
  }

  return (
    <div className="space-y-2.5" data-testid="generic-operation-stage">
      {/* Arithmetic / Expression / Value Transition Visual */}
      {visualOp?.kind === 'expression' && (
        <div className="rounded-xl border border-indigo-500/40 bg-indigo-500/10 p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-indigo-300 mb-2">
            <Calculator className="w-3.5 h-3.5" />
            <span>Operation on Line {frame.line}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 font-mono">
            <div className="rounded-lg border border-slate-600/70 ca-surface px-3 py-1.5 text-center min-w-[60px]">
              <div className="text-[10px] ca-text-muted">{visualOp.leftLabel}</div>
              <div className="text-sm font-bold tabular-nums">{visualOp.leftValue}</div>
            </div>
            <span className="text-base font-bold text-indigo-400 px-1" aria-label="operator">
              {visualOp.operatorSymbol}
            </span>
            <div className="rounded-lg border border-slate-600/70 ca-surface px-3 py-1.5 text-center min-w-[60px]">
              <div className="text-[10px] ca-text-muted">{visualOp.rightLabel}</div>
              <div className="text-sm font-bold tabular-nums">{visualOp.rightValue}</div>
            </div>
            <span className="text-base font-bold text-indigo-400 px-1">=</span>
            <div className="rounded-lg border border-emerald-400/70 bg-emerald-500/15 px-3 py-1.5 text-center min-w-[64px] ca-anim-new">
              <div className="text-[10px] text-emerald-300">result</div>
              <div className="text-sm font-bold text-emerald-200 tabular-nums">
                {visualOp.resultValue}
              </div>
            </div>
            {visualOp.targetVar && (
              <>
                <ArrowRight className="w-4 h-4 text-amber-400 shrink-0" />
                <div className="rounded-lg border border-amber-400/70 bg-amber-500/15 px-3 py-1.5 text-center min-w-[72px] ca-anim-chg">
                  <div className="text-[10px] text-amber-300">stored in {visualOp.targetVar}</div>
                  <div className="text-sm font-bold text-amber-200 tabular-nums">
                    {visualOp.resultValue}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {visualOp?.kind === 'transition' && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-300 mb-2">
            <Calculator className="w-3.5 h-3.5" />
            <span>{visualOp.label} (Line {frame.line})</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
            <div className="rounded-lg border border-slate-600/70 ca-surface px-2.5 py-1.5">
              {visualOp.beforeValue}
            </div>
            <ArrowRight className="w-4 h-4 text-amber-400 shrink-0" />
            <div className="rounded-lg border border-emerald-400/70 bg-emerald-500/15 px-3 py-1.5 font-bold text-emerald-200 ca-anim-chg">
              {visualOp.targetVar} = {visualOp.afterValue}
            </div>
          </div>
        </div>
      )}

      {visualOp?.kind === 'condition' && (
        <div className="rounded-xl border border-sky-500/40 bg-sky-500/10 px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 font-mono">
            <GitBranch className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span>Check: {visualOp.expression}</span>
          </div>
          {visualOp.outcome !== null && (
            <span
              className={`font-semibold ${
                visualOp.outcome ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {visualOp.outcome ? 'True (enter branch)' : 'False (skip branch)'}
            </span>
          )}
        </div>
      )}

      {visualOp?.kind === 'loop' && (
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 flex items-center gap-2 text-xs font-mono">
          <Repeat className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span className="truncate">Loop step: {visualOp.summary}</span>
        </div>
      )}

      {isCallOrReturn && (
        <div className="rounded-xl border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-xs font-mono flex items-center gap-2">
          <ArrowRight className="w-3.5 h-3.5 text-violet-400 shrink-0" />
          <span>
            {frame.eventType === 'function_call'
              ? `Calling function ${frame.event.functionName || 'function'}()`
              : `Returning from ${frame.event.functionName || 'function'}()`}
          </span>
        </div>
      )}

      {printedNow && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 flex items-center gap-2 text-xs font-mono ca-anim-new">
          <Terminal className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="ca-text-muted">Output</span>
          <ArrowRight className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="font-semibold text-emerald-300 break-all">{printedNow}</span>
        </div>
      )}
    </div>
  );
});
