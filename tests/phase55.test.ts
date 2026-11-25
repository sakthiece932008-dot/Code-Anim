import assert from 'node:assert/strict';
import { traceJavaScript } from '../src/lib/jsTracer';
import { parseTraceApiResponse, TraceApiError } from '../src/lib/adapters';
import { TraceReplayEngine } from '../src/lib/replayEngine';
import { extractGenericVisualOperation } from '../src/components/GenericOperationStage';
import { buildDeterministicErrorHelp, buildStepExplanationBreakdown } from '../src/lib/explain';
import { validateAndNormalizeTraceDocument } from '../src/types/trace';
import type { LanguageAdapterMeta, LanguageId, TraceDocument } from '../src/types/trace';

const BASE_URL = 'http://127.0.0.1:3000';

interface TestResult {
  id: string;
  group: string;
  name: string;
  status: 'PASS' | 'FAIL' | 'NOT EXECUTED';
  detail: string;
}

const results: TestResult[] = [];

async function runTest(
  id: string,
  group: string,
  name: string,
  fn: () => Promise<string | void> | string | void
): Promise<void> {
  try {
    const detail = (await fn()) || 'ok';
    results.push({ id, group, name, status: 'PASS', detail });
    console.log(`[PASS] ${id} (${group}) — ${name}: ${detail}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ id, group, name, status: 'FAIL', detail });
    console.error(`[FAIL] ${id} (${group}) — ${name}: ${detail}`);
  }
}

function makeMeta(lang: LanguageId, mode: 'real' | 'simulated' = 'real'): LanguageAdapterMeta {
  return {
    id: `${lang}-test`,
    language: lang,
    label: lang.toUpperCase(),
    executionMode: mode,
    runtimeAvailable: true,
    executionMethod: 'Test harness',
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

async function postTraceLive(payload: Record<string, unknown>): Promise<{
  status: number;
  ok: boolean;
  contentType: string;
  rawText: string;
}> {
  const res = await fetch(`${BASE_URL}/api/trace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  return {
    status: res.status,
    ok: res.ok,
    contentType: res.headers.get('content-type') || '',
    rawText: await res.text(),
  };
}

async function traceServerProgram(
  lang: LanguageId,
  code: string,
  stdin = ''
): Promise<TraceDocument> {
  const res = await postTraceLive({ lang, code, stdin });
  assert.equal(res.status, 200, `Expected HTTP 200 for ${lang}, got HTTP ${res.status}: ${res.rawText.slice(0, 260)}`);
  assert.match(res.contentType, /application\/json/i, `Expected application/json, got ${res.contentType}`);
  return parseTraceApiResponse({
    status: res.status,
    ok: res.ok,
    contentType: res.contentType,
    rawText: res.rawText,
    language: lang,
    executionMode: 'real',
    adapter: makeMeta(lang),
    lineCount: code.split('\n').length,
  });
}

async function main() {
  // Verify server is reachable before running tests
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  assert.equal(healthRes.status, 200, 'Dev server must be running on port 3000');

  // =========================================================================
  // TASK 8 — 20 BASIC PROGRAM REGRESSION TESTS
  // =========================================================================

  // Test 1: Java multiplication (exact user failing scenario)
  await runTest('T8-01', 'Task8', 'Java multiplication', async () => {
    const code = [
      'public class Main {',
      '  public static void main(String[] args) {',
      '    int a = 5;',
      '    int b = 4;',
      '    int result = a * b;',
      '    System.out.println(result);',
      '  }',
      '}',
    ].join('\n');
    const doc = await traceServerProgram('java', code);
    const engine = new TraceReplayEngine(doc, code);
    assert.ok(engine.totalSteps >= 4, `Expected >= 4 steps, got ${engine.totalSteps}`);
    const last = engine.getStateAt(engine.totalSteps - 1)!;
    assert.equal(last.outText.trim(), '20');
    assert.equal(last.step.vars.a, 5);
    assert.equal(last.step.vars.b, 4);
    assert.equal(last.step.vars.result, 20);
    // Verify generic operation visual extraction on the multiplication line (step index 2)
    const codeLines = code.split('\n');
    const mulFrame = engine.getStateAt(2)!;
    const prevFrame = engine.getStateAt(1)!;
    const mulSourceLine = codeLines[mulFrame.line - 1] || '';
    const op = extractGenericVisualOperation(mulSourceLine, mulFrame, prevFrame);
    assert.ok(op && op.kind === 'expression', 'Expected expression visual operation on int result = a * b');
    assert.equal(op.resultValue, '20');
    assert.equal(op.targetVar, 'result');
    const breakdown = buildStepExplanationBreakdown({
      event: mulFrame.event,
      prevEvent: prevFrame.event,
      step: mulFrame.step,
      prevStep: prevFrame.step,
      codeLines,
      programPurpose: 'Multiplies two numbers.',
      isFinalStep: false,
    });
    assert.ok(breakdown.whatIsHappeningNow.length > 0);
    return `${engine.totalSteps} steps, output="20", op="${op.operatorSymbol} => ${op.resultValue}"`;
  });

  // Test 2: Python multiplication
  await runTest('T8-02', 'Task8', 'Python multiplication', async () => {
    const code = 'a = 5\nb = 4\nresult = a * b\nprint(result)\n';
    const doc = await traceServerProgram('py', code);
    const engine = new TraceReplayEngine(doc, code);
    const last = engine.getStateAt(engine.totalSteps - 1)!;
    assert.equal(last.outText.trim(), '20');
    assert.equal(last.step.vars.result, 20);
    return `${engine.totalSteps} steps, output="20"`;
  });

  // Test 3: JavaScript multiplication
  await runTest('T8-03', 'Task8', 'JavaScript multiplication', async () => {
    const code = 'let a = 5;\nlet b = 4;\nlet result = a * b;\nconsole.log(result);\n';
    const raw = traceJavaScript(code, { language: 'js', adapterMeta: makeMeta('js') });
    const val = validateAndNormalizeTraceDocument(raw, code.split('\n').length, {
      language: 'js',
      executionMode: 'real',
      adapter: makeMeta('js'),
    });
    assert.ok(val.ok, val.ok ? '' : val.error);
    const engine = new TraceReplayEngine(val.document, code);
    const last = engine.getStateAt(engine.totalSteps - 1)!;
    assert.equal(last.outText.trim(), '20');
    assert.equal(last.step.vars.result, 20);
    return `${engine.totalSteps} steps, output="20"`;
  });

  // Test 4: C multiplication
  await runTest('T8-04', 'Task8', 'C multiplication', async () => {
    const code = [
      '#include <stdio.h>',
      'int main() {',
      '  int a = 5;',
      '  int b = 4;',
      '  int result = a * b;',
      '  printf("%d\\n", result);',
      '  return 0;',
      '}',
    ].join('\n');
    const doc = await traceServerProgram('c', code);
    const engine = new TraceReplayEngine(doc, code);
    const last = engine.getStateAt(engine.totalSteps - 1)!;
    assert.equal(last.outText.trim(), '20');
    assert.equal(last.step.vars.result, 20);
    return `${engine.totalSteps} steps, output="20"`;
  });

  // Test 5: C++ multiplication
  await runTest('T8-05', 'Task8', 'C++ multiplication', async () => {
    const code = [
      '#include <iostream>',
      'using namespace std;',
      'int main() {',
      '  int a = 5;',
      '  int b = 4;',
      '  int result = a * b;',
      '  cout << result << endl;',
      '  return 0;',
      '}',
    ].join('\n');
    const doc = await traceServerProgram('cpp', code);
    const engine = new TraceReplayEngine(doc, code);
    const last = engine.getStateAt(engine.totalSteps - 1)!;
    assert.equal(last.outText.trim(), '20');
    assert.equal(last.step.vars.result, 20);
    return `${engine.totalSteps} steps, output="20"`;
  });

  // Test 6: Addition of two numbers
  await runTest('T8-06', 'Task8', 'Addition of two numbers', async () => {
    const code = [
      'public class Main {',
      '  public static void main(String[] args) {',
      '    int first = 17;',
      '    int second = 25;',
      '    int sum = first + second;',
      '    System.out.println(sum);',
      '  }',
      '}',
    ].join('\n');
    const doc = await traceServerProgram('java', code);
    const engine = new TraceReplayEngine(doc, code);
    const last = engine.getStateAt(engine.totalSteps - 1)!;
    assert.equal(last.outText.trim(), '42');
    assert.equal(last.step.vars.sum, 42);
    return `sum=42, output="42"`;
  });

  // Test 7: Arithmetic using different arbitrary variable names
  await runTest('T8-07', 'Task8', 'Arithmetic with custom variable names', async () => {
    const code = [
      'public class Main {',
      '  public static void main(String[] args) {',
      '    int unitPrice = 12;',
      '    int itemCount = 6;',
      '    int grandTotal = unitPrice * itemCount;',
      '    System.out.println(grandTotal);',
      '  }',
      '}',
    ].join('\n');
    const doc = await traceServerProgram('java', code);
    const engine = new TraceReplayEngine(doc, code);
    assert.equal(engine.getStateAt(engine.totalSteps - 1)!.step.vars.grandTotal, 72);
    const f2 = engine.getStateAt(2)!;
    const f1 = engine.getStateAt(1)!;
    const op = extractGenericVisualOperation(code.split('\n')[f2.line - 1] || '', f2, f1);
    assert.ok(op && op.kind === 'expression', 'Expected dynamic expression operation');
    assert.equal(op.targetVar, 'grandTotal');
    assert.equal(op.leftLabel, 'unitPrice');
    assert.equal(op.rightLabel, 'itemCount');
    assert.equal(op.resultValue, '72');
    return `unitPrice(12) * itemCount(6) = grandTotal(72)`;
  });

  // Test 8: Arithmetic using user-provided input (Java Scanner + Python input)
  await runTest('T8-08', 'Task8', 'Arithmetic with user-provided stdin input', async () => {
    const javaCode = [
      'import java.util.Scanner;',
      'public class Main {',
      '  public static void main(String[] args) {',
      '    Scanner sc = new Scanner(System.in);',
      '    int x = sc.nextInt();',
      '    int y = sc.nextInt();',
      '    int prod = x * y;',
      '    System.out.println(prod);',
      '  }',
      '}',
    ].join('\n');
    const javaDoc = await traceServerProgram('java', javaCode, '9 7');
    const jEngine = new TraceReplayEngine(javaDoc, javaCode);
    const jLast = jEngine.getStateAt(jEngine.totalSteps - 1)!;
    assert.equal(jLast.outText.trim(), '63');
    assert.equal(jLast.step.vars.prod, 63);

    const pyCode = 'x = int(input())\ny = int(input())\nprint(x * y)\n';
    const pyDoc = await traceServerProgram('py', pyCode, '9\n7\n');
    const pEngine = new TraceReplayEngine(pyDoc, pyCode);
    assert.equal(pEngine.getStateAt(pEngine.totalSteps - 1)!.outText.trim(), '63');
    return `Java Scanner & Python input() both computed 9 * 7 = 63`;
  });

  // Test 9: Negative numbers
  await runTest('T8-09', 'Task8', 'Negative numbers arithmetic', async () => {
    const code = [
      'public class Main {',
      '  public static void main(String[] args) {',
      '    int temp = -7;',
      '    int factor = 3;',
      '    int result = temp * factor;',
      '    System.out.println(result);',
      '  }',
      '}',
    ].join('\n');
    const doc = await traceServerProgram('java', code);
    const engine = new TraceReplayEngine(doc, code);
    const last = engine.getStateAt(engine.totalSteps - 1)!;
    assert.equal(last.step.vars.temp, -7);
    assert.equal(last.step.vars.result, -21);
    assert.equal(last.outText.trim(), '-21');
    return `-7 * 3 = -21`;
  });

  // Test 10: Decimal numbers
  await runTest('T8-10', 'Task8', 'Decimal numbers arithmetic', async () => {
    const code = [
      'public class Main {',
      '  public static void main(String[] args) {',
      '    double rate = 2.5;',
      '    double hours = 4.2;',
      '    double pay = rate * hours;',
      '    System.out.println(pay);',
      '  }',
      '}',
    ].join('\n');
    const doc = await traceServerProgram('java', code);
    const engine = new TraceReplayEngine(doc, code);
    const last = engine.getStateAt(engine.totalSteps - 1)!;
    assert.ok(Math.abs(Number(last.step.vars.pay) - 10.5) < 1e-9);
    assert.equal(last.outText.trim(), '10.5');
    return `2.5 * 4.2 = 10.5`;
  });

  // Test 11: Multiple arithmetic operations
  await runTest('T8-11', 'Task8', 'Multiple arithmetic operations (+, -, *, /, %)', async () => {
    const code = [
      'public class Main {',
      '  public static void main(String[] args) {',
      '    int a = 15;',
      '    int b = 4;',
      '    int sum = a + b;',
      '    int diff = a - b;',
      '    int prod = a * b;',
      '    int quot = a / b;',
      '    int rem = a % b;',
      '    System.out.println(sum + "," + diff + "," + prod + "," + quot + "," + rem);',
      '  }',
      '}',
    ].join('\n');
    const doc = await traceServerProgram('java', code);
    const engine = new TraceReplayEngine(doc, code);
    const last = engine.getStateAt(engine.totalSteps - 1)!;
    const vars = last.step.vars;
    assert.equal(vars.sum, 19);
    assert.equal(vars.diff, 11);
    assert.equal(vars.prod, 60);
    assert.equal(vars.quot, 3);
    assert.equal(vars.rem, 3);
    assert.equal(last.outText.trim(), '19,11,60,3,3');
    return `output="19,11,60,3,3"`;
  });

  // Test 12: Simple if-else program
  await runTest('T8-12', 'Task8', 'Simple if-else program', async () => {
    const code = [
      'public class Main {',
      '  public static void main(String[] args) {',
      '    int score = 82;',
      '    String grade = "";',
      '    if (score >= 70) {',
      '      grade = "Pass";',
      '    } else {',
      '      grade = "Retry";',
      '    }',
      '    System.out.println(grade);',
      '  }',
      '}',
    ].join('\n');
    const doc = await traceServerProgram('java', code);
    const engine = new TraceReplayEngine(doc, code);
    const last = engine.getStateAt(engine.totalSteps - 1)!;
    assert.equal(last.step.vars.grade, 'Pass');
    assert.equal(last.outText.trim(), 'Pass');
    assert.ok(doc.events.some((e) => e.type === 'branch_decision'));
    return `branch_decision recorded, grade="Pass"`;
  });

  // Test 13: Simple for loop
  await runTest('T8-13', 'Task8', 'Simple for loop', async () => {
    const code = [
      'public class Main {',
      '  public static void main(String[] args) {',
      '    int total = 0;',
      '    for (int i = 1; i <= 5; i++) {',
      '      total += i;',
      '    }',
      '    System.out.println(total);',
      '  }',
      '}',
    ].join('\n');
    const doc = await traceServerProgram('java', code);
    const engine = new TraceReplayEngine(doc, code);
    const last = engine.getStateAt(engine.totalSteps - 1)!;
    assert.equal(last.step.vars.total, 15);
    assert.equal(last.outText.trim(), '15');
    assert.ok(doc.events.some((e) => e.type === 'loop_iteration'));
    return `total=15 across ${engine.totalSteps} steps`;
  });

  // Test 14: Multiplication table
  await runTest('T8-14', 'Task8', 'Multiplication table', async () => {
    const code = [
      'public class Main {',
      '  public static void main(String[] args) {',
      '    int n = 5;',
      '    for (int i = 1; i <= 4; i++) {',
      '      int row = n * i;',
      '      System.out.println(n + " x " + i + " = " + row);',
      '    }',
      '  }',
      '}',
    ].join('\n');
    const doc = await traceServerProgram('java', code);
    const engine = new TraceReplayEngine(doc, code);
    const lines = engine.getStateAt(engine.totalSteps - 1)!.outText.trim().split('\n');
    assert.deepEqual(lines, ['5 x 1 = 5', '5 x 2 = 10', '5 x 3 = 15', '5 x 4 = 20']);
    return `4 rows printed accurately`;
  });

  // Test 15: Simple function
  await runTest('T8-15', 'Task8', 'Simple user-defined function', async () => {
    const code = [
      'public class Main {',
      '  static int addBonus(int base, int bonus) {',
      '    int combined = base + bonus;',
      '    return combined;',
      '  }',
      '  public static void main(String[] args) {',
      '    int ans = addBonus(30, 12);',
      '    System.out.println(ans);',
      '  }',
      '}',
    ].join('\n');
    const doc = await traceServerProgram('java', code);
    const engine = new TraceReplayEngine(doc, code);
    const last = engine.getStateAt(engine.totalSteps - 1)!;
    assert.equal(last.step.vars.ans, 42);
    assert.equal(last.outText.trim(), '42');
    assert.ok(doc.events.some((e) => e.type === 'function_call'));
    assert.ok(doc.events.some((e) => e.type === 'function_return'));
    return `addBonus(30, 12) = 42 with call/return events`;
  });

  // Test 16: String concatenation
  await runTest('T8-16', 'Task8', 'String concatenation', async () => {
    const code = [
      'public class Main {',
      '  public static void main(String[] args) {',
      '    String first = "Code";',
      '    String second = "Anim";',
      '    String title = first + " " + second;',
      '    System.out.println(title);',
      '  }',
      '}',
    ].join('\n');
    const doc = await traceServerProgram('java', code);
    const engine = new TraceReplayEngine(doc, code);
    const last = engine.getStateAt(engine.totalSteps - 1)!;
    assert.equal(last.step.vars.title, 'Code Anim');
    assert.equal(last.outText.trim(), 'Code Anim');
    return `title="Code Anim"`;
  });

  // Test 17: Array manipulation (Java array update + C++ vector push_back)
  await runTest('T8-17', 'Task8', 'Array manipulation (Java array + C++ vector)', async () => {
    const javaCode = [
      'public class Main {',
      '  public static void main(String[] args) {',
      '    int[] nums = {3, 1, 4};',
      '    nums[1] = 9;',
      '    System.out.println(nums[1]);',
      '  }',
      '}',
    ].join('\n');
    const jDoc = await traceServerProgram('java', javaCode);
    const jEngine = new TraceReplayEngine(jDoc, javaCode);
    const jLast = jEngine.getStateAt(jEngine.totalSteps - 1)!;
    assert.deepEqual(jLast.step.vars.nums, [3, 9, 4]);
    assert.equal(jLast.outText.trim(), '9');

    const cppCode = [
      '#include <iostream>',
      '#include <vector>',
      'using namespace std;',
      'int main() {',
      '  vector<int> v = {2, 4};',
      '  v.push_back(6);',
      '  cout << v[2] << endl;',
      '  return 0;',
      '}',
    ].join('\n');
    const cDoc = await traceServerProgram('cpp', cppCode);
    const cEngine = new TraceReplayEngine(cDoc, cppCode);
    const cLast = cEngine.getStateAt(cEngine.totalSteps - 1)!;
    assert.deepEqual(cLast.step.vars.v, [2, 4, 6]);
    assert.equal(cLast.outText.trim(), '6');
    return `Java [3,9,4] & C++ vector [2,4,6] traced with heap identity`;
  });

  // Test 18: Recursive factorial
  await runTest('T8-18', 'Task8', 'Recursive factorial', async () => {
    const code = [
      'public class Main {',
      '  static int factorial(int n) {',
      '    if (n <= 1) return 1;',
      '    return n * factorial(n - 1);',
      '  }',
      '  public static void main(String[] args) {',
      '    int ans = factorial(5);',
      '    System.out.println(ans);',
      '  }',
      '}',
    ].join('\n');
    const doc = await traceServerProgram('java', code);
    const engine = new TraceReplayEngine(doc, code);
    const last = engine.getStateAt(engine.totalSteps - 1)!;
    assert.equal(last.step.vars.ans, 120);
    assert.equal(last.outText.trim(), '120');
    const maxStack = Math.max(...doc.events.map((e) => e.callStack.length));
    assert.ok(maxStack >= 5, `Expected recursion stack depth >= 5, got ${maxStack}`);
    return `factorial(5) = 120, max callStack depth = ${maxStack}`;
  });

  // Test 19: Binary tree construction (real Python execution)
  await runTest('T8-19', 'Task8', 'Binary tree construction', async () => {
    const code = [
      'class Node:',
      '    def __init__(self, value, left=None, right=None):',
      '        self.value = value',
      '        self.left = left',
      '        self.right = right',
      '',
      'root = Node(10)',
      'root.left = Node(5)',
      'root.right = Node(15)',
      'print(root.value, root.left.value, root.right.value)',
    ].join('\n');
    const doc = await traceServerProgram('py', code);
    const engine = new TraceReplayEngine(doc, code);
    assert.equal(engine.getStateAt(engine.totalSteps - 1)!.outText.trim(), '10 5 15');
    const lastEvt = doc.events[doc.events.length - 1];
    assert.ok(Object.keys(lastEvt.heap).length >= 3, 'Expected >= 3 tree nodes in heap');
    return `3 heap nodes, output="10 5 15"`;
  });

  // Test 20: Graph traversal (real Python BFS)
  await runTest('T8-20', 'Task8', 'Graph traversal (BFS)', async () => {
    const code = [
      'graph = {"A": ["B", "C"], "B": ["D"], "C": ["D"], "D": []}',
      'visited = []',
      'queue = ["A"]',
      'while queue:',
      '    node = queue.pop(0)',
      '    if node not in visited:',
      '        visited.append(node)',
      '        for nxt in graph[node]:',
      '            queue.append(nxt)',
      'print("->".join(visited))',
    ].join('\n');
    const doc = await traceServerProgram('py', code);
    const engine = new TraceReplayEngine(doc, code);
    assert.equal(engine.getStateAt(engine.totalSteps - 1)!.outText.trim(), 'A->B->C->D');
    return `BFS order="A->B->C->D" across ${engine.totalSteps} steps`;
  });

  // =========================================================================
  // TASK 9 — 15 API FAILURE CONDITION TESTS + LIVE BOUNDARY VERIFICATION
  // =========================================================================

  // T9-01: HTTP 200 valid JSON response
  await runTest('T9-01', 'Task9', 'HTTP 200 valid JSON response', async () => {
    const raw = JSON.stringify({
      success: true,
      language: 'java',
      mode: 'simulation',
      steps: [{ line: 1, note: 'Set a = 5', vars: { a: 5 }, print: '', outText: '' }],
      output: '',
      error: null,
    });
    const doc = parseTraceApiResponse({
      status: 200,
      ok: true,
      contentType: 'application/json; charset=utf-8',
      rawText: raw,
      language: 'java',
      executionMode: 'simulated',
      adapter: makeMeta('java', 'simulated'),
      lineCount: 3,
    });
    assert.equal(doc.events.length, 1);
    return `valid TraceDocument with 1 step`;
  });

  // T9-02: HTTP 200 HTML response (SPA fallback regression)
  await runTest('T9-02', 'Task9', 'HTTP 200 HTML response rejected cleanly', async () => {
    let caught: TraceApiError | null = null;
    try {
      parseTraceApiResponse({
        status: 200,
        ok: true,
        contentType: 'text/html; charset=utf-8',
        rawText: '<!doctype html><html><body>Index</body></html>',
        language: 'java',
        executionMode: 'simulated',
        adapter: makeMeta('java', 'simulated'),
        lineCount: 5,
      });
    } catch (err) {
      caught = err as TraceApiError;
    }
    assert.ok(caught instanceof TraceApiError);
    assert.equal(caught.category, 'api_response_error');
    const help = buildDeterministicErrorHelp(caught.message, 'int a = 5;', 'java', {
      category: caught.category,
      technicalDetail: caught.technicalDetail,
    });
    assert.equal(help.isUserCodeError, false);
    assert.equal(help.affectedLine, null);
    assert.ok(!/running this line of code/i.test(help.simpleExplanation));
    return `category=${help.category}, isUserCodeError=false`;
  });

  // T9-03: HTTP 200 malformed JSON response
  await runTest('T9-03', 'Task9', 'HTTP 200 malformed JSON response', async () => {
    let caught: TraceApiError | null = null;
    try {
      parseTraceApiResponse({
        status: 200,
        ok: true,
        contentType: 'application/json',
        rawText: '{"success": true, "steps": [broken',
        language: 'java',
        executionMode: 'simulated',
        adapter: makeMeta('java', 'simulated'),
        lineCount: 5,
      });
    } catch (err) {
      caught = err as TraceApiError;
    }
    assert.ok(caught instanceof TraceApiError);
    assert.equal(caught.category, 'api_response_error');
    const help = buildDeterministicErrorHelp(caught.message, 'int a = 5;', 'java', {
      category: caught.category,
    });
    assert.equal(help.isUserCodeError, false);
    return `category=${help.category}, isUserCodeError=false`;
  });

  // T9-04: Empty response
  await runTest('T9-04', 'Task9', 'Empty response body', async () => {
    let caught: TraceApiError | null = null;
    try {
      parseTraceApiResponse({
        status: 200,
        ok: true,
        contentType: 'application/json',
        rawText: '   ',
        language: 'java',
        executionMode: 'simulated',
        adapter: makeMeta('java', 'simulated'),
        lineCount: 5,
      });
    } catch (err) {
      caught = err as TraceApiError;
    }
    assert.ok(caught instanceof TraceApiError);
    assert.equal(caught.category, 'api_response_error');
    return `code=${caught.code}, category=${caught.category}`;
  });

  // T9-05: Incorrect response schema
  await runTest('T9-05', 'Task9', 'Incorrect response schema', async () => {
    let caught: TraceApiError | null = null;
    try {
      parseTraceApiResponse({
        status: 200,
        ok: true,
        contentType: 'application/json',
        rawText: '[1, 2, 3]',
        language: 'java',
        executionMode: 'simulated',
        adapter: makeMeta('java', 'simulated'),
        lineCount: 5,
      });
    } catch (err) {
      caught = err as TraceApiError;
    }
    assert.ok(caught instanceof TraceApiError);
    assert.equal(caught.category, 'invalid_trace_error');
    return `code=${caught.code}, category=${caught.category}`;
  });

  // T9-06: Missing trace steps
  await runTest('T9-06', 'Task9', 'Missing trace steps', async () => {
    let caught: TraceApiError | null = null;
    try {
      parseTraceApiResponse({
        status: 200,
        ok: true,
        contentType: 'application/json',
        rawText: JSON.stringify({ success: true, steps: [], events: [] }),
        language: 'java',
        executionMode: 'simulated',
        adapter: makeMeta('java', 'simulated'),
        lineCount: 5,
      });
    } catch (err) {
      caught = err as TraceApiError;
    }
    assert.ok(caught instanceof TraceApiError);
    assert.equal(caught.category, 'invalid_trace_error');
    assert.equal(caught.code, 'MISSING_TRACE_STEPS');
    return `code=${caught.code}`;
  });

  // T9-07: Invalid object references
  await runTest('T9-07', 'Task9', 'Invalid object references in trace payload', async () => {
    let caught: TraceApiError | null = null;
    try {
      parseTraceApiResponse({
        status: 200,
        ok: true,
        contentType: 'application/json',
        rawText: JSON.stringify({
          success: true,
          schemaVersion: '2.0',
          language: 'py',
          executionMode: 'real',
          events: [
            {
              id: 'event-001',
              sequence: 1,
              line: 1,
              type: 'var_declare',
              provenance: 'observed',
              scope: 'main',
              functionName: 'main',
              changes: [],
              objectIds: ['missing-obj-999'],
              heap: {},
              locals: { x: { __ref: 'missing-obj-999' } },
              callStack: [],
              print: '',
              outText: '',
              explanation: '',
              metadata: {},
              scene: null,
            },
          ],
        }),
        language: 'py',
        executionMode: 'real',
        adapter: makeMeta('py'),
        lineCount: 5,
      });
    } catch (err) {
      caught = err as TraceApiError;
    }
    assert.ok(caught instanceof TraceApiError);
    assert.equal(caught.category, 'invalid_trace_error');
    return `rejected dangling __ref with ${caught.category}`;
  });

  // T9-08: Gemini service unavailable (HTTP 503)
  await runTest('T9-08', 'Task9', 'Gemini service unavailable (HTTP 503)', async () => {
    let caught: TraceApiError | null = null;
    try {
      parseTraceApiResponse({
        status: 503,
        ok: false,
        contentType: 'application/json',
        rawText: JSON.stringify({
          success: false,
          error: 'This model is currently experiencing high demand. (HTTP 503)',
          errorDetail: { code: 'AI_SERVICE_UNAVAILABLE', category: 'ai_service_error' },
        }),
        language: 'java',
        executionMode: 'simulated',
        adapter: makeMeta('java', 'simulated'),
        lineCount: 5,
      });
    } catch (err) {
      caught = err as TraceApiError;
    }
    assert.ok(caught instanceof TraceApiError);
    assert.equal(caught.category, 'ai_service_error');
    const help = buildDeterministicErrorHelp(caught.message, 'int a = 5;', 'java', {
      category: caught.category,
    });
    assert.equal(help.isUserCodeError, false);
    assert.equal(help.category, 'ai_service_error');
    return `category=${help.category}, label="${help.categoryLabel}"`;
  });

  // T9-09: Invalid API configuration (HTTP 401/403)
  await runTest('T9-09', 'Task9', 'Invalid API configuration (HTTP 401/403)', async () => {
    let caught: TraceApiError | null = null;
    try {
      parseTraceApiResponse({
        status: 403,
        ok: false,
        contentType: 'application/json',
        rawText: JSON.stringify({
          success: false,
          error: 'API_KEY_INVALID: Gemini API key rejected (HTTP 403)',
        }),
        language: 'rust',
        executionMode: 'simulated',
        adapter: makeMeta('rust', 'simulated'),
        lineCount: 5,
      });
    } catch (err) {
      caught = err as TraceApiError;
    }
    assert.ok(caught instanceof TraceApiError);
    assert.equal(caught.category, 'ai_service_error');
    const help = buildDeterministicErrorHelp(caught.message, 'fn main() {}', 'rust', {
      category: caught.category,
    });
    assert.equal(help.isUserCodeError, false);
    return `category=${help.category}, isUserCodeError=false`;
  });

  // T9-10: API quota exceeded (HTTP 429)
  await runTest('T9-10', 'Task9', 'API quota exceeded (HTTP 429)', async () => {
    let caught: TraceApiError | null = null;
    try {
      parseTraceApiResponse({
        status: 429,
        ok: false,
        contentType: 'application/json',
        rawText: JSON.stringify({
          success: false,
          error: 'Quota exceeded (HTTP 429 RESOURCE_EXHAUSTED)',
        }),
        language: 'go',
        executionMode: 'simulated',
        adapter: makeMeta('go', 'simulated'),
        lineCount: 5,
      });
    } catch (err) {
      caught = err as TraceApiError;
    }
    assert.ok(caught instanceof TraceApiError);
    assert.equal(caught.category, 'ai_service_error');
    const help = buildDeterministicErrorHelp(caught.message, 'package main', 'go', {
      category: caught.category,
    });
    assert.equal(help.isUserCodeError, false);
    assert.match(help.simpleExplanation, /limit|quota/i);
    return `category=${help.category}, mentions quota/limit cleanly`;
  });

  // T9-11: Network failure
  await runTest('T9-11', 'Task9', 'Network failure', async () => {
    const help = buildDeterministicErrorHelp('TypeError: Failed to fetch', 'int a = 5;', 'java', {
      category: 'backend_connection_error',
    });
    assert.equal(help.category, 'backend_connection_error');
    assert.equal(help.isUserCodeError, false);
    assert.equal(help.affectedLine, null);
    return `category=${help.category}, label="${help.categoryLabel}"`;
  });

  // T9-12: Request timeout
  await runTest('T9-12', 'Task9', 'Request timeout (HTTP 504)', async () => {
    let caught: TraceApiError | null = null;
    try {
      parseTraceApiResponse({
        status: 504,
        ok: false,
        contentType: 'application/json',
        rawText: JSON.stringify({
          success: false,
          error: 'Gemini timed out after 22 seconds.',
        }),
        language: 'rust',
        executionMode: 'simulated',
        adapter: makeMeta('rust', 'simulated'),
        lineCount: 5,
      });
    } catch (err) {
      caught = err as TraceApiError;
    }
    assert.ok(caught instanceof TraceApiError);
    assert.equal(caught.category, 'timeout');
    const help = buildDeterministicErrorHelp(caught.message, 'fn main() {}', 'rust', {
      category: caught.category,
    });
    assert.equal(help.category, 'timeout');
    assert.equal(help.isUserCodeError, false);
    return `category=${help.category}, isUserCodeError=false`;
  });

  // T9-13: Unsupported programming language (live server)
  await runTest('T9-13', 'Task9', 'Unrecognized language & "other" rejected live', async () => {
    const r1 = await postTraceLive({ lang: 'other', code: 'x = 1' });
    assert.equal(r1.status, 400);
    assert.match(r1.contentType, /application\/json/i);
    const d1 = JSON.parse(r1.rawText);
    assert.equal(d1.success, false);
    assert.equal(d1.errorDetail?.category, 'unsupported');

    const r2 = await postTraceLive({ lang: 'brainfuck_unknown', code: '++++++++++.' });
    assert.equal(r2.status, 400);
    assert.match(r2.contentType, /application\/json/i);
    const d2 = JSON.parse(r2.rawText);
    assert.equal(d2.success, false);
    assert.equal(d2.errorDetail?.category, 'unsupported');
    return `HTTP 400 JSON for both "other" and "brainfuck_unknown"`;
  });

  // T9-14: Invalid source code (live Python + live Java)
  await runTest('T9-14', 'Task9', 'Invalid source code reports user code error cleanly', async () => {
    const pyRes = await postTraceLive({ lang: 'py', code: 'def broken(:\n  pass' });
    assert.equal(pyRes.status, 400);
    const pyData = JSON.parse(pyRes.rawText);
    assert.equal(pyData.success, false);
    const pyHelp = buildDeterministicErrorHelp(pyData.error, 'def broken(:\n  pass', 'py', {
      category: pyData.errorDetail?.category,
    });
    assert.equal(pyHelp.isUserCodeError, true);

    const javaCode = 'public class Main {\n  public static void main(String[] args) {\n    int a = 5\n    System.out.println(a);\n  }\n}';
    const jRes = await postTraceLive({ lang: 'java', code: javaCode });
    assert.equal(jRes.status, 400);
    const jData = JSON.parse(jRes.rawText);
    assert.equal(jData.success, false);
    assert.equal(jData.errorDetail?.category, 'compiler_error');
    const jHelp = buildDeterministicErrorHelp(jData.error, javaCode, 'java', {
      category: jData.errorDetail?.category,
    });
    assert.equal(jHelp.isUserCodeError, true);
    assert.equal(jHelp.affectedLine, 4);
    return `Python syntax & Java missing ';' both classified as user code errors`;
  });

  // T9-15: Renderer failure
  await runTest('T9-15', 'Task9', 'Renderer failure classified without blaming user code', async () => {
    const help = buildDeterministicErrorHelp(
      'Cannot read properties of undefined (reading "layout")',
      'int a = 5;',
      'java',
      { category: 'renderer_error', technicalDetail: 'CanvasErrorBoundary caught TypeError' }
    );
    assert.equal(help.category, 'renderer_error');
    assert.equal(help.isUserCodeError, false);
    assert.equal(help.affectedLine, null);
    assert.ok(!/problem in your code/i.test(help.simpleExplanation));
    return `category=${help.category}, label="${help.categoryLabel}"`;
  });

  // Live API boundary & missing-input checks
  await runTest('T9-16', 'Task9-Live', 'API routes never fall through to HTTP 200 HTML', async () => {
    const getTrace = await fetch(`${BASE_URL}/api/trace`);
    assert.equal(getTrace.status, 405);
    assert.match(getTrace.headers.get('content-type') || '', /application\/json/i);

    const unknownApi = await fetch(`${BASE_URL}/api/unknown-route`, { method: 'POST' });
    assert.equal(unknownApi.status, 404);
    assert.match(unknownApi.headers.get('content-type') || '', /application\/json/i);

    const badJson = await fetch(`${BASE_URL}/api/trace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid-json',
    });
    assert.equal(badJson.status, 400);
    assert.match(badJson.headers.get('content-type') || '', /application\/json/i);

    // Missing stdin in Java Scanner must error honestly, never invent values
    const missingIn = await postTraceLive({
      lang: 'java',
      code: 'import java.util.Scanner;\nclass Main { public static void main(String[] args) { Scanner sc = new Scanner(System.in); int x = sc.nextInt(); System.out.println(x); } }',
      stdin: '',
    });
    assert.equal(missingIn.status, 400);
    const missingData = JSON.parse(missingIn.rawText);
    assert.equal(missingData.errorDetail?.category, 'missing_input');
    return `GET /api/trace=405 JSON, unknown=404 JSON, badJson=400 JSON, missingStdin=400 missing_input`;
  });

  // Live Gemini AI escalation check (forceAi: true) — reports honest upstream status
  await runTest('T9-17', 'Task9-Live', 'Gemini AI escalation returns valid structured JSON (success OR honest 503/429 error)', async () => {
    const res = await postTraceLive({
      lang: 'java',
      code: 'public class Main { public static void main(String[] args) { int a = 5; int b = 4; System.out.println(a * b); } }',
      forceAi: true,
    });
    assert.match(res.contentType, /application\/json/i, `AI route must ALWAYS return JSON, got ${res.contentType}`);
    const parsed = JSON.parse(res.rawText) as {
      success?: boolean;
      error?: string;
      errorDetail?: { category?: string; code?: string };
      steps?: unknown[];
    };
    if (res.status === 200) {
      assert.equal(parsed.success, true);
      assert.ok(Array.isArray(parsed.steps) && parsed.steps.length > 0);
      return `Gemini live AI simulation SUCCEEDED (${parsed.steps.length} steps)`;
    }
    // Upstream quota/demand error must be structured JSON with ai_service_error, NEVER HTTP 200 HTML
    assert.ok([429, 502, 503, 504].includes(res.status), `Expected 200 or 429/502/503/504, got ${res.status}`);
    assert.equal(parsed.success, false);
    assert.ok(
      parsed.errorDetail?.category === 'ai_service_error' || parsed.errorDetail?.category === 'timeout',
      `Expected ai_service_error/timeout, got ${parsed.errorDetail?.category}`
    );
    return `Upstream Gemini returned honest HTTP ${res.status} JSON (${parsed.errorDetail?.code})`;
  });

  // Task 10: Headless Browser DOM Verification (honestly NOT EXECUTED — no browser binary installed)
  results.push({
    id: 'T10-UI',
    group: 'Task10',
    name: 'Real headless browser DOM interaction (Playwright/Chromium)',
    status: 'NOT EXECUTED',
    detail: 'No Chromium/Playwright browser binary is installed in this container environment.',
  });
  console.log('[NOT EXECUTED] T10-UI (Task10) — Real headless browser DOM interaction: No browser binary installed.');

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const notExec = results.filter((r) => r.status === 'NOT EXECUTED').length;

  console.log(`\n=== PHASE 5.5 SUMMARY: ${passed} PASS, ${failed} FAIL, ${notExec} NOT EXECUTED ===`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Fatal test harness error:', err);
  process.exitCode = 1;
});
