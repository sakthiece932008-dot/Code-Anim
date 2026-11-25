import {
  projectEventToStep,
  type EventProvenance,
  type ExecutionMode,
  type SceneData,
  type StackFrame,
  type TraceDocument,
  type TraceEvent,
  type TraceEventType,
  type TraceStep,
} from '../types/trace';
import {
  reconstructWorkspaceState,
  type ReconstructedWorkspaceState,
} from './structureReconstructor';
import { explainStep } from './explain';

export interface ReconstructedFrame {
  readonly index: number;
  readonly total: number;
  readonly event: TraceEvent;
  readonly step: TraceStep;
  readonly line: number;
  readonly eventType: TraceEventType;
  readonly provenance: EventProvenance;
  readonly executionMode: ExecutionMode;
  readonly callStack: readonly StackFrame[];
  readonly explanation: string;
  readonly print: string;
  readonly outText: string;
  readonly scene: SceneData | null;
  readonly workspace: ReconstructedWorkspaceState;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) {
      deepFreeze(v);
    }
  }
  return value;
}

function fastDeepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Deterministic Event Replay Engine.
 *
 * Isolates the validated TraceDocument via `structuredClone` and lazily deep-freezes
 * each reconstructed frame on access so external mutations can never corrupt history
 * while keeping startup fast even on large 1,000-element / 1,500-event traces.
 */
export class TraceReplayEngine {
  private readonly doc: TraceDocument;
  private readonly codeLines: readonly string[];
  private readonly frameCache = new Map<number, ReconstructedFrame>();

  constructor(document: TraceDocument, sourceCode: string) {
    const cloned = fastDeepClone(document);
    Object.freeze(cloned.events);
    Object.freeze(cloned.steps);
    this.doc = Object.freeze(cloned);
    this.codeLines = Object.freeze(sourceCode.split('\n'));
  }

  get totalSteps(): number {
    return this.doc.events.length;
  }

  get interrupted(): boolean {
    return Boolean(this.doc.interrupted || this.doc.warning);
  }

  get document(): TraceDocument {
    return this.doc;
  }

  getStateAt(rawIndex: number): ReconstructedFrame | null {
    const total = this.doc.events.length;
    if (total === 0) return null;

    const index = Math.min(Math.max(0, Math.floor(rawIndex)), total - 1);
    const cached = this.frameCache.get(index);
    if (cached) return cached;

    const event = deepFreeze(this.doc.events[index]);
    const prevEvent = index > 0 ? deepFreeze(this.doc.events[index - 1]) : null;
    const step = deepFreeze(this.doc.steps[index] || projectEventToStep(event));
    const prevStep =
      index > 0
        ? deepFreeze(this.doc.steps[index - 1] || projectEventToStep(this.doc.events[index - 1]))
        : null;

    const workspace = reconstructWorkspaceState(event, prevEvent);
    const explanation =
      event.explanation && event.explanation.trim()
        ? event.explanation.trim()
        : explainStep(step, prevStep, this.codeLines as string[]);

    const frame: ReconstructedFrame = deepFreeze({
      index,
      total,
      event,
      step,
      line: event.line,
      eventType: event.type,
      provenance: event.provenance,
      executionMode: this.doc.executionMode,
      callStack: event.callStack,
      explanation,
      print: event.print,
      outText: event.outText,
      scene: event.scene,
      workspace,
    });

    this.frameCache.set(index, frame);
    return frame;
  }
}
