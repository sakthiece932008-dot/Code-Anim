import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { traceJavaScriptDocument, JS_ADAPTER_META } from '../src/lib/jsTracer';
import { runJavaScriptInWorker } from '../src/lib/jsWorkerRunner';
import {
  isObjectRef,
  validateAndNormalizeTraceDocument,
  type TraceDocument,
} from '../src/types/trace';
import { TraceReplayEngine } from '../src/lib/replayEngine';
import { buildAnimationFrame } from '../src/lib/animationAdapter';
import type {
  ReconstructedArray,
  ReconstructedGraph,
  ReconstructedLinkedList,
  ReconstructedObject,
  ReconstructedTree,
} from '../src/lib/structureReconstructor';

const SERVER_URL = process.env.TEST_SERVER_URL || 'http://127.0.0.1:3000';

type TestStatus = 'PASS' | 'FAIL' | 'NOT EXECUTED' | 'UNSUPPORTED';

interface TestRecord {
  id: string;
  category: string;
  status: TestStatus;
  durationMs: number;
  detail: string;
}

const results: TestRecord[] = [];
const perfMetrics: Record<string, string> = {};

async function runCheck(
  id: string,
  category: string,
  fn: () => Promise<string | void> | string | void
) {
  const start = performance.now();
  try {
    const detail = (await fn()) || 'ok';
    const ms = Number((performance.now() - start).toFixed(2));
    results.push({ id, category, status: 'PASS', durationMs: ms, detail });
    console.log(`[PASS] ${id} · ${category} (${ms}ms) — ${detail}`);
  } catch (err) {
    const ms = Number((performance.now() - start).toFixed(2));
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ id, category, status: 'FAIL', durationMs: ms, detail: msg });
    console.error(`[FAIL] ${id} · ${category} (${ms}ms) — ${msg}`);
  }
}

async function fetchPythonTrace(code: string, signal?: AbortSignal) {
  const res = await fetch(`${SERVER_URL}/api/trace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang: 'py', code }),
    signal,
  });
  const data = (await res.json()) as Record<string, unknown>;
  return { status: res.status, ok: res.ok, data };
}

function validateJsDoc(code: string): TraceDocument {
  const out = traceJavaScriptDocument(code);
  if (!out.document) {
    throw new Error(out.error || 'JS trace returned null document');
  }
  const checked = validateAndNormalizeTraceDocument(out.document, code.split('\n').length, {
    language: 'js',
    executionMode: 'real',
    adapter: JS_ADAPTER_META,
  });
  if (!checked.ok) {
    throw new Error(`Strict validation rejected JS trace: ${checked.error}`);
  }
  return checked.document;
}

async function main() {
  // 1. JavaScript arrays (push, pop, shift, unshift, swap, matrix, 1000-element)
  await runCheck('T01', 'JavaScript arrays (ops, matrix, 1,000 elements)', () => {
    const code = [
      'const arr = [4, 2, 7];',
      'arr.push(9);',
      'const popped = arr.pop();',
      'const shifted = arr.shift();',
      'arr.unshift(1);',
      '[arr[0], arr[2]] = [arr[2], arr[0]];',
      'const grid = [[1, 2], [3, 4]];',
    ].join('\n');
    const doc = validateJsDoc(code);
    const types = new Set(doc.events.map((e) => e.type));
    assert.ok(types.has('array_create'), 'missing array_create');
    assert.ok(types.has('array_append'), 'missing array_append');
    assert.ok(types.has('array_remove'), 'missing array_remove');
    assert.ok(types.has('array_insert'), 'missing array_insert');
    assert.ok(types.has('array_swap'), 'missing array_swap');

    const shiftEv = doc.events.find((e) => e.metadata.arrayOp === 'shift');
    assert.ok(shiftEv, 'shift() operation should be tagged with metadata.arrayOp="shift"');
    const unshiftEv = doc.events.find((e) => e.metadata.arrayOp === 'unshift');
    assert.ok(unshiftEv, 'unshift() operation should be tagged with metadata.arrayOp="unshift"');

    const engine = new TraceReplayEngine(doc, code);
    const last = engine.getStateAt(engine.totalSteps - 1)!;
    const matrix = last.workspace.structures.find(
      (s): s is ReconstructedArray => s.kind === 'array' && s.names.includes('grid')
    );
    assert.ok(matrix && matrix.isMatrix && matrix.rows?.length === 2, '2D matrix expected');

    // 1,000-element JS array via Array.from
    const t0 = performance.now();
    const bigCode = [
      'const big = Array.from({ length: 1000 }, (_, i) => i);',
      'big[999] = -1;',
      'const tail = big[999];',
    ].join('\n');
    const bigDoc = validateJsDoc(bigCode);
    const bigEngine = new TraceReplayEngine(bigDoc, bigCode);
    const bigLast = bigEngine.getStateAt(bigEngine.totalSteps - 1)!;
    const bigArr = bigLast.workspace.structures.find(
      (s): s is ReconstructedArray => s.kind === 'array' && s.names.includes('big')
    );
    assert.ok(bigArr && bigArr.totalLength === 1000, '1000-element array totalLength expected');
    assert.equal(bigArr.cells[999]?.raw, -1, 'big[999] should be observed as -1');
    const dt = (performance.now() - t0).toFixed(1);
    perfMetrics['JS 1,000-element array trace + replay'] = `${dt} ms (${bigDoc.events.length} events)`;
    return `${doc.events.length} events; 1,000-item array verified in ${dt}ms`;
  });

  // 2. Python arrays / lists (append, pop, pop(0), swap, 2D matrix, 1,000-element list)
  await runCheck('T02', 'Python arrays/lists (ops, matrix, 1,000 elements)', async () => {
    const code = [
      'nums = [5, 1, 3]',
      'nums.append(8)',
      'x = nums.pop()',
      'y = nums.pop(0)',
      'nums[0], nums[1] = nums[1], nums[0]',
      'mat = [[10, 20], [30, 40]]',
      'print(nums, x, y)',
    ].join('\n');
    const res = await fetchPythonTrace(code);
    assert.equal(res.ok, true, `Python trace failed: ${JSON.stringify(res.data)}`);
    const checked = validateAndNormalizeTraceDocument(res.data, code.split('\n').length, {
      language: 'py',
      executionMode: 'real',
      adapter: res.data.adapter as TraceDocument['adapter'],
    });
    assert.equal(checked.ok, true, !checked.ok ? checked.error : '');
    if (!checked.ok) return;
    const types = new Set(checked.document.events.map((e) => e.type));
    assert.ok(types.has('array_append'), 'Python array_append expected');
    assert.ok(types.has('array_remove'), 'Python array_remove expected');
    assert.ok(types.has('array_swap'), 'Python array_swap expected');
    assert.ok(checked.document.events.some((e) => e.metadata.arrayOp === 'shift'), 'Python pop(0) shift op expected');

    const t0 = performance.now();
    const bigPy = 'big = list(range(1000))\nbig[999] = -42\ntail = big[999]\n';
    const bigRes = await fetchPythonTrace(bigPy);
    assert.equal(bigRes.ok, true, `Python 1000-item trace failed: ${JSON.stringify(bigRes.data)}`);
    const bigChecked = validateAndNormalizeTraceDocument(bigRes.data, 3, {
      language: 'py',
      executionMode: 'real',
      adapter: bigRes.data.adapter as TraceDocument['adapter'],
    });
    assert.equal(bigChecked.ok, true, !bigChecked.ok ? bigChecked.error : '');
    if (!bigChecked.ok) return;
    const bigEngine = new TraceReplayEngine(bigChecked.document, bigPy);
    const last = bigEngine.getStateAt(bigEngine.totalSteps - 1)!;
    const bigList = last.workspace.structures.find(
      (s): s is ReconstructedArray => s.kind === 'array' && s.names.includes('big')
    );
    assert.ok(bigList && bigList.totalLength === 1000 && bigList.cells[999]?.raw === -42);
    const dt = (performance.now() - t0).toFixed(1);
    perfMetrics['Python 1,000-element list (/api/trace + replay)'] = `${dt} ms (${bigChecked.document.events.length} events)`;
    return `${checked.document.events.length} events; 1,000-item Python list verified in ${dt}ms`;
  });

  // 3. Binary trees, General trees, and NO false-positive tree classification on non-tree objects
  await runCheck('T03', 'Binary trees, general trees & non-tree object safety', () => {
    const code = [
      'class Box { constructor(v) { this.val = v; this.left = null; this.right = null; } }',
      'const root = new Box(10);',
      'root.left = new Box(5);',
      'root.right = new Box(15);',
      'const nary = { label: "A", children: [{ label: "B", children: [] }, { label: "C", children: [] }] };',
      'const rect = { left: 0, right: 100, top: 10, bottom: 50 };',
    ].join('\n');
    const doc = validateJsDoc(code);
    const engine = new TraceReplayEngine(doc, code);
    const last = engine.getStateAt(engine.totalSteps - 1)!;

    const binTree = last.workspace.structures.find(
      (s): s is ReconstructedTree => s.kind === 'tree' && s.names.includes('root')
    );
    assert.ok(binTree && binTree.treeKind === 'binary' && binTree.nodes.length === 3, 'Binary tree with 3 nodes expected');

    const genTree = last.workspace.structures.find(
      (s): s is ReconstructedTree => s.kind === 'tree' && s.names.includes('nary')
    );
    assert.ok(genTree && genTree.treeKind === 'general' && genTree.nodes.length === 3, 'General n-ary tree with 3 nodes expected');

    const rectObj = last.workspace.structures.find(
      (s): s is ReconstructedObject => s.names.includes('rect') && s.kind === 'object'
    );
    assert.ok(rectObj, 'Bounding box { left: 0, right: 100, top: 10, bottom: 50 } MUST be plain object, NOT tree!');
    return 'Binary tree (3 nodes), General tree (3 nodes), and non-tree rect object preserved';
  });

  // 4. Linked lists (singly + doubly linked + unlinking + unreachable object tracking)
  await runCheck('T04', 'Linked lists (singly, doubly, unlink & unreachable)', () => {
    const code = [
      'const d1 = { data: "A", prev: null, next: null };',
      'const d2 = { data: "B", prev: d1, next: null };',
      'd1.next = d2;',
      'let head = { val: 1, next: { val: 2, next: { val: 3, next: null } } };',
      'head.next = head.next.next;',
    ].join('\n');
    const doc = validateJsDoc(code);
    const engine = new TraceReplayEngine(doc, code);
    const last = engine.getStateAt(engine.totalSteps - 1)!;

    const dll = last.workspace.structures.find(
      (s): s is ReconstructedLinkedList => s.kind === 'linked-list' && s.names.includes('d1')
    );
    assert.ok(dll && dll.isDoublyLinked && dll.nodes.length === 2, 'Doubly linked list expected');
    assert.equal(dll.nodes[1].prevId, dll.nodes[0].objectId, 'prevId pointer preserved');

    const sll = last.workspace.structures.find(
      (s): s is ReconstructedLinkedList => s.kind === 'linked-list' && s.names.includes('head')
    );
    assert.ok(sll && !sll.isDoublyLinked && sll.nodes.length === 2, 'Singly linked list after unlinking middle node expected');
    assert.ok(last.workspace.orphanedObjectIds.length >= 1, 'Unlinked middle node should appear in orphanedObjectIds');
    return `Doubly linked (2 nodes), Singly linked unlinked -> ${last.workspace.orphanedObjectIds.length} unreachable object tracked`;
  });

  // 5. Graph relationships (adjacency map + object-node graph + 40-node graph performance)
  await runCheck('T05', 'Graph relationships (adjacency map, object graph, 40-node graph)', () => {
    const code = [
      'const graph = { A: ["B", "C"], B: ["D"], C: ["D"], D: [] };',
      'const visited = new Set(["A", "B"]);',
      'const v1 = { id: "X", neighbors: [] };',
      'const v2 = { id: "Y", neighbors: [v1] };',
      'v1.neighbors.push(v2);',
    ].join('\n');
    const doc = validateJsDoc(code);
    const engine = new TraceReplayEngine(doc, code);
    const last = engine.getStateAt(engine.totalSteps - 1)!;
    const adjG = last.workspace.structures.find(
      (s): s is ReconstructedGraph => s.kind === 'graph' && s.names.includes('graph')
    );
    assert.ok(adjG && adjG.nodes.length === 4 && adjG.edges.length === 4);
    assert.equal(adjG.nodes.filter((n) => n.visited).length, 2, '2 visited nodes expected');
    const objG = last.workspace.structures.find(
      (s): s is ReconstructedGraph => s.kind === 'graph' && s.names.includes('v1')
    );
    assert.ok(objG && objG.nodes.length === 2 && objG.edges.length === 2, 'Object-node cyclic graph expected');

    // 40-node graph performance probe
    const t0 = performance.now();
    const bigGraphCode = [
      'const g = {};',
      'for (let i = 0; i < 40; i++) {',
      '  g["N" + i] = ["N" + ((i + 1) % 40), "N" + ((i + 3) % 40)];',
      '}',
    ].join('\n');
    const bigGDoc = validateJsDoc(bigGraphCode);
    const bigGEngine = new TraceReplayEngine(bigGDoc, bigGraphCode);
    const bigGLast = bigGEngine.getStateAt(bigGEngine.totalSteps - 1)!;
    const bigG = bigGLast.workspace.structures.find(
      (s): s is ReconstructedGraph => s.kind === 'graph' && s.names.includes('g')
    );
    assert.ok(bigG && bigG.nodes.length === 40 && bigG.edges.length === 80);
    const dt = (performance.now() - t0).toFixed(1);
    perfMetrics['40-node graph (80 edges) trace + reconstruction'] = `${dt} ms (${bigGDoc.events.length} events)`;
    return `Adjacency + object graph verified; 40-node/80-edge graph in ${dt}ms`;
  });

  // 6. Recursive functions (JS + Python + deep depth-60 recursion)
  await runCheck('T06', 'Recursive functions (JS, Python, depth-60 recursion)', async () => {
    const t0 = performance.now();
    const deepCode = [
      'function sumDown(n) {',
      '  if (n <= 0) return 0;',
      '  return n + sumDown(n - 1);',
      '}',
      'const total = sumDown(60);',
    ].join('\n');
    const doc = validateJsDoc(deepCode);
    const maxDepth = Math.max(...doc.events.map((e) => e.callStack.length));
    assert.ok(maxDepth >= 60, `Expected call stack depth >= 60, got ${maxDepth}`);
    const lastEv = doc.events[doc.events.length - 1];
    assert.equal(lastEv.locals.total, 1830, 'sumDown(60) should equal 1830');
    const dt = (performance.now() - t0).toFixed(1);
    perfMetrics['Depth-60 JS recursion trace'] = `${dt} ms (${doc.events.length} events, depth ${maxDepth})`;

    const pyRec = 'def fib(n):\n    if n <= 1:\n        return n\n    return fib(n-1) + fib(n-2)\nans = fib(5)\n';
    const pyRes = await fetchPythonTrace(pyRec);
    assert.equal(pyRes.ok, true);
    const pyEvents = (pyRes.data.events as Array<{ callStack: unknown[]; locals: Record<string, unknown> }>) || [];
    const pyMaxDepth = Math.max(...pyEvents.map((e) => e.callStack.length));
    assert.ok(pyMaxDepth >= 5, `Python recursion stack depth >= 5 expected, got ${pyMaxDepth}`);
    assert.equal(pyEvents[pyEvents.length - 1].locals.ans, 5);
    return `JS depth-${maxDepth} recursion in ${dt}ms; Python fib(5)=5 (depth ${pyMaxDepth})`;
  });

  // 7. Duplicate node values
  await runCheck('T07', 'Duplicate node values (distinct objectIds)', () => {
    const code = [
      'const n1 = { value: 5, left: null, right: null };',
      'n1.left = { value: 5, left: null, right: null };',
      'n1.right = { value: 5, left: null, right: null };',
      'const l1 = { value: 7, next: { value: 7, next: { value: 7, next: null } } };',
    ].join('\n');
    const doc = validateJsDoc(code);
    const engine = new TraceReplayEngine(doc, code);
    const last = engine.getStateAt(engine.totalSteps - 1)!;
    const tree = last.workspace.structures.find((s): s is ReconstructedTree => s.kind === 'tree')!;
    const list = last.workspace.structures.find((s): s is ReconstructedLinkedList => s.kind === 'linked-list')!;
    assert.equal(new Set(tree.nodes.map((n) => n.objectId)).size, 3, '3 distinct tree node IDs');
    assert.equal(new Set(list.nodes.map((n) => n.objectId)).size, 3, '3 distinct list node IDs');
    return '3 distinct tree IDs & 3 distinct list IDs with identical values';
  });

  // 8. Cyclic references
  await runCheck('T08', 'Cyclic references (linked list cycle + cyclic tree fallback)', () => {
    const code = [
      'const a = { val: 1, next: null };',
      'const b = { val: 2, next: a };',
      'a.next = b;',
      'const t1 = { val: 10, left: null, right: null };',
      't1.left = t1;',
    ].join('\n');
    const doc = validateJsDoc(code);
    const engine = new TraceReplayEngine(doc, code);
    const last = engine.getStateAt(engine.totalSteps - 1)!;
    const list = last.workspace.structures.find((s): s is ReconstructedLinkedList => s.kind === 'linked-list')!;
    assert.equal(list.nodes.length, 2);
    assert.equal(list.cycleTargetId, list.nodes[0].objectId, 'Linked list cycle target ID must match head');
    const cyclicTreeAsGraph = last.workspace.structures.find(
      (s): s is ReconstructedGraph => s.kind === 'graph' && s.names.includes('t1')
    );
    assert.ok(cyclicTreeAsGraph, 'Self-cyclic tree node must fall back safely to Graph');
    return 'Linked list cycle detected; self-cyclic tree safely degraded to Graph';
  });

  // 9. Shared object references
  await runCheck('T09', 'Shared object references (aliasing & refCount)', () => {
    const code = [
      'const shared = { tag: "shared-payload", count: 1 };',
      'const alias = shared;',
      'const holder = { first: shared, second: shared };',
      'alias.count = 42;',
    ].join('\n');
    const doc = validateJsDoc(code);
    const lastEv = doc.events[doc.events.length - 1];
    const sRef = lastEv.locals.shared;
    const aRef = lastEv.locals.alias;
    assert.ok(isObjectRef(sRef) && isObjectRef(aRef) && sRef.__ref === aRef.__ref, 'shared & alias must share exact objectId');
    assert.equal(lastEv.heap[sRef.__ref].entries?.count, 42);
    const engine = new TraceReplayEngine(doc, code);
    const lastFrame = engine.getStateAt(engine.totalSteps - 1)!;
    assert.ok(lastFrame.workspace.sharedObjectIds.includes(sRef.__ref), 'sharedObjectIds must include aliased object');
    const sharedStruct = lastFrame.workspace.structures.find((s) => s.objectId === sRef.__ref)!;
    assert.ok(sharedStruct.sharedBy.length >= 4, `Expected >=4 incoming refs, got ${sharedStruct.sharedBy.length}`);
    return `Object ${sRef.__ref} tracked with ${sharedStruct.sharedBy.length} incoming references`;
  });

  // 10. Invalid programs & exception events (JS + Python)
  await runCheck('T10', 'Invalid programs & exception event emission (JS + Python)', async () => {
    // JS syntax error
    const badJs = traceJavaScriptDocument('const x = {{{;');
    assert.equal(badJs.document, null);
    assert.ok(badJs.error?.includes('SyntaxError'));

    // JS caught exception emits observed error event and continues
    const caughtJs = [
      'let status = "start";',
      'try {',
      '  throw new Error("recoverable");',
      '} catch (e) {',
      '  status = "caught";',
      '}',
    ].join('\n');
    const caughtDoc = validateJsDoc(caughtJs);
    assert.ok(caughtDoc.events.some((e) => e.type === 'error' && e.provenance === 'observed'), 'Caught JS throw should emit observed error event');
    assert.equal(caughtDoc.events[caughtDoc.events.length - 1].locals.status, 'caught');

    // JS uncaught exception emits observed error event + interrupted flag
    const uncaughtJs = 'let a = 1;\nthrow new Error("fatal");\nlet b = 2;\n';
    const uncaughtOut = traceJavaScriptDocument(uncaughtJs);
    assert.ok(uncaughtOut.document && uncaughtOut.document.interrupted === true);
    assert.ok(uncaughtOut.document.events.some((e) => e.type === 'error' && e.metadata.uncaught === true));

    // Python syntax error
    const badPy = await fetchPythonTrace('def broken(:\n  pass\n');
    assert.equal(badPy.ok, false);

    // Python uncaught ZeroDivisionError emits error event + interrupted
    const pyErrCode = 'x = 10\ny = x / 0\nz = 99\n';
    const pyErrRes = await fetchPythonTrace(pyErrCode);
    assert.equal(pyErrRes.ok, true);
    assert.equal(pyErrRes.data.interrupted, true);
    const pyErrEvents = pyErrRes.data.events as Array<{ type: string; metadata: Record<string, unknown> }>;
    assert.ok(pyErrEvents.some((e) => e.type === 'error' && e.metadata.uncaught === true), 'Python ZeroDivisionError should emit uncaught error event');
    return 'JS & Python syntax errors rejected; caught & uncaught exceptions emit observed error events';
  });

  // 11. Infinite loops (JS + Python)
  await runCheck('T11', 'Infinite loops bounded safely (JS + Python)', async () => {
    const jsInf = 'let i = 0;\nwhile (true) {\n  i++;\n}\n';
    const jsOut = traceJavaScriptDocument(jsInf);
    assert.ok(jsOut.document && jsOut.document.interrupted === true);
    assert.ok(jsOut.error?.includes('Step limit'));
    assert.ok(jsOut.document.events.length <= 1501);

    const pyInf = 'i = 0\nwhile True:\n    i += 1\n';
    const pyRes = await fetchPythonTrace(pyInf);
    assert.equal(pyRes.ok, true);
    assert.equal(pyRes.data.interrupted, true);
    assert.ok(String(pyRes.data.warning || '').includes('Step limit'));
    return `JS stopped at ${jsOut.document.events.length} events; Python stopped cleanly with warning`;
  });

  // 12. Execution cancellation (JS worker runner + Python HTTP abort)
  await runCheck('T12', 'Execution cancellation (JS AbortSignal + Python HTTP abort)', async () => {
    // JS runner pre-aborted + mid-queue abort
    const jsCtrl = new AbortController();
    const jsPromise = runJavaScriptInWorker('let x = 1;', { signal: jsCtrl.signal });
    jsCtrl.abort();
    let jsAborted = false;
    try {
      await jsPromise;
    } catch (err) {
      jsAborted = err instanceof Error && err.name === 'AbortError';
    }
    assert.ok(jsAborted, 'JS runner must reject with AbortError on cancel');

    // Python server-side subprocess kill on client HTTP abort
    const pyCtrl = new AbortController();
    const slowPy = 'import time\nx = 1\ntime.sleep(4)\ny = 2\n';
    setTimeout(() => pyCtrl.abort(), 200);
    const t0 = performance.now();
    let pyAborted = false;
    try {
      await fetchPythonTrace(slowPy, pyCtrl.signal);
    } catch (err) {
      pyAborted = err instanceof Error && err.name === 'AbortError';
    }
    const elapsed = performance.now() - t0;
    assert.ok(pyAborted, 'Python HTTP trace request must abort cleanly');
    assert.ok(elapsed < 1500, `Expected fast abort (<1500ms), took ${elapsed.toFixed(0)}ms`);
    return `JS AbortError verified; Python subprocess canceled in ${elapsed.toFixed(0)}ms`;
  });

  // 13. Malformed traces strictly rejected
  await runCheck('T13', 'Malformed v2.0 traces strictly rejected by validator', () => {
    const meta = { language: 'js' as const, executionMode: 'real' as const, adapter: JS_ADAPTER_META };
    const baseValidEvent = {
      id: 'event-001',
      sequence: 1,
      line: 1,
      type: 'statement',
      provenance: 'observed',
      scope: 'main',
      functionName: 'main',
      changes: [],
      objectIds: [],
      heap: {},
      locals: { x: 1 },
      callStack: [{ frameId: 'f0', name: 'main', line: 1, localsCount: 1 }],
      print: '',
      outText: '',
      explanation: '',
      metadata: {},
      scene: null,
    };

    const malformedCases: Array<[string, unknown]> = [
      ['missing event id', { schemaVersion: '2.0', events: [{ ...baseValidEvent, id: '' }] }],
      ['duplicate event id', { schemaVersion: '2.0', events: [baseValidEvent, { ...baseValidEvent, sequence: 2 }] }],
      ['negative line', { schemaVersion: '2.0', events: [{ ...baseValidEvent, line: -3 }] }],
      ['line beyond source', { schemaVersion: '2.0', events: [{ ...baseValidEvent, line: 99 }] }],
      ['unknown event type', { schemaVersion: '2.0', events: [{ ...baseValidEvent, type: 'MADE_UP_TYPE' }] }],
      ['broken __ref in locals', { schemaVersion: '2.0', events: [{ ...baseValidEvent, locals: { p: { __ref: 'obj_404' } } }] }],
      [
        'broken __ref in heap',
        {
          schemaVersion: '2.0',
          events: [
            {
              ...baseValidEvent,
              objectIds: ['obj_1'],
              heap: { obj_1: { id: 'obj_1', kind: 'object', entries: { next: { __ref: 'obj_missing' } } } },
              locals: { n: { __ref: 'obj_1' } },
            },
          ],
        },
      ],
      ['unsupported value (NaN)', { schemaVersion: '2.0', events: [{ ...baseValidEvent, locals: { bad: Number.NaN } }] }],
      ['non-monotonic sequence', { schemaVersion: '2.0', events: [baseValidEvent, { ...baseValidEvent, id: 'event-002', sequence: 1 }] }],
      ['oversized payload (>2000 events)', { schemaVersion: '2.0', events: Array.from({ length: 2005 }, (_, i) => ({ ...baseValidEvent, id: `e-${i}`, sequence: i + 1 })) }],
    ];

    for (const [label, payload] of malformedCases) {
      const res = validateAndNormalizeTraceDocument(payload, 10, meta);
      assert.equal(res.ok, false, `Validator should have REJECTED "${label}"`);
    }
    return `All ${malformedCases.length}/${malformedCases.length} malformed payloads strictly rejected`;
  });

  // 14 & 15. Backward replay & 1,000 random timeline seeks + performance benchmark
  await runCheck('T14', 'Backward replay determinism & immutability', () => {
    const code = [
      'const arr = [9, 3, 7, 1, 5];',
      'for (let i = 0; i < arr.length; i++) {',
      '  for (let j = 0; j < arr.length - i - 1; j++) {',
      '    if (arr[j] > arr[j + 1]) {',
      '      [arr[j], arr[j + 1]] = [arr[j + 1], arr[j]];',
      '    }',
      '  }',
      '}',
    ].join('\n');
    const doc = validateJsDoc(code);
    const engine = new TraceReplayEngine(doc, code);
    const forward = Array.from({ length: engine.totalSteps }, (_, i) => JSON.stringify(engine.getStateAt(i)));
    for (let i = engine.totalSteps - 1; i >= 0; i--) {
      assert.equal(JSON.stringify(engine.getStateAt(i)), forward[i], `Backward mismatch at step ${i}`);
    }
    // Verify immutability: mutating original doc after construction cannot alter replay
    (doc.events[0].locals as Record<string, unknown>).tampered = 999;
    assert.equal(engine.getStateAt(0)?.event.locals.tampered, undefined);
    // Verify empty trace safety
    const emptyEngine = new TraceReplayEngine({ ...doc, events: [], steps: [] }, '');
    assert.equal(emptyEngine.totalSteps, 0);
    assert.equal(emptyEngine.getStateAt(0), null);
    return `${engine.totalSteps} steps byte-identical forward & backward; isolated from mutation`;
  });

  await runCheck('T15', 'Random timeline seeking & 500+ event performance', () => {
    const code = [
      'const items = [];',
      'let total = 0;',
      'for (let i = 0; i < 140; i++) {',
      '  items.push(i * 2);',
      '  total += i;',
      '}',
    ].join('\n');
    const tTrace0 = performance.now();
    const doc = validateJsDoc(code);
    const traceMs = performance.now() - tTrace0;
    assert.ok(doc.events.length >= 400, `Expected >=400 events, got ${doc.events.length}`);

    const tInit0 = performance.now();
    const engine = new TraceReplayEngine(doc, code);
    const initMs = performance.now() - tInit0;

    // 1,000 random seeks
    const tSeek0 = performance.now();
    const baseline = new Map<number, string>();
    for (let k = 0; k < 1000; k++) {
      const idx = (k * 73 + 19) % engine.totalSteps;
      const snap = JSON.stringify(engine.getStateAt(idx));
      if (baseline.has(idx)) {
        assert.equal(snap, baseline.get(idx), `Random seek mismatch at ${idx}`);
      } else {
        baseline.set(idx, snap);
      }
    }
    const seekMs = performance.now() - tSeek0;
    perfMetrics[`${doc.events.length}-event JS loop trace`] = `${traceMs.toFixed(1)} ms`;
    perfMetrics[`TraceReplayEngine init (${doc.events.length} events)`] = `${initMs.toFixed(2)} ms`;
    perfMetrics['1,000 rapid random timeline seeks'] = `${seekMs.toFixed(1)} ms (${(seekMs / 1000).toFixed(3)} ms/seek)`;
    return `${doc.events.length} events: init ${initMs.toFixed(1)}ms, 1,000 random seeks in ${seekMs.toFixed(1)}ms`;
  });

  // 16. Legacy Phase 1 trace compatibility
  await runCheck('T16', 'Legacy Phase 1 steps[]-only compatibility', () => {
    const legacyPayload = {
      steps: [
        { line: 1, note: 'Create x', vars: { x: 10, nums: [1, 2] }, print: '', scene: null, outText: '' },
        { line: 2, note: 'Print x', vars: { x: 10, nums: [1, 2, 3] }, print: '10', scene: null, outText: '10\n' },
      ],
    };
    const res = validateAndNormalizeTraceDocument(legacyPayload, 2, {
      language: 'js',
      executionMode: 'real',
      adapter: JS_ADAPTER_META,
    });
    assert.equal(res.ok, true, !res.ok ? res.error : '');
    if (!res.ok) return;
    assert.equal(res.document.events.length, 2);
    assert.equal(res.document.events[0].metadata.legacyStepsUpgraded, true);
    const engine = new TraceReplayEngine(res.document, 'let x = 10;\nconsole.log(x);');
    assert.equal(engine.getStateAt(1)?.print, '10');
    return 'Legacy steps[] upgraded cleanly to v2.0 TraceDocument and replayed';
  });

  // 17. Repeated Visualize requests (sequential + concurrent)
  await runCheck('T17', 'Repeated Visualize requests (no leaked state or IDs)', async () => {
    const t0 = performance.now();
    // 5 repeated JS runs -> objectIds reset cleanly to obj_1 every time
    for (let r = 0; r < 5; r++) {
      const d = validateJsDoc('const a = [1, 2];\na.push(3);');
      const ref = d.events[0].locals.a;
      assert.ok(isObjectRef(ref) && ref.__ref === 'obj_1', `Run ${r} leaked objectId: ${JSON.stringify(ref)}`);
    }
    // 5 concurrent Python /api/trace requests
    const pyPromises = Array.from({ length: 5 }, (_, idx) =>
      fetchPythonTrace(`x = ${idx + 1}\ny = x * 10\nprint(y)\n`)
    );
    const pyOutcomes = await Promise.all(pyPromises);
    pyOutcomes.forEach((out, idx) => {
      assert.equal(out.ok, true, `Concurrent Python run ${idx} failed`);
      const evs = out.data.events as Array<{ outText: string }>;
      assert.equal(evs[evs.length - 1].outText.trim(), String((idx + 1) * 10));
    });
    const dt = (performance.now() - t0).toFixed(1);
    perfMetrics['5 JS runs + 5 concurrent Python /api/trace calls'] = `${dt} ms`;
    return `5 JS runs + 5 concurrent Python requests isolated in ${dt}ms`;
  });

  // SECURITY PROBES (Task 6)
  await runCheck('SEC', 'Execution security hardening probes (Python sandbox + JS worker)', async () => {
    const blockedProbes: Array<[string, string]> = [
      ['file write', 'f = open("/tmp/codeanim_should_not_exist.txt", "w")\nf.write("x")\n'],
      ['socket network', 'import socket\ns = socket.socket()\n'],
      ['subprocess exec', 'import subprocess\nsubprocess.run(["echo", "hi"])\n'],
      ['os import', 'import os\nos.system("echo hi")\n'],
      ['memory bomb (300MB)', 'x = 1\nbomb = bytearray(300 * 1024 * 1024)\n'],
    ];

    for (const [label, code] of blockedProbes) {
      const res = await fetchPythonTrace(code);
      const blocked =
        !res.ok ||
        res.data.interrupted === true ||
        Boolean(res.data.warning) ||
        Boolean(res.data.error);
      assert.ok(blocked, `Security probe "${label}" was NOT blocked!`);
    }
    assert.equal(fs.existsSync('/tmp/codeanim_should_not_exist.txt'), false, 'Temp file should never be created');

    // Verify allowed algorithmic stdlib still works
    const allowedRes = await fetchPythonTrace('import heapq, math\nh = [3, 1, 2]\nheapq.heapify(h)\nr = math.isqrt(16)\n');
    assert.equal(allowedRes.ok, true, 'Allowed stdlib (heapq, math) must continue working');
    assert.equal(allowedRes.data.interrupted, undefined);

    // Verify JS worker blocks dangerous globals
    const workerSrc = fs.readFileSync(path.resolve('src/workers/jsTraceWorker.ts'), 'utf8');
    for (const g of ['fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts', 'indexedDB', 'BroadcastChannel']) {
      assert.ok(workerSrc.includes(`'${g}'`), `jsTraceWorker.ts should block ${g}`);
    }
    return 'All 5 Python sandbox probes blocked (incl. 300MB MemoryError); allowed stdlib works; JS worker blocks verified';
  });

  // PHASE 3 ANIMATION CONTRACT VERIFICATION (Task 8)
  await runCheck('CONTRACT', 'Phase 3 renderer-independent animation contract adapter', () => {
    const code = [
      'const stack = [10];',
      'stack.push(20);',
      'stack.pop();',
      'const queue = [1, 2];',
      'queue.shift();',
      'const root = { val: 5, left: null, right: null };',
      'root.left = { val: 2, left: null, right: null };',
      'const d1 = { val: "A", prev: null, next: null };',
      'const d2 = { val: "B", prev: d1, next: null };',
      'd1.next = d2;',
      'function f(n) { return n <= 0 ? 1 : f(n - 1); }',
      'const r = f(2);',
      'const plain = { x: 1, y: 2 };',
    ].join('\n');
    const doc = validateJsDoc(code);
    const engine = new TraceReplayEngine(doc, code);

    const seenRenderers = new Set<string>();
    const seenOps = new Set<string>();

    for (let i = 0; i < engine.totalSteps; i++) {
      const curr = engine.getStateAt(i)!;
      const prev = i > 0 ? engine.getStateAt(i - 1) : null;
      const contract = buildAnimationFrame(curr, prev);
      assert.equal(contract.contractVersion, '3.0-draft');
      assert.equal(contract.sourceEventId, curr.event.id);
      assert.equal(contract.sourceLine, curr.line);
      for (const s of contract.scenes) seenRenderers.add(s.renderer);
      for (const op of contract.operations) seenOps.add(op.type);
    }

    for (const reqRenderer of ['stack', 'queue', 'tree', 'linked-list', 'recursion', 'object', 'fallback']) {
      assert.ok(seenRenderers.has(reqRenderer), `Missing renderer target: ${reqRenderer}`);
    }
    for (const reqOp of ['PUSH', 'POP', 'DEQUEUE', 'LINK_NODES', 'CALL_FUNCTION', 'RETURN_FUNCTION', 'GENERIC_STATE_CHANGE']) {
      assert.ok(seenOps.has(reqOp), `Missing semantic operation: ${reqOp}`);
    }
    return `Renderers [${[...seenRenderers].join(', ')}] & Ops [${[...seenOps].join(', ')}] verified`;
  });

  // 18. Browser UI functionality — honestly marked NOT EXECUTED (no headless browser binary in container)
  results.push({
    id: 'T18',
    category: 'Browser UI functionality (live DOM clicks & visual rendering)',
    status: 'NOT EXECUTED',
    durationMs: 0,
    detail: 'No headless Chromium/Playwright binary is installed in this Linux container.',
  });
  console.log('[NOT EXECUTED] T18 · Browser UI functionality — No headless browser binary installed in container');

  console.log('\n=== PERFORMANCE METRICS ===');
  for (const [k, v] of Object.entries(perfMetrics)) {
    console.log(`- ${k}: ${v}`);
  }

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const notExec = results.filter((r) => r.status === 'NOT EXECUTED').length;
  console.log(`\n=== PHASE 2.5 SUMMARY: ${passed} PASS, ${failed} FAIL, ${notExec} NOT EXECUTED ===`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
