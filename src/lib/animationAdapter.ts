import { isObjectRef, type TraceEvent } from '../types/trace';
import type { ReconstructedFrame } from './replayEngine';
import type { ChangeStatus } from './structureReconstructor';
import type {
  AnimationFrameContract,
  AnimationRendererScene,
  AnimationRendererTarget,
  SemanticOperation,
  TransitionDirection,
  VisualElement,
  VisualElementState,
  VisualElementType,
  VisualRelationship,
} from '../types/animationContract';

function mapStatusToVisualState(
  status: ChangeStatus,
  isErrorEvent: boolean
): VisualElementState {
  if (isErrorEvent) return 'error';
  if (status === 'new') return 'created';
  if (status === 'changed') return 'updated';
  return 'idle';
}

function deriveSemanticOperations(
  event: TraceEvent,
  prevEvent: TraceEvent | null,
  orphanedObjectIds: readonly string[]
): SemanticOperation[] {
  const ops: SemanticOperation[] = [];
  let seq = 0;
  const nextOpId = () => `${event.id}:op-${++seq}`;
  const arrayOp = typeof event.metadata.arrayOp === 'string' ? event.metadata.arrayOp : '';

  // 1. Explicit observed call / return / branch / error events
  if (event.type === 'function_call') {
    const top = event.callStack[event.callStack.length - 1];
    ops.push({
      opId: nextOpId(),
      type: 'CALL_FUNCTION',
      provenance: 'observed',
      targetStructureId: 'call-stack',
      elementIds: top ? [top.frameId] : [],
      label: event.functionName,
      newValue: top?.args,
      sourceEventId: event.id,
      sourceLine: event.line,
      description: event.explanation || `Called ${event.functionName}()`,
    });
    return ops;
  }

  if (event.type === 'function_return') {
    const top = event.callStack[event.callStack.length - 1];
    ops.push({
      opId: nextOpId(),
      type: 'RETURN_FUNCTION',
      provenance: 'observed',
      targetStructureId: 'call-stack',
      elementIds: top ? [top.frameId] : [],
      label: event.functionName,
      newValue: top?.returnValue,
      sourceEventId: event.id,
      sourceLine: event.line,
      description: event.explanation || `Returned from ${event.functionName}()`,
    });
    return ops;
  }

  if (event.type === 'branch_decision') {
    ops.push({
      opId: nextOpId(),
      type: 'COMPARE',
      provenance: 'observed',
      elementIds: [],
      newValue: event.metadata.taken,
      sourceEventId: event.id,
      sourceLine: event.line,
      description: event.explanation || `Branch evaluated to ${String(event.metadata.taken)}`,
    });
    return ops;
  }

  // 2. Array stack/queue/swap/update operations
  if (event.type === 'array_swap') {
    const swapChanges = event.changes.filter((c) => c.objectId && typeof c.index === 'number');
    const oid = swapChanges[0]?.objectId;
    const ids = swapChanges.map((c) => `${c.objectId}[${c.index}]`);
    ops.push({
      opId: nextOpId(),
      type: 'SWAP',
      provenance: event.provenance,
      targetStructureId: oid,
      elementIds: ids,
      fromId: ids[0],
      toId: ids[1],
      sourceEventId: event.id,
      sourceLine: event.line,
      description: event.explanation || 'Swapped two array elements',
    });
    return ops;
  }

  if (event.type === 'array_append' && arrayOp === 'push') {
    const c = event.changes.find((ch) => ch.objectId && typeof ch.index === 'number');
    const oid = c?.objectId;
    const isQueueTarget = c?.target ? /\b(queue|deque|fifo|q)\b/i.test(c.target) : false;
    ops.push({
      opId: nextOpId(),
      type: isQueueTarget ? 'ENQUEUE' : 'PUSH',
      provenance: isQueueTarget ? 'inferred' : 'observed',
      targetStructureId: oid,
      elementIds: oid && c?.index !== undefined ? [`${oid}[${c.index}]`] : [],
      newValue: c?.newValue,
      sourceEventId: event.id,
      sourceLine: event.line,
      description: event.explanation || `Appended value to ${c?.target || 'array'}`,
    });
    return ops;
  }

  if (event.type === 'array_remove' && (arrayOp === 'pop' || arrayOp === 'shift')) {
    const c = event.changes.find((ch) => ch.objectId);
    const oid = c?.objectId;
    const isDequeue = arrayOp === 'shift';
    ops.push({
      opId: nextOpId(),
      type: isDequeue ? 'DEQUEUE' : 'POP',
      provenance: 'observed',
      targetStructureId: oid,
      elementIds: oid && c?.index !== undefined ? [`${oid}[${c.index}]`] : [],
      oldValue: c?.oldValue,
      sourceEventId: event.id,
      sourceLine: event.line,
      description: event.explanation || `Removed item from ${c?.target || 'array'}`,
    });
    return ops;
  }

  // 3. Node creation & pointer linking/unlinking
  if (event.type === 'node_create') {
    const createdRefs = event.changes
      .map((c) => (isObjectRef(c.newValue) ? c.newValue.__ref : null))
      .filter((x): x is string => Boolean(x));
    ops.push({
      opId: nextOpId(),
      type: 'CREATE_NODE',
      provenance: event.provenance,
      targetStructureId: createdRefs[0],
      elementIds: createdRefs,
      sourceEventId: event.id,
      sourceLine: event.line,
      description: event.explanation || 'Created node object',
    });
    return ops;
  }

  if (event.type === 'tree_insert' || event.type === 'tree_delete' || event.type === 'reference_update') {
    for (const c of event.changes) {
      if (!c.objectId || !c.property) continue;
      const toRef = isObjectRef(c.newValue) ? c.newValue.__ref : undefined;
      const oldRef = isObjectRef(c.oldValue) ? c.oldValue.__ref : undefined;
      if (toRef) {
        ops.push({
          opId: nextOpId(),
          type: 'LINK_NODES',
          provenance: event.provenance,
          targetStructureId: c.objectId,
          elementIds: [c.objectId, toRef],
          fromId: c.objectId,
          toId: toRef,
          label: c.property,
          sourceEventId: event.id,
          sourceLine: event.line,
          description: event.explanation || `Linked ${c.objectId}.${c.property} -> ${toRef}`,
        });
      } else if (oldRef && c.newValue === null) {
        ops.push({
          opId: nextOpId(),
          type: 'UNLINK_NODES',
          provenance: event.provenance,
          targetStructureId: c.objectId,
          elementIds: [c.objectId, oldRef],
          fromId: c.objectId,
          toId: oldRef,
          label: c.property,
          sourceEventId: event.id,
          sourceLine: event.line,
          description: event.explanation || `Unlinked ${c.objectId}.${c.property}`,
        });
      }
    }
    if (ops.length > 0) return ops;
  }

  if (event.type === 'graph_visit') {
    const c = event.changes[0];
    ops.push({
      opId: nextOpId(),
      type: 'VISIT_NODE',
      provenance: event.provenance,
      targetStructureId: c?.objectId,
      elementIds: c?.newValue != null ? [String(c.newValue)] : [],
      newValue: c?.newValue,
      sourceEventId: event.id,
      sourceLine: event.line,
      description: event.explanation || 'Visited graph vertex',
    });
    return ops;
  }

  // 4. Value updates (primitives / array cells / object properties)
  if (event.type === 'array_update' || event.type === 'var_assign' || event.type === 'property_set') {
    for (const c of event.changes.slice(0, 6)) {
      const elId =
        c.objectId && typeof c.index === 'number'
          ? `${c.objectId}[${c.index}]`
          : c.objectId && c.property
            ? `${c.objectId}.${c.property}`
            : `var:${c.target}`;
      ops.push({
        opId: nextOpId(),
        type: 'UPDATE_VALUE',
        provenance: event.provenance,
        targetStructureId: c.objectId || 'primitives',
        elementIds: [elId],
        label: c.property || c.target,
        oldValue: c.oldValue,
        newValue: c.newValue,
        sourceEventId: event.id,
        sourceLine: event.line,
        description: event.explanation || `Updated ${c.target}`,
      });
    }
    if (ops.length > 0) return ops;
  }

  // 5. Orphaned/unreachable node removal (only when objects disappeared from heap)
  if (prevEvent && orphanedObjectIds.length > 0 && event.changes.length === 0) {
    ops.push({
      opId: nextOpId(),
      type: 'REMOVE_NODE',
      provenance: 'inferred',
      elementIds: [...orphanedObjectIds],
      sourceEventId: event.id,
      sourceLine: event.line,
      description: `Object(s) became unreachable: ${orphanedObjectIds.join(', ')}`,
    });
    return ops;
  }

  // 6. Honest fallback — never fabricate higher-level semantics for generic statements/errors/logs
  ops.push({
    opId: nextOpId(),
    type: 'GENERIC_STATE_CHANGE',
    provenance: event.provenance,
    elementIds: event.changes.map((c) => c.objectId || `var:${c.target}`),
    sourceEventId: event.id,
    sourceLine: event.line,
    description: event.explanation || `Executed ${event.type} at line ${event.line}`,
  });

  return ops;
}

/**
 * Pure, deterministic adapter converting a reconstructed execution frame into
 * the Phase 3 Renderer-Independent Visualization & Animation Contract.
 */
export function buildAnimationFrame(
  frame: ReconstructedFrame,
  prevFrame: ReconstructedFrame | null,
  direction?: TransitionDirection
): AnimationFrameContract {
  const { event, workspace } = frame;
  const prevEvent = prevFrame?.event ?? null;
  const isErrorEvent = event.type === 'error';

  const scenes: AnimationRendererScene[] = [];
  const elements: Record<string, VisualElement> = {};
  const affectedElementIds = new Set<string>();

  const registerElement = (el: VisualElement) => {
    elements[el.elementId] = el;
    if (el.visualState !== 'idle') {
      affectedElementIds.add(el.elementId);
    }
  };

  // 1. Primitives & pointer bindings -> fallback/object primitives scene
  if (workspace.primitives.length > 0) {
    const primIds: string[] = [];
    for (const p of workspace.primitives) {
      const elementId = `var:${p.name}`;
      primIds.push(elementId);
      registerElement({
        elementId,
        structureId: 'primitives',
        elementType: 'primitive',
        label: p.name,
        value: p.value,
        displayValue: p.display,
        visualState: mapStatusToVisualState(p.status, isErrorEvent),
        pointers: [p.name],
        sourceEventId: event.id,
        sourceLine: event.line,
      });
    }
    scenes.push({
      structureId: 'primitives',
      renderer: 'fallback',
      names: ['Memory Boxes'],
      elementIds: primIds,
      relationships: [],
      sharedBy: [],
      metadata: { count: primIds.length },
    });
  }

  // 2. Call Stack / Recursion scene (whenever call stack has > 1 frame or call/return event)
  if (
    frame.callStack.length > 1 ||
    event.type === 'function_call' ||
    event.type === 'function_return'
  ) {
    const frameIds: string[] = [];
    const callRels: VisualRelationship[] = [];
    frame.callStack.forEach((f, idx) => {
      const isTop = idx === frame.callStack.length - 1;
      frameIds.push(f.frameId);
      registerElement({
        elementId: f.frameId,
        structureId: 'call-stack',
        elementType: 'call-frame',
        label: f.name,
        value: f.args ?? {},
        displayValue:
          f.returnValue !== undefined ? `${f.name}() → ${String(f.returnValue)}` : `${f.name}()`,
        visualState: isTop
          ? event.type === 'function_call'
            ? 'created'
            : event.type === 'function_return'
              ? 'updated'
              : 'active'
          : 'idle',
        pointers: isTop ? ['top'] : [],
        positionHint: { depth: idx },
        sourceEventId: event.id,
        sourceLine: f.line,
      });
      if (idx > 0) {
        const parent = frame.callStack[idx - 1];
        callRels.push({
          id: `call:${parent.frameId}->${f.frameId}`,
          kind: 'calls',
          fromId: parent.frameId,
          toId: f.frameId,
          directed: true,
          status: isTop && event.type === 'function_call' ? 'created' : 'unchanged',
        });
      }
    });
    scenes.push({
      structureId: 'call-stack',
      renderer: 'recursion',
      names: ['Call Stack'],
      elementIds: frameIds,
      relationships: callRels,
      sharedBy: [],
      metadata: { depth: frame.callStack.length },
    });
  }

  // 3. Reconstructed Data Structures -> renderer-specific scenes
  for (const struct of workspace.structures) {
    if (struct.kind === 'array') {
      const renderer: AnimationRendererTarget =
        struct.roleHint === 'stack'
          ? 'stack'
          : struct.roleHint === 'queue' || struct.roleHint === 'deque' || struct.roleHint === 'circular-queue'
            ? 'queue'
            : struct.roleHint === 'dp-table'
              ? 'dp-table'
              : struct.roleHint === 'matrix'
                ? 'matrix'
                : struct.roleHint === 'heap'
                  ? 'heap'
                  : 'array';
      const elType: VisualElementType =
        renderer === 'stack'
          ? 'stack-item'
          : renderer === 'queue'
            ? 'queue-item'
            : 'array-cell';
      const elIds: string[] = [];

      if (struct.isMatrix && struct.rows) {
        struct.rows.forEach((row, rIdx) => {
          row.forEach((cell, cIdx) => {
            const elementId = `${struct.objectId}[${rIdx}][${cIdx}]`;
            elIds.push(elementId);
            registerElement({
              elementId,
              structureId: struct.objectId,
              elementType: 'array-cell',
              label: `[${rIdx}][${cIdx}]`,
              value: cell.raw,
              displayValue: cell.display,
              visualState: mapStatusToVisualState(cell.status, isErrorEvent),
              pointers: [],
              positionHint: { row: rIdx, col: cIdx },
              sourceEventId: event.id,
              sourceLine: event.line,
            });
          });
        });
      } else {
        const isSwap = event.type === 'array_swap';
        for (const cell of struct.cells) {
          const elementId = `${struct.objectId}[${cell.index}]`;
          elIds.push(elementId);
          const visualState: VisualElementState =
            isSwap && cell.status === 'changed'
              ? 'swapping'
              : mapStatusToVisualState(cell.status, isErrorEvent);
          registerElement({
            elementId,
            structureId: struct.objectId,
            elementType: elType,
            label: `[${cell.index}]`,
            value: cell.raw,
            displayValue: cell.display,
            visualState,
            pointers: [],
            positionHint: { index: cell.index },
            sourceEventId: event.id,
            sourceLine: event.line,
          });
        }
      }

      scenes.push({
        structureId: struct.objectId,
        renderer,
        names: struct.names,
        elementIds: elIds,
        relationships: [],
        sharedBy: struct.sharedBy,
        metadata: {
          length: struct.length,
          totalLength: struct.totalLength,
          truncated: struct.truncated,
          isMatrix: struct.isMatrix,
        },
      });
      continue;
    }

    if (struct.kind === 'linked-list') {
      const elIds: string[] = [];
      const rels: VisualRelationship[] = [];
      struct.nodes.forEach((node, idx) => {
        elIds.push(node.objectId);
        registerElement({
          elementId: node.objectId,
          structureId: struct.objectId,
          elementType: 'list-node',
          label: node.display,
          value: node.value,
          displayValue: node.display,
          visualState: mapStatusToVisualState(node.status, isErrorEvent),
          pointers: node.pointers,
          positionHint: { index: idx },
          sourceEventId: event.id,
          sourceLine: event.line,
        });
        if (node.nextId) {
          rels.push({
            id: `${node.objectId}:next->${node.nextId}`,
            kind: 'next',
            fromId: node.objectId,
            toId: node.nextId,
            directed: true,
            status: node.status === 'new' ? 'created' : node.status === 'changed' ? 'updated' : 'unchanged',
          });
        }
        if (node.prevId) {
          rels.push({
            id: `${node.objectId}:prev->${node.prevId}`,
            kind: 'prev',
            fromId: node.objectId,
            toId: node.prevId,
            directed: true,
            status: node.status === 'new' ? 'created' : node.status === 'changed' ? 'updated' : 'unchanged',
          });
        }
      });
      scenes.push({
        structureId: struct.objectId,
        renderer: 'linked-list',
        names: struct.names,
        elementIds: elIds,
        relationships: rels,
        sharedBy: struct.sharedBy,
        metadata: {
          isDoublyLinked: struct.isDoublyLinked,
          cycleTargetId: struct.cycleTargetId,
        },
      });
      continue;
    }

    if (struct.kind === 'tree') {
      const elIds: string[] = [];
      const rels: VisualRelationship[] = [];
      for (const node of struct.nodes) {
        elIds.push(node.objectId);
        registerElement({
          elementId: node.objectId,
          structureId: struct.objectId,
          elementType: 'tree-node',
          label: node.display,
          value: node.value,
          displayValue: node.display,
          visualState: mapStatusToVisualState(node.status, isErrorEvent),
          pointers: node.pointers,
          positionHint: { x: node.x, y: node.y, depth: node.y },
          sourceEventId: event.id,
          sourceLine: event.line,
        });
      }
      for (const edge of struct.edges) {
        rels.push({
          id: `${edge.fromId}:${edge.label || 'child'}->${edge.toId}`,
          kind: edge.label === 'L' ? 'left' : edge.label === 'R' ? 'right' : 'child',
          fromId: edge.fromId,
          toId: edge.toId,
          directed: true,
          label: edge.label,
          status: 'unchanged',
        });
      }
      scenes.push({
        structureId: struct.objectId,
        renderer: 'tree',
        names: struct.names,
        elementIds: elIds,
        relationships: rels,
        sharedBy: struct.sharedBy,
        metadata: {
          treeKind: struct.treeKind,
          width: struct.width,
          height: struct.height,
        },
      });
      continue;
    }

    if (struct.kind === 'graph') {
      const elIds: string[] = [];
      const rels: VisualRelationship[] = [];
      for (const node of struct.nodes) {
        elIds.push(node.id);
        registerElement({
          elementId: node.id,
          structureId: struct.objectId,
          elementType: 'graph-vertex',
          label: node.label,
          value: node.label,
          displayValue: node.label,
          visualState: node.visited ? 'visited' : mapStatusToVisualState(node.status, isErrorEvent),
          pointers: node.pointers,
          sourceEventId: event.id,
          sourceLine: event.line,
        });
      }
      struct.edges.forEach((edge, idx) => {
        rels.push({
          id: `${struct.objectId}:edge-${idx}:${edge.fromId}->${edge.toId}`,
          kind: 'edge',
          fromId: edge.fromId,
          toId: edge.toId,
          directed: edge.directed,
          label: edge.label,
          status: 'unchanged',
        });
      });
      scenes.push({
        structureId: struct.objectId,
        renderer: 'graph',
        names: struct.names,
        elementIds: elIds,
        relationships: rels,
        sharedBy: struct.sharedBy,
        metadata: {
          vertexCount: struct.nodes.length,
          edgeCount: struct.edges.length,
          isDirected: struct.isDirected,
          isWeighted: struct.isWeighted,
          isCyclic: struct.isCyclic,
        },
      });
      continue;
    }

    if (struct.kind === 'set') {
      const elIds: string[] = [];
      struct.items.forEach((item, idx) => {
        const elementId = `${struct.objectId}:set[${idx}]`;
        elIds.push(elementId);
        registerElement({
          elementId,
          structureId: struct.objectId,
          elementType: 'set-item',
          label: item.display,
          value: item.raw,
          displayValue: item.display,
          visualState: mapStatusToVisualState(item.status, isErrorEvent),
          pointers: [],
          positionHint: { index: idx },
          sourceEventId: event.id,
          sourceLine: event.line,
        });
      });
      scenes.push({
        structureId: struct.objectId,
        renderer: 'set',
        names: struct.names,
        elementIds: elIds,
        relationships: [],
        sharedBy: struct.sharedBy,
        metadata: { size: struct.size, totalLength: struct.totalLength },
      });
      continue;
    }

    if (struct.kind === 'hash-table') {
      const elIds: string[] = [];
      const rels: VisualRelationship[] = [];
      for (const entry of struct.entries) {
        const elementId = `${struct.objectId}[${entry.key}]`;
        elIds.push(elementId);
        registerElement({
          elementId,
          structureId: struct.objectId,
          elementType: 'hash-entry',
          label: entry.key,
          value: entry.refId ?? entry.display,
          displayValue: entry.display,
          visualState: mapStatusToVisualState(entry.status, isErrorEvent),
          pointers: [],
          sourceEventId: event.id,
          sourceLine: event.line,
        });
        if (entry.refId) {
          rels.push({
            id: `${elementId}->${entry.refId}`,
            kind: 'ref',
            fromId: elementId,
            toId: entry.refId,
            directed: true,
            label: entry.key,
            status: entry.status === 'new' ? 'created' : entry.status === 'changed' ? 'updated' : 'unchanged',
          });
        }
      }
      scenes.push({
        structureId: struct.objectId,
        renderer: 'hash-table',
        names: struct.names,
        elementIds: elIds,
        relationships: rels,
        sharedBy: struct.sharedBy,
        metadata: { className: struct.className, count: elIds.length },
      });
      continue;
    }

    // Generic Object renderer
    const elIds: string[] = [];
    const rels: VisualRelationship[] = [];
    for (const field of struct.fields) {
      const elementId = `${struct.objectId}.${field.key}`;
      elIds.push(elementId);
      registerElement({
        elementId,
        structureId: struct.objectId,
        elementType: 'object-field',
        label: field.key,
        value: field.refId ?? field.display,
        displayValue: field.display,
        visualState: mapStatusToVisualState(field.status, isErrorEvent),
        pointers: [],
        sharedRefCount: struct.sharedBy.length,
        sourceEventId: event.id,
        sourceLine: event.line,
      });
      if (field.refId) {
        rels.push({
          id: `${elementId}->${field.refId}`,
          kind: 'ref',
          fromId: elementId,
          toId: field.refId,
          directed: true,
          label: field.key,
          status: field.status === 'new' ? 'created' : field.status === 'changed' ? 'updated' : 'unchanged',
        });
      }
    }
    scenes.push({
      structureId: struct.objectId,
      renderer: 'object',
      names: struct.names,
      elementIds: elIds,
      relationships: rels,
      sharedBy: struct.sharedBy,
      metadata: { className: struct.className },
    });
  }

  const operations = deriveSemanticOperations(event, prevEvent, workspace.orphanedObjectIds);
  const resolvedDirection: TransitionDirection =
    direction ??
    (prevFrame === null
      ? 'initial'
      : frame.index === prevFrame.index + 1
        ? 'forward'
        : frame.index === prevFrame.index - 1
          ? 'backward'
          : 'jump');

  const hasSwapOrCall = operations.some(
    (op) => op.type === 'SWAP' || op.type === 'CALL_FUNCTION' || op.type === 'RETURN_FUNCTION'
  );

  return {
    contractVersion: '3.0-draft',
    frameIndex: frame.index,
    totalFrames: frame.total,
    sourceEventId: event.id,
    sourceEventType: event.type,
    sourceLine: event.line,
    executionMode: frame.executionMode,
    scenes,
    elements,
    operations,
    transition: {
      fromFrameIndex: prevFrame ? prevFrame.index : null,
      toFrameIndex: frame.index,
      direction: resolvedDirection,
      durationHintMs: resolvedDirection === 'jump' ? 120 : hasSwapOrCall ? 320 : 220,
      easingHint: hasSwapOrCall ? 'spring' : 'ease-out',
      affectedElementIds: [...affectedElementIds],
      orphanedObjectIds: [...workspace.orphanedObjectIds],
    },
  };
}
