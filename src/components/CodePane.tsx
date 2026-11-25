import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Download,
  Maximize2,
  Minimize2,
  Minus,
  Pencil,
  Plus,
  Redo2,
  Search,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import type { AppState, LanguageId, TraceEvent } from '../types/trace';
import { getLanguageSpec } from '../lib/languageRegistry';
import { tokenizeSourceLine, type SyntaxTokenType } from '../lib/syntaxHighlight';
import { findActiveExpressionRange } from '../lib/expressionHighlight';
import { getExtensionForLanguage, triggerTextDownload } from '../lib/exportImport';

interface CodePaneProps {
  appState: AppState;
  language: LanguageId;
  code: string;
  projectName?: string;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  onChangeCode: (nextCode: string) => void;
  onPasteCode?: (pastedText: string, nextFullCode: string) => void;
  activeLine: number | null;
  activeEvent?: TraceEvent | null;
  errorLine?: number | null;
  breakpoints: number[];
  onToggleBreakpoint: (lineNumber: number) => void;
  canUndoFix?: boolean;
  onUndoFix?: () => void;
  onEditCode: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  reducedMotion?: boolean;
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

const OPEN_TO_CLOSE: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const CLOSE_TO_OPEN: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

function findMatchingBracket(source: string, cursorPos: number): [number, number] | null {
  const candidates = [cursorPos, cursorPos - 1];
  for (const idx of candidates) {
    if (idx < 0 || idx >= source.length) continue;
    const ch = source[idx];
    if (ch in OPEN_TO_CLOSE) {
      const target = OPEN_TO_CLOSE[ch];
      let depth = 0;
      for (let i = idx; i < source.length; i++) {
        if (source[i] === ch) depth++;
        else if (source[i] === target) {
          depth--;
          if (depth === 0) return [idx, i];
        }
      }
    } else if (ch in CLOSE_TO_OPEN) {
      const target = CLOSE_TO_OPEN[ch];
      let depth = 0;
      for (let i = idx; i >= 0; i--) {
        if (source[i] === ch) depth++;
        else if (source[i] === target) {
          depth--;
          if (depth === 0) return [i, idx];
        }
      }
    }
  }
  return null;
}

/**
 * Computes foldable block ranges (1-based startLine -> endLine) for brace-based
 * and indentation-based (Python) languages.
 */
function computeFoldRanges(lines: string[], isPythonLike: boolean): Map<number, number> {
  const ranges = new Map<number, number>();
  if (isPythonLike) {
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.endsWith(':')) continue;
      const baseIndent = lines[i].length - lines[i].trimStart().length;
      let end = i;
      for (let j = i + 1; j < lines.length; j++) {
        const t = lines[j].trim();
        if (!t) continue;
        const ind = lines[j].length - lines[j].trimStart().length;
        if (ind > baseIndent) end = j;
        else break;
      }
      if (end > i + 1) ranges.set(i + 1, end + 1);
    }
    return ranges;
  }

  const stack: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === '{') stack.push(i + 1);
      else if (ch === '}' && stack.length > 0) {
        const startLine = stack.pop()!;
        const endLine = i + 1;
        if (endLine > startLine + 1 && !ranges.has(startLine)) {
          ranges.set(startLine, endLine);
        }
      }
    }
  }
  return ranges;
}

export const CodePane = memo(function CodePane({
  appState,
  language,
  code,
  projectName = 'program',
  fontSize,
  onFontSizeChange,
  onChangeCode,
  onPasteCode,
  activeLine,
  activeEvent = null,
  errorLine,
  breakpoints,
  onToggleBreakpoint,
  canUndoFix,
  onUndoFix,
  onEditCode,
  isFullscreen = false,
  onToggleFullscreen,
  reducedMotion = false,
}: CodePaneProps) {
  const activeRowRef = useRef<HTMLDivElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Undo / Redo history stack
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);

  // Find & Replace state
  const [showFind, setShowFind] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');

  // Clear confirmation & Copy feedback
  const [confirmClear, setConfirmClear] = useState(false);
  const [copied, setCopied] = useState(false);

  // Bracket matching & Code folding
  const [cursorOffset, setCursorOffset] = useState<number>(0);
  const [foldedStarts, setFoldedStarts] = useState<Record<number, boolean>>({});

  const lines = useMemo(() => code.split('\n'), [code]);
  const isViewer = appState === 'VISUALIZER';
  const isTracing = appState === 'TRACING';
  const langSpec = useMemo(() => getLanguageSpec(language), [language]);
  const syntaxGroup = langSpec?.syntaxGroup || 'plain';
  const breakpointSet = useMemo(() => new Set(breakpoints), [breakpoints]);

  const foldRanges = useMemo(
    () => computeFoldRanges(lines, syntaxGroup === 'python'),
    [lines, syntaxGroup]
  );

  const matchedBrackets = useMemo(
    () => (isViewer ? null : findMatchingBracket(code, cursorOffset)),
    [isViewer, code, cursorOffset]
  );

  const matchCount = useMemo(() => {
    if (!findQuery) return 0;
    const escaped = findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return (code.match(new RegExp(escaped, 'gi')) || []).length;
  }, [code, findQuery]);

  const lineHeightPx = Math.round(fontSize * 1.65);

  const pushCodeEdit = useCallback(
    (nextCode: string) => {
      if (nextCode === code) return;
      setUndoStack((prev) => [...prev.slice(-49), code]);
      setRedoStack([]);
      onChangeCode(nextCode);
    },
    [code, onChangeCode]
  );

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev.slice(-49), code]);
    onChangeCode(previous);
  }, [undoStack, code, onChangeCode]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev.slice(-49), code]);
    onChangeCode(next);
  }, [redoStack, code, onChangeCode]);

  useEffect(() => {
    if (isViewer && activeRowRef.current) {
      activeRowRef.current.scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: reducedMotion ? 'auto' : 'smooth',
      });
    }
  }, [isViewer, activeLine, activeEvent?.sequence, reducedMotion]);

  const handleTextareaScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const top = e.currentTarget.scrollTop;
    const left = e.currentTarget.scrollLeft;
    if (gutterRef.current) gutterRef.current.scrollTop = top;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = top;
      highlightRef.current.scrollLeft = left;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      setShowFind((v) => !v);
      return;
    }
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) handleRedo();
      else handleUndo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      handleRedo();
      return;
    }

    const target = e.currentTarget;
    const start = target.selectionStart;
    const end = target.selectionEnd;

    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        const lineStart = code.lastIndexOf('\n', start - 1) + 1;
        if (code.slice(lineStart, lineStart + 2) === '  ') {
          const next = code.slice(0, lineStart) + code.slice(lineStart + 2);
          pushCodeEdit(next);
          requestAnimationFrame(() => {
            target.selectionStart = target.selectionEnd = Math.max(lineStart, start - 2);
          });
        }
      } else {
        const next = code.slice(0, start) + '  ' + code.slice(end);
        pushCodeEdit(next);
        requestAnimationFrame(() => {
          target.selectionStart = target.selectionEnd = start + 2;
        });
      }
      return;
    }

    // Automatic indentation on Enter
    if (e.key === 'Enter') {
      e.preventDefault();
      const lineStart = code.lastIndexOf('\n', start - 1) + 1;
      const currentLine = code.slice(lineStart, start);
      const baseIndent = (currentLine.match(/^(\s*)/) || ['', ''])[1];
      const extra = /[:{[(]\s*$/.test(currentLine.trim()) ? '  ' : '';
      const insert = '\n' + baseIndent + extra;
      const next = code.slice(0, start) + insert + code.slice(end);
      pushCodeEdit(next);
      requestAnimationFrame(() => {
        const pos = start + insert.length;
        target.selectionStart = target.selectionEnd = pos;
        setCursorOffset(pos);
      });
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!onPasteCode) return;
    const pasted = e.clipboardData.getData('text');
    if (!pasted) return;
    const target = e.currentTarget;
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? code.length;
    const nextFull = code.slice(0, start) + pasted + code.slice(end);
    onPasteCode(pasted, nextFull);
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked in restricted iframe
    }
  };

  const handleDownloadCode = () => {
    const ext = getExtensionForLanguage(language);
    const safeName = projectName.toLowerCase().replace(/[^a-z0-9-_]+/g, '_') || 'program';
    triggerTextDownload(`${safeName}${ext}`, code, 'text/plain;charset=utf-8');
  };

  const handleReplaceAll = () => {
    if (!findQuery) return;
    const escaped = findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const next = code.replace(new RegExp(escaped, 'g'), replaceQuery);
    pushCodeEdit(next);
  };

  const handleReplaceFirst = () => {
    if (!findQuery) return;
    const idx = code.indexOf(findQuery);
    if (idx === -1) return;
    const next = code.slice(0, idx) + replaceQuery + code.slice(idx + findQuery.length);
    pushCodeEdit(next);
  };

  // Determine hidden lines from active folds (in viewer mode)
  const hiddenLines = useMemo(() => {
    const set = new Set<number>();
    if (!isViewer) return set;
    for (const [startStr, isFolded] of Object.entries(foldedStarts)) {
      if (!isFolded) continue;
      const start = Number(startStr);
      const end = foldRanges.get(start);
      if (end) {
        for (let ln = start + 1; ln <= end; ln++) {
          if (ln !== activeLine) set.add(ln);
        }
      }
    }
    return set;
  }, [isViewer, foldedStarts, foldRanges, activeLine]);

  // Compute line/column offsets for bracket matching display
  const bracketHighlightLineCols = useMemo(() => {
    if (!matchedBrackets) return null;
    const map = new Map<number, Set<number>>();
    for (const offset of matchedBrackets) {
      let lineNo = 1;
      let col = 0;
      for (let i = 0; i < offset; i++) {
        if (code[i] === '\n') {
          lineNo++;
          col = 0;
        } else {
          col++;
        }
      }
      if (!map.has(lineNo)) map.set(lineNo, new Set());
      map.get(lineNo)!.add(col);
    }
    return map;
  }, [matchedBrackets, code]);

  return (
    <section
      aria-label="Source Code Editor"
      className={`flex flex-col rounded-xl border ca-surface overflow-hidden ${
        isFullscreen ? 'fixed inset-3 z-50 shadow-2xl' : 'h-full min-h-[280px]'
      }`}
    >
      {/* Compact Editor Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b ca-surface-2">
        <div className="flex items-center gap-2 text-xs font-medium min-w-0">
          <Code2 className="w-4 h-4 text-indigo-400 shrink-0" />
          <span className="truncate">Code</span>
          <span aria-hidden="true" className="ca-text-muted">·</span>
          <span className="ca-text-muted truncate">{langSpec?.name || language}</span>
          <span aria-hidden="true" className="ca-text-muted">·</span>
          <span className="font-mono tabular-nums ca-text-muted shrink-0">
            {isViewer && activeLine
              ? `Line ${activeLine}/${lines.length}`
              : errorLine
                ? `Error L${errorLine}`
                : `${lines.length}L`}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1 shrink-0">
          {!isViewer && (
            <>
              <button
                type="button"
                onClick={handleUndo}
                disabled={undoStack.length === 0 || isTracing}
                title="Undo (Ctrl+Z)"
                aria-label="Undo edit"
                className="p-1.5 rounded-md border border-transparent hover:border-slate-600/60 hover:bg-slate-500/10 disabled:opacity-35 cursor-pointer"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleRedo}
                disabled={redoStack.length === 0 || isTracing}
                title="Redo (Ctrl+Shift+Z)"
                aria-label="Redo edit"
                className="p-1.5 rounded-md border border-transparent hover:border-slate-600/60 hover:bg-slate-500/10 disabled:opacity-35 cursor-pointer"
              >
                <Redo2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setShowFind((v) => !v)}
                title="Find & Replace (Ctrl+F)"
                aria-label="Find and replace"
                className={`p-1.5 rounded-md border cursor-pointer ${
                  showFind
                    ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-400'
                    : 'border-transparent hover:border-slate-600/60 hover:bg-slate-500/10'
                }`}
              >
                <Search className="w-3.5 h-3.5" />
              </button>
            </>
          )}

          <div className="hidden sm:flex items-center border border-slate-700/60 rounded-md overflow-hidden mx-0.5">
            <button
              type="button"
              onClick={() => onFontSizeChange(Math.max(11, fontSize - 1))}
              title="Decrease font size"
              aria-label="Decrease editor font size"
              className="px-1.5 py-1 hover:bg-slate-500/10 cursor-pointer"
            >
              <Minus className="w-3 h-3" />
            </button>
            <span className="px-1.5 text-[11px] font-mono tabular-nums ca-text-muted">
              {fontSize}
            </span>
            <button
              type="button"
              onClick={() => onFontSizeChange(Math.min(20, fontSize + 1))}
              title="Increase font size"
              aria-label="Increase editor font size"
              className="px-1.5 py-1 hover:bg-slate-500/10 cursor-pointer"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => void handleCopyCode()}
            title="Copy source code"
            aria-label="Copy source code"
            className="p-1.5 rounded-md border border-transparent hover:border-slate-600/60 hover:bg-slate-500/10 cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onClick={handleDownloadCode}
            disabled={!code.trim()}
            title="Download source file"
            aria-label="Download source file"
            className="p-1.5 rounded-md border border-transparent hover:border-slate-600/60 hover:bg-slate-500/10 disabled:opacity-35 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          {!isViewer && (
            <button
              type="button"
              onClick={() => setConfirmClear((v) => !v)}
              disabled={!code.trim() || isTracing}
              title="Clear editor"
              aria-label="Clear editor"
              className="p-1.5 rounded-md border border-transparent hover:border-red-500/50 hover:text-red-400 disabled:opacity-35 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}

          {canUndoFix && onUndoFix && (
            <button
              type="button"
              onClick={onUndoFix}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-amber-300 bg-amber-500/15 border border-amber-500/40 cursor-pointer"
            >
              <Undo2 className="w-3 h-3" />
              <span>Undo Fix</span>
            </button>
          )}

          {isViewer && (
            <button
              type="button"
              onClick={onEditCode}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border border-slate-600/70 hover:bg-slate-500/15 cursor-pointer"
            >
              <Pencil className="w-3 h-3" />
              <span>Edit</span>
            </button>
          )}

          {onToggleFullscreen && (
            <button
              type="button"
              onClick={onToggleFullscreen}
              title={isFullscreen ? 'Exit full-screen editor' : 'Full-screen editor'}
              aria-label={isFullscreen ? 'Exit full-screen editor' : 'Full-screen editor'}
              className="p-1.5 rounded-md border border-transparent hover:border-slate-600/60 hover:bg-slate-500/10 cursor-pointer"
            >
              {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Inline Clear Confirmation */}
      {confirmClear && (
        <div
          role="alertdialog"
          aria-label="Confirm clear editor"
          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-red-500/40 bg-red-500/10 text-xs"
        >
          <span>Clear all source code from the editor? (Undo remains available.)</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                pushCodeEdit('');
                setConfirmClear(false);
              }}
              className="px-2.5 py-1 rounded bg-red-600 hover:bg-red-500 text-white font-semibold cursor-pointer"
            >
              Clear Code
            </button>
            <button
              type="button"
              onClick={() => setConfirmClear(false)}
              className="px-2.5 py-1 rounded border border-slate-600 hover:bg-slate-500/15 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Find & Replace Toolbar */}
      {showFind && !isViewer && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b ca-surface-2 text-xs">
          <input
            type="text"
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            placeholder="Find…"
            aria-label="Find text"
            className="px-2 py-1 rounded border border-slate-600/70 bg-transparent font-mono text-xs w-32 sm:w-40"
          />
          <input
            type="text"
            value={replaceQuery}
            onChange={(e) => setReplaceQuery(e.target.value)}
            placeholder="Replace…"
            aria-label="Replace text"
            className="px-2 py-1 rounded border border-slate-600/70 bg-transparent font-mono text-xs w-32 sm:w-40"
          />
          <span className="font-mono text-[11px] ca-text-muted tabular-nums">
            {findQuery ? `${matchCount} match${matchCount === 1 ? '' : 'es'}` : ''}
          </span>
          <button
            type="button"
            onClick={handleReplaceFirst}
            disabled={!findQuery || matchCount === 0}
            className="px-2 py-1 rounded border border-slate-600/70 hover:bg-slate-500/15 disabled:opacity-40 cursor-pointer"
          >
            Replace
          </button>
          <button
            type="button"
            onClick={handleReplaceAll}
            disabled={!findQuery || matchCount === 0}
            className="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 cursor-pointer"
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setShowFind(false)}
            aria-label="Close find bar"
            className="ml-auto p-1 hover:bg-slate-500/15 rounded cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Editor / Highlighted Trace Viewer */}
      {isViewer ? (
        <div
          role="region"
          aria-label="Highlighted Source Code"
          className="flex-1 overflow-auto font-mono py-2"
          style={{ fontSize: `${fontSize}px`, lineHeight: `${lineHeightPx}px` }}
        >
          {lines.map((lineText, idx) => {
            const lineNumber = idx + 1;
            if (hiddenLines.has(lineNumber)) return null;
            const isActive = activeLine === lineNumber;
            const hasBp = breakpointSet.has(lineNumber);
            const foldEnd = foldRanges.get(lineNumber);
            const isFolded = Boolean(foldedStarts[lineNumber]);
            const tokens = tokenizeSourceLine(lineText, syntaxGroup);
            const exprRange = isActive ? findActiveExpressionRange(lineText, activeEvent) : null;

            return (
              <div
                key={lineNumber}
                ref={isActive ? activeRowRef : null}
                data-line={lineNumber}
                data-active={isActive ? 'true' : 'false'}
                className={`flex items-start px-2 border-l-[3px] transition-all duration-200 ${
                  isActive
                    ? 'bg-amber-500/20 border-l-amber-400'
                    : 'border-l-transparent hover:bg-slate-500/8'
                }`}
              >
                {/* Breakpoint gutter button (recorded-trace breakpoint) */}
                <button
                  type="button"
                  onClick={() => onToggleBreakpoint(lineNumber)}
                  title={
                    hasBp
                      ? `Remove recorded-trace breakpoint on line ${lineNumber}`
                      : `Set recorded-trace breakpoint on line ${lineNumber}`
                  }
                  aria-label={`Toggle recorded-trace breakpoint on line ${lineNumber}`}
                  className={`w-4 shrink-0 flex items-center justify-center self-center cursor-pointer ${
                    hasBp ? 'text-rose-500' : 'text-transparent hover:text-slate-500'
                  }`}
                >
                  <span className="text-[10px]" aria-hidden="true">●</span>
                </button>

                {/* Fold toggle */}
                <span className="w-4 shrink-0 flex items-center justify-center self-center">
                  {foldEnd ? (
                    <button
                      type="button"
                      onClick={() =>
                        setFoldedStarts((prev) => ({ ...prev, [lineNumber]: !prev[lineNumber] }))
                      }
                      aria-label={isFolded ? `Unfold block at line ${lineNumber}` : `Fold block at line ${lineNumber}`}
                      className="ca-text-muted hover:text-indigo-400 cursor-pointer"
                    >
                      {isFolded ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                  ) : null}
                </span>

                {/* Active Execution Line Arrow Indicator */}
                <span
                  data-active-arrow={isActive ? 'true' : 'false'}
                  aria-label={isActive ? `Executing line ${lineNumber}` : undefined}
                  className={`w-4 shrink-0 flex items-center justify-center self-center select-none text-[11px] font-bold transition-opacity duration-200 ${
                    isActive ? 'text-amber-400 opacity-100' : 'opacity-0'
                  }`}
                >
                  ▶
                </span>

                <span
                  className={`w-8 pr-2.5 text-right select-none shrink-0 tabular-nums transition-colors duration-200 ${
                    isActive ? 'text-amber-400 font-bold' : 'ca-text-muted'
                  }`}
                >
                  {lineNumber}
                </span>

                <span className="whitespace-pre flex-1 pr-3">
                  {(() => {
                    if (!exprRange) {
                      return tokens.map((tok, tIdx) => (
                        <span key={tIdx} className={TOKEN_CLASSES[tok.type]}>
                          {tok.text}
                        </span>
                      ));
                    }
                    let cursor = 0;
                    return tokens.map((tok, tIdx) => {
                      const tokStart = cursor;
                      const tokEnd = cursor + tok.text.length;
                      cursor = tokEnd;

                      const hlStart = Math.max(tokStart, exprRange.start);
                      const hlEnd = Math.min(tokEnd, exprRange.end);
                      if (hlStart >= hlEnd) {
                        return (
                          <span key={tIdx} className={TOKEN_CLASSES[tok.type]}>
                            {tok.text}
                          </span>
                        );
                      }

                      const before = tok.text.slice(0, hlStart - tokStart);
                      const middle = tok.text.slice(hlStart - tokStart, hlEnd - tokStart);
                      const after = tok.text.slice(hlEnd - tokStart);

                      return (
                        <span key={tIdx} className={TOKEN_CLASSES[tok.type]}>
                          {before}
                          <mark
                            data-active-expression="true"
                            className="bg-amber-400/35 text-inherit ring-1 ring-amber-400/75 rounded-[3px] px-0.5 font-semibold transition-all duration-200"
                          >
                            {middle}
                          </mark>
                          {after}
                        </span>
                      );
                    });
                  })()}
                  {isFolded && foldEnd && (
                    <span className="ml-2 text-[11px] ca-text-muted font-sans">
                      … ({foldEnd - lineNumber} lines folded)
                    </span>
                  )}
                </span>

                {isActive && (
                  <span className="text-[11px] font-sans font-semibold text-amber-400 shrink-0 self-center pr-1">
                    Active
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="relative flex flex-1 overflow-hidden">
          {/* Gutter with line numbers & recorded-trace breakpoint toggles */}
          <div
            ref={gutterRef}
            className="w-14 py-3 pr-2 text-right font-mono ca-text-muted ca-surface-2 border-r select-none overflow-hidden shrink-0 tabular-nums"
            style={{ fontSize: `${fontSize}px`, lineHeight: `${lineHeightPx}px` }}
          >
            {lines.map((_, idx) => {
              const lineNo = idx + 1;
              const isErr = errorLine === lineNo;
              const hasBp = breakpointSet.has(lineNo);
              return (
                <div
                  key={idx}
                  className={`flex items-center justify-end gap-1 ${
                    isErr ? 'text-red-400 font-bold bg-red-500/15 -mr-2 pr-2' : ''
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onToggleBreakpoint(lineNo)}
                    title={`Toggle recorded-trace breakpoint on line ${lineNo}`}
                    aria-label={`Toggle recorded-trace breakpoint on line ${lineNo}`}
                    className={`w-3.5 text-center text-[10px] cursor-pointer ${
                      hasBp ? 'text-rose-500' : 'text-transparent hover:text-slate-500'
                    }`}
                  >
                    ●
                  </button>
                  <span>{lineNo}</span>
                </div>
              );
            })}
          </div>

          {/* Live Syntax Highlight Layer + Transparent Editable Textarea */}
          <div className="relative flex-1 overflow-hidden">
            <div
              ref={highlightRef}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 overflow-hidden p-3 font-mono whitespace-pre"
              style={{ fontSize: `${fontSize}px`, lineHeight: `${lineHeightPx}px` }}
            >
              {lines.map((lineText, idx) => {
                const lineNo = idx + 1;
                const tokens = tokenizeSourceLine(lineText, syntaxGroup);
                const brCols = bracketHighlightLineCols?.get(lineNo);
                if (!brCols) {
                  return (
                    <div key={idx} style={{ minHeight: `${lineHeightPx}px` }}>
                      {tokens.map((tok, tIdx) => (
                        <span key={tIdx} className={TOKEN_CLASSES[tok.type]}>
                          {tok.text}
                        </span>
                      ))}
                      {lineText.length === 0 ? '\u200B' : ''}
                    </div>
                  );
                }
                let colCursor = 0;
                return (
                  <div key={idx} style={{ minHeight: `${lineHeightPx}px` }}>
                    {tokens.map((tok, tIdx) => {
                      const startCol = colCursor;
                      colCursor += tok.text.length;
                      let hasMatchHere = false;
                      for (let c = startCol; c < colCursor; c++) {
                        if (brCols.has(c)) {
                          hasMatchHere = true;
                          break;
                        }
                      }
                      if (!hasMatchHere) {
                        return (
                          <span key={tIdx} className={TOKEN_CLASSES[tok.type]}>
                            {tok.text}
                          </span>
                        );
                      }
                      return (
                        <span key={tIdx} className={TOKEN_CLASSES[tok.type]}>
                          {[...tok.text].map((ch, ci) =>
                            brCols.has(startCol + ci) ? (
                              <span key={ci} className="bg-indigo-500/35 rounded-[2px]">
                                {ch}
                              </span>
                            ) : (
                              ch
                            )
                          )}
                        </span>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            <textarea
              ref={textareaRef}
              id="code-editor"
              aria-label="Source code input"
              value={code}
              onChange={(e) => {
                pushCodeEdit(e.target.value);
                setCursorOffset(e.target.selectionStart ?? 0);
              }}
              onSelect={(e) => setCursorOffset(e.currentTarget.selectionStart ?? 0)}
              onClick={(e) => setCursorOffset(e.currentTarget.selectionStart ?? 0)}
              onKeyUp={(e) => setCursorOffset(e.currentTarget.selectionStart ?? 0)}
              onPaste={handlePaste}
              onScroll={handleTextareaScroll}
              onKeyDown={handleKeyDown}
              disabled={isTracing}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              placeholder="Write, paste, or upload code in any supported language — language is detected automatically."
              style={{
                fontSize: `${fontSize}px`,
                lineHeight: `${lineHeightPx}px`,
                color: 'transparent',
                caretColor: 'var(--ca-text)',
              }}
              className="relative z-10 w-full h-full resize-none border-0 outline-none bg-transparent placeholder:text-slate-500 font-mono p-3 whitespace-pre overflow-auto disabled:opacity-60"
            />
          </div>
        </div>
      )}

      {/* Subtle footer note when breakpoints are set */}
      {breakpoints.length > 0 && (
        <div className="px-3 py-1.5 border-t ca-surface-2 text-[11px] ca-text-muted flex items-center justify-between gap-2">
          <span>
            Recorded-trace breakpoints on line{breakpoints.length === 1 ? '' : 's'}{' '}
            <span className="font-mono">{[...breakpoints].sort((a, b) => a - b).join(', ')}</span>{' '}
            (pauses playback on recorded trace steps)
          </span>
        </div>
      )}
    </section>
  );
});
