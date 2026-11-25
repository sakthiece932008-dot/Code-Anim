import type { EventProvenance, ExecutionMode, TraceEventType } from './trace';

/**
 * Supported renderer targets for Phase 3 Animation Engine.
 * Each scene in an AnimationFrameContract binds to one renderer target while
 * sharing the same renderer-independent element/relationship/operation model.
 */
export type AnimationRendererTarget =
  | 'array'
  | 'matrix'
  | 'dp-table'
  | 'heap'
  | 'linked-list'
  | 'tree'
  | 'graph'
  | 'stack'
  | 'queue'
  | 'hash-table'
  | 'set'
  | 'recursion'
  | 'object'
  | 'fallback';

export type VisualElementType =
  | 'primitive'
  | 'array-cell'
  | 'list-node'
  | 'tree-node'
  | 'graph-vertex'
  | 'stack-item'
  | 'queue-item'
  | 'hash-entry'
  | 'set-item'
  | 'call-frame'
  | 'object-field'
  | 'generic-item';

export type VisualElementState =
  | 'idle'
  | 'created'
  | 'updated'
  | 'visited'
  | 'comparing'
  | 'swapping'
  | 'active'
  | 'unlinked'
  | 'removed'
  | 'completed'
  | 'error';

export type RelationshipKind =
  | 'next'
  | 'prev'
  | 'left'
  | 'right'
  | 'child'
  | 'edge'
  | 'ref'
  | 'calls';

export interface VisualRelationship {
  readonly id: string;
  readonly kind: RelationshipKind;
  readonly fromId: string;
  readonly toId: string;
  readonly directed: boolean;
  readonly label?: string;
  readonly status: 'unchanged' | 'created' | 'updated' | 'removed';
}

export interface ElementPositionHint {
  readonly index?: number;
  readonly row?: number;
  readonly col?: number;
  readonly x?: number;
  readonly y?: number;
  readonly depth?: number;
}

export interface VisualElement {
  readonly elementId: string;
  readonly structureId: string;
  readonly elementType: VisualElementType;
  readonly label: string;
  readonly value: unknown;
  readonly displayValue: string;
  readonly visualState: VisualElementState;
  readonly pointers: readonly string[];
  readonly positionHint?: ElementPositionHint;
  readonly sharedRefCount?: number;
  readonly sourceEventId: string;
  readonly sourceLine: number;
}

/**
 * Semantic animation operations for Phase 3.
 *
 * CRITICAL CONTRACT RULE:
 * Renderers and adapters MUST NEVER fabricate high-level DSA semantics when the
 * underlying trace event does not establish them. Any unrecognized or arbitrary
 * state change MUST use `GENERIC_STATE_CHANGE`.
 */
export type SemanticOperationType =
  | 'CREATE_NODE'
  | 'REMOVE_NODE'
  | 'UPDATE_VALUE'
  | 'LINK_NODES'
  | 'UNLINK_NODES'
  | 'VISIT_NODE'
  | 'COMPARE'
  | 'SWAP'
  | 'PUSH'
  | 'POP'
  | 'ENQUEUE'
  | 'DEQUEUE'
  | 'CALL_FUNCTION'
  | 'RETURN_FUNCTION'
  | 'GENERIC_STATE_CHANGE';

export interface SemanticOperation {
  readonly opId: string;
  readonly type: SemanticOperationType;
  readonly provenance: EventProvenance;
  readonly targetStructureId?: string;
  readonly elementIds: readonly string[];
  readonly fromId?: string;
  readonly toId?: string;
  readonly label?: string;
  readonly oldValue?: unknown;
  readonly newValue?: unknown;
  readonly sourceEventId: string;
  readonly sourceLine: number;
  readonly description: string;
}

export type TransitionDirection = 'forward' | 'backward' | 'jump' | 'initial';

export interface AnimationTransitionMetadata {
  readonly fromFrameIndex: number | null;
  readonly toFrameIndex: number;
  readonly direction: TransitionDirection;
  readonly durationHintMs: number;
  readonly easingHint: 'ease-out' | 'ease-in-out' | 'spring' | 'linear';
  readonly affectedElementIds: readonly string[];
  readonly orphanedObjectIds: readonly string[];
}

export interface AnimationRendererScene {
  readonly structureId: string;
  readonly renderer: AnimationRendererTarget;
  readonly names: readonly string[];
  readonly elementIds: readonly string[];
  readonly relationships: readonly VisualRelationship[];
  readonly sharedBy: readonly string[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface AnimationFrameContract {
  readonly contractVersion: '3.0-draft';
  readonly frameIndex: number;
  readonly totalFrames: number;
  readonly sourceEventId: string;
  readonly sourceEventType: TraceEventType;
  readonly sourceLine: number;
  readonly executionMode: ExecutionMode;
  readonly scenes: readonly AnimationRendererScene[];
  readonly elements: Readonly<Record<string, VisualElement>>;
  readonly operations: readonly SemanticOperation[];
  readonly transition: AnimationTransitionMetadata;
}
