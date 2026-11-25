/**
 * CODE ANIM — PHASE 6 FINAL RELEASE VERIFICATION SUITE
 *
 * Tests real runtime execution, all 54 language registrations & auto-detection,
 * basic + advanced programs across Java, Python, C, C++, and JavaScript,
 * security headers, rate-limit headers, oversized payload rejection,
 * AI privacy opt-out, live Gemini API status, and production build integrity.
 *
 * ZERO fabricated results. Live browser DOM testing is honestly marked NOT EXECUTED
 * because no Chromium/Playwright browser binary exists in this container.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  getAllLanguages,
  getLiveExecutionLanguages,
  getSelectableLanguages,
  getSimulatedLanguages,
  getUnavailableLanguages,
} from '../src/lib/languageRegistry';
import { detectLanguageFromCode } from '../src/lib/languageDetector';
import { analyzeProgramExecution } from '../src/lib/programAnalyzer';
import { TraceReplayEngine } from '../src/lib/replayEngine';
import { parseTraceApiResponse } from '../src/lib/adapters';
import { validateImportedCodeAnimFile } from '../src/lib/exportImport';
import { instrumentJavaScriptAst } from '../src/lib/jsAstInstrumenter';
import { traceJavaScript } from '../src/lib/jsTracer';
import { interpretCLikeProgram } from '../src/lib/clikeInterpreter';
import type { LanguageAdapterMeta, LanguageId, TraceDocument } from '../src/types/trace';

const BASE_URL = 'http://localhost:3000';

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
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ id, group, name, status: 'FAIL', detail: msg });
    console.error(`[FAIL] ${id} (${group}) — ${name}: ${msg}`);
  }
}

function makeMeta(lang: LanguageId, mode: 'real' | 'simulated'): LanguageAdapterMeta {
  return {
    id: `${lang}-test`,
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

async function postTraceLive(payload: Record<string, unknown>): Promise<{
  status: number;
  ok: boolean;
  contentType: string;
  headers: Headers;
  rawText: string;
}> {
  const resp = await fetch(`${BASE_URL}/api/trace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return {
    status: resp.status,
    ok: resp.ok,
    contentType: resp.headers.get('content-type') || '',
    headers: resp.headers,
    rawText: await resp.text(),
  };
}

async function traceServer(lang: LanguageId, code: string, stdin = ''): Promise<TraceDocument> {
  const res = await postTraceLive({ lang, code, stdin, allowSimulation: true });
  return parseTraceApiResponse({
    status: res.status,
    ok: res.ok,
    contentType: res.contentType,
    rawText: res.rawText,
    language: lang,
    executionMode: 'real',
    adapter: makeMeta(lang, 'real'),
    lineCount: Math.max(1, code.split('\n').length),
  });
}

async function main() {
  console.log('=== CODE ANIM PHASE 6 FINAL VERIFICATION SUITE ===\n');

  // -------------------------------------------------------------------------
  // GROUP 1: LANGUAGE REGISTRY (54 NAMED LANGUAGES, ZERO "OTHER") & DETECTOR
  // -------------------------------------------------------------------------
  await runTest('P6-L1', 'Languages', 'All 54 named languages enabled and selectable (0 "other", 0 unavailable)', () => {
    const all = getAllLanguages();
    const selectable = getSelectableLanguages();
    const live = getLiveExecutionLanguages();
    const simulated = getSimulatedLanguages();
    const unavailable = getUnavailableLanguages();

    assert.equal(all.length, 54, `Expected 54 languages, got ${all.length}`);
    assert.equal(selectable.length, 54, `Expected all 54 selectable, got ${selectable.length}`);
    assert.equal(live.length, 6, `Expected 6 live languages (JS, TS, Py, Java, C, C++), got ${live.length}`);
    assert.equal(simulated.length, 48, `Expected 48 AI-simulated languages, got ${simulated.length}`);
    assert.equal(unavailable.length, 0, `Expected 0 unavailable languages, got ${unavailable.length}`);
    assert.ok(!all.some((l) => (l.id as string) === 'other' || l.name.toLowerCase() === 'other'));
    return `54 total: 6 Live Execution + 48 AI Simulation, 0 "other"`;
  });

  await runTest('P6-L2', 'Languages', 'Auto-detection works across Priority 1, 2, and 3 languages', () => {
    const samples: Array<[LanguageId, string]> = [
      ['java', 'public class Main { public static void main(String[] args) { System.out.println(5 * 4); } }'],
      ['py', 'def factorial(n):\n    return 1 if n <= 1 else n * factorial(n - 1)\nprint(factorial(5))'],
      ['js', 'const nums = [3, 1, 2];\nconsole.log(nums.sort((a, b) => a - b));'],
      ['ts', 'interface Item { id: number; name: string }\nconst x: Item = { id: 1, name: "a" };'],
      ['c', '#include <stdio.h>\nint main() { printf("%d\\n", 7 + 8); return 0; }'],
      ['cpp', '#include <iostream>\nusing namespace std;\nint main() { cout << 42 << endl; return 0; }'],
      ['go', 'package main\nimport "fmt"\nfunc main() { fmt.Println("hi") }'],
      ['rust', 'fn main() { let mut x = 10; println!("{}", x); }'],
      ['csharp', 'using System;\nnamespace App { class Program { static void Main() { Console.WriteLine(1); } } }'],
      ['sql', 'SELECT id, name FROM users WHERE active = 1 ORDER BY id DESC;'],
      ['haskell', 'module Main where\nmain :: IO ()\nmain = putStrLn "Hello"'],
      ['cobol', 'IDENTIFICATION DIVISION.\nPROGRAM-ID. HELLO.\nPROCEDURE DIVISION.\nDISPLAY "HELLO".\nSTOP RUN.'],
      ['fortran', 'program hello\n  implicit none\n  print *, "Hello"\nend program hello'],
      ['solidity', 'pragma solidity ^0.8.0;\ncontract Counter { uint256 public count; }'],
      ['powershell', 'Write-Host "Hello"\n$items = @(1,2,3)\nForEach ($x in $items) { Write-Output $x }'],
    ];
    for (const [expected, code] of samples) {
      const det = detectLanguageFromCode(code);
      assert.equal(det.languageId, expected, `Expected ${expected}, detected ${det.languageId}`);
    }
    return `Verified ${samples.length} languages across Priority 1/2/3`;
  });

  await runTest('P6-L3', 'Languages', 'Mismatched file extension overridden by clear code syntax + tiny snippet safe', () => {
    const mismatch = detectLanguageFromCode(
      'public class Main { public static void main(String[] args) { System.out.println("Java"); } }',
      'notes.py'
    );
    assert.equal(mismatch.languageId, 'java');
    assert.equal(mismatch.extensionMismatch, true);

    const tiny = detectLanguageFromCode('x = 1');
    assert.ok(tiny.confidence !== 'high', 'Tiny ambiguous snippet must not force high-confidence switch');
    return `Mismatch detected (notes.py -> Java), ambiguous snippet confidence=${tiny.confidence}`;
  });

  // -------------------------------------------------------------------------
  // GROUP 2: BASIC PROGRAMS ACROSS LIVE LANGUAGES
  // -------------------------------------------------------------------------
  await runTest('P6-B1', 'Basic', 'Java, Python, C, C++, JS basic arithmetic & Hello World live', async () => {
    // Java multiply
    const javaDoc = await traceServer(
      'java',
      'public class Main { public static void main(String[] args) { int price = 9; int qty = 6; int total = price * qty; System.out.println(total); } }'
    );
    assert.equal(javaDoc.executionMode, 'real');
    const jEnd = new TraceReplayEngine(javaDoc, '').getStateAt(javaDoc.events.length - 1)!;
    assert.equal(jEnd.outText.trim(), '54');

    // Python strings + negative + modulo
    const pyDoc = await traceServer(
      'py',
      'msg = "Hello"\nval = -17\nrem = abs(val) % 5\nprint(f"{msg} {rem}")'
    );
    assert.equal(pyDoc.executionMode, 'real');
    const pEnd = new TraceReplayEngine(pyDoc, '').getStateAt(pyDoc.events.length - 1)!;
    assert.equal(pEnd.outText.trim(), 'Hello 2');

    // C decimals + printf
    const cDoc = await traceServer(
      'c',
      '#include <stdio.h>\nint main() { double a = 3.5; double b = 2.0; printf("%.1f\\n", a * b); return 0; }'
    );
    assert.equal(cDoc.executionMode, 'real');
    const cEnd = new TraceReplayEngine(cDoc, '').getStateAt(cDoc.events.length - 1)!;
    assert.equal(cEnd.outText.trim(), '7.0');

    // C++ cin stdin + cout
    const cppDoc = await traceServer(
      'cpp',
      '#include <iostream>\nusing namespace std;\nint main() { int x, y; cin >> x >> y; cout << (x + y) << endl; return 0; }',
      '14 28'
    );
    assert.equal(cppDoc.executionMode, 'real');
    const cppEnd = new TraceReplayEngine(cppDoc, '').getStateAt(cppDoc.events.length - 1)!;
    assert.equal(cppEnd.outText.trim(), '42');

    // JS tracer (same Acorn AST engine used inside Web Worker)
    const jsCode = 'let a = 12, b = 5;\nlet res = a - b;\nconsole.log(res);';
    const inst = instrumentJavaScriptAst(jsCode);
    assert.ok(inst.astValid && inst.code.length > 0);
    const jsRes = traceJavaScript(jsCode);
    assert.ok(!jsRes.error);
    assert.equal(jsRes.steps[jsRes.steps.length - 1].outText.trim(), '7');

    return `Java=54, Python="Hello 2", C=7.0, C++(stdin)=42, JS=7`;
  });

  // -------------------------------------------------------------------------
  // GROUP 3: ADVANCED STRUCTURES & UNFAMILIAR PROGRAMS
  // -------------------------------------------------------------------------
  await runTest('P6-A1', 'Advanced', 'Sorting, Searching, Recursion, Linked List, Tree, Graph, Matrix, DP, Hash Table', async () => {
    // 1. Bubble Sort in Java
    const sortCode = [
      'public class Sort {',
      '  public static void main(String[] args) {',
      '    int[] arr = {4, 2, 5, 1};',
      '    for (int i = 0; i < arr.length; i++) {',
      '      for (int j = 0; j < arr.length - 1 - i; j++) {',
      '        if (arr[j] > arr[j + 1]) {',
      '          int tmp = arr[j]; arr[j] = arr[j + 1]; arr[j + 1] = tmp;',
      '        }',
      '      }',
      '    }',
      '    System.out.println(arr[0] + "," + arr[3]);',
      '  }',
      '}',
    ].join('\n');
    const sortRes = interpretCLikeProgram('java', sortCode, '');
    assert.equal(sortRes.status, 'ok');
    if (sortRes.status === 'ok') assert.equal(sortRes.output.trim(), '1,5');

    // 2. Recursion (Fibonacci) in C++
    const recCode = [
      '#include <iostream>',
      'using namespace std;',
      'int fib(int n) {',
      '  if (n <= 1) return n;',
      '  return fib(n - 1) + fib(n - 2);',
      '}',
      'int main() { cout << fib(5) << endl; return 0; }',
    ].join('\n');
    const recRes = interpretCLikeProgram('cpp', recCode, '');
    assert.equal(recRes.status, 'ok');
    if (recRes.status === 'ok') {
      assert.equal(recRes.output.trim(), '5');
      assert.ok(recRes.events.some((e) => e.type === 'function_call'));
    }

    // 3. Multi-structure Python (Linked List + Binary Tree + Graph BFS + Hash Table + 2D DP Matrix)
    const multiPy = [
      'class Node:',
      '    def __init__(self, val):',
      '        self.val = val',
      '        self.next = None',
      'head = Node(10)',
      'head.next = Node(20)',
      'class TNode:',
      '    def __init__(self, val):',
      '        self.val = val',
      '        self.left = None',
      '        self.right = None',
      'root = TNode(5)',
      'root.left = TNode(2)',
      'root.right = TNode(8)',
      'graph = {"A": ["B", "C"], "B": ["D"], "C": [], "D": []}',
      'queue = ["A"]',
      'visited = set(["A"])',
      'order = []',
      'while queue:',
      '    curr = queue.pop(0)',
      '    order.append(curr)',
      '    for nxt in graph[curr]:',
      '        if nxt not in visited:',
      '            visited.add(nxt)',
      '            queue.append(nxt)',
      'dp = [[0, 1], [1, 2]]',
      'freq = {"a": 2, "b": 3}',
      'print(",".join(order), dp[1][1], freq["b"])',
    ].join('\n');
    const pyDoc = await traceServer('py', multiPy);
    const analysis = analyzeProgramExecution(multiPy, pyDoc);
    assert.ok(analysis.summary.finalOutput.includes('A,B,C,D 2 3'));
    assert.ok(analysis.summary.detectedStructures.length >= 2);

    // 4. Unfamiliar custom program (inventory restock discount calculator in JS)
    const customJs = [
      'const stock = [12, 4, 19, 2];',
      'let restockCost = 0;',
      'for (let idx = 0; idx < stock.length; idx++) {',
      '  if (stock[idx] < 5) {',
      '    restockCost += (10 - stock[idx]) * 3;',
      '  }',
      '}',
      'console.log("restock=" + restockCost);',
    ].join('\n');
    const customRes = traceJavaScript(customJs);
    assert.ok(!customRes.error);
    assert.equal(customRes.steps[customRes.steps.length - 1].outText.trim(), 'restock=42');

    return `Sort(Java)=1,5, Fib(C++)=5, Multi-DSA(Py) structures=${analysis.summary.detectedStructures.join('/')}, Unfamiliar(JS)=restock=42`;
  });

  // -------------------------------------------------------------------------
  // GROUP 4: SECURITY, PRIVACY OPT-OUT & RELIABILITY
  // -------------------------------------------------------------------------
  await runTest('P6-S1', 'Security', 'Security headers (iframe-safe) & rate-limit headers present on API', async () => {
    const healthResp = await fetch(`${BASE_URL}/api/health`);
    assert.equal(healthResp.status, 200);
    assert.equal(healthResp.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(healthResp.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(healthResp.headers.get('x-powered-by'), null, 'X-Powered-By must be disabled');
    assert.equal(healthResp.headers.get('x-frame-options'), null, 'X-Frame-Options must NOT block preview iframe');

    const explainResp = await fetch(`${BASE_URL}/api/explain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: 'js', code: 'let x = 1;', aiEnabled: false }),
    });
    assert.equal(explainResp.status, 200);
    assert.ok(Number(explainResp.headers.get('x-ratelimit-limit')) > 0);
    assert.ok(explainResp.headers.get('x-ratelimit-remaining') !== null);
    const explainJson = (await explainResp.json()) as { provider?: string };
    assert.equal(explainJson.provider, 'deterministic', 'aiEnabled: false must bypass Gemini');

    const errHelpResp = await fetch(`${BASE_URL}/api/error-help`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: 'py', code: 'x = 1/0', error: 'ZeroDivisionError', aiEnabled: false }),
    });
    assert.equal(errHelpResp.status, 200);
    const errHelpJson = (await errHelpResp.json()) as { provider?: string };
    assert.equal(errHelpJson.provider, 'deterministic', 'aiEnabled: false on error-help must bypass Gemini');

    return `nosniff + no-referrer + no X-Powered-By + rate-limit headers + AI opt-out verified`;
  });

  await runTest('P6-S2', 'Security', 'Oversized code (>100KB), oversized stdin (>16KB), & malformed import rejected safely', async () => {
    const bigCode = 'a'.repeat(105 * 1024);
    const rCode = await postTraceLive({ lang: 'py', code: bigCode });
    assert.equal(rCode.status, 400);
    const dCode = JSON.parse(rCode.rawText);
    assert.equal(dCode.errorDetail?.code, 'CODE_TOO_LARGE');

    const bigStdin = 'x'.repeat(20 * 1024);
    const rStdin = await postTraceLive({ lang: 'py', code: 'print(1)', stdin: bigStdin });
    assert.equal(rStdin.status, 400);
    const dStdin = JSON.parse(rStdin.rawText);
    assert.equal(dStdin.errorDetail?.code, 'INPUT_TOO_LARGE');

    const badImport = validateImportedCodeAnimFile('{not valid json');
    assert.equal(badImport.ok, false);

    const maliciousSchema = validateImportedCodeAnimFile(JSON.stringify({ kind: 'unknown', payload: '<script>alert(1)</script>' }));
    assert.equal(maliciousSchema.ok, false);

    return `100KB code limit, 16KB stdin limit, and JSON import schema validation all enforced`;
  });

  await runTest('P6-S3', 'Security', 'Python sandbox blocks filesystem & network I/O and stops infinite loops', async () => {
    const fileRes = await postTraceLive({ lang: 'py', code: 'f = open("/etc/passwd")\nprint(f.read())' });
    assert.equal(fileRes.status, 400);
    const fileData = JSON.parse(fileRes.rawText);
    assert.equal(fileData.success, false);

    const netRes = await postTraceLive({ lang: 'py', code: 'import socket\ns = socket.socket()' });
    assert.equal(netRes.status, 400);
    const netData = JSON.parse(netRes.rawText);
    assert.equal(netData.success, false);

    const loopRes = await postTraceLive({ lang: 'py', code: 'i = 0\nwhile True:\n    i += 1' });
    assert.ok(loopRes.status === 200 || loopRes.status === 400);
    const loopData = JSON.parse(loopRes.rawText);
    assert.ok(loopData.interrupted === true || loopData.success === false, 'Infinite loop must be capped/interrupted');

    return `Blocked file open, blocked socket import, capped infinite loop`;
  });

  await runTest('P6-AI1', 'AI', '/api/adapters accurately lists all 54 languages & live Gemini probe returns valid JSON', async () => {
    const adaptersResp = await fetch(`${BASE_URL}/api/adapters`);
    assert.equal(adaptersResp.status, 200);
    const adaptersJson = (await adaptersResp.json()) as {
      languagesCount: number;
      adapters: Array<{ language: string; executionMode: string }>;
    };
    assert.equal(adaptersJson.languagesCount, 54);
    assert.equal(adaptersJson.adapters.length, 54);
    const javaAdapter = adaptersJson.adapters.find((a) => a.language === 'java');
    assert.equal(javaAdapter?.executionMode, 'real');

    // Live Gemini simulation probe (Go — AI-simulated language)
    const goRes = await postTraceLive({
      lang: 'go',
      code: 'package main\nimport "fmt"\nfunc main() {\n  a := 6\n  b := 7\n  fmt.Println(a * b)\n}',
    });
    assert.match(goRes.contentType, /application\/json/i);
    const goJson = JSON.parse(goRes.rawText) as {
      success?: boolean;
      steps?: unknown[];
      errorDetail?: { code?: string; category?: string };
    };
    if (goRes.status === 200) {
      assert.equal(goJson.success, true);
      assert.ok(Array.isArray(goJson.steps) && goJson.steps.length > 0);
      return `54 adapters verified; live Go Gemini AI simulation SUCCEEDED (${goJson.steps.length} steps)`;
    }
    assert.ok([429, 502, 503, 504].includes(goRes.status), `Expected 200 or 429/502/503/504, got ${goRes.status}`);
    assert.equal(goJson.success, false);
    return `54 adapters verified; live Go Gemini probe returned honest HTTP ${goRes.status} (${goJson.errorDetail?.code})`;
  });

  // -------------------------------------------------------------------------
  // GROUP 5: PRODUCTION BUILD ARTIFACTS & ZERO SECRET LEAKAGE
  // -------------------------------------------------------------------------
  await runTest('P6-B2', 'Production', 'dist/ production build exists and leaks zero server secrets', () => {
    const distDir = path.resolve(process.cwd(), 'dist');
    const indexHtml = path.join(distDir, 'index.html');
    assert.ok(fs.existsSync(indexHtml), 'dist/index.html missing — run npm run build first');
    const assetsDir = path.join(distDir, 'assets');
    assert.ok(fs.existsSync(assetsDir), 'dist/assets directory missing');

    const files = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js') || f.endsWith('.css'));
    assert.ok(files.length > 0, 'No compiled JS/CSS assets found in dist/assets');

    const apiKey = process.env.GEMINI_API_KEY || '';
    for (const file of files) {
      const content = fs.readFileSync(path.join(assetsDir, file), 'utf8');
      assert.ok(!content.includes('GEMINI_API_KEY'), `Found GEMINI_API_KEY reference in client bundle ${file}`);
      if (apiKey.length >= 12) {
        assert.ok(!content.includes(apiKey), `Leaked actual API key in client bundle ${file}`);
      }
    }
    return `Verified dist/index.html + ${files.length} compiled assets with zero secret leakage`;
  });

  // -------------------------------------------------------------------------
  // GROUP 6: HONEST REPORTING OF BROWSER UI TESTS
  // -------------------------------------------------------------------------
  results.push({
    id: 'P6-UI',
    group: 'Interface',
    name: 'Live headless browser DOM, responsive, fullscreen, theme, and keyboard interaction',
    status: 'NOT EXECUTED',
    detail: 'No Chromium/Playwright browser binary is installed in this Linux container.',
  });
  console.log('[NOT EXECUTED] P6-UI (Interface) — Live headless browser DOM tests: No browser binary installed.');

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const notExec = results.filter((r) => r.status === 'NOT EXECUTED').length;

  console.log(`\n=== PHASE 6 SUMMARY: ${passed} PASS, ${failed} FAIL, ${notExec} NOT EXECUTED ===`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Fatal Phase 6 test harness error:', err);
  process.exitCode = 1;
});
