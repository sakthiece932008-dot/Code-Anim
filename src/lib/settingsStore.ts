import type { LanguageId } from '../types/trace';
import { isLanguageSelectable } from './languageRegistry';

export type ThemePreference = 'dark' | 'light' | 'system';

export const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3] as const;
export type PlaybackSpeedMultiplier = (typeof PLAYBACK_SPEEDS)[number];

export interface UserSettings {
  theme: ThemePreference;
  editorFontSize: number;
  playbackSpeed: PlaybackSpeedMultiplier;
  reducedMotion: boolean;
  defaultLanguage: LanguageId;
  autoDetectLanguage: boolean;
  simpleExplanations: boolean;
  aiTutorEnabled: boolean;
  aiSimulationEnabled: boolean;
  learningModeEnabled: boolean;
  historyEnabled: boolean;
  pauseOnImportantEvents: boolean;
}

export const SETTINGS_STORAGE_KEY = 'ca_settings_v5';

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'dark',
  editorFontSize: 13,
  playbackSpeed: 1,
  reducedMotion: false,
  defaultLanguage: 'js',
  autoDetectLanguage: true,
  simpleExplanations: true,
  aiTutorEnabled: true,
  aiSimulationEnabled: true,
  learningModeEnabled: false,
  historyEnabled: true,
  pauseOnImportantEvents: false,
};

function sanitizeSpeed(val: unknown): PlaybackSpeedMultiplier {
  const num = Number(val);
  if ((PLAYBACK_SPEEDS as readonly number[]).includes(num)) {
    return num as PlaybackSpeedMultiplier;
  }
  return DEFAULT_SETTINGS.playbackSpeed;
}

export function sanitizeSettings(raw: unknown): UserSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const obj = raw as Record<string, unknown>;
  const theme: ThemePreference =
    obj.theme === 'light' || obj.theme === 'dark' || obj.theme === 'system'
      ? obj.theme
      : DEFAULT_SETTINGS.theme;

  const fontRaw = Number(obj.editorFontSize);
  const editorFontSize = Number.isFinite(fontRaw)
    ? Math.min(20, Math.max(11, Math.round(fontRaw)))
    : DEFAULT_SETTINGS.editorFontSize;

  const langCandidate = typeof obj.defaultLanguage === 'string' ? obj.defaultLanguage : '';
  const defaultLanguage: LanguageId = isLanguageSelectable(langCandidate)
    ? (langCandidate as LanguageId)
    : DEFAULT_SETTINGS.defaultLanguage;

  return {
    theme,
    editorFontSize,
    playbackSpeed: sanitizeSpeed(obj.playbackSpeed),
    reducedMotion: typeof obj.reducedMotion === 'boolean' ? obj.reducedMotion : DEFAULT_SETTINGS.reducedMotion,
    defaultLanguage,
    autoDetectLanguage:
      typeof obj.autoDetectLanguage === 'boolean' ? obj.autoDetectLanguage : DEFAULT_SETTINGS.autoDetectLanguage,
    simpleExplanations:
      typeof obj.simpleExplanations === 'boolean' ? obj.simpleExplanations : DEFAULT_SETTINGS.simpleExplanations,
    aiTutorEnabled:
      typeof obj.aiTutorEnabled === 'boolean' ? obj.aiTutorEnabled : DEFAULT_SETTINGS.aiTutorEnabled,
    aiSimulationEnabled:
      typeof obj.aiSimulationEnabled === 'boolean'
        ? obj.aiSimulationEnabled
        : DEFAULT_SETTINGS.aiSimulationEnabled,
    learningModeEnabled:
      typeof obj.learningModeEnabled === 'boolean' ? obj.learningModeEnabled : DEFAULT_SETTINGS.learningModeEnabled,
    historyEnabled:
      typeof obj.historyEnabled === 'boolean' ? obj.historyEnabled : DEFAULT_SETTINGS.historyEnabled,
    pauseOnImportantEvents:
      typeof obj.pauseOnImportantEvents === 'boolean'
        ? obj.pauseOnImportantEvents
        : DEFAULT_SETTINGS.pauseOnImportantEvents,
  };
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getSafeStorage(override?: StorageLike): StorageLike | null {
  if (override) return override;
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    return null;
  }
  return null;
}

export function loadSettings(storage?: StorageLike): { settings: UserSettings; recoveredFromCorruption: boolean } {
  const store = getSafeStorage(storage);
  if (!store) return { settings: { ...DEFAULT_SETTINGS }, recoveredFromCorruption: false };
  try {
    const raw = store.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { settings: { ...DEFAULT_SETTINGS }, recoveredFromCorruption: false };
    const parsed = JSON.parse(raw);
    return { settings: sanitizeSettings(parsed), recoveredFromCorruption: false };
  } catch {
    return { settings: { ...DEFAULT_SETTINGS }, recoveredFromCorruption: true };
  }
}

export function saveSettings(
  settings: UserSettings,
  storage?: StorageLike
): { ok: boolean; error?: string } {
  const store = getSafeStorage(storage);
  if (!store) return { ok: false, error: 'Local storage is unavailable in this browser context.' };
  try {
    store.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(sanitizeSettings(settings)));
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not save settings to local storage.',
    };
  }
}

export function resolveEffectiveTheme(theme: ThemePreference): 'dark' | 'light' {
  if (theme === 'dark' || theme === 'light') return theme;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return 'dark';
}

export function applyThemeAndMotionToDocument(settings: UserSettings): 'dark' | 'light' {
  const effective = resolveEffectiveTheme(settings.theme);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(effective);
    root.dataset.theme = effective;
    root.dataset.reducedMotion = settings.reducedMotion ? 'true' : 'false';
  }
  return effective;
}

export function speedMultiplierToIntervalMs(multiplier: PlaybackSpeedMultiplier): number {
  const baseMs = 850;
  return Math.max(160, Math.round(baseMs / multiplier));
}
