import {
  detectLanguageFromFilenameStrict,
  getSelectableLanguages,
  type LanguageId,
  type LanguageSupportStatus,
} from '../lib/languageRegistry';

export type { LanguageId, LanguageSupportStatus };

export type AppState = 'EDITOR' | 'TRACING' | 'VISUALIZER' | 'ERROR';

export interface TraceRunOptions {
  stdin?: string;
  args?: string[];
  allowSimulation?: boolean;
}

export interface ErrorHelpSuggestion {
  code: string;
  summary: string;
  isAiSuggestion: boolean;
}

export type ErrorCategory =
  | 'user_code_error'
  | 'compiler_error'
  | 'runtime_error'
  | 'backend_connection_error'
  | 'api_response_error'
  | 'ai_service_error'
  | 'invalid_trace_error'
  | 'renderer_error'
  | 'unsupported'
  | 'timeout'
  | 'syntax'
  | 'undefined'
  | 'type'
  | 'index'
  | 'division_by_zero'
  | 'missing_input'
  | 'infinite_loop'
  | 'stack_overflow'
  | 'import'
  | 'runtime';

export interface ErrorHelpReport {
  affectedLine: number | null;
  originalError: string;
  simpleExplanation: string;
  possibleSolution: string;
  category: ErrorCategory;
  categoryLabel?: string;
  isUserCodeError?: boolean;
  technicalDetail?: string;
  suggestedFix?: ErrorHelpSuggestion;
}

export interface ExplanationChangeItem {
  label: string;
  before: string;
  after: string;
}

export interface StepExplanationBreakdown {
  whatProgramDoes: string;
  whatIsHappeningNow: string;
  whyIsThisHappening: string;
  whatChanged: ExplanationChangeItem[];
  whatDoesThisMean: string;
  technicalDetail: string;
  finalResult: string | null;
}

export interface ExecutionSummary {
  detectedLanguage: string;
  languageId: LanguageId;
  executionMode: ExecutionMode;
  purpose: string;
  detectedStructures: string[];
  observedOperations: string[];
  finalOutput: string;
  stepCount: number;
  status: 'completed' | 'stopped_early' | 'simulated';
  measuredDurationMs?: number;
  theoreticalTimeComplexity?: string;
  theoreticalSpaceComplexity?: string;
  complexityNote?: string;
}

export type ExecutionMode = 'real' | 'simulated';

export type EventProvenance = 'observed' | 'inferred';

export type TraceEventType =
  | 'statement'
  | 'var_declare'
  | 'var_assign'
  | 'array_create'
  | 'array_update'
  | 'array_append'
  | 'array_remove'
  | 'array_insert'
  | 'array_swap'
  | 'array_resize'
  | 'object_create'
  | 'property_set'
  | 'property_delete'
  | 'node_create'
  | 'node_delete'
  | 'reference_update'
  | 'linked_traverse'
  | 'tree_insert'
  | 'tree_delete'
  | 'tree_traverse'
  | 'graph_vertex_create'
  | 'graph_edge_create'
  | 'graph_edge_delete'
  | 'graph_visit'
  | 'function_call'
  | 'function_return'
  | 'loop_iteration'
  | 'branch_decision'
  | 'console_output'
  | 'error';

export interface ObjectRef {
  __ref: string;
}

export type PrimitiveValue = string | number | boolean | null;

export type ValueRef = PrimitiveValue | ObjectRef;

export function isObjectRef(value: unknown): value is ObjectRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as ObjectRef).__ref === 'string' &&
    Object.keys(value as Record<string, unknown>).length === 1
  );
}

export interface HeapObject {
  id: string;
  kind: 'array' | 'object' | 'set' | 'map';
  className?: string;
  elements?: ValueRef[];
  entries?: Record<string, ValueRef>;
  totalLength?: number;
  truncated?: boolean;
}

export interface StateChange {
  target: string;
  kind: 'create' | 'update' | 'delete' | 'call' | 'return' | 'output' | 'branch' | 'loop' | 'error';
  objectId?: string;
  property?: string;
  index?: number;
  oldValue?: unknown;
  newValue?: unknown;
}

export interface StackFrame {
  frameId: string;
  name: string;
  line: number;
  callLine?: number;
  args?: Record<string, unknown>;
  localsCount: number;
  returnValue?: unknown;
}

export interface SceneItem {
  t: 'rect' | 'circle' | 'text' | 'line' | 'button' | string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  r?: number;
  x2?: number;
  y2?: number;
  text?: string;
  color?: string;
}

export interface SceneData {
  w?: number;
  h?: number;
  items: SceneItem[];
}

/**
 * Universal Execution Trace Event (Schema v2.0)
 */
export interface TraceEvent {
  id: string;
  sequence: number;
  line: number;
  column?: number;
  type: TraceEventType;
  provenance: EventProvenance;
  scope: string;
  functionName: string;
  changes: StateChange[];
  objectIds: string[];
  heap: Record<string, HeapObject>;
  locals: Record<string, ValueRef>;
  callStack: StackFrame[];
  print: string;
  outText: string;
  explanation: string;
  metadata: Record<string, unknown>;
  scene: SceneData | null;
}

/**
 * Backward-compatible Code Anim step schema (Phase 1 compatibility):
 * { line, note, vars, print, scene, outText }
 */
export interface TraceStep {
  line: number;
  note: string;
  vars: Record<string, unknown>;
  print: string;
  scene: SceneData | null;
  outText: string;
}

export interface AdapterCapabilities {
  primitives: boolean;
  arrays: boolean;
  linkedStructures: boolean;
  trees: boolean;
  graphs: boolean;
  callStack: boolean;
  loopsAndBranches: boolean;
  objectIdentity: boolean;
  cancellation: boolean;
}

export interface LanguageAdapterMeta {
  id: string;
  language: LanguageId;
  label: string;
  executionMode: ExecutionMode;
  runtimeAvailable: boolean;
  executionMethod: string;
  capabilities: AdapterCapabilities;
  limitations: string[];
}

export interface TraceDocument {
  schemaVersion: '2.0';
  language: LanguageId;
  executionMode: ExecutionMode;
  adapter: LanguageAdapterMeta;
  events: TraceEvent[];
  steps: TraceStep[];
  note: string;
  warning?: string;
  interrupted?: boolean;
}

export interface LanguageOption {
  id: LanguageId;
  label: string;
  modeLabel: string;
  executionMode: ExecutionMode;
  status: LanguageSupportStatus;
  statusLabel: string;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = getSelectableLanguages().map((spec) => ({
  id: spec.id,
  label: spec.name,
  modeLabel: spec.executionMethod,
  executionMode: spec.realExecutionSupported ? 'real' : 'simulated',
  status: spec.status,
  statusLabel: spec.statusLabel,
}));

export function detectLanguageFromFilename(filename: string): LanguageId | null {
  return detectLanguageFromFilenameStrict(filename);
}

export const VALID_EVENT_TYPES = new Set<TraceEventType>([
  'statement', 'var_declare', 'var_assign',
  'array_create', 'array_update', 'array_append', 'array_remove', 'array_insert', 'array_swap', 'array_resize',
  'object_create', 'property_set', 'property_delete',
  'node_create', 'node_delete', 'reference_update', 'linked_traverse',
  'tree_insert', 'tree_delete', 'tree_traverse',
  'graph_vertex_create', 'graph_edge_create', 'graph_edge_delete', 'graph_visit',
  'function_call', 'function_return',
  'loop_iteration', 'branch_decision',
  'console_output', 'error',
]);

export const TRACE_VALIDATION_LIMITS = {
  maxEvents: 2000,
  maxHeapObjectsPerEvent: 512,
  maxArrayElementsPerObject: 1024,
  maxObjectKeysPerObject: 128,
  maxCallStackDepth: 256,
  maxOutTextChars: 128_000,
} as const;

const VALID_HEAP_KINDS = new Set<HeapObject['kind']>(['array', 'object', 'set', 'map']);

/**
 * Materializes a heap-referenced ValueRef back into a cycle-safe plain value
 * for Phase 1 compatibility (`step.vars`).
 */
export function materializeValueRef(
  ref: ValueRef,
  heap: Record<string, HeapObject>,
  depth = 0,
  visiting = new Set<string>()
): unknown {
  if (!isObjectRef(ref)) return ref;
  const obj = heap[ref.__ref];
  if (!obj) return null;
  if (visiting.has(obj.id)) return `↺(${obj.id})`;
  if (depth > 8) return '…';
  visiting.add(obj.id);
  try {
    if (obj.kind === 'array' || obj.kind === 'set') {
      return (obj.elements || []).map((el) =>
        materializeValueRef(el, heap, depth + 1, visiting)
      );
    }
    const out: Record<string, unknown> = {};
    if (obj.className && obj.className !== 'Object' && obj.className !== 'dict') {
      out.__cls = obj.className;
    }
    for (const [k, v] of Object.entries(obj.entries || {})) {
      out[k] = materializeValueRef(v, heap, depth + 1, visiting);
    }
    return out;
  } finally {
    visiting.delete(obj.id);
  }
}

/**
 * Extracts a synthetic heap + ValueRef locals map from legacy plain `vars`
 * (used when normalizing Phase 1 or AI-simulated steps into TraceEvent v2.0).
 */
export function synthesizeHeapFromPlainVars(
  vars: Record<string, unknown>,
  prefix = 'sim'
): { locals: Record<string, ValueRef>; heap: Record<string, HeapObject>; objectIds: string[] } {
  const heap: Record<string, HeapObject> = {};
  const locals: Record<string, ValueRef> = {};
  let counter = 0;

  const convert = (val: unknown, depth: number): ValueRef => {
    if (val === null || val === undefined) return null;
    if (typeof val === 'string' || typeof val === 'boolean') return val;
    if (typeof val === 'number') return Number.isFinite(val) ? val : String(val);
    if (depth > 8) return '…';
    if (Array.isArray(val)) {
      const id = `${prefix}_${++counter}`;
      const limit = Math.min(val.length, 256);
      heap[id] = {
        id,
        kind: 'array',
        elements: val.slice(0, limit).map((item) => convert(item, depth + 1)),
        totalLength: val.length,
        truncated: val.length > limit ? true : undefined,
      };
      return { __ref: id };
    }
    if (typeof val === 'object') {
      const rec = val as Record<string, unknown>;
      const id = `${prefix}_${++counter}`;
      const entries: Record<string, ValueRef> = {};
      for (const [k, v] of Object.entries(rec).slice(0, 64)) {
        if (k === '__cls') continue;
        entries[k] = convert(v, depth + 1);
      }
      heap[id] = {
        id,
        kind: 'object',
        className: typeof rec.__cls === 'string' ? rec.__cls : undefined,
        entries,
      };
      return { __ref: id };
    }
    return String(val);
  };

  for (const [k, v] of Object.entries(vars)) {
    locals[k] = convert(v, 0);
  }

  return { locals, heap, objectIds: Object.keys(heap) };
}

export function projectEventToStep(event: TraceEvent): TraceStep {
  const vars: Record<string, unknown> = {};
  for (const [k, ref] of Object.entries(event.locals)) {
    vars[k] = materializeValueRef(ref, event.heap);
  }
  return {
    line: event.line,
    note: event.explanation,
    vars,
    print: event.print,
    scene: event.scene,
    outText: event.outText,
  };
}

export interface ValidationOutcome {
  ok: true;
  steps: TraceStep[];
}

export interface ValidationDocumentOutcome {
  ok: true;
  document: TraceDocument;
}

export interface ValidationFailure {
  ok: false;
  error: string;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateValueRef(
  value: unknown,
  heap: Record<string, HeapObject>,
  contextPath: string
): string | null {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return null;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return `Unsupported non-finite numeric value at ${contextPath}.`;
    }
    return null;
  }
  if (isObjectRef(value)) {
    if (!value.__ref.trim()) {
      return `Empty object reference at ${contextPath}.`;
    }
    if (!(value.__ref in heap)) {
      return `Broken object reference "${value.__ref}" at ${contextPath} (missing from heap).`;
    }
    return null;
  }
  return `Unsupported value type (${typeof value}) at ${contextPath}; expected primitive or { __ref }.`;
}

export function validateAndNormalizeTrace(
  payload: unknown,
  totalLines: number
): ValidationOutcome | ValidationFailure {
  if (!isPlainRecord(payload)) {
    return { ok: false, error: 'Trace response was empty or malformed.' };
  }

  const rawSteps = payload.steps;
  if (!Array.isArray(rawSteps)) {
    return { ok: false, error: 'Trace response is missing a valid steps array.' };
  }

  if (rawSteps.length > TRACE_VALIDATION_LIMITS.maxEvents) {
    return {
      ok: false,
      error: `Trace payload exceeds maximum step limit (${TRACE_VALIDATION_LIMITS.maxEvents}).`,
    };
  }

  const maxLine = Math.max(1, totalLines);
  const steps: TraceStep[] = [];
  let cumulativeOut = '';

  for (let i = 0; i < rawSteps.length; i++) {
    const item = rawSteps[i];
    if (!isPlainRecord(item)) {
      return { ok: false, error: `Malformed trace step at index ${i}.` };
    }
    const rawLine = Number(item.line);
    if (!Number.isFinite(rawLine) || rawLine < 1) {
      return {
        ok: false,
        error: `Invalid source line (${String(item.line)}) in legacy trace step ${i + 1}.`,
      };
    }
    const line = Math.min(Math.floor(rawLine), maxLine);

    if (item.vars !== undefined && !isPlainRecord(item.vars)) {
      return { ok: false, error: `Invalid vars map in trace step ${i + 1}.` };
    }
    const vars = isPlainRecord(item.vars) ? item.vars : {};

    const note = typeof item.note === 'string' ? item.note : '';
    const print = item.print != null ? String(item.print) : '';

    let outText: string;
    if (typeof item.outText === 'string') {
      outText = item.outText;
      cumulativeOut = outText;
    } else {
      if (print) {
        cumulativeOut += (cumulativeOut && !cumulativeOut.endsWith('\n') ? '\n' : '') + print + '\n';
      }
      outText = cumulativeOut;
    }

    let scene: SceneData | null = null;
    if (
      isPlainRecord(item.scene) &&
      Array.isArray((item.scene as { items?: unknown }).items)
    ) {
      scene = item.scene as unknown as SceneData;
    }

    steps.push({ line, note, vars, print, scene, outText });
  }

  if (steps.length === 0) {
    return { ok: false, error: 'No executable steps were captured from this program.' };
  }

  return { ok: true, steps };
}

function validateStrictV2Events(
  rawEvents: unknown[],
  maxLine: number
): { ok: true; events: TraceEvent[] } | ValidationFailure {
  if (rawEvents.length === 0) {
    return { ok: false, error: 'Trace v2.0 payload contains an empty events array.' };
  }
  if (rawEvents.length > TRACE_VALIDATION_LIMITS.maxEvents) {
    return {
      ok: false,
      error: `Trace payload exceeds maximum event limit (${TRACE_VALIDATION_LIMITS.maxEvents}).`,
    };
  }

  const events: TraceEvent[] = [];
  const seenIds = new Set<string>();
  let prevSeq = 0;
  let cumulativeOut = '';

  for (let i = 0; i < rawEvents.length; i++) {
    const item = rawEvents[i];
    if (!isPlainRecord(item)) {
      return { ok: false, error: `Malformed trace event at index ${i}: expected object.` };
    }

    // 1. Event ID (required, non-empty, unique)
    if (typeof item.id !== 'string' || !item.id.trim()) {
      return { ok: false, error: `Trace event at index ${i} is missing a valid non-empty id.` };
    }
    if (seenIds.has(item.id)) {
      return { ok: false, error: `Duplicate trace event id "${item.id}" at index ${i}.` };
    }
    seenIds.add(item.id);

    // 2. Sequence (required, positive integer, strictly increasing)
    if (
      typeof item.sequence !== 'number' ||
      !Number.isInteger(item.sequence) ||
      item.sequence < 1 ||
      item.sequence <= prevSeq
    ) {
      return {
        ok: false,
        error: `Invalid or non-monotonic sequence (${String(item.sequence)}) in event "${item.id}".`,
      };
    }
    prevSeq = item.sequence;

    // 3. Source line (required, integer in [1, maxLine])
    if (
      typeof item.line !== 'number' ||
      !Number.isInteger(item.line) ||
      item.line < 1 ||
      item.line > maxLine
    ) {
      return {
        ok: false,
        error: `Invalid source line (${String(item.line)}) in event "${item.id}" (expected 1..${maxLine}).`,
      };
    }
    const line = item.line;

    if (
      item.column !== undefined &&
      (typeof item.column !== 'number' || !Number.isInteger(item.column) || item.column < 0)
    ) {
      return {
        ok: false,
        error: `Invalid source column (${String(item.column)}) in event "${item.id}".`,
      };
    }
    const column = typeof item.column === 'number' ? item.column : undefined;

    // 4. Event type (required, must be in known schema enum)
    if (typeof item.type !== 'string' || !VALID_EVENT_TYPES.has(item.type as TraceEventType)) {
      return {
        ok: false,
        error: `Unknown trace event type "${String(item.type)}" in event "${item.id}".`,
      };
    }
    const type = item.type as TraceEventType;

    // 5. Provenance (optional default observed, but reject invalid strings)
    if (
      item.provenance !== undefined &&
      item.provenance !== 'observed' &&
      item.provenance !== 'inferred'
    ) {
      return {
        ok: false,
        error: `Invalid provenance "${String(item.provenance)}" in event "${item.id}".`,
      };
    }
    const provenance: EventProvenance =
      item.provenance === 'inferred' ? 'inferred' : 'observed';

    // 6. Heap validation
    if (!isPlainRecord(item.heap)) {
      return { ok: false, error: `Missing or invalid heap object map in event "${item.id}".` };
    }
    const heapKeys = Object.keys(item.heap);
    if (heapKeys.length > TRACE_VALIDATION_LIMITS.maxHeapObjectsPerEvent) {
      return {
        ok: false,
        error: `Heap object count (${heapKeys.length}) exceeds limit in event "${item.id}".`,
      };
    }

    const heap: Record<string, HeapObject> = {};
    for (const [oid, rawObj] of Object.entries(item.heap)) {
      if (!oid.trim() || !isPlainRecord(rawObj)) {
        return { ok: false, error: `Malformed heap entry "${oid}" in event "${item.id}".` };
      }
      if (typeof rawObj.id !== 'string' || rawObj.id !== oid) {
        return {
          ok: false,
          error: `Heap entry key "${oid}" does not match object id "${String(rawObj.id)}" in event "${item.id}".`,
        };
      }
      if (typeof rawObj.kind !== 'string' || !VALID_HEAP_KINDS.has(rawObj.kind as HeapObject['kind'])) {
        return {
          ok: false,
          error: `Unsupported heap object kind "${String(rawObj.kind)}" for "${oid}" in event "${item.id}".`,
        };
      }
      const kind = rawObj.kind as HeapObject['kind'];
      if (kind === 'array' || kind === 'set') {
        if (!Array.isArray(rawObj.elements)) {
          return {
            ok: false,
            error: `Heap ${kind} "${oid}" is missing elements array in event "${item.id}".`,
          };
        }
        if (rawObj.elements.length > TRACE_VALIDATION_LIMITS.maxArrayElementsPerObject) {
          return {
            ok: false,
            error: `Heap ${kind} "${oid}" exceeds element cap (${TRACE_VALIDATION_LIMITS.maxArrayElementsPerObject}) in event "${item.id}".`,
          };
        }
      } else {
        if (!isPlainRecord(rawObj.entries)) {
          return {
            ok: false,
            error: `Heap ${kind} "${oid}" is missing entries map in event "${item.id}".`,
          };
        }
        if (Object.keys(rawObj.entries).length > TRACE_VALIDATION_LIMITS.maxObjectKeysPerObject) {
          return {
            ok: false,
            error: `Heap ${kind} "${oid}" exceeds key cap (${TRACE_VALIDATION_LIMITS.maxObjectKeysPerObject}) in event "${item.id}".`,
          };
        }
      }

      heap[oid] = {
        id: oid,
        kind,
        className: typeof rawObj.className === 'string' ? rawObj.className : undefined,
        elements: Array.isArray(rawObj.elements) ? (rawObj.elements as ValueRef[]) : undefined,
        entries: isPlainRecord(rawObj.entries) ? (rawObj.entries as Record<string, ValueRef>) : undefined,
        totalLength:
          typeof rawObj.totalLength === 'number' && Number.isInteger(rawObj.totalLength) && rawObj.totalLength >= 0
            ? rawObj.totalLength
            : undefined,
        truncated: rawObj.truncated === true ? true : undefined,
      };
    }

    // 7. Reference integrity & ValueRef type checks inside heap
    for (const [oid, obj] of Object.entries(heap)) {
      if (obj.elements) {
        for (let idx = 0; idx < obj.elements.length; idx++) {
          const err = validateValueRef(obj.elements[idx], heap, `${item.id}.heap.${oid}[${idx}]`);
          if (err) return { ok: false, error: err };
        }
      }
      if (obj.entries) {
        for (const [k, v] of Object.entries(obj.entries)) {
          const err = validateValueRef(v, heap, `${item.id}.heap.${oid}.${k}`);
          if (err) return { ok: false, error: err };
        }
      }
    }

    // 8. Locals map + reference integrity
    if (!isPlainRecord(item.locals)) {
      return { ok: false, error: `Missing or invalid locals map in event "${item.id}".` };
    }
    const locals: Record<string, ValueRef> = {};
    for (const [varName, val] of Object.entries(item.locals)) {
      const err = validateValueRef(val, heap, `${item.id}.locals.${varName}`);
      if (err) return { ok: false, error: err };
      locals[varName] = val as ValueRef;
    }

    // 9. Call stack validation
    if (!Array.isArray(item.callStack)) {
      return { ok: false, error: `Missing or invalid callStack array in event "${item.id}".` };
    }
    if (item.callStack.length > TRACE_VALIDATION_LIMITS.maxCallStackDepth) {
      return {
        ok: false,
        error: `Call stack depth (${item.callStack.length}) exceeds limit in event "${item.id}".`,
      };
    }
    const callStack: StackFrame[] = [];
    for (let fi = 0; fi < item.callStack.length; fi++) {
      const f = item.callStack[fi];
      if (!isPlainRecord(f) || typeof f.frameId !== 'string' || !f.frameId || typeof f.name !== 'string') {
        return {
          ok: false,
          error: `Malformed callStack frame at index ${fi} in event "${item.id}".`,
        };
      }
      const fLine = Number(f.line);
      if (!Number.isInteger(fLine) || fLine < 1) {
        return {
          ok: false,
          error: `Invalid callStack frame line (${String(f.line)}) in event "${item.id}".`,
        };
      }
      callStack.push({
        frameId: f.frameId,
        name: f.name,
        line: fLine,
        callLine: typeof f.callLine === 'number' ? f.callLine : undefined,
        args: isPlainRecord(f.args) ? f.args : undefined,
        localsCount: typeof f.localsCount === 'number' ? f.localsCount : 0,
        returnValue: f.returnValue,
      });
    }

    // 10. ObjectIds consistency
    let objectIds: string[];
    if (item.objectIds !== undefined) {
      if (!Array.isArray(item.objectIds) || item.objectIds.some((x) => typeof x !== 'string')) {
        return { ok: false, error: `Invalid objectIds array in event "${item.id}".` };
      }
      for (const oid of item.objectIds as string[]) {
        if (!(oid in heap)) {
          return {
            ok: false,
            error: `Event "${item.id}" lists objectId "${oid}" that is missing from heap.`,
          };
        }
      }
      objectIds = item.objectIds as string[];
    } else {
      objectIds = Object.keys(heap);
    }

    // 11. Output & metadata
    const print = item.print != null ? String(item.print) : '';
    let outText: string;
    if (typeof item.outText === 'string') {
      if (item.outText.length > TRACE_VALIDATION_LIMITS.maxOutTextChars) {
        return { ok: false, error: `Console output size exceeds limit in event "${item.id}".` };
      }
      outText = item.outText;
      cumulativeOut = outText;
    } else {
      if (print) {
        cumulativeOut += (cumulativeOut && !cumulativeOut.endsWith('\n') ? '\n' : '') + print + '\n';
      }
      outText = cumulativeOut;
    }

    const scope = typeof item.scope === 'string' && item.scope ? item.scope : 'main';
    const functionName =
      typeof item.functionName === 'string' && item.functionName ? item.functionName : scope;
    const changes: StateChange[] = Array.isArray(item.changes) ? (item.changes as StateChange[]) : [];
    const scene =
      isPlainRecord(item.scene) && Array.isArray((item.scene as { items?: unknown }).items)
        ? (item.scene as unknown as SceneData)
        : null;

    events.push({
      id: item.id,
      sequence: item.sequence,
      line,
      column,
      type,
      provenance,
      scope,
      functionName,
      changes,
      objectIds,
      heap,
      locals,
      callStack,
      print,
      outText,
      explanation: typeof item.explanation === 'string' ? item.explanation : '',
      metadata: isPlainRecord(item.metadata) ? item.metadata : {},
      scene,
    });
  }

  return { ok: true, events };
}

export function validateAndNormalizeTraceDocument(
  payload: unknown,
  totalLines: number,
  fallbackMeta: {
    language: LanguageId;
    executionMode: ExecutionMode;
    adapter: LanguageAdapterMeta;
    note?: string;
    warning?: string;
  }
): ValidationDocumentOutcome | ValidationFailure {
  if (!isPlainRecord(payload)) {
    return { ok: false, error: 'Trace payload was empty or malformed.' };
  }

  const maxLine = Math.max(1, totalLines);
  const hasEventsField = 'events' in payload && payload.events !== undefined;
  let events: TraceEvent[] = [];

  if (hasEventsField) {
    if (!Array.isArray(payload.events)) {
      return { ok: false, error: 'Trace v2.0 payload has a non-array events field.' };
    }
    const strictRes = validateStrictV2Events(payload.events, maxLine);
    if (!strictRes.ok) {
      return strictRes;
    }
    events = strictRes.events;
  } else {
    // Explicit legacy Phase 1 / AI-simulated `steps[]`-only upgrade path
    const legacy = validateAndNormalizeTrace(payload, totalLines);
    if (!legacy.ok) return legacy;
    legacy.steps.forEach((step, idx) => {
      const seq = idx + 1;
      const synth = synthesizeHeapFromPlainVars(step.vars, `s${seq}`);
      events.push({
        id: `event-${String(seq).padStart(3, '0')}`,
        sequence: seq,
        line: step.line,
        type: step.print ? 'console_output' : 'statement',
        provenance: fallbackMeta.executionMode === 'simulated' ? 'inferred' : 'observed',
        scope: 'main',
        functionName: 'main',
        changes: [],
        objectIds: synth.objectIds,
        heap: synth.heap,
        locals: synth.locals,
        callStack: [
          {
            frameId: 'frame-main',
            name: 'main',
            line: step.line,
            localsCount: Object.keys(step.vars).length,
          },
        ],
        print: step.print,
        outText: step.outText,
        explanation: step.note,
        metadata: {
          simulated: fallbackMeta.executionMode === 'simulated',
          legacyStepsUpgraded: true,
        },
        scene: step.scene,
      });
    });
  }

  if (events.length === 0) {
    return { ok: false, error: 'No executable trace events were captured from this program.' };
  }

  let steps: TraceStep[];
  if (Array.isArray(payload.steps) && payload.steps.length === events.length) {
    const stepValidation = validateAndNormalizeTrace({ steps: payload.steps }, totalLines);
    steps = stepValidation.ok ? stepValidation.steps : events.map(projectEventToStep);
  } else {
    steps = events.map(projectEventToStep);
  }

  const executionMode: ExecutionMode =
    payload.executionMode === 'real' || payload.executionMode === 'simulated'
      ? payload.executionMode
      : fallbackMeta.executionMode;

  const adapter: LanguageAdapterMeta = isPlainRecord(payload.adapter)
    ? (payload.adapter as unknown as LanguageAdapterMeta)
    : fallbackMeta.adapter;

  const warning = typeof payload.warning === 'string' ? payload.warning : fallbackMeta.warning;
  const interrupted =
    payload.interrupted === true ||
    Boolean(warning) ||
    events.some((e) => e.type === 'error' && e.metadata.uncaught === true);

  return {
    ok: true,
    document: {
      schemaVersion: '2.0',
      language: fallbackMeta.language,
      executionMode,
      adapter,
      events,
      steps,
      note: typeof payload.note === 'string' ? payload.note : fallbackMeta.note || '',
      warning,
      interrupted: interrupted || undefined,
    },
  };
}
