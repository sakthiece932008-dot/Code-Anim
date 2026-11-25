import {
  isObjectRef,
  type ErrorHelpReport,
  type ExplanationChangeItem,
  type HeapObject,
  type LanguageId,
  type StepExplanationBreakdown,
  type TraceEvent,
  type TraceStep,
  type ValueRef,
} from '../types/trace';

export function isPrimitive(v: unknown): boolean {
  return v === null || typeof v !== 'object';
}

export function isTree(v: unknown): v is Record<string, unknown> {
  return Boolean(
    v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      ('left' in (v as Record<string, unknown>) || 'right' in (v as Record<string, unknown>))
  );
}

export function isLinkedList(v: unknown): v is Record<string, unknown> {
  return Boolean(
    v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      'next' in (v as Record<string, unknown>) &&
      !isTree(v)
  );
}

export function getNodeValue(node: Record<string, unknown>): unknown {
  for (const key of ['value', 'val', 'data', 'key', 'name']) {
    if (key in node && isPrimitive(node[key])) return node[key];
  }
  for (const [key, val] of Object.entries(node)) {
    if (isPrimitive(val) && key !== 'left' && key !== 'right' && key !== 'next' && key !== '__cls') {
      return val;
    }
  }
  return '•';
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return 'empty (null)';
  if (typeof v === 'string') return `"${v}"`;
  if (typeof v === 'object') {
    try {
      const s = JSON.stringify(v);
      return s.length > 28 ? s.slice(0, 26) + '…' : s;
    } catch {
      return 'an object';
    }
  }
  return String(v);
}

function formatSimpleRef(ref: unknown, heap: Record<string, HeapObject>): string {
  if (ref === null || ref === undefined) return 'nothing (empty)';
  if (typeof ref === 'string') return `"${ref}"`;
  if (typeof ref === 'number' || typeof ref === 'boolean') return String(ref);
  if (isObjectRef(ref as ValueRef)) {
    const id = (ref as { __ref: string }).__ref;
    const obj = heap[id];
    if (!obj) return id;
    if (obj.kind === 'array') return `a list of ${obj.totalLength ?? obj.elements?.length ?? 0} item(s)`;
    if (obj.kind === 'set') return `a set of ${obj.totalLength ?? obj.elements?.length ?? 0} item(s)`;
    if (obj.kind === 'map') return `a table with ${obj.totalLength ?? Object.keys(obj.entries || {}).length} entries`;
    return obj.className ? `a ${obj.className} item` : 'an object';
  }
  return formatValue(ref);
}

/**
 * Beginner-friendly, jargon-free explanation of a single source code line.
 */
export function lessonForLine(rawLine: string): string {
  const t = rawLine.replace(/[;{]\s*$/, '').trim();
  if (!t || t === '}') {
    return 'This finishes the current section of code and moves on.';
  }
  if (
    /^(function|def|public|private|static|void|class|fun|fn|func)\b/.test(t) &&
    !/=/.test(t) &&
    /(\(|class\b)/.test(t)
  ) {
    return 'Sets up a reusable recipe (function or class) that the program can run later.';
  }
  if (/^(console\.log|print|System\.out|printf|cout|puts|println|fmt\.Print|Console\.Write)\b/.test(t)) {
    return 'Shows a message or value in the Console Output box.';
  }
  if (/^(for|while)\b/.test(t)) {
    return 'Starts or repeats a loop to run the next steps again while the rule is still true.';
  }
  if (/^(else\s*if|elif|if)\b/.test(t)) {
    return 'Checks a yes-or-no question to decide which path the program should take next.';
  }
  if (/^else\b/.test(t)) {
    return 'The earlier check was false, so the program takes this backup path instead.';
  }
  if (/^return\b/.test(t)) {
    return 'Finishes this function and sends the answer back to where it was called.';
  }
  const assignMatch = t.match(
    /^(?:const|let|var|int|long|float|double|char|bool|boolean|String|auto|val)?\s*([A-Za-z_$][\w$.[\]]*)\s*(?::[^=]+)?=\s*(.+)$/
  );
  if (assignMatch) {
    const isDecl = /^(const|let|var|int|long|float|double|char|bool|boolean|String|auto|val)\b/.test(t);
    return isDecl
      ? `Creates a new named storage spot called "${assignMatch[1]}" and puts ${assignMatch[2]} in it.`
      : `Changes the value stored in "${assignMatch[1]}" to ${assignMatch[2]}.`;
  }
  if (/(\+\+|--|[-+*/]=)/.test(t)) {
    return 'Updates a number by adding to it, subtracting from it, or scaling it.';
  }
  if (/\.(push|append)\s*\(/.test(t)) {
    return 'Adds a new item to the end of the list.';
  }
  if (/\.(pop)\s*\(/.test(t)) {
    return 'Takes off the last item from the list.';
  }
  if (/\.(shift|popleft)\s*\(/.test(t)) {
    return 'Takes off the first item from the front of the queue.';
  }
  if (/\.(sort)\s*\(/.test(t)) {
    return 'Puts the items in the list into sorted order.';
  }
  if (/\w+\s*\(.*\)$/.test(t)) {
    return 'Runs a function to do a specific job, then comes back here with the result.';
  }
  return `Runs this step: ${t}`;
}

export function describeChanges(step: TraceStep, prevStep: TraceStep | null): string {
  const prevVars = prevStep?.vars || {};
  const updates: string[] = [];

  for (const [k, v] of Object.entries(step.vars)) {
    const prev = prevVars[k];
    const isNew = !(k in prevVars);
    const changed = isNew || JSON.stringify(v) !== JSON.stringify(prev);
    if (changed) {
      if (isPrimitive(v)) {
        updates.push(isNew ? `${k} starts at ${formatValue(v)}` : `${k} changed from ${formatValue(prev)} to ${formatValue(v)}`);
      } else if (Array.isArray(v)) {
        updates.push(`${k} list ${isNew ? 'was created' : 'was updated'} (${v.length} items)`);
      } else if (isTree(v)) {
        updates.push(`${k} tree ${isNew ? 'was created' : 'was updated'}`);
      } else if (isLinkedList(v)) {
        updates.push(`${k} linked list ${isNew ? 'was created' : 'was updated'}`);
      } else {
        updates.push(`${k} was ${isNew ? 'created' : 'updated'}`);
      }
    }
  }

  if (step.print) {
    updates.push(`printed ${formatValue(step.print)}`);
  }

  return updates.length > 0 ? ` ${updates.slice(0, 3).join('; ')}.` : '';
}

export function explainStep(step: TraceStep, prevStep: TraceStep | null, lines: string[]): string {
  if (step.note && step.note.trim()) {
    return step.note.trim();
  }
  const sourceLine = lines[step.line - 1] || '';
  return lessonForLine(sourceLine) + describeChanges(step, prevStep);
}

/**
 * Builds the 5-section simple-English explanation grounded strictly in verified trace data:
 * 1. What does this program do?
 * 2. What is happening now?
 * 3. Why is this happening?
 * 4. What changed? (before -> after)
 * 5. Final result (only when on the last step / finished)
 */
function describeConditionWithLiveValues(
  sourceLine: string,
  stepVars: Record<string, unknown>
): string | null {
  const m = sourceLine.match(/\b(?:if|elif|else\s+if|while)\s*\(?\s*([^:{)]+)\)?/);
  if (!m) return null;
  const rawCond = m[1].trim();
  const cmp = rawCond.match(/^([A-Za-z_][\w.[\]]*)\s*(===|==|!==|!=|<=|>=|<|>)\s*([A-Za-z0-9_."'[\]-]+)$/);
  if (!cmp) return null;
  const [, leftExpr, op, rightExpr] = cmp;

  const resolveExpr = (expr: string): string => {
    const t = expr.trim();
    if (t in stepVars && isPrimitive(stepVars[t])) return formatValue(stepVars[t]);
    const arrMatch = t.match(/^([A-Za-z_]\w*)\[([A-Za-z_]\w*|\d+)\]$/);
    if (arrMatch) {
      const arr = stepVars[arrMatch[1]];
      const idxRaw = arrMatch[2];
      const idx = /^\d+$/.test(idxRaw) ? Number(idxRaw) : Number(stepVars[idxRaw]);
      if (Array.isArray(arr) && Number.isInteger(idx) && idx >= 0 && idx < arr.length) {
        return formatValue(arr[idx]);
      }
    }
    const arrPlus = t.match(/^([A-Za-z_]\w*)\[([A-Za-z_]\w*)\s*\+\s*1\]$/);
    if (arrPlus) {
      const arr = stepVars[arrPlus[1]];
      const idx = Number(stepVars[arrPlus[2]]) + 1;
      if (Array.isArray(arr) && Number.isInteger(idx) && idx >= 0 && idx < arr.length) {
        return formatValue(arr[idx]);
      }
    }
    return t;
  };

  const leftVal = resolveExpr(leftExpr);
  const rightVal = resolveExpr(rightExpr);
  const opWords: Record<string, string> = {
    '>': 'is bigger than',
    '<': 'is smaller than',
    '>=': 'is at least',
    '<=': 'is at most',
    '==': 'equals',
    '===': 'equals',
    '!=': 'is different from',
    '!==': 'is different from',
  };
  return `${leftVal} ${opWords[op] || op} ${rightVal}`;
}

export function buildStepExplanationBreakdown(params: {
  event: TraceEvent;
  prevEvent: TraceEvent | null;
  step: TraceStep;
  prevStep: TraceStep | null;
  codeLines: readonly string[];
  programPurpose: string;
  isFinalStep: boolean;
  stoppedEarly?: boolean;
}): StepExplanationBreakdown {
  const { event, prevEvent, step, prevStep, codeLines, programPurpose, isFinalStep, stoppedEarly } = params;
  const sourceLine = (codeLines[event.line - 1] || '').trim();

  // A. What is happening now? (Very simple everyday English using actual live values)
  let whatIsHappeningNow = '';
  let whatDoesThisMean = '';
  let technicalDetail = `Event "${event.type}" (${event.provenance}) at line ${event.line} in scope "${event.scope}" (call depth ${event.callStack.length}).`;

  switch (event.type) {
    case 'function_call': {
      const top = event.callStack[event.callStack.length - 1];
      const argsList = top?.args ? Object.entries(top.args) : [];
      const argsText =
        argsList.length > 0
          ? argsList.map(([k, v]) => `${k} = ${String(v)}`).join(', ')
          : '';
      whatIsHappeningNow = argsText
        ? `The function "${event.functionName}" starts working with ${argsText}.`
        : `The function "${event.functionName}" starts running.`;
      whatDoesThisMean = 'The program pauses where it was, runs this helper task, and will come back when it finishes.';
      technicalDetail = `Function invocation pushed activation frame "${event.functionName}" onto the call stack (depth ${event.callStack.length}) with arguments ${argsText || '(none)'}.`;
      break;
    }
    case 'function_return': {
      const top = event.callStack[event.callStack.length - 1];
      whatIsHappeningNow =
        top?.returnValue !== undefined && top?.returnValue !== null
          ? `The function "${event.functionName}" finishes and hands back ${String(top.returnValue)}.`
          : `The function "${event.functionName}" finishes its job and returns.`;
      whatDoesThisMean = 'The helper task is done, so the program picks up right where it left off.';
      technicalDetail = `Function "${event.functionName}" popped its stack frame at line ${event.line} with return value ${String(top?.returnValue ?? 'undefined')}.`;
      break;
    }
    case 'branch_decision': {
      const taken = event.metadata.taken === true;
      const liveCheck = describeConditionWithLiveValues(sourceLine, step.vars);
      whatIsHappeningNow = liveCheck
        ? `The program checks whether ${liveCheck}. The answer is ${taken ? 'yes (true)' : 'no (false)'}.`
        : `The program checks the condition on line ${event.line}. The answer is ${taken ? 'yes (true)' : 'no (false)'}.`;
      whatDoesThisMean = taken
        ? 'Because the check is true, the program steps into this section next.'
        : 'Because the check is false, the program skips this section and moves on.';
      technicalDetail = `Conditional branch at line ${event.line} evaluated its Boolean predicate to ${String(taken)}.`;
      break;
    }
    case 'loop_iteration': {
      const liveCheck = describeConditionWithLiveValues(sourceLine, step.vars);
      whatIsHappeningNow = liveCheck
        ? `The loop checks ${liveCheck} and starts another round.`
        : `The loop on line ${event.line} starts another round.`;
      whatDoesThisMean = 'The program repeats the same instructions for the next item or count.';
      technicalDetail = `Loop iteration entry observed at line ${event.line} within "${event.functionName}".`;
      break;
    }
    case 'array_swap': {
      const updated = event.changes.filter((c) => c.index !== undefined);
      if (updated.length >= 2) {
        const aVal = formatSimpleRef(updated[0].newValue, event.heap);
        const bVal = formatSimpleRef(updated[1].newValue, event.heap);
        whatIsHappeningNow = `The values ${bVal} and ${aVal} exchange places in the list.`;
      } else {
        whatIsHappeningNow = `Two items in the list exchange places on line ${event.line}.`;
      }
      whatDoesThisMean = 'Swapping puts these two items into a better order.';
      technicalDetail = `Inferred in-place array element swap at line ${event.line} affecting ${updated.map((u) => `${u.target}[${u.index}]`).join(' and ') || 'array slots'}.`;
      break;
    }
    case 'array_append': {
      const add = event.changes.find((c) => c.kind === 'create' && c.index !== undefined);
      whatIsHappeningNow = add
        ? `The program adds ${formatSimpleRef(add.newValue, event.heap)} to the end of "${add.target}".`
        : `A new item is added to the end of the list on line ${event.line}.`;
      whatDoesThisMean = 'The list now holds one more item at the back.';
      technicalDetail = `Array append operation increased collection length at line ${event.line}.`;
      break;
    }
    case 'array_remove': {
      const rem = event.changes.find((c) => c.kind === 'delete');
      whatIsHappeningNow = rem
        ? `The program removes ${formatSimpleRef(rem.oldValue, prevEvent?.heap || {})} from "${rem.target}".`
        : `An item is removed from the list on line ${event.line}.`;
      whatDoesThisMean = 'The list is now one item shorter.';
      technicalDetail = `Array removal operation deleted an element and updated length at line ${event.line}.`;
      break;
    }
    case 'tree_insert':
    case 'reference_update': {
      const refChange = event.changes.find((c) => c.property);
      whatIsHappeningNow = refChange
        ? `The arrow "${refChange.property}" on "${refChange.target}" now points to a different box.`
        : `An arrow connecting two boxes is updated on line ${event.line}.`;
      whatDoesThisMean = 'Updating this link changes how the boxes connect so the program can follow the new path.';
      technicalDetail = `Object pointer/reference field ${refChange ? `${refChange.target}.${refChange.property}` : 'link'} reassigned at line ${event.line}.`;
      break;
    }
    case 'graph_visit':
      whatIsHappeningNow = `The program marks a connected node as visited on line ${event.line}.`;
      whatDoesThisMean = 'Remembering visited nodes keeps the program from going around in circles.';
      technicalDetail = `Graph traversal recorded a newly visited vertex state at line ${event.line}.`;
      break;
    case 'console_output':
      whatIsHappeningNow = `The program writes ${formatValue(event.print)} to the Console Output.`;
      whatDoesThisMean = 'This shows the current answer or progress to the user without changing stored variables.';
      technicalDetail = `Standard output stream emitted ${formatValue(event.print)} at line ${event.line}.`;
      break;
    case 'error':
      whatIsHappeningNow = `The program stopped with a problem on line ${event.line}: ${String(event.metadata.error || event.explanation || 'an error happened')}.`;
      whatDoesThisMean = 'Execution could not continue past this line because of the error.';
      technicalDetail = `Runtime exception event recorded at line ${event.line}: ${String(event.metadata.error || event.explanation)}.`;
      break;
    default: {
      const firstChange = event.changes[0];
      if (firstChange && (firstChange.kind === 'create' || firstChange.kind === 'update') && !firstChange.property && firstChange.index === undefined) {
        const afterStr = formatSimpleRef(firstChange.newValue, event.heap);
        whatIsHappeningNow =
          firstChange.kind === 'create'
            ? `The program creates a box named "${firstChange.target}" and stores ${afterStr} inside it.`
            : `The box "${firstChange.target}" changes from ${formatSimpleRef(firstChange.oldValue, prevEvent?.heap || {})} to ${afterStr}.`;
        whatDoesThisMean = `Whenever the code reads "${firstChange.target}" next, it will get ${afterStr}.`;
        technicalDetail = `Variable binding "${firstChange.target}" ${firstChange.kind === 'create' ? 'initialized' : 'mutated'} at line ${event.line}.`;
      } else {
        whatIsHappeningNow = lessonForLine(sourceLine);
        whatDoesThisMean = 'This line updates the program state and prepares for the next step.';
      }
      break;
    }
  }

  // C. Why is this happening? (Only when genuinely supported by code/trace)
  let whyIsThisHappening = '';
  if (event.type === 'function_call') {
    const caller = event.callStack.length >= 2 ? event.callStack[event.callStack.length - 2].name : 'main';
    whyIsThisHappening = `${caller === 'main' ? 'The main program' : `"${caller}"`} called "${event.functionName}" to compute a piece of the work before moving on.`;
  } else if (event.type === 'function_return') {
    whyIsThisHappening = 'This function reached its return line or finished all of its steps.';
  } else if (event.type === 'branch_decision') {
    whyIsThisHappening = 'The code uses an if/else check here to choose which path matches the current values.';
  } else if (event.type === 'loop_iteration') {
    whyIsThisHappening = 'The loop has not finished yet, so it repeats its body for the next round.';
  } else if (event.type === 'array_swap') {
    whyIsThisHappening = 'The code decided these two neighbors were out of order and traded their spots.';
  } else if (event.type === 'tree_insert' || event.type === 'reference_update') {
    whyIsThisHappening = 'Linking these boxes lets the program move from one node to the next.';
  } else if (event.type === 'console_output') {
    whyIsThisHappening = 'This print line displays a value so you can see what the program calculated.';
  } else if (event.type === 'error') {
    whyIsThisHappening = 'The operation on this line could not succeed with the current values or input.';
  } else if (event.callStack.length > 1) {
    whyIsThisHappening = `Execution is currently running inside "${event.functionName}" at line ${event.line}.`;
  } else {
    whyIsThisHappening = `The program runs lines in order and just reached line ${event.line}.`;
  }

  // B. What changed? (before -> after strictly from verified changes / diff)
  const whatChanged: ExplanationChangeItem[] = [];
  const prevHeap = prevEvent?.heap || {};
  const currHeap = event.heap || {};

  for (const c of event.changes.slice(0, 6)) {
    if (c.kind === 'create' && c.index !== undefined) {
      whatChanged.push({
        label: `${c.target}[${c.index}]`,
        before: 'not there yet',
        after: formatSimpleRef(c.newValue, currHeap),
      });
    } else if (c.kind === 'delete' && c.index !== undefined) {
      whatChanged.push({
        label: `${c.target}[${c.index}]`,
        before: formatSimpleRef(c.oldValue, prevHeap),
        after: 'removed',
      });
    } else if (c.kind === 'update' && c.index !== undefined) {
      whatChanged.push({
        label: `${c.target}[${c.index}]`,
        before: formatSimpleRef(c.oldValue, prevHeap),
        after: formatSimpleRef(c.newValue, currHeap),
      });
    } else if (c.property) {
      whatChanged.push({
        label: `${c.target}.${c.property}`,
        before: c.kind === 'create' ? 'not set' : formatSimpleRef(c.oldValue, prevHeap),
        after: c.kind === 'delete' ? 'removed' : formatSimpleRef(c.newValue, currHeap),
      });
    } else if (c.kind === 'create') {
      whatChanged.push({
        label: c.target,
        before: 'not created yet',
        after: formatSimpleRef(c.newValue, currHeap),
      });
    } else if (c.kind === 'update') {
      whatChanged.push({
        label: c.target,
        before: formatSimpleRef(c.oldValue, prevHeap),
        after: formatSimpleRef(c.newValue, currHeap),
      });
    } else if (c.kind === 'output') {
      whatChanged.push({
        label: 'Console Output',
        before: prevStep?.outText ? 'previous output' : 'empty',
        after: `added ${formatValue(c.newValue)}`,
      });
    }
  }

  // Fallback diff on plain step.vars for AI-simulated steps that don't populate event.changes
  if (whatChanged.length === 0) {
    const prevVars = prevStep?.vars || {};
    for (const [k, v] of Object.entries(step.vars)) {
      const isNew = !(k in prevVars);
      if (isNew || JSON.stringify(v) !== JSON.stringify(prevVars[k])) {
        whatChanged.push({
          label: k,
          before: isNew ? 'not created yet' : formatValue(prevVars[k]),
          after: formatValue(v),
        });
      }
      if (whatChanged.length >= 4) break;
    }
    if (event.print && !whatChanged.some((x) => x.label === 'Console Output')) {
      whatChanged.push({
        label: 'Console Output',
        before: prevStep?.outText ? 'previous output' : 'empty',
        after: `printed ${formatValue(event.print)}`,
      });
    }
  }

  // Final result (only shown on the final step!)
  let finalResult: string | null = null;
  if (isFinalStep) {
    if (stoppedEarly || event.type === 'error') {
      finalResult = `Execution stopped early on line ${event.line}. Check the warning or console output for what completed before stopping.`;
    } else if (event.outText.trim()) {
      const preview = event.outText.trim().split('\n').slice(-3).join(' | ');
      finalResult = `Finished! Final console output: ${preview}`;
    } else {
      const varCount = Object.keys(step.vars).length;
      finalResult = `Finished! The program completed all steps with ${varCount} value${varCount === 1 ? '' : 's'} in memory.`;
    }
  }

  return {
    whatProgramDoes: programPurpose,
    whatIsHappeningNow,
    whyIsThisHappening,
    whatChanged,
    whatDoesThisMean,
    technicalDetail,
    finalResult,
  };
}

export interface ErrorHelpContext {
  category?: ErrorHelpReport['category'];
  code?: string;
  httpStatus?: number;
  technicalDetail?: string;
}

/**
 * Deterministic beginner-friendly error analyzer (instant fallback + baseline before optional Gemini help).
 * Strictly distinguishes internal app/API/AI/trace/renderer issues from actual user source-code errors.
 */
export function buildDeterministicErrorHelp(
  rawError: string,
  code: string,
  language: LanguageId,
  context?: ErrorHelpContext
): ErrorHelpReport {
  const msg = rawError.trim() || 'An error stopped the visualization.';
  const totalLines = Math.max(1, code.split('\n').length);

  const lineMatch =
    msg.match(/\bline\s+(\d+)/i) ||
    msg.match(/\((\d+):\d+\)/) ||
    msg.match(/:(\d+):\d+/);
  const parsedLine = lineMatch ? Number(lineMatch[1]) : null;
  const affectedLine =
    parsedLine && parsedLine >= 1 && parsedLine <= totalLines ? parsedLine : null;

  const lower = msg.toLowerCase();
  const hintCategory = context?.category;
  const technicalDetail =
    context?.technicalDetail ||
    [
      context?.code ? `Error code: ${context.code}` : '',
      context?.httpStatus ? `HTTP status: ${context.httpStatus}` : '',
      `Raw message: ${msg}`,
    ]
      .filter(Boolean)
      .join(' | ');

  // 1. Visualization renderer error (internal UI/canvas failure — never blame user code)
  if (hintCategory === 'renderer_error' || lower.includes('renderer failed') || lower.includes('visualization renderer')) {
    return {
      affectedLine: null,
      originalError: msg,
      category: 'renderer_error',
      categoryLabel: 'Visualization Renderer Error',
      isUserCodeError: false,
      technicalDetail,
      simpleExplanation:
        'The trace was generated, but the visualization canvas ran into an internal display error. This does not mean your code is wrong.',
      possibleSolution:
        'Your source code is preserved. Click Back to Editor or Re-run Program, or try switching to a simpler view.',
    };
  }

  // 2. Backend connection / network failure
  if (
    hintCategory === 'backend_connection_error' ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network error') ||
    lower.includes('econnrefused') ||
    lower.includes('could not reach the backend')
  ) {
    return {
      affectedLine: null,
      originalError: msg,
      category: 'backend_connection_error',
      categoryLabel: 'Backend Connection Error',
      isUserCodeError: false,
      technicalDetail,
      simpleExplanation:
        'The app could not connect to the Code Anim server. This is a connection issue and does not mean your code is wrong.',
      possibleSolution:
        'Check your internet connection or refresh the app preview, then press Visualize again.',
    };
  }

  // 3. API response error (HTML instead of JSON, malformed JSON, empty body, HTTP 200 non-JSON, 404/405 route)
  if (
    hintCategory === 'api_response_error' ||
    lower.includes('invalid response') ||
    lower.includes('returned html') ||
    lower.includes('empty response') ||
    lower.includes('unexpected token <') ||
    lower.includes('not valid json') ||
    lower.includes('method not allowed') ||
    lower.includes('api endpoint')
  ) {
    return {
      affectedLine: null,
      originalError: msg,
      category: 'api_response_error',
      categoryLabel: 'API Response Error',
      isUserCodeError: false,
      technicalDetail,
      simpleExplanation:
        'The app received a response from the server that it could not understand. This does not necessarily mean your code is wrong.',
      possibleSolution:
        'Retry Visualize in a moment. If the problem continues, refresh the preview so the backend API reconnects cleanly.',
    };
  }

  // 4. AI service error (503 high demand, 429 quota, missing/invalid API key, permission denied)
  if (
    hintCategory !== 'timeout' &&
    !lower.includes('timed out') &&
    (hintCategory === 'ai_service_error' ||
      lower.includes('high demand') ||
      lower.includes('http 503') ||
      lower.includes('service unavailable') ||
      lower.includes('quota') ||
      lower.includes('resource_exhausted') ||
      lower.includes('http 429') ||
      lower.includes('api key') ||
      lower.includes('permission_denied') ||
      lower.includes('gemini'))
  ) {
    const isQuota = lower.includes('429') || lower.includes('quota') || lower.includes('resource_exhausted');
    const isConfig = lower.includes('api key') || lower.includes('permission_denied') || lower.includes('403') || lower.includes('401');
    return {
      affectedLine: null,
      originalError: msg,
      category: 'ai_service_error',
      categoryLabel: 'AI Service Error',
      isUserCodeError: false,
      technicalDetail,
      simpleExplanation: isQuota
        ? 'The AI simulation service temporarily reached its usage quota limit. This is a service limit and does not mean your code is wrong.'
        : isConfig
          ? 'The server AI service key is missing or does not have permission right now. This is a server configuration issue, not a bug in your code.'
          : 'The AI simulation service is temporarily busy or unavailable. This does not mean your code is wrong.',
      possibleSolution: isConfig
        ? 'Contact the site administrator to configure the server AI service, or run JavaScript, TypeScript, Python, Java, C, or C++ for instant live execution.'
        : 'Wait a few seconds and click Re-run Program, or switch to JavaScript, TypeScript, Python, Java, C, or C++ for instant live execution.',
    };
  }

  // 5. Invalid trace schema / missing steps / bad object references
  if (
    hintCategory === 'invalid_trace_error' ||
    lower.includes('trace document') ||
    lower.includes('trace payload') ||
    lower.includes('invalid object reference') ||
    lower.includes('missing trace steps') ||
    lower.includes('malformed json trace') ||
    lower.includes('no executable trace events')
  ) {
    return {
      affectedLine: null,
      originalError: msg,
      category: 'invalid_trace_error',
      categoryLabel: 'Invalid Trace Error',
      isUserCodeError: false,
      technicalDetail,
      simpleExplanation:
        'The trace data returned for this program was incomplete or did not match the expected format. This does not necessarily mean your code is wrong.',
      possibleSolution:
        'Try clicking Re-run Program. If the code is very long, try testing a smaller section first.',
    };
  }

  // 6. Execution / request timeout
  if (
    hintCategory === 'timeout' ||
    lower.includes('timed out') ||
    (lower.includes('exceeded') && (lower.includes('second') || lower.includes('timeout')))
  ) {
    const isAiTimeout = lower.includes('gemini') || lower.includes('request timed out');
    return {
      affectedLine: isAiTimeout ? null : affectedLine,
      originalError: msg,
      category: 'timeout',
      categoryLabel: 'Execution Timeout',
      isUserCodeError: !isAiTimeout,
      technicalDetail,
      simpleExplanation: isAiTimeout
        ? 'The server took too long to respond while building the visualization. This does not necessarily mean your code is wrong.'
        : 'The program took too long to finish, so it was stopped automatically to keep the app responsive.',
      possibleSolution: isAiTimeout
        ? 'Try pressing Re-run Program again in a moment.'
        : 'Use a smaller input size or check for a loop or recursion that repeats too many times.',
    };
  }

  // 7. Missing Program Input
  if (
    hintCategory === 'missing_input' ||
    lower.includes('eoferror') ||
    lower.includes('inputerror') ||
    lower.includes('program input')
  ) {
    return {
      affectedLine,
      originalError: msg,
      category: 'missing_input',
      categoryLabel: 'Missing Program Input',
      isUserCodeError: false,
      technicalDetail,
      simpleExplanation:
        'Your program tried to read user input, but the Program Input box had no more lines left.',
      possibleSolution:
        'Open the Program Input drawer at the bottom, type each input value on its own line, and press Visualize again.',
    };
  }

  // 8. Unsupported language / disabled AI simulation
  if (
    hintCategory === 'unsupported' ||
    lower.includes('not available') ||
    lower.includes('unsupported') ||
    lower.includes('ai simulation is disabled')
  ) {
    return {
      affectedLine: null,
      originalError: msg,
      category: 'unsupported',
      categoryLabel: 'Unsupported Language or Feature',
      isUserCodeError: false,
      technicalDetail,
      simpleExplanation:
        lower.includes('ai simulation is disabled')
          ? 'This language uses AI Simulation, which is currently turned off in your Settings.'
          : 'This language or feature is recognized, but visualization is not available for it yet.',
      possibleSolution:
        lower.includes('ai simulation is disabled')
          ? 'Open Settings and enable AI Simulation, or switch to JavaScript, TypeScript, or Python.'
          : 'Switch to JavaScript, TypeScript, Python, Java, C, or C++.',
    };
  }

  // 9. Empty source code
  if (hintCategory === 'user_code_error' || lower.includes('source code is empty')) {
    return {
      affectedLine: null,
      originalError: msg,
      category: 'user_code_error',
      categoryLabel: 'User Code Error',
      isUserCodeError: true,
      technicalDetail,
      simpleExplanation: 'There is no code in the editor to visualize yet.',
      possibleSolution: 'Type, paste, or upload a program in the Code Editor, or pick an example from Learn.',
    };
  }

  if (lower.includes('step limit') || lower.includes('infinite loop')) {
    return {
      affectedLine,
      originalError: msg,
      category: 'infinite_loop',
      categoryLabel: 'Infinite Loop Guard',
      isUserCodeError: true,
      technicalDetail,
      simpleExplanation:
        'The program ran too many steps without finishing, which usually means a loop never stops.',
      possibleSolution:
        'Check your while or for loop condition and make sure the loop variable changes each round so the loop can end.',
    };
  }

  if (lower.includes('maximum call stack') || lower.includes('recursionerror')) {
    return {
      affectedLine,
      originalError: msg,
      category: 'stack_overflow',
      categoryLabel: 'Runtime Error (Stack Overflow)',
      isUserCodeError: true,
      technicalDetail,
      simpleExplanation:
        'A function called itself too many times without stopping (stack overflow).',
      possibleSolution:
        'Add or fix the stopping condition (base case) at the start of your recursive function so it stops calling itself.',
    };
  }

  if (lower.includes('zerodivisionerror') || lower.includes('division by zero')) {
    return {
      affectedLine,
      originalError: msg,
      category: 'division_by_zero',
      categoryLabel: 'Runtime Error (Division by Zero)',
      isUserCodeError: true,
      technicalDetail,
      simpleExplanation: 'The program tried to divide a number by 0, which is not allowed in math or code.',
      possibleSolution:
        'Check that the number you divide by is not 0 before dividing (for example, add an if check).',
    };
  }

  if (lower.includes('indexerror') || lower.includes('out of range') || lower.includes('out of bounds')) {
    return {
      affectedLine,
      originalError: msg,
      category: 'index',
      categoryLabel: 'Runtime Error (Index Out of Bounds)',
      isUserCodeError: true,
      technicalDetail,
      simpleExplanation:
        'The program tried to look up a position in a list that does not exist (past the start or end of the list).',
      possibleSolution:
        'Remember that list positions start at 0 and end at length - 1. Check your loop limits.',
    };
  }

  if (
    lower.includes('referenceerror') ||
    lower.includes('nameerror') ||
    lower.includes('is not defined')
  ) {
    return {
      affectedLine,
      originalError: msg,
      category: 'undefined',
      categoryLabel: 'User Code Error (Undefined Name)',
      isUserCodeError: true,
      technicalDetail,
      simpleExplanation:
        'The program used a variable or function name that has not been created yet (or has a spelling mistake).',
      possibleSolution:
        'Check the spelling and capitalization of the name, and make sure you create it before using it.',
    };
  }

  if (lower.includes('typeerror')) {
    return {
      affectedLine,
      originalError: msg,
      category: 'type',
      categoryLabel: 'Runtime Error (Type Mismatch)',
      isUserCodeError: true,
      technicalDetail,
      simpleExplanation:
        'The program tried to do an action on the wrong kind of value (for example, calling something that is not a function or reading from empty/null).',
      possibleSolution:
        'Check what kind of value the variable holds on that line (number, text, list, or empty/null) before using it.',
    };
  }

  if (lower.includes('importerror') || lower.includes('modulenotfounderror') || lower.includes('blocked')) {
    return {
      affectedLine,
      originalError: msg,
      category: 'import',
      categoryLabel: 'Sandbox Safety Restriction',
      isUserCodeError: true,
      technicalDetail,
      simpleExplanation:
        'This program tried to use a module or system action (like writing files or connecting to the internet) that is blocked for safety.',
      possibleSolution:
        'Remove restricted file/network calls or stick to standard algorithm modules (like math, collections, heapq, random).',
    };
  }

  if (
    hintCategory === 'compiler_error' ||
    hintCategory === 'syntax' ||
    lower.includes('syntaxerror') ||
    lower.includes('indentationerror') ||
    lower.includes('unexpected token') ||
    lower.includes('unterminated') ||
    lower.includes('compilation error') ||
    lower.includes('compiler error') ||
    lower.includes('expected')
  ) {
    return {
      affectedLine,
      originalError: msg,
      category: hintCategory === 'compiler_error' ? 'compiler_error' : 'syntax',
      categoryLabel: hintCategory === 'compiler_error' ? 'Compiler Error' : 'Syntax Error',
      isUserCodeError: true,
      technicalDetail,
      simpleExplanation:
        language === 'py'
          ? 'There is a grammar or spacing mistake in the Python code, such as a missing colon (:), bracket, quote, or uneven indentation.'
          : 'There is a syntax or compiler mistake in the code, such as a missing bracket, parenthesis, quote, type, or semicolon.',
      possibleSolution:
        'Look closely at the highlighted line and the line right above it for unclosed (), {}, [], quotes, or missing semicolons.',
    };
  }

  return {
    affectedLine,
    originalError: msg,
    category: 'runtime_error',
    categoryLabel: 'Runtime Error',
    isUserCodeError: true,
    technicalDetail,
    simpleExplanation: 'The program encountered an error while executing this line, so it had to stop.',
    possibleSolution:
      'Inspect the highlighted line and check the variable values right before that step.',
  };
}

export interface CodeExample {
  id: string;
  label: string;
  lang: LanguageId;
  code: string;
  sampleInput?: string;
}

export const STARTER_EXAMPLES: CodeExample[] = [
  {
    id: 'js-vars',
    label: 'JS Variables & Loop',
    lang: 'js',
    code: `let age = 18;
age = age + 1;
const name = "Asha";
let total = 0;
for (let i = 1; i <= 3; i++) {
  total = total + i;
}
console.log(name, "age:", age, "sum:", total);`,
  },
  {
    id: 'ts-dp',
    label: 'TypeScript DP Coins',
    lang: 'ts',
    code: `const coins: number[] = [1, 3, 4];
const target: number = 6;
const dp: number[] = Array(target + 1).fill(99);
dp[0] = 0;
for (let amount: number = 1; amount <= target; amount++) {
  for (const coin of coins) {
    if (amount >= coin && dp[amount - coin] + 1 < dp[amount]) {
      dp[amount] = dp[amount - coin] + 1;
    }
  }
}
console.log("Min coins for 6:", dp[target]);`,
  },
  {
    id: 'js-tree',
    label: 'JS Binary Search Tree',
    lang: 'js',
    code: `class Node {
  constructor(value, left = null, right = null) {
    this.value = value;
    this.left = left;
    this.right = right;
  }
}

const root = new Node(10);
root.left = new Node(5);
root.right = new Node(15);
root.left.left = new Node(2);
root.left.right = new Node(7);
console.log("Tree root:", root.value);`,
  },
  {
    id: 'js-graph',
    label: 'JS Graph BFS (Multi-Structure)',
    lang: 'js',
    code: `const graph = {
  A: ["B", "C"],
  B: ["D"],
  C: ["D"],
  D: []
};
const visited = new Set(["A"]);
const queue = ["A"];
while (queue.length > 0) {
  const node = queue.shift();
  console.log("Visit:", node);
  for (const next of graph[node]) {
    if (!visited.has(next)) {
      visited.add(next);
      queue.push(next);
    }
  }
}`,
  },
  {
    id: 'py-input-sort',
    label: 'Python Input & Sort',
    lang: 'py',
    sampleInput: '8 3 9 1 5',
    code: `raw = input()
nums = [int(x) for x in raw.split()]
for i in range(len(nums)):
    for j in range(0, len(nums) - i - 1):
        if nums[j] > nums[j + 1]:
            nums[j], nums[j + 1] = nums[j + 1], nums[j]
print("Sorted:", nums)`,
  },
  {
    id: 'py-tree',
    label: 'Python Binary Tree',
    lang: 'py',
    code: `class TreeNode:
    def __init__(self, value, left=None, right=None):
        self.value = value
        self.left = left
        self.right = right

root = TreeNode(20)
root.left = TreeNode(10)
root.right = TreeNode(30)
root.left.left = TreeNode(5)
print("Root:", root.value)`,
  },
];
