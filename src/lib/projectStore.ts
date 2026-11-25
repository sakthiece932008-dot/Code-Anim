import type { ExecutionMode, LanguageId } from '../types/trace';
import { isLanguageSelectable } from './languageRegistry';
import type { StorageLike } from './settingsStore';

export interface SavedProject {
  id: string;
  name: string;
  language: LanguageId;
  code: string;
  stdin: string;
  cliArgs: string;
  visualizationPrefs?: {
    focusedStructureName?: string | null;
    playbackSpeed?: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionHistoryEntry {
  id: string;
  projectName: string;
  language: LanguageId;
  executionMode: ExecutionMode;
  executedAt: string;
  code: string;
  stdin: string;
  cliArgs: string;
  status: 'completed' | 'stopped_early' | 'simulated' | 'error';
  stepCount: number;
  finalOutput: string;
  traceAvailable: boolean;
  errorMessage?: string;
}

export const PROJECTS_STORAGE_KEY = 'ca_projects_v5';
export const HISTORY_STORAGE_KEY = 'ca_history_v5';
export const MAX_PROJECTS = 100;
export const MAX_HISTORY_ENTRIES = 60;
const MAX_CODE_CHARS_STORED = 50_000;

function getSafeStorage(override?: StorageLike): StorageLike | null {
  if (override) return override;
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    return null;
  }
  return null;
}

function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

function sanitizeProject(raw: unknown): SavedProject | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id.trim()) return null;
  if (typeof o.name !== 'string' || !o.name.trim()) return null;
  const lang = typeof o.language === 'string' && isLanguageSelectable(o.language)
    ? (o.language as LanguageId)
    : 'js';
  const now = new Date().toISOString();
  return {
    id: o.id.trim(),
    name: o.name.trim().slice(0, 120),
    language: lang,
    code: typeof o.code === 'string' ? o.code.slice(0, MAX_CODE_CHARS_STORED) : '',
    stdin: typeof o.stdin === 'string' ? o.stdin.slice(0, 8000) : '',
    cliArgs: typeof o.cliArgs === 'string' ? o.cliArgs.slice(0, 500) : '',
    visualizationPrefs:
      o.visualizationPrefs && typeof o.visualizationPrefs === 'object'
        ? {
            focusedStructureName:
              typeof (o.visualizationPrefs as Record<string, unknown>).focusedStructureName === 'string'
                ? String((o.visualizationPrefs as Record<string, unknown>).focusedStructureName)
                : null,
            playbackSpeed:
              typeof (o.visualizationPrefs as Record<string, unknown>).playbackSpeed === 'number'
                ? Number((o.visualizationPrefs as Record<string, unknown>).playbackSpeed)
                : undefined,
          }
        : undefined,
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : now,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : now,
  };
}

export function loadProjects(storage?: StorageLike): {
  projects: SavedProject[];
  recoveredFromCorruption: boolean;
} {
  const store = getSafeStorage(storage);
  if (!store) return { projects: [], recoveredFromCorruption: false };
  try {
    const raw = store.getItem(PROJECTS_STORAGE_KEY);
    if (!raw) return { projects: [], recoveredFromCorruption: false };
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return { projects: [], recoveredFromCorruption: true };
    }
    const clean = parsed
      .map(sanitizeProject)
      .filter((p): p is SavedProject => p !== null)
      .slice(0, MAX_PROJECTS);
    return { projects: clean, recoveredFromCorruption: clean.length !== parsed.length };
  } catch {
    return { projects: [], recoveredFromCorruption: true };
  }
}

export function persistProjects(
  projects: SavedProject[],
  storage?: StorageLike
): { ok: boolean; error?: string } {
  const store = getSafeStorage(storage);
  if (!store) return { ok: false, error: 'Local storage is unavailable on this device.' };
  try {
    const trimmed = projects.slice(0, MAX_PROJECTS);
    store.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(trimmed));
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Storage limit reached: ${err.message}`
          : 'Could not save projects because local storage is full.',
    };
  }
}

export function createSavedProject(params: {
  name: string;
  language: LanguageId;
  code: string;
  stdin?: string;
  cliArgs?: string;
  visualizationPrefs?: SavedProject['visualizationPrefs'];
}): SavedProject {
  const now = new Date().toISOString();
  return {
    id: makeId('proj'),
    name: params.name.trim().slice(0, 120) || 'Untitled Project',
    language: isLanguageSelectable(params.language) ? params.language : 'js',
    code: params.code.slice(0, MAX_CODE_CHARS_STORED),
    stdin: (params.stdin || '').slice(0, 8000),
    cliArgs: (params.cliArgs || '').slice(0, 500),
    visualizationPrefs: params.visualizationPrefs,
    createdAt: now,
    updatedAt: now,
  };
}

export function duplicateSavedProject(project: SavedProject): SavedProject {
  const now = new Date().toISOString();
  return {
    ...project,
    id: makeId('proj'),
    name: `${project.name} (Copy)`.slice(0, 120),
    createdAt: now,
    updatedAt: now,
  };
}

function sanitizeHistoryEntry(raw: unknown): ExecutionHistoryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id.trim()) return null;
  const lang = typeof o.language === 'string' && isLanguageSelectable(o.language)
    ? (o.language as LanguageId)
    : 'js';
  const status =
    o.status === 'completed' ||
    o.status === 'stopped_early' ||
    o.status === 'simulated' ||
    o.status === 'error'
      ? o.status
      : 'completed';
  const executionMode: ExecutionMode = o.executionMode === 'simulated' ? 'simulated' : 'real';
  return {
    id: o.id,
    projectName: typeof o.projectName === 'string' && o.projectName.trim() ? o.projectName.trim().slice(0, 120) : 'Untitled Workspace',
    language: lang,
    executionMode,
    executedAt: typeof o.executedAt === 'string' ? o.executedAt : new Date().toISOString(),
    code: typeof o.code === 'string' ? o.code.slice(0, MAX_CODE_CHARS_STORED) : '',
    stdin: typeof o.stdin === 'string' ? o.stdin.slice(0, 4000) : '',
    cliArgs: typeof o.cliArgs === 'string' ? o.cliArgs.slice(0, 500) : '',
    status,
    stepCount: typeof o.stepCount === 'number' && Number.isFinite(o.stepCount) ? Math.max(0, Math.floor(o.stepCount)) : 0,
    finalOutput: typeof o.finalOutput === 'string' ? o.finalOutput.slice(0, 1000) : '',
    traceAvailable: o.traceAvailable === true,
    errorMessage: typeof o.errorMessage === 'string' ? o.errorMessage.slice(0, 400) : undefined,
  };
}

export function loadExecutionHistory(storage?: StorageLike): {
  entries: ExecutionHistoryEntry[];
  recoveredFromCorruption: boolean;
} {
  const store = getSafeStorage(storage);
  if (!store) return { entries: [], recoveredFromCorruption: false };
  try {
    const raw = store.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return { entries: [], recoveredFromCorruption: false };
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { entries: [], recoveredFromCorruption: true };
    const clean = parsed
      .map(sanitizeHistoryEntry)
      .filter((e): e is ExecutionHistoryEntry => e !== null)
      .slice(0, MAX_HISTORY_ENTRIES);
    return { entries: clean, recoveredFromCorruption: clean.length !== parsed.length };
  } catch {
    return { entries: [], recoveredFromCorruption: true };
  }
}

export function persistExecutionHistory(
  entries: ExecutionHistoryEntry[],
  storage?: StorageLike
): { ok: boolean; error?: string } {
  const store = getSafeStorage(storage);
  if (!store) return { ok: false, error: 'Local storage is unavailable on this device.' };
  const capped = entries.slice(0, MAX_HISTORY_ENTRIES);
  try {
    store.setItem(HISTORY_STORAGE_KEY, JSON.stringify(capped));
    return { ok: true };
  } catch {
    // Gracefully evict oldest half if quota is tight
    try {
      store.setItem(HISTORY_STORAGE_KEY, JSON.stringify(capped.slice(0, Math.max(5, Math.floor(capped.length / 2)))));
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Local storage quota exceeded.',
      };
    }
  }
}

export function createHistoryEntry(params: Omit<ExecutionHistoryEntry, 'id' | 'executedAt'>): ExecutionHistoryEntry {
  return {
    ...params,
    id: makeId('hist'),
    executedAt: new Date().toISOString(),
    code: params.code.slice(0, MAX_CODE_CHARS_STORED),
    stdin: params.stdin.slice(0, 4000),
    finalOutput: params.finalOutput.slice(0, 1000),
  };
}

export function estimateLocalStorageUsageBytes(storage?: StorageLike): number {
  const store = getSafeStorage(storage);
  if (!store) return 0;
  let total = 0;
  for (const key of [PROJECTS_STORAGE_KEY, HISTORY_STORAGE_KEY, 'ca_settings_v5', 'ca_learning_progress_v5', 'ca_st']) {
    try {
      const val = store.getItem(key);
      if (val) total += val.length * 2;
    } catch {
      // ignore
    }
  }
  return total;
}

export function clearAllLocalData(storage?: StorageLike): void {
  const store = getSafeStorage(storage);
  if (!store) return;
  for (const key of [PROJECTS_STORAGE_KEY, HISTORY_STORAGE_KEY, 'ca_learning_progress_v5']) {
    try {
      store.removeItem(key);
    } catch {
      // ignore
    }
  }
}
