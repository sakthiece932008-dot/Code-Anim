import { memo, useMemo, useState } from 'react';
import { BookOpen, Play, Search } from 'lucide-react';
import {
  LEARNING_LIBRARY,
  type DifficultyLevel,
  type LearningExample,
  type LibraryCategory,
} from '../lib/learningLibrary';
import { getLanguageSpec } from '../lib/languageRegistry';

interface LearnLibraryViewProps {
  onVisualizeExample: (example: LearningExample, autoRun: boolean) => void;
}

const CATEGORY_TABS: Array<{ id: 'all' | LibraryCategory; label: string }> = [
  { id: 'all', label: 'All Topics' },
  { id: 'fundamentals', label: 'Fundamentals' },
  { id: 'data-structures', label: 'Data Structures' },
  { id: 'algorithms', label: 'Algorithms' },
];

const DIFFICULTY_OPTIONS: Array<'all' | DifficultyLevel> = [
  'all',
  'Beginner',
  'Intermediate',
  'Advanced',
];

export const LearnLibraryView = memo(function LearnLibraryView({
  onVisualizeExample,
}: LearnLibraryViewProps) {
  const [category, setCategory] = useState<'all' | LibraryCategory>('all');
  const [difficulty, setDifficulty] = useState<'all' | DifficultyLevel>('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return LEARNING_LIBRARY.filter((ex) => {
      if (category !== 'all' && ex.category !== category) return false;
      if (difficulty !== 'all' && ex.difficulty !== difficulty) return false;
      if (!q) return true;
      return (
        ex.title.toLowerCase().includes(q) ||
        ex.topic.toLowerCase().includes(q) ||
        ex.description.toLowerCase().includes(q) ||
        ex.lang.toLowerCase().includes(q)
      );
    });
  }, [category, difficulty, query]);

  return (
    <div className="flex flex-col gap-5 pb-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--ca-border)] pb-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-[var(--ca-accent)]" />
            <span>Learning Library</span>
          </h2>
          <p className="text-sm ca-text-muted mt-1 max-w-2xl">
            Curated examples across fundamentals, data structures, and algorithms. Every example runs through the exact same execution engine and visualizer as your own code.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 ca-text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search topics or languages…"
              aria-label="Search learning examples"
              className="pl-8 pr-3 py-1.5 rounded-lg text-xs border ca-surface-2 focus:outline-none w-56"
            />
          </div>

          <select
            aria-label="Filter by difficulty"
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as 'all' | DifficultyLevel)}
            className="px-2.5 py-1.5 rounded-lg text-xs border ca-surface-2 focus:outline-none"
          >
            {DIFFICULTY_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt === 'all' ? 'All levels' : opt}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Category tabs */}
      <div role="tablist" aria-label="Library categories" className="flex flex-wrap items-center gap-1 border-b border-[var(--ca-border)]">
        {CATEGORY_TABS.map((tab) => {
          const active = category === tab.id;
          const count =
            tab.id === 'all'
              ? LEARNING_LIBRARY.length
              : LEARNING_LIBRARY.filter((e) => e.category === tab.id).length;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={active}
              type="button"
              onClick={() => setCategory(tab.id)}
              className={`px-3.5 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
                active
                  ? 'border-[var(--ca-accent)] text-[var(--ca-accent)]'
                  : 'border-transparent ca-text-muted hover:text-[var(--ca-text)]'
              }`}
            >
              {tab.label} <span className="opacity-70 tabular-nums">({count})</span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border ca-surface p-8 text-center">
          <p className="text-sm font-medium">No matching examples found.</p>
          <p className="text-xs ca-text-muted mt-1">Try clearing your search or choosing another category.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((ex) => {
            const spec = getLanguageSpec(ex.lang);
            return (
              <article
                key={ex.id}
                className="rounded-xl border ca-surface p-4 flex flex-col justify-between gap-3"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-[11px] ca-text-muted">
                    <span className="font-medium uppercase tracking-wider">{ex.topic}</span>
                    <span>
                      {spec?.name || ex.lang} · {ex.difficulty}
                    </span>
                  </div>

                  <h3 className="text-sm font-semibold leading-snug">{ex.title}</h3>
                  <p className="text-xs ca-text-muted leading-relaxed">{ex.description}</p>

                  {ex.objectives.length > 0 && (
                    <ul className="text-[11px] ca-text-muted space-y-0.5 pt-1 list-disc list-inside">
                      {ex.objectives.map((obj) => (
                        <li key={obj}>{obj}</li>
                      ))}
                    </ul>
                  )}

                  <div className="rounded-lg border border-[var(--ca-border)] ca-surface-2 px-2.5 py-2 text-[11px] font-mono space-y-1">
                    {ex.sampleInput && (
                      <div className="truncate">
                        <span className="ca-text-muted">Input: </span>
                        <span>{ex.sampleInput.replace(/\n/g, ' ↵ ')}</span>
                      </div>
                    )}
                    <div className="truncate">
                      <span className="ca-text-muted">Expected: </span>
                      <span className="text-emerald-400">{ex.expectedOutput}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-[var(--ca-border)]">
                  <button
                    type="button"
                    onClick={() => onVisualizeExample(ex, true)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition-colors cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Visualize</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onVisualizeExample(ex, false)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--ca-border-strong)] hover:bg-[var(--ca-surface-elev)] transition-colors cursor-pointer"
                  >
                    Open in Editor
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
});
