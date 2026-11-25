import type { LanguageId, TraceDocument } from '../types/trace';

/**
 * Clean integration contract for an external container/microVM-based execution
 * service (e.g., gVisor, Firecracker, nsjail, or rootless Docker sandbox).
 *
 * SECURITY RULE (Phase 4 §14):
 * Untrusted native compiled binaries (C, C++, Rust, Go, Java, C#, etc.) MUST NEVER
 * be executed directly on the main application server process. Instead, real execution
 * for compiled/native languages plugs in through this IsolatedExecutionService interface.
 */
export interface SandboxExecutionRequest {
  language: LanguageId;
  code: string;
  stdin?: string;
  args?: string[];
  timeoutMs: number;
  memoryLimitMb: number;
  maxTraceEvents: number;
}

export interface SandboxExecutionResponse {
  ok: boolean;
  document?: TraceDocument;
  compileError?: string;
  runtimeError?: string;
  stdout?: string;
  stderr?: string;
  durationMs: number;
}

export interface IsolatedExecutionService {
  readonly id: string;
  readonly isolationType: 'container' | 'microvm' | 'seccomp-sandbox' | 'unconfigured';
  readonly supportedLanguages: readonly LanguageId[];
  isConfigured(): boolean;
  execute(req: SandboxExecutionRequest, signal?: AbortSignal): Promise<SandboxExecutionResponse>;
}

/**
 * Default unconfigured implementation returned when no external isolated
 * execution service endpoint (`ISOLATED_SANDBOX_URL`) is configured.
 */
export class UnconfiguredIsolatedExecutionService implements IsolatedExecutionService {
  readonly id = 'external-sandbox-unconfigured';
  readonly isolationType = 'unconfigured' as const;
  readonly supportedLanguages: readonly LanguageId[] = [
    'c',
    'cpp',
    'java',
    'csharp',
    'kotlin',
    'go',
    'rust',
    'swift',
    'dart',
    'php',
    'ruby',
  ];

  isConfigured(): boolean {
    return false;
  }

  async execute(req: SandboxExecutionRequest): Promise<SandboxExecutionResponse> {
    return {
      ok: false,
      runtimeError: `Real execution for ${req.language} requires an isolated container/microVM sandbox service (not configured on this server).`,
      durationMs: 0,
    };
  }
}

export const defaultIsolatedExecutionService: IsolatedExecutionService =
  new UnconfiguredIsolatedExecutionService();
