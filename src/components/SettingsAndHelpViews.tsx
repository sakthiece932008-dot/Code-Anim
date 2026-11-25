import { memo, useMemo, useState } from 'react';
import { HelpCircle, Keyboard, Settings, Shield, Trash2 } from 'lucide-react';
import type { LanguageId } from '../types/trace';
import {
  PLAYBACK_SPEEDS,
  type PlaybackSpeedMultiplier,
  type ThemePreference,
  type UserSettings,
} from '../lib/settingsStore';
import {
  getLiveExecutionLanguages,
  getSelectableLanguages,
  getSimulatedLanguages,
  getUnavailableLanguages,
} from '../lib/languageRegistry';
import { estimateLocalStorageUsageBytes } from '../lib/projectStore';

interface SettingsViewProps {
  settings: UserSettings;
  onUpdateSettings: (patch: Partial<UserSettings>) => void;
  onResetLocalData: () => void;
  projectCount: number;
  historyCount: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export const SettingsView = memo(function SettingsView({
  settings,
  onUpdateSettings,
  onResetLocalData,
  projectCount,
  historyCount,
}: SettingsViewProps) {
  const [confirmReset, setConfirmReset] = useState(false);
  const selectableLanguages = useMemo(() => getSelectableLanguages(), []);
  const storageBytes = useMemo(
    () => estimateLocalStorageUsageBytes(),
    // Re-read estimate when project/history counts change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectCount, historyCount, settings]
  );

  const toggleRow = (
    id: string,
    label: string,
    description: string,
    checked: boolean,
    onChange: (val: boolean) => void
  ) => (
    <div className="flex items-start justify-between gap-4 py-3">
      <div>
        <label htmlFor={id} className="text-xs font-semibold block cursor-pointer">
          {label}
        </label>
        <p className="text-[11px] ca-text-muted mt-0.5">{description}</p>
      </div>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 accent-indigo-600 cursor-pointer shrink-0"
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-6 max-w-3xl pb-8">
      <div className="border-b border-[var(--ca-border)] pb-4">
        <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <Settings className="w-5 h-5 text-[var(--ca-accent)]" />
          <span>Settings & Personalization</span>
        </h2>
        <p className="text-sm ca-text-muted mt-1">
          Preferences are saved locally on this device and take effect immediately.
        </p>
      </div>

      {/* Appearance & Motion */}
      <section className="rounded-xl border ca-surface p-4 divide-y divide-[var(--ca-border)]">
        <h3 className="text-xs font-semibold uppercase tracking-wider ca-text-muted pb-2.5">
          Appearance & Accessibility
        </h3>

        <div className="flex flex-wrap items-center justify-between gap-4 py-3">
          <div>
            <label htmlFor="setting-theme" className="text-xs font-semibold block">
              Theme
            </label>
            <p className="text-[11px] ca-text-muted mt-0.5">
              Choose Dark, Light, or follow your operating system preference.
            </p>
          </div>
          <select
            id="setting-theme"
            value={settings.theme}
            onChange={(e) => onUpdateSettings({ theme: e.target.value as ThemePreference })}
            className="px-3 py-1.5 rounded-lg text-xs border ca-surface-2 focus:outline-none"
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="system">System</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 py-3">
          <div>
            <label htmlFor="setting-font-size" className="text-xs font-semibold block">
              Editor Font Size ({settings.editorFontSize}px)
            </label>
            <p className="text-[11px] ca-text-muted mt-0.5">
              Controls code editor and highlighted trace viewer readability.
            </p>
          </div>
          <input
            id="setting-font-size"
            type="range"
            min={11}
            max={20}
            value={settings.editorFontSize}
            onChange={(e) => onUpdateSettings({ editorFontSize: Number(e.target.value) })}
            className="w-40 accent-indigo-600 cursor-pointer"
          />
        </div>

        {toggleRow(
          'setting-reduced-motion',
          'Reduced Motion',
          'Disables animation transitions and step flashes for motion comfort.',
          settings.reducedMotion,
          (v) => onUpdateSettings({ reducedMotion: v })
        )}
      </section>

      {/* Execution & Learning */}
      <section className="rounded-xl border ca-surface p-4 divide-y divide-[var(--ca-border)]">
        <h3 className="text-xs font-semibold uppercase tracking-wider ca-text-muted pb-2.5">
          Execution & Learning
        </h3>

        <div className="flex flex-wrap items-center justify-between gap-4 py-3">
          <div>
            <label htmlFor="setting-default-lang" className="text-xs font-semibold block">
              Default Language
            </label>
            <p className="text-[11px] ca-text-muted mt-0.5">
              Used when starting a new blank workspace.
            </p>
          </div>
          <select
            id="setting-default-lang"
            value={settings.defaultLanguage}
            onChange={(e) => onUpdateSettings({ defaultLanguage: e.target.value as LanguageId })}
            className="px-3 py-1.5 rounded-lg text-xs border ca-surface-2 focus:outline-none"
          >
            {selectableLanguages.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.statusLabel})
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 py-3">
          <div>
            <label htmlFor="setting-default-speed" className="text-xs font-semibold block">
              Default Playback Speed
            </label>
            <p className="text-[11px] ca-text-muted mt-0.5">
              Controls how fast steps advance during automatic playback.
            </p>
          </div>
          <select
            id="setting-default-speed"
            value={settings.playbackSpeed}
            onChange={(e) =>
              onUpdateSettings({
                playbackSpeed: Number(e.target.value) as PlaybackSpeedMultiplier,
              })
            }
            className="px-3 py-1.5 rounded-lg text-xs border ca-surface-2 focus:outline-none"
          >
            {PLAYBACK_SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </select>
        </div>

        {toggleRow(
          'setting-auto-detect',
          'Automatic Language Detection',
          'Automatically detects pasted or uploaded code language and switches safely.',
          settings.autoDetectLanguage,
          (v) => onUpdateSettings({ autoDetectLanguage: v })
        )}

        {toggleRow(
          'setting-simple-explain',
          'Simple Everyday Explanations',
          'Explains each step in plain beginner-friendly language using live values.',
          settings.simpleExplanations,
          (v) => onUpdateSettings({ simpleExplanations: v })
        )}

        {toggleRow(
          'setting-ai-simulation',
          'Automatic AI Visualization & Simulation (Default On)',
          'Automatically uses server-side Gemini AI for languages without a local interpreter and for optional beginner explanations. Turn off to disable all Gemini AI requests.',
          settings.aiSimulationEnabled,
          (v) => onUpdateSettings({ aiSimulationEnabled: v })
        )}

        {toggleRow(
          'setting-ai-tutor',
          'Enable AI Programming Tutor',
          'Allows asking trace-grounded questions in the Right Panel AI Tutor tab.',
          settings.aiTutorEnabled,
          (v) => onUpdateSettings({ aiTutorEnabled: v })
        )}

        {toggleRow(
          'setting-learning-mode',
          'Interactive Learning Mode',
          'Pauses on key decisions and asks verified prediction questions as you step.',
          settings.learningModeEnabled,
          (v) => onUpdateSettings({ learningModeEnabled: v })
        )}

        {toggleRow(
          'setting-pause-important',
          'Pause on Important Events',
          'Automatically pauses playback on swaps, branches, function calls, and node links.',
          settings.pauseOnImportantEvents,
          (v) => onUpdateSettings({ pauseOnImportantEvents: v })
        )}
      </section>

      {/* Local Privacy & Storage */}
      <section className="rounded-xl border ca-surface p-4 divide-y divide-[var(--ca-border)]">
        <h3 className="text-xs font-semibold uppercase tracking-wider ca-text-muted pb-2.5">
          Local Device Storage & Privacy
        </h3>

        {toggleRow(
          'setting-history-enabled',
          'Record Execution History Locally',
          'Stores recent visualization runs in your browser so you can reopen them later.',
          settings.historyEnabled,
          (v) => onUpdateSettings({ historyEnabled: v })
        )}

        <div className="py-3 space-y-1">
          <div className="text-xs font-semibold flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-[var(--ca-accent)]" />
            <span>AI Processing & Privacy Notice</span>
          </div>
          <p className="text-[11px] ca-text-muted leading-relaxed">
            When AI Visualization or the AI Tutor is enabled, submitted source code and program input may be sent through the Code Anim server to Google Gemini to generate simulated traces or plain-English explanations. JavaScript and TypeScript run locally in your browser; saved projects and execution history stay private on this device and are never shared publicly. You can disable AI processing at any time above.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 pt-3">
          <div>
            <div className="text-xs font-semibold">Saved Device Data</div>
            <p className="text-[11px] ca-text-muted mt-0.5 tabular-nums">
              {projectCount} saved projects · {historyCount} history runs · Approx. {formatBytes(storageBytes)} used locally
            </p>
          </div>

          {!confirmReset ? (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-red-500/40 text-red-400 hover:bg-red-500/10 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Local Projects & History</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  onResetLocalData();
                  setConfirmReset(false);
                }}
                className="px-3 py-1.5 rounded-lg bg-red-600 text-white font-semibold cursor-pointer"
              >
                Confirm Clear All
              </button>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="px-3 py-1.5 rounded-lg border border-[var(--ca-border-strong)] cursor-pointer"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
});

export const HelpDocsView = memo(function HelpDocsView() {
  const live = useMemo(() => getLiveExecutionLanguages(), []);
  const sim = useMemo(() => getSimulatedLanguages(), []);
  const unavail = useMemo(() => getUnavailableLanguages(), []);

  return (
    <div className="flex flex-col gap-6 max-w-3xl pb-8">
      <div className="border-b border-[var(--ca-border)] pb-4">
        <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <HelpCircle className="w-5 h-5 text-[var(--ca-accent)]" />
          <span>Help & Documentation</span>
        </h2>
        <p className="text-sm ca-text-muted mt-1">
          Quick reference for keyboard shortcuts, execution modes, breakpoints, and privacy.
        </p>
      </div>

      {/* Keyboard Shortcuts */}
      <section className="rounded-xl border ca-surface p-4 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider ca-text-muted flex items-center gap-1.5">
          <Keyboard className="w-4 h-4 text-[var(--ca-accent)]" />
          <span>Keyboard Shortcuts</span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          {[
            ['Space', 'Play / Pause visualization'],
            ['Left / Right Arrow', 'Step backward / forward'],
            ['Home / End', 'Jump to Start / Jump to End'],
            ['Escape', 'Exit full-screen editor or canvas'],
            ['Ctrl/Cmd + F', 'Find & Replace inside Code Editor'],
            ['Ctrl/Cmd + Z / Shift+Z', 'Undo / Redo inside Code Editor'],
            ['Tab / Shift + Tab', 'Indent / Outdent in Code Editor'],
          ].map(([key, desc]) => (
            <div
              key={key}
              className="flex items-center justify-between gap-2 rounded-lg border border-[var(--ca-border)] ca-surface-2 px-3 py-2"
            >
              <span className="ca-text-muted">{desc}</span>
              <kbd className="font-mono text-[11px] px-1.5 py-0.5 rounded border border-[var(--ca-border-strong)]">
                {key}
              </kbd>
            </div>
          ))}
        </div>
      </section>

      {/* Language Execution Capabilities */}
      <section className="rounded-xl border ca-surface p-4 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider ca-text-muted">
          Language Execution Capabilities
        </h3>
        <div className="space-y-2.5 text-xs">
          <div>
            <div className="font-semibold text-emerald-400">Live Execution ({live.length})</div>
            <p className="ca-text-muted mt-0.5">
              {live.map((l) => l.name).join(', ')} — executed directly in an isolated browser worker, sandboxed Python subprocess, or built-in deterministic AST interpreter with real step-by-step tracing.
            </p>
          </div>
          <div>
            <div className="font-semibold text-sky-400">AI-Assisted Execution</div>
            <p className="ca-text-muted mt-0.5">
              Shown when verified live execution steps are paired with optional Gemini beginner explanations.
            </p>
          </div>
          <div>
            <div className="font-semibold text-amber-400">AI Simulation ({sim.length})</div>
            <p className="ca-text-muted mt-0.5">
              {sim.map((l) => l.name).join(', ')} — automatically visualized with server-side Gemini AI simulation (when AI processing is enabled in Settings) and always clearly labeled as AI Simulation.
            </p>
          </div>
          {unavail.length > 0 && (
            <div>
              <div className="font-semibold ca-text-muted">Not Available Yet ({unavail.length})</div>
              <p className="ca-text-muted mt-0.5">
                {unavail.map((l) => l.name).join(', ')} — detected cleanly when pasted or uploaded, with no fabricated execution.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Breakpoints & Privacy */}
      <section className="rounded-xl border ca-surface p-4 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider ca-text-muted flex items-center gap-1.5">
          <Shield className="w-4 h-4 text-[var(--ca-accent)]" />
          <span>Breakpoints, Exports & Privacy</span>
        </h3>
        <ul className="space-y-2 text-xs ca-text-muted list-disc list-inside leading-relaxed">
          <li>
            <strong className="text-[var(--ca-text)]">Recorded-Trace Breakpoints:</strong> Click any line number in the code viewer to place a red breakpoint dot. Playback pauses automatically whenever a recorded trace step reaches that line. Breakpoints pause trace replay rather than attaching a live OS debugger.
          </li>
          <li>
            <strong className="text-[var(--ca-text)]">Real Exports Only:</strong> Download your source code, normalized Trace JSON, SVG visual snapshot, PNG image snapshot, Step Explanation text, Execution Summary text, or a portable <code className="font-mono">.codeanim.json</code> project file.
          </li>
          <li>
            <strong className="text-[var(--ca-text)]">Local-First Privacy:</strong> Saved Projects, Settings, Learning Progress, and Execution History live only in your browser&apos;s local storage on this device. AI features (when enabled) run through the server proxy without exposing API keys in the browser.
          </li>
        </ul>
      </section>
    </div>
  );
});
