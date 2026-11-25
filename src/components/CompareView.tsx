import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  GitCompare,
  Link2,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Unlink2,
} from 'lucide-react';
import type { ExecutionSummary, LanguageId, TraceDocument } from '../types/trace';
import { COMPARISON_PRESETS } from '../lib/learningLibrary';
import { getLanguageSpec, getLiveExecutionLanguages } from '../lib/languageRegistry';
import { getLanguageAdapter } from '../lib/adapters';
import { TraceReplayEngine } from '../lib/replayEngine';
import { analyzeProgramExecution } from '../lib/programAnalyzer';
import { buildSimpleComplexityGuide, type SimpleComplexityGuide } from '../lib/complexityExplainer';
import { VisualizerCanvas } from './VisualizerCanvas';

interface SideRunResult {
  status: 'idle' | 'running' | 'ready' | 'error';
  engine: TraceReplayEngine | null;
  document: TraceDocument | null;
  summary: ExecutionSummary | null;
  complexity: SimpleComplexityGuide | null;
  error: string | null;
  stepIndex: number;
  isPlaying: boolean;
}

const EMPTY_RUN: SideRunResult = {
  status: 'idle',
  engine: null,
  document: null,
  summary: null,
  complexity: null,
  error: null,
  stepIndex: 0,
  isPlaying: false,
};

interface CompareViewProps {
  onOpenInWorkspace: (params: { name: string; lang: LanguageId; code: string; stdin: string }) => void;
}

export const CompareView = memo(function CompareView({ onOpenInWorkspace }: CompareViewProps) {
  const initial = COMPARISON_PRESETS[0];
  const liveLanguages = useMemo(() => getLiveExecutionLanguages(), []);

  const [presetId, setPresetId] = useState<string>(initial.id);
  const [sharedInput, setSharedInput] = useState<string>(initial.sharedInput);

  const [nameA, setNameA] = useState<string>(initial.programA.name);
  const [langA, setLangA] = useState<LanguageId>(initial.programA.lang);
  const [codeA, setCodeA] = useState<string>(initial.programA.code);

  const [nameB, setNameB] = useState<string>(initial.programB.name);
  const [langB, setLangB] = useState<LanguageId>(initial.programB.lang);
  const [codeB, setCodeB] = useState<string>(initial.programB.code);

  const [runA, setRunA] = useState<SideRunResult>(EMPTY_RUN);
  const [runB, setRunB] = useState<SideRunResult>(EMPTY_RUN);

  const [syncPlayback, setSyncPlayback] = useState<boolean>(false);
  const [syncPlaying, setSyncPlaying] = useState<boolean>(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const loadPreset = useCallback((id: string) => {
    const preset = COMPARISON_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    abortRef.current?.abort();
    setSyncPlaying(false);
    setPresetId(preset.id);
    setSharedInput(preset.sharedInput);
    setNameA(preset.programA.name);
    setLangA(preset.programA.lang);
    setCodeA(preset.programA.code);
    setNameB(preset.programB.name);
    setLangB(preset.programB.lang);
    setCodeB(preset.programB.code);
    setRunA(EMPTY_RUN);
    setRunB(EMPTY_RUN);
  }, []);

  const executeSide = useCallback(
    async (
      lang: LanguageId,
      code: string,
      stdin: string,
      signal: AbortSignal
    ): Promise<SideRunResult> => {
      const adapter = getLanguageAdapter(lang);
      const started = performance.now();
      try {
        const doc = await adapter.trace(code, signal, { stdin });
        if (signal.aborted) return EMPTY_RUN;
        const duration = Math.max(1, Math.round(performance.now() - started));
        const engine = new TraceReplayEngine(doc, code);
        const analysis = analyzeProgramExecution(code, doc, { measuredDurationMs: duration });
        const complexity = buildSimpleComplexityGuide(code, doc, analysis.summary);
        return {
          status: 'ready',
          engine,
          document: doc,
          summary: analysis.summary,
          complexity,
          error: null,
          stepIndex: 0,
          isPlaying: false,
        };
      } catch (err) {
        if (signal.aborted) return EMPTY_RUN;
        return {
          ...EMPTY_RUN,
          status: 'error',
          error: err instanceof Error ? err.message : 'Execution failed.',
        };
      }
    },
    []
  );

  const handleRunBoth = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setSyncPlaying(false);
    setRunA({ ...EMPTY_RUN, status: 'running' });
    setRunB({ ...EMPTY_RUN, status: 'running' });

    const [resA, resB] = await Promise.all([
      executeSide(langA, codeA, sharedInput, controller.signal),
      executeSide(langB, codeB, sharedInput, controller.signal),
    ]);
    if (controller.signal.aborted) return;
    setRunA(resA);
    setRunB(resB);
  }, [langA, codeA, langB, codeB, sharedInput, executeSide]);

  // Independent playback A
  useEffect(() => {
    if (syncPlayback || !runA.isPlaying || !runA.engine) return;
    const total = runA.engine.totalSteps;
    const id = window.setInterval(() => {
      setRunA((prev) => {
        if (prev.stepIndex >= total - 1) return { ...prev, isPlaying: false };
        return { ...prev, stepIndex: prev.stepIndex + 1 };
      });
    }, 650);
    return () => window.clearInterval(id);
  }, [syncPlayback, runA.isPlaying, runA.engine]);

  // Independent playback B
  useEffect(() => {
    if (syncPlayback || !runB.isPlaying || !runB.engine) return;
    const total = runB.engine.totalSteps;
    const id = window.setInterval(() => {
      setRunB((prev) => {
        if (prev.stepIndex >= total - 1) return { ...prev, isPlaying: false };
        return { ...prev, stepIndex: prev.stepIndex + 1 };
      });
    }, 650);
    return () => window.clearInterval(id);
  }, [syncPlayback, runB.isPlaying, runB.engine]);

  // Synchronized playback (steps both forward at same tick until both finish)
  useEffect(() => {
    if (!syncPlayback || !syncPlaying) return;
    const totalA = runA.engine?.totalSteps ?? 0;
    const totalB = runB.engine?.totalSteps ?? 0;
    if (totalA === 0 && totalB === 0) return;

    const id = window.setInterval(() => {
      let doneA = true;
      let doneB = true;
      setRunA((prev) => {
        if (!prev.engine || prev.stepIndex >= prev.engine.totalSteps - 1) return prev;
        doneA = false;
        return { ...prev, stepIndex: prev.stepIndex + 1 };
      });
      setRunB((prev) => {
        if (!prev.engine || prev.stepIndex >= prev.engine.totalSteps - 1) return prev;
        doneB = false;
        return { ...prev, stepIndex: prev.stepIndex + 1 };
      });
      if (doneA && doneB) {
        setSyncPlaying(false);
      }
    }, 650);

    return () => window.clearInterval(id);
  }, [syncPlayback, syncPlaying, runA.engine, runB.engine]);

  const handleSyncStep = (delta: number) => {
    setSyncPlaying(false);
    setRunA((prev) => {
      if (!prev.engine) return prev;
      const next = Math.min(Math.max(0, prev.stepIndex + delta), prev.engine.totalSteps - 1);
      return { ...prev, isPlaying: false, stepIndex: next };
    });
    setRunB((prev) => {
      if (!prev.engine) return prev;
      const next = Math.min(Math.max(0, prev.stepIndex + delta), prev.engine.totalSteps - 1);
      return { ...prev, isPlaying: false, stepIndex: next };
    });
  };

  const handleSyncRestart = () => {
    setSyncPlaying(false);
    setRunA((prev) => ({ ...prev, isPlaying: false, stepIndex: 0 }));
    setRunB((prev) => ({ ...prev, isPlaying: false, stepIndex: 0 }));
  };

  const bothReady = runA.status === 'ready' && runB.status === 'ready';
  const running = runA.status === 'running' || runB.status === 'running';

  const renderSidePanel = (
    label: 'A' | 'B',
    name: string,
    setName: (v: string) => void,
    lang: LanguageId,
    setLang: (v: LanguageId) => void,
    code: string,
    setCode: (v: string) => void,
    run: SideRunResult,
    setRun: React.Dispatch<React.SetStateAction<SideRunResult>>
  ) => {
    const spec = getLanguageSpec(lang);
    const total = run.engine?.totalSteps ?? 0;
    const frame = run.engine ? run.engine.getStateAt(run.stepIndex) : null;
    const prevFrame = run.engine && run.stepIndex > 0 ? run.engine.getStateAt(run.stepIndex - 1) : null;
    const lines = code.split('\n');

    return (
      <section className="rounded-xl border ca-surface flex flex-col overflow-hidden">
        <div className="px-3.5 py-2.5 border-b border-[var(--ca-border)] ca-surface-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-bold text-[var(--ca-accent)]">Program {label}</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label={`Program ${label} name`}
              className="text-xs font-medium bg-transparent border-b border-transparent focus:border-[var(--ca-accent)] focus:outline-none px-1 py-0.5 w-40"
            />
          </div>
          <div className="flex items-center gap-2">
            <select
              aria-label={`Program ${label} language`}
              value={lang}
              onChange={(e) => setLang(e.target.value as LanguageId)}
              className="px-2 py-1 rounded text-[11px] border border-[var(--ca-border-strong)] ca-surface focus:outline-none"
            >
              {liveLanguages.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => onOpenInWorkspace({ name, lang, code, stdin: sharedInput })}
              className="text-[11px] ca-text-muted hover:text-[var(--ca-text)] underline cursor-pointer"
            >
              Open in Workspace
            </button>
          </div>
        </div>

        {/* Code input / active line viewer */}
        <div className="border-b border-[var(--ca-border)]">
          {run.status === 'ready' && frame ? (
            <div className="max-h-44 overflow-auto font-mono text-[11px] leading-5 py-1.5 ca-surface-2">
              {lines.map((lineText, idx) => {
                const ln = idx + 1;
                const active = frame.line === ln;
                return (
                  <div
                    key={ln}
                    className={`flex px-2.5 ${active ? 'bg-indigo-500/20 font-semibold' : ''}`}
                  >
                    <span className="w-7 text-right pr-2.5 select-none ca-text-muted tabular-nums">
                      {ln}
                    </span>
                    <span className="whitespace-pre">{lineText || ' '}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              rows={8}
              spellCheck={false}
              aria-label={`Program ${label} source code`}
              className="w-full p-3 font-mono text-xs bg-transparent focus:outline-none resize-y"
            />
          )}
        </div>

        {/* Metrics strip when executed */}
        {run.status === 'ready' && run.complexity && run.summary && (
          <div className="px-3.5 py-2.5 border-b border-[var(--ca-border)] grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] ca-surface-2">
            <div>
              <div className="ca-text-muted">Recorded steps</div>
              <div className="font-semibold tabular-nums">{run.complexity.observedMetrics.recordedSteps}</div>
            </div>
            <div>
              <div className="ca-text-muted">Branches / Swaps</div>
              <div className="font-semibold tabular-nums">
                {run.complexity.observedMetrics.comparisonsOrBranches} / {run.complexity.observedMetrics.swaps}
              </div>
            </div>
            <div>
              <div className="ca-text-muted">Measured trace</div>
              <div className="font-semibold tabular-nums">
                {run.complexity.observedMetrics.measuredDurationMs ?? '—'} ms
              </div>
            </div>
            <div>
              <div className="ca-text-muted">Theoretical</div>
              <div className="font-semibold">
                {run.complexity.timeNotation || 'Uncertain'} · {run.complexity.spaceNotation || '—'}
              </div>
            </div>
          </div>
        )}

        {/* Independent Playback Controls */}
        {run.status === 'ready' && (
          <div className="px-3.5 py-2 border-b border-[var(--ca-border)] flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={syncPlayback || run.stepIndex <= 0}
                onClick={() =>
                  setRun((p) => ({ ...p, isPlaying: false, stepIndex: Math.max(0, p.stepIndex - 1) }))
                }
                aria-label={`Previous step Program ${label}`}
                className="p-1.5 rounded border border-[var(--ca-border-strong)] disabled:opacity-40 cursor-pointer"
              >
                <SkipBack className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={syncPlayback}
                onClick={() =>
                  setRun((p) => ({
                    ...p,
                    stepIndex: p.stepIndex >= total - 1 ? 0 : p.stepIndex,
                    isPlaying: !p.isPlaying,
                  }))
                }
                aria-label={`${run.isPlaying ? 'Pause' : 'Play'} Program ${label}`}
                className="p-1.5 rounded bg-indigo-600 text-white disabled:opacity-40 cursor-pointer"
              >
                {run.isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </button>
              <button
                type="button"
                disabled={syncPlayback || run.stepIndex >= total - 1}
                onClick={() =>
                  setRun((p) => ({
                    ...p,
                    isPlaying: false,
                    stepIndex: Math.min(total - 1, p.stepIndex + 1),
                  }))
                }
                aria-label={`Next step Program ${label}`}
                className="p-1.5 rounded border border-[var(--ca-border-strong)] disabled:opacity-40 cursor-pointer"
              >
                <SkipForward className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={syncPlayback}
                onClick={() => setRun((p) => ({ ...p, isPlaying: false, stepIndex: 0 }))}
                aria-label={`Restart Program ${label}`}
                className="p-1.5 rounded border border-[var(--ca-border-strong)] disabled:opacity-40 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
            <span className="text-[11px] ca-text-muted tabular-nums">
              Step {run.stepIndex + 1} / {total}
            </span>
          </div>
        )}

        {/* Visualization area */}
        <div className="p-2 min-h-[260px]">
          {run.status === 'idle' && (
            <div className="h-56 flex items-center justify-center text-xs ca-text-muted text-center px-4">
              Click <strong>Run Both Programs</strong> above to trace and compare live execution.
            </div>
          )}
          {run.status === 'running' && (
            <div className="h-56 flex items-center justify-center gap-2 text-xs ca-text-muted">
              <Loader2 className="w-4 h-4 animate-spin text-[var(--ca-accent)]" />
              <span>Tracing {name}…</span>
            </div>
          )}
          {run.status === 'error' && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{run.error}</span>
            </div>
          )}
          {run.status === 'ready' && frame && (
            <div className="space-y-2">
              <VisualizerCanvas
                appState="VISUALIZER"
                languageLabel={spec?.name || lang}
                sourceCode={code}
                frame={frame}
                prevFrame={prevFrame}
                errorMessage={null}
                errorHelp={null}
                traceWarning={run.document?.warning || null}
                onSelectExample={() => {}}
                onApplySuggestedFix={() => {}}
                onRetryVisualize={() => void handleRunBoth()}
                onCancelTrace={() => {}}
                onBackToEditor={() => setRun(EMPTY_RUN)}
                compactMode
              />
              {run.summary?.finalOutput && (
                <div className="rounded-lg border border-[var(--ca-border)] ca-surface-2 px-3 py-1.5 text-[11px] font-mono">
                  <span className="ca-text-muted">Output: </span>
                  <span className="text-emerald-400">{run.summary.finalOutput}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    );
  };

  return (
    <div className="flex flex-col gap-4 pb-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--ca-border)] pb-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <GitCompare className="w-5 h-5 text-[var(--ca-accent)]" />
            <span>Compare Algorithms</span>
          </h2>
          <p className="text-sm ca-text-muted mt-1 max-w-2xl">
            Run two programs side by side on the same input and inspect their real recorded steps, operations, and theoretical growth rates.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Comparison preset"
            value={presetId}
            onChange={(e) => loadPreset(e.target.value)}
            className="px-3 py-1.5 rounded-lg text-xs border ca-surface-2 focus:outline-none"
          >
            {COMPARISON_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={running}
            onClick={() => void handleRunBoth()}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 cursor-pointer"
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            <span>{running ? 'Running Both…' : 'Run Both Programs'}</span>
          </button>
        </div>
      </div>

      {/* Shared Input + Optional Synchronized Playback Bar */}
      <div className="rounded-xl border ca-surface p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[220px]">
          <label htmlFor="compare-shared-input" className="text-xs font-medium whitespace-nowrap">
            Shared Input (stdin):
          </label>
          <input
            id="compare-shared-input"
            type="text"
            value={sharedInput}
            onChange={(e) => setSharedInput(e.target.value)}
            placeholder="e.g. 6 2 8 1 5"
            className="flex-1 px-2.5 py-1.5 rounded-lg text-xs font-mono border ca-surface-2 focus:outline-none"
          />
        </div>

        {bothReady && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSyncPlaying(false);
                setRunA((p) => ({ ...p, isPlaying: false }));
                setRunB((p) => ({ ...p, isPlaying: false }));
                setSyncPlayback((v) => !v);
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border cursor-pointer ${
                syncPlayback
                  ? 'border-[var(--ca-accent)] bg-[var(--ca-accent-soft)] text-[var(--ca-accent)]'
                  : 'border-[var(--ca-border-strong)] ca-text-muted'
              }`}
            >
              {syncPlayback ? <Link2 className="w-3.5 h-3.5" /> : <Unlink2 className="w-3.5 h-3.5" />}
              <span>{syncPlayback ? 'Synced Playback: On' : 'Synced Playback: Off'}</span>
            </button>

            {syncPlayback && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleSyncStep(-1)}
                  className="p-1.5 rounded border border-[var(--ca-border-strong)] cursor-pointer"
                  aria-label="Step both back"
                >
                  <SkipBack className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setSyncPlaying((v) => !v)}
                  className="p-1.5 rounded bg-indigo-600 text-white cursor-pointer"
                  aria-label={syncPlaying ? 'Pause both' : 'Play both'}
                >
                  {syncPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => handleSyncStep(1)}
                  className="p-1.5 rounded border border-[var(--ca-border-strong)] cursor-pointer"
                  aria-label="Step both forward"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleSyncRestart}
                  className="p-1.5 rounded border border-[var(--ca-border-strong)] cursor-pointer"
                  aria-label="Restart both"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Honest disclaimer */}
      <p className="text-[11px] ca-text-muted px-1">
        Note: One recorded trace step in Program A is not always equivalent to one trace step in Program B, especially across different implementations or languages. Compare observed operation counts separately from theoretical Big-O complexity.
      </p>

      {/* Side-by-side panels */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {renderSidePanel('A', nameA, setNameA, langA, setLangA, codeA, setCodeA, runA, setRunA)}
        {renderSidePanel('B', nameB, setNameB, langB, setLangB, codeB, setCodeB, runB, setRunB)}
      </div>
    </div>
  );
});
