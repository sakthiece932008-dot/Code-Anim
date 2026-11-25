import { traceJavaScriptDocument, type JsTraceOptions } from '../lib/jsTracer';

// Harden the dedicated Web Worker sandbox by blocking network & storage globals
// before any user JavaScript can be evaluated.
const g = self as unknown as Record<string, unknown>;
const blockedGlobals = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'importScripts',
  'indexedDB',
  'caches',
  'BroadcastChannel',
  'navigator',
];

for (const name of blockedGlobals) {
  try {
    Object.defineProperty(g, name, {
      value: undefined,
      writable: false,
      configurable: false,
    });
  } catch {
    try {
      g[name] = undefined;
    } catch {
      // Ignore non-configurable runtime properties
    }
  }
}

interface WorkerTraceRequest {
  requestId: number;
  code: string;
  options?: JsTraceOptions;
}

self.onmessage = (event: MessageEvent<WorkerTraceRequest>) => {
  const { requestId, code, options } = event.data || { requestId: 0, code: '' };
  try {
    const result = traceJavaScriptDocument(code, options);
    if (!result.document) {
      self.postMessage({
        requestId,
        ok: false,
        error: result.error || 'No executable statements were captured.',
      });
      return;
    }
    self.postMessage({
      requestId,
      ok: true,
      document: result.document,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({
      requestId,
      ok: false,
      error: message || 'JavaScript worker execution failed.',
    });
  }
};
