import {
  isObjectRef,
  type HeapObject,
  type TraceEvent,
  type ValueRef,
} from '../types/trace';

export type ChangeStatus = 'new' | 'changed' | 'unchanged';

export interface ReconstructedPrimitive {
  name: string;
  value: string | number | boolean | null;
  typeTag: 'int' | 'float' | 'string' | 'boolean' | 'null' | 'ref';
  display: string;
  status: ChangeStatus;
}

export interface ReconstructedArrayCell {
  index: number;
  raw: ValueRef;
  display: string;
  status: ChangeStatus;
}

export type ArrayRoleHint =
  | 'array'
  | 'matrix'
  | 'dp-table'
  | 'stack'
  | 'queue'
  | 'deque'
  | 'circular-queue'
  | 'heap'
  | 'disjoint-set';

export interface ReconstructedArray {
  kind: 'array';
  objectId: string;
  names: string[];
  length: number;
  totalLength: number;
  truncated: boolean;
  isMatrix: boolean;
  roleHint: ArrayRoleHint;
  heapOrder?: 'min-heap' | 'max-heap';
  cells: ReconstructedArrayCell[];
  rows?: ReconstructedArrayCell[][];
  sharedBy: string[];
  status: ChangeStatus;
}

export interface ReconstructedSetItem {
  display: string;
  raw: ValueRef;
  status: ChangeStatus;
}

export interface ReconstructedSet {
  kind: 'set';
  objectId: string;
  names: string[];
  size: number;
  totalLength: number;
  truncated: boolean;
  items: ReconstructedSetItem[];
  sharedBy: string[];
  status: ChangeStatus;
}

export interface ReconstructedHashEntry {
  key: string;
  display: string;
  refId?: string;
  status: ChangeStatus;
}

export interface ReconstructedHashTable {
  kind: 'hash-table';
  objectId: string;
  names: string[];
  className?: string;
  entries: ReconstructedHashEntry[];
  sharedBy: string[];
  status: ChangeStatus;
}

export interface ReconstructedListNode {
  objectId: string;
  value: unknown;
  display: string;
  prevId: string | null;
  nextId: string | null;
  pointers: string[];
  status: ChangeStatus;
}

export interface ReconstructedLinkedList {
  kind: 'linked-list';
  objectId: string;
  names: string[];
  className?: string;
  isDoublyLinked: boolean;
  isCircular: boolean;
  nodes: ReconstructedListNode[];
  cycleTargetId: string | null;
  sharedBy: string[];
  status: ChangeStatus;
}

export interface ReconstructedTreeNode {
  objectId: string;
  value: unknown;
  display: string;
  x: number;
  y: number;
  pointers: string[];
  metaTag?: string;
  status: ChangeStatus;
}

export interface ReconstructedTreeEdge {
  fromId: string;
  toId: string;
  label?: string;
}

export type TreeVariant = 'binary' | 'bst' | 'avl' | 'red-black' | 'trie' | 'general';

export interface ReconstructedTree {
  kind: 'tree';
  objectId: string;
  names: string[];
  className?: string;
  treeKind: 'binary' | 'general';
  treeVariant: TreeVariant;
  nodes: ReconstructedTreeNode[];
  edges: ReconstructedTreeEdge[];
  width: number;
  height: number;
  sharedBy: string[];
  status: ChangeStatus;
}

export interface ReconstructedGraphNode {
  id: string;
  label: string;
  visited: boolean;
  pointers: string[];
  status: ChangeStatus;
}

export interface ReconstructedGraphEdge {
  fromId: string;
  toId: string;
  directed: boolean;
  label?: string;
}

export interface ReconstructedGraph {
  kind: 'graph';
  objectId: string;
  names: string[];
  nodes: ReconstructedGraphNode[];
  edges: ReconstructedGraphEdge[];
  isDirected: boolean;
  isWeighted: boolean;
  isCyclic: boolean;
  isDisconnected: boolean;
  representation: 'adjacency-list' | 'adjacency-matrix' | 'object-graph';
  sharedBy: string[];
  status: ChangeStatus;
}

export interface ReconstructedObjectField {
  key: string;
  display: string;
  refId?: string;
  status: ChangeStatus;
}

export interface ReconstructedObject {
  kind: 'object';
  objectId: string;
  names: string[];
  className?: string;
  fields: ReconstructedObjectField[];
  sharedBy: string[];
  status: ChangeStatus;
}

export type ReconstructedStructure =
  | ReconstructedArray
  | ReconstructedSet
  | ReconstructedHashTable
  | ReconstructedLinkedList
  | ReconstructedTree
  | ReconstructedGraph
  | ReconstructedObject;

export interface ReconstructedWorkspaceState {
  primitives: ReconstructedPrimitive[];
  structures: ReconstructedStructure[];
  sharedObjectIds: string[];
  orphanedObjectIds: string[];
}

function formatRefValue(ref: ValueRef, heap: Record<string, HeapObject>): string {
  if (ref === null || ref === undefined) return '∅';
  if (typeof ref === 'string') return `"${ref}"`;
  if (typeof ref === 'number' || typeof ref === 'boolean') return String(ref);
  if (isObjectRef(ref)) {
    const obj = heap[ref.__ref];
    if (!obj) return ref.__ref;
    if (obj.kind === 'array') return `Array(${obj.totalLength ?? obj.elements?.length ?? 0})`;
    if (obj.kind === 'set') return `Set(${obj.totalLength ?? obj.elements?.length ?? 0})`;
    if (obj.kind === 'map') return `Map(${obj.totalLength ?? Object.keys(obj.entries || {}).length})`;
    const val = extractNodeLabel(obj, heap);
    return val !== '•' ? `${obj.className || 'Node'}(${val})` : ref.__ref;
  }
  return String(ref);
}

function extractNodeLabel(
  obj: HeapObject,
  heap: Record<string, HeapObject>,
  ignoredKeys?: Set<string>
): string {
  const entries = obj.entries || {};
  for (const key of ['value', 'val', 'data', 'key', 'k', 'id', 'name', 'label', 'ch', 'char', 'freq', 'weight']) {
    if (key in entries && !ignoredKeys?.has(key)) {
      const v = entries[key];
      if (!isObjectRef(v) && v !== null) {
        return typeof v === 'string' ? v : String(v);
      }
    }
  }
  for (const [key, v] of Object.entries(entries)) {
    if (
      !isObjectRef(v) &&
      !ignoredKeys?.has(key) &&
      key !== 'left' &&
      key !== 'right' &&
      key !== 'next' &&
      key !== 'prev' &&
      key !== 'children' &&
      key !== 'neighbors' &&
      key !== 'edges' &&
      key !== 'height' &&
      key !== 'color' &&
      key !== 'isEnd' &&
      key !== 'endOfWord'
    ) {
      return v === null ? '∅' : typeof v === 'string' ? v : String(v);
    }
  }
  void heap;
  return '•';
}

function isNullOrObjectNodeRef(v: ValueRef | undefined, heap: Record<string, HeapObject>): boolean {
  if (v === null) return true;
  if (isObjectRef(v)) {
    const target = heap[v.__ref];
    return Boolean(target && target.kind === 'object');
  }
  return false;
}

function isTrieNode(obj: HeapObject | undefined, heap: Record<string, HeapObject>): boolean {
  if (!obj || obj.kind !== 'object') return false;
  const e = obj.entries || {};
  const hasEndFlag =
    typeof e.isEnd === 'boolean' ||
    typeof e.endOfWord === 'boolean' ||
    typeof e.isWord === 'boolean' ||
    typeof e.terminal === 'boolean';
  const childMapRef = e.children ?? e.kids ?? e.next;
  if (!hasEndFlag || !childMapRef || !isObjectRef(childMapRef)) return false;
  const mapObj = heap[childMapRef.__ref];
  return Boolean(mapObj && (mapObj.kind === 'object' || mapObj.kind === 'map'));
}

function isBinaryOrNaryTreeNode(obj: HeapObject | undefined, heap: Record<string, HeapObject>): boolean {
  if (!obj || obj.kind !== 'object') return false;
  if (isTrieNode(obj, heap)) return true;
  const e = obj.entries || {};

  // Binary tree check: left/right must ONLY be null or ObjectRef -> object (never primitive numbers like CSS rects!)
  if ('left' in e || 'right' in e) {
    if ('top' in e && 'bottom' in e) return false;
    const leftOk = !('left' in e) || isNullOrObjectNodeRef(e.left, heap);
    const rightOk = !('right' in e) || isNullOrObjectNodeRef(e.right, heap);
    return leftOk && rightOk;
  }

  // N-ary general tree check: children must be a ref to an array of object refs (or empty array)
  if ('children' in e && isObjectRef(e.children)) {
    const childrenArr = heap[e.children.__ref];
    if (!childrenArr || childrenArr.kind !== 'array') return false;
    const els = childrenArr.elements || [];
    if (els.length === 0) {
      return Object.keys(e).some((k) => k !== 'children');
    }
    return els.every((el) => isObjectRef(el) && heap[el.__ref]?.kind === 'object');
  }

  return false;
}

function isLinkedNode(obj: HeapObject | undefined, heap: Record<string, HeapObject>): boolean {
  if (!obj || obj.kind !== 'object') return false;
  if (isTrieNode(obj, heap)) return false;
  const e = obj.entries || {};
  if ('left' in e || 'right' in e) return false;
  if (!('next' in e) && !('prev' in e)) return false;
  const nextOk = !('next' in e) || isNullOrObjectNodeRef(e.next, heap);
  const prevOk = !('prev' in e) || isNullOrObjectNodeRef(e.prev, heap);
  return nextOk && prevOk;
}

/**
 * Name-independent topology recognition (Phase 4 §5):
 * Recognizes binary trees, general trees, linked lists, and object graphs even when
 * user-defined classes/fields use completely arbitrary names (e.g. `p1`, `p2`, `nxt`, `Gizmo`).
 */
interface ArbitraryTopologyMatch {
  kind: 'tree' | 'linked-list' | 'graph';
  pointerKeys: string[];
  isDoublyLinked?: boolean;
}

function detectArbitraryObjectTopology(
  rootId: string,
  heap: Record<string, HeapObject>
): ArbitraryTopologyMatch | null {
  const root = heap[rootId];
  if (!root || root.kind !== 'object') return null;
  const rootEntries = root.entries || {};
  const rootKeys = Object.keys(rootEntries);
  if (rootKeys.length === 0) return null;

  // Candidate pointer keys: fields on root that point to another object of same class or same key signature
  const matchesNodeShape = (candidate: HeapObject): boolean => {
    if (candidate.kind !== 'object') return false;
    if (root.className && candidate.className) {
      return root.className === candidate.className;
    }
    const candKeys = Object.keys(candidate.entries || {});
    if (candKeys.length !== rootKeys.length) return false;
    return rootKeys.every((k) => k in (candidate.entries || {}));
  };

  // Find keys that are either ObjectRef -> same-shape object, or null (when another reachable node uses that key as ref)
  const initialRefKeys = new Set<string>();
  const nullableKeys = new Set<string>();
  for (const [k, v] of Object.entries(rootEntries)) {
    if (isObjectRef(v) && heap[v.__ref] && matchesNodeShape(heap[v.__ref])) {
      initialRefKeys.add(k);
    } else if (v === null) {
      nullableKeys.add(k);
    }
  }

  if (initialRefKeys.size === 0) return null;

  // BFS reachable same-shape nodes to determine exact pointer keys and graph topology
  const pointerKeys = new Set<string>(initialRefKeys);
  const visited = new Set<string>([rootId]);
  const queue = [rootId];
  const edges: Array<{ from: string; to: string; key: string }> = [];
  const inDegree = new Map<string, number>([[rootId, 0]]);
  let hasCycle = false;

  while (queue.length > 0 && visited.size < 64) {
    const curId = queue.shift()!;
    const curObj = heap[curId];
    if (!curObj?.entries) continue;

    for (const [k, v] of Object.entries(curObj.entries)) {
      if (isObjectRef(v) && heap[v.__ref] && matchesNodeShape(heap[v.__ref])) {
        if (nullableKeys.has(k) || pointerKeys.has(k)) {
          pointerKeys.add(k);
        }
        if (pointerKeys.has(k)) {
          edges.push({ from: curId, to: v.__ref, key: k });
          inDegree.set(v.__ref, (inDegree.get(v.__ref) || 0) + 1);
          if (visited.has(v.__ref)) {
            hasCycle = true;
          } else {
            visited.add(v.__ref);
            queue.push(v.__ref);
          }
        }
      }
    }
  }

  if (visited.size < 2) return null;

  // Include any remaining nullable keys ONLY if root has at least 1 active pointer key and
  // the nullable key is never used as a non-null primitive on any visited node.
  for (const nk of nullableKeys) {
    let allNullOrNode = true;
    for (const nid of visited) {
      const val = heap[nid]?.entries?.[nk];
      if (val !== null && !(isObjectRef(val) && heap[val.__ref] && matchesNodeShape(heap[val.__ref]))) {
        allNullOrNode = false;
        break;
      }
    }
    if (allNullOrNode) {
      pointerKeys.add(nk);
    }
  }

  const ptrList = [...pointerKeys];

  // Check if all visited nodes have at most 1 outgoing edge along a primary key -> Linked List!
  if (ptrList.length === 1) {
    return { kind: 'linked-list', pointerKeys: ptrList, isDoublyLinked: false };
  }

  // Check doubly linked list: 2 pointer keys where one key consistently points back to parent (A.k1 = B and B.k2 = A)
  if (ptrList.length === 2) {
    const [k1, k2] = ptrList;
    let backLinks = 0;
    for (const e of edges) {
      if (e.key === k1) {
        const rev = heap[e.to]?.entries?.[k2];
        if (isObjectRef(rev) && rev.__ref === e.from) backLinks++;
      } else if (e.key === k2) {
        const rev = heap[e.to]?.entries?.[k1];
        if (isObjectRef(rev) && rev.__ref === e.from) backLinks++;
      }
    }
    if (backLinks > 0) {
      return { kind: 'linked-list', pointerKeys: ptrList, isDoublyLinked: true };
    }
  }

  const hasMultiParent = [...inDegree.values()].some((d) => d > 1);
  if (hasCycle || hasMultiParent) {
    return { kind: 'graph', pointerKeys: ptrList };
  }

  // Acyclic rooted structure with >=2 pointer slots -> Tree (binary if <=2 pointer keys, general if >2)
  return { kind: 'tree', pointerKeys: ptrList };
}

function isAdjacencyMapGraph(obj: HeapObject, heap: Record<string, HeapObject>): boolean {
  if (obj.kind !== 'object' && obj.kind !== 'map') return false;
  if (isBinaryOrNaryTreeNode(obj, heap) || isLinkedNode(obj, heap)) return false;
  const entries = Object.entries(obj.entries || {});
  if (entries.length < 2) return false;

  const vertexKeys = new Set(entries.map(([k]) => k));
  let arrayValues = 0;
  let internalEdges = 0;

  for (const [, v] of entries) {
    if (!isObjectRef(v)) return false;
    const target = heap[v.__ref];
    if (!target || (target.kind !== 'array' && target.kind !== 'set')) return false;
    arrayValues++;
    for (const el of target.elements || []) {
      const keyStr = isObjectRef(el) ? null : el === null ? null : String(el);
      if (keyStr && vertexKeys.has(keyStr)) {
        internalEdges++;
      } else if (isObjectRef(el)) {
        const edgeObj = heap[el.__ref];
        const toVal = edgeObj?.entries?.to ?? edgeObj?.entries?.node ?? edgeObj?.entries?.target;
        if (toVal !== undefined && !isObjectRef(toVal) && vertexKeys.has(String(toVal))) {
          internalEdges++;
        } else if (edgeObj?.kind === 'array' && (edgeObj.elements?.length ?? 0) >= 2) {
          // Weighted tuple edge e.g. ['B', 4]
          const first = edgeObj.elements![0];
          if (!isObjectRef(first) && first !== null && vertexKeys.has(String(first))) {
            internalEdges++;
          }
        }
      }
    }
  }

  return arrayValues === entries.length && internalEdges >= 1;
}

function isObjectGraphNode(obj: HeapObject | undefined, heap: Record<string, HeapObject>): boolean {
  if (!obj || obj.kind !== 'object') return false;
  const e = obj.entries || {};
  const listRef = e.neighbors ?? e.adj ?? e.edges;
  if (!listRef || !isObjectRef(listRef)) return false;
  const listObj = heap[listRef.__ref];
  return Boolean(listObj && (listObj.kind === 'array' || listObj.kind === 'set'));
}

function isHashTableObject(
  obj: HeapObject,
  names: string[],
  heap: Record<string, HeapObject>
): boolean {
  if (obj.kind === 'map') return true;
  if (obj.kind !== 'object') return false;
  if (obj.className && obj.className !== 'Object' && obj.className !== 'dict') return false;
  const entries = Object.entries(obj.entries || {});
  if (entries.length === 0) return false;
  const joined = names.join(' ').toLowerCase();
  if (/\b(map|dict|hash|freq|count|counts|cache|memo|lookup|table|index|seen|dist|distances|scores|weights)\b/.test(joined)) {
    return true;
  }
  void heap;
  return false;
}

function checkHeapProperty(elements: ValueRef[]): 'min-heap' | 'max-heap' | undefined {
  if (elements.length < 2) return undefined;
  if (!elements.every((el) => typeof el === 'number')) return undefined;
  const nums = elements as number[];
  let isMin = true;
  let isMax = true;
  for (let i = 0; i < nums.length; i++) {
    const l = 2 * i + 1;
    const r = 2 * i + 2;
    if (l < nums.length) {
      if (nums[i] > nums[l]) isMin = false;
      if (nums[i] < nums[l]) isMax = false;
    }
    if (r < nums.length) {
      if (nums[i] > nums[r]) isMin = false;
      if (nums[i] < nums[r]) isMax = false;
    }
  }
  if (isMin) return 'min-heap';
  if (isMax) return 'max-heap';
  return undefined;
}

function inferArrayRoleHint(
  names: string[],
  isMatrix: boolean,
  elements: ValueRef[],
  event: TraceEvent
): { roleHint: ArrayRoleHint; heapOrder?: 'min-heap' | 'max-heap' } {
  const joined = names.join(' ').toLowerCase();
  if (isMatrix) {
    if (/\b(dp|memo|table|lcs|knapsack|dist|cost|ways|edit)\b/.test(joined)) {
      return { roleHint: 'dp-table' };
    }
    return { roleHint: 'matrix' };
  }
  if (/\b(dp|memo|fib|ways|coins|cost)\b/.test(joined)) {
    return { roleHint: 'dp-table' };
  }
  if (/\b(heap|pq|priority|minheap|maxheap)\b/.test(joined)) {
    return { roleHint: 'heap', heapOrder: checkHeapProperty(elements) };
  }
  if (/\b(deque)\b/.test(joined)) {
    return { roleHint: 'deque' };
  }
  if (/\b(circular|ring)\b/.test(joined)) {
    return { roleHint: 'circular-queue' };
  }
  if (/\b(parent|dsu|uf|disjoint)\b/.test(joined)) {
    return { roleHint: 'disjoint-set' };
  }
  if (
    /\b(queue|fifo|q|bfs)\b/.test(joined) ||
    event.metadata?.arrayOp === 'shift' ||
    event.metadata?.arrayOp === 'unshift'
  ) {
    return { roleHint: 'queue' };
  }
  if (/\b(stack|stk|lifo)\b/.test(joined)) {
    return { roleHint: 'stack' };
  }
  return { roleHint: 'array' };
}

function analyzeGraphProperties(
  nodes: ReconstructedGraphNode[],
  edges: ReconstructedGraphEdge[]
): { isDirected: boolean; isWeighted: boolean; isCyclic: boolean; isDisconnected: boolean } {
  const isWeighted = edges.some((e) => Boolean(e.label));
  const edgeSet = new Set(edges.map((e) => `${e.fromId}=>${e.toId}`));
  const allSymmetric =
    edges.length > 0 && edges.every((e) => edgeSet.has(`${e.toId}=>${e.fromId}`));
  const isDirected = edges.length > 0 ? !allSymmetric : false;

  // Cycle detection via DFS
  const adj = new Map<string, string[]>();
  const undirAdj = new Map<string, string[]>();
  for (const n of nodes) {
    adj.set(n.id, []);
    undirAdj.set(n.id, []);
  }
  for (const e of edges) {
    adj.get(e.fromId)?.push(e.toId);
    undirAdj.get(e.fromId)?.push(e.toId);
    undirAdj.get(e.toId)?.push(e.fromId);
  }

  let isCyclic = false;
  const state = new Map<string, number>(); // 0=unvisited, 1=visiting, 2=done
  const dfsCycle = (u: string, parent: string | null) => {
    state.set(u, 1);
    const neighbors = isDirected ? adj.get(u) || [] : undirAdj.get(u) || [];
    for (const v of neighbors) {
      if (!isDirected && v === parent) continue;
      const st = state.get(v) || 0;
      if (st === 1) {
        isCyclic = true;
      } else if (st === 0) {
        dfsCycle(v, u);
      }
    }
    state.set(u, 2);
  };
  for (const n of nodes) {
    if ((state.get(n.id) || 0) === 0) {
      dfsCycle(n.id, null);
    }
  }

  // Disconnected check on undirected projection
  let isDisconnected = false;
  if (nodes.length > 1) {
    const reach = new Set<string>([nodes[0].id]);
    const q = [nodes[0].id];
    while (q.length > 0) {
      const cur = q.shift()!;
      for (const nb of undirAdj.get(cur) || []) {
        if (!reach.has(nb)) {
          reach.add(nb);
          q.push(nb);
        }
      }
    }
    isDisconnected = reach.size < nodes.length;
  }

  return { isDirected, isWeighted, isCyclic, isDisconnected };
}

function checkIsBst(
  rootId: string,
  leftKey: string,
  rightKey: string,
  heap: Record<string, HeapObject>,
  ignoredKeys?: Set<string>
): boolean {
  let numericCount = 0;
  const validate = (id: string | null, min: number, max: number, depth: number): boolean => {
    if (!id || depth > 14) return true;
    const obj = heap[id];
    if (!obj?.entries) return true;
    const rawLabel = extractNodeLabel(obj, heap, ignoredKeys);
    const num = Number(rawLabel);
    if (!Number.isFinite(num)) return false;
    numericCount++;
    if (num <= min || num >= max) return false;
    const lRef = obj.entries[leftKey];
    const rRef = obj.entries[rightKey];
    const lId = lRef && isObjectRef(lRef) && heap[lRef.__ref] ? lRef.__ref : null;
    const rId = rRef && isObjectRef(rRef) && heap[rRef.__ref] ? rRef.__ref : null;
    return validate(lId, min, num, depth + 1) && validate(rId, num, max, depth + 1);
  };
  const ok = validate(rootId, -Infinity, Infinity, 0);
  return ok && numericCount >= 3;
}

function collectVisitedLabels(
  locals: Record<string, ValueRef>,
  heap: Record<string, HeapObject>
): Set<string> {
  const visited = new Set<string>();
  for (const [name, ref] of Object.entries(locals)) {
    if (!/visit|seen|explored|closed/i.test(name)) continue;
    if (!isObjectRef(ref)) continue;
    const obj = heap[ref.__ref];
    if (!obj) continue;
    if (obj.kind === 'set' || obj.kind === 'array') {
      for (const el of obj.elements || []) {
        if (isObjectRef(el)) visited.add(el.__ref);
        else if (el !== null) visited.add(String(el));
      }
    } else if (obj.kind === 'object' || obj.kind === 'map') {
      for (const [k, v] of Object.entries(obj.entries || {})) {
        if (v) visited.add(k);
      }
    }
  }
  return visited;
}

function sameValueRef(a: ValueRef | undefined, b: ValueRef | undefined): boolean {
  if (a === b) return true;
  if (isObjectRef(a) && isObjectRef(b)) return a.__ref === b.__ref;
  return false;
}

function heapObjectsEqual(a: HeapObject | undefined, b: HeapObject | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.kind !== b.kind || a.className !== b.className || a.totalLength !== b.totalLength) return false;
  if (a.elements || b.elements) {
    const ae = a.elements || [];
    const be = b.elements || [];
    if (ae.length !== be.length) return false;
    for (let i = 0; i < ae.length; i++) {
      if (!sameValueRef(ae[i], be[i])) return false;
    }
  }
  if (a.entries || b.entries) {
    const aKeys = Object.keys(a.entries || {});
    const bKeys = Object.keys(b.entries || {});
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) {
      if (!sameValueRef(a.entries?.[k], b.entries?.[k])) return false;
    }
  }
  return true;
}

function getObjectStatus(
  oid: string,
  heap: Record<string, HeapObject>,
  prevHeap: Record<string, HeapObject>
): ChangeStatus {
  const curr = heap[oid];
  const prev = prevHeap[oid];
  if (!prev) return 'new';
  return !heapObjectsEqual(curr, prev) ? 'changed' : 'unchanged';
}

/**
 * Dynamically reconstructs visualization-ready data structures from a TraceEvent's
 * runtime locals & stable-ID heap.
 *
 * Phase 4 upgrades:
 * - Name-independent topology recognition for trees, linked lists, and object graphs
 * - Trie, BST, AVL, Red-Black, Circular Linked List, Set, Hash Table, DP Table, Heap,
 *   and Adjacency Matrix Graph detection from actual runtime structure
 * - Zero object duplication across unrelated structures
 */
export function reconstructWorkspaceState(
  event: TraceEvent,
  prevEvent: TraceEvent | null
): ReconstructedWorkspaceState {
  const heap = event.heap || {};
  const prevHeap = prevEvent?.heap || {};
  const locals = event.locals || {};
  const prevLocals = prevEvent?.locals || {};

  const namesByObjectId = new Map<string, string[]>();
  const incomingRefsByObjectId = new Map<string, string[]>();

  const addIncoming = (targetId: string, sourceLabel: string) => {
    const list = incomingRefsByObjectId.get(targetId) || [];
    list.push(sourceLabel);
    incomingRefsByObjectId.set(targetId, list);
  };

  for (const [varName, ref] of Object.entries(locals)) {
    if (isObjectRef(ref)) {
      const list = namesByObjectId.get(ref.__ref) || [];
      list.push(varName);
      namesByObjectId.set(ref.__ref, list);
      addIncoming(ref.__ref, varName);
    }
  }

  for (const [oid, obj] of Object.entries(heap)) {
    const owner = namesByObjectId.get(oid)?.[0] || oid;
    if (obj.entries) {
      for (const [prop, val] of Object.entries(obj.entries)) {
        if (isObjectRef(val) && heap[val.__ref]) {
          addIncoming(val.__ref, `${owner}.${prop}`);
        }
      }
    }
    if (obj.elements) {
      for (let idx = 0; idx < obj.elements.length; idx++) {
        const val = obj.elements[idx];
        if (isObjectRef(val) && heap[val.__ref]) {
          addIncoming(val.__ref, `${owner}[${idx}]`);
        }
      }
    }
  }

  const sharedObjectIds: string[] = [];
  for (const [oid, refs] of incomingRefsByObjectId.entries()) {
    if (refs.length > 1) {
      sharedObjectIds.push(oid);
    }
  }

  const orphanedObjectIds: string[] = [];
  if (prevEvent) {
    for (const prevOid of Object.keys(prevHeap)) {
      if (!(prevOid in heap)) {
        orphanedObjectIds.push(prevOid);
      }
    }
  }

  const visitedLabels = collectVisitedLabels(locals, heap);
  const primitives: ReconstructedPrimitive[] = [];
  const structures: ReconstructedStructure[] = [];

  // Cache arbitrary topology detections per root objectId
  const arbitraryTopologyById = new Map<string, ArbitraryTopologyMatch | null>();
  const getArbitraryTopology = (oid: string): ArbitraryTopologyMatch | null => {
    if (!arbitraryTopologyById.has(oid)) {
      arbitraryTopologyById.set(oid, detectArbitraryObjectTopology(oid, heap));
    }
    return arbitraryTopologyById.get(oid) || null;
  };

  const isAnyTreeRoot = (oid: string): boolean => {
    const o = heap[oid];
    if (isBinaryOrNaryTreeNode(o, heap)) return true;
    return getArbitraryTopology(oid)?.kind === 'tree';
  };

  const isAnyListRoot = (oid: string): boolean => {
    const o = heap[oid];
    if (isLinkedNode(o, heap)) return true;
    return getArbitraryTopology(oid)?.kind === 'linked-list';
  };

  // Pre-compute reachable interior nodes so pointer variables pointing inside
  // a tree or linked list annotate the node instead of duplicating the structure.
  const childContainedInTree = new Set<string>();
  const childContainedInList = new Set<string>();

  for (const [, ref] of Object.entries(locals)) {
    if (!isObjectRef(ref)) continue;
    const rootId = ref.__ref;
    const rootObj = heap[rootId];
    if (!rootObj) continue;

    if (isBinaryOrNaryTreeNode(rootObj, heap)) {
      const seen = new Set<string>([rootObj.id]);
      const queue = [rootObj.id];
      while (queue.length > 0) {
        const curId = queue.shift()!;
        const cur = heap[curId];
        if (!cur?.entries) continue;
        for (const k of ['left', 'right']) {
          const childRef = cur.entries[k];
          if (isObjectRef(childRef) && heap[childRef.__ref] && !seen.has(childRef.__ref)) {
            seen.add(childRef.__ref);
            childContainedInTree.add(childRef.__ref);
            queue.push(childRef.__ref);
          }
        }
        const childrenRef = cur.entries.children;
        if (isObjectRef(childrenRef) && heap[childrenRef.__ref]?.elements) {
          for (const el of heap[childrenRef.__ref].elements || []) {
            if (isObjectRef(el) && heap[el.__ref] && !seen.has(el.__ref)) {
              seen.add(el.__ref);
              childContainedInTree.add(el.__ref);
              queue.push(el.__ref);
            }
          }
        }
      }
    } else if (isLinkedNode(rootObj, heap)) {
      const seen = new Set<string>([rootObj.id]);
      let nextRef = rootObj.entries?.next;
      let guard = 0;
      while (nextRef && isObjectRef(nextRef) && heap[nextRef.__ref] && guard++ < 48) {
        if (seen.has(nextRef.__ref)) break;
        seen.add(nextRef.__ref);
        childContainedInList.add(nextRef.__ref);
        nextRef = heap[nextRef.__ref].entries?.next;
      }
    } else {
      const topo = getArbitraryTopology(rootId);
      if (topo?.kind === 'tree') {
        const seen = new Set<string>([rootId]);
        const queue = [rootId];
        while (queue.length > 0) {
          const curId = queue.shift()!;
          const cur = heap[curId];
          if (!cur?.entries) continue;
          for (const k of topo.pointerKeys) {
            const childRef = cur.entries[k];
            if (isObjectRef(childRef) && heap[childRef.__ref] && !seen.has(childRef.__ref)) {
              seen.add(childRef.__ref);
              childContainedInTree.add(childRef.__ref);
              queue.push(childRef.__ref);
            }
          }
        }
      } else if (topo?.kind === 'linked-list') {
        const seen = new Set<string>([rootId]);
        const fwdKey = topo.pointerKeys[0];
        let nextRef = rootObj.entries?.[fwdKey];
        let guard = 0;
        while (nextRef && isObjectRef(nextRef) && heap[nextRef.__ref] && guard++ < 48) {
          if (seen.has(nextRef.__ref)) break;
          seen.add(nextRef.__ref);
          childContainedInList.add(nextRef.__ref);
          nextRef = heap[nextRef.__ref].entries?.[fwdKey];
        }
      }
    }
  }

  const renderedObjectIds = new Set<string>();

  for (const [varName, ref] of Object.entries(locals)) {
    const prevRef = prevLocals[varName];
    const bindingStatus: ChangeStatus = !(varName in prevLocals)
      ? 'new'
      : !sameValueRef(prevRef, ref)
        ? 'changed'
        : 'unchanged';

    if (!isObjectRef(ref)) {
      let typeTag: ReconstructedPrimitive['typeTag'] = 'null';
      if (typeof ref === 'number') typeTag = Number.isInteger(ref) ? 'int' : 'float';
      else if (typeof ref === 'string') typeTag = 'string';
      else if (typeof ref === 'boolean') typeTag = 'boolean';
      primitives.push({
        name: varName,
        value: ref,
        typeTag,
        display: formatRefValue(ref, heap),
        status: bindingStatus,
      });
      continue;
    }

    const oid = ref.__ref;
    const obj = heap[oid];
    if (!obj) continue;

    if (
      (childContainedInTree.has(oid) &&
        [...namesByObjectId.keys()].some(
          (otherId) => otherId !== oid && !childContainedInTree.has(otherId) && isAnyTreeRoot(otherId)
        )) ||
      (childContainedInList.has(oid) &&
        [...namesByObjectId.keys()].some(
          (otherId) => otherId !== oid && !childContainedInList.has(otherId) && isAnyListRoot(otherId)
        ))
    ) {
      primitives.push({
        name: varName,
        value: oid,
        typeTag: 'ref',
        display: `→ ${extractNodeLabel(obj, heap)} (${oid})`,
        status: bindingStatus,
      });
      continue;
    }

    if (renderedObjectIds.has(oid)) {
      continue;
    }
    renderedObjectIds.add(oid);

    const names = namesByObjectId.get(oid) || [varName];
    const sharedBy = incomingRefsByObjectId.get(oid) || names;
    const objStatus = getObjectStatus(oid, heap, prevHeap);

    // 1. Explicit Set structure
    if (obj.kind === 'set') {
      const elements = obj.elements || [];
      const prevEls = prevHeap[oid]?.elements || [];
      const prevDisplays = new Set(prevEls.map((e) => formatRefValue(e, prevHeap)));
      const totalLength = obj.totalLength ?? elements.length;
      const truncated = Boolean(obj.truncated || totalLength > elements.length);
      const items: ReconstructedSetItem[] = elements.map((el) => {
        const display = formatRefValue(el, heap);
        return {
          raw: el,
          display,
          status: prevHeap[oid] && !prevDisplays.has(display) ? 'new' : objStatus === 'new' ? 'new' : 'unchanged',
        };
      });
      structures.push({
        kind: 'set',
        objectId: oid,
        names,
        size: elements.length,
        totalLength,
        truncated,
        items,
        sharedBy,
        status: objStatus,
      });
      continue;
    }

    // 2. Arrays, Matrices, DP Tables, Stacks, Queues, Heaps, & Adjacency Matrix Graphs
    if (obj.kind === 'array') {
      const elements = obj.elements || [];
      const prevEls = prevHeap[oid]?.elements || [];
      const isMatrix =
        elements.length > 0 &&
        elements.every((el) => isObjectRef(el) && heap[el.__ref]?.kind === 'array');
      const totalLength = obj.totalLength ?? elements.length;
      const truncated = Boolean(obj.truncated || totalLength > elements.length);

      // Check for square numeric Adjacency Matrix Graph when named like adj/graph/edges
      const joinedNames = names.join(' ').toLowerCase();
      if (
        isMatrix &&
        elements.length >= 2 &&
        elements.length <= 12 &&
        /\b(adj|adjmatrix|graph|edges)\b/.test(joinedNames)
      ) {
        const rowObjs = elements.map((r) => (isObjectRef(r) ? heap[r.__ref] : undefined));
        const isSquareNumeric = rowObjs.every(
          (r) =>
            r &&
            r.elements &&
            r.elements.length === elements.length &&
            r.elements.every((cell) => typeof cell === 'number')
        );
        if (isSquareNumeric) {
          const nodes: ReconstructedGraphNode[] = rowObjs.map((_, idx) => ({
            id: String(idx),
            label: String(idx),
            visited: visitedLabels.has(String(idx)),
            pointers: [],
            status: visitedLabels.has(String(idx)) ? 'changed' : 'unchanged',
          }));
          const edges: ReconstructedGraphEdge[] = [];
          rowObjs.forEach((r, rIdx) => {
            (r?.elements || []).forEach((val, cIdx) => {
              const weight = Number(val);
              if (Number.isFinite(weight) && weight !== 0) {
                edges.push({
                  fromId: String(rIdx),
                  toId: String(cIdx),
                  directed: true,
                  label: weight !== 1 ? String(weight) : undefined,
                });
              }
            });
          });
          const props = analyzeGraphProperties(nodes, edges);
          structures.push({
            kind: 'graph',
            objectId: oid,
            names,
            nodes,
            edges,
            ...props,
            representation: 'adjacency-matrix',
            sharedBy,
            status: objStatus,
          });
          continue;
        }
      }

      const { roleHint, heapOrder } = inferArrayRoleHint(names, isMatrix, elements, event);

      if (isMatrix) {
        const rows: ReconstructedArrayCell[][] = elements.map((rowRef, rIdx) => {
          const rowObj = isObjectRef(rowRef) ? heap[rowRef.__ref] : undefined;
          const prevRowRef = prevEls[rIdx];
          const prevRowObj = prevRowRef && isObjectRef(prevRowRef) ? prevHeap[prevRowRef.__ref] : undefined;
          const rowEls = rowObj?.elements || [];
          const prevRowEls = prevRowObj?.elements || [];
          return rowEls.map((cell, cIdx) => ({
            index: cIdx,
            raw: cell,
            display: formatRefValue(cell, heap),
            status:
              cIdx >= prevRowEls.length
                ? 'new'
                : !sameValueRef(cell, prevRowEls[cIdx])
                  ? 'changed'
                  : 'unchanged',
          }));
        });
        structures.push({
          kind: 'array',
          objectId: oid,
          names,
          length: elements.length,
          totalLength,
          truncated,
          isMatrix: true,
          roleHint,
          cells: [],
          rows,
          sharedBy,
          status: objStatus,
        });
      } else {
        const cells: ReconstructedArrayCell[] = elements.map((el, idx) => ({
          index: idx,
          raw: el,
          display: formatRefValue(el, heap),
          status:
            idx >= prevEls.length
              ? 'new'
              : !sameValueRef(el, prevEls[idx])
                ? 'changed'
                : 'unchanged',
        }));
        structures.push({
          kind: 'array',
          objectId: oid,
          names,
          length: elements.length,
          totalLength,
          truncated,
          isMatrix: false,
          roleHint,
          heapOrder,
          cells,
          sharedBy,
          status: objStatus,
        });
      }
      continue;
    }

    // 3. Adjacency-map Graph (e.g., { A: ['B', 'C'], B: ['D'] } or weighted { A: [{to:'B', weight:3}] })
    if (isAdjacencyMapGraph(obj, heap)) {
      const entries = Object.entries(obj.entries || {});
      const vertexSet = new Set(entries.map(([k]) => k));
      const prevEntries = prevHeap[oid]?.entries || {};
      const nodes: ReconstructedGraphNode[] = entries.map(([vKey]) => ({
        id: vKey,
        label: vKey,
        visited: visitedLabels.has(vKey),
        pointers: [],
        status: !(vKey in prevEntries)
          ? 'new'
          : visitedLabels.has(vKey)
            ? 'changed'
            : 'unchanged',
      }));
      const edges: ReconstructedGraphEdge[] = [];
      for (const [fromKey, listRef] of entries) {
        if (!isObjectRef(listRef)) continue;
        const listObj = heap[listRef.__ref];
        for (const el of listObj?.elements || []) {
          if (!isObjectRef(el) && el !== null) {
            const toKey = String(el);
            if (!vertexSet.has(toKey)) {
              vertexSet.add(toKey);
              nodes.push({
                id: toKey,
                label: toKey,
                visited: visitedLabels.has(toKey),
                pointers: [],
                status: 'unchanged',
              });
            }
            edges.push({ fromId: fromKey, toId: toKey, directed: true });
          } else if (isObjectRef(el)) {
            const edgeObj = heap[el.__ref];
            if (edgeObj?.kind === 'array' && (edgeObj.elements?.length ?? 0) >= 2) {
              const toVal = edgeObj.elements![0];
              const weight = edgeObj.elements![1];
              if (!isObjectRef(toVal) && toVal !== null) {
                const toKey = String(toVal);
                edges.push({
                  fromId: fromKey,
                  toId: toKey,
                  directed: true,
                  label: !isObjectRef(weight) && weight !== null ? String(weight) : undefined,
                });
              }
            } else {
              const toVal = edgeObj?.entries?.to ?? edgeObj?.entries?.node ?? edgeObj?.entries?.target;
              const weight = edgeObj?.entries?.weight ?? edgeObj?.entries?.w;
              if (toVal !== undefined && !isObjectRef(toVal) && toVal !== null) {
                const toKey = String(toVal);
                edges.push({
                  fromId: fromKey,
                  toId: toKey,
                  directed: true,
                  label: weight !== undefined && !isObjectRef(weight) ? String(weight) : undefined,
                });
              }
            }
          }
        }
      }
      const props = analyzeGraphProperties(nodes, edges);
      structures.push({
        kind: 'graph',
        objectId: oid,
        names,
        nodes,
        edges,
        ...props,
        representation: 'adjacency-list',
        sharedBy,
        status: objStatus,
      });
      continue;
    }

    // 4. Object-node Graph (objects with `neighbors` / `edges` / `adj` arrays)
    if (isObjectGraphNode(obj, heap)) {
      const nodes: ReconstructedGraphNode[] = [];
      const edges: ReconstructedGraphEdge[] = [];
      const visitedWalk = new Set<string>([oid]);
      const queue = [oid];
      while (queue.length > 0 && nodes.length < 64) {
        const curId = queue.shift()!;
        const curObj = heap[curId];
        if (!curObj) continue;
        const label = extractNodeLabel(curObj, heap);
        nodes.push({
          id: curId,
          label,
          visited: visitedLabels.has(curId) || visitedLabels.has(label),
          pointers: namesByObjectId.get(curId) || [],
          status: getObjectStatus(curId, heap, prevHeap),
        });
        const listRef = curObj.entries?.neighbors ?? curObj.entries?.adj ?? curObj.entries?.edges;
        if (listRef && isObjectRef(listRef) && heap[listRef.__ref]?.elements) {
          for (const el of heap[listRef.__ref].elements || []) {
            if (isObjectRef(el) && heap[el.__ref]) {
              edges.push({ fromId: curId, toId: el.__ref, directed: true });
              if (!visitedWalk.has(el.__ref)) {
                visitedWalk.add(el.__ref);
                queue.push(el.__ref);
              }
            }
          }
        }
      }
      const props = analyzeGraphProperties(nodes, edges);
      structures.push({
        kind: 'graph',
        objectId: oid,
        names,
        nodes,
        edges,
        ...props,
        representation: 'object-graph',
        sharedBy,
        status: objStatus,
      });
      continue;
    }

    // 5. Trie Tree (explicit char-map children + end-of-word marker)
    if (isTrieNode(obj, heap)) {
      const nodes: ReconstructedTreeNode[] = [];
      const edges: ReconstructedTreeEdge[] = [];
      const seen = new Set<string>();
      let xIndex = 0;
      let maxDepth = 0;

      const walkTrie = (curId: string, labelText: string, depth: number) => {
        if (depth > 10 || nodes.length >= 64 || seen.has(curId)) return;
        const curObj = heap[curId];
        if (!curObj?.entries) return;
        seen.add(curId);
        maxDepth = Math.max(maxDepth, depth);
        const isWord = Boolean(
          curObj.entries.isEnd || curObj.entries.endOfWord || curObj.entries.isWord || curObj.entries.terminal
        );
        const childMapRef = curObj.entries.children ?? curObj.entries.kids ?? curObj.entries.next;
        const childEntries =
          childMapRef && isObjectRef(childMapRef) ? Object.entries(heap[childMapRef.__ref]?.entries || {}) : [];
        const half = Math.floor(childEntries.length / 2);

        for (let i = 0; i < half; i++) {
          const [ch, cRef] = childEntries[i];
          if (isObjectRef(cRef) && heap[cRef.__ref]) {
            walkTrie(cRef.__ref, ch, depth + 1);
            edges.push({ fromId: curId, toId: cRef.__ref, label: ch });
          }
        }
        nodes.push({
          objectId: curId,
          value: labelText,
          display: labelText,
          x: xIndex++,
          y: depth,
          pointers: namesByObjectId.get(curId) || [],
          metaTag: isWord ? 'END' : undefined,
          status: getObjectStatus(curId, heap, prevHeap),
        });
        for (let i = half; i < childEntries.length; i++) {
          const [ch, cRef] = childEntries[i];
          if (isObjectRef(cRef) && heap[cRef.__ref]) {
            walkTrie(cRef.__ref, ch, depth + 1);
            edges.push({ fromId: curId, toId: cRef.__ref, label: ch });
          }
        }
      };

      walkTrie(oid, 'root', 0);
      structures.push({
        kind: 'tree',
        objectId: oid,
        names,
        className: obj.className || 'Trie',
        treeKind: 'general',
        treeVariant: 'trie',
        nodes,
        edges,
        width: Math.max(1, xIndex),
        height: maxDepth + 1,
        sharedBy,
        status: objStatus,
      });
      continue;
    }

    // 6. Tree — Standard (`left`/`right`/`children`) OR Name-Independent Topology!
    const arbTopo = !isBinaryOrNaryTreeNode(obj, heap) && !isLinkedNode(obj, heap)
      ? getArbitraryTopology(oid)
      : null;

    if (isBinaryOrNaryTreeNode(obj, heap) || arbTopo?.kind === 'tree') {
      const nodes: ReconstructedTreeNode[] = [];
      const edges: ReconstructedTreeEdge[] = [];
      const seen = new Set<string>();
      let hasCycleOrMultiParent = false;
      let xIndex = 0;
      let maxDepth = 0;

      const usesStandardBinary = 'left' in (obj.entries || {}) || 'right' in (obj.entries || {});
      const usesArbitraryBinary = Boolean(arbTopo && arbTopo.pointerKeys.length === 2);
      const isGeneral =
        !usesStandardBinary &&
        !usesArbitraryBinary &&
        ('children' in (obj.entries || {}) || Boolean(arbTopo && arbTopo.pointerKeys.length > 2));

      const leftKey = usesStandardBinary ? 'left' : arbTopo?.pointerKeys[0] || 'left';
      const rightKey = usesStandardBinary ? 'right' : arbTopo?.pointerKeys[1] || 'right';
      const ignoredKeys = new Set<string>(arbTopo ? arbTopo.pointerKeys : ['left', 'right', 'children']);

      const walkTree = (curId: string, depth: number): boolean => {
        if (depth > 12 || nodes.length >= 64) return false;
        if (seen.has(curId)) {
          hasCycleOrMultiParent = true;
          return false;
        }
        const curObj = heap[curId];
        if (!curObj || curObj.kind !== 'object') return false;
        seen.add(curId);
        maxDepth = Math.max(maxDepth, depth);

        const entries = curObj.entries || {};
        const metaTag =
          typeof entries.color === 'string'
            ? entries.color.toUpperCase().slice(0, 3)
            : typeof entries.height === 'number'
              ? `h=${entries.height}`
              : undefined;

        if (usesStandardBinary || usesArbitraryBinary) {
          const leftRef = entries[leftKey];
          const rightRef = entries[rightKey];
          const leftId = leftRef && isObjectRef(leftRef) && heap[leftRef.__ref] ? leftRef.__ref : null;
          const rightId = rightRef && isObjectRef(rightRef) && heap[rightRef.__ref] ? rightRef.__ref : null;

          if (leftId) {
            const ok = walkTree(leftId, depth + 1);
            if (ok) edges.push({ fromId: curId, toId: leftId, label: usesStandardBinary ? 'L' : leftKey });
          }

          const nodeVal = extractNodeLabel(curObj, heap, ignoredKeys);
          nodes.push({
            objectId: curId,
            value: nodeVal,
            display: nodeVal,
            x: xIndex++,
            y: depth,
            pointers: (namesByObjectId.get(curId) || []).filter((n) => !names.includes(n) || curId === oid),
            metaTag,
            status: getObjectStatus(curId, heap, prevHeap),
          });

          if (rightId) {
            const ok = walkTree(rightId, depth + 1);
            if (ok) edges.push({ fromId: curId, toId: rightId, label: usesStandardBinary ? 'R' : rightKey });
          }
        } else {
          const childIds: string[] = [];
          const childrenRef = entries.children;
          if (childrenRef && isObjectRef(childrenRef) && heap[childrenRef.__ref]?.elements) {
            for (const el of heap[childrenRef.__ref].elements || []) {
              if (isObjectRef(el) && heap[el.__ref]) childIds.push(el.__ref);
            }
          } else if (arbTopo) {
            for (const pk of arbTopo.pointerKeys) {
              const r = entries[pk];
              if (r && isObjectRef(r) && heap[r.__ref]) childIds.push(r.__ref);
            }
          }
          const half = Math.floor(childIds.length / 2);
          for (let i = 0; i < half; i++) {
            if (walkTree(childIds[i], depth + 1)) {
              edges.push({ fromId: curId, toId: childIds[i] });
            }
          }
          const nodeVal = extractNodeLabel(curObj, heap, ignoredKeys);
          nodes.push({
            objectId: curId,
            value: nodeVal,
            display: nodeVal,
            x: xIndex++,
            y: depth,
            pointers: namesByObjectId.get(curId) || [],
            metaTag,
            status: getObjectStatus(curId, heap, prevHeap),
          });
          for (let i = half; i < childIds.length; i++) {
            if (walkTree(childIds[i], depth + 1)) {
              edges.push({ fromId: curId, toId: childIds[i] });
            }
          }
        }
        return true;
      };

      walkTree(oid, 0);

      if (hasCycleOrMultiParent) {
        const gNodes: ReconstructedGraphNode[] = nodes.map((n) => ({
          id: n.objectId,
          label: n.display,
          visited: visitedLabels.has(n.objectId) || visitedLabels.has(n.display),
          pointers: n.pointers,
          status: n.status,
        }));
        const gEdges: ReconstructedGraphEdge[] = [];
        for (const n of nodes) {
          const e = heap[n.objectId]?.entries || {};
          for (const k of [leftKey, rightKey]) {
            const r = e[k];
            if (r && isObjectRef(r) && seen.has(r.__ref)) {
              gEdges.push({ fromId: n.objectId, toId: r.__ref, directed: true, label: k });
            }
          }
        }
        const props = analyzeGraphProperties(gNodes, gEdges);
        structures.push({
          kind: 'graph',
          objectId: oid,
          names,
          nodes: gNodes,
          edges: gEdges,
          ...props,
          representation: 'object-graph',
          sharedBy,
          status: objStatus,
        });
      } else {
        let treeVariant: TreeVariant = isGeneral ? 'general' : 'binary';
        if (!isGeneral) {
          const entries = obj.entries || {};
          if (typeof entries.color === 'string') {
            treeVariant = 'red-black';
          } else if (typeof entries.height === 'number' || typeof entries.balance === 'number') {
            treeVariant = 'avl';
          } else if (checkIsBst(oid, leftKey, rightKey, heap, ignoredKeys)) {
            treeVariant = 'bst';
          }
        }

        structures.push({
          kind: 'tree',
          objectId: oid,
          names,
          className: obj.className,
          treeKind: isGeneral ? 'general' : 'binary',
          treeVariant,
          nodes,
          edges,
          width: Math.max(1, xIndex),
          height: maxDepth + 1,
          sharedBy,
          status: objStatus,
        });
      }
      continue;
    }

    // 7. Linked List — standard (`next`/`prev`) OR name-independent topology!
    if (isLinkedNode(obj, heap) || arbTopo?.kind === 'linked-list') {
      const nodes: ReconstructedListNode[] = [];
      const seen = new Set<string>();
      let cycleTargetId: string | null = null;
      const fwdKey = isLinkedNode(obj, heap) ? 'next' : arbTopo!.pointerKeys[0];
      const backKey = isLinkedNode(obj, heap)
        ? 'prev'
        : arbTopo!.isDoublyLinked
          ? arbTopo!.pointerKeys[1]
          : '';
      let isDoublyLinked = Boolean(arbTopo?.isDoublyLinked);
      const ignoredKeys = new Set<string>([fwdKey, ...(backKey ? [backKey] : [])]);
      let curId: string | null = oid;
      let guard = 0;

      while (curId && heap[curId] && guard++ < 48) {
        if (seen.has(curId)) {
          cycleTargetId = curId;
          break;
        }
        seen.add(curId);
        const curObj: HeapObject = heap[curId];
        const entries = curObj.entries || {};
        if (backKey && backKey in entries) {
          isDoublyLinked = true;
        }
        const nextRef: ValueRef | undefined = entries[fwdKey];
        const prevRef: ValueRef | undefined = backKey ? entries[backKey] : undefined;
        const nextId = nextRef && isObjectRef(nextRef) && heap[nextRef.__ref] ? nextRef.__ref : null;
        const prevId = prevRef && isObjectRef(prevRef) && heap[prevRef.__ref] ? prevRef.__ref : null;
        const label = extractNodeLabel(curObj, heap, ignoredKeys);
        nodes.push({
          objectId: curId,
          value: label,
          display: label,
          prevId,
          nextId,
          pointers: namesByObjectId.get(curId) || [],
          status: getObjectStatus(curId, heap, prevHeap),
        });
        curId = nextId;
      }

      structures.push({
        kind: 'linked-list',
        objectId: oid,
        names,
        className: obj.className,
        isDoublyLinked,
        isCircular: cycleTargetId === oid,
        nodes,
        cycleTargetId,
        sharedBy,
        status: objStatus,
      });
      continue;
    }

    // 8. Arbitrary Cyclic Object Graph detected via topology
    if (arbTopo?.kind === 'graph') {
      const nodes: ReconstructedGraphNode[] = [];
      const edges: ReconstructedGraphEdge[] = [];
      const visitedWalk = new Set<string>([oid]);
      const queue = [oid];
      const ignored = new Set(arbTopo.pointerKeys);
      while (queue.length > 0 && nodes.length < 64) {
        const curId = queue.shift()!;
        const curObj = heap[curId];
        if (!curObj) continue;
        const label = extractNodeLabel(curObj, heap, ignored);
        nodes.push({
          id: curId,
          label,
          visited: visitedLabels.has(curId) || visitedLabels.has(label),
          pointers: namesByObjectId.get(curId) || [],
          status: getObjectStatus(curId, heap, prevHeap),
        });
        for (const pk of arbTopo.pointerKeys) {
          const r = curObj.entries?.[pk];
          if (r && isObjectRef(r) && heap[r.__ref]) {
            edges.push({ fromId: curId, toId: r.__ref, directed: true, label: pk });
            if (!visitedWalk.has(r.__ref)) {
              visitedWalk.add(r.__ref);
              queue.push(r.__ref);
            }
          }
        }
      }
      const props = analyzeGraphProperties(nodes, edges);
      structures.push({
        kind: 'graph',
        objectId: oid,
        names,
        nodes,
        edges,
        ...props,
        representation: 'object-graph',
        sharedBy,
        status: objStatus,
      });
      continue;
    }

    // 9. Hash Table / Map / Dictionary
    if (isHashTableObject(obj, names, heap)) {
      const prevEntries = prevHeap[oid]?.entries || {};
      const entries: ReconstructedHashEntry[] = Object.entries(obj.entries || {}).map(
        ([k, val]) => ({
          key: k,
          display: formatRefValue(val, heap),
          refId: isObjectRef(val) ? val.__ref : undefined,
          status:
            !(k in prevEntries)
              ? 'new'
              : !sameValueRef(val, prevEntries[k])
                ? 'changed'
                : 'unchanged',
        })
      );
      structures.push({
        kind: 'hash-table',
        objectId: oid,
        names,
        className: obj.className || (obj.kind === 'map' ? 'Map' : 'Hash Table'),
        entries,
        sharedBy,
        status: objStatus,
      });
      continue;
    }

    // 10. Plain Object fallback (never force arbitrary objects into trees or graphs)
    const prevEntries = prevHeap[oid]?.entries || {};
    const fields: ReconstructedObjectField[] = Object.entries(obj.entries || {}).map(
      ([k, val]) => ({
        key: k,
        display: formatRefValue(val, heap),
        refId: isObjectRef(val) ? val.__ref : undefined,
        status:
          !(k in prevEntries)
            ? 'new'
            : !sameValueRef(val, prevEntries[k])
              ? 'changed'
              : 'unchanged',
      })
    );

    structures.push({
      kind: 'object',
      objectId: oid,
      names,
      className: obj.className,
      fields,
      sharedBy,
      status: objStatus,
    });
  }

  return { primitives, structures, sharedObjectIds, orphanedObjectIds };
}
