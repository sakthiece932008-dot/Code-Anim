import {
  isObjectRef,
  projectEventToStep,
  type EventProvenance,
  type HeapObject,
  type LanguageAdapterMeta,
  type LanguageId,
  type StackFrame,
  type StateChange,
  type TraceDocument,
  type TraceEvent,
  type TraceEventType,
  type TraceStep,
  type ValueRef,
} from '../types/trace';
import { instrumentJavaScriptAst } from './jsAstInstrumenter';

export const JS_MAX_EVENTS = 1500;
export const JS_MAX_OUT_CHARS = 64_000;

export const JS_ADAPTER_META: LanguageAdapterMeta = {
  id: 'js-ast-worker',
  language: 'js',
  label: 'JavaScript / Node.js',
  executionMode: 'real',
  runtimeAvailable: true,
  executionMethod: 'Acorn AST instrumentation in an isolated Web Worker',
  capabilities: {
    primitives: true,
    arrays: true,
    linkedStructures: true,
    trees: true,
    graphs: true,
    callStack: true,
    loopsAndBranches: true,
    objectIdentity: true,
    cancellation: true,
  },
  limitations: [
    'Runs synchronous JavaScript up to 1,500 trace events and a 5-second worker timeout.',
    'Async/await timers, DOM APIs, ES module imports, and network requests are blocked inside the isolated worker.',
  ],
};

function formatConsoleArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (typeof arg === 'object' && arg !== null) {
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
}

function summarizeVal(val: unknown): string {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'string') return `"${val}"`;
  if (isObjectRef(val)) return val.__ref;
  return String(val);
}

function shallowEqualValueRef(a: ValueRef | undefined, b: ValueRef | undefined): boolean {
  if (a === b) return true;
  if (isObjectRef(a) && isObjectRef(b)) return a.__ref === b.__ref;
  return false;
}

function arraysEqual(a: ValueRef[], b: ValueRef[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!shallowEqualValueRef(a[i], b[i])) return false;
  }
  return true;
}

export interface JsTraceOptions {
  stdin?: string;
  args?: string[];
  language?: LanguageId;
  adapterMeta?: LanguageAdapterMeta;
  originalLineCount?: number;
}

export interface JsTraceDocumentOutcome {
  document: TraceDocument | null;
  steps: TraceStep[];
  error?: string;
}

export function traceJavaScriptDocument(
  source: string,
  options?: JsTraceOptions
): JsTraceDocumentOutcome {
  if (!source.trim()) {
    return {
      document: null,
      steps: [],
      error: 'Source code is empty. Paste or upload code first.',
    };
  }

  // 1. Parse and instrument with Acorn AST
  const inst = instrumentJavaScriptAst(source);
  if (!inst.astValid) {
    return {
      document: null,
      steps: [],
      error: inst.error || 'SyntaxError: Could not parse code.',
    };
  }

  let runner: Function;
  try {
    // eslint-disable-next-line no-new-func
    runner = new Function(
      '__ca',
      'console',
      'input',
      'readLine',
      'readline',
      'prompt',
      'readAllInput',
      'programArgs',
      inst.code
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      document: null,
      steps: [],
      error: `Instrumentation compile error: ${msg}`,
    };
  }

  // 2. Runtime execution state with WeakMap-backed persistent object identities
  const objectIds = new WeakMap<object, string>();
  let nextObjSeq = 0;
  const getObjectId = (obj: object): string => {
    let id = objectIds.get(obj);
    if (!id) {
      id = `obj_${++nextObjSeq}`;
      objectIds.set(obj, id);
    }
    return id;
  };

  const maxSourceLine = Math.max(1, options?.originalLineCount ?? source.split('\n').length);
  const clampLine = (l: number) => Math.min(Math.max(1, Math.floor(l || 1)), maxSourceLine);

  const serializeToHeap = (
    value: unknown,
    heap: Record<string, HeapObject>,
    depth = 0
  ): ValueRef => {
    if (value === null || value === undefined) return null;
    const t = typeof value;
    if (t === 'boolean' || t === 'string') return value as string | boolean;
    if (t === 'number') return Number.isFinite(value as number) ? (value as number) : String(value);
    if (t === 'bigint') return Number(value);
    if (t === 'function' || t === 'symbol') return '(fn)';
    if (depth > 8) return '…';

    const obj = value as object;
    const oid = getObjectId(obj);
    if (heap[oid]) {
      return { __ref: oid };
    }

    if (Array.isArray(obj)) {
      const hasComplexItems = obj.slice(0, 8).some((x) => typeof x === 'object' && x !== null);
      const cap = hasComplexItems ? 64 : 1024;
      const limit = Math.min(obj.length, cap);
      const entry: HeapObject = {
        id: oid,
        kind: 'array',
        elements: [],
        totalLength: obj.length,
        truncated: obj.length > limit ? true : undefined,
      };
      heap[oid] = entry;
      entry.elements = obj.slice(0, limit).map((el) => serializeToHeap(el, heap, depth + 1));
      return { __ref: oid };
    }

    if (obj instanceof Set) {
      const arr = [...obj];
      const limit = Math.min(arr.length, 256);
      const entry: HeapObject = {
        id: oid,
        kind: 'set',
        className: 'Set',
        elements: [],
        totalLength: arr.length,
        truncated: arr.length > limit ? true : undefined,
      };
      heap[oid] = entry;
      entry.elements = arr.slice(0, limit).map((el) => serializeToHeap(el, heap, depth + 1));
      return { __ref: oid };
    }

    if (obj instanceof Map) {
      const entry: HeapObject = {
        id: oid,
        kind: 'map',
        className: 'Map',
        entries: {},
        totalLength: obj.size,
        truncated: obj.size > 64 ? true : undefined,
      };
      heap[oid] = entry;
      let count = 0;
      for (const [k, v] of obj.entries()) {
        if (count++ >= 64) break;
        entry.entries![String(k)] = serializeToHeap(v, heap, depth + 1);
      }
      return { __ref: oid };
    }

    const record = obj as Record<string, unknown>;
    const ctor = (record as { constructor?: { name?: string } }).constructor?.name;
    const keys = Object.keys(record);
    const entry: HeapObject = {
      id: oid,
      kind: 'object',
      className: ctor && ctor !== 'Object' ? ctor : undefined,
      entries: {},
      truncated: keys.length > 64 ? true : undefined,
    };
    heap[oid] = entry;
    for (const key of keys.slice(0, 64)) {
      const val = record[key];
      if (typeof val === 'function') continue;
      entry.entries![key] = serializeToHeap(val, heap, depth + 1);
    }
    return { __ref: oid };
  };

  const isNullOrObjectRef = (v: ValueRef | undefined, heap: Record<string, HeapObject>): boolean =>
    v === null || (isObjectRef(v) && heap[v.__ref]?.kind === 'object');

  const isNodeLikeEntries = (
    entries: Record<string, ValueRef>,
    heap: Record<string, HeapObject>
  ): boolean => {
    const hasTreePtrs = 'left' in entries || 'right' in entries;
    if (hasTreePtrs) {
      if ('top' in entries && 'bottom' in entries) return false;
      const leftOk = !('left' in entries) || isNullOrObjectRef(entries.left, heap);
      const rightOk = !('right' in entries) || isNullOrObjectRef(entries.right, heap);
      return leftOk && rightOk;
    }
    if ('next' in entries || 'prev' in entries) {
      const nextOk = !('next' in entries) || isNullOrObjectRef(entries.next, heap);
      const prevOk = !('prev' in entries) || isNullOrObjectRef(entries.prev, heap);
      return nextOk && prevOk;
    }
    return false;
  };

  const events: TraceEvent[] = [];
  const logs: string[] = [];
  let totalLogChars = 0;
  let lastFlushedLogs = 0;

  let prevLocals: Record<string, ValueRef> = {};
  let prevHeap: Record<string, HeapObject> = {};
  let lastThrownErrorObj: unknown = null;
  let lastActiveThunk: () => Record<string, unknown> = () => ({});

  let frameCounter = 0;
  interface InternalFrame {
    frameId: string;
    name: string;
    line: number;
    callLine?: number;
    args?: Record<string, unknown>;
    returned: boolean;
  }

  const stack: InternalFrame[] = [
    { frameId: 'frame-0', name: 'main', line: 1, returned: false },
  ];

  const snapshotCallStack = (
    localsCount: number,
    returnValue?: unknown,
    isReturn = false
  ): StackFrame[] => {
    return stack.map((f, idx) => ({
      frameId: f.frameId,
      name: f.name,
      line: clampLine(f.line),
      callLine: f.callLine ? clampLine(f.callLine) : undefined,
      args: f.args,
      localsCount: idx === stack.length - 1 ? localsCount : 0,
      returnValue: idx === stack.length - 1 && isReturn ? returnValue : undefined,
    }));
  };

  const captureScope = (
    thunk: () => Record<string, unknown>
  ): { locals: Record<string, ValueRef>; heap: Record<string, HeapObject> } => {
    let raw: Record<string, unknown> = {};
    try {
      raw = thunk();
    } catch {
      raw = {};
    }
    const heap: Record<string, HeapObject> = {};
    const locals: Record<string, ValueRef> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'function') continue;
      locals[k] = serializeToHeap(v, heap);
    }
    return { locals, heap };
  };

  const diffAndClassify = (
    locals: Record<string, ValueRef>,
    heap: Record<string, HeapObject>,
    baseType: TraceEventType,
    newOutput: string
  ): {
    type: TraceEventType;
    provenance: EventProvenance;
    changes: StateChange[];
    explanation: string;
    extraMetadata: Record<string, unknown>;
  } => {
    const changes: StateChange[] = [];
    let type: TraceEventType = baseType;
    let provenance: EventProvenance = 'observed';
    const notes: string[] = [];
    const extraMetadata: Record<string, unknown> = {};

    // 1. Variable binding diffs
    for (const [k, ref] of Object.entries(locals)) {
      if (!(k in prevLocals)) {
        changes.push({ target: k, kind: 'create', newValue: ref });
        if (isObjectRef(ref)) {
          const obj = heap[ref.__ref];
          if (obj?.kind === 'array') {
            if (baseType === 'var_declare' || baseType === 'statement') type = 'array_create';
            notes.push(`Created array ${k} (${obj.totalLength ?? obj.elements?.length ?? 0} items)`);
          } else if (obj?.kind === 'object') {
            const entries = obj.entries || {};
            const isNodeLike = isNodeLikeEntries(entries, heap);
            if (baseType === 'var_declare' || baseType === 'statement') {
              type = isNodeLike ? 'node_create' : 'object_create';
              if (isNodeLike) provenance = 'inferred';
            }
            notes.push(`Created ${obj.className || 'object'} ${k} (${ref.__ref})`);
          }
        } else {
          if (baseType === 'statement') type = 'var_declare';
          notes.push(`Set ${k} = ${summarizeVal(ref)}`);
        }
      } else if (!shallowEqualValueRef(prevLocals[k], ref)) {
        changes.push({ target: k, kind: 'update', oldValue: prevLocals[k], newValue: ref });
        if (baseType === 'statement' || baseType === 'var_declare') {
          type = 'var_assign';
        }
        notes.push(`Updated ${k} from ${summarizeVal(prevLocals[k])} to ${summarizeVal(ref)}`);
      }
    }

    // Map objectId -> friendly variable name for clear explanations
    const ownerName = new Map<string, string>();
    for (const [k, ref] of Object.entries(locals)) {
      if (isObjectRef(ref) && !ownerName.has(ref.__ref)) {
        ownerName.set(ref.__ref, k);
      }
    }

    // 2. Heap object diffs (arrays, sets, objects/references)
    for (const [oid, obj] of Object.entries(heap)) {
      const prevObj = prevHeap[oid];
      if (!prevObj) continue;
      const label = ownerName.get(oid) || oid;

      if (obj.kind === 'array' && prevObj.kind === 'array') {
        const oldEls = prevObj.elements || [];
        const newEls = obj.elements || [];
        if (!arraysEqual(oldEls, newEls)) {
          if (newEls.length === oldEls.length + 1 && arraysEqual(oldEls, newEls.slice(0, -1))) {
            const idx = newEls.length - 1;
            changes.push({ target: label, objectId: oid, kind: 'create', index: idx, newValue: newEls[idx] });
            type = 'array_append';
            extraMetadata.arrayOp = 'push';
            notes.push(`Appended ${summarizeVal(newEls[idx])} to ${label} at index ${idx}`);
          } else if (newEls.length === oldEls.length - 1 && arraysEqual(oldEls.slice(0, -1), newEls)) {
            const idx = oldEls.length - 1;
            changes.push({ target: label, objectId: oid, kind: 'delete', index: idx, oldValue: oldEls[idx] });
            type = 'array_remove';
            extraMetadata.arrayOp = 'pop';
            notes.push(`Popped ${summarizeVal(oldEls[idx])} from end of ${label}`);
          } else if (newEls.length === oldEls.length - 1 && arraysEqual(oldEls.slice(1), newEls)) {
            changes.push({ target: label, objectId: oid, kind: 'delete', index: 0, oldValue: oldEls[0] });
            type = 'array_remove';
            extraMetadata.arrayOp = 'shift';
            notes.push(`Dequeued ${summarizeVal(oldEls[0])} from front of ${label}`);
          } else if (newEls.length === oldEls.length + 1 && arraysEqual(oldEls, newEls.slice(1))) {
            changes.push({ target: label, objectId: oid, kind: 'create', index: 0, newValue: newEls[0] });
            type = 'array_insert';
            extraMetadata.arrayOp = 'unshift';
            notes.push(`Inserted ${summarizeVal(newEls[0])} at front of ${label}`);
          } else if (newEls.length > oldEls.length) {
            changes.push({ target: label, objectId: oid, kind: 'create', oldValue: oldEls.length, newValue: newEls.length });
            type = 'array_insert';
            provenance = 'inferred';
            notes.push(`Inserted item(s) into ${label} (length ${oldEls.length} → ${newEls.length})`);
          } else if (newEls.length < oldEls.length) {
            changes.push({ target: label, objectId: oid, kind: 'delete', oldValue: oldEls.length, newValue: newEls.length });
            type = 'array_remove';
            provenance = 'inferred';
            notes.push(`Removed item(s) from ${label} (length ${oldEls.length} → ${newEls.length})`);
          } else {
            const diffs: number[] = [];
            for (let i = 0; i < newEls.length; i++) {
              if (!shallowEqualValueRef(oldEls[i], newEls[i])) diffs.push(i);
            }
            if (
              diffs.length === 2 &&
              shallowEqualValueRef(oldEls[diffs[0]], newEls[diffs[1]]) &&
              shallowEqualValueRef(oldEls[diffs[1]], newEls[diffs[0]])
            ) {
              changes.push({
                target: label,
                objectId: oid,
                kind: 'update',
                index: diffs[0],
                oldValue: oldEls[diffs[0]],
                newValue: newEls[diffs[0]],
              });
              changes.push({
                target: label,
                objectId: oid,
                kind: 'update',
                index: diffs[1],
                oldValue: oldEls[diffs[1]],
                newValue: newEls[diffs[1]],
              });
              type = 'array_swap';
              provenance = 'inferred';
              notes.push(`Swapped ${label}[${diffs[0]}] and ${label}[${diffs[1]}]`);
            } else {
              for (const idx of diffs.slice(0, 6)) {
                changes.push({
                  target: label,
                  objectId: oid,
                  kind: 'update',
                  index: idx,
                  oldValue: oldEls[idx],
                  newValue: newEls[idx],
                });
              }
              type = 'array_update';
              if (diffs.length === 1) {
                const i = diffs[0];
                notes.push(`Updated ${label}[${i}] from ${summarizeVal(oldEls[i])} to ${summarizeVal(newEls[i])}`);
              } else {
                notes.push(`Reordered/updated ${diffs.length} elements in ${label}`);
              }
            }
          }
        }
      } else if (obj.kind === 'set' && prevObj.kind === 'set') {
        const oldEls = prevObj.elements || [];
        const newEls = obj.elements || [];
        if (newEls.length > oldEls.length) {
          const added = newEls[newEls.length - 1];
          changes.push({ target: label, objectId: oid, kind: 'create', newValue: added });
          if (/visit|seen/i.test(label)) {
            type = 'graph_visit';
            provenance = 'inferred';
            notes.push(`Marked ${summarizeVal(added)} as visited in ${label}`);
          } else {
            type = 'property_set';
            notes.push(`Added ${summarizeVal(added)} to set ${label}`);
          }
        }
      } else if (
        (obj.kind === 'object' || obj.kind === 'map') &&
        (prevObj.kind === 'object' || prevObj.kind === 'map')
      ) {
        const oldEnt = prevObj.entries || {};
        const newEnt = obj.entries || {};
        for (const [prop, val] of Object.entries(newEnt)) {
          if (!(prop in oldEnt) || !shallowEqualValueRef(oldEnt[prop], val)) {
            const oldVal = oldEnt[prop];
            changes.push({
              target: label,
              objectId: oid,
              property: prop,
              kind: prop in oldEnt ? 'update' : 'create',
              oldValue: oldVal,
              newValue: val,
            });
            const isPtrValue =
              isNullOrObjectRef(val, heap) &&
              (oldVal === undefined || isNullOrObjectRef(oldVal, prevHeap));
            if ((prop === 'left' || prop === 'right') && isPtrValue) {
              type = val === null ? 'tree_delete' : 'tree_insert';
              provenance = 'inferred';
              notes.push(`Linked ${label}.${prop} = ${summarizeVal(val)}`);
            } else if ((prop === 'next' || prop === 'prev') && isPtrValue) {
              type = 'reference_update';
              notes.push(`Updated pointer ${label}.${prop} = ${summarizeVal(val)}`);
            } else {
              type = 'property_set';
              notes.push(`Set ${label}.${prop} = ${summarizeVal(val)}`);
            }
          }
        }
        for (const prop of Object.keys(oldEnt)) {
          if (!(prop in newEnt)) {
            changes.push({
              target: label,
              objectId: oid,
              property: prop,
              kind: 'delete',
              oldValue: oldEnt[prop],
            });
            type = 'property_delete';
            notes.push(`Deleted ${label}.${prop}`);
          }
        }
      }
    }

    // 3. Detect objects that became unreachable (lost all references) vs explicit property_delete
    const unreachableObjectIds: string[] = [];
    for (const prevOid of Object.keys(prevHeap)) {
      if (!(prevOid in heap)) {
        unreachableObjectIds.push(prevOid);
      }
    }
    if (unreachableObjectIds.length > 0) {
      extraMetadata.unreachableObjectIds = unreachableObjectIds;
    }

    if (newOutput && changes.length === 0 && (baseType === 'statement' || baseType === 'console_output')) {
      type = 'console_output';
      changes.push({ target: 'console', kind: 'output', newValue: newOutput });
      notes.push(`Printed ${JSON.stringify(newOutput)} to console`);
    }

    return {
      type,
      provenance,
      changes,
      explanation: notes.slice(0, 2).join('. '),
      extraMetadata,
    };
  };

  const pushEvent = (params: {
    line: number;
    column?: number;
    baseType: TraceEventType;
    thunk: () => Record<string, unknown>;
    provenanceOverride?: EventProvenance;
    explicitChanges?: StateChange[];
    explicitExplanation?: string;
    metadata?: Record<string, unknown>;
    returnValue?: unknown;
    isReturn?: boolean;
    allowOverflowForTerminalError?: boolean;
  }) => {
    if (!params.allowOverflowForTerminalError && events.length >= JS_MAX_EVENTS - 1) {
      throw new Error(`Step limit (${JS_MAX_EVENTS}) reached (possible infinite loop).`);
    }

    lastActiveThunk = params.thunk;
    const cleanLine = clampLine(params.line);
    const activeFrame = stack[stack.length - 1];
    activeFrame.line = cleanLine;

    const { locals, heap } = captureScope(params.thunk);
    const newLogSlice = logs.slice(lastFlushedLogs);
    lastFlushedLogs = logs.length;
    const print = newLogSlice.join('\n');
    const outText = logs.length ? logs.join('\n') + '\n' : '';

    const diff = diffAndClassify(locals, heap, params.baseType, print);
    const seq = events.length + 1;
    const finalType =
      params.baseType === 'function_call' ||
      params.baseType === 'function_return' ||
      params.baseType === 'loop_iteration' ||
      params.baseType === 'branch_decision' ||
      params.baseType === 'error'
        ? params.baseType
        : diff.type;

    const combinedChanges = [
      ...(params.explicitChanges || []),
      ...diff.changes,
    ];

    events.push({
      id: `event-${String(seq).padStart(3, '0')}`,
      sequence: seq,
      line: cleanLine,
      column: params.column,
      type: finalType,
      provenance: params.provenanceOverride ?? diff.provenance,
      scope: activeFrame.name,
      functionName: activeFrame.name,
      changes: combinedChanges,
      objectIds: Object.keys(heap),
      heap,
      locals,
      callStack: snapshotCallStack(
        Object.keys(locals).length,
        params.returnValue,
        Boolean(params.isReturn)
      ),
      print,
      outText,
      explanation: params.explicitExplanation || diff.explanation,
      metadata: { ...diff.extraMetadata, ...(params.metadata || {}) },
      scene: null,
    });

    prevLocals = { ...locals };
    prevHeap = heap;
  };

  const mockConsole = {
    log: (...args: unknown[]) => {
      const line = args.map(formatConsoleArg).join(' ');
      totalLogChars += line.length + 1;
      if (totalLogChars > JS_MAX_OUT_CHARS) {
        throw new Error(`Console output limit (${JS_MAX_OUT_CHARS} chars) reached.`);
      }
      logs.push(line);
    },
    warn: (...args: unknown[]) => mockConsole.log(...args),
    error: (...args: unknown[]) => mockConsole.log(...args),
    info: (...args: unknown[]) => mockConsole.log(...args),
  };

  const __ca = {
    stmt(line: number, col: number, kind: TraceEventType, thunk: () => Record<string, unknown>) {
      pushEvent({ line, column: col, baseType: kind, thunk });
    },
    loop(line: number, col: number, thunk: () => Record<string, unknown>) {
      pushEvent({
        line,
        column: col,
        baseType: 'loop_iteration',
        provenanceOverride: 'observed',
        thunk,
        explicitChanges: [{ target: 'loop', kind: 'loop' }],
        explicitExplanation: `Entered loop iteration at line ${clampLine(line)}.`,
      });
    },
    branch<T>(line: number, col: number, cond: T, thunk: () => Record<string, unknown>): T {
      const taken = Boolean(cond);
      pushEvent({
        line,
        column: col,
        baseType: 'branch_decision',
        provenanceOverride: 'observed',
        thunk,
        explicitChanges: [{ target: 'condition', kind: 'branch', newValue: taken }],
        explicitExplanation: `Branch condition evaluated to ${taken ? 'true' : 'false'}.`,
        metadata: { taken },
      });
      return cond;
    },
    err<T>(line: number, col: number, thunk: () => Record<string, unknown>, thrown: T): T {
      lastThrownErrorObj = thrown;
      const errMsg =
        thrown instanceof Error
          ? `${thrown.name}: ${thrown.message}`
          : String(thrown);
      pushEvent({
        line,
        column: col,
        baseType: 'error',
        provenanceOverride: 'observed',
        thunk,
        explicitChanges: [{ target: 'exception', kind: 'error', newValue: errMsg }],
        explicitExplanation: `Threw exception: ${errMsg}`,
        metadata: { thrown: true, error: errMsg },
      });
      return thrown;
    },
    enter(
      name: string,
      line: number,
      col: number,
      args: Record<string, unknown>,
      thunk: () => Record<string, unknown>
    ) {
      const caller = stack[stack.length - 1];
      const safeArgs: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(args || {})) {
        if (typeof v === 'function' || typeof v === 'symbol') {
          safeArgs[k] = '(fn)';
        } else if (typeof v === 'bigint') {
          safeArgs[k] = Number(v);
        } else if (typeof v === 'object' && v !== null) {
          safeArgs[k] = getObjectId(v as object);
        } else {
          safeArgs[k] = v ?? null;
        }
      }
      stack.push({
        frameId: `frame-${++frameCounter}`,
        name,
        line: clampLine(line),
        callLine: caller?.line,
        args: safeArgs,
        returned: false,
      });
      const argText = Object.entries(safeArgs)
        .map(([k, v]) => `${k}=${summarizeVal(v)}`)
        .join(', ');
      pushEvent({
        line,
        column: col,
        baseType: 'function_call',
        provenanceOverride: 'observed',
        thunk,
        explicitChanges: [{ target: name, kind: 'call', newValue: safeArgs }],
        explicitExplanation: `Called ${name}(${argText}).`,
        metadata: { args: safeArgs, stackDepth: stack.length },
      });
    },
    ret<T>(line: number, col: number, thunk: () => Record<string, unknown>, value: T): T {
      const current = stack[stack.length - 1];
      if (current) current.returned = true;
      const serialRet =
        typeof value === 'function' || typeof value === 'symbol'
          ? '(fn)'
          : typeof value === 'bigint'
            ? Number(value)
            : typeof value === 'object' && value !== null
              ? getObjectId(value as object)
              : (value ?? null);
      pushEvent({
        line,
        column: col,
        baseType: 'function_return',
        provenanceOverride: 'observed',
        thunk,
        returnValue: serialRet,
        isReturn: true,
        explicitChanges: [
          { target: current?.name || 'main', kind: 'return', newValue: serialRet },
        ],
        explicitExplanation: `${current?.name || 'function'} returned ${summarizeVal(serialRet)}.`,
        metadata: { returnValue: serialRet },
      });
      return value;
    },
    leave(name: string, line: number, thunk: () => Record<string, unknown>) {
      const current = stack[stack.length - 1];
      if (current && !current.returned) {
        pushEvent({
          line,
          baseType: 'function_return',
          provenanceOverride: 'observed',
          thunk,
          returnValue: undefined,
          isReturn: true,
          explicitChanges: [{ target: name, kind: 'return', newValue: null }],
          explicitExplanation: `Finished ${name}().`,
        });
      }
      if (stack.length > 1) {
        stack.pop();
      }
    },
  };

  // Safe user-supplied Program Input stream (never invents missing values!)
  const rawStdin = typeof options?.stdin === 'string' ? options.stdin : '';
  const stdinLines = rawStdin.length > 0 ? rawStdin.replace(/\r\n/g, '\n').split('\n') : [];
  if (stdinLines.length > 0 && stdinLines[stdinLines.length - 1] === '' && rawStdin.endsWith('\n')) {
    stdinLines.pop();
  }
  let stdinCursor = 0;

  const readInputLine = (promptText?: string): string => {
    if (promptText) {
      mockConsole.log(promptText);
    }
    if (stdinCursor >= stdinLines.length) {
      throw new Error(
        'InputError: Program asked for input, but Program Input has no more lines. Add values in Program Input and try again.'
      );
    }
    return stdinLines[stdinCursor++];
  };

  const readAllInput = (): string => rawStdin;
  const programArgs = Array.isArray(options?.args) ? [...options.args] : [];

  let runtimeError: string | undefined;
  try {
    runner(
      __ca,
      mockConsole,
      readInputLine,
      readInputLine,
      readInputLine,
      readInputLine,
      readAllInput,
      programArgs
    );
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error';
    const msg = err instanceof Error ? err.message : String(err);
    runtimeError = msg.startsWith(name) ? msg : `${name}: ${msg}`;

    // If execution produced prior events, record the uncaught exception as an observed error event
    // (or mark the existing thrown error event as uncaught)
    if (events.length > 0) {
      const lastEv = events[events.length - 1];
      if (err === lastThrownErrorObj && lastEv.type === 'error') {
        lastEv.metadata = { ...lastEv.metadata, uncaught: true };
      } else {
        const activeLine = stack[stack.length - 1]?.line ?? lastEv.line ?? 1;
        pushEvent({
          line: activeLine,
          baseType: 'error',
          provenanceOverride: 'observed',
          thunk: lastActiveThunk,
          explicitChanges: [{ target: 'exception', kind: 'error', newValue: runtimeError }],
          explicitExplanation: `Execution stopped with error: ${runtimeError}`,
          metadata: { uncaught: true, error: runtimeError },
          allowOverflowForTerminalError: true,
        });
      }
    }
  }

  const steps = events.map(projectEventToStep);

  const hasNonErrorEvent = events.some((e) => e.type !== 'error');
  if (events.length === 0 || (runtimeError && !hasNonErrorEvent)) {
    return {
      document: null,
      steps: [],
      error: runtimeError || 'No executable statements were captured.',
    };
  }

  const targetLanguage = options?.language || 'js';
  const targetAdapter = options?.adapterMeta || JS_ADAPTER_META;

  const document: TraceDocument = {
    schemaVersion: '2.0',
    language: targetLanguage,
    executionMode: 'real',
    adapter: targetAdapter,
    events,
    steps,
    note: runtimeError
      ? `${targetAdapter.label} stopped early: ${runtimeError}`
      : `Real execution · ${targetAdapter.executionMethod}.`,
    warning: runtimeError,
    interrupted: runtimeError ? true : undefined,
  };

  return { document, steps, error: runtimeError };
}

/**
 * Backward-compatible Phase 1 helper.
 */
export function traceJavaScript(
  source: string,
  options?: JsTraceOptions
): { steps: TraceStep[]; error?: string } {
  const res = traceJavaScriptDocument(source, options);
  return { steps: res.steps, error: res.error };
}
