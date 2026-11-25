import type { TraceDocument } from '../types/trace';
import { traceJavaScriptDocument, type JsTraceOptions } from './jsTracer';

const DEFAULT_TIMEOUT_MS = 5000;

interface WorkerTraceResponse {
  requestId: number;
  ok: boolean;
  document?: TraceDocument;
  error?: string;
}

let workerRequestSeq = 0;

/**
 * Executes user JavaScript (or transpiled TypeScript) inside an isolated dedicated
 * Web Worker with a hard timeout and immediate `worker.terminate()` kill switch.
 */
export function runJavaScriptInWorker(
  code: string,
  options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
    traceOptions?: JsTraceOptions;
  }
): Promise<TraceDocument> {
  const signal = options?.signal;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const traceOptions = options?.traceOptions;

  if (signal?.aborted) {
    return Promise.reject(new DOMException('Trace canceled', 'AbortError'));
  }

  // Fallback for non-browser test runners where Web Worker is unavailable
  if (typeof Worker === 'undefined') {
    return new Promise<TraceDocument>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (signal?.aborted) {
          reject(new DOMException('Trace canceled', 'AbortError'));
          return;
        }
        const res = traceJavaScriptDocument(code, traceOptions);
        if (!res.document) {
          reject(new Error(res.error || 'JavaScript tracing failed.'));
        } else {
          resolve(res.document);
        }
      }, 0);

      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new DOMException('Trace canceled', 'AbortError'));
        },
        { once: true }
      );
    });
  }

  return new Promise<TraceDocument>((resolve, reject) => {
    const requestId = ++workerRequestSeq;
    const worker = new Worker(
      new URL('../workers/jsTraceWorker.ts', import.meta.url),
      { type: 'module' }
    );

    let settled = false;

    const cleanup = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new DOMException('Trace canceled by user.', 'AbortError'));
    };

    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(
          `Execution exceeded the ${timeoutMs / 1000}s limit and was terminated (possible infinite loop).`
        )
      );
    }, timeoutMs);

    signal?.addEventListener('abort', onAbort, { once: true });

    worker.onmessage = (event: MessageEvent<WorkerTraceResponse>) => {
      if (settled || event.data?.requestId !== requestId) return;
      settled = true;
      cleanup();
      if (event.data.ok && event.data.document) {
        resolve(event.data.document);
      } else {
        reject(new Error(event.data.error || 'Execution tracing failed.'));
      }
    };

    worker.onerror = (err: ErrorEvent) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(err.message || 'Execution worker crashed.'));
    };

    worker.postMessage({ requestId, code, options: traceOptions });
  });
}
