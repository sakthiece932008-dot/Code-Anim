import type { TraceDocument, TraceEvent } from '../types/trace';
import { formatValue } from './explain';
import type { StorageLike } from './settingsStore';

export interface LearningQuestion {
  id: string;
  /** The step index where playback pauses BEFORE revealing the next step's outcome */
  pauseAtStepIndex: number;
  /** The verified step index that proves the correct answer */
  answerStepIndex: number;
  prompt: string;
  inputMode: 'choice' | 'text';
  choices?: string[];
  correctAnswer: string;
  simpleExplanation: string;
  eventKind: 'branch' | 'value' | 'return' | 'remove' | 'visit' | 'swap';
}

export interface LearningProgress {
  answered: number;
  correct: number;
  skipped: number;
  streak: number;
}

const PROGRESS_KEY = 'ca_learning_progress_v5';

function getSafeStorage(override?: StorageLike): StorageLike | null {
  if (override) return override;
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    return null;
  }
  return null;
}

export function loadLearningProgress(storage?: StorageLike): LearningProgress {
  const store = getSafeStorage(storage);
  if (!store) return { answered: 0, correct: 0, skipped: 0, streak: 0 };
  try {
    const raw = store.getItem(PROGRESS_KEY);
    if (!raw) return { answered: 0, correct: 0, skipped: 0, streak: 0 };
    const p = JSON.parse(raw) as Partial<LearningProgress>;
    return {
      answered: Number(p.answered) || 0,
      correct: Number(p.correct) || 0,
      skipped: Number(p.skipped) || 0,
      streak: Number(p.streak) || 0,
    };
  } catch {
    return { answered: 0, correct: 0, skipped: 0, streak: 0 };
  }
}

export function saveLearningProgress(progress: LearningProgress, storage?: StorageLike): void {
  const store = getSafeStorage(storage);
  if (!store) return;
  try {
    store.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // ignore storage errors
  }
}

function buildNumericDistractors(correctNum: number): string[] {
  const set = new Set<string>([String(correctNum)]);
  const offsets = [1, -1, 2, -2, 3, 5];
  for (const d of offsets) {
    if (set.size >= 4) break;
    set.add(String(correctNum + d));
  }
  return [...set].sort((a, b) => Number(a) - Number(b));
}

function normalizeAnswer(raw: string): string {
  return raw.trim().replace(/^["']|["']$/g, '').toLowerCase();
}

export function checkLearningAnswer(question: LearningQuestion, userAnswer: string): boolean {
  return normalizeAnswer(userAnswer) === normalizeAnswer(question.correctAnswer);
}

function isSimplePrimitive(val: unknown): val is string | number | boolean {
  return typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean';
}

function describeLineSnippet(codeLines: readonly string[], line: number): string {
  const text = (codeLines[line - 1] || '').trim();
  if (!text) return `line ${line}`;
  return text.length > 48 ? `${text.slice(0, 45)}…` : text;
}

/**
 * Generates grounded interactive learning questions strictly from verified trace events.
 * Works on any user-submitted program as well as built-in library examples.
 * Never fabricates answers that are not proven by the recorded trace.
 */
export function generateLearningQuestions(
  document: TraceDocument,
  codeLines: readonly string[],
  maxQuestions = 6
): LearningQuestion[] {
  const events = document.events;
  if (events.length < 2) return [];

  const questions: LearningQuestion[] = [];
  const usedPauseIndices = new Set<number>();

  const tryAdd = (q: LearningQuestion) => {
    if (questions.length >= maxQuestions) return;
    if (usedPauseIndices.has(q.pauseAtStepIndex)) return;
    // Space questions apart by at least 2 steps when possible
    if (questions.some((existing) => Math.abs(existing.pauseAtStepIndex - q.pauseAtStepIndex) < 2)) {
      return;
    }
    usedPauseIndices.add(q.pauseAtStepIndex);
    questions.push(q);
  };

  for (let i = 1; i < events.length; i++) {
    if (questions.length >= maxQuestions) break;
    const ev: TraceEvent = events[i];
    const pauseIdx = i - 1;
    const linePreview = describeLineSnippet(codeLines, ev.line);

    // 1. Verified branch decision (true / false)
    if (ev.type === 'branch_decision' && typeof ev.metadata.taken === 'boolean') {
      const taken = ev.metadata.taken;
      tryAdd({
        id: `q-branch-${i}`,
        pauseAtStepIndex: pauseIdx,
        answerStepIndex: i,
        prompt: `On line ${ev.line} (${linePreview}), will this check be true or false?`,
        inputMode: 'choice',
        choices: ['true', 'false'],
        correctAnswer: taken ? 'true' : 'false',
        simpleExplanation: taken
          ? `The check on line ${ev.line} is true with the current values, so the program goes inside this block.`
          : `The check on line ${ev.line} is false with the current values, so the program skips this block.`,
        eventKind: 'branch',
      });
      continue;
    }

    // 2. Verified function return value
    if (ev.type === 'function_return') {
      const top = ev.callStack[ev.callStack.length - 1];
      const ret = top?.returnValue;
      if (isSimplePrimitive(ret)) {
        const answerStr = String(ret);
        tryAdd({
          id: `q-ret-${i}`,
          pauseAtStepIndex: pauseIdx,
          answerStepIndex: i,
          prompt: `What value will "${ev.functionName}" return on line ${ev.line}?`,
          inputMode: typeof ret === 'number' ? 'choice' : 'text',
          choices: typeof ret === 'number' ? buildNumericDistractors(ret) : undefined,
          correctAnswer: answerStr,
          simpleExplanation: `The function "${ev.functionName}" finishes on line ${ev.line} and hands back ${formatValue(ret)}.`,
          eventKind: 'return',
        });
        continue;
      }
    }

    // 3. Verified array item removal
    if (ev.type === 'array_remove') {
      const delChange = ev.changes.find((c) => c.kind === 'delete' && isSimplePrimitive(c.oldValue));
      if (delChange && isSimplePrimitive(delChange.oldValue)) {
        const val = delChange.oldValue;
        tryAdd({
          id: `q-rem-${i}`,
          pauseAtStepIndex: pauseIdx,
          answerStepIndex: i,
          prompt: `Which value will be removed from "${delChange.target}" on line ${ev.line}?`,
          inputMode: typeof val === 'number' ? 'choice' : 'text',
          choices: typeof val === 'number' ? buildNumericDistractors(val) : undefined,
          correctAnswer: String(val),
          simpleExplanation: `On line ${ev.line}, ${formatValue(val)} is removed from "${delChange.target}".`,
          eventKind: 'remove',
        });
        continue;
      }
    }

    // 4. Verified primitive variable update
    if (ev.type === 'var_assign' || ev.type === 'var_declare' || ev.type === 'statement') {
      const change = ev.changes.find(
        (c) =>
          (c.kind === 'update' || c.kind === 'create') &&
          !c.property &&
          c.index === undefined &&
          isSimplePrimitive(c.newValue) &&
          typeof c.newValue === 'number'
      );
      if (change && typeof change.newValue === 'number') {
        const prevText =
          change.kind === 'update' && isSimplePrimitive(change.oldValue)
            ? ` (currently ${String(change.oldValue)})`
            : '';
        tryAdd({
          id: `q-var-${i}`,
          pauseAtStepIndex: pauseIdx,
          answerStepIndex: i,
          prompt: `After line ${ev.line} runs, what number will "${change.target}" hold${prevText}?`,
          inputMode: 'choice',
          choices: buildNumericDistractors(change.newValue),
          correctAnswer: String(change.newValue),
          simpleExplanation: `Line ${ev.line} updates "${change.target}" to ${change.newValue}.`,
          eventKind: 'value',
        });
      }
    }
  }

  return questions;
}
