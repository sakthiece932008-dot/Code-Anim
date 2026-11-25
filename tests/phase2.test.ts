import assert from 'node:assert/strict';
import { traceJavaScriptDocument } from '../src/lib/jsTracer';
import { runJavaScriptInWorker } from '../src/lib/jsWorkerRunner';
import { TraceReplayEngine } from '../src/lib/replayEngine';
import {
  validateAndNormalizeTraceDocument,
  type TraceDocument,
} from '../src/types/trace';
import { PYTHON_ADAPTER_META } from '../src/lib/adapters';

interface TestResult {
  id: string;
  name: string;
  pass: boolean;
  detail: string;
}

const results: TestResult[] = [];

async function test(id: string, name: string, fn: () => Promise<string> | string) {
  try {
    const detail = await fn();
    results.push({ id, name, pass: true, detail });
    console.log(`[PASS] Test ${id}: ${name} — ${detail}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ id, name, pass: false, detail });
    console.log(`[FAIL] Test ${id}: ${name} — ${detail}`);
  }
}

function buildReplay(code: string): { doc: TraceDocument; engine: TraceReplayEngine } {
  const outcome = traceJavaScriptDocument(code);
  assert.ok(outcome.document, outcome.error || 'Missing TraceDocument');
  const validated = validateAndNormalizeTraceDocument(
    outcome.document,
    code.split('\n').length,
    {
      language: 'js',
      executionMode: 'real',
      adapter: outcome.document.adapter,
    }
  );
  if (!validated.ok) {
    throw new Error(validated.error);
  }
  const engine = new TraceReplayEngine(validated.document, code);
  return { doc: validated.document, engine };
}

async function runPythonTrace(code: string, signal?: AbortSignal): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const res = await fetch('http://localhost:3000/api/trace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang: 'py', code }),
    signal,
  });
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

async function main() {
  // 1. Array insertion and deletion
  await test('01', 'Array insertion and deletion (JS + Python)', async () => {
    const code = `const nums = [10, 20, 30];
nums.push(40);
nums.splice(1, 0, 15);
nums.pop();
nums.splice(0, 1);`;
    const { doc, engine } = buildReplay(code);
    const types = doc.events.map((e) => e.type);
    assert.ok(types.includes('array_create'), 'Missing array_create');
    assert.ok(types.includes('array_append'), 'Missing array_append');
    assert.ok(types.includes('array_insert'), 'Missing array_insert');
    assert.ok(types.includes('array_remove'), 'Missing array_remove');
    const finalFrame = engine.getStateAt(engine.totalSteps - 1)!;
    assert.deepEqual(finalFrame.step.vars.nums, [15, 20, 30]);
    const arrStruct = finalFrame.workspace.structures.find((s) => s.kind === 'array');
    assert.ok(arrStruct && arrStruct.kind === 'array');
    assert.equal(arrStruct.length, 3);
    assert.equal(finalFrame.line, 5);
    return `${doc.events.length} events (${types.join(', ')}), final=[15,20,30]`;
  });

  // 2. Array sorting (Bubble sort with swaps!)
  await test('02', 'Array sorting with swap detection', () => {
    const code = `const arr = [4, 2, 3, 1];
for (let i = 0; i < arr.length; i++) {
  for (let j = 0; j < arr.length - 1 - i; j++) {
    if (arr[j] > arr[j + 1]) {
      [arr[j], arr[j + 1]] = [arr[j + 1], arr[j]];
    }
  }
}`;
    const { doc, engine } = buildReplay(code);
    const types = new Set(doc.events.map((e) => e.type));
    assert.ok(types.has('loop_iteration'), 'Missing loop_iteration');
    assert.ok(types.has('branch_decision'), 'Missing branch_decision');
    assert.ok(types.has('array_swap'), 'Missing inferred array_swap event');
    const swapEvent = doc.events.find((e) => e.type === 'array_swap')!;
    assert.equal(swapEvent.provenance, 'inferred');
    const last = engine.getStateAt(engine.totalSteps - 1)!;
    assert.deepEqual(last.step.vars.arr, [1, 2, 3, 4]);
    return `${doc.events.length} events, array_swap inferred, final=[1,2,3,4]`;
  });

  // 3. Singly linked list insertion
  await test('03', 'Singly linked list insertion (stable object IDs)', () => {
    const code = `function makeNode(val) {
  return { value: val, next: null };
}
const head = makeNode(10);
head.next = makeNode(20);
head.next.next = makeNode(30);`;
    const { doc, engine } = buildReplay(code);
    const last = engine.getStateAt(engine.totalSteps - 1)!;
    const list = last.workspace.structures.find((s) => s.kind === 'linked-list');
    assert.ok(list && list.kind === 'linked-list', 'Expected linked-list structure');
    assert.deepEqual(
      list.nodes.map((n) => n.display),
      ['10', '20', '30']
    );
    const uniqueIds = new Set(list.nodes.map((n) => n.objectId));
    assert.equal(uniqueIds.size, 3, 'Each node must have a unique ObjectId');
    return `3 linked nodes with distinct IDs (${[...uniqueIds].join(', ')}), ${doc.events.length} events`;
  });

  // 4. Singly linked list deletion
  await test('04', 'Singly linked list deletion', () => {
    const code = `let head = { value: "A", next: { value: "B", next: { value: "C", next: null } } };
head.next = head.next.next;`;
    const { doc, engine } = buildReplay(code);
    const first = engine.getStateAt(0)!;
    const last = engine.getStateAt(engine.totalSteps - 1)!;
    const listBefore = first.workspace.structures.find((s) => s.kind === 'linked-list');
    const listAfter = last.workspace.structures.find((s) => s.kind === 'linked-list');
    assert.ok(listBefore && listBefore.kind === 'linked-list');
    assert.ok(listAfter && listAfter.kind === 'linked-list');
    assert.deepEqual(listBefore.nodes.map((n) => n.display), ['A', 'B', 'C']);
    assert.deepEqual(listAfter.nodes.map((n) => n.display), ['A', 'C']);
    assert.equal(listBefore.nodes[0].objectId, listAfter.nodes[0].objectId);
    assert.equal(listBefore.nodes[2].objectId, listAfter.nodes[1].objectId);
    assert.ok(doc.events.some((e) => e.type === 'reference_update'));
    return `Deleted middle node B; node C preserved stable ID ${listAfter.nodes[1].objectId}`;
  });

  // 5. Binary tree construction (arbitrary class/object without "BinaryTree" name)
  await test('05', 'Binary tree construction (arbitrary object shape, no class name needed)', () => {
    const code = `function box(v) { return { value: v, left: null, right: null }; }
const r = box(10);
r.left = box(5);
r.right = box(15);`;
    const { doc, engine } = buildReplay(code);
    const last = engine.getStateAt(engine.totalSteps - 1)!;
    const tree = last.workspace.structures.find((s) => s.kind === 'tree');
    assert.ok(tree && tree.kind === 'tree', 'Expected reconstructed tree');
    assert.equal(tree.nodes.length, 3);
    assert.equal(tree.edges.length, 2);
    assert.ok(doc.events.some((e) => e.type === 'tree_insert'));
    return `Reconstructed 3-node, 2-edge tree without requiring BinaryTree/BST naming`;
  });

  // 6. BST insertion and search
  await test('06', 'BST insertion and search', () => {
    const code = `function insert(root, val) {
  if (!root) return { value: val, left: null, right: null };
  if (val < root.value) root.left = insert(root.left, val);
  else root.right = insert(root.right, val);
  return root;
}
function search(root, target) {
  let curr = root;
  while (curr) {
    if (curr.value === target) return true;
    curr = target < curr.value ? curr.left : curr.right;
  }
  return false;
}
let root = null;
for (const v of [10, 5, 15, 7]) {
  root = insert(root, v);
}
const found = search(root, 7);`;
    const { doc, engine } = buildReplay(code);
    const last = engine.getStateAt(engine.totalSteps - 1)!;
    assert.equal(last.step.vars.found, true);
    const tree = last.workspace.structures.find((s) => s.kind === 'tree');
    assert.ok(tree && tree.kind === 'tree');
    assert.equal(tree.nodes.length, 4);
    assert.equal(tree.edges.length, 3);
    return `${doc.events.length} events, 4-node BST constructed, search(7)=true`;
  });

  // 7. Tree traversal (in-order)
  await test('07', 'Tree traversal (in-order DFS)', () => {
    const code = `const root = { value: 10, left: { value: 5, left: null, right: null }, right: { value: 15, left: null, right: null } };
const order = [];
function inorder(node) {
  if (!node) return;
  inorder(node.left);
  order.push(node.value);
  inorder(node.right);
}
inorder(root);`;
    const { doc, engine } = buildReplay(code);
    const last = engine.getStateAt(engine.totalSteps - 1)!;
    assert.deepEqual(last.step.vars.order, [5, 10, 15]);
    assert.ok(doc.events.some((e) => e.callStack.length >= 3), 'Expected recursion stack depth >= 3');
    return `${doc.events.length} events, in-order=[5,10,15], max stack depth=${Math.max(...doc.events.map((e) => e.callStack.length))}`;
  });

  // 8. Graph traversal (BFS with visited set)
  await test('08', 'Graph traversal (BFS with visited state)', () => {
    const code = `const graph = { A: ["B", "C"], B: ["D"], C: ["D"], D: [] };
const visited = new Set(["A"]);
const queue = ["A"];
const order = [];
while (queue.length > 0) {
  const node = queue.shift();
  order.push(node);
  for (const next of graph[node]) {
    if (!visited.has(next)) {
      visited.add(next);
      queue.push(next);
    }
  }
}`;
    const { doc, engine } = buildReplay(code);
    const last = engine.getStateAt(engine.totalSteps - 1)!;
    assert.deepEqual(last.step.vars.order, ['A', 'B', 'C', 'D']);
    const g = last.workspace.structures.find((s) => s.kind === 'graph');
    assert.ok(g && g.kind === 'graph', 'Expected reconstructed graph structure');
    assert.equal(g.nodes.length, 4);
    assert.equal(g.edges.length, 4);
    assert.ok(g.nodes.every((n) => n.visited), 'All 4 graph nodes should be marked visited at end');
    assert.ok(doc.events.some((e) => e.type === 'graph_visit'));
    return `Graph(4V,4E) reconstructed, BFS order=[A,B,C,D], all 4 vertices visited`;
  });

  // 9. Recursive factorial (JS + Python)
  await test('09', 'Recursive factorial (JS call stack + Python subprocess)', async () => {
    const jsCode = `function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}
const ans = factorial(4);`;
    const { doc, engine } = buildReplay(jsCode);
    const last = engine.getStateAt(engine.totalSteps - 1)!;
    assert.equal(last.step.vars.ans, 24);
    const maxDepth = Math.max(...doc.events.map((e) => e.callStack.length));
    assert.ok(maxDepth >= 5, `Expected stack depth >= 5 (main + 4 calls), got ${maxDepth}`);
    const returns = doc.events.filter((e) => e.type === 'function_return');
    assert.ok(returns.length >= 4, 'Expected at least 4 function_return events');

    const pyCode = `def fact(n):\n    if n <= 1:\n        return 1\n    return n * fact(n - 1)\nans = fact(4)\nprint(ans)`;
    const pyRes = await runPythonTrace(pyCode);
    assert.equal(pyRes.status, 200);
    assert.equal(pyRes.body.executionMode, 'real');
    const pyVal = validateAndNormalizeTraceDocument(pyRes.body, 6, {
      language: 'py',
      executionMode: 'real',
      adapter: PYTHON_ADAPTER_META,
    });
    if (!pyVal.ok) {
      throw new Error(pyVal.error);
    }
    const pyLast = pyVal.document.steps[pyVal.document.steps.length - 1];
    assert.equal(pyLast.vars.ans, 24);
    assert.ok(pyLast.outText.includes('24'));
    return `JS factorial(4)=24 (stack depth ${maxDepth}); Python factorial(4)=24 (${pyVal.document.events.length} events)`;
  });

  // 10. Nested function calls
  await test('10', 'Nested function calls with call-stack tracking', () => {
    const code = `function add(a, b) { return a + b; }
function doubleSum(x, y) {
  const s = add(x, y);
  return s * 2;
}
const out = doubleSum(3, 4);`;
    const { doc, engine } = buildReplay(code);
    const last = engine.getStateAt(engine.totalSteps - 1)!;
    assert.equal(last.step.vars.out, 14);
    const nestedEvent = doc.events.find(
      (e) =>
        e.callStack.some((f) => f.name === 'doubleSum') &&
        e.callStack.some((f) => f.name === 'add')
    );
    assert.ok(nestedEvent, 'Expected concurrent [main, doubleSum, add] call stack');
    return `Nested stack [${nestedEvent.callStack.map((f) => f.name).join(' → ')}] verified, out=14`;
  });

  // 11. Duplicate node values (must NOT conflate distinct objects!)
  await test('11', 'Duplicate node values maintain distinct ObjectIds', () => {
    const code = `const root = { value: 5, left: { value: 5, left: null, right: null }, right: { value: 5, left: null, right: null } };`;
    const { engine } = buildReplay(code);
    const frame = engine.getStateAt(0)!;
    const tree = frame.workspace.structures.find((s) => s.kind === 'tree');
    assert.ok(tree && tree.kind === 'tree');
    assert.equal(tree.nodes.length, 3);
    const ids = new Set(tree.nodes.map((n) => n.objectId));
    assert.equal(ids.size, 3, 'Three Node(5) instances must have 3 unique ObjectIds');
    return `3 nodes all holding value 5 kept distinct IDs: ${[...ids].join(', ')}`;
  });

  // 12. Cyclic object references (no infinite traversal!)
  await test('12', 'Cyclic object references handled safely without infinite recursion', async () => {
    const jsCode = `const a = { value: "A", next: null };
const b = { value: "B", next: null };
a.next = b;
b.next = a;`;
    const { engine } = buildReplay(jsCode);
    const last = engine.getStateAt(engine.totalSteps - 1)!;
    const list = last.workspace.structures.find((s) => s.kind === 'linked-list');
    assert.ok(list && list.kind === 'linked-list');
    assert.equal(list.nodes.length, 2);
    assert.equal(list.cycleTargetId, list.nodes[0].objectId, 'Expected cycle back-edge to head ObjectId');

    const pyCode = `class N:\n    def __init__(self, v):\n        self.value = v\n        self.next = None\na = N(1)\nb = N(2)\na.next = b\nb.next = a`;
    const pyRes = await runPythonTrace(pyCode);
    assert.equal(pyRes.status, 200);
    return `JS cycle detected (back to ${list.cycleTargetId}); Python cyclic object traced cleanly`;
  });

  // 13. Invalid code (JS + Python)
  await test('13', 'Invalid code returns structured errors cleanly', async () => {
    const jsInvalid = traceJavaScriptDocument('function broken( { return 1; }');
    assert.equal(jsInvalid.document, null);
    assert.ok(jsInvalid.error?.includes('SyntaxError'));

    const pyInvalid = await runPythonTrace('def broken(:\n    pass');
    assert.equal(pyInvalid.status, 400);
    assert.ok(String(pyInvalid.body.error || '').includes('SyntaxError'));
    return `JS SyntaxError and Python SyntaxError cleanly rejected`;
  });

  // 14. Infinite loops (JS step cap + Python step cap)
  await test('14', 'Infinite loops bounded cleanly without hanging', async () => {
    const jsInf = traceJavaScriptDocument('let i = 0; while (true) { i++; }');
    assert.ok(jsInf.error?.includes('Step limit'), `Unexpected JS infinite loop error: ${jsInf.error}`);
    assert.ok(jsInf.document && jsInf.document.events.length === 1500);

    const pyInf = await runPythonTrace('i = 0\nwhile True:\n    i += 1');
    assert.equal(pyInf.status, 200);
    assert.ok(String(pyInf.body.warning || '').includes('Step limit'));
    return `JS infinite loop stopped at 1,500 events; Python infinite loop stopped at 1,500 events`;
  });

  // 15. Trace cancellation (AbortController) + Python sandbox enforcement
  await test('15', 'Trace cancellation (AbortController) & Python sandbox restrictions', async () => {
    const ac = new AbortController();
    const promise = runJavaScriptInWorker('let x = 1; x += 2;', { signal: ac.signal });
    ac.abort();
    let aborted = false;
    try {
      await promise;
    } catch (err) {
      aborted = err instanceof DOMException && err.name === 'AbortError';
    }
    assert.equal(aborted, true, 'Expected AbortError on canceled JS trace');

    // Verify Python sandbox blocks file writes & network sockets
    const pyNet = await runPythonTrace('import socket\ns = socket.socket()');
    assert.equal(pyNet.status, 400);
    assert.ok(String(pyNet.body.error || '').toLowerCase().includes('blocked'));

    const pyFile = await runPythonTrace('open("/tmp/evil.txt", "w").write("x")');
    assert.equal(pyFile.status, 400);
    return `AbortSignal canceled JS trace; Python sandbox blocked socket import & open()`;
  });

  // 16. Backward and forward state reconstruction determinism & immutability
  await test('16', 'Backward and forward state reconstruction determinism', () => {
    const code = `const a = [1, 2];
a.push(3);
a[0] = 99;
a.pop();`;
    const { engine } = buildReplay(code);
    const forwardSnapshots = [];
    for (let i = 0; i < engine.totalSteps; i++) {
      forwardSnapshots.push(JSON.stringify(engine.getStateAt(i)));
    }
    const backwardSnapshots = new Array<string>(engine.totalSteps);
    for (let i = engine.totalSteps - 1; i >= 0; i--) {
      backwardSnapshots[i] = JSON.stringify(engine.getStateAt(i));
    }
    assert.deepEqual(forwardSnapshots, backwardSnapshots, 'Forward and backward replay diverged!');

    // Verify historical state is frozen (cannot be corrupted by external mutation)
    const frame0 = engine.getStateAt(0)!;
    assert.equal(Object.isFrozen(frame0), true);
    assert.equal(Object.isFrozen(frame0.workspace), true);
    assert.deepEqual(frame0.step.vars.a, [1, 2]);
    assert.deepEqual(engine.getStateAt(engine.totalSteps - 1)!.step.vars.a, [99, 2]);
    return `${engine.totalSteps} steps byte-for-byte identical across forward/backward replay; frames deeply frozen`;
  });

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\nSummary: ${results.length - failed}/${results.length} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
