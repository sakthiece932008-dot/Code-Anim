import { memo, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronFirst,
  ChevronLast,
  ChevronUp,
  CircleDot,
  GraduationCap,
  Keyboard,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Sparkles,
  Terminal,
} from 'lucide-react';
import type { AppState, TraceEvent } from '../types/trace';
import type { ReconstructedFrame } from '../lib/replayEngine';
import { PLAYBACK_SPEEDS, type PlaybackSpeedMultiplier } from '../lib/settingsStore';

export interface ImportantTimelineEvent {
  stepIndex: number;
  line: number;
  label: string;
  kind: 'swap' | 'call' | 'return' | 'node' | 'error' | 'change' | 'branch';
}

export function extractImportantTimelineEvents(events: readonly TraceEvent[]): ImportantTimelineEvent[] {
  const markers: ImportantTimelineEvent[] = [];
  events.forEach((ev, idx) => {
    if (ev.type === 'error') {
      markers.push({ stepIndex: idx, line: ev.line, label: `Error (L${ev.line})`, kind: 'error' });
    } else if (ev.type === 'array_swap') {
      markers.push({ stepIndex: idx, line: ev.line, label: `Swap (L${ev.line})`, kind: 'swap' });
    } else if (ev.type === 'function_call') {
      markers.push({ stepIndex: idx, line: ev.line, label: `Call ${ev.functionName}()`, kind: 'call' });
    } else if (ev.type === 'function_return') {
      markers.push({ stepIndex: idx, line: ev.line, label: `Return ${ev.functionName}()`, kind: 'return' });
    } else if (ev.type === 'tree_insert' || ev.type === 'node_create' || ev.type === 'node_delete' || ev.type === 'reference_update') {
      markers.push({ stepIndex: idx, line: ev.line, label: `Link/Node (L${ev.line})`, kind: 'node' });
    } else if (ev.type === 'branch_decision') {
      markers.push({
        stepIndex: idx,
        line: ev.line,
        label: `Check ${ev.metadata.taken ? 'true' : 'false'} (L${ev.line})`,
        kind: 'branch',
      });
    } else if (ev.type === 'array_append' || ev.type === 'array_remove') {
      markers.push({ stepIndex: idx, line: ev.line, label: `List change (L${ev.line})`, kind: 'change' });
    }
  });
  return markers;
}

interface BottomDockProps {
  appState: AppState;
  totalSteps: number;
  currentStepIndex: number;
  events: readonly TraceEvent[];
  frame: ReconstructedFrame | null;
  isPlaying: boolean;
  speedMultiplier: PlaybackSpeedMultiplier;
  pauseOnImportantEvents: boolean;
  learningModeEnabled: boolean;
  breakpoints: number[];
  stdinText: string;
  cliArgsText: string;
  drawerOpen: boolean;
  drawerTab: 'console' | 'input';
  onDrawerOpenChange: (open: boolean) => void;
  onDrawerTabChange: (tab: 'console' | 'input') => void;
  onStdinChange: (val: string) => void;
  onCliArgsChange: (val: string) => void;
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onJumpStart: () => void;
  onJumpEnd: () => void;
  onRestart: () => void;
  onNextBreakpoint: () => void;
  onSeek: (index: number) => void;
  onSpeedChange: (speed: PlaybackSpeedMultiplier) => void;
  onTogglePauseOnImportant: () => void;
  onToggleLearningMode: () => void;
}

const MARKER_COLOR: Record<ImportantTimelineEvent['kind'], string> = {
  error: 'bg-red-500',
  swap: 'bg-sky-400',
  call: 'bg-indigo-400',
  return: 'bg-emerald-400',
  node: 'bg-violet-400',
  branch: 'bg-amber-400',
  change: 'bg-teal-400',
};

export const BottomDock = memo(function BottomDock({
  appState,
  totalSteps,
  currentStepIndex,
  events,
  frame,
  isPlaying,
  speedMultiplier,
  pauseOnImportantEvents,
  learningModeEnabled,
  breakpoints,
  stdinText,
  cliArgsText,
  drawerOpen,
  drawerTab,
  onDrawerOpenChange,
  onDrawerTabChange,
  onStdinChange,
  onCliArgsChange,
  onPlay,
  onPause,
  onNext,
  onPrev,
  onJumpStart,
  onJumpEnd,
  onRestart,
  onNextBreakpoint,
  onSeek,
  onSpeedChange,
  onTogglePauseOnImportant,
  onToggleLearningMode,
}: BottomDockProps) {
  const [showEventChips, setShowEventChips] = useState(false);

  const isVisualizer = appState === 'VISUALIZER' && totalSteps > 0 && frame !== null;
  const canPrev = isVisualizer && currentStepIndex > 0;
  const canNext = isVisualizer && currentStepIndex < totalSteps - 1;

  const importantEvents = useMemo(
    () => (isVisualizer ? extractImportantTimelineEvents(events) : []),
    [isVisualizer, events]
  );

  return (
    <section
      aria-label="Playback Controls, Timeline, Program Input, and Console Output"
      className="rounded-xl border ca-surface overflow-hidden flex flex-col"
    >
      {/* Main Playback Controls Bar */}
      <div className="px-3 py-2.5 flex flex-wrap items-center gap-2">
        {/* Transport buttons */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onJumpStart}
            disabled={!canPrev}
            aria-label="Jump to beginning"
            title="Jump to beginning (Home)"
            className="p-2 rounded-lg border border-slate-700/70 hover:bg-slate-500/15 disabled:opacity-35 cursor-pointer"
          >
            <ChevronFirst className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onPrev}
            disabled={!canPrev}
            aria-label="Previous step"
            title="Previous step (Left Arrow)"
            className="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs font-medium border border-slate-700/70 hover:bg-slate-500/15 disabled:opacity-35 cursor-pointer"
          >
            <SkipBack className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Prev</span>
          </button>

          {isPlaying ? (
            <button
              type="button"
              onClick={onPause}
              disabled={!isVisualizer}
              aria-label="Pause playback"
              title="Pause (Space)"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 cursor-pointer"
            >
              <Pause className="w-3.5 h-3.5" />
              <span>Pause</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onPlay}
              disabled={!isVisualizer}
              aria-label="Play execution"
              title="Play (Space)"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-35 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Play</span>
            </button>
          )}

          <button
            type="button"
            onClick={onNext}
            disabled={!canNext}
            aria-label="Next step"
            title="Next step (Right Arrow)"
            className="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs font-medium border border-slate-700/70 hover:bg-slate-500/15 disabled:opacity-35 cursor-pointer"
          >
            <span className="hidden sm:inline">Next</span>
            <SkipForward className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onJumpEnd}
            disabled={!canNext}
            aria-label="Jump to end"
            title="Jump to end (End)"
            className="p-2 rounded-lg border border-slate-700/70 hover:bg-slate-500/15 disabled:opacity-35 cursor-pointer"
          >
            <ChevronLast className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onRestart}
            disabled={!isVisualizer}
            aria-label="Restart playback"
            title="Restart from step 1"
            className="p-2 rounded-lg border border-slate-700/70 hover:bg-slate-500/15 disabled:opacity-35 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {breakpoints.length > 0 && (
            <button
              type="button"
              onClick={onNextBreakpoint}
              disabled={!isVisualizer}
              title="Step to next recorded-trace breakpoint"
              aria-label="Step to next recorded-trace breakpoint"
              className="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs font-medium border border-rose-500/50 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 disabled:opacity-35 cursor-pointer"
            >
              <CircleDot className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Next BP</span>
            </button>
          )}
        </div>

        {/* Interactive Scrubber Timeline with Important Event Markers */}
        <div className="flex-1 min-w-[180px] flex flex-col gap-1 px-1">
          <div className="flex items-center gap-2.5">
            <div className="relative flex-1 flex items-center">
              <input
                type="range"
                aria-label="Execution step timeline"
                min={0}
                max={Math.max(0, totalSteps - 1)}
                value={isVisualizer ? currentStepIndex : 0}
                disabled={!isVisualizer}
                onChange={(e) => onSeek(Number(e.target.value))}
                className="w-full accent-indigo-500 cursor-pointer disabled:opacity-40"
              />
            </div>
            <span className="font-mono text-xs tabular-nums whitespace-nowrap shrink-0">
              {isVisualizer ? `${currentStepIndex + 1} / ${totalSteps}` : '0 / 0'}
            </span>
          </div>

          {/* Clickable event tick rail */}
          {isVisualizer && importantEvents.length > 0 && (
            <div className="relative h-2.5 w-full" aria-label="Important execution events on timeline">
              {importantEvents.slice(0, 60).map((ev) => {
                const pct = totalSteps > 1 ? (ev.stepIndex / (totalSteps - 1)) * 100 : 0;
                return (
                  <button
                    key={`${ev.stepIndex}-${ev.kind}`}
                    type="button"
                    onClick={() => onSeek(ev.stepIndex)}
                    title={`Step ${ev.stepIndex + 1}: ${ev.label}`}
                    aria-label={`Jump to step ${ev.stepIndex + 1}: ${ev.label}`}
                    style={{ left: `${pct}%` }}
                    className={`absolute top-0.5 -translate-x-1/2 w-1.5 h-1.5 rounded-full ${MARKER_COLOR[ev.kind]} hover:scale-150 transition-transform cursor-pointer`}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Speed & Mode Controls */}
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <select
            aria-label="Playback speed"
            value={speedMultiplier}
            onChange={(e) => onSpeedChange(Number(e.target.value) as PlaybackSpeedMultiplier)}
            className="px-2 py-1.5 rounded-lg text-xs font-mono border border-slate-700/70 ca-surface-2 cursor-pointer"
          >
            {PLAYBACK_SPEEDS.map((spd) => (
              <option key={spd} value={spd}>
                {spd}x
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={onTogglePauseOnImportant}
            aria-pressed={pauseOnImportantEvents}
            title="Automatically pause playback on swaps, calls, returns, node changes, or errors"
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border cursor-pointer ${
              pauseOnImportantEvents
                ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                : 'border-slate-700/70 ca-text-muted hover:bg-slate-500/10'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">Key Stops</span>
          </button>

          <button
            type="button"
            onClick={onToggleLearningMode}
            aria-pressed={learningModeEnabled}
            title="Interactive Learning Mode: pause and predict upcoming verified outcomes"
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border cursor-pointer ${
              learningModeEnabled
                ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-300'
                : 'border-slate-700/70 ca-text-muted hover:bg-slate-500/10'
            }`}
          >
            <GraduationCap className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">Learn Mode</span>
          </button>

          {isVisualizer && importantEvents.length > 0 && (
            <button
              type="button"
              onClick={() => setShowEventChips((v) => !v)}
              className="px-2 py-1.5 rounded-lg text-xs border border-slate-700/70 ca-text-muted hover:bg-slate-500/10 cursor-pointer"
            >
              Events ({importantEvents.length})
            </button>
          )}
        </div>
      </div>

      {/* Expandable Key Events Jump Strip */}
      {showEventChips && isVisualizer && importantEvents.length > 0 && (
        <div className="px-3 py-2 border-t ca-surface-2 flex items-center gap-1.5 overflow-x-auto text-[11px]">
          <span className="ca-text-muted shrink-0">Jump to event:</span>
          {importantEvents.slice(0, 30).map((ev) => (
            <button
              key={`${ev.stepIndex}-${ev.label}`}
              type="button"
              onClick={() => onSeek(ev.stepIndex)}
              className={`px-2 py-1 rounded border font-mono whitespace-nowrap shrink-0 cursor-pointer ${
                ev.stepIndex === currentStepIndex
                  ? 'border-indigo-400 bg-indigo-600 text-white'
                  : 'border-slate-700/70 hover:bg-slate-500/15'
              }`}
            >
              #{ev.stepIndex + 1} {ev.label}
            </button>
          ))}
        </div>
      )}

      {/* Collapsible Console Output & Program Input Drawer Header */}
      <div className="px-3 py-1.5 border-t ca-surface-2 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              onDrawerTabChange('console');
              onDrawerOpenChange(true);
            }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium cursor-pointer ${
              drawerOpen && drawerTab === 'console'
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'ca-text-muted hover:bg-slate-500/10'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Console Output</span>
            {isVisualizer && frame.print && (
              <span className="text-[11px] text-emerald-400">· new output</span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              onDrawerTabChange('input');
              onDrawerOpenChange(true);
            }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium cursor-pointer ${
              drawerOpen && drawerTab === 'input'
                ? 'bg-sky-500/15 text-sky-400'
                : 'ca-text-muted hover:bg-slate-500/10'
            }`}
          >
            <Keyboard className="w-3.5 h-3.5" />
            <span>Program Input{stdinText.trim() ? ' (Set)' : ''}</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => onDrawerOpenChange(!drawerOpen)}
          aria-label={drawerOpen ? 'Collapse bottom drawer' : 'Expand bottom drawer'}
          className="inline-flex items-center gap-1 px-2 py-1 rounded ca-text-muted hover:bg-slate-500/10 cursor-pointer"
        >
          {drawerOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          <span>{drawerOpen ? 'Hide' : 'Show'}</span>
        </button>
      </div>

      {/* Bottom Drawer Content */}
      {drawerOpen && (
        <div className="px-3 py-2.5 border-t border-slate-700/50">
          {drawerTab === 'console' ? (
            <pre
              aria-label="Console output"
              className="font-mono text-xs ca-surface-2 rounded-lg border p-2.5 max-h-28 overflow-auto whitespace-pre-wrap break-words m-0"
            >
              {isVisualizer && frame.outText
                ? frame.outText
                : isVisualizer
                  ? 'No console output printed yet.'
                  : 'Program print / console output appears here after running Visualize.'}
            </pre>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-2.5">
              <div className="flex flex-col gap-1">
                <label htmlFor="program-stdin" className="text-[11px] font-medium text-sky-400">
                  Standard Input (stdin — one line per input() / readLine() call)
                </label>
                <textarea
                  id="program-stdin"
                  rows={2}
                  value={stdinText}
                  onChange={(e) => onStdinChange(e.target.value)}
                  placeholder="Example: 8 3 9 1 5 (or separate lines for multiple inputs)"
                  className="w-full rounded-lg border border-slate-700/70 ca-surface-2 px-2.5 py-1.5 font-mono text-xs"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="program-args" className="text-[11px] font-medium ca-text-muted">
                  Optional CLI Args (space-separated)
                </label>
                <input
                  id="program-args"
                  type="text"
                  value={cliArgsText}
                  onChange={(e) => onCliArgsChange(e.target.value)}
                  placeholder="e.g. --mode fast 42"
                  className="w-full rounded-lg border border-slate-700/70 ca-surface-2 px-2.5 py-1.5 font-mono text-xs"
                />
                <span className="text-[11px] ca-text-muted">
                  Updating input preserves your source code.
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
});
