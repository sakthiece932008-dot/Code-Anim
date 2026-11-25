import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Code2,
  Cpu,
  FolderOpen,
  GitCompare,
  HelpCircle,
  History,
  Loader2,
  Menu,
  Moon,
  Play,
  Save,
  Settings,
  Sparkles,
  Sun,
  Upload,
  X,
} from 'lucide-react';
import type {
  AppState,
  ErrorHelpReport,
  ExecutionMode,
  ExecutionSummary,
  LanguageId,
  TraceDocument,
} from './types/trace';
import {
  getLanguageSpec,
  getLiveExecutionLanguages,
  getSimulatedLanguages,
  getUnavailableLanguages,
  isLanguageSelectable,
} from './lib/languageRegistry';
import {
  detectLanguageFromCode,
  type LanguageDetectionResult,
} from './lib/languageDetector';
import { getLanguageAdapter, TraceApiError } from './lib/adapters';
import { TraceReplayEngine } from './lib/replayEngine';
import { analyzeProgramExecution } from './lib/programAnalyzer';
import { buildDeterministicErrorHelp, type CodeExample } from './lib/explain';
import {
  applyThemeAndMotionToDocument,
  loadSettings,
  saveSettings,
  speedMultiplierToIntervalMs,
  type PlaybackSpeedMultiplier,
  type UserSettings,
} from './lib/settingsStore';
import {
  clearAllLocalData,
  createHistoryEntry,
  createSavedProject,
  duplicateSavedProject,
  loadExecutionHistory,
  loadProjects,
  persistExecutionHistory,
  persistProjects,
  type ExecutionHistoryEntry,
  type SavedProject,
} from './lib/projectStore';
import { buildSimpleComplexityGuide } from './lib/complexityExplainer';
import {
  generateLearningQuestions,
  loadLearningProgress,
  saveLearningProgress,
  type LearningProgress,
} from './lib/learningMode';
import { validateImportedCodeAnimFile } from './lib/exportImport';
import type { LearningExample } from './lib/learningLibrary';
import {
  validateVisualScene,
  type UniversalVisualScene,
} from './lib/universalVisualEngine';
import { CodePane } from './components/CodePane';
import {
  WorkspaceRightPanel,
  type UtilityDrawerKind,
  type WorkspaceTab,
} from './components/WorkspaceRightPanel';
import { BottomDock, extractImportantTimelineEvents } from './components/BottomDock';
import { LearnLibraryView } from './components/LearnLibraryView';
import { CompareView } from './components/CompareView';
import {
  ExecutionHistoryView,
  MyProjectsView,
} from './components/ProjectsAndHistoryViews';
import { HelpDocsView, SettingsView } from './components/SettingsAndHelpViews';

type NavSection =
  | 'workspace'
  | 'projects'
  | 'history'
  | 'learn'
  | 'compare'
  | 'settings'
  | 'help';

const NAV_ITEMS: Array<{
  id: NavSection;
  label: string;
  shortLabel: string;
  icon: typeof Code2;
}> = [
  { id: 'workspace', label: 'Workspace', shortLabel: 'Workspace', icon: Code2 },
  { id: 'projects', label: 'My Projects', shortLabel: 'Projects', icon: FolderOpen },
  { id: 'history', label: 'Execution History', shortLabel: 'History', icon: History },
  { id: 'learn', label: 'Learn', shortLabel: 'Learn', icon: BookOpen },
  { id: 'compare', label: 'Compare', shortLabel: 'Compare', icon: GitCompare },
  { id: 'settings', label: 'Settings', shortLabel: 'Settings', icon: Settings },
  { id: 'help', label: 'Help & Docs', shortLabel: 'Help', icon: HelpCircle },
];

export default function App() {
  // Persistent Settings, Projects, Execution History, and Learning Progress
  const initialSettingsLoad = useMemo(() => loadSettings(), []);
  const initialProjectsLoad = useMemo(() => loadProjects(), []);
  const initialHistoryLoad = useMemo(() => loadExecutionHistory(), []);

  const [settings, setSettings] = useState<UserSettings>(initialSettingsLoad.settings);
  const [effectiveTheme, setEffectiveTheme] = useState<'dark' | 'light'>(() =>
    applyThemeAndMotionToDocument(initialSettingsLoad.settings)
  );
  const [projects, setProjects] = useState<SavedProject[]>(initialProjectsLoad.projects);
  const [historyEntries, setHistoryEntries] = useState<ExecutionHistoryEntry[]>(
    initialHistoryLoad.entries
  );
  const [learningProgress, setLearningProgress] = useState<LearningProgress>(() =>
    loadLearningProgress()
  );
  const [storageNotice, setStorageNotice] = useState<string | null>(() => {
    const recovered: string[] = [];
    if (initialSettingsLoad.recoveredFromCorruption) recovered.push('settings');
    if (initialProjectsLoad.recoveredFromCorruption) recovered.push('saved projects');
    if (initialHistoryLoad.recoveredFromCorruption) recovered.push('execution history');
    return recovered.length > 0
      ? `Recovered safely from corrupted local storage (${recovered.join(', ')}).`
      : null;
  });

  // Navigation & layout state
  const [activeNav, setActiveNav] = useState<NavSection>('workspace');
  const [navCollapsed, setNavCollapsed] = useState<boolean>(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

  const [fullscreenPane, setFullscreenPane] = useState<'none' | 'code' | 'canvas'>('none');
  const [leftPct, setLeftPct] = useState<number>(40);

  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('animation');
  const [utilityDrawer, setUtilityDrawer] = useState<UtilityDrawerKind>('none');
  const [pendingTutorPrompt, setPendingTutorPrompt] = useState<string | null>(null);

  // Active project / workspace state
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string>('Untitled Workspace');

  const [appState, setAppState] = useState<AppState>('EDITOR');
  const [language, setLanguage] = useState<LanguageId>(initialSettingsLoad.settings.defaultLanguage);
  const [code, setCode] = useState<string>('');
  const [stdinText, setStdinText] = useState<string>('');
  const [cliArgsText, setCliArgsText] = useState<string>('');

  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [drawerTab, setDrawerTab] = useState<'console' | 'input'>('console');

  // Execution & replay state
  const [traceDocument, setTraceDocument] = useState<TraceDocument | null>(null);
  const [replayEngine, setReplayEngine] = useState<TraceReplayEngine | null>(null);
  const [executionSummary, setExecutionSummary] = useState<ExecutionSummary | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('real');
  const [aiAssistedExecution, setAiAssistedExecution] = useState<boolean>(false);
  const [aiVisualScene, setAiVisualScene] = useState<UniversalVisualScene | null>(null);

  // Breakpoints (recorded-trace line numbers) & Interactive Learning checkpoints
  const [breakpoints, setBreakpoints] = useState<number[]>([]);
  const [dismissedQuestionIds, setDismissedQuestionIds] = useState<Set<string>>(() => new Set());

  // Error & fix state
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorHelp, setErrorHelp] = useState<ErrorHelpReport | null>(null);
  const [errorHelpLoading, setErrorHelpLoading] = useState<boolean>(false);
  const [undoCodeSnapshot, setUndoCodeSnapshot] = useState<string | null>(null);
  const [traceWarning, setTraceWarning] = useState<string | null>(null);

  // Language detection & explicit AI simulation confirmation
  const [detectionNotice, setDetectionNotice] = useState<{
    kind: 'confirm' | 'unavailable' | 'auto';
    result: LanguageDetectionResult;
    message: string;
  } | null>(null);
  const [pendingSimulationConfirm, setPendingSimulationConfirm] = useState<{
    lang: LanguageId;
    langName: string;
    code: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const workspaceGridRef = useRef<HTMLDivElement | null>(null);
  const activeRequestIdRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const detectTimerRef = useRef<number | null>(null);

  const liveLanguages = useMemo(() => getLiveExecutionLanguages(), []);
  const simulatedLanguages = useMemo(() => getSimulatedLanguages(), []);
  const unavailableLanguages = useMemo(() => getUnavailableLanguages(), []);

  const selectedSpec = useMemo(
    () => getLanguageSpec(language) || liveLanguages[0],
    [language, liveLanguages]
  );

  const totalSteps = replayEngine?.totalSteps ?? 0;
  const codeLines = useMemo(() => code.split('\n'), [code]);

  const importantEvents = useMemo(
    () => (traceDocument ? extractImportantTimelineEvents(traceDocument.events) : []),
    [traceDocument]
  );
  const importantStepSet = useMemo(
    () => new Set(importantEvents.map((e) => e.stepIndex)),
    [importantEvents]
  );

  const learningQuestions = useMemo(() => {
    if (!traceDocument) return [];
    return generateLearningQuestions(traceDocument, codeLines);
  }, [traceDocument, codeLines]);

  const activeLearningQuestion = useMemo(() => {
    if (!settings.learningModeEnabled || appState !== 'VISUALIZER') return null;
    const match = learningQuestions.find(
      (q) => q.pauseAtStepIndex === currentStepIndex && !dismissedQuestionIds.has(q.id)
    );
    return match || null;
  }, [settings.learningModeEnabled, appState, learningQuestions, currentStepIndex, dismissedQuestionIds]);

  const complexityGuide = useMemo(() => {
    if (!traceDocument || !executionSummary) return null;
    return buildSimpleComplexityGuide(code, traceDocument, executionSummary);
  }, [code, traceDocument, executionSummary]);

  // Apply theme & reduced motion to <html> + watch system preference if 'system'
  useEffect(() => {
    const applied = applyThemeAndMotionToDocument(settings);
    setEffectiveTheme(applied);

    if (settings.theme !== 'system' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      setEffectiveTheme(applyThemeAndMotionToDocument(settings));
    };
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [settings]);

  const updateSettings = useCallback((patch: Partial<UserSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      const res = saveSettings(next);
      if (!res.ok && res.error) setStorageNotice(res.error);
      return next;
    });
  }, []);

  const stopPlayback = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const cancelInFlightTrace = useCallback(() => {
    activeRequestIdRef.current += 1;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      if (detectTimerRef.current) window.clearTimeout(detectTimerRef.current);
    };
  }, []);

  // Playback loop with Breakpoint, Important Event, and Learning Mode checkpoint pausing
  useEffect(() => {
    if (!isPlaying || appState !== 'VISUALIZER' || totalSteps === 0 || !replayEngine) {
      return;
    }
    const intervalMs = speedMultiplierToIntervalMs(settings.playbackSpeed);
    const bpSet = new Set(breakpoints);

    const id = window.setInterval(() => {
      setCurrentStepIndex((prev) => {
        if (prev >= totalSteps - 1) {
          setIsPlaying(false);
          return prev;
        }
        const next = prev + 1;
        const nextFrame = replayEngine.getStateAt(next);

        // Pause if recorded-trace breakpoint hit
        if (nextFrame && bpSet.has(nextFrame.line)) {
          setIsPlaying(false);
          setStatusMessage(`Paused at recorded-trace breakpoint on Line ${nextFrame.line}.`);
        } else if (settings.pauseOnImportantEvents && importantStepSet.has(next)) {
          setIsPlaying(false);
          setStatusMessage(`Paused on important event at step ${next + 1}.`);
        } else if (
          settings.learningModeEnabled &&
          learningQuestions.some(
            (q) => q.pauseAtStepIndex === next && !dismissedQuestionIds.has(q.id)
          )
        ) {
          setIsPlaying(false);
          setWorkspaceTab('explanation');
          setStatusMessage('Interactive Learning checkpoint — make a prediction before continuing.');
        }

        if (next >= totalSteps - 1) {
          setIsPlaying(false);
        }
        return next;
      });
    }, intervalMs);

    return () => window.clearInterval(id);
  }, [
    isPlaying,
    appState,
    totalSteps,
    replayEngine,
    settings.playbackSpeed,
    settings.pauseOnImportantEvents,
    settings.learningModeEnabled,
    breakpoints,
    importantStepSet,
    learningQuestions,
    dismissedQuestionIds,
  ]);

  // Language auto-detection helper
  const applyLanguageDetection = useCallback(
    (source: string, currentLang: LanguageId, filename?: string) => {
      if (!settings.autoDetectLanguage || !source.trim()) {
        setDetectionNotice(null);
        return;
      }
      const res = detectLanguageFromCode(source, filename);
      if (!res.languageId || !res.spec) {
        setDetectionNotice(null);
        return;
      }

      if (!isLanguageSelectable(res.languageId)) {
        if (res.confidence === 'high' || res.confidence === 'medium') {
          setDetectionNotice({
            kind: 'unavailable',
            result: res,
            message: `Detected ${res.spec.name} (${res.spec.statusLabel}). Visualization is not available for ${res.spec.name} yet.`,
          });
        }
        return;
      }

      if (res.languageId === currentLang) {
        if (res.extensionMismatch) {
          setDetectionNotice({ kind: 'auto', result: res, message: res.reason });
        } else {
          setDetectionNotice(null);
        }
        return;
      }

      if (res.confidence === 'high') {
        setLanguage(res.languageId);
        setExecutionMode(res.spec.realExecutionSupported ? 'real' : 'simulated');
        setPendingSimulationConfirm(null);
        setDetectionNotice({
          kind: 'auto',
          result: res,
          message: res.extensionMismatch
            ? res.reason
            : `${res.spec.name} code detected. Language changed automatically.`,
        });
      } else if (res.confidence === 'medium') {
        setDetectionNotice({
          kind: 'confirm',
          result: res,
          message: `This code looks like ${res.spec.name} (${res.spec.statusLabel}). Switch language?`,
        });
      }
    },
    [settings.autoDetectLanguage]
  );

  // Record run in local Execution History
  const appendHistory = useCallback(
    (entry: Omit<ExecutionHistoryEntry, 'id' | 'executedAt'>) => {
      if (!settings.historyEnabled) return;
      const nextEntry = createHistoryEntry(entry);
      setHistoryEntries((prev) => {
        const next = [nextEntry, ...prev];
        const res = persistExecutionHistory(next);
        if (!res.ok && res.error) setStorageNotice(res.error);
        return next;
      });
    },
    [settings.historyEnabled]
  );

  const handleEditCode = useCallback(() => {
    stopPlayback();
    cancelInFlightTrace();
    setErrorMessage(null);
    setErrorHelp(null);
    setPendingSimulationConfirm(null);
    setAppState('EDITOR');
  }, [stopPlayback, cancelInFlightTrace]);

  const handleCancelTrace = useCallback(() => {
    stopPlayback();
    cancelInFlightTrace();
    setStatusMessage('Trace canceled.');
    setErrorMessage(null);
    setErrorHelp(null);
    setAppState('EDITOR');
  }, [stopPlayback, cancelInFlightTrace]);

  const handleCodeChange = useCallback(
    (nextCode: string) => {
      setCode(nextCode);
      setPendingSimulationConfirm(null);
      if (appState === 'ERROR') {
        setErrorMessage(null);
        setErrorHelp(null);
        setAppState('EDITOR');
      }
      if (detectTimerRef.current) window.clearTimeout(detectTimerRef.current);
      if (settings.autoDetectLanguage) {
        detectTimerRef.current = window.setTimeout(() => {
          applyLanguageDetection(nextCode, language);
        }, 450);
      }
    },
    [appState, language, settings.autoDetectLanguage, applyLanguageDetection]
  );

  const handlePasteCode = useCallback(
    (_pasted: string, nextFullCode: string) => {
      if (detectTimerRef.current) window.clearTimeout(detectTimerRef.current);
      if (settings.autoDetectLanguage) {
        applyLanguageDetection(nextFullCode, language);
      }
    },
    [language, settings.autoDetectLanguage, applyLanguageDetection]
  );

  const handleLanguageChange = useCallback(
    (nextLang: LanguageId) => {
      if (!isLanguageSelectable(nextLang)) return;
      stopPlayback();
      cancelInFlightTrace();
      const spec = getLanguageSpec(nextLang);
      setLanguage(nextLang);
      setExecutionMode(spec?.realExecutionSupported ? 'real' : 'simulated');
      setErrorMessage(null);
      setErrorHelp(null);
      setPendingSimulationConfirm(null);
      setDetectionNotice(null);
      setStatusMessage('');
      if (appState === 'VISUALIZER' || appState === 'ERROR' || appState === 'TRACING') {
        setAppState('EDITOR');
      }
    },
    [appState, stopPlayback, cancelInFlightTrace]
  );

  const handleToggleBreakpoint = useCallback((lineNumber: number) => {
    setBreakpoints((prev) =>
      prev.includes(lineNumber)
        ? prev.filter((l) => l !== lineNumber)
        : [...prev, lineNumber].sort((a, b) => a - b)
    );
  }, []);

  // Import either a `.codeanim.json` / `.trace.json` file OR a regular source code file
  const handleImportFileObject = useCallback(
    (file: File) => {
      const MAX_UPLOAD_BYTES = 512 * 1024;
      if (file.size > MAX_UPLOAD_BYTES) {
        const msg = `The file "${file.name}" is too large (${Math.round(file.size / 1024)} KB). Maximum allowed file size is 512 KB.`;
        setErrorMessage(msg);
        setErrorHelp(buildDeterministicErrorHelp(msg, code, language));
        setAppState('ERROR');
        setActiveNav('workspace');
        return;
      }

      file.text().then((text) => {
        stopPlayback();
        cancelInFlightTrace();
        setAiAssistedExecution(false);
        setAiVisualScene(null);

        const lowerName = file.name.toLowerCase();
        const looksLikeCodeAnimJson =
          lowerName.endsWith('.codeanim.json') ||
          lowerName.endsWith('.trace.json') ||
          (lowerName.endsWith('.json') &&
            (text.includes('"code-anim-project"') ||
              text.includes('"code-anim-trace"') ||
              text.includes('"schemaVersion"')));

        if (looksLikeCodeAnimJson) {
          const result = validateImportedCodeAnimFile(text);
          if (!result.ok) {
            setErrorMessage(result.error);
            setErrorHelp(buildDeterministicErrorHelp(result.error, code, language));
            setAppState('ERROR');
            setActiveNav('workspace');
            return;
          }

          if (result.kind === 'project') {
            const proj = result.project;
            const spec = getLanguageSpec(proj.language);
            setProjectName(proj.name);
            setActiveProjectId(null);
            setLanguage(proj.language);
            setExecutionMode(spec?.realExecutionSupported ? 'real' : 'simulated');
            setCode(proj.code);
            setStdinText(proj.stdin);
            setCliArgsText(proj.cliArgs);
            setTraceDocument(null);
            setReplayEngine(null);
            setExecutionSummary(null);
            setCurrentStepIndex(0);
            setErrorMessage(null);
            setErrorHelp(null);
            setTraceWarning(null);
            setStatusMessage(`Imported Code Anim project "${proj.name}".`);
            setAppState('EDITOR');
            setActiveNav('workspace');
            return;
          }

          // Imported validated trace — open directly in Visualizer!
          const engine = new TraceReplayEngine(result.document, result.code);
          const analysis = analyzeProgramExecution(result.code, result.document);
          setProjectName(result.name);
          setActiveProjectId(null);
          setLanguage(result.document.language);
          setCode(result.code);
          setStdinText(result.stdin);
          setTraceDocument(result.document);
          setReplayEngine(engine);
          setExecutionSummary(analysis.summary);
          setCurrentStepIndex(0);
          setDismissedQuestionIds(new Set());
          setExecutionMode(result.document.executionMode);
          setTraceWarning(result.document.warning || null);
          setErrorMessage(null);
          setErrorHelp(null);
          setStatusMessage(`Imported validated trace "${result.name}" (${engine.totalSteps} steps).`);
          setAppState('VISUALIZER');
          setActiveNav('workspace');
          return;
        }

        // Regular source-code file upload
        const detected = detectLanguageFromCode(text, file.name);
        let nextLang = language;
        if (detected.languageId && isLanguageSelectable(detected.languageId)) {
          nextLang = detected.languageId;
        }
        const spec = getLanguageSpec(nextLang);
        setProjectName(file.name);
        setActiveProjectId(null);
        setLanguage(nextLang);
        setExecutionMode(spec?.realExecutionSupported ? 'real' : 'simulated');
        setCode(text);
        setTraceDocument(null);
        setReplayEngine(null);
        setExecutionSummary(null);
        setCurrentStepIndex(0);
        setBreakpoints([]);
        setErrorMessage(null);
        setErrorHelp(null);
        setTraceWarning(null);
        setPendingSimulationConfirm(null);

        if (detected.languageId && !isLanguageSelectable(detected.languageId)) {
          setDetectionNotice({
            kind: 'unavailable',
            result: detected,
            message: `Uploaded ${file.name}: detected ${detected.spec?.name || detected.languageId} (Not available yet).`,
          });
        } else if (detected.extensionMismatch) {
          setDetectionNotice({ kind: 'auto', result: detected, message: detected.reason });
        } else {
          setDetectionNotice(null);
        }

        setStatusMessage(`Loaded ${file.name} (${spec?.name || nextLang}).`);
        setAppState('EDITOR');
        setActiveNav('workspace');
      });
    },
    [code, language, stopPlayback, cancelInFlightTrace]
  );

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) handleImportFileObject(file);
    },
    [handleImportFileObject]
  );

  const handleApplySuggestedFix = useCallback(
    (fixedCode: string) => {
      setUndoCodeSnapshot(code);
      setCode(fixedCode);
      setErrorMessage(null);
      setErrorHelp(null);
      setStatusMessage('Applied suggested fix. Click Undo Fix anytime to restore your original code.');
      setAppState('EDITOR');
    },
    [code]
  );

  const handleUndoFix = useCallback(() => {
    if (undoCodeSnapshot === null) return;
    setCode(undoCodeSnapshot);
    setUndoCodeSnapshot(null);
    setStatusMessage('Restored your original source code.');
    if (appState === 'ERROR') {
      setErrorMessage(null);
      setErrorHelp(null);
      setAppState('EDITOR');
    }
  }, [undoCodeSnapshot, appState]);

  const handleVisualize = useCallback(
    async (opts?: {
      overrideCode?: string;
      overrideLang?: LanguageId;
      overrideStdin?: string;
      overrideProjectName?: string;
      allowSimulation?: boolean;
    }) => {
      const targetCode = opts?.overrideCode !== undefined ? opts.overrideCode : code;
      let targetLang = opts?.overrideLang !== undefined ? opts.overrideLang : language;
      const targetStdin = opts?.overrideStdin !== undefined ? opts.overrideStdin : stdinText;
      const targetName = opts?.overrideProjectName ?? projectName;
      const parsedArgs = cliArgsText
        .trim()
        .split(/\s+/)
        .filter((s) => s.length > 0);

      stopPlayback();
      cancelInFlightTrace();
      setActiveNav('workspace');

      if (!targetCode.trim()) {
        const msg = 'Source code is empty. Paste or upload code before clicking Visualize.';
        setErrorMessage(msg);
        setErrorHelp(buildDeterministicErrorHelp(msg, targetCode, targetLang));
        setStatusMessage('');
        setAppState('ERROR');
        return;
      }

      if (settings.autoDetectLanguage) {
        const liveDetect = detectLanguageFromCode(targetCode);
        if (liveDetect.languageId && liveDetect.confidence === 'high') {
          if (!isLanguageSelectable(liveDetect.languageId)) {
            const msg = `${liveDetect.spec?.name || liveDetect.languageId} is recognized, but visualization is not available for it yet.`;
            setErrorMessage(msg);
            setErrorHelp(buildDeterministicErrorHelp(msg, targetCode, liveDetect.languageId));
            setDetectionNotice({ kind: 'unavailable', result: liveDetect, message: msg });
            setAppState('ERROR');
            return;
          }
          if (opts?.overrideLang === undefined && liveDetect.languageId !== targetLang) {
            targetLang = liveDetect.languageId;
            setLanguage(targetLang);
            setDetectionNotice({
              kind: 'auto',
              result: liveDetect,
              message: `${liveDetect.spec?.name || targetLang} code detected. Language changed automatically.`,
            });
          }
        }
      }

      const spec = getLanguageSpec(targetLang);
      if (!spec || !isLanguageSelectable(targetLang)) {
        const msg = `${spec?.name || targetLang} is not available for visualization yet.`;
        setErrorMessage(msg);
        setErrorHelp(buildDeterministicErrorHelp(msg, targetCode, targetLang));
        setAppState('ERROR');
        return;
      }

      // Automatic AI simulation when enabled by default in Settings (no interrupting permission popup)
      const allowSim =
        opts?.allowSimulation !== undefined
          ? opts.allowSimulation
          : settings.aiSimulationEnabled;

      if (!spec.realExecutionSupported && !allowSim) {
        setPendingSimulationConfirm({
          lang: targetLang,
          langName: spec.name,
          code: targetCode,
        });
        setStatusMessage(
          `AI Simulation is turned off in Settings. Turn it back on in Settings or run a one-time AI simulation for ${spec.name}.`
        );
        return;
      }

      setPendingSimulationConfirm(null);

      const requestId = ++activeRequestIdRef.current;
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const adapter = getLanguageAdapter(targetLang);

      setAppState('TRACING');
      setErrorMessage(null);
      setErrorHelp(null);
      setTraceWarning(null);
      setAiAssistedExecution(false);
      setAiVisualScene(null);
      setExecutionMode(adapter.meta.executionMode);
      setStatusMessage(`Tracing ${adapter.meta.label} (${adapter.meta.executionMethod})…`);

      const startedAt = performance.now();

      try {
        const document = await adapter.trace(targetCode, controller.signal, {
          stdin: targetStdin,
          args: parsedArgs,
          allowSimulation: allowSim,
        });

        if (requestId !== activeRequestIdRef.current || controller.signal.aborted) {
          return;
        }

        const measuredDurationMs = Math.max(1, Math.round(performance.now() - startedAt));
        const engine = new TraceReplayEngine(document, targetCode);
        if (engine.totalSteps === 0) {
          throw new Error('No executable trace events were captured from this program.');
        }

        const analysis = analyzeProgramExecution(targetCode, document, { measuredDurationMs });

        setTraceDocument(document);
        setReplayEngine(engine);
        setExecutionSummary(analysis.summary);
        setCurrentStepIndex(0);
        setDismissedQuestionIds(new Set());
        setExecutionMode(document.executionMode);
        setTraceWarning(document.warning || null);
        setStatusMessage(document.note || adapter.meta.executionMethod);
        setErrorMessage(null);
        setErrorHelp(null);
        setAppState('VISUALIZER');

        appendHistory({
          projectName: targetName,
          language: document.language,
          executionMode: document.executionMode,
          code: targetCode,
          stdin: targetStdin,
          cliArgs: cliArgsText,
          status:
            document.executionMode === 'simulated'
              ? 'simulated'
              : document.interrupted
              ? 'stopped_early'
              : 'completed',
          stepCount: engine.totalSteps,
          finalOutput: analysis.summary.finalOutput || '',
          traceAvailable: true,
        });

        // Non-blocking Gemini simple-English purpose enrichment (respects user AI privacy setting)
        if (settings.aiSimulationEnabled) {
          void fetch('/api/explain', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              lang: document.language,
              code: targetCode,
              stdin: targetStdin,
              detectedStructures: analysis.summary.detectedStructures,
              observedOperations: analysis.summary.observedOperations,
              finalOutput: analysis.summary.finalOutput,
              stepCount: analysis.summary.stepCount,
              executionMode: document.executionMode,
              aiEnabled: true,
            }),
          })
            .then((r) => (r.ok ? r.json() : null))
            .then((data: { purpose?: string; provider?: string; visualScene?: unknown } | null) => {
              if (requestId !== activeRequestIdRef.current) return;
              if (data?.purpose && data.purpose.trim()) {
                setExecutionSummary((prev) => (prev ? { ...prev, purpose: data.purpose!.trim() } : prev));
                if (data.provider === 'Gemini' && document.executionMode === 'real') {
                  setAiAssistedExecution(true);
                }
              }
              if (data?.visualScene) {
                const validated = validateVisualScene(data.visualScene);
                if (validated) {
                  setAiVisualScene(validated);
                }
              }
            })
            .catch(() => {
              // Deterministic purpose already displayed
            });
        }
      } catch (err) {
        if (
          controller.signal.aborted ||
          requestId !== activeRequestIdRef.current ||
          (err instanceof DOMException && err.name === 'AbortError')
        ) {
          return;
        }
        const message =
          err instanceof Error && err.message
            ? err.message
            : 'Unexpected error while generating execution trace.';
        const errContext =
          err instanceof TraceApiError
            ? {
                category: err.category,
                code: err.code,
                httpStatus: err.httpStatus,
                technicalDetail: err.technicalDetail,
              }
            : undefined;
        const immediateHelp = buildDeterministicErrorHelp(
          message,
          targetCode,
          targetLang,
          errContext
        );
        setErrorMessage(message);
        setErrorHelp(immediateHelp);
        setStatusMessage('');
        setAppState('ERROR');
        setWorkspaceTab('animation');

        if (immediateHelp.category === 'missing_input') {
          setDrawerTab('input');
          setDrawerOpen(true);
        }

        appendHistory({
          projectName: targetName,
          language: targetLang,
          executionMode: adapter.meta.executionMode,
          code: targetCode,
          stdin: targetStdin,
          cliArgs: cliArgsText,
          status: 'error',
          stepCount: 0,
          finalOutput: '',
          traceAvailable: false,
          errorMessage: message,
        });

        // Only ask AI for code-fix suggestions when AI is enabled and the error is a user code error
        if (settings.aiSimulationEnabled && immediateHelp.isUserCodeError !== false) {
          setErrorHelpLoading(true);
          void fetch('/api/error-help', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              lang: targetLang,
              code: targetCode,
              error: message,
              stdin: targetStdin,
              aiEnabled: true,
            }),
          })
            .then((r) => (r.ok ? r.json() : null))
            .then((data: { report?: ErrorHelpReport } | null) => {
              if (requestId !== activeRequestIdRef.current) return;
              if (data?.report) setErrorHelp(data.report);
            })
            .catch(() => {
              // Keep deterministic report
            })
            .finally(() => {
              if (requestId === activeRequestIdRef.current) setErrorHelpLoading(false);
            });
        }
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [
      code,
      language,
      stdinText,
      cliArgsText,
      projectName,
      settings.autoDetectLanguage,
      settings.aiSimulationEnabled,
      stopPlayback,
      cancelInFlightTrace,
      appendHistory,
    ]
  );

  // Quick starter example from empty canvas
  const handleSelectExample = useCallback(
    (example: CodeExample) => {
      stopPlayback();
      cancelInFlightTrace();
      const spec = getLanguageSpec(example.lang);
      setProjectName(example.label);
      setActiveProjectId(null);
      setLanguage(example.lang);
      setExecutionMode(spec?.realExecutionSupported ? 'real' : 'simulated');
      setCode(example.code);
      setBreakpoints([]);
      if (example.sampleInput !== undefined) {
        setStdinText(example.sampleInput);
        setDrawerTab('input');
        setDrawerOpen(true);
      }
      setErrorMessage(null);
      setErrorHelp(null);
      setTraceWarning(null);
      setDetectionNotice(null);
      setPendingSimulationConfirm(null);
      setStatusMessage(`Loaded example: ${example.label}`);
      setAppState('EDITOR');
      setActiveNav('workspace');
    },
    [stopPlayback, cancelInFlightTrace]
  );

  // Built-in Learning Library launch
  const handleVisualizeLibraryExample = useCallback(
    (example: LearningExample, autoRun: boolean) => {
      stopPlayback();
      cancelInFlightTrace();
      const spec = getLanguageSpec(example.lang);
      setProjectName(example.title);
      setActiveProjectId(null);
      setLanguage(example.lang);
      setExecutionMode(spec?.realExecutionSupported ? 'real' : 'simulated');
      setCode(example.code);
      setStdinText(example.sampleInput || '');
      setCliArgsText('');
      setBreakpoints([]);
      setErrorMessage(null);
      setErrorHelp(null);
      setTraceWarning(null);
      setDetectionNotice(null);
      setPendingSimulationConfirm(null);
      setActiveNav('workspace');

      if (autoRun) {
        void handleVisualize({
          overrideCode: example.code,
          overrideLang: example.lang,
          overrideStdin: example.sampleInput || '',
          overrideProjectName: example.title,
        });
      } else {
        setAppState('EDITOR');
        setStatusMessage(`Opened "${example.title}" in Editor.`);
      }
    },
    [stopPlayback, cancelInFlightTrace, handleVisualize]
  );

  // Project CRUD handlers
  const handleQuickSaveProject = useCallback(() => {
    const now = new Date().toISOString();
    if (activeProjectId) {
      setProjects((prev) => {
        const next = prev.map((p) =>
          p.id === activeProjectId
            ? {
                ...p,
                name: projectName.trim() || p.name,
                language,
                code,
                stdin: stdinText,
                cliArgs: cliArgsText,
                updatedAt: now,
              }
            : p
        );
        const res = persistProjects(next);
        if (!res.ok && res.error) setStorageNotice(res.error);
        return next;
      });
      setStatusMessage(`Saved "${projectName}" locally on this device.`);
    } else {
      const created = createSavedProject({
        name: projectName === 'Untitled Workspace' ? `Program (${language.toUpperCase()})` : projectName,
        language,
        code,
        stdin: stdinText,
        cliArgs: cliArgsText,
      });
      setProjects((prev) => {
        const next = [created, ...prev];
        const res = persistProjects(next);
        if (!res.ok && res.error) setStorageNotice(res.error);
        return next;
      });
      setActiveProjectId(created.id);
      setProjectName(created.name);
      setStatusMessage(`Saved "${created.name}" to My Projects (local device).`);
    }
  }, [activeProjectId, projectName, language, code, stdinText, cliArgsText]);

  const handleSaveCurrentAsProject = useCallback(
    (name: string) => {
      const created = createSavedProject({
        name,
        language,
        code,
        stdin: stdinText,
        cliArgs: cliArgsText,
      });
      setProjects((prev) => {
        const next = [created, ...prev];
        const res = persistProjects(next);
        if (!res.ok && res.error) setStorageNotice(res.error);
        return next;
      });
      setActiveProjectId(created.id);
      setProjectName(created.name);
      setStatusMessage(`Saved "${created.name}" locally on this device.`);
    },
    [language, code, stdinText, cliArgsText]
  );

  const handleCreateNewProject = useCallback(() => {
    stopPlayback();
    cancelInFlightTrace();
    const spec = getLanguageSpec(settings.defaultLanguage);
    setActiveProjectId(null);
    setProjectName('Untitled Workspace');
    setLanguage(settings.defaultLanguage);
    setExecutionMode(spec?.realExecutionSupported ? 'real' : 'simulated');
    setCode('');
    setStdinText('');
    setCliArgsText('');
    setTraceDocument(null);
    setReplayEngine(null);
    setExecutionSummary(null);
    setBreakpoints([]);
    setErrorMessage(null);
    setErrorHelp(null);
    setAppState('EDITOR');
    setActiveNav('workspace');
  }, [settings.defaultLanguage, stopPlayback, cancelInFlightTrace]);

  const handleOpenProject = useCallback(
    (proj: SavedProject) => {
      stopPlayback();
      cancelInFlightTrace();
      const spec = getLanguageSpec(proj.language);
      setActiveProjectId(proj.id);
      setProjectName(proj.name);
      setLanguage(proj.language);
      setExecutionMode(spec?.realExecutionSupported ? 'real' : 'simulated');
      setCode(proj.code);
      setStdinText(proj.stdin);
      setCliArgsText(proj.cliArgs);
      setTraceDocument(null);
      setReplayEngine(null);
      setExecutionSummary(null);
      setBreakpoints([]);
      setErrorMessage(null);
      setErrorHelp(null);
      setAppState('EDITOR');
      setActiveNav('workspace');
      setStatusMessage(`Opened project "${proj.name}".`);
    },
    [stopPlayback, cancelInFlightTrace]
  );

  const handleRenameProject = useCallback(
    (id: string, newName: string) => {
      setProjects((prev) => {
        const next = prev.map((p) =>
          p.id === id ? { ...p, name: newName, updatedAt: new Date().toISOString() } : p
        );
        const res = persistProjects(next);
        if (!res.ok && res.error) setStorageNotice(res.error);
        return next;
      });
      if (activeProjectId === id) setProjectName(newName);
    },
    [activeProjectId]
  );

  const handleDuplicateProject = useCallback((id: string) => {
    setProjects((prev) => {
      const target = prev.find((p) => p.id === id);
      if (!target) return prev;
      const copy = duplicateSavedProject(target);
      const next = [copy, ...prev];
      const res = persistProjects(next);
      if (!res.ok && res.error) setStorageNotice(res.error);
      return next;
    });
  }, []);

  const handleDeleteProject = useCallback(
    (id: string) => {
      setProjects((prev) => {
        const next = prev.filter((p) => p.id !== id);
        persistProjects(next);
        return next;
      });
      if (activeProjectId === id) {
        setActiveProjectId(null);
      }
    },
    [activeProjectId]
  );

  const handleReopenHistory = useCallback(
    (entry: ExecutionHistoryEntry, autoRun: boolean) => {
      stopPlayback();
      cancelInFlightTrace();
      const spec = getLanguageSpec(entry.language);
      setActiveProjectId(null);
      setProjectName(entry.projectName);
      setLanguage(entry.language);
      setExecutionMode(spec?.realExecutionSupported ? 'real' : 'simulated');
      setCode(entry.code);
      setStdinText(entry.stdin);
      setCliArgsText(entry.cliArgs);
      setBreakpoints([]);
      setErrorMessage(null);
      setErrorHelp(null);
      setActiveNav('workspace');

      if (autoRun) {
        void handleVisualize({
          overrideCode: entry.code,
          overrideLang: entry.language,
          overrideStdin: entry.stdin,
          overrideProjectName: entry.projectName,
          allowSimulation: entry.executionMode === 'simulated',
        });
      } else {
        setAppState('EDITOR');
      }
    },
    [stopPlayback, cancelInFlightTrace, handleVisualize]
  );

  const handleDeleteHistoryEntry = useCallback((id: string) => {
    setHistoryEntries((prev) => {
      const next = prev.filter((e) => e.id !== id);
      persistExecutionHistory(next);
      return next;
    });
  }, []);

  const handleClearHistory = useCallback(() => {
    setHistoryEntries([]);
    persistExecutionHistory([]);
  }, []);

  const handleResetLocalData = useCallback(() => {
    clearAllLocalData();
    setProjects([]);
    setHistoryEntries([]);
    setLearningProgress({ answered: 0, correct: 0, skipped: 0, streak: 0 });
    setActiveProjectId(null);
    setStorageNotice('Cleared all locally saved projects, history, and practice progress.');
  }, []);

  // Playback controls
  const handlePlay = useCallback(() => {
    if (appState !== 'VISUALIZER' || totalSteps === 0) return;
    setCurrentStepIndex((prev) => (prev >= totalSteps - 1 ? 0 : prev));
    setIsPlaying(true);
  }, [appState, totalSteps]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const handleNext = useCallback(() => {
    if (appState !== 'VISUALIZER' || totalSteps === 0) return;
    setIsPlaying(false);
    setCurrentStepIndex((prev) => Math.min(totalSteps - 1, prev + 1));
  }, [appState, totalSteps]);

  const handlePrev = useCallback(() => {
    if (appState !== 'VISUALIZER' || totalSteps === 0) return;
    setIsPlaying(false);
    setCurrentStepIndex((prev) => Math.max(0, prev - 1));
  }, [appState, totalSteps]);

  const handleJumpStart = useCallback(() => {
    if (appState !== 'VISUALIZER' || totalSteps === 0) return;
    setIsPlaying(false);
    setCurrentStepIndex(0);
  }, [appState, totalSteps]);

  const handleJumpEnd = useCallback(() => {
    if (appState !== 'VISUALIZER' || totalSteps === 0) return;
    setIsPlaying(false);
    setCurrentStepIndex(totalSteps - 1);
  }, [appState, totalSteps]);

  const handleRestart = useCallback(() => {
    if (appState !== 'VISUALIZER' || totalSteps === 0) return;
    setIsPlaying(false);
    setCurrentStepIndex(0);
    setDismissedQuestionIds(new Set());
  }, [appState, totalSteps]);

  const handleNextBreakpoint = useCallback(() => {
    if (appState !== 'VISUALIZER' || !traceDocument || breakpoints.length === 0) return;
    setIsPlaying(false);
    const bpSet = new Set(breakpoints);
    for (let i = currentStepIndex + 1; i < traceDocument.events.length; i++) {
      if (bpSet.has(traceDocument.events[i].line)) {
        setCurrentStepIndex(i);
        setStatusMessage(`Jumped to recorded-trace breakpoint on Line ${traceDocument.events[i].line}.`);
        return;
      }
    }
    setStatusMessage('No further recorded-trace breakpoints after this step.');
  }, [appState, traceDocument, breakpoints, currentStepIndex]);

  const handleSeek = useCallback(
    (index: number) => {
      if (appState !== 'VISUALIZER' || totalSteps === 0) return;
      setIsPlaying(false);
      setCurrentStepIndex(Math.min(Math.max(0, index), totalSteps - 1));
    },
    [appState, totalSteps]
  );

  // Interactive Learning Mode handlers
  const handleAnswerLearningQuestion = useCallback((correct: boolean) => {
    setLearningProgress((prev) => {
      const next: LearningProgress = {
        answered: prev.answered + 1,
        correct: prev.correct + (correct ? 1 : 0),
        skipped: prev.skipped,
        streak: correct ? prev.streak + 1 : 0,
      };
      saveLearningProgress(next);
      return next;
    });
  }, []);

  const handleSkipLearningQuestion = useCallback(() => {
    if (!activeLearningQuestion) return;
    setDismissedQuestionIds((prev) => new Set(prev).add(activeLearningQuestion.id));
    setLearningProgress((prev) => {
      const next: LearningProgress = { ...prev, skipped: prev.skipped + 1, streak: 0 };
      saveLearningProgress(next);
      return next;
    });
    handleNext();
  }, [activeLearningQuestion, handleNext]);

  const handleContinueFromQuestion = useCallback(() => {
    if (!activeLearningQuestion) return;
    setDismissedQuestionIds((prev) => new Set(prev).add(activeLearningQuestion.id));
    handleNext();
  }, [activeLearningQuestion, handleNext]);

  // Ask AI Tutor from Error Card
  const handleAskTutorAboutError = useCallback((errorSummary: string) => {
    setUtilityDrawer('tutor');
    setPendingTutorPrompt(
      `My ${selectedSpec.name} program failed with this error: "${errorSummary}". Explain simply why it happened and how to fix it.`
    );
  }, [selectedSpec.name]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && fullscreenPane !== 'none') {
        setFullscreenPane('none');
        return;
      }
      if (activeNav !== 'workspace' || appState !== 'VISUALIZER') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
      } else if (e.key === ' ') {
        e.preventDefault();
        if (isPlaying) handlePause();
        else handlePlay();
      } else if (e.key === 'Home') {
        e.preventDefault();
        handleJumpStart();
      } else if (e.key === 'End') {
        e.preventDefault();
        handleJumpEnd();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeNav,
    appState,
    fullscreenPane,
    isPlaying,
    handleNext,
    handlePrev,
    handlePlay,
    handlePause,
    handleJumpStart,
    handleJumpEnd,
  ]);

  // Pointer-based resizable 2-panel splitter on desktop (Left Source Code ~40% / Right Workspace ~60%)
  const startResize = useCallback((startX: number) => {
    const container = workspaceGridRef.current;
    if (!container) return;
    const totalWidth = container.getBoundingClientRect().width;
    if (totalWidth < 400) return;

    const initialLeft = leftPct;

    const onMove = (ev: PointerEvent) => {
      const deltaPct = ((ev.clientX - startX) / totalWidth) * 100;
      setLeftPct(Math.min(62, Math.max(24, Math.round(initialLeft + deltaPct))));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [leftPct]);

  const currentFrame = useMemo(() => {
    if (appState !== 'VISUALIZER' || !replayEngine) return null;
    return replayEngine.getStateAt(currentStepIndex);
  }, [appState, replayEngine, currentStepIndex]);

  const prevFrame = useMemo(() => {
    if (appState !== 'VISUALIZER' || !replayEngine || currentStepIndex <= 0) return null;
    return replayEngine.getStateAt(currentStepIndex - 1);
  }, [appState, replayEngine, currentStepIndex]);

  const nextFrame = useMemo(() => {
    if (appState !== 'VISUALIZER' || !replayEngine || currentStepIndex >= totalSteps - 1) return null;
    return replayEngine.getStateAt(currentStepIndex + 1);
  }, [appState, replayEngine, currentStepIndex, totalSteps]);

  const activeExecutionMode: ExecutionMode =
    appState === 'VISUALIZER' && currentFrame ? currentFrame.executionMode : executionMode;

  const gridTemplateColumns = useMemo(() => {
    if (fullscreenPane === 'code' || fullscreenPane === 'canvas') return '1fr';
    return `${leftPct}% 6px minmax(0, 1fr)`;
  }, [fullscreenPane, leftPct]);

  return (
    <div className="min-h-screen flex bg-[var(--ca-bg)] text-[var(--ca-text)]">
      {/* Desktop Collapsible Navigation Rail */}
      <aside
        aria-label="Primary Navigation"
        className={`hidden md:flex flex-col shrink-0 border-r border-[var(--ca-border)] ca-surface-2 transition-[width] duration-150 ${
          navCollapsed ? 'w-14' : 'w-52'
        }`}
      >
        <div className="h-12 px-3 border-b border-[var(--ca-border)] flex items-center justify-between gap-2">
          {!navCollapsed && (
            <span className="font-bold text-sm tracking-tight whitespace-nowrap">
              Code <span className="text-[var(--ca-accent)]">Anim</span>
            </span>
          )}
          <button
            type="button"
            onClick={() => setNavCollapsed((v) => !v)}
            aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            className="p-1.5 rounded-lg ca-text-muted hover:text-[var(--ca-text)] hover:bg-[var(--ca-surface-elev)] cursor-pointer"
          >
            {navCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        <nav className="flex-1 p-2 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                title={navCollapsed ? item.label : undefined}
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  setActiveNav(item.id);
                  setFullscreenPane('none');
                }}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  active
                    ? 'bg-[var(--ca-accent-soft)] text-[var(--ca-accent)]'
                    : 'ca-text-muted hover:text-[var(--ca-text)] hover:bg-[var(--ca-surface)]'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!navCollapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="p-2 border-t border-[var(--ca-border)]">
          <button
            type="button"
            onClick={() =>
              updateSettings({ theme: effectiveTheme === 'dark' ? 'light' : 'dark' })
            }
            title="Switch theme"
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs ca-text-muted hover:text-[var(--ca-text)] hover:bg-[var(--ca-surface)] cursor-pointer"
          >
            {effectiveTheme === 'dark' ? (
              <Sun className="w-4 h-4 shrink-0" />
            ) : (
              <Moon className="w-4 h-4 shrink-0" />
            )}
            {!navCollapsed && (
              <span>{effectiveTheme === 'dark' ? 'Light Theme' : 'Dark Theme'}</span>
            )}
          </button>
        </div>
      </aside>

      {/* Mobile Slide-Over Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div className="w-64 ca-surface border-r border-[var(--ca-border)] flex flex-col p-3 gap-2 shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b border-[var(--ca-border)]">
              <span className="font-bold text-sm">
                Code <span className="text-[var(--ca-accent)]">Anim</span>
              </span>
              <button
                type="button"
                aria-label="Close navigation"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 rounded-lg ca-text-muted cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeNav === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveNav(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium cursor-pointer ${
                      active
                        ? 'bg-[var(--ca-accent-soft)] text-[var(--ca-accent)]'
                        : 'ca-text-muted hover:text-[var(--ca-text)]'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <button
              type="button"
              onClick={() =>
                updateSettings({ theme: effectiveTheme === 'dark' ? 'light' : 'dark' })
              }
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs border border-[var(--ca-border)] cursor-pointer"
            >
              {effectiveTheme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              <span>{effectiveTheme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme'}</span>
            </button>
          </div>
          <div
            className="flex-1 bg-black/50"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar */}
        <header className="min-h-12 border-b border-[var(--ca-border)] ca-surface-2 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-1.5 rounded-lg border border-[var(--ca-border)] ca-text-muted cursor-pointer"
            >
              <Menu className="w-4 h-4" />
            </button>

            <span className="md:hidden font-bold text-sm whitespace-nowrap">
              Code <span className="text-[var(--ca-accent)]">Anim</span>
            </span>

            {activeNav === 'workspace' ? (
              <div className="flex items-center gap-2 min-w-0">
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  aria-label="Active workspace name"
                  className="text-xs font-semibold bg-transparent border-b border-transparent focus:border-[var(--ca-accent)] focus:outline-none px-1 py-0.5 w-36 sm:w-48 truncate"
                />
                <button
                  type="button"
                  onClick={handleQuickSaveProject}
                  title="Save project locally on this device"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border border-[var(--ca-border-strong)] hover:bg-[var(--ca-surface-elev)] cursor-pointer shrink-0"
                >
                  <Save className="w-3 h-3" />
                  <span className="hidden sm:inline">Save</span>
                </button>
              </div>
            ) : (
              <span className="text-xs font-semibold">
                {NAV_ITEMS.find((n) => n.id === activeNav)?.label}
              </span>
            )}
          </div>

          {activeNav === 'workspace' && (
            <div className="flex flex-wrap items-center gap-2">
              {/* Language Selector — ZERO "other" option */}
              <select
                id="language-select"
                aria-label="Programming language"
                value={language}
                disabled={appState === 'TRACING'}
                onChange={(e) => handleLanguageChange(e.target.value as LanguageId)}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-[var(--ca-border-strong)] ca-surface focus:outline-none disabled:opacity-50 max-w-[210px]"
              >
                <optgroup label="Live execution">
                  {liveLanguages.map((spec) => (
                    <option key={spec.id} value={spec.id}>
                      {spec.name} — Live execution
                    </option>
                  ))}
                </optgroup>
                <optgroup label="AI simulation (automatic)">
                  {simulatedLanguages.map((spec) => (
                    <option key={spec.id} value={spec.id}>
                      {spec.name} — AI simulation
                    </option>
                  ))}
                </optgroup>
                {unavailableLanguages.length > 0 && (
                  <optgroup label="Not available yet">
                    {unavailableLanguages.map((spec) => (
                      <option key={spec.id} value={spec.id} disabled>
                        {spec.name} — Not available yet
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={appState === 'TRACING'}
                title="Upload source file or import .codeanim.json / .trace.json"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-[var(--ca-border-strong)] ca-surface hover:bg-[var(--ca-surface-elev)] disabled:opacity-50 cursor-pointer shrink-0"
              >
                <Upload className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Import / Upload</span>
              </button>
              <input ref={fileInputRef} type="file" hidden onChange={handleFileUpload} />

              <button
                id="visualize-btn"
                type="button"
                onClick={() => void handleVisualize()}
                disabled={appState === 'TRACING'}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-wait transition-colors cursor-pointer shrink-0"
              >
                {appState === 'TRACING' ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Tracing…</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    <span>Visualize</span>
                  </>
                )}
              </button>
            </div>
          )}
        </header>

        {/* Main View Area */}
        <main className="flex-1 min-h-0 flex flex-col p-3 gap-2.5">
          {activeNav === 'workspace' && (
            <>
              {/* Shown ONLY if the user explicitly turned off AI Simulation in Settings */}
              {pendingSimulationConfirm && (
                <div
                  role="status"
                  aria-label="AI simulation disabled in settings"
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3.5 py-2 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>
                      AI Simulation is currently turned off in Settings, and{' '}
                      <strong>{pendingSimulationConfirm.langName}</strong> uses AI Simulation.
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void handleVisualize({
                          overrideCode: pendingSimulationConfirm.code,
                          overrideLang: pendingSimulationConfirm.lang,
                          allowSimulation: true,
                        })
                      }
                      className="px-3 py-1 rounded-lg font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 cursor-pointer"
                    >
                      Simulate Once
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPendingSimulationConfirm(null);
                        setActiveNav('settings');
                      }}
                      className="px-3 py-1 rounded-lg border border-[var(--ca-border-strong)] cursor-pointer"
                    >
                      Open Settings
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingSimulationConfirm(null)}
                      className="px-2 py-1 ca-text-muted underline cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}

              {/* Language Detection Notice */}
              {detectionNotice && !pendingSimulationConfirm && (
                <div
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-xs ${
                    detectionNotice.kind === 'unavailable'
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                      : 'border-[var(--ca-accent)]/40 bg-[var(--ca-accent-soft)]'
                  }`}
                >
                  <span>{detectionNotice.message}</span>
                  <div className="flex items-center gap-2">
                    {detectionNotice.kind === 'confirm' && detectionNotice.result.languageId && (
                      <button
                        type="button"
                        onClick={() => {
                          handleLanguageChange(detectionNotice.result.languageId!);
                          setDetectionNotice(null);
                        }}
                        className="px-2.5 py-0.5 rounded bg-indigo-600 text-white font-semibold cursor-pointer"
                      >
                        Switch to {detectionNotice.result.spec?.name}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setDetectionNotice(null)}
                      className="underline ca-text-muted cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}

              {/* Compact Mode / Status Strip */}
              {appState === 'ERROR' && errorMessage ? (
                <div
                  role="alert"
                  className="flex items-center justify-between gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-300"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                    <span className="truncate">{errorMessage}</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleEditCode}
                    className="underline whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] ca-text-muted px-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 font-medium ${
                          activeExecutionMode === 'simulated'
                            ? 'text-amber-400'
                            : aiAssistedExecution
                              ? 'text-sky-400'
                              : 'text-emerald-400'
                        }`}
                      >
                        {activeExecutionMode === 'simulated' ? (
                          <>
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>AI Simulation</span>
                          </>
                        ) : aiAssistedExecution ? (
                          <>
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>AI-Assisted Execution</span>
                          </>
                        ) : (
                          <>
                            <Cpu className="w-3.5 h-3.5" />
                            <span>Live Execution</span>
                          </>
                        )}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{statusMessage || selectedSpec.executionMethod}</span>
                    </div>
                    {appState === 'VISUALIZER' && (
                      <span className="hidden md:inline opacity-80">
                        Shortcuts: ←/→ Step · Space Play/Pause · Home/End Jump
                      </span>
                    )}
                  </div>

                  {appState === 'VISUALIZER' && activeExecutionMode === 'simulated' && (
                    <div
                      role="note"
                      className="flex items-center gap-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-200"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span>
                        This animation is generated by AI. Some steps may differ from how the program actually runs.
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Desktop 2-Panel Resizable Workspace (>= lg): Left Source Code (40%) + Right Tabbed Workspace (60%) */}
              <div
                ref={workspaceGridRef}
                className="hidden lg:grid gap-0 flex-1 min-h-[540px]"
                style={{ gridTemplateColumns }}
              >
                {/* LEFT PANEL: Source Code (always visible throughout visualization) */}
                {(fullscreenPane === 'none' || fullscreenPane === 'code') && (
                  <div className="min-w-0 min-h-0 flex flex-col">
                    <CodePane
                      appState={appState}
                      language={language}
                      code={code}
                      projectName={projectName}
                      fontSize={settings.editorFontSize}
                      onFontSizeChange={(sz) => updateSettings({ editorFontSize: sz })}
                      onChangeCode={handleCodeChange}
                      onPasteCode={handlePasteCode}
                      activeLine={currentFrame ? currentFrame.line : null}
                      activeEvent={currentFrame ? currentFrame.event : null}
                      errorLine={appState === 'ERROR' ? errorHelp?.affectedLine ?? null : null}
                      breakpoints={breakpoints}
                      onToggleBreakpoint={handleToggleBreakpoint}
                      canUndoFix={undoCodeSnapshot !== null}
                      onUndoFix={handleUndoFix}
                      onEditCode={handleEditCode}
                      isFullscreen={fullscreenPane === 'code'}
                      onToggleFullscreen={() =>
                        setFullscreenPane((p) => (p === 'code' ? 'none' : 'code'))
                      }
                      reducedMotion={settings.reducedMotion}
                    />
                  </div>
                )}

                {/* Vertical Resizer between Source Code and Right Tabbed Workspace */}
                {fullscreenPane === 'none' && (
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize source code and workspace panels"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      startResize(e.clientX);
                    }}
                    className="cursor-col-resize flex items-center justify-center group"
                  >
                    <div className="w-[2px] h-16 rounded bg-[var(--ca-border)] group-hover:bg-[var(--ca-accent)] transition-colors" />
                  </div>
                )}

                {/* RIGHT PANEL: Tabbed Workspace (Animation | Explanation) */}
                {(fullscreenPane === 'none' || fullscreenPane === 'canvas') && (
                  <div className="min-w-0 min-h-0 flex flex-col">
                    <WorkspaceRightPanel
                      activeTab={workspaceTab}
                      onTabChange={setWorkspaceTab}
                      utilityDrawer={utilityDrawer}
                      onUtilityDrawerChange={setUtilityDrawer}
                      appState={appState}
                      language={language}
                      languageName={selectedSpec.name}
                      projectName={projectName}
                      code={code}
                      codeLines={codeLines}
                      stdinText={stdinText}
                      cliArgsText={cliArgsText}
                      totalSteps={totalSteps}
                      currentStepIndex={currentStepIndex}
                      frame={currentFrame}
                      prevFrame={prevFrame}
                      nextFrame={nextFrame}
                      traceDocument={traceDocument}
                      executionSummary={executionSummary}
                      complexityGuide={complexityGuide}
                      aiVisualScene={aiVisualScene}
                      activeExecutionMode={activeExecutionMode}
                      errorMessage={errorMessage}
                      errorHelp={errorHelp}
                      errorHelpLoading={errorHelpLoading}
                      traceWarning={traceWarning}
                      simpleExplanationsEnabled={settings.simpleExplanations}
                      aiTutorEnabled={settings.aiTutorEnabled}
                      pendingTutorPrompt={pendingTutorPrompt}
                      onConsumedTutorPrompt={() => setPendingTutorPrompt(null)}
                      onSelectExample={handleSelectExample}
                      onApplySuggestedFix={handleApplySuggestedFix}
                      onAskTutorAboutError={handleAskTutorAboutError}
                      onRetryVisualize={() =>
                        void handleVisualize({
                          allowSimulation: !selectedSpec.realExecutionSupported,
                        })
                      }
                      onCancelTrace={handleCancelTrace}
                      onBackToEditor={handleEditCode}
                      isFullscreen={fullscreenPane === 'canvas'}
                      onToggleFullscreen={() =>
                        setFullscreenPane((p) => (p === 'canvas' ? 'none' : 'canvas'))
                      }
                      learningModeEnabled={settings.learningModeEnabled}
                      activeQuestion={activeLearningQuestion}
                      learningProgress={learningProgress}
                      onAnswerLearningQuestion={handleAnswerLearningQuestion}
                      onSkipLearningQuestion={handleSkipLearningQuestion}
                      onContinueFromQuestion={handleContinueFromQuestion}
                      onDisableLearningMode={() => updateSettings({ learningModeEnabled: false })}
                      effectiveTheme={effectiveTheme}
                    />
                  </div>
                )}
              </div>

              {/* Mobile / Tablet Stacked 2-Panel Workspace (< lg): Source Code always visible above Tabbed Workspace */}
              <div className="flex flex-col gap-2.5 lg:hidden flex-1 min-h-0">
                <div className="h-[250px] sm:h-[290px] shrink-0 flex flex-col">
                  <CodePane
                    appState={appState}
                    language={language}
                    code={code}
                    projectName={projectName}
                    fontSize={settings.editorFontSize}
                    onFontSizeChange={(sz) => updateSettings({ editorFontSize: sz })}
                    onChangeCode={handleCodeChange}
                    onPasteCode={handlePasteCode}
                    activeLine={currentFrame ? currentFrame.line : null}
                    activeEvent={currentFrame ? currentFrame.event : null}
                    errorLine={appState === 'ERROR' ? errorHelp?.affectedLine ?? null : null}
                    breakpoints={breakpoints}
                    onToggleBreakpoint={handleToggleBreakpoint}
                    canUndoFix={undoCodeSnapshot !== null}
                    onUndoFix={handleUndoFix}
                    onEditCode={handleEditCode}
                    reducedMotion={settings.reducedMotion}
                  />
                </div>

                <div className="flex-1 min-h-[380px] flex flex-col">
                  <WorkspaceRightPanel
                    activeTab={workspaceTab}
                    onTabChange={setWorkspaceTab}
                    utilityDrawer={utilityDrawer}
                    onUtilityDrawerChange={setUtilityDrawer}
                    appState={appState}
                    language={language}
                    languageName={selectedSpec.name}
                    projectName={projectName}
                    code={code}
                    codeLines={codeLines}
                    stdinText={stdinText}
                    cliArgsText={cliArgsText}
                    totalSteps={totalSteps}
                    currentStepIndex={currentStepIndex}
                    frame={currentFrame}
                    prevFrame={prevFrame}
                    nextFrame={nextFrame}
                    traceDocument={traceDocument}
                    executionSummary={executionSummary}
                    complexityGuide={complexityGuide}
                    aiVisualScene={aiVisualScene}
                    activeExecutionMode={activeExecutionMode}
                    errorMessage={errorMessage}
                    errorHelp={errorHelp}
                    errorHelpLoading={errorHelpLoading}
                    traceWarning={traceWarning}
                    simpleExplanationsEnabled={settings.simpleExplanations}
                    aiTutorEnabled={settings.aiTutorEnabled}
                    pendingTutorPrompt={pendingTutorPrompt}
                    onConsumedTutorPrompt={() => setPendingTutorPrompt(null)}
                    onSelectExample={handleSelectExample}
                    onApplySuggestedFix={handleApplySuggestedFix}
                    onAskTutorAboutError={handleAskTutorAboutError}
                    onRetryVisualize={() =>
                      void handleVisualize({
                        allowSimulation: !selectedSpec.realExecutionSupported,
                      })
                    }
                    onCancelTrace={handleCancelTrace}
                    onBackToEditor={handleEditCode}
                    learningModeEnabled={settings.learningModeEnabled}
                    activeQuestion={activeLearningQuestion}
                    learningProgress={learningProgress}
                    onAnswerLearningQuestion={handleAnswerLearningQuestion}
                    onSkipLearningQuestion={handleSkipLearningQuestion}
                    onContinueFromQuestion={handleContinueFromQuestion}
                    onDisableLearningMode={() => updateSettings({ learningModeEnabled: false })}
                    effectiveTheme={effectiveTheme}
                  />
                </div>
              </div>

              {/* BOTTOM PANEL: Advanced Playback Timeline, Speed, Key Stops, Console & Input */}
              <BottomDock
                appState={appState}
                totalSteps={totalSteps}
                currentStepIndex={currentStepIndex}
                events={traceDocument?.events || []}
                frame={currentFrame}
                isPlaying={isPlaying}
                speedMultiplier={settings.playbackSpeed}
                pauseOnImportantEvents={settings.pauseOnImportantEvents}
                learningModeEnabled={settings.learningModeEnabled}
                breakpoints={breakpoints}
                stdinText={stdinText}
                cliArgsText={cliArgsText}
                drawerOpen={drawerOpen}
                drawerTab={drawerTab}
                onDrawerOpenChange={setDrawerOpen}
                onDrawerTabChange={setDrawerTab}
                onStdinChange={setStdinText}
                onCliArgsChange={setCliArgsText}
                onPlay={handlePlay}
                onPause={handlePause}
                onNext={handleNext}
                onPrev={handlePrev}
                onJumpStart={handleJumpStart}
                onJumpEnd={handleJumpEnd}
                onRestart={handleRestart}
                onNextBreakpoint={handleNextBreakpoint}
                onSeek={handleSeek}
                onSpeedChange={(spd: PlaybackSpeedMultiplier) =>
                  updateSettings({ playbackSpeed: spd })
                }
                onTogglePauseOnImportant={() =>
                  updateSettings({ pauseOnImportantEvents: !settings.pauseOnImportantEvents })
                }
                onToggleLearningMode={() =>
                  updateSettings({ learningModeEnabled: !settings.learningModeEnabled })
                }
              />
            </>
          )}

          {activeNav === 'projects' && (
            <MyProjectsView
              projects={projects}
              activeProjectId={activeProjectId}
              storageNotice={storageNotice}
              onCreateNewProject={handleCreateNewProject}
              onSaveCurrentAsProject={handleSaveCurrentAsProject}
              onOpenProject={handleOpenProject}
              onRenameProject={handleRenameProject}
              onDuplicateProject={handleDuplicateProject}
              onDeleteProject={handleDeleteProject}
              onImportCodeAnimFile={handleImportFileObject}
            />
          )}

          {activeNav === 'history' && (
            <ExecutionHistoryView
              entries={historyEntries}
              historyEnabled={settings.historyEnabled}
              onReopenEntry={handleReopenHistory}
              onDeleteEntry={handleDeleteHistoryEntry}
              onClearHistory={handleClearHistory}
              onGoToSettings={() => setActiveNav('settings')}
            />
          )}

          {activeNav === 'learn' && (
            <LearnLibraryView onVisualizeExample={handleVisualizeLibraryExample} />
          )}

          {activeNav === 'compare' && (
            <CompareView
              onOpenInWorkspace={({ name, lang, code: c, stdin }) => {
                setActiveProjectId(null);
                setProjectName(name);
                setLanguage(lang);
                setCode(c);
                setStdinText(stdin);
                setAppState('EDITOR');
                setActiveNav('workspace');
              }}
            />
          )}

          {activeNav === 'settings' && (
            <SettingsView
              settings={settings}
              onUpdateSettings={updateSettings}
              onResetLocalData={handleResetLocalData}
              projectCount={projects.length}
              historyCount={historyEntries.length}
            />
          )}

          {activeNav === 'help' && <HelpDocsView />}
        </main>
      </div>
    </div>
  );
}
