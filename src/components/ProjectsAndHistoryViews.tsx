import { memo, useMemo, useRef, useState } from 'react';
import {
  Check,
  Clock,
  Copy,
  Download,
  FolderOpen,
  History,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { LanguageId } from '../types/trace';
import type { ExecutionHistoryEntry, SavedProject } from '../lib/projectStore';
import { getLanguageSpec, getSelectableLanguages } from '../lib/languageRegistry';
import {
  buildPortableProjectJson,
  getExtensionForLanguage,
  triggerTextDownload,
} from '../lib/exportImport';

interface MyProjectsViewProps {
  projects: SavedProject[];
  activeProjectId: string | null;
  storageNotice: string | null;
  onCreateNewProject: () => void;
  onSaveCurrentAsProject: (name: string) => void;
  onOpenProject: (project: SavedProject) => void;
  onRenameProject: (id: string, newName: string) => void;
  onDuplicateProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onImportCodeAnimFile: (file: File) => void;
}

function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export const MyProjectsView = memo(function MyProjectsView({
  projects,
  activeProjectId,
  storageNotice,
  onCreateNewProject,
  onSaveCurrentAsProject,
  onOpenProject,
  onRenameProject,
  onDuplicateProject,
  onDeleteProject,
  onImportCodeAnimFile,
}: MyProjectsViewProps) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) => p.name.toLowerCase().includes(q) || p.language.toLowerCase().includes(q)
    );
  }, [projects, query]);

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    onSaveCurrentAsProject(trimmed);
    setNewName('');
  };

  return (
    <div className="flex flex-col gap-5 pb-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--ca-border)] pb-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-[var(--ca-accent)]" />
            <span>My Projects</span>
          </h2>
          <p className="text-sm ca-text-muted mt-1">
            Saved locally on this device in browser storage. Export a <code className="font-mono">.codeanim.json</code> file anytime to share or back up.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onCreateNewProject}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--ca-border-strong)] hover:bg-[var(--ca-surface-elev)] cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Blank Workspace</span>
          </button>

          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--ca-border-strong)] hover:bg-[var(--ca-surface-elev)] cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import Project / Trace</span>
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,.codeanim.json,.trace.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) onImportCodeAnimFile(f);
            }}
          />
        </div>
      </div>

      {storageNotice && (
        <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-200">
          {storageNotice}
        </div>
      )}

      {/* Save current workspace + search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form onSubmit={handleSaveForm} className="flex items-center gap-2 flex-1 max-w-md">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Save current workspace as…"
            aria-label="New project name"
            className="flex-1 px-3 py-1.5 rounded-lg text-xs border ca-surface-2 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!newName.trim()}
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 cursor-pointer"
          >
            Save Current
          </button>
        </form>

        <div className="relative">
          <Search className="w-3.5 h-3.5 ca-text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter saved projects…"
            aria-label="Filter saved projects"
            className="pl-8 pr-3 py-1.5 rounded-lg text-xs border ca-surface-2 focus:outline-none w-52"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border ca-surface p-8 text-center">
          <p className="text-sm font-medium">No saved projects yet.</p>
          <p className="text-xs ca-text-muted mt-1">
            Give your current workspace a name above and click <strong>Save Current</strong>, or import a <code className="font-mono">.codeanim.json</code> file.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((proj) => {
            const spec = getLanguageSpec(proj.language);
            const isActive = proj.id === activeProjectId;
            const isEditing = editingId === proj.id;
            const isConfirmingDel = confirmDeleteId === proj.id;

            return (
              <article
                key={proj.id}
                className={`rounded-xl border ca-surface p-4 flex flex-col justify-between gap-3 ${
                  isActive ? 'ring-1 ring-[var(--ca-accent)]' : ''
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    {isEditing ? (
                      <div className="flex items-center gap-1 flex-1">
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && editingName.trim()) {
                              onRenameProject(proj.id, editingName.trim());
                              setEditingId(null);
                            } else if (e.key === 'Escape') {
                              setEditingId(null);
                            }
                          }}
                          className="flex-1 px-2 py-1 rounded text-xs border ca-surface-2 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (editingName.trim()) onRenameProject(proj.id, editingName.trim());
                            setEditingId(null);
                          }}
                          aria-label="Confirm rename"
                          className="p-1 text-emerald-400 cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          aria-label="Cancel rename"
                          className="p-1 ca-text-muted cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <h3 className="text-sm font-semibold truncate">{proj.name}</h3>
                    )}
                    <span className="text-[11px] ca-text-muted shrink-0">
                      {spec?.name || proj.language}
                    </span>
                  </div>

                  <pre className="rounded-lg border border-[var(--ca-border)] ca-surface-2 p-2.5 text-[11px] font-mono ca-text-muted max-h-24 overflow-hidden whitespace-pre-wrap break-all">
                    {proj.code.split('\n').slice(0, 4).join('\n') || '(Empty file)'}
                  </pre>

                  <div className="flex items-center gap-1.5 text-[11px] ca-text-muted">
                    <Clock className="w-3 h-3" />
                    <span>Updated {formatShortDate(proj.updatedAt)}</span>
                    {isActive && <span className="text-[var(--ca-accent)] font-medium">· Open</span>}
                  </div>
                </div>

                {isConfirmingDel ? (
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--ca-border)] text-xs">
                    <span className="text-red-400 font-medium">Delete this project?</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          onDeleteProject(proj.id);
                          setConfirmDeleteId(null);
                        }}
                        className="px-2.5 py-1 rounded bg-red-600 text-white font-semibold cursor-pointer"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-2.5 py-1 rounded border border-[var(--ca-border-strong)] cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-1.5 pt-2 border-t border-[var(--ca-border)]">
                    <button
                      type="button"
                      onClick={() => onOpenProject(proj)}
                      className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 cursor-pointer"
                    >
                      <Play className="w-3 h-3" />
                      <span>Open</span>
                    </button>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        title="Rename"
                        aria-label={`Rename ${proj.name}`}
                        onClick={() => {
                          setEditingId(proj.id);
                          setEditingName(proj.name);
                        }}
                        className="p-1.5 rounded border border-[var(--ca-border)] ca-text-muted hover:text-[var(--ca-text)] cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Duplicate"
                        aria-label={`Duplicate ${proj.name}`}
                        onClick={() => onDuplicateProject(proj.id)}
                        className="p-1.5 rounded border border-[var(--ca-border)] ca-text-muted hover:text-[var(--ca-text)] cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Download source file"
                        aria-label={`Download ${proj.name} source`}
                        onClick={() => {
                          const safe = proj.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'program';
                          triggerTextDownload(
                            `${safe}.${getExtensionForLanguage(proj.language)}`,
                            proj.code,
                            'text/plain;charset=utf-8'
                          );
                        }}
                        className="p-1.5 rounded border border-[var(--ca-border)] ca-text-muted hover:text-[var(--ca-text)] cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Export portable .codeanim.json"
                        aria-label={`Export ${proj.name} portable JSON`}
                        onClick={() => {
                          const safe = proj.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'project';
                          triggerTextDownload(
                            `${safe}.codeanim.json`,
                            buildPortableProjectJson({
                              name: proj.name,
                              language: proj.language,
                              code: proj.code,
                              stdin: proj.stdin,
                              cliArgs: proj.cliArgs,
                            }),
                            'application/json;charset=utf-8'
                          );
                        }}
                        className="px-2 py-1 rounded border border-[var(--ca-border)] text-[10px] font-mono ca-text-muted hover:text-[var(--ca-text)] cursor-pointer"
                      >
                        .json
                      </button>
                      <button
                        type="button"
                        title="Delete project"
                        aria-label={`Delete ${proj.name}`}
                        onClick={() => setConfirmDeleteId(proj.id)}
                        className="p-1.5 rounded border border-[var(--ca-border)] ca-text-muted hover:text-red-400 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
});

interface ExecutionHistoryViewProps {
  entries: ExecutionHistoryEntry[];
  historyEnabled: boolean;
  onReopenEntry: (entry: ExecutionHistoryEntry, autoRun: boolean) => void;
  onDeleteEntry: (id: string) => void;
  onClearHistory: () => void;
  onGoToSettings: () => void;
}

export const ExecutionHistoryView = memo(function ExecutionHistoryView({
  entries,
  historyEnabled,
  onReopenEntry,
  onDeleteEntry,
  onClearHistory,
  onGoToSettings,
}: ExecutionHistoryViewProps) {
  const [query, setQuery] = useState('');
  const [langFilter, setLangFilter] = useState<'all' | LanguageId>('all');
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const selectableLanguages = useMemo(() => getSelectableLanguages(), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (langFilter !== 'all' && e.language !== langFilter) return false;
      if (!q) return true;
      return (
        e.projectName.toLowerCase().includes(q) ||
        e.code.toLowerCase().includes(q) ||
        e.finalOutput.toLowerCase().includes(q)
      );
    });
  }, [entries, langFilter, query]);

  return (
    <div className="flex flex-col gap-5 pb-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--ca-border)] pb-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <History className="w-5 h-5 text-[var(--ca-accent)]" />
            <span>Execution History</span>
          </h2>
          <p className="text-sm ca-text-muted mt-1">
            Recent visualizations stored locally on this device only. You can delete individual runs, clear all history, or disable recording in Settings.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 ca-text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search runs or output…"
              aria-label="Search execution history"
              className="pl-8 pr-3 py-1.5 rounded-lg text-xs border ca-surface-2 focus:outline-none w-52"
            />
          </div>

          <select
            aria-label="Filter history by language"
            value={langFilter}
            onChange={(e) => setLangFilter(e.target.value as 'all' | LanguageId)}
            className="px-2.5 py-1.5 rounded-lg text-xs border ca-surface-2 focus:outline-none"
          >
            <option value="all">All languages</option>
            {selectableLanguages.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>

          {entries.length > 0 && !confirmClearAll && (
            <button
              type="button"
              onClick={() => setConfirmClearAll(true)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--ca-border-strong)] hover:text-red-400 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear All</span>
            </button>
          )}
          {confirmClearAll && (
            <div className="flex items-center gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => {
                  onClearHistory();
                  setConfirmClearAll(false);
                }}
                className="px-2.5 py-1.5 rounded-lg bg-red-600 text-white font-semibold cursor-pointer"
              >
                Confirm Clear
              </button>
              <button
                type="button"
                onClick={() => setConfirmClearAll(false)}
                className="px-2.5 py-1.5 rounded-lg border border-[var(--ca-border-strong)] cursor-pointer"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {!historyEnabled && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2">
          <span>Execution history recording is currently turned off in Settings.</span>
          <button
            type="button"
            onClick={onGoToSettings}
            className="underline font-medium cursor-pointer"
          >
            Open Settings
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-xl border ca-surface p-8 text-center">
          <p className="text-sm font-medium">No execution runs recorded yet.</p>
          <p className="text-xs ca-text-muted mt-1">
            Run any program from the Workspace or Learning Library to see it listed here.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[var(--ca-border)] rounded-xl border ca-surface overflow-hidden">
          {filtered.map((entry) => {
            const spec = getLanguageSpec(entry.language);
            const statusText =
              entry.status === 'error'
                ? 'Error'
                : entry.status === 'simulated'
                ? 'AI Simulation'
                : entry.status === 'stopped_early'
                ? 'Stopped early'
                : 'Completed';
            const statusColor =
              entry.status === 'error'
                ? 'text-red-400'
                : entry.status === 'simulated'
                ? 'text-amber-400'
                : 'text-emerald-400';

            return (
              <div
                key={entry.id}
                className="p-3.5 flex flex-wrap items-center justify-between gap-3 hover:bg-[var(--ca-surface-2)] transition-colors"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold truncate">{entry.projectName}</span>
                    <span className="ca-text-muted">·</span>
                    <span className="ca-text-muted">{spec?.name || entry.language}</span>
                    <span className="ca-text-muted">·</span>
                    <span className={`font-medium ${statusColor}`}>{statusText}</span>
                    <span className="ca-text-muted">·</span>
                    <span className="ca-text-muted tabular-nums">{entry.stepCount} steps</span>
                    <span className="ca-text-muted">·</span>
                    <span className="ca-text-muted">{formatShortDate(entry.executedAt)}</span>
                  </div>
                  <div className="text-[11px] font-mono ca-text-muted truncate">
                    {entry.status === 'error'
                      ? entry.errorMessage || 'Execution failed'
                      : entry.finalOutput
                      ? `Output: ${entry.finalOutput}`
                      : entry.code.split('\n')[0] || '(Program)'}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onReopenEntry(entry, true)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 cursor-pointer"
                  >
                    <Play className="w-3 h-3" />
                    <span>Re-run</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onReopenEntry(entry, false)}
                    className="px-2.5 py-1.5 rounded-lg text-xs border border-[var(--ca-border-strong)] hover:bg-[var(--ca-surface-elev)] cursor-pointer"
                  >
                    Open Code
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteEntry(entry.id)}
                    aria-label={`Delete run ${entry.projectName}`}
                    className="p-1.5 rounded-lg border border-[var(--ca-border)] ca-text-muted hover:text-red-400 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
