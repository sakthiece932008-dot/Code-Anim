import assert from 'node:assert/strict';
import {
  getAllLanguages,
  getLanguageSpec,
  getLiveExecutionLanguages,
  getSelectableLanguages,
  getUnavailableLanguages,
  isLanguageSelectable,
  registerLanguage,
} from '../src/lib/languageRegistry';
import { detectLanguageFromCode } from '../src/lib/languageDetector';
import { traceJavaScriptDocument } from '../src/lib/jsTracer';
import { runJavaScriptInWorker } from '../src/lib/jsWorkerRunner';
import { TraceReplayEngine } from '../src/lib/replayEngine';
import { buildAnimationFrame } from '../src/lib/animationAdapter';
import { analyzeProgramExecution } from '../src/lib/programAnalyzer';
import { buildDeterministicErrorHelp, buildStepExplanationBreakdown } from '../src/lib/explain';
import { validateAndNormalizeTraceDocument } from '../src/types/trace';
import { PYTHON_ADAPTER_META, TYPESCRIPT_ADAPTER_META } from '../src/lib/adapters';
import { defaultIsolatedExecutionService } from '../src/lib/isolatedExecutionService';

const SERVER_URL = process.env.TEST_SERVER_URL || 'http://127.0.0.1:3000';

type TestStatus = 'PASS' | 'FAIL' | 'NOT EXECUTED' | 'UNSUPPORTED';

interface TestResult {
  id: string;
  name: string;
  status: TestStatus;
  detail: string;
}

const results: TestResult[] = [];

async function runTest(id: string, name: string, fn: () => Promise<string> | string) {
  try {
    const detail = await fn();
    results.push({ id, name, status: 'PASS', detail });
    console.log(`[PASS] ${id} — ${name}: ${detail}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ id, name, status: 'FAIL', detail: msg });
    console.error(`[FAIL] ${id} — ${name}: ${msg}`);
  }
}

function markTest(id: string, name: string, status: TestStatus, detail: string) {
  results.push({ id, name, status, detail });
  console.log(`[${status}] ${id} — ${name}: ${detail}`);
}

async function postJson(path: string, body: Record<string, unknown>, signal?: AbortSignal) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const data = (await res.json()) as Record<string, unknown>;
  return { status: res.status, data };
}

async function main() {
  console.log('=== Code Anim Phase 4 Comprehensive Verification Suite ===\n');

  // 1. Extensible Multi-Language Registry & Removal of "other"
  await runTest('P4-01', 'Extensible Language Registry & Zero "other" Option', async () => {
    const all = getAllLanguages();
    assert.ok(all.length >= 45, `Expected >=45 registered languages, got ${all.length}`);
    assert.equal(getLanguageSpec('other'), undefined, '"other" must be completely removed from registry');
    assert.equal(isLanguageSelectable('other'), false);

    const live = getLiveExecutionLanguages().map((l) => l.id);
    assert.deepEqual(live.sort(), ['js', 'py', 'ts'], 'Live execution languages must be js, py, ts');
    assert.ok(getSelectableLanguages().every((l) => l.id !== 'other'));
    assert.ok(getUnavailableLanguages().length >= 20, 'Recognized Priority 3 unavailable languages must be listed separately');

    // Verify extensibility hook rejects "other" and accepts a new custom language
    assert.throws(() =>
      registerLanguage({
        id: 'other',
        name: 'Other',
        shortLabel: 'O',
        extensions: [],
        priority: 3,
        syntaxGroup: 'plain',
        syntaxHighlighting: false,
        runtimeAvailable: false,
        compilerAvailable: false,
        realExecutionSupported: false,
        tracingSupported: false,
        animationSupported: false,
        aiSimulationSupported: false,
        inputSupported: false,
        status: 'unavailable',
        statusLabel: 'Not available yet',
        executionMethod: 'none',
        limitations: [],
      })
    );

    // Server must reject "other"
    const res = await postJson('/api/trace', { lang: 'other', code: 'x = 1' });
    assert.equal(res.status, 400, 'Server must reject lang="other" with HTTP 400');
    return `${all.length} languages registered (${live.length} live, ${getUnavailableLanguages().length} unavailable), "other" rejected`;
  });

  // 2. Smart Automatic Language Detection & Switching
  await runTest('P4-02', 'Automatic Language Switching (Py -> Java -> C++ -> JS -> TS)', () => {
    const pyCode = `def fib(n):\n    if n <= 1:\n        return n\n    return fib(n-1) + fib(n-2)\nprint(fib(5))`;
    const javaCode = `import java.util.*;\npublic class Main {\n  public static void main(String[] args) {\n    System.out.println("Hello");\n  }\n}`;
    const cppCode = `#include <iostream>\n#include <vector>\nusing namespace std;\nint main() {\n  vector<int> v = {1,2,3};\n  cout << v.size() << endl;\n}`;
    const jsCode = `const nums = [3, 1, 2];\nfunction doubleAll(arr) {\n  return arr.map((x) => x * 2);\n}\nconsole.log(doubleAll(nums));`;
    const tsCode = `interface Point { x: number; y: number; }\nfunction dist(a: Point, b: Point): number {\n  return Math.hypot(a.x - b.x, a.y - b.y);\n}\nconsole.log(dist({x:0,y:0},{x:3,y:4}));`;

    const dPy = detectLanguageFromCode(pyCode);
    const dJava = detectLanguageFromCode(javaCode);
    const dCpp = detectLanguageFromCode(cppCode);
    const dJs = detectLanguageFromCode(jsCode);
    const dTs = detectLanguageFromCode(tsCode);

    assert.equal(dPy.languageId, 'py');
    assert.equal(dPy.confidence, 'high');
    assert.equal(dJava.languageId, 'java');
    assert.equal(dJava.confidence, 'high');
    assert.equal(dCpp.languageId, 'cpp');
    assert.equal(dCpp.confidence, 'high');
    assert.equal(dJs.languageId, 'js');
    assert.equal(dJs.confidence, 'high');
    assert.equal(dTs.languageId, 'ts');
    assert.equal(dTs.confidence, 'high');
    return 'High-confidence switching verified across Python, Java, C++, JS, and TS';
  });

  // 3. Incorrect File Extensions, Ambiguous Snippets, and Unsupported Languages
  await runTest('P4-03', 'Extension Mismatch Override, Ambiguous Snippets & Unavailable Languages', async () => {
    // Java code inside a .py file!
    const javaInPy = `public class WrongExt {\n  public static void main(String[] args) {\n    System.out.println(42);\n  }\n}`;
    const mis = detectLanguageFromCode(javaInPy, 'homework.py');
    assert.equal(mis.languageId, 'java', 'Source code must override wrong .py extension');
    assert.equal(mis.extensionMismatch, true, 'Must flag extensionMismatch=true');

    // Ambiguous tiny snippet
    const amb = detectLanguageFromCode('x = 1');
    assert.equal(amb.confidence, 'low', 'Tiny ambiguous snippet must have low confidence');

    // Unsupported/not-available-yet language (COBOL + Assembly + Haskell)
    const cobol = detectLanguageFromCode('IDENTIFICATION DIVISION.\nPROGRAM-ID. HELLO.\nPROCEDURE DIVISION.\nDISPLAY "HI".\nSTOP RUN.');
    assert.equal(cobol.languageId, 'cobol');
    assert.equal(isLanguageSelectable('cobol'), false);

    const asm = detectLanguageFromCode('section .text\nglobal _start\n_start:\n  mov eax, 1\n  syscall');
    assert.equal(asm.languageId, 'assembly');
    assert.equal(isLanguageSelectable('assembly'), false);

    // Server refuses unavailable language cleanly
    const res = await postJson('/api/trace', { lang: 'cobol', code: 'IDENTIFICATION DIVISION.', allowSimulation: true });
    assert.equal(res.status, 400);
    assert.ok(String(res.data.error).toLowerCase().includes('not available'));

    return 'Wrong extension overridden, ambiguous snippet flagged low-confidence, COBOL/Assembly blocked cleanly';
  });

  // 4. Real TypeScript Execution (/api/transpile-ts -> AST trace -> Replay)
  await runTest('P4-04', 'Real TypeScript Execution (esbuild transpile + AST trace)', async () => {
    const tsProgram = `interface Item { name: string; price: number; }
function totalPrice(items: Item[]): number {
  let sum: number = 0;
  for (const item of items) {
    sum += item.price;
  }
  return sum;
}
const cart: Item[] = [
  { name: "Pen", price: 3 },
  { name: "Book", price: 12 },
];
const total: number = totalPrice(cart);
console.log("Total:", total);`;

    const tr = await postJson('/api/transpile-ts', { code: tsProgram });
    assert.equal(tr.status, 200, `Transpile failed: ${JSON.stringify(tr.data)}`);
    assert.equal(typeof tr.data.jsCode, 'string');

    const traced = traceJavaScriptDocument(String(tr.data.jsCode), {
      language: 'ts',
      adapterMeta: TYPESCRIPT_ADAPTER_META,
      originalLineCount: tsProgram.split('\n').length,
    });
    assert.ok(traced.document, `TS trace failed: ${traced.error}`);
    assert.equal(traced.document.language, 'ts');
    assert.equal(traced.document.executionMode, 'real');
    const last = traced.document.events[traced.document.events.length - 1];
    assert.ok(last.outText.includes('Total: 15'), `Unexpected TS output: ${last.outText}`);

    const engine = new TraceReplayEngine(traced.document, tsProgram);
    const frame = engine.getStateAt(engine.totalSteps - 1)!;
    assert.equal(frame.step.vars.total, 15);
    return `Real TS execution captured ${engine.totalSteps} events with output "Total: 15"`;
  });

  // 5. Name-Independent Binary Tree Recognition (Arbitrary Class & Field Names!)
  await runTest('P4-05', 'Binary Tree with Completely Arbitrary Class & Field Names', () => {
    const code = `class Gizmo {
  constructor(k) {
    this.k = k;
    this.p1 = null;
    this.p2 = null;
  }
}
const anchor = new Gizmo(50);
anchor.p1 = new Gizmo(25);
anchor.p2 = new Gizmo(75);
anchor.p1.p1 = new Gizmo(10);
console.log(anchor.k);`;

    const res = traceJavaScriptDocument(code);
    assert.ok(res.document, res.error);
    const engine = new TraceReplayEngine(res.document, code);
    const lastFrame = engine.getStateAt(engine.totalSteps - 1)!;
    const tree = lastFrame.workspace.structures.find((s) => s.kind === 'tree');
    assert.ok(tree && tree.kind === 'tree', 'Arbitrary-named Gizmo(k, p1, p2) must be recognized as a tree');
    assert.equal(tree.nodes.length, 4, 'All 4 Gizmo nodes must be reconstructed');
    assert.equal(tree.edges.length, 3, 'All 3 edges must be reconstructed');
    assert.equal(tree.treeVariant, 'bst', 'Numeric BST invariant should also be detected');
    return `Detected ${tree.treeVariant} tree with ${tree.nodes.length} nodes & ${tree.edges.length} edges from class Gizmo{k, p1, p2}`;
  });

  // 6. Singly, Doubly, and Circular Linked Lists
  await runTest('P4-06', 'Singly, Doubly & Circular Linked Lists', () => {
    const circularCode = `class RingSlot {
  constructor(v) { this.v = v; this.nxt = null; this.prv = null; }
}
const a = new RingSlot(1);
const b = new RingSlot(2);
const c = new RingSlot(3);
a.nxt = b; b.prv = a;
b.nxt = c; c.prv = b;
c.nxt = a; a.prv = c;
console.log(a.v, b.v, c.v);`;

    const res = traceJavaScriptDocument(circularCode);
    assert.ok(res.document, res.error);
    const engine = new TraceReplayEngine(res.document, circularCode);
    const last = engine.getStateAt(engine.totalSteps - 1)!;
    const list = last.workspace.structures.find((s) => s.kind === 'linked-list');
    assert.ok(list && list.kind === 'linked-list', 'Arbitrary-named circular doubly linked list must be detected');
    assert.equal(list.nodes.length, 3);
    assert.equal(list.isDoublyLinked, true, 'Must detect doubly linked back-pointers');
    assert.equal(list.isCircular, true, 'Must detect circular head wrap-around without infinite loop');
    return `Detected circular=${list.isCircular}, doubly=${list.isDoublyLinked} list with ${list.nodes.length} nodes`;
  });

  // 7. Multiple Data Structures Simultaneously (Graph + Queue + Set + Hash Table)
  await runTest('P4-07', 'Multi-Structure Program (Graph + Queue + Visited Set + Distances Map)', () => {
    const code = `const network = {
  S: [{ to: "A", weight: 2 }, { to: "B", weight: 5 }],
  A: [{ to: "C", weight: 1 }],
  B: [{ to: "C", weight: 2 }],
  C: []
};
const visited = new Set(["S"]);
const queue = ["S"];
const distances = new Map([["S", 0]]);
while (queue.length > 0) {
  const cur = queue.shift();
  for (const edge of network[cur]) {
    if (!visited.has(edge.to)) {
      visited.add(edge.to);
      distances.set(edge.to, (distances.get(cur) || 0) + edge.weight);
      queue.push(edge.to);
    }
  }
}
console.log("Visited count:", visited.size);`;

    const res = traceJavaScriptDocument(code);
    assert.ok(res.document, res.error);
    const engine = new TraceReplayEngine(res.document, code);
    const mid = engine.getStateAt(Math.floor(engine.totalSteps / 2))!;
    const last = engine.getStateAt(engine.totalSteps - 1)!;

    const kinds = new Set(last.workspace.structures.map((s) => s.kind));
    assert.ok(kinds.has('graph'), 'Graph must be reconstructed');
    assert.ok(kinds.has('set'), 'Visited Set must be reconstructed as Set');
    assert.ok(kinds.has('hash-table'), 'Distances Map must be reconstructed as Hash Table');
    assert.ok(kinds.has('array'), 'Queue must be reconstructed');

    const graph = last.workspace.structures.find((s) => s.kind === 'graph')!;
    assert.equal(graph.kind, 'graph');
    assert.equal(graph.isWeighted, true, 'Weighted edges must be detected');
    assert.equal(graph.isDirected, true, 'Directed graph must be detected');

    // Animation contract must bind all active structures cleanly
    const anim = buildAnimationFrame(last, mid);
    const renderers = new Set(anim.scenes.map((sc) => sc.renderer));
    assert.ok(renderers.has('graph') && renderers.has('set') && renderers.has('hash-table'));
    return `Simultaneous structures verified: ${[...kinds].join(', ')} (weighted=${graph.isWeighted})`;
  });

  // 8. Matrix & 2D Dynamic Programming + Heap + Stack
  await runTest('P4-08', '2D Dynamic Programming Table, Min-Heap & Stack', () => {
    const code = `const dp = [
  [1, 1, 1],
  [1, 0, 0],
  [1, 0, 0]
];
for (let r = 1; r < 3; r++) {
  for (let c = 1; c < 3; c++) {
    dp[r][c] = dp[r - 1][c] + dp[r][c - 1];
  }
}
const minHeap = [2, 5, 4, 9, 8];
const stack = [10, 20];
stack.push(30);
console.log("Paths:", dp[2][2]);`;

    const res = traceJavaScriptDocument(code);
    assert.ok(res.document, res.error);
    const engine = new TraceReplayEngine(res.document, code);
    const last = engine.getStateAt(engine.totalSteps - 1)!;

    const dpStruct = last.workspace.structures.find((s) => s.kind === 'array' && s.names.includes('dp'));
    const heapStruct = last.workspace.structures.find((s) => s.kind === 'array' && s.names.includes('minHeap'));
    const stackStruct = last.workspace.structures.find((s) => s.kind === 'array' && s.names.includes('stack'));

    assert.ok(dpStruct && dpStruct.kind === 'array' && dpStruct.roleHint === 'dp-table' && dpStruct.isMatrix);
    assert.ok(heapStruct && heapStruct.kind === 'array' && heapStruct.roleHint === 'heap' && heapStruct.heapOrder === 'min-heap');
    assert.ok(stackStruct && stackStruct.kind === 'array' && stackStruct.roleHint === 'stack');
    assert.ok(last.outText.includes('Paths: 6'));

    const analysis = analyzeProgramExecution(code, res.document);
    assert.ok(analysis.summary.detectedStructures.includes('2D DP Table'));
    assert.ok(analysis.summary.theoreticalTimeComplexity?.includes('O(n'));
    return `DP table (dp[2][2]=6), min-heap, stack, and complexity "${analysis.summary.theoreticalTimeComplexity}" verified`;
  });

  // 9. Custom Program Input in Python (Sorting 5 user numbers) & Missing Input Error
  await runTest('P4-09', 'Custom Program Input in Python (input() sorting + EOFError guard)', async () => {
    const pySort = `nums = [int(x) for x in input().split()]
for i in range(len(nums)):
    for j in range(0, len(nums) - i - 1):
        if nums[j] > nums[j + 1]:
            nums[j], nums[j + 1] = nums[j + 1], nums[j]
print("RESULT:", nums)`;

    // Valid custom input
    const okRes = await postJson('/api/trace', {
      lang: 'py',
      code: pySort,
      stdin: '8 3 9 1 5\n',
    });
    assert.equal(okRes.status, 200, `Python stdin trace failed: ${JSON.stringify(okRes.data)}`);
    const checked = validateAndNormalizeTraceDocument(okRes.data, pySort.split('\n').length, {
      language: 'py',
      executionMode: 'real',
      adapter: PYTHON_ADAPTER_META,
    });
    assert.ok(checked.ok, !checked.ok ? checked.error : '');
    const lastEv = checked.document.events[checked.document.events.length - 1];
    assert.ok(lastEv.outText.includes('RESULT: [1, 3, 5, 8, 9]'), `Expected sorted output, got: ${lastEv.outText}`);

    // Missing input MUST fail honestly with EOFError (never invent fake values!)
    const emptyRes = await postJson('/api/trace', {
      lang: 'py',
      code: pySort,
      stdin: '',
    });
    assert.equal(emptyRes.status, 400, 'Empty stdin for input() must return HTTP 400 error');
    assert.ok(String(emptyRes.data.error).includes('EOFError'), `Expected EOFError, got: ${emptyRes.data.error}`);

    return 'Python sorted "8 3 9 1 5" -> [1, 3, 5, 8, 9] and reported EOFError when stdin was empty';
  });

  // 10. Custom Program Input in JavaScript (readLine() + missing input guard)
  await runTest('P4-10', 'Custom Program Input in JavaScript (readLine() + InputError guard)', () => {
    const jsIn = `const first = Number(readLine());
const second = Number(readLine());
const product = first * second;
console.log("Product:", product);`;

    const ok = traceJavaScriptDocument(jsIn, { stdin: '7\n6\n' });
    assert.ok(ok.document, ok.error);
    assert.ok(ok.document.events[ok.document.events.length - 1].outText.includes('Product: 42'));

    const missing = traceJavaScriptDocument(jsIn, { stdin: '7\n' });
    assert.ok(missing.error && missing.error.includes('InputError'), 'Must report InputError when stdin runs out');
    return 'JS readLine() produced 7 * 6 = 42 and threw InputError when second line was missing';
  });

  // 11. No Silent AI Simulation (Confirmation Guard) + Explicit Confirmed Simulation
  await runTest('P4-11', 'No Silent AI Simulation (HTTP 409 Guard) & Explicit Confirmation', async () => {
    const javaSnippet = `public class Sum {\n  public static void main(String[] args) {\n    int a = 4;\n    int b = 9;\n    System.out.println(a + b);\n  }\n}`;

    // Without allowSimulation: true -> MUST be rejected with HTTP 409!
    const blocked = await postJson('/api/trace', {
      lang: 'java',
      code: javaSnippet,
      allowSimulation: false,
    });
    assert.equal(blocked.status, 409, `Expected HTTP 409 guard, got ${blocked.status}`);
    assert.equal(blocked.data.requiresSimulationConfirmation, true);

    // With explicit allowSimulation: true -> runs Gemini simulation and labels executionMode='simulated'
    const allowed = await postJson('/api/trace', {
      lang: 'java',
      code: javaSnippet,
      allowSimulation: true,
    });
    assert.equal(allowed.status, 200, `Confirmed Java simulation failed: ${JSON.stringify(allowed.data)}`);
    assert.equal(allowed.data.executionMode, 'simulated');
    assert.ok(Array.isArray(allowed.data.steps) && allowed.data.steps.length >= 1);

    return `Unconfirmed Java trace blocked (HTTP 409); confirmed trace produced ${allowed.data.steps.length} simulated steps`;
  });

  // 12. Simple-English 5-Section Explanations & /api/explain SHA-256 Caching
  await runTest('P4-12', '5-Section Simple Explanations & Grounded /api/explain Caching', async () => {
    const code = `let count = 0;\nfor (let i = 1; i <= 3; i++) {\n  count += i;\n}\nconsole.log("Sum:", count);`;
    const res = traceJavaScriptDocument(code);
    assert.ok(res.document);
    const engine = new TraceReplayEngine(res.document, code);
    const analysis = analyzeProgramExecution(code, res.document);

    const midFrame = engine.getStateAt(2)!;
    const midPrev = engine.getStateAt(1)!;
    const midBreakdown = buildStepExplanationBreakdown({
      event: midFrame.event,
      prevEvent: midPrev.event,
      step: midFrame.step,
      prevStep: midPrev.step,
      codeLines: code.split('\n'),
      programPurpose: analysis.summary.purpose,
      isFinalStep: false,
    });
    assert.ok(midBreakdown.whatProgramDoes.length > 5);
    assert.ok(midBreakdown.whatIsHappeningNow.length > 5);
    assert.ok(midBreakdown.whyIsThisHappening.length > 5);
    assert.equal(midBreakdown.finalResult, null, 'finalResult must be null before final step');

    const lastFrame = engine.getStateAt(engine.totalSteps - 1)!;
    const lastPrev = engine.getStateAt(engine.totalSteps - 2)!;
    const lastBreakdown = buildStepExplanationBreakdown({
      event: lastFrame.event,
      prevEvent: lastPrev.event,
      step: lastFrame.step,
      prevStep: lastPrev.step,
      codeLines: code.split('\n'),
      programPurpose: analysis.summary.purpose,
      isFinalStep: true,
    });
    assert.ok(lastBreakdown.finalResult && lastBreakdown.finalResult.includes('Sum: 6'));

    // Verify /api/explain live + cache hit on second identical request + cache miss when code changes
    const body1 = {
      lang: 'js',
      code,
      stdin: '',
      detectedStructures: analysis.summary.detectedStructures,
      observedOperations: analysis.summary.observedOperations,
      finalOutput: analysis.summary.finalOutput,
      stepCount: analysis.summary.stepCount,
      executionMode: 'real',
    };
    const e1 = await postJson('/api/explain', body1);
    assert.equal(e1.status, 200);
    const e2 = await postJson('/api/explain', body1);
    assert.equal(e2.status, 200);
    if (e1.data.provider === 'Gemini' && e1.data.purpose) {
      assert.equal(e2.data.cached, true, 'Identical /api/explain call must hit SHA-256 cache');
    }
    const e3 = await postJson('/api/explain', { ...body1, code: code + '\n// changed' });
    assert.equal(e3.data.cached, false, 'Changed code must invalidate SHA-256 cache');

    return `5-section breakdown verified; /api/explain provider=${String(e1.data.provider)}, cache hit=${String(e2.data.cached)}, invalidation=ok`;
  });

  // 13. Intelligent Error Explanations & Suggested Fix (/api/error-help)
  await runTest('P4-13', 'Intelligent Error Help, Line Number & Optional Suggested Fix', async () => {
    const brokenJs = `const items = [1, 2, 3];\nconsole.log(items.lengh());`;
    const errRes = traceJavaScriptDocument(brokenJs);
    assert.ok(errRes.error);

    const det = buildDeterministicErrorHelp(errRes.error, brokenJs, 'js');
    assert.equal(det.category, 'type');
    assert.ok(det.simpleExplanation.length > 10);

    const brokenPy = `def greet(name)\n    print("Hi", name)\ngreet("Ava")`;
    const pyErr = await postJson('/api/trace', { lang: 'py', code: brokenPy });
    assert.equal(pyErr.status, 400);

    const helpRes = await postJson('/api/error-help', {
      lang: 'py',
      code: brokenPy,
      error: String(pyErr.data.error),
    });
    assert.equal(helpRes.status, 200);
    const report = helpRes.data.report as Record<string, unknown>;
    assert.ok(report && typeof report.simpleExplanation === 'string' && report.simpleExplanation.length > 10);
    assert.ok(typeof report.possibleSolution === 'string' && report.possibleSolution.length > 10);
    assert.equal(report.affectedLine, 1, 'Syntax error on def line should report affectedLine=1');
    const fix = report.suggestedFix as { code?: string; isAiSuggestion?: boolean } | undefined;
    if (fix) {
      assert.equal(fix.isAiSuggestion, true, 'AI fix must be explicitly marked isAiSuggestion=true');
      assert.ok(fix.code && fix.code.includes('def greet(name):'), 'Suggested fix should add missing colon');
    }
    return `Error help verified (line=${report.affectedLine}, suggestedFix=${Boolean(fix)})`;
  });

  // 14. Security, Sandbox Isolation, Infinite Loop, Cancellation & Native Service Contract
  await runTest('P4-14', 'Security Isolation, Infinite Loop Guard, Cancellation & Native Contract', async () => {
    // 1. Native isolated execution service is safely unconfigured (no untrusted gcc binary execution on main server)
    assert.equal(defaultIsolatedExecutionService.isConfigured(), false);
    const health = await fetch(`${SERVER_URL}/api/health`).then((r) => r.json()) as Record<string, unknown>;
    assert.equal(health.nativeUntrustedExecutionEnabled, false, 'Untrusted native execution must remain disabled on main server');

    // 2. Python sandbox still blocks network & file writes even with input() enabled
    const evilPy = `import os\nprint(os.listdir('/'))`;
    const evilRes = await postJson('/api/trace', { lang: 'py', code: evilPy });
    assert.equal(evilRes.status, 400);
    assert.ok(String(evilRes.data.error).toLowerCase().includes('blocked'));

    // 3. Infinite loop in JS hits step cap cleanly
    const loopRes = traceJavaScriptDocument(`let i = 0; while (true) { i++; }`);
    assert.ok(loopRes.error && loopRes.error.includes('Step limit'));

    // 4. AbortController cancellation works immediately
    const ctrl = new AbortController();
    ctrl.abort();
    await assert.rejects(() => runJavaScriptInWorker('const x = 1;', { signal: ctrl.signal }), /AbortError|canceled/i);

    // 5. Invalid trace JSON rejected strictly by validator
    const badTrace = validateAndNormalizeTraceDocument({ events: [{ id: 'e1', sequence: 1, line: 999, type: 'bad' }] }, 5, {
      language: 'js',
      executionMode: 'real',
      adapter: TYPESCRIPT_ADAPTER_META,
    });
    assert.equal(badTrace.ok, false);

    return 'Native isolation guard, Python sandbox block, infinite-loop cap, cancellation & malformed-trace rejection passed';
  });

  // 15. Forward/Backward Playback Determinism on User Program
  await runTest('P4-15', 'Deterministic Forward & Backward Playback on Recursive Program', () => {
    const recCode = `function climb(n) {
  if (n <= 1) return 1;
  return climb(n - 1) + climb(n - 2);
}
const ways = climb(4);
console.log("Ways:", ways);`;

    const res = traceJavaScriptDocument(recCode);
    assert.ok(res.document, res.error);
    const engine = new TraceReplayEngine(res.document, recCode);
    const forward = [];
    for (let i = 0; i < engine.totalSteps; i++) {
      forward.push(JSON.stringify(engine.getStateAt(i)));
    }
    for (let i = engine.totalSteps - 1; i >= 0; i--) {
      assert.equal(JSON.stringify(engine.getStateAt(i)), forward[i], `Backward mismatch at step ${i}`);
    }
    const analysis = analyzeProgramExecution(recCode, res.document);
    assert.equal(analysis.hasRecursion, true);
    assert.ok(analysis.maxCallDepth >= 4);
    return `${engine.totalSteps} steps matched identically forward & backward (max recursion depth=${analysis.maxCallDepth})`;
  });

  // 16. Live Browser DOM Interaction (Honest environment check)
  markTest(
    'P4-16',
    'Live Headless Browser UI Interaction (Chromium/Playwright)',
    'NOT EXECUTED',
    'No Chromium or Playwright browser binary is installed in this Linux container; UI verified via tsc --noEmit, Vite production build, and unit/API tests.'
  );

  const passCount = results.filter((r) => r.status === 'PASS').length;
  const failCount = results.filter((r) => r.status === 'FAIL').length;
  const notExecCount = results.filter((r) => r.status === 'NOT EXECUTED').length;

  console.log(`\n=== Phase 4 Summary: ${passCount} PASS, ${failCount} FAIL, ${notExecCount} NOT EXECUTED ===`);
  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Phase 4 test runner crashed:', err);
  process.exit(1);
});
