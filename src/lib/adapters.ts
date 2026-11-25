import {
  validateAndNormalizeTraceDocument,
  type ErrorCategory,
  type ExecutionMode,
  type LanguageAdapterMeta,
  type LanguageId,
  type TraceDocument,
  type TraceRunOptions,
} from '../types/trace';
import {
  getLanguageSpec,
  getSelectableLanguages,
  type LanguageCapabilitySpec,
} from './languageRegistry';
import { JS_ADAPTER_META } from './jsTracer';
import { runJavaScriptInWorker } from './jsWorkerRunner';

export class TraceApiError extends Error {
  readonly category: ErrorCategory;
  readonly code: string;
  readonly httpStatus?: number;
  readonly technicalDetail?: string;

  constructor(params: {
    message: string;
    category: ErrorCategory;
    code: string;
    httpStatus?: number;
    technicalDetail?: string;
  }) {
    super(params.message);
    this.name = 'TraceApiError';
    this.category = params.category;
    this.code = params.code;
    this.httpStatus = params.httpStatus;
    this.technicalDetail = params.technicalDetail;
  }
}

export interface LanguageTracerAdapter {
  readonly meta: LanguageAdapterMeta;
  trace(code: string, signal?: AbortSignal, options?: TraceRunOptions): Promise<TraceDocument>;
}

export const TYPESCRIPT_ADAPTER_META: LanguageAdapterMeta = {
  id: 'ts-esbuild-worker',
  language: 'ts',
  label: 'TypeScript',
  executionMode: 'real',
  runtimeAvailable: true,
  executionMethod: 'esbuild TypeScript transpile + Acorn AST in isolated Web Worker',
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
  limitations: [
    'Transpiles TypeScript types via esbuild on the server (never executed on server) and runs synchronously in an isolated Web Worker.',
    'Capped at 1,500 trace events and a 5-second worker timeout; cross-file type checking is not performed.',
  ],
};

export const PYTHON_ADAPTER_META: LanguageAdapterMeta = {
  id: 'python-subprocess-sandbox',
  language: 'py',
  label: 'Python',
  executionMode: 'real',
  runtimeAvailable: true,
  executionMethod: 'Sandboxed Python 3 subprocess (sys.settrace + rlimit + audit hook)',
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
  limitations: [
    'Runs in an isolated Python 3 subprocess with 5s CPU limit, 256 MB RAM cap, and blocked file/network I/O.',
    'Supports Program Input via input() / sys.stdin; only allowlisted algorithmic standard-library modules can be imported.',
  ],
};

export function createSimulatedAdapterMeta(spec: LanguageCapabilitySpec): LanguageAdapterMeta {
  return {
    id: `ai-sim-${spec.id}`,
    language: spec.id,
    label: spec.name,
    executionMode: 'simulated',
    runtimeAvailable: true,
    executionMethod: 'AI-simulated step trace via server-side Gemini',
    capabilities: {
      primitives: true,
      arrays: true,
      linkedStructures: true,
      trees: true,
      graphs: true,
      callStack: false,
      loopsAndBranches: true,
      objectIdentity: false,
      cancellation: true,
    },
    limitations: [
      ...spec.limitations,
      'AI-simulated trace — not executed by a native compiler or VM; verify output against a real toolchain.',
    ],
  };
}

function classifyServerHttpFailure(
  status: number,
  data: Record<string, unknown>,
  rawSnippet: string
): TraceApiError {
  const detail =
    data.errorDetail && typeof data.errorDetail === 'object'
      ? (data.errorDetail as { code?: unknown; category?: unknown; message?: unknown })
      : null;

  const message =
    (typeof data.error === 'string' && data.error.trim()) ||
    (typeof detail?.message === 'string' && detail.message.trim()) ||
    `Trace request failed (HTTP ${status}).`;

  const code = typeof detail?.code === 'string' ? detail.code : `HTTP_${status}`;
  let category: ErrorCategory =
    typeof detail?.category === 'string'
      ? (detail.category as ErrorCategory)
      : status === 503 || status === 429 || status === 401 || status === 403
        ? 'ai_service_error'
        : status === 504
          ? 'timeout'
          : status === 502
            ? 'invalid_trace_error'
            : status === 404 || status === 405
              ? 'api_response_error'
              : 'runtime_error';

  const lower = message.toLowerCase();
  if (lower.includes('not available') || lower.includes('unsupported')) {
    category = 'unsupported';
  }

  return new TraceApiError({
    message,
    category,
    code,
    httpStatus: status,
    technicalDetail: `HTTP ${status} (${code}): ${message}${rawSnippet ? ` | Body: ${rawSnippet}` : ''}`,
  });
}

/**
 * Strictly validates an HTTP response from `/api/trace`.
 * Never treats HTTP 200 alone as proof of valid trace execution:
 * detects HTML fallback pages, empty bodies, malformed JSON, error envelopes,
 * missing steps, and invalid object references.
 */
export function parseTraceApiResponse(params: {
  status: number;
  ok: boolean;
  contentType: string;
  rawText: string;
  language: LanguageId;
  executionMode: ExecutionMode;
  adapter: LanguageAdapterMeta;
  lineCount: number;
}): TraceDocument {
  const { status, ok, contentType, rawText, language, executionMode, adapter, lineCount } = params;
  const trimmed = rawText.trim();
  const safeSnippet = trimmed.slice(0, 140).replace(/\s+/g, ' ');

  if (!trimmed) {
    throw new TraceApiError({
      message: `The server returned an empty response (HTTP ${status}).`,
      category: 'api_response_error',
      code: 'EMPTY_API_RESPONSE',
      httpStatus: status,
      technicalDetail: `HTTP ${status}, Content-Type: ${contentType || '(none)'}, empty body.`,
    });
  }

  const looksLikeHtml =
    contentType.toLowerCase().includes('text/html') ||
    /^<!doctype\s+html/i.test(trimmed) ||
    /^<html\b/i.test(trimmed);

  if (looksLikeHtml) {
    throw new TraceApiError({
      message: `The server returned an HTML page instead of JSON trace data (HTTP ${status}).`,
      category: 'api_response_error',
      code: 'HTML_RESPONSE_INSTEAD_OF_JSON',
      httpStatus: status,
      technicalDetail: `Expected application/json from /api/trace, received ${contentType || 'HTML'} (HTTP ${status}). Snippet: ${safeSnippet}`,
    });
  }

  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    throw new TraceApiError({
      message: `The server returned malformed JSON that could not be parsed (HTTP ${status}).`,
      category: 'api_response_error',
      code: 'MALFORMED_JSON_RESPONSE',
      httpStatus: status,
      technicalDetail: `JSON.parse failed on HTTP ${status} response (${contentType || 'unknown type'}). Snippet: ${safeSnippet}`,
    });
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new TraceApiError({
      message: `The server returned an unexpected JSON structure (HTTP ${status}).`,
      category: 'invalid_trace_error',
      code: 'INVALID_RESPONSE_SCHEMA',
      httpStatus: status,
      technicalDetail: `Expected a JSON object from /api/trace, received ${Array.isArray(data) ? 'array' : typeof data}.`,
    });
  }

  const record = data as Record<string, unknown>;

  // Never trust HTTP 200 if the JSON envelope explicitly indicates failure
  if (!ok || record.success === false) {
    throw classifyServerHttpFailure(status, record, safeSnippet);
  }

  const hasSteps = Array.isArray(record.steps) && record.steps.length > 0;
  const hasEvents = Array.isArray(record.events) && record.events.length > 0;
  if (!hasSteps && !hasEvents) {
    throw new TraceApiError({
      message: 'The server returned a response with missing trace steps.',
      category: 'invalid_trace_error',
      code: 'MISSING_TRACE_STEPS',
      httpStatus: status,
      technicalDetail: `HTTP ${status} JSON lacked non-empty steps[] or events[] array.`,
    });
  }

  const resolvedMode =
    record.executionMode === 'real' || record.executionMode === 'simulated'
      ? record.executionMode
      : executionMode;
  const resolvedAdapter =
    record.adapter && typeof record.adapter === 'object'
      ? (record.adapter as LanguageAdapterMeta)
      : adapter;

  const validated = validateAndNormalizeTraceDocument(record, lineCount, {
    language,
    executionMode: resolvedMode,
    adapter: resolvedAdapter,
    note: typeof record.note === 'string' ? record.note : undefined,
    warning: typeof record.warning === 'string' ? record.warning : undefined,
  });

  if (!validated.ok) {
    throw new TraceApiError({
      message: `Invalid trace payload: ${validated.error}`,
      category: 'invalid_trace_error',
      code: 'INVALID_TRACE_SCHEMA',
      httpStatus: status,
      technicalDetail: validated.error,
    });
  }

  return validated.document;
}

class JavaScriptWorkerAdapter implements LanguageTracerAdapter {
  readonly meta: LanguageAdapterMeta = JS_ADAPTER_META;

  async trace(
    code: string,
    signal?: AbortSignal,
    options?: TraceRunOptions
  ): Promise<TraceDocument> {
    const doc = await runJavaScriptInWorker(code, {
      signal,
      timeoutMs: 5000,
      traceOptions: {
        stdin: options?.stdin,
        args: options?.args,
        language: 'js',
        adapterMeta: this.meta,
      },
    });
    const validated = validateAndNormalizeTraceDocument(doc, code.split('\n').length, {
      language: 'js',
      executionMode: 'real',
      adapter: this.meta,
    });
    if (!validated.ok) {
      throw new TraceApiError({
        message: validated.error,
        category: 'invalid_trace_error',
        code: 'INVALID_JS_TRACE',
        technicalDetail: validated.error,
      });
    }
    return validated.document;
  }
}

class TypeScriptWorkerAdapter implements LanguageTracerAdapter {
  readonly meta: LanguageAdapterMeta = TYPESCRIPT_ADAPTER_META;

  async trace(
    code: string,
    signal?: AbortSignal,
    options?: TraceRunOptions
  ): Promise<TraceDocument> {
    let transpileRes: Response;
    try {
      transpileRes = await fetch('/api/transpile-ts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ code }),
        signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      throw new TraceApiError({
        message: 'Could not reach the backend server to transpile TypeScript.',
        category: 'backend_connection_error',
        code: 'NETWORK_ERROR',
        technicalDetail: err instanceof Error ? err.message : String(err),
      });
    }

    const rawText = await transpileRes.text();
    let payload: { jsCode?: string; error?: string } = {};
    try {
      payload = JSON.parse(rawText) as { jsCode?: string; error?: string };
    } catch {
      throw new TraceApiError({
        message: `TypeScript transpiler returned an invalid response (HTTP ${transpileRes.status}).`,
        category: 'api_response_error',
        code: 'INVALID_TRANSPILE_RESPONSE',
        httpStatus: transpileRes.status,
        technicalDetail: `Expected JSON from /api/transpile-ts, received: ${rawText.slice(0, 120)}`,
      });
    }

    if (!transpileRes.ok || typeof payload.jsCode !== 'string') {
      throw new TraceApiError({
        message: payload.error || 'TypeScript syntax error: could not transpile code.',
        category: 'compiler_error',
        code: 'TS_TRANSPILE_ERROR',
        httpStatus: transpileRes.status,
        technicalDetail: payload.error || `HTTP ${transpileRes.status}`,
      });
    }

    const originalLineCount = code.split('\n').length;
    const doc = await runJavaScriptInWorker(payload.jsCode, {
      signal,
      timeoutMs: 5000,
      traceOptions: {
        stdin: options?.stdin,
        args: options?.args,
        language: 'ts',
        adapterMeta: this.meta,
        originalLineCount,
      },
    });

    const validated = validateAndNormalizeTraceDocument(doc, originalLineCount, {
      language: 'ts',
      executionMode: 'real',
      adapter: this.meta,
    });
    if (!validated.ok) {
      throw new TraceApiError({
        message: validated.error,
        category: 'invalid_trace_error',
        code: 'INVALID_TS_TRACE',
        technicalDetail: validated.error,
      });
    }
    return validated.document;
  }
}

class ServerTraceAdapter implements LanguageTracerAdapter {
  readonly meta: LanguageAdapterMeta;

  constructor(meta: LanguageAdapterMeta) {
    this.meta = meta;
  }

  async trace(
    code: string,
    signal?: AbortSignal,
    options?: TraceRunOptions
  ): Promise<TraceDocument> {
    const hasLocalServerSubset =
      this.meta.language === 'java' || this.meta.language === 'c' || this.meta.language === 'cpp';
    if (this.meta.executionMode === 'simulated' && !hasLocalServerSubset && options?.allowSimulation === false) {
      throw new TraceApiError({
        message: `Real execution is not available for ${this.meta.label}, and AI simulation is disabled in Settings.`,
        category: 'unsupported',
        code: 'SIMULATION_DISABLED',
      });
    }

    let response: Response;
    try {
      response = await fetch('/api/trace', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          lang: this.meta.language,
          code,
          stdin: options?.stdin || '',
          args: options?.args || [],
          allowSimulation: options?.allowSimulation !== false,
        }),
        signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      throw new TraceApiError({
        message: 'Could not reach the backend server to trace this program.',
        category: 'backend_connection_error',
        code: 'NETWORK_ERROR',
        technicalDetail: err instanceof Error ? err.message : String(err),
      });
    }

    const rawText = await response.text();
    const contentType = response.headers.get('content-type') || '';

    return parseTraceApiResponse({
      status: response.status,
      ok: response.ok,
      contentType,
      rawText,
      language: this.meta.language,
      executionMode: this.meta.executionMode,
      adapter: this.meta,
      lineCount: code.split('\n').length,
    });
  }
}

class UnavailableLanguageAdapter implements LanguageTracerAdapter {
  readonly meta: LanguageAdapterMeta;

  constructor(spec: LanguageCapabilitySpec) {
    this.meta = {
      id: `unavailable-${spec.id}`,
      language: spec.id,
      label: spec.name,
      executionMode: 'simulated',
      runtimeAvailable: false,
      executionMethod: spec.executionMethod,
      capabilities: {
        primitives: false,
        arrays: false,
        linkedStructures: false,
        trees: false,
        graphs: false,
        callStack: false,
        loopsAndBranches: false,
        objectIdentity: false,
        cancellation: false,
      },
      limitations: spec.limitations,
    };
  }

  async trace(): Promise<TraceDocument> {
    throw new TraceApiError({
      message: `${this.meta.label} is recognized, but visualization and execution are not available for ${this.meta.label} yet.`,
      category: 'unsupported',
      code: 'LANGUAGE_UNAVAILABLE',
    });
  }
}

const adapterMap = new Map<string, LanguageTracerAdapter>();
adapterMap.set('js', new JavaScriptWorkerAdapter());
adapterMap.set('ts', new TypeScriptWorkerAdapter());
adapterMap.set('py', new ServerTraceAdapter(PYTHON_ADAPTER_META));

for (const spec of getSelectableLanguages()) {
  if (adapterMap.has(spec.id)) continue;
  adapterMap.set(spec.id, new ServerTraceAdapter(createSimulatedAdapterMeta(spec)));
}

export function getLanguageAdapter(lang: LanguageId): LanguageTracerAdapter {
  const existing = adapterMap.get(lang);
  if (existing) return existing;
  const spec = getLanguageSpec(lang);
  if (spec) {
    return new UnavailableLanguageAdapter(spec);
  }
  throw new TraceApiError({
    message: `Unsupported or unrecognized language "${lang}". Select a supported language.`,
    category: 'unsupported',
    code: 'UNSUPPORTED_LANGUAGE',
  });
}

export function listLanguageAdapters(): LanguageAdapterMeta[] {
  return getSelectableLanguages().map((spec) => getLanguageAdapter(spec.id).meta);
}
