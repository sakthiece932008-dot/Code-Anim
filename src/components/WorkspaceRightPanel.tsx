import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Cpu,
  Download,
  GraduationCap,
  HelpCircle,
  Layers,
  Loader2,
  MessageSquare,
  Send,
  Sparkles,
  Terminal,
  X,
  XCircle,
} from 'lucide-react';
import type {
  AppState,
  ErrorHelpReport,
  ExecutionMode,
  ExecutionSummary,
  LanguageId,
  StepExplanationBreakdown,
  TraceDocument,
} from '../types/trace';
import type { ReconstructedFrame } from '../lib/replayEngine';
import {
  buildStepExplanationBreakdown,
  formatValue,
  isLinkedList,
  isPrimitive,
  isTree,
  type CodeExample,
} from '../lib/explain';
import type { SimpleComplexityGuide } from '../lib/complexityExplainer';
import {
  checkLearningAnswer,
  type LearningProgress,
  type LearningQuestion,
} from '../lib/learningMode';
import {
  buildExecutionSummaryExportText,
  buildExplanationExportText,
  buildPortableProjectJson,
  buildTraceExportJson,
  buildVisualizationSvgSnapshot,
  exportSvgToPngDownload,
  getExtensionForLanguage,
  triggerTextDownload,
} from '../lib/exportImport';
import { getLanguageSpec } from '../lib/languageRegistry';
import { tokenizeSourceLine, type SyntaxTokenType } from '../lib/syntaxHighlight';
import { findActiveExpressionRange } from '../lib/expressionHighlight';
import type { UniversalVisualScene } from '../lib/universalVisualEngine';
import { VisualizerCanvas } from './VisualizerCanvas';

export type WorkspaceTab = 'animation' | 'explanation';
export type UtilityDrawerKind = 'none' | 'tutor' | 'summary';

interface TutorMessage {
  id: string;
  role: 'user' | 'tutor';
  text: string;
  isPrediction?: boolean;
  provider?: string;
  note?: string;
}

interface WorkspaceRightPanelProps {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  utilityDrawer: UtilityDrawerKind;
  onUtilityDrawerChange: (drawer: UtilityDrawerKind) => void;
  appState: AppState;
  language: LanguageId;
  languageName: string;
  projectName: string;
  code: string;
  codeLines: readonly string[];
  stdinText: string;
  cliArgsText: string;
  totalSteps: number;
  currentStepIndex: number;
  frame: ReconstructedFrame | null;
  prevFrame: ReconstructedFrame | null;
  nextFrame: ReconstructedFrame | null;
  traceDocument: TraceDocument | null;
  executionSummary: ExecutionSummary | null;
  complexityGuide: SimpleComplexityGuide | null;
  aiVisualScene: UniversalVisualScene | null;
  activeExecutionMode: ExecutionMode;
  errorMessage: string | null;
  errorHelp: ErrorHelpReport | null;
  errorHelpLoading?: boolean;
  traceWarning: string | null;
  simpleExplanationsEnabled: boolean;
  aiTutorEnabled: boolean;
  pendingTutorPrompt?: string | null;
  onConsumedTutorPrompt?: () => void;
  // Canvas callbacks
  onSelectExample: (example: CodeExample) => void;
  onApplySuggestedFix: (fixedCode: string) => void;
  onAskTutorAboutError?: (errorSummary: string) => void;
  onRetryVisualize: () => void;
  onCancelTrace: () => void;
  onBackToEditor: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  // Interactive Learning Mode
  learningModeEnabled: boolean;
  activeQuestion: LearningQuestion | null;
  learningProgress: LearningProgress;
  onAnswerLearningQuestion: (correct: boolean) => void;
  onSkipLearningQuestion: () => void;
  onContinueFromQuestion: () => void;
  onDisableLearningMode: () => void;
  effectiveTheme: 'dark' | 'light';
}

const TOKEN_CLASSES: Record<SyntaxTokenType, string> = {
  plain: '',
  keyword: 'ca-tok-keyword',
  string: 'ca-tok-string',
  number: 'ca-tok-number',
  comment: 'ca-tok-comment',
  type: 'ca-tok-type',
  function: 'ca-tok-function',
};

function summarizeVar(value: unknown): string {
  if (isPrimitive(value)) return formatValue(value);
  if (Array.isArray(value)) return `[${value.slice(0, 6).map((x) => formatValue(x)).join(', ')}${value.length > 6 ? ', …' : ''}]`;
  if (isTree(value)) return `Tree(${formatValue(value.value ?? value.val ?? value.data ?? 'node')})`;
  if (isLinkedList(value)) return `List(${formatValue(value.value ?? value.val ?? value.data ?? 'head')})`;
  return formatValue(value);
}

const QUICK_QUESTIONS = [
  { label: 'Explain this step', q: 'Explain what is happening in this exact step in very simple words.' },
  { label: 'Explain this line', q: 'What does the current highlighted line of code do?' },
  { label: 'Explain this structure', q: 'Explain the visible data structures and how their values connect right now.' },
  { label: 'Explain this error', q: 'What is the error or mistake in my code and how do I fix it?' },
  { label: 'Whole program', q: 'Explain what this whole program does from start to finish in simple terms.' },
  { label: 'Make it simpler', q: 'Explain the current step even more simply for a complete beginner.', simpler: true },
];

/**
 * Extracts only the variables most relevant to the current execution line or
 * modified on this step so relevant values appear naturally inside the
 * Explanation view without a separate State panel.
 */
function selectRelevantValues(
  frame: ReconstructedFrame,
  prevFrame: ReconstructedFrame | null,
  lineText: string
): Array<{ name: string; value: string; status: 'new' | 'changed' | 'referenced' }> {
  const vars = frame.step.vars;
  const prevVars = prevFrame?.step.vars || {};
  const changedNames = new Set(frame.event.changes.map((c) => c.target));
  const identifiers = new Set(lineText.match(/[A-Za-z_$][\w$]*/g) || []);

  const result: Array<{ name: string; value: string; status: 'new' | 'changed' | 'referenced' }> = [];
  const seen = new Set<string>();

  for (const [name, val] of Object.entries(vars)) {
    const isNew = !(name in prevVars);
    const isChanged =
      !isNew &&
      (changedNames.has(name) || JSON.stringify(val) !== JSON.stringify(prevVars[name]));
    const isMentioned = identifiers.has(name);

    if (isNew || isChanged || isMentioned) {
      seen.add(name);
      result.push({
        name,
        value: summarizeVar(val),
        status: isNew ? 'new' : isChanged ? 'changed' : 'referenced',
      });
    }
  }

  // If nothing matched (e.g., closing brace or return), show up to 4 active locals for context
  if (result.length === 0) {
    for (const [name, val] of Object.entries(vars).slice(0, 4)) {
      if (seen.has(name)) continue;
      result.push({ name, value: summarizeVar(val), status: 'referenced' });
    }
  }

  return result.slice(0, 8);
}

export const WorkspaceRightPanel = memo(function WorkspaceRightPanel({
  activeTab,
  onTabChange,
  utilityDrawer,
  onUtilityDrawerChange,
  appState,
  language,
  languageName,
  projectName,
  code,
  codeLines,
  stdinText,
  cliArgsText,
  totalSteps,
  currentStepIndex,
  frame,
  prevFrame,
  nextFrame,
  traceDocument,
  executionSummary,
  complexityGuide,
  aiVisualScene,
  activeExecutionMode,
  errorMessage,
  errorHelp,
  errorHelpLoading,
  traceWarning,
  simpleExplanationsEnabled,
  aiTutorEnabled,
  pendingTutorPrompt,
  onConsumedTutorPrompt,
  onSelectExample,
  onApplySuggestedFix,
  onAskTutorAboutError,
  onRetryVisualize,
  onCancelTrace,
  onBackToEditor,
  isFullscreen = false,
  onToggleFullscreen,
  learningModeEnabled,
  activeQuestion,
  learningProgress,
  onAnswerLearningQuestion,
  onSkipLearningQuestion,
  onContinueFromQuestion,
  onDisableLearningMode,
  effectiveTheme,
}: WorkspaceRightPanelProps) {
  const [showLearnMore, setShowLearnMore] = useState(false);

  // Learning Mode quiz state
  const [selectedChoice, setSelectedChoice] = useState('');
  const [typedAnswer, setTypedAnswer] = useState('');
  const [quizFeedback, setQuizFeedback] = useState<{
    checked: boolean;
    correct: boolean;
    revealed: boolean;
  } | null>(null);

  // AI Tutor state
  const [tutorMessages, setTutorMessages] = useState<TutorMessage[]>([]);
  const [tutorInput, setTutorInput] = useState('');
  const [tutorLoading, setTutorLoading] = useState(false);
  const [tutorError, setTutorError] = useState<string | null>(null);
  const tutorAbortRef = useRef<AbortController | null>(null);

  // Export feedback toast
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const isVisualizer = appState === 'VISUALIZER' && totalSteps > 0 && frame !== null;
  const isFinalStep = isVisualizer && currentStepIndex === totalSteps - 1;
  const langSpec = useMemo(() => getLanguageSpec(language), [language]);
  const syntaxGroup = langSpec?.syntaxGroup || 'plain';

  useEffect(() => {
    setSelectedChoice('');
    setTypedAnswer('');
    setQuizFeedback(null);
  }, [activeQuestion?.id]);

  useEffect(() => {
    return () => {
      tutorAbortRef.current?.abort();
    };
  }, []);

  const breakdown: StepExplanationBreakdown | null = useMemo(() => {
    if (!isVisualizer || !frame) return null;
    return buildStepExplanationBreakdown({
      event: frame.event,
      prevEvent: prevFrame?.event ?? null,
      step: frame.step,
      prevStep: prevFrame?.step ?? null,
      codeLines,
      programPurpose:
        executionSummary?.purpose ||
        'Runs the program line by line and updates values in memory.',
      isFinalStep,
      stoppedEarly: executionSummary?.status === 'stopped_early',
    });
  }, [isVisualizer, frame, prevFrame, codeLines, executionSummary, isFinalStep]);

  const activeSourceLine = useMemo(() => {
    if (!frame) return '';
    return codeLines[frame.line - 1] ?? '';
  }, [frame, codeLines]);

  const activeLineTokens = useMemo(
    () => tokenizeSourceLine(activeSourceLine, syntaxGroup),
    [activeSourceLine, syntaxGroup]
  );

  const activeExprRange = useMemo(
    () => (frame ? findActiveExpressionRange(activeSourceLine, frame.event) : null),
    [frame, activeSourceLine]
  );

  const relevantValues = useMemo(
    () => (frame ? selectRelevantValues(frame, prevFrame, activeSourceLine) : []),
    [frame, prevFrame, activeSourceLine]
  );

  const askTutor = useCallback(
    async (questionText: string, simpler = false) => {
      const q = questionText.trim();
      if (!q || !aiTutorEnabled) return;

      tutorAbortRef.current?.abort();
      const controller = new AbortController();
      tutorAbortRef.current = controller;

      setTutorError(null);
      setTutorLoading(true);
      setTutorMessages((prev) => [
        ...prev.slice(-14),
        { id: `u-${Date.now()}`, role: 'user', text: q },
      ]);

      const varsSummary = frame
        ? Object.entries(frame.step.vars)
            .slice(0, 12)
            .map(([k, v]) => `${k}=${summarizeVar(v)}`)
            .join(', ')
        : '';

      const structuresSummary = frame
        ? frame.workspace.structures
            .map((s) => `${s.names.join('/')} (${s.kind})`)
            .join(', ')
        : '';

      const callStackSummary = frame
        ? frame.callStack.map((f) => `${f.name}(L${f.line})`).join(' -> ')
        : 'main';

      const nextStepPreview = nextFrame
        ? `Line ${nextFrame.line}: ${nextFrame.event.explanation || (codeLines[nextFrame.line - 1] || '').trim()}`
        : '';

      try {
        const res = await fetch('/api/tutor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            question: q,
            lang: language,
            code,
            currentStepIndex,
            totalSteps,
            currentLine: frame?.line ?? 1,
            currentCodeLine: frame ? codeLines[frame.line - 1] || '' : '',
            stepExplanation: breakdown?.whatIsHappeningNow || '',
            varsSummary,
            structuresSummary,
            callStackSummary,
            stdin: stdinText,
            outText: frame?.outText || '',
            errorMessage: errorMessage || '',
            nextStepPreview,
            simpler,
          }),
        });

        const data = (await res.json()) as {
          answer?: string;
          isPrediction?: boolean;
          provider?: string;
          note?: string;
          error?: string;
        };

        if (!res.ok) {
          throw new Error(data.error || `Tutor request failed (HTTP ${res.status}).`);
        }

        setTutorMessages((prev) => [
          ...prev,
          {
            id: `t-${Date.now()}`,
            role: 'tutor',
            text: data.answer || 'No explanation was returned.',
            isPrediction: data.isPrediction === true,
            provider: data.provider || 'Tutor',
            note: data.note,
          },
        ]);
      } catch (err) {
        if (controller.signal.aborted) return;
        setTutorError(
          err instanceof Error ? err.message : 'Could not reach the AI Tutor right now.'
        );
      } finally {
        if (tutorAbortRef.current === controller) {
          tutorAbortRef.current = null;
          setTutorLoading(false);
        }
      }
    },
    [
      aiTutorEnabled,
      frame,
      nextFrame,
      language,
      code,
      currentStepIndex,
      totalSteps,
      codeLines,
      breakdown,
      stdinText,
      errorMessage,
    ]
  );

  useEffect(() => {
    if (pendingTutorPrompt && aiTutorEnabled) {
      onUtilityDrawerChange('tutor');
      void askTutor(pendingTutorPrompt);
      onConsumedTutorPrompt?.();
    }
  }, [pendingTutorPrompt, aiTutorEnabled, onUtilityDrawerChange, askTutor, onConsumedTutorPrompt]);

  const handleSubmitQuiz = () => {
    if (!activeQuestion) return;
    const raw = activeQuestion.inputMode === 'choice' ? selectedChoice : typedAnswer;
    if (!raw.trim()) return;
    const correct = checkLearningAnswer(activeQuestion, raw);
    setQuizFeedback({ checked: true, correct, revealed: false });
    onAnswerLearningQuestion(correct);
  };

  const handleRevealQuiz = () => {
    if (!activeQuestion) return;
    setQuizFeedback({ checked: true, correct: false, revealed: true });
  };

  const notifyExport = (msg: string) => {
    setExportStatus(msg);
    window.setTimeout(() => setExportStatus(null), 2600);
  };

  const safeBase = projectName.toLowerCase().replace(/[^a-z0-9-_]+/g, '_') || 'code_anim';
  const topCallFrame = isVisualizer && frame.callStack.length > 0
    ? frame.callStack[frame.callStack.length - 1]
    : null;
  const isSimulated = activeExecutionMode === 'simulated';

  return (
    <section
      aria-label="Visualization and Explanation Workspace"
      className="relative flex flex-col rounded-xl border ca-surface overflow-hidden h-full min-h-[320px]"
    >
      {/* Top Tab Bar: EXACTLY TWO PRIMARY TABS (Animation | Explanation) + Compact Utility Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 border-b ca-surface-2 shrink-0">
        <div
          role="tablist"
          aria-label="Workspace primary tabs"
          className="inline-flex items-center gap-1"
        >
          <button
            type="button"
            role="tab"
            id="workspace-tab-animation"
            aria-selected={activeTab === 'animation'}
            aria-controls="workspace-panel-animation"
            onClick={() => onTabChange('animation')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === 'animation'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'ca-text-muted hover:text-[var(--ca-text)] hover:bg-slate-500/10'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Animation</span>
          </button>

          <button
            type="button"
            role="tab"
            id="workspace-tab-explanation"
            aria-selected={activeTab === 'explanation'}
            aria-controls="workspace-panel-explanation"
            onClick={() => onTabChange('explanation')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === 'explanation'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'ca-text-muted hover:text-[var(--ca-text)] hover:bg-slate-500/10'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Explanation</span>
            {activeQuestion && learningModeEnabled && (
              <span
                aria-label="Learning checkpoint active"
                className="text-[10px] font-bold text-amber-300"
              >
                ●
              </span>
            )}
          </button>
        </div>

        {/* Secondary workspace utilities (outside the two primary tabs) */}
        <div className="flex items-center gap-1.5">
          {isVisualizer && frame && (
            <span className="hidden sm:inline font-mono text-[11px] ca-text-muted tabular-nums mr-1">
              Step {currentStepIndex + 1}/{totalSteps} · Line {frame.line}
            </span>
          )}

          {aiTutorEnabled && (
            <button
              type="button"
              onClick={() =>
                onUtilityDrawerChange(utilityDrawer === 'tutor' ? 'none' : 'tutor')
              }
              aria-expanded={utilityDrawer === 'tutor'}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors cursor-pointer ${
                utilityDrawer === 'tutor'
                  ? 'border-indigo-400 bg-indigo-500/20 text-indigo-200'
                  : 'border-[var(--ca-border-strong)] ca-text-muted hover:text-[var(--ca-text)] hover:bg-slate-500/10'
              }`}
            >
              <MessageSquare className="w-3 h-3" />
              <span>AI Tutor</span>
            </button>
          )}

          <button
            type="button"
            onClick={() =>
              onUtilityDrawerChange(utilityDrawer === 'summary' ? 'none' : 'summary')
            }
            aria-expanded={utilityDrawer === 'summary'}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors cursor-pointer ${
              utilityDrawer === 'summary'
                ? 'border-indigo-400 bg-indigo-500/20 text-indigo-200'
                : 'border-[var(--ca-border-strong)] ca-text-muted hover:text-[var(--ca-text)] hover:bg-slate-500/10'
            }`}
          >
            <ClipboardList className="w-3 h-3" />
            <span className="hidden sm:inline">Summary & Export</span>
            <span className="sm:hidden">Export</span>
          </button>
        </div>
      </div>

      {/* Primary Tab Panels */}
      <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* TAB 1: ANIMATION */}
        {activeTab === 'animation' && (
          <div
            role="tabpanel"
            id="workspace-panel-animation"
            aria-labelledby="workspace-tab-animation"
            className="flex-1 min-h-0 flex flex-col"
          >
            <VisualizerCanvas
              embedded
              appState={appState}
              languageLabel={languageName}
              sourceCode={code}
              traceDocument={traceDocument}
              currentStepIndex={currentStepIndex}
              aiVisualScene={aiVisualScene}
              frame={frame}
              prevFrame={prevFrame}
              errorMessage={errorMessage}
              errorHelp={errorHelp}
              errorHelpLoading={errorHelpLoading}
              traceWarning={traceWarning}
              onSelectExample={onSelectExample}
              onApplySuggestedFix={onApplySuggestedFix}
              onAskTutorAboutError={onAskTutorAboutError}
              onRetryVisualize={onRetryVisualize}
              onCancelTrace={onCancelTrace}
              onBackToEditor={onBackToEditor}
              isFullscreen={isFullscreen}
              onToggleFullscreen={onToggleFullscreen}
            />
          </div>
        )}

        {/* TAB 2: EXPLANATION */}
        {activeTab === 'explanation' && (
          <div
            role="tabpanel"
            id="workspace-panel-explanation"
            aria-labelledby="workspace-tab-explanation"
            className="flex-1 min-h-0 overflow-auto p-4 sm:p-5 text-sm space-y-4"
          >
            {/* Interactive Learning Mode Prompt */}
            {learningModeEnabled && activeQuestion && (
              <div
                role="region"
                aria-label="Learning Mode Question"
                className="rounded-xl border border-indigo-500/50 bg-indigo-500/10 p-3.5 space-y-2.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-semibold text-indigo-300">
                    <GraduationCap className="w-4 h-4" />
                    <span>Quick Check (Learning Mode)</span>
                  </div>
                  <span className="font-mono text-[11px] ca-text-muted tabular-nums">
                    {learningProgress.correct}/{learningProgress.answered} right
                  </span>
                </div>

                <p className="leading-relaxed font-medium text-sm">{activeQuestion.prompt}</p>

                {activeQuestion.inputMode === 'choice' && activeQuestion.choices ? (
                  <div className="grid grid-cols-2 gap-1.5">
                    {activeQuestion.choices.map((choice) => (
                      <button
                        key={choice}
                        type="button"
                        disabled={Boolean(quizFeedback?.checked)}
                        onClick={() => setSelectedChoice(choice)}
                        className={`px-2.5 py-1.5 rounded-md border font-mono text-xs cursor-pointer transition-colors ${
                          selectedChoice === choice
                            ? 'border-indigo-400 bg-indigo-600 text-white'
                            : 'border-slate-600/70 hover:bg-slate-500/15'
                        }`}
                      >
                        {choice}
                      </button>
                    ))}
                  </div>
                ) : (
                  <input
                    type="text"
                    value={typedAnswer}
                    disabled={Boolean(quizFeedback?.checked)}
                    onChange={(e) => setTypedAnswer(e.target.value)}
                    placeholder="Type your prediction…"
                    aria-label="Your answer"
                    className="w-full px-2.5 py-1.5 rounded-md border border-slate-600/70 bg-transparent font-mono text-xs"
                  />
                )}

                {quizFeedback?.checked ? (
                  <div className="space-y-2 pt-1">
                    <div
                      className={`font-semibold ${
                        quizFeedback.correct ? 'text-emerald-400' : 'text-amber-400'
                      }`}
                    >
                      {quizFeedback.correct
                        ? 'Correct!'
                        : `Answer: ${activeQuestion.correctAnswer}`}
                    </div>
                    <p className="ca-text-muted leading-relaxed">
                      {activeQuestion.simpleExplanation}
                    </p>
                    <button
                      type="button"
                      onClick={onContinueFromQuestion}
                      className="px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white font-semibold cursor-pointer"
                    >
                      Continue Playback
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleSubmitQuiz}
                      disabled={
                        activeQuestion.inputMode === 'choice'
                          ? !selectedChoice
                          : !typedAnswer.trim()
                      }
                      className="px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white font-semibold disabled:opacity-40 cursor-pointer"
                    >
                      Check Answer
                    </button>
                    <button
                      type="button"
                      onClick={handleRevealQuiz}
                      className="px-2.5 py-1.5 rounded-md border border-slate-600/70 hover:bg-slate-500/15 cursor-pointer"
                    >
                      Reveal
                    </button>
                    <button
                      type="button"
                      onClick={onSkipLearningQuestion}
                      className="px-2 py-1.5 ca-text-muted hover:underline cursor-pointer"
                    >
                      Skip
                    </button>
                    <button
                      type="button"
                      onClick={onDisableLearningMode}
                      className="ml-auto text-[11px] ca-text-muted hover:underline cursor-pointer"
                    >
                      Turn off
                    </button>
                  </div>
                )}
              </div>
            )}

            {!isVisualizer || !breakdown || !frame ? (
              <div className="max-w-xl space-y-3 py-4">
                <div className="flex items-center gap-2 text-indigo-400 font-semibold text-sm">
                  <BookOpen className="w-4 h-4" />
                  <span>Step-by-Step Explanations</span>
                </div>
                <p className="ca-text-muted leading-relaxed text-xs sm:text-sm">
                  Click <strong className="text-[var(--ca-text)]">Visualize</strong> to walk through
                  your program line by line in simple English. Every step highlights the exact line
                  in the Source Code panel on the left and explains what is happening, what changed,
                  why it happened, and the result.
                </p>
              </div>
            ) : (
              <div className="max-w-2xl space-y-4">
                {/* Step & Mode Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--ca-border)]">
                  <div className="flex items-center gap-2.5">
                    <span className="text-sm font-bold text-amber-400 tabular-nums">
                      Step {currentStepIndex + 1} of {totalSteps}
                    </span>
                    <span aria-hidden="true" className="ca-text-muted">·</span>
                    <span className="font-mono text-xs font-semibold ca-text-muted tabular-nums">
                      Line {frame.line}
                    </span>
                    {topCallFrame && topCallFrame.name !== 'main' && (
                      <>
                        <span aria-hidden="true" className="ca-text-muted">·</span>
                        <span className="font-mono text-xs text-sky-400">
                          in {topCallFrame.name}()
                        </span>
                      </>
                    )}
                  </div>

                  <span
                    className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                      isSimulated ? 'text-amber-400' : 'text-emerald-400'
                    }`}
                  >
                    {isSimulated ? (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>AI-Simulated Step</span>
                      </>
                    ) : (
                      <>
                        <Cpu className="w-3.5 h-3.5" />
                        <span>Observed Live Execution</span>
                      </>
                    )}
                  </span>
                </div>

                {/* Corresponding Source Code Line Preview */}
                <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3.5 py-2.5 space-y-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-400">
                    Executing Line {frame.line}
                  </div>
                  <div className="font-mono text-xs sm:text-sm overflow-x-auto whitespace-pre flex items-center gap-2">
                    <span className="text-amber-400 font-bold select-none" aria-hidden="true">
                      ▶
                    </span>
                    <span>
                      {(() => {
                        if (!activeExprRange) {
                          return activeLineTokens.map((tok, tIdx) => (
                            <span key={tIdx} className={TOKEN_CLASSES[tok.type]}>
                              {tok.text}
                            </span>
                          ));
                        }
                        let cursor = 0;
                        return activeLineTokens.map((tok, tIdx) => {
                          const tokStart = cursor;
                          const tokEnd = cursor + tok.text.length;
                          cursor = tokEnd;
                          const hlStart = Math.max(tokStart, activeExprRange.start);
                          const hlEnd = Math.min(tokEnd, activeExprRange.end);
                          if (hlStart >= hlEnd) {
                            return (
                              <span key={tIdx} className={TOKEN_CLASSES[tok.type]}>
                                {tok.text}
                              </span>
                            );
                          }
                          return (
                            <span key={tIdx} className={TOKEN_CLASSES[tok.type]}>
                              {tok.text.slice(0, hlStart - tokStart)}
                              <mark className="bg-amber-400/35 text-inherit ring-1 ring-amber-400/75 rounded-[3px] px-0.5 font-semibold">
                                {tok.text.slice(hlStart - tokStart, hlEnd - tokStart)}
                              </mark>
                              {tok.text.slice(hlEnd - tokStart)}
                            </span>
                          );
                        });
                      })()}
                    </span>
                  </div>
                </div>

                {simpleExplanationsEnabled ? (
                  <div className="space-y-3.5">
                    {/* What is happening */}
                    <div className="space-y-1">
                      <div className="text-xs font-semibold uppercase tracking-wide ca-text-muted">
                        What is happening
                      </div>
                      <p className="text-sm sm:text-[15px] font-medium leading-relaxed">
                        {breakdown.whatIsHappeningNow}
                      </p>
                    </div>

                    {/* What changed */}
                    <div className="space-y-1.5">
                      <div className="text-xs font-semibold uppercase tracking-wide text-emerald-400">
                        What changed
                      </div>
                      {breakdown.whatChanged.length === 0 ? (
                        <p className="text-xs sm:text-sm ca-text-muted leading-relaxed">
                          No stored values changed on this step.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {breakdown.whatChanged.map((ch, idx) => (
                            <div
                              key={`${ch.label}-${idx}`}
                              className="flex flex-wrap items-baseline gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/8 px-3 py-1.5 font-mono text-xs"
                            >
                              <span className="text-indigo-400 font-semibold">{ch.label}</span>
                              <span className="ca-text-muted">{ch.before}</span>
                              <span aria-hidden="true" className="text-amber-400 font-bold">
                                →
                              </span>
                              <span className="text-emerald-400 font-semibold">{ch.after}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Why it happened */}
                    {breakdown.whyIsThisHappening && (
                      <div className="space-y-1">
                        <div className="text-xs font-semibold uppercase tracking-wide text-sky-400">
                          Why it happened
                        </div>
                        <p className="text-xs sm:text-sm ca-text-muted leading-relaxed">
                          {breakdown.whyIsThisHappening}
                        </p>
                      </div>
                    )}

                    {/* Relevant values (integrated naturally — no separate State panel) */}
                    {relevantValues.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-xs font-semibold uppercase tracking-wide text-indigo-400">
                          Relevant values right now
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {relevantValues.map((rv) => (
                            <div
                              key={rv.name}
                              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-xs tabular-nums ${
                                rv.status === 'new'
                                  ? 'border-emerald-500/45 bg-emerald-500/10'
                                  : rv.status === 'changed'
                                    ? 'border-amber-500/45 bg-amber-500/10'
                                    : 'border-[var(--ca-border-strong)] ca-surface-2'
                              }`}
                            >
                              <span className="text-indigo-400 font-semibold">{rv.name}</span>
                              <span className="ca-text-muted">=</span>
                              <span className="font-semibold">{rv.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Observed vs AI-Simulated Result */}
                    {(frame.print || breakdown.finalResult || (isFinalStep && frame.outText)) && (
                      <div
                        className={`rounded-lg border p-3 space-y-1.5 ${
                          isSimulated
                            ? 'border-amber-500/40 bg-amber-500/10'
                            : 'border-emerald-500/40 bg-emerald-500/10'
                        }`}
                      >
                        <div
                          className={`flex items-center gap-1.5 text-xs font-semibold ${
                            isSimulated ? 'text-amber-300' : 'text-emerald-400'
                          }`}
                        >
                          {frame.print ? (
                            <Terminal className="w-3.5 h-3.5" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          )}
                          <span>
                            {isSimulated
                              ? 'Simulated Result (AI Estimate)'
                              : 'Observed Result (Live Execution)'}
                          </span>
                        </div>
                        {frame.print && (
                          <div className="font-mono text-xs bg-black/25 rounded px-2.5 py-1.5 whitespace-pre-wrap">
                            {frame.print}
                          </div>
                        )}
                        {breakdown.finalResult && (
                          <p className="text-xs sm:text-sm leading-relaxed">
                            {breakdown.finalResult}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold ca-text-muted">Technical Step Trace</div>
                    <p className="font-mono text-xs leading-relaxed p-3 rounded-lg ca-surface-2 border">
                      {breakdown.technicalDetail}
                    </p>
                  </div>
                )}

                {/* Optional Learn More Technical Details */}
                <div className="pt-3 border-t border-[var(--ca-border)]">
                  <button
                    type="button"
                    onClick={() => setShowLearnMore((v) => !v)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-400 hover:underline cursor-pointer"
                  >
                    {showLearnMore ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                    <span>Learn More</span>
                  </button>
                  {showLearnMore && (
                    <div className="mt-2.5 p-3 rounded-lg ca-surface-2 border space-y-2 text-xs">
                      <div className="font-mono leading-relaxed">{breakdown.technicalDetail}</div>
                      <div className="ca-text-muted leading-relaxed">
                        <strong>What this means:</strong> {breakdown.whatDoesThisMean}
                      </div>
                      <div className="ca-text-muted leading-relaxed">
                        <strong>Program overview:</strong> {breakdown.whatProgramDoes}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* SLIDE-OVER UTILITY DRAWER: AI Tutor OR Summary & Export (outside primary tabs) */}
        {utilityDrawer !== 'none' && (
          <div className="absolute inset-0 z-30 flex justify-end bg-black/45">
            <div
              className="flex-1"
              onClick={() => onUtilityDrawerChange('none')}
              aria-hidden="true"
            />
            <aside
              aria-label={utilityDrawer === 'tutor' ? 'AI Tutor' : 'Summary and Export'}
              className="w-full sm:w-[360px] max-w-full h-full ca-surface border-l border-[var(--ca-border-strong)] shadow-2xl flex flex-col overflow-hidden"
            >
              <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b ca-surface-2">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  {utilityDrawer === 'tutor' ? (
                    <>
                      <MessageSquare className="w-4 h-4 text-indigo-400" />
                      <span>AI Tutor</span>
                    </>
                  ) : (
                    <>
                      <ClipboardList className="w-4 h-4 text-indigo-400" />
                      <span>Summary & Export</span>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onUtilityDrawerChange('none')}
                  aria-label="Close panel"
                  className="p-1 rounded-md ca-text-muted hover:text-[var(--ca-text)] hover:bg-slate-500/15 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-auto p-3.5 text-xs">
                {utilityDrawer === 'tutor' && (
                  <div className="flex flex-col h-full gap-3">
                    <div className="space-y-1.5">
                      <div className="text-[11px] ca-text-muted">
                        Ask about your current code, step, variables, or errors. Grounded strictly in verified trace data.
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {QUICK_QUESTIONS.map((item) => (
                          <button
                            key={item.label}
                            type="button"
                            disabled={tutorLoading}
                            onClick={() => void askTutor(item.q, item.simpler)}
                            className="px-2 py-1 rounded-md border border-slate-600/60 hover:border-indigo-400 hover:bg-indigo-500/10 text-[11px] cursor-pointer disabled:opacity-40"
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex-1 overflow-auto space-y-2.5 min-h-[140px]">
                      {tutorMessages.length === 0 ? (
                        <div className="p-3 rounded-lg border ca-surface-2 ca-text-muted space-y-1.5">
                          <div className="flex items-center gap-1.5 font-medium">
                            <HelpCircle className="w-3.5 h-3.5 text-indigo-400" />
                            <span>Try asking:</span>
                          </div>
                          <p>"Why did this number change?"</p>
                          <p>"What will happen in the next step?"</p>
                          <p>"Why is this node connected here?"</p>
                        </div>
                      ) : (
                        tutorMessages.map((m) => (
                          <div
                            key={m.id}
                            className={`rounded-lg p-2.5 border leading-relaxed ${
                              m.role === 'user'
                                ? 'border-indigo-500/40 bg-indigo-500/10 ml-4'
                                : 'ca-surface-2 mr-2'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 text-[10px] ca-text-muted mb-1">
                              <span className="font-semibold">
                                {m.role === 'user' ? 'You' : `Code Anim Tutor (${m.provider || 'Tutor'})`}
                              </span>
                              {m.role === 'tutor' && (
                                <span>{m.isPrediction ? 'Prediction' : 'From trace'}</span>
                              )}
                            </div>
                            <p className="whitespace-pre-wrap">{m.text}</p>
                            {m.note && <p className="text-[10px] ca-text-muted mt-1">{m.note}</p>}
                          </div>
                        ))
                      )}

                      {tutorLoading && (
                        <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg border ca-surface-2">
                          <span className="inline-flex items-center gap-1.5 ca-text-muted">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                            <span>Thinking from your execution trace…</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              tutorAbortRef.current?.abort();
                              setTutorLoading(false);
                            }}
                            className="inline-flex items-center gap-1 text-[11px] text-red-400 hover:underline cursor-pointer"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Cancel</span>
                          </button>
                        </div>
                      )}

                      {tutorError && (
                        <div className="p-2.5 rounded-lg border border-red-500/40 bg-red-500/10 text-red-300">
                          {tutorError}
                        </div>
                      )}
                    </div>

                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!tutorInput.trim() || tutorLoading) return;
                        const q = tutorInput;
                        setTutorInput('');
                        void askTutor(q);
                      }}
                      className="flex items-center gap-1.5 pt-2 border-t border-slate-700/50"
                    >
                      <input
                        type="text"
                        value={tutorInput}
                        onChange={(e) => setTutorInput(e.target.value)}
                        placeholder="Ask about this step, variable, or error…"
                        aria-label="Ask AI Tutor"
                        className="flex-1 px-2.5 py-2 rounded-lg border border-slate-600/70 bg-transparent text-xs"
                      />
                      <button
                        type="submit"
                        disabled={tutorLoading || !tutorInput.trim()}
                        aria-label="Send question"
                        className="p-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  </div>
                )}

                {utilityDrawer === 'summary' && (
                  <div className="space-y-4">
                    {!executionSummary ? (
                      <p className="ca-text-muted">
                        Run <strong>Visualize</strong> to generate the execution summary, complexity
                        guide, and exportable snapshots.
                      </p>
                    ) : (
                      <>
                        <div className="space-y-1.5">
                          <div className="font-semibold text-indigo-400">Program Summary</div>
                          <p className="leading-relaxed">{executionSummary.purpose}</p>
                          <div className="ca-text-muted tabular-nums">
                            {executionSummary.detectedLanguage} ·{' '}
                            {executionSummary.executionMode === 'real'
                              ? 'Live execution'
                              : 'AI simulation'}{' '}
                            · {executionSummary.stepCount} recorded steps
                            {executionSummary.measuredDurationMs !== undefined
                              ? ` · ${executionSummary.measuredDurationMs} ms trace time`
                              : ''}
                          </div>
                        </div>

                        {complexityGuide && (
                          <div className="p-3 rounded-lg border ca-surface-2 space-y-2">
                            <div className="font-semibold text-amber-400">
                              Simple Complexity Guide (Theoretical)
                            </div>
                            <div className="space-y-1">
                              <div className="font-mono font-semibold">
                                Time: {complexityGuide.timeNotation || 'Not determined confidently'}
                              </div>
                              <p className="ca-text-muted leading-relaxed">
                                {complexityGuide.timeSimpleExplanation}
                              </p>
                            </div>
                            <div className="space-y-1">
                              <div className="font-mono font-semibold">
                                Memory: {complexityGuide.spaceNotation || 'Not determined confidently'}
                              </div>
                              <p className="ca-text-muted leading-relaxed">
                                {complexityGuide.spaceSimpleExplanation}
                              </p>
                            </div>
                            <div className="pt-1.5 border-t border-slate-700/50 font-mono text-[11px] ca-text-muted tabular-nums">
                              Observed counts: {complexityGuide.observedMetrics.comparisonsOrBranches} checks ·{' '}
                              {complexityGuide.observedMetrics.swaps} swaps ·{' '}
                              {complexityGuide.observedMetrics.loopIterations} loop rounds ·{' '}
                              {complexityGuide.observedMetrics.functionCalls} calls
                            </div>
                            <p className="text-[11px] ca-text-muted italic">
                              {complexityGuide.disclaimer}
                            </p>
                          </div>
                        )}

                        <div className="space-y-1">
                          <div className="font-semibold text-sky-400">Detected Structures</div>
                          <p className="ca-text-muted">
                            {executionSummary.detectedStructures.join(' · ')}
                          </p>
                        </div>

                        <div className="pt-2 border-t border-slate-700/50 space-y-2">
                          <div className="flex items-center gap-1.5 font-semibold">
                            <Download className="w-3.5 h-3.5 text-indigo-400" />
                            <span>Export Verified Outputs</span>
                          </div>
                          <div className="grid grid-cols-2 gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                triggerTextDownload(
                                  `${safeBase}${getExtensionForLanguage(language)}`,
                                  code,
                                  'text/plain;charset=utf-8'
                                );
                                notifyExport('Downloaded source file.');
                              }}
                              className="px-2.5 py-1.5 rounded-md border border-slate-600/70 hover:bg-slate-500/15 text-left cursor-pointer"
                            >
                              Source Code
                            </button>

                            <button
                              type="button"
                              disabled={!traceDocument}
                              onClick={() => {
                                if (!traceDocument) return;
                                triggerTextDownload(
                                  `${safeBase}.trace.json`,
                                  buildTraceExportJson({
                                    name: projectName,
                                    code,
                                    stdin: stdinText,
                                    document: traceDocument,
                                  }),
                                  'application/json;charset=utf-8'
                                );
                                notifyExport('Downloaded trace JSON.');
                              }}
                              className="px-2.5 py-1.5 rounded-md border border-slate-600/70 hover:bg-slate-500/15 text-left disabled:opacity-40 cursor-pointer"
                            >
                              Trace JSON
                            </button>

                            <button
                              type="button"
                              disabled={!frame}
                              onClick={() => {
                                if (!frame) return;
                                const svg = buildVisualizationSvgSnapshot({
                                  projectName,
                                  frame,
                                  totalSteps,
                                  theme: effectiveTheme,
                                });
                                triggerTextDownload(
                                  `${safeBase}_step${frame.index + 1}.svg`,
                                  svg,
                                  'image/svg+xml;charset=utf-8'
                                );
                                notifyExport('Downloaded SVG snapshot.');
                              }}
                              className="px-2.5 py-1.5 rounded-md border border-slate-600/70 hover:bg-slate-500/15 text-left disabled:opacity-40 cursor-pointer"
                            >
                              Visual (SVG)
                            </button>

                            <button
                              type="button"
                              disabled={!frame}
                              onClick={() => {
                                if (!frame) return;
                                const svg = buildVisualizationSvgSnapshot({
                                  projectName,
                                  frame,
                                  totalSteps,
                                  theme: effectiveTheme,
                                });
                                void exportSvgToPngDownload(
                                  `${safeBase}_step${frame.index + 1}.png`,
                                  svg
                                ).then((ok) =>
                                  notifyExport(
                                    ok
                                      ? 'Downloaded PNG screenshot.'
                                      : 'PNG export unavailable in this browser.'
                                  )
                                );
                              }}
                              className="px-2.5 py-1.5 rounded-md border border-slate-600/70 hover:bg-slate-500/15 text-left disabled:opacity-40 cursor-pointer"
                            >
                              Screenshot (PNG)
                            </button>

                            <button
                              type="button"
                              disabled={!frame || !breakdown}
                              onClick={() => {
                                if (!frame || !breakdown) return;
                                triggerTextDownload(
                                  `${safeBase}_step${frame.index + 1}_explanation.txt`,
                                  buildExplanationExportText({
                                    projectName,
                                    languageName,
                                    stepNumber: frame.index + 1,
                                    totalSteps,
                                    line: frame.line,
                                    breakdown,
                                    codeLine: codeLines[frame.line - 1] || '',
                                  }),
                                  'text/plain;charset=utf-8'
                                );
                                notifyExport('Downloaded explanation text.');
                              }}
                              className="px-2.5 py-1.5 rounded-md border border-slate-600/70 hover:bg-slate-500/15 text-left disabled:opacity-40 cursor-pointer"
                            >
                              Explanation (.txt)
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                triggerTextDownload(
                                  `${safeBase}_summary.txt`,
                                  buildExecutionSummaryExportText(projectName, executionSummary),
                                  'text/plain;charset=utf-8'
                                );
                                notifyExport('Downloaded execution summary.');
                              }}
                              className="px-2.5 py-1.5 rounded-md border border-slate-600/70 hover:bg-slate-500/15 text-left cursor-pointer"
                            >
                              Summary (.txt)
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                triggerTextDownload(
                                  `${safeBase}.codeanim.json`,
                                  buildPortableProjectJson({
                                    name: projectName,
                                    language,
                                    code,
                                    stdin: stdinText,
                                    cliArgs: cliArgsText,
                                  }),
                                  'application/json;charset=utf-8'
                                );
                                notifyExport('Downloaded portable project file.');
                              }}
                              className="col-span-2 px-2.5 py-1.5 rounded-md border border-indigo-500/50 bg-indigo-500/10 hover:bg-indigo-500/20 text-left font-medium cursor-pointer"
                            >
                              Portable Project (.codeanim.json)
                            </button>
                          </div>
                          {exportStatus && (
                            <p className="text-[11px] text-emerald-400">{exportStatus}</p>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </aside>
          </div>
        )}
      </div>
    </section>
  );
});
