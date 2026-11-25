/**
 * CODE ANIM — UNIVERSAL PROGRAM VISUALIZATION VERIFICATION SUITE
 *
 * Tests 15 diverse, unfamiliar program categories across multiple languages:
 *  1. Financial calculations & banking transaction ledger (Python)
 *  2. Object-oriented application with connected domain objects (Python)
 *  3. Database query processing (filtering/updating records in Python + SQL auto-detection/simulation)
 *  4. Game-state updates with 2D movement & score/HP (JavaScript)
 *  5. Matrix computations (C++ 2D matrix multiplication)
 *  6. Scientific physics simulation (Python projectile motion + cooling curve)
 *  7. Machine learning neural layer forward pass & weight update (JavaScript)
 *  8. Digital logic gates & binary waveforms (C / JavaScript bitwise signals)
 *  9. CPU Round-Robin scheduling with Gantt execution timeline (Python)
 * 10. Asynchronous / event-loop task queue processing (JavaScript)
 * 11. String & text processing (Java / Python tokenization & counts)
 * 12. Finite State Machine transitions (JavaScript traffic/order FSM)
 * 13. Unfamiliar custom algorithm (Smart thermostat control loop in Java)
 * 14. Complex multi-structure combined program (E-commerce order + inventory + balance + state + timeline in Python)
 * 15. Ordinary non-algorithmic program (Recipe ingredient scaler in C)
 * 16. Strict declarative validator security test (rejects HTML/script/unknown panels/overflows)
 */

import assert from 'node:assert/strict';
import { traceJavaScriptDocument } from '../src/lib/jsTracer';
import { parseTraceApiResponse } from '../src/lib/adapters';
import { TraceReplayEngine } from '../src/lib/replayEngine';
import { detectLanguageFromCode } from '../src/lib/languageDetector';
import { buildStepExplanationBreakdown } from '../src/lib/explain';
import {
  synthesizeUniversalScene,
  validateVisualScene,
} from '../src/lib/universalVisualEngine';
import type { LanguageAdapterMeta, LanguageId, TraceDocument } from '../src/types/trace';

const BASE_URL = 'http://127.0.0.1:3000';

interface TestResult {
  id: string;
  category: string;
  status: 'PASS' | 'FAIL' | 'NOT EXECUTED';
  detail: string;
}

const results: TestResult[] = [];

async function runTest(
  id: string,
  category: string,
  fn: () => Promise<string | void> | string | void
): Promise<void> {
  try {
    const detail = (await fn()) || 'ok';
    results.push({ id, category, status: 'PASS', detail });
    console.log(`[PASS] ${id} (${category}): ${detail}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ id, category, status: 'FAIL', detail: msg });
    console.error(`[FAIL] ${id} (${category}): ${msg}`);
  }
}

function makeMeta(lang: LanguageId, mode: 'real' | 'simulated'): LanguageAdapterMeta {
  return {
    id: `${lang}-universal`,
    language: lang,
    label: lang.toUpperCase(),
    executionMode: mode,
    runtimeAvailable: true,
    executionMethod: mode === 'real' ? 'Live Execution' : 'AI Simulation',
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
    limitations: [],
  };
}

async function traceServer(lang: LanguageId, code: string, stdin = ''): Promise<TraceDocument> {
  const resp = await fetch(`${BASE_URL}/api/trace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang, code, stdin, allowSimulation: true }),
  });
  return parseTraceApiResponse({
    status: resp.status,
    ok: resp.ok,
    contentType: resp.headers.get('content-type') || '',
    rawText: await resp.text(),
    language: lang,
    executionMode: 'real',
    adapter: makeMeta(lang, 'real'),
    lineCount: Math.max(1, code.split('\n').length),
  });
}

function traceJsDoc(code: string): TraceDocument {
  const res = traceJavaScriptDocument(code);
  assert.ok(!res.error && res.document, `JS trace failed: ${res.error}`);
  return res.document;
}

function buildFinalScene(code: string, doc: TraceDocument) {
  const engine = new TraceReplayEngine(doc, code);
  const lastIdx = engine.totalSteps - 1;
  const frame = engine.getStateAt(lastIdx)!;
  const prevFrame = lastIdx > 0 ? engine.getStateAt(lastIdx - 1) : null;
  const scene = synthesizeUniversalScene({
    sourceCode: code,
    traceDocument: doc,
    currentStepIndex: lastIdx,
    frame,
    prevFrame,
  });
  const explanation = buildStepExplanationBreakdown({
    event: frame.event,
    prevEvent: prevFrame?.event ?? null,
    step: frame.step,
    prevStep: prevFrame?.step ?? null,
    codeLines: code.split('\n'),
    programPurpose: 'Executes the submitted program step by step.',
    isFinalStep: true,
  });
  return { engine, frame, prevFrame, scene, explanation };
}

async function main() {
  console.log('=== CODE ANIM UNIVERSAL PROGRAM VISUALIZATION TESTS ===\n');

  // 1. Financial calculations & banking transactions (Python)
  await runTest('U-01', 'Financial & Banking Ledger', async () => {
    const code = [
      'balance = 1000.0',
      'ledger = []',
      'txs = [("deposit", 450.0), ("rent", -600.0), ("dividend", 125.5)]',
      'for label, delta in txs:',
      '    balance = round(balance + delta, 2)',
      '    ledger.append({"item": label, "amount": delta, "balance": balance})',
      'print(f"Final balance: {balance}")',
    ].join('\n');
    const doc = await traceServer('py', code);
    const { frame, scene } = buildFinalScene(code, doc);
    assert.equal(frame.outText.trim(), 'Final balance: 975.5');
    const kinds = scene.panels.map((p) => p.kind);
    assert.ok(kinds.includes('table'), `Expected ledger table panel, got [${kinds.join(',')}]`);
    assert.ok(kinds.includes('chart'), `Expected balance trend chart panel, got [${kinds.join(',')}]`);
    return `panels=[${kinds.join(', ')}], out="${frame.outText.trim()}"`;
  });

  // 2. Object-Oriented Application (Python connected entities)
  await runTest('U-02', 'Object-Oriented Application', async () => {
    const code = [
      'class Wallet:',
      '    def __init__(self, currency, amount):',
      '        self.currency = currency',
      '        self.amount = amount',
      'class Member:',
      '    def __init__(self, alias, wallet):',
      '        self.alias = alias',
      '        self.wallet = wallet',
      'w = Wallet("USD", 250)',
      'member = Member("Maya", w)',
      'member.wallet.amount += 75',
      'print(member.alias, member.wallet.amount)',
    ].join('\n');
    const doc = await traceServer('py', code);
    const { frame, scene } = buildFinalScene(code, doc);
    assert.equal(frame.outText.trim(), 'Maya 325');
    const kinds = scene.panels.map((p) => p.kind);
    assert.ok(kinds.includes('diagram'), `Expected object relationship diagram, got [${kinds.join(',')}]`);
    return `panels=[${kinds.join(', ')}], out="${frame.outText.trim()}"`;
  });

  // 3. Database Query Processing (Python record filtering/aggregation + SQL auto-detection)
  await runTest('U-03', 'Database Query Processing', async () => {
    const sqlSample = 'SELECT dept, COUNT(*) FROM staff WHERE salary > 50000 GROUP BY dept;';
    assert.equal(detectLanguageFromCode(sqlSample).languageId, 'sql');

    const code = [
      'employees = [',
      '    {"id": 1, "dept": "Eng", "salary": 92000},',
      '    {"id": 2, "dept": "Ops", "salary": 61000},',
      '    {"id": 3, "dept": "Eng", "salary": 105000},',
      ']',
      'selected = [row for row in employees if row["dept"] == "Eng"]',
      'payroll = 0',
      'for rec in selected:',
      '    payroll += rec["salary"]',
      'print(len(selected), payroll)',
    ].join('\n');
    const doc = await traceServer('py', code);
    const { frame, scene } = buildFinalScene(code, doc);
    assert.equal(frame.outText.trim(), '2 197000');
    const kinds = scene.panels.map((p) => p.kind);
    assert.ok(kinds.includes('table'), `Expected record table, got [${kinds.join(',')}]`);
    return `SQL detected + Python DB query panels=[${kinds.join(', ')}], out="${frame.outText.trim()}"`;
  });

  // 4. Game-State Updates (JavaScript 2D coordinates, trail, HP, score)
  await runTest('U-04', 'Game-State Updates (2D Coordinates)', () => {
    const code = [
      'const hero = { x: 0, y: 0, hp: 100, score: 0 };',
      'const moves = [[2, 1], [3, 2], [1, 4]];',
      'for (let m = 0; m < moves.length; m++) {',
      '  hero.x += moves[m][0];',
      '  hero.y += moves[m][1];',
      '  hero.score += 50;',
      '  hero.hp -= 10;',
      '}',
      'console.log(hero.x + "," + hero.y + " score=" + hero.score);',
    ].join('\n');
    const doc = traceJsDoc(code);
    const { frame, scene } = buildFinalScene(code, doc);
    assert.equal(frame.outText.trim(), '6,7 score=150');
    const kinds = scene.panels.map((p) => p.kind);
    assert.ok(kinds.includes('grid2d'), `Expected 2D spatial map panel, got [${kinds.join(',')}]`);
    assert.ok(kinds.includes('chart'), `Expected score/HP chart panel, got [${kinds.join(',')}]`);
    return `panels=[${kinds.join(', ')}], out="${frame.outText.trim()}"`;
  });

  // 5. Matrix Computations (C++ 2D matrix calculation)
  await runTest('U-05', 'Matrix Computations (C++)', async () => {
    const code = [
      '#include <iostream>',
      'using namespace std;',
      'int main() {',
      '  int a00 = 2; int a01 = 3;',
      '  int b00 = 4; int b10 = 5;',
      '  int dot = a00 * b00 + a01 * b10;',
      '  int traceVal = dot + 1;',
      '  cout << dot << " " << traceVal << endl;',
      '  return 0;',
      '}',
    ].join('\n');
    const doc = await traceServer('cpp', code);
    const { frame, scene } = buildFinalScene(code, doc);
    assert.equal(frame.outText.trim(), '23 24');
    assert.ok(scene.panels.length >= 1, 'Expected at least 1 declarative visual panel');
    return `C++ panels=[${scene.panels.map((p) => p.kind).join(', ')}], out="${frame.outText.trim()}"`;
  });

  // 6. Scientific Simulation (Python projectile physics trajectory)
  await runTest('U-06', 'Scientific Physics Simulation', async () => {
    const code = [
      'x = 0.0',
      'y = 0.0',
      'vx = 10.0',
      'vy = 15.0',
      'gravity = 9.8',
      'dt = 0.5',
      'for tick in range(4):',
      '    x = round(x + vx * dt, 2)',
      '    y = round(max(0.0, y + vy * dt), 2)',
      '    vy = round(vy - gravity * dt, 2)',
      'print(x, y)',
    ].join('\n');
    const doc = await traceServer('py', code);
    const { frame, scene } = buildFinalScene(code, doc);
    const kinds = scene.panels.map((p) => p.kind);
    assert.ok(kinds.includes('grid2d'), `Expected 2D trajectory map, got [${kinds.join(',')}]`);
    assert.ok(kinds.includes('chart'), `Expected velocity/position chart, got [${kinds.join(',')}]`);
    return `panels=[${kinds.join(', ')}], out="${frame.outText.trim()}"`;
  });

  // 7. Machine Learning Calculations (JS layered forward pass + gradient step)
  await runTest('U-07', 'Machine Learning Forward Pass & Gradient', () => {
    const code = [
      'const inputs = [1.0, 0.5];',
      'const weights = [0.6, -0.4];',
      'const outputs = [0];',
      'let loss = 1.0;',
      'for (let epoch = 0; epoch < 3; epoch++) {',
      '  const pred = inputs[0] * weights[0] + inputs[1] * weights[1];',
      '  outputs[0] = Number(pred.toFixed(3));',
      '  const err = 1.0 - pred;',
      '  loss = Number((err * err).toFixed(4));',
      '  weights[0] = Number((weights[0] + 0.2 * err * inputs[0]).toFixed(3));',
      '}',
      'console.log("pred=" + outputs[0] + " loss=" + loss);',
    ].join('\n');
    const doc = traceJsDoc(code);
    const { frame, scene } = buildFinalScene(code, doc);
    const kinds = scene.panels.map((p) => p.kind);
    assert.ok(kinds.includes('diagram'), `Expected layered ML data-flow diagram, got [${kinds.join(',')}]`);
    assert.ok(kinds.includes('chart'), `Expected loss/pred trend chart, got [${kinds.join(',')}]`);
    return `panels=[${kinds.join(', ')}], out="${frame.outText.trim()}"`;
  });

  // 8. Digital Logic & Binary Signals (JS half-adder / gate timing waveform)
  await runTest('U-08', 'Digital Logic & Signal Waveforms', () => {
    const code = [
      'let clk = 0;',
      'let bitA = 0;',
      'let bitB = 0;',
      'let sumOut = 0;',
      'let carryOut = 0;',
      'const pairs = [[0,0],[0,1],[1,0],[1,1]];',
      'for (let idx = 0; idx < pairs.length; idx++) {',
      '  clk = idx % 2;',
      '  bitA = pairs[idx][0];',
      '  bitB = pairs[idx][1];',
      '  sumOut = bitA ^ bitB;',
      '  carryOut = bitA & bitB;',
      '}',
      'console.log("sum=" + sumOut + " carry=" + carryOut);',
    ].join('\n');
    const doc = traceJsDoc(code);
    const { frame, scene } = buildFinalScene(code, doc);
    assert.equal(frame.outText.trim(), 'sum=0 carry=1');
    const kinds = scene.panels.map((p) => p.kind);
    assert.ok(kinds.includes('signal'), `Expected digital signal waveform panel, got [${kinds.join(',')}]`);
    return `panels=[${kinds.join(', ')}], out="${frame.outText.trim()}"`;
  });

  // 9. Operating System CPU Round-Robin Scheduling (Python Gantt timeline + process table)
  await runTest('U-09', 'OS CPU Round-Robin Scheduling', async () => {
    const code = [
      'procs = [{"pid": "P1", "rem": 4}, {"pid": "P2", "rem": 2}, {"pid": "P3", "rem": 3}]',
      'quantum = 2',
      'clock = 0',
      'running = ""',
      'while any(p["rem"] > 0 for p in procs):',
      '    for p in procs:',
      '        if p["rem"] > 0:',
      '            running = p["pid"]',
      '            slice_t = min(quantum, p["rem"])',
      '            p["rem"] -= slice_t',
      '            clock += slice_t',
      '            print(f"{running}@{clock}")',
    ].join('\n');
    const doc = await traceServer('py', code);
    const { frame, scene } = buildFinalScene(code, doc);
    const kinds = scene.panels.map((p) => p.kind);
    assert.ok(kinds.includes('table'), `Expected process table, got [${kinds.join(',')}]`);
    assert.ok(kinds.includes('timeline'), `Expected CPU Gantt timeline, got [${kinds.join(',')}]`);
    return `panels=[${kinds.join(', ')}], out="${frame.outText.trim().replace(/\n/g, ' | ')}"`;
  });

  // 10. Asynchronous / Event-Loop Task Processing (JS microtask/macrotask scheduler)
  await runTest('U-10', 'Async / Event-Loop Task Queue', () => {
    const code = [
      'const taskQueue = [{ task: "fetchUser", phase: "queued" }, { task: "renderUI", phase: "queued" }, { task: "logMetric", phase: "queued" }];',
      'let activeTask = "idle";',
      'for (let i = 0; i < taskQueue.length; i++) {',
      '  activeTask = taskQueue[i].task;',
      '  taskQueue[i].phase = "done";',
      '  console.log("resolved:" + activeTask);',
      '}',
    ].join('\n');
    const doc = traceJsDoc(code);
    const { frame, scene } = buildFinalScene(code, doc);
    const kinds = scene.panels.map((p) => p.kind);
    assert.ok(kinds.includes('table'), `Expected task queue table, got [${kinds.join(',')}]`);
    assert.ok(kinds.includes('timeline'), `Expected async task timeline, got [${kinds.join(',')}]`);
    return `panels=[${kinds.join(', ')}], out="${frame.outText.trim().replace(/\n/g, ' | ')}"`;
  });

  // 11. String & Text Processing (Python word frequency + normalization)
  await runTest('U-11', 'String & Text Processing', async () => {
    const code = [
      'text = "code anim turns any code into live anim"',
      'words = text.split()',
      'counts = {}',
      'for w in words:',
      '    counts[w] = counts.get(w, 0) + 1',
      'print(counts["code"], counts["anim"])',
    ].join('\n');
    const doc = await traceServer('py', code);
    const { frame, explanation } = buildFinalScene(code, doc);
    assert.equal(frame.outText.trim(), '2 2');
    assert.ok(explanation.whatIsHappeningNow.length > 0);
    return `word counts verified, out="2 2", simple explanation="${explanation.whatIsHappeningNow.slice(0, 50)}"`;
  });

  // 12. Finite State Machine (JS order workflow state diagram)
  await runTest('U-12', 'Finite State Machine', () => {
    const code = [
      'let status = "DRAFT";',
      'const events = ["submit", "approve", "ship", "deliver"];',
      'for (let e = 0; e < events.length; e++) {',
      '  if (events[e] === "submit") status = "SUBMITTED";',
      '  else if (events[e] === "approve") status = "APPROVED";',
      '  else if (events[e] === "ship") status = "SHIPPED";',
      '  else status = "DELIVERED";',
      '}',
      'console.log(status);',
    ].join('\n');
    const doc = traceJsDoc(code);
    const { frame, scene } = buildFinalScene(code, doc);
    assert.equal(frame.outText.trim(), 'DELIVERED');
    const kinds = scene.panels.map((p) => p.kind);
    assert.ok(kinds.includes('diagram'), `Expected FSM state transition diagram, got [${kinds.join(',')}]`);
    return `panels=[${kinds.join(', ')}], finalState="DELIVERED"`;
  });

  // 13. Custom Unfamiliar Algorithm (Java Smart Thermostat Controller)
  await runTest('U-13', 'Custom Unfamiliar Algorithm (Java Thermostat)', async () => {
    const code = [
      'public class Thermostat {',
      '  public static void main(String[] args) {',
      '    double roomTemp = 18.0;',
      '    double targetTemp = 22.0;',
      '    for (int minute = 1; minute <= 4; minute++) {',
      '      double gap = targetTemp - roomTemp;',
      '      double heatBoost = gap * 0.5;',
      '      roomTemp = roomTemp + heatBoost;',
      '      System.out.println(roomTemp);',
      '    }',
      '  }',
      '}',
    ].join('\n');
    const doc = await traceServer('java', code);
    const { frame, scene } = buildFinalScene(code, doc);
    const kinds = scene.panels.map((p) => p.kind);
    assert.ok(kinds.includes('chart'), `Expected temperature convergence chart, got [${kinds.join(',')}]`);
    assert.ok(frame.outText.includes('21.75'));
    return `Java thermostat panels=[${kinds.join(', ')}], finalTemp=21.75`;
  });

  // 14. Multi-Structure Combined Program (Finance + Records + State + Timeline + Chart together!)
  await runTest('U-14', 'Complex Multi-Structure Combined Program', async () => {
    const code = [
      'cash = 500',
      'mode = "OPEN"',
      'orders = []',
      'events = [("coffee", 15), ("books", 85), ("refund", -20)]',
      'activeOrder = ""',
      'for name, cost in events:',
      '    activeOrder = name',
      '    cash -= cost',
      '    mode = "PROCESSING" if cash > 400 else "LOW_FUNDS"',
      '    orders.append({"order": name, "cost": cost, "cash": cash})',
      '    print(f"{name}:{cash}")',
      'mode = "CLOSED"',
    ].join('\n');
    const doc = await traceServer('py', code);
    const { frame, scene } = buildFinalScene(code, doc);
    const kinds = [...new Set(scene.panels.map((p) => p.kind))];
    assert.ok(kinds.length >= 3, `Expected >= 3 distinct panel kinds combined, got [${kinds.join(',')}]`);
    assert.ok(kinds.includes('table') && kinds.includes('chart') && kinds.includes('diagram'));
    return `Combined ${kinds.length} visual panel types simultaneously: [${kinds.join(', ')}], out="${frame.outText.trim().replace(/\n/g, ' | ')}"`;
  });

  // 15. Ordinary Program With No Recognizable Algorithm (C Recipe Scaler)
  await runTest('U-15', 'Ordinary Non-Algorithmic Program (C Recipe Scaler)', async () => {
    const code = [
      '#include <stdio.h>',
      'int main() {',
      '  int servings = 6;',
      '  int flourGrams = servings * 45;',
      '  int sugarGrams = servings * 15;',
      '  printf("Flour=%dg Sugar=%dg\\n", flourGrams, sugarGrams);',
      '  return 0;',
      '}',
    ].join('\n');
    const doc = await traceServer('c', code);
    const { frame, scene, explanation } = buildFinalScene(code, doc);
    assert.equal(frame.outText.trim(), 'Flour=270g Sugar=90g');
    assert.ok(scene.panels.some((p) => p.kind === 'flow'), 'Expected universal flow panel fallback for ordinary program');
    assert.ok(explanation.whatIsHappeningNow.length > 0);
    return `panels=[${scene.panels.map((p) => p.kind).join(', ')}], out="${frame.outText.trim()}"`;
  });

  // 16. Strict Declarative Visual Schema Security Validation
  await runTest('U-16', 'Declarative Visual Validator Rejects Unsafe/Malformed Inputs', () => {
    assert.equal(validateVisualScene(null), null);
    assert.equal(validateVisualScene('<html><script>alert(1)</script></html>'), null);
    const stripped = validateVisualScene({
      schemaVersion: '1.0',
      source: 'ai-assisted',
      panels: [
        { id: 'bad1', kind: 'raw_html', title: 'XSS', html: '<img onerror=alert(1)>' },
        { id: 'bad2', kind: 'executable_js', title: 'Code', code: 'window.location="x"' },
        {
          id: 'good1',
          kind: 'flow',
          title: 'Safe Flow',
          stages: [
            { id: 's1', label: 'Read', detail: 'Load balance', accent: 'sky' },
            { id: 's2', label: 'Update', detail: 'Apply fee', accent: 'not-a-color' },
          ],
        },
      ],
    });
    assert.ok(stripped !== null);
    assert.equal(stripped.panels.length, 1, 'Unsafe panel kinds must be dropped strictly');
    assert.equal(stripped.panels[0].kind, 'flow');
    if (stripped.panels[0].kind === 'flow') {
      assert.equal(stripped.panels[0].stages[1].accent, 'indigo', 'Invalid accent must normalize to safe default');
    }
    return `Rejected raw_html & executable_js panels; kept & sanitized valid flow panel`;
  });

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\n=== UNIVERSAL VISUALIZATION SUMMARY: ${passed} PASS, ${failed} FAIL ===`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Fatal universal test error:', err);
  process.exitCode = 1;
});
