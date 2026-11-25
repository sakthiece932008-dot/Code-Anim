import { Component, memo, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Layers,
  Loader2,
  Maximize2,
  MessageSquare,
  Minimize2,
  Play,
  RotateCcw,
  Scan,
  Sparkles,
  Wrench,
  X,
  XCircle,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { AppState, ErrorHelpReport, SceneData, TraceDocument } from '../types/trace';
import type { ReconstructedFrame } from '../lib/replayEngine';
import type {
  ReconstructedArray,
  ReconstructedArrayCell,
  ReconstructedGraph,
  ReconstructedHashTable,
  ReconstructedLinkedList,
  ReconstructedObject,
  ReconstructedSet,
  ReconstructedStructure,
  ReconstructedTree,
} from '../lib/structureReconstructor';
import { buildAnimationFrame } from '../lib/animationAdapter';
import { STARTER_EXAMPLES, type CodeExample } from '../lib/explain';
import { GenericOperationStage } from './GenericOperationStage';
import {
  synthesizeUniversalScene,
  type UniversalVisualScene,
} from '../lib/universalVisualEngine';
import { UniversalSceneRenderer } from './UniversalSceneRenderer';

class CanvasErrorBoundary extends Component<
  { children: ReactNode; onBackToEditor: () => void; onRetry: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Handled cleanly in fallback UI without crashing the app or losing user code
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 space-y-2.5 text-xs">
          <div className="font-semibold text-red-300">Visualization Renderer Error</div>
          <p className="leading-relaxed">
            The animation canvas ran into an internal rendering issue. This does not mean your code is wrong — your source code is safely preserved.
          </p>
          <details className="text-[11px] ca-text-muted">
            <summary className="cursor-pointer underline">Technical details</summary>
            <pre className="mt-1 p-2 rounded ca-surface-2 font-mono whitespace-pre-wrap break-all">
              {this.state.error.message}
            </pre>
          </details>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                this.setState({ error: null });
                this.props.onRetry();
              }}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold cursor-pointer"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => {
                this.setState({ error: null });
                this.props.onBackToEditor();
              }}
              className="px-3 py-1.5 rounded-lg border border-[var(--ca-border-strong)] cursor-pointer"
            >
              Back to Editor
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

interface VisualizerCanvasProps {
  appState: AppState;
  languageLabel: string;
  sourceCode: string;
  traceDocument?: TraceDocument | null;
  currentStepIndex?: number;
  aiVisualScene?: UniversalVisualScene | null;
  frame: ReconstructedFrame | null;
  prevFrame: ReconstructedFrame | null;
  errorMessage: string | null;
  errorHelp: ErrorHelpReport | null;
  errorHelpLoading?: boolean;
  traceWarning: string | null;
  onSelectExample: (example: CodeExample) => void;
  onApplySuggestedFix: (fixedCode: string) => void;
  onAskTutorAboutError?: (errorSummary: string) => void;
  onRetryVisualize: () => void;
  onCancelTrace: () => void;
  onBackToEditor: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  compactMode?: boolean;
  embedded?: boolean;
}

interface InspectedElement {
  title: string;
  value: string;
  status: string;
  extra?: string;
}

function computeSimpleDiff(original: string, suggested: string): Array<{ kind: 'same' | 'del' | 'add'; text: string }> {
  const oldLines = original.split('\n');
  const newLines = suggested.split('\n');
  const maxLen = Math.max(oldLines.length, newLines.length);
  const diff: Array<{ kind: 'same' | 'del' | 'add'; text: string }> = [];
  for (let i = 0; i < maxLen && diff.length < 28; i++) {
    const a = oldLines[i];
    const b = newLines[i];
    if (a === b && a !== undefined) {
      diff.push({ kind: 'same', text: a });
    } else {
      if (a !== undefined) diff.push({ kind: 'del', text: a });
      if (b !== undefined) diff.push({ kind: 'add', text: b });
    }
  }
  return diff;
}

const TreeRenderer = memo(function TreeRenderer({
  tree,
  onInspect,
}: {
  tree: ReconstructedTree;
  onInspect: (item: InspectedElement) => void;
}) {
  const getX = (x: number) => x * 62 + 36;
  const getY = (y: number) => y * 70 + 36;
  const svgWidth = Math.max(140, tree.width * 62 + 24);
  const svgHeight = Math.max(96, tree.height * 70 + 24);
  const byId = new Map(tree.nodes.map((n) => [n.objectId, n]));

  return (
    <div className="overflow-x-auto py-1">
      <svg
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        role="img"
        aria-label={`${tree.treeVariant} tree visualization`}
        className="block mx-auto"
      >
        {tree.edges.map((edge) => {
          const from = byId.get(edge.fromId);
          const to = byId.get(edge.toId);
          if (!from || !to) return null;
          const midX = (getX(from.x) + getX(to.x)) / 2;
          const midY = (getY(from.y) + getY(to.y)) / 2;
          return (
            <g key={`${edge.fromId}-${edge.toId}-${edge.label || ''}`}>
              <line
                x1={getX(from.x)}
                y1={getY(from.y)}
                x2={getX(to.x)}
                y2={getY(to.y)}
                stroke="#64748b"
                strokeWidth={2}
              />
              {edge.label && (
                <text
                  x={midX}
                  y={midY - 4}
                  fill="#94a3b8"
                  fontSize={9}
                  textAnchor="middle"
                  className="font-mono"
                >
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}
        {tree.nodes.map((node) => {
          const cx = getX(node.x);
          const cy = getY(node.y);
          const isNew = node.status === 'new';
          const isChanged = node.status === 'changed';
          const fill = isNew ? '#059669' : isChanged ? '#d97706' : '#1e293b';
          const stroke = isNew ? '#34d399' : isChanged ? '#fbbf24' : '#818cf8';
          return (
            <g
              key={node.objectId}
              onClick={() =>
                onInspect({
                  title: `Tree Node (${node.objectId})`,
                  value: node.display,
                  status: isNew ? 'Created (+)' : isChanged ? 'Updated (Δ)' : 'Unchanged',
                  extra: node.pointers.length > 0 ? `Pointers: ${node.pointers.join(', ')}` : node.metaTag,
                })
              }
              className={`cursor-pointer ${
                isNew ? 'ca-svg-node-new' : isChanged ? 'ca-svg-node-chg' : ''
              }`}
            >
              <circle
                cx={cx}
                cy={cy}
                r={21}
                fill={fill}
                stroke={stroke}
                strokeWidth={isNew || isChanged ? 2.5 : 2}
                strokeDasharray={isChanged ? '4 2' : undefined}
              />
              <text
                x={cx}
                y={cy}
                fill="#f8fafc"
                fontSize={12}
                fontWeight={600}
                textAnchor="middle"
                dominantBaseline="central"
                className="font-mono"
              >
                {node.display.slice(0, 6)}
              </text>
              {node.metaTag && (
                <text
                  x={cx + 22}
                  y={cy - 14}
                  fill="#38bdf8"
                  fontSize={8}
                  fontWeight={700}
                  className="font-mono"
                >
                  {node.metaTag}
                </text>
              )}
              <text
                x={cx}
                y={cy + 30}
                fill="#94a3b8"
                fontSize={9}
                textAnchor="middle"
                className="font-mono"
              >
                {node.pointers.length > 0 ? node.pointers.join(', ') : node.objectId}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
});

const HeapRenderer = memo(function HeapRenderer({
  arr,
  onInspect,
}: {
  arr: ReconstructedArray;
  onInspect: (item: InspectedElement) => void;
}) {
  const cells = arr.cells.slice(0, 31);
  if (cells.length === 0) {
    return <span className="font-mono text-xs text-slate-400">empty heap []</span>;
  }
  const levels = Math.floor(Math.log2(cells.length)) + 1;
  const width = Math.max(220, Math.pow(2, Math.min(levels, 4)) * 52);
  const height = levels * 62 + 32;

  const getPos = (idx: number) => {
    const level = Math.floor(Math.log2(idx + 1));
    const indexInLevel = idx - (Math.pow(2, level) - 1);
    const slots = Math.pow(2, level);
    const x = ((indexInLevel + 0.5) / slots) * width;
    const y = level * 60 + 28;
    return { x, y };
  };

  return (
    <div className="space-y-2.5">
      <div className="overflow-x-auto">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block mx-auto">
          {cells.map((_, idx) => {
            if (idx === 0) return null;
            const parentIdx = Math.floor((idx - 1) / 2);
            const p = getPos(parentIdx);
            const c = getPos(idx);
            return (
              <line
                key={`e-${idx}`}
                x1={p.x}
                y1={p.y}
                x2={c.x}
                y2={c.y}
                stroke="#64748b"
                strokeWidth={1.75}
              />
            );
          })}
          {cells.map((cell) => {
            const pos = getPos(cell.index);
            const isNew = cell.status === 'new';
            const isChanged = cell.status === 'changed';
            return (
              <g
                key={cell.index}
                onClick={() =>
                  onInspect({
                    title: `${arr.names[0]}[${cell.index}]`,
                    value: cell.display,
                    status: isNew ? 'Created (+)' : isChanged ? 'Updated (Δ)' : 'Unchanged',
                    extra: arr.heapOrder ? `Order: ${arr.heapOrder}` : 'Binary Heap Node',
                  })
                }
                className="cursor-pointer"
              >
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={18}
                  fill={isNew ? '#059669' : isChanged ? '#d97706' : '#1e293b'}
                  stroke={isNew ? '#34d399' : isChanged ? '#fbbf24' : '#38bdf8'}
                  strokeWidth={2}
                />
                <text
                  x={pos.x}
                  y={pos.y}
                  fill="#f8fafc"
                  fontSize={11}
                  fontWeight={600}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="font-mono"
                >
                  {cell.display.slice(0, 5)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <ArrayRow cells={arr.cells} totalLength={arr.totalLength} onInspect={onInspect} prefix={arr.names[0]} />
    </div>
  );
});

const GraphRenderer = memo(function GraphRenderer({
  graph,
  onInspect,
}: {
  graph: ReconstructedGraph;
  onInspect: (item: InspectedElement) => void;
}) {
  const count = Math.max(1, graph.nodes.length);
  const radius = Math.min(130, Math.max(56, count * 16));
  const width = radius * 2 + 124;
  const height = radius * 2 + 100;
  const centerX = width / 2;
  const centerY = height / 2;

  const positions = new Map<string, { x: number; y: number }>();
  graph.nodes.forEach((node, idx) => {
    const angle = (2 * Math.PI * idx) / count - Math.PI / 2;
    positions.set(node.id, {
      x: centerX + (count === 1 ? 0 : radius * Math.cos(angle)),
      y: centerY + (count === 1 ? 0 : radius * Math.sin(angle)),
    });
  });

  const markerId = `arrow-${graph.objectId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <div className="overflow-x-auto py-1">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Graph visualization"
        className="block mx-auto"
      >
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="22"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#94a3b8" />
          </marker>
        </defs>

        {graph.edges.map((edge, idx) => {
          const from = positions.get(edge.fromId);
          const to = positions.get(edge.toId);
          if (!from || !to) return null;

          if (edge.fromId === edge.toId) {
            return (
              <circle
                key={`${edge.fromId}-self-${idx}`}
                cx={from.x + 18}
                cy={from.y - 18}
                r={12}
                fill="none"
                stroke="#94a3b8"
                strokeWidth={1.75}
              />
            );
          }

          const midX = (from.x + to.x) / 2;
          const midY = (from.y + to.y) / 2;
          return (
            <g key={`${edge.fromId}-${edge.toId}-${idx}`}>
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="#64748b"
                strokeWidth={1.75}
                markerEnd={graph.isDirected && edge.directed ? `url(#${markerId})` : undefined}
              />
              {edge.label && (
                <text
                  x={midX}
                  y={midY - 6}
                  fill="#fbbf24"
                  fontSize={10}
                  fontWeight={600}
                  textAnchor="middle"
                  className="font-mono"
                >
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}

        {graph.nodes.map((node) => {
          const pos = positions.get(node.id);
          if (!pos) return null;
          const fill = node.visited
            ? '#059669'
            : node.status === 'new'
              ? '#0284c7'
              : '#1e293b';
          const stroke = node.visited
            ? '#34d399'
            : node.status === 'changed'
              ? '#fbbf24'
              : '#38bdf8';

          return (
            <g
              key={node.id}
              onClick={() =>
                onInspect({
                  title: `Vertex ${node.label}`,
                  value: node.visited ? 'Visited (✓)' : 'Unvisited',
                  status: node.status,
                  extra: `${graph.representation} · ${graph.isDirected ? 'Directed' : 'Undirected'}`,
                })
              }
              className="cursor-pointer"
            >
              <circle
                cx={pos.x}
                cy={pos.y}
                r={20}
                fill={fill}
                stroke={stroke}
                strokeWidth={node.visited ? 2.5 : 2}
              />
              <text
                x={pos.x}
                y={pos.y}
                fill="#f8fafc"
                fontSize={12}
                fontWeight={600}
                textAnchor="middle"
                dominantBaseline="central"
                className="font-mono"
              >
                {node.label.slice(0, 6)}
              </text>
              {node.visited && (
                <text
                  x={pos.x}
                  y={pos.y + 30}
                  fill="#34d399"
                  fontSize={9}
                  fontWeight={600}
                  textAnchor="middle"
                  className="font-sans"
                >
                  ✓ Visited
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
});

const LARGE_ARRAY_DOM_THRESHOLD = 64;

function buildWindowedCells(
  cells: ReconstructedArrayCell[]
): Array<{ type: 'cell'; cell: ReconstructedArrayCell } | { type: 'gap'; skipped: number; key: string }> {
  if (cells.length <= LARGE_ARRAY_DOM_THRESHOLD) {
    return cells.map((cell) => ({ type: 'cell', cell }));
  }
  const keepIndices = new Set<number>();
  for (let i = 0; i < Math.min(24, cells.length); i++) keepIndices.add(i);
  for (let i = Math.max(0, cells.length - 8); i < cells.length; i++) keepIndices.add(i);
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].status !== 'unchanged') keepIndices.add(i);
  }
  const sorted = [...keepIndices].sort((a, b) => a - b);
  const out: Array<{ type: 'cell'; cell: ReconstructedArrayCell } | { type: 'gap'; skipped: number; key: string }> = [];
  let prev = -1;
  for (const idx of sorted) {
    if (prev !== -1 && idx - prev > 1) {
      out.push({ type: 'gap', skipped: idx - prev - 1, key: `gap-${prev}-${idx}` });
    }
    out.push({ type: 'cell', cell: cells[idx] });
    prev = idx;
  }
  return out;
}

const ArrayRow = memo(function ArrayRow({
  cells,
  totalLength,
  isSwapEvent,
  prefix,
  onInspect,
}: {
  cells: ReconstructedArrayCell[];
  totalLength?: number;
  isSwapEvent?: boolean;
  prefix?: string;
  onInspect: (item: InspectedElement) => void;
}) {
  if (cells.length === 0) {
    return (
      <div className="inline-flex items-center px-3 py-2 rounded-lg border border-dashed border-slate-700 text-xs text-slate-400 font-mono">
        empty []
      </div>
    );
  }
  const items = buildWindowedCells(cells);
  const extraTruncated =
    totalLength !== undefined && totalLength > cells.length ? totalLength - cells.length : 0;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((item) =>
        item.type === 'gap' ? (
          <div
            key={item.key}
            className="px-2.5 py-2 rounded-lg border border-dashed border-slate-700 text-[11px] font-mono text-slate-400 tabular-nums"
          >
            … {item.skipped} unchanged …
          </div>
        ) : (
          <button
            type="button"
            key={item.cell.index}
            onClick={() =>
              onInspect({
                title: `${prefix || 'arr'}[${item.cell.index}]`,
                value: item.cell.display,
                status:
                  item.cell.status === 'new'
                    ? 'Created (+)'
                    : item.cell.status === 'changed'
                      ? isSwapEvent
                        ? 'Swapped (⇄)'
                        : 'Updated (Δ)'
                      : 'Unchanged',
              })
            }
            className={`min-w-[48px] rounded-lg border text-center overflow-hidden cursor-pointer transition-transform hover:scale-[1.03] ${
              item.cell.status === 'new'
                ? 'border-emerald-400 bg-emerald-500/15 ca-anim-new'
                : item.cell.status === 'changed'
                  ? isSwapEvent
                    ? 'border-sky-400 bg-sky-500/20 ca-anim-chg'
                    : 'border-amber-400 bg-amber-500/15 ca-anim-chg'
                  : 'border-indigo-400/60 bg-slate-900/90'
            }`}
          >
            <div className="text-[10px] font-mono text-slate-400 border-b border-slate-800 px-1.5 py-0.5 tabular-nums flex items-center justify-center gap-1">
              <span>{item.cell.index}</span>
              {item.cell.status === 'new' && <span className="text-emerald-300">+</span>}
              {item.cell.status === 'changed' && (
                <span className={isSwapEvent ? 'text-sky-300' : 'text-amber-300'}>
                  {isSwapEvent ? '⇄' : 'Δ'}
                </span>
              )}
            </div>
            <div className="px-2 py-1.5 font-mono text-xs font-semibold text-slate-100 tabular-nums">
              {item.cell.display}
            </div>
          </button>
        )
      )}
      {extraTruncated > 0 && (
        <div className="px-2.5 py-2 rounded-lg border border-dashed border-slate-700 text-[11px] font-mono text-slate-400 tabular-nums">
          +{extraTruncated} more
        </div>
      )}
    </div>
  );
});

const StackRenderer = memo(function StackRenderer({
  arr,
  onInspect,
}: {
  arr: ReconstructedArray;
  onInspect: (item: InspectedElement) => void;
}) {
  if (arr.cells.length === 0) {
    return (
      <div className="inline-flex items-center px-3 py-2 rounded-lg border border-dashed border-slate-700 text-xs text-slate-400 font-mono">
        empty stack
      </div>
    );
  }
  const topToBottom = [...arr.cells].reverse().slice(0, 16);
  return (
    <div className="flex flex-col items-start gap-1">
      {topToBottom.map((cell, revIdx) => {
        const isTop = revIdx === 0;
        return (
          <div key={cell.index} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                onInspect({
                  title: `${arr.names[0]}[${cell.index}]`,
                  value: cell.display,
                  status: isTop ? 'Top of Stack' : cell.status,
                })
              }
              className={`min-w-[96px] px-3 py-1.5 rounded-lg border font-mono text-xs text-center cursor-pointer ${
                cell.status === 'new'
                  ? 'border-emerald-400 bg-emerald-500/15 text-emerald-100 ca-anim-new'
                  : cell.status === 'changed'
                    ? 'border-amber-400 bg-amber-500/15 text-amber-100 ca-anim-chg'
                    : isTop
                      ? 'border-sky-400/80 bg-sky-500/15 text-sky-100'
                      : 'border-slate-700 bg-slate-900/90 text-slate-200'
              }`}
            >
              {cell.display}
            </button>
            {isTop && (
              <span className="font-mono text-[11px] font-semibold text-sky-300">
                ← TOP
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
});

const QueueRenderer = memo(function QueueRenderer({
  arr,
  onInspect,
}: {
  arr: ReconstructedArray;
  onInspect: (item: InspectedElement) => void;
}) {
  if (arr.cells.length === 0) {
    return (
      <div className="inline-flex items-center px-3 py-2 rounded-lg border border-dashed border-slate-700 text-xs text-slate-400 font-mono">
        empty queue
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="font-mono text-[10px] font-semibold text-emerald-300 pr-1">FRONT →</span>
      {arr.cells.slice(0, 32).map((cell) => (
        <button
          type="button"
          key={cell.index}
          onClick={() =>
            onInspect({
              title: `${arr.names[0]}[${cell.index}]`,
              value: cell.display,
              status: cell.status,
              extra: arr.roleHint,
            })
          }
          className={`min-w-[46px] px-2.5 py-1.5 rounded-lg border font-mono text-xs font-semibold cursor-pointer ${
            cell.status === 'new'
              ? 'border-emerald-400 bg-emerald-500/15 text-emerald-100 ca-anim-new'
              : cell.status === 'changed'
                ? 'border-amber-400 bg-amber-500/15 text-amber-100 ca-anim-chg'
                : 'border-indigo-400/60 bg-slate-900/90 text-slate-100'
          }`}
        >
          {cell.display}
        </button>
      ))}
      <span className="font-mono text-[10px] font-semibold text-amber-300 pl-1">
        {arr.roleHint === 'circular-queue' ? '← REAR ↺' : '← REAR'}
      </span>
    </div>
  );
});

const ArrayRenderer = memo(function ArrayRenderer({
  arr,
  isSwapEvent,
  onInspect,
}: {
  arr: ReconstructedArray;
  isSwapEvent: boolean;
  onInspect: (item: InspectedElement) => void;
}) {
  if (arr.roleHint === 'stack') return <StackRenderer arr={arr} onInspect={onInspect} />;
  if (arr.roleHint === 'queue' || arr.roleHint === 'deque' || arr.roleHint === 'circular-queue') {
    return <QueueRenderer arr={arr} onInspect={onInspect} />;
  }
  if (arr.roleHint === 'heap') return <HeapRenderer arr={arr} onInspect={onInspect} />;
  if (arr.isMatrix && arr.rows) {
    return (
      <div className="space-y-1.5">
        {arr.rows.map((row, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-slate-500 w-6 text-right tabular-nums shrink-0">
              r{idx}
            </span>
            <ArrayRow
              cells={row}
              isSwapEvent={isSwapEvent}
              prefix={`${arr.names[0]}[${idx}]`}
              onInspect={onInspect}
            />
          </div>
        ))}
      </div>
    );
  }
  return (
    <ArrayRow
      cells={arr.cells}
      totalLength={arr.totalLength}
      isSwapEvent={isSwapEvent}
      prefix={arr.names[0]}
      onInspect={onInspect}
    />
  );
});

const SetRenderer = memo(function SetRenderer({
  setObj,
  onInspect,
}: {
  setObj: ReconstructedSet;
  onInspect: (item: InspectedElement) => void;
}) {
  if (setObj.items.length === 0) {
    return <span className="font-mono text-xs text-slate-400">empty set {'{}'}</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {setObj.items.slice(0, 48).map((item, idx) => (
        <button
          type="button"
          key={`${item.display}-${idx}`}
          onClick={() =>
            onInspect({
              title: `Set element in ${setObj.names[0]}`,
              value: item.display,
              status: item.status === 'new' ? 'Added (+)' : 'Member (∈)',
            })
          }
          className={`px-2.5 py-1.5 rounded-lg border font-mono text-xs font-semibold cursor-pointer ${
            item.status === 'new'
              ? 'border-emerald-400 bg-emerald-500/15 text-emerald-100 ca-anim-new'
              : 'border-teal-400/50 bg-slate-900/90 text-teal-100'
          }`}
        >
          {item.display}
        </button>
      ))}
    </div>
  );
});

const HashTableRenderer = memo(function HashTableRenderer({
  table,
  onInspect,
}: {
  table: ReconstructedHashTable;
  onInspect: (item: InspectedElement) => void;
}) {
  if (table.entries.length === 0) {
    return <span className="font-mono text-xs text-slate-400">empty table {'{}'}</span>;
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 font-mono text-xs">
      {table.entries.map((entry) => (
        <button
          type="button"
          key={entry.key}
          onClick={() =>
            onInspect({
              title: `${table.names[0]}["${entry.key}"]`,
              value: entry.display,
              status: entry.status === 'new' ? 'Created (+)' : entry.status === 'changed' ? 'Updated (Δ)' : 'Unchanged',
            })
          }
          className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-left cursor-pointer ${
            entry.status === 'new'
              ? 'border-emerald-400/80 bg-emerald-500/15 text-emerald-100 ca-anim-new'
              : entry.status === 'changed'
                ? 'border-amber-400/80 bg-amber-500/15 text-amber-100 ca-anim-chg'
                : 'border-slate-800 bg-slate-900/80 text-slate-200'
          }`}
        >
          <span className="text-indigo-300 font-semibold truncate">{entry.key}</span>
          <span aria-hidden="true" className="text-slate-500">→</span>
          <span className="text-slate-100 tabular-nums truncate">{entry.display}</span>
        </button>
      ))}
    </div>
  );
});

const LinkedListRenderer = memo(function LinkedListRenderer({
  list,
  onInspect,
}: {
  list: ReconstructedLinkedList;
  onInspect: (item: InspectedElement) => void;
}) {
  const arrow = list.isDoublyLinked ? '⇄' : '→';
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {list.nodes.map((node, idx) => (
        <div key={node.objectId} className="flex items-center gap-1.5">
          {idx > 0 && (
            <span aria-hidden="true" className="text-slate-400 font-mono text-sm">
              {arrow}
            </span>
          )}
          <button
            type="button"
            onClick={() =>
              onInspect({
                title: `List Node (${node.objectId})`,
                value: node.display,
                status: node.status === 'new' ? 'Created (+)' : node.status === 'changed' ? 'Updated (Δ)' : 'Unchanged',
                extra: node.pointers.length > 0 ? `Pointers: ${node.pointers.join(', ')}` : undefined,
              })
            }
            className={`min-w-[54px] px-2.5 py-1.5 rounded-lg border font-mono text-center cursor-pointer ${
              node.status === 'new'
                ? 'border-emerald-400 bg-emerald-500/15 text-emerald-100 ca-anim-new'
                : node.status === 'changed'
                  ? 'border-amber-400 bg-amber-500/15 text-amber-100 ca-anim-chg'
                  : 'border-sky-400/60 bg-slate-900/90 text-slate-100'
            }`}
          >
            <div className="text-xs font-semibold">{node.display}</div>
            <div className="text-[9px] text-slate-400 mt-0.5">
              {node.pointers.length > 0 ? node.pointers.join(', ') : node.objectId}
            </div>
          </button>
        </div>
      ))}
      {list.cycleTargetId ? (
        <span className="text-amber-300 font-mono text-xs pl-1">
          {list.isCircular ? '↺ circular → head' : `↺ cycle → ${list.cycleTargetId}`}
        </span>
      ) : (
        <span aria-hidden="true" className="text-slate-500 font-mono text-xs pl-1">
          → ∅
        </span>
      )}
    </div>
  );
});

const ObjectRenderer = memo(function ObjectRenderer({ obj }: { obj: ReconstructedObject }) {
  if (obj.fields.length === 0) {
    return <span className="font-mono text-xs text-slate-400">{'{}'}</span>;
  }
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 font-mono text-xs">
      {obj.fields.map((field) => (
        <div key={field.key} className="contents">
          <span className="text-indigo-300 font-medium">{field.key}</span>
          <span
            className={`px-1.5 py-0.5 rounded ${
              field.status === 'changed' || field.status === 'new'
                ? 'bg-amber-500/20 text-amber-200 ca-anim-chg'
                : 'text-slate-200'
            }`}
          >
            {field.display}
          </span>
        </div>
      ))}
    </div>
  );
});

function SceneView({ scene }: { scene: SceneData }) {
  const width = Math.min(Math.max(120, Number(scene.w) || 300), 600);
  const height = Math.min(Math.max(80, Number(scene.h) || 200), 500);
  const safeColor = (c?: string) =>
    c && /^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]{3,20}$/.test(c) ? c : '#3b82f6';

  return (
    <div className="rounded-lg border border-slate-700/80 bg-[#0e1424] p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-slate-200">Rendered Screen</span>
        <span className="font-mono text-[11px] text-slate-400 tabular-nums">
          {width}×{height}
        </span>
      </div>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="max-w-full h-auto rounded bg-white border border-slate-700"
        role="img"
        aria-label="Rendered program output scene"
      >
        {scene.items.slice(0, 80).map((it, idx) => {
          const x = Number(it.x) || 0;
          const y = Number(it.y) || 0;
          if (it.t === 'circle') {
            return <circle key={idx} cx={x} cy={y} r={Number(it.r) || 10} fill={safeColor(it.color)} />;
          }
          if (it.t === 'line') {
            return (
              <line
                key={idx}
                x1={x}
                y1={y}
                x2={Number(it.x2) || 0}
                y2={Number(it.y2) || 0}
                stroke={safeColor(it.color)}
                strokeWidth={2}
              />
            );
          }
          if (it.t === 'text') {
            return (
              <text
                key={idx}
                x={x}
                y={y}
                fill={safeColor(it.color || '#111827')}
                fontSize={13}
                fontWeight={600}
                textAnchor="start"
                dominantBaseline="central"
              >
                {it.text || ''}
              </text>
            );
          }
          const w = Number(it.w) || 80;
          const h = Number(it.h) || 30;
          const isBtn = it.t === 'button';
          return (
            <g key={idx}>
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                rx={isBtn ? 6 : 0}
                fill={isBtn ? '#e5e7eb' : safeColor(it.color)}
                stroke={isBtn ? '#6b7280' : 'none'}
              />
              {it.text && (
                <text
                  x={x + w / 2}
                  y={y + h / 2}
                  fill="#111827"
                  fontSize={12}
                  fontWeight={600}
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {it.text}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function getStructureSubtitle(struct: ReconstructedStructure): string {
  switch (struct.kind) {
    case 'array':
      if (struct.roleHint === 'heap' && struct.heapOrder) return `${struct.heapOrder}[${struct.totalLength}]`;
      return `${struct.roleHint}[${struct.totalLength}]`;
    case 'set':
      return `set (${struct.totalLength} unique)`;
    case 'hash-table':
      return `${struct.className || 'hash table'} (${struct.entries.length} keys)`;
    case 'tree':
      if (struct.treeVariant === 'bst') return 'binary search tree';
      if (struct.treeVariant === 'trie') return 'trie (prefix tree)';
      if (struct.treeVariant === 'avl') return 'AVL tree';
      if (struct.treeVariant === 'red-black') return 'red-black tree';
      return struct.className || (struct.treeKind === 'general' ? 'general tree' : 'binary tree');
    case 'linked-list':
      if (struct.isCircular) return struct.isDoublyLinked ? 'circular doubly linked list' : 'circular linked list';
      return struct.className || (struct.isDoublyLinked ? 'doubly linked list' : 'linked list');
    case 'graph': {
      const tags = [
        struct.isDirected ? 'directed' : 'undirected',
        ...(struct.isWeighted ? ['weighted'] : []),
        ...(struct.isCyclic ? ['cyclic'] : []),
        ...(struct.isDisconnected ? ['disconnected'] : []),
      ];
      return `graph (${struct.nodes.length}V, ${struct.edges.length}E · ${tags.join(', ')})`;
    }
    case 'object':
      return struct.className || 'object';
  }
}

export function VisualizerCanvas({
  appState,
  languageLabel,
  sourceCode,
  traceDocument = null,
  currentStepIndex = 0,
  aiVisualScene = null,
  frame,
  prevFrame,
  errorMessage,
  errorHelp,
  errorHelpLoading,
  traceWarning,
  onSelectExample,
  onApplySuggestedFix,
  onAskTutorAboutError,
  onRetryVisualize,
  onCancelTrace,
  onBackToEditor,
  isFullscreen = false,
  onToggleFullscreen,
  compactMode = false,
  embedded = false,
}: VisualizerCanvasProps) {
  const [focusedStructureId, setFocusedStructureId] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Record<string, boolean>>({});
  const [inspected, setInspected] = useState<InspectedElement | null>(null);
  const [showFixDiff, setShowFixDiff] = useState(false);
  const [rejectedFixError, setRejectedFixError] = useState<string | null>(null);

  // Interactive Zoom & Pan viewport state (Section 6)
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const panOriginRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const primitives = frame?.workspace.primitives || [];
  const structures = frame?.workspace.structures || [];
  const totalLiveBindings = frame ? Object.keys(frame.event.locals).length : 0;

  const animationContract = useMemo(
    () => (frame ? buildAnimationFrame(frame, prevFrame) : null),
    [frame, prevFrame]
  );

  const universalScene = useMemo(() => {
    if (appState !== 'VISUALIZER' || !frame) return null;
    return synthesizeUniversalScene({
      sourceCode,
      traceDocument,
      currentStepIndex,
      frame,
      prevFrame,
      aiVisualScene,
    });
  }, [appState, sourceCode, traceDocument, currentStepIndex, frame, prevFrame, aiVisualScene]);

  const activeFocusId =
    focusedStructureId && structures.some((s) => s.objectId === focusedStructureId)
      ? focusedStructureId
      : null;

  const visibleStructures = activeFocusId
    ? structures.filter((s) => s.objectId === activeFocusId)
    : structures;

  const isSwapEvent = frame?.eventType === 'array_swap';

  const toggleCollapse = (oid: string) => {
    setCollapsedIds((prev) => ({ ...prev, [oid]: !prev[oid] }));
  };

  const handleZoomIn = () => setZoom((z) => Math.min(2, Number((z + 0.15).toFixed(2))));
  const handleZoomOut = () => setZoom((z) => Math.max(0.5, Number((z - 0.15).toFixed(2))));
  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };
  const handleFitToScreen = () => {
    const vp = viewportRef.current;
    const ct = contentRef.current;
    if (!vp || !ct) {
      handleResetView();
      return;
    }
    const vw = Math.max(1, vp.clientWidth - 24);
    const vh = Math.max(1, vp.clientHeight - 24);
    const cw = Math.max(1, ct.scrollWidth);
    const ch = Math.max(1, ct.scrollHeight);
    const fitted = Math.min(1.25, Math.max(0.55, Math.min(vw / cw, vh / ch)));
    setZoom(Number(fitted.toFixed(2)));
    setPan({ x: 0, y: 0 });
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (appState !== 'VISUALIZER') return;
    const target = e.target as HTMLElement | null;
    if (target && target.closest('button, a, input, select, svg g')) return;
    setIsPanning(true);
    panOriginRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanning || !panOriginRef.current) return;
    const dx = e.clientX - panOriginRef.current.x;
    const dy = e.clientY - panOriginRef.current.y;
    setPan({ x: panOriginRef.current.panX + dx, y: panOriginRef.current.panY + dy });
  };

  const handlePointerUp = () => {
    setIsPanning(false);
    panOriginRef.current = null;
  };

  const fixDiffLines = useMemo(() => {
    if (!errorHelp?.suggestedFix?.code) return [];
    return computeSimpleDiff(sourceCode, errorHelp.suggestedFix.code);
  }, [sourceCode, errorHelp]);

  const showFixBlock =
    Boolean(errorHelp?.suggestedFix) &&
    rejectedFixError !== (errorHelp?.originalError || errorMessage);

  return (
    <section
      aria-label="Visualization Canvas"
      className={`flex flex-col ca-surface overflow-hidden ${
        isFullscreen
          ? 'fixed inset-3 z-50 rounded-xl border shadow-2xl'
          : embedded
            ? 'h-full min-h-[260px]'
            : compactMode
              ? 'rounded-xl border min-h-[260px] h-full'
              : 'rounded-xl border min-h-[280px] h-full'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 border-b ca-surface-2">
        <div className="flex items-center gap-2 text-xs font-medium min-w-0">
          <Layers className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <span className="ca-text-muted truncate">
            {appState === 'VISUALIZER' && frame
              ? `${totalLiveBindings} var${totalLiveBindings === 1 ? '' : 's'} · ${structures.length} struct${structures.length === 1 ? '' : 's'}`
              : appState === 'TRACING'
                ? 'Tracing execution'
                : appState === 'ERROR'
                  ? 'Debugging Assistant'
                  : 'Ready'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[11px] shrink-0">
          {appState === 'VISUALIZER' && (
            <>
              <span className="hidden xl:inline font-mono ca-text-muted mr-1">
                <span className="text-emerald-400">+ New</span>
                {' · '}
                <span className="text-amber-400">Δ Updated</span>
                {' · '}
                <span className="text-sky-400">⇄ Swap</span>
                {' · '}
                <span className="text-teal-400">✓ Visited</span>
              </span>

              <div className="flex items-center border border-slate-700/60 rounded-md overflow-hidden">
                <button
                  type="button"
                  onClick={handleZoomOut}
                  title="Zoom out"
                  aria-label="Zoom out canvas"
                  className="p-1.5 hover:bg-slate-500/15 cursor-pointer"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="px-1.5 font-mono tabular-nums ca-text-muted">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={handleZoomIn}
                  title="Zoom in"
                  aria-label="Zoom in canvas"
                  className="p-1.5 hover:bg-slate-500/15 cursor-pointer"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>

              <button
                type="button"
                onClick={handleFitToScreen}
                title="Fit visualization to screen"
                aria-label="Fit visualization to screen"
                className="p-1.5 rounded-md border border-slate-700/60 hover:bg-slate-500/15 cursor-pointer"
              >
                <Scan className="w-3.5 h-3.5" />
              </button>

              {(zoom !== 1 || pan.x !== 0 || pan.y !== 0) && (
                <button
                  type="button"
                  onClick={handleResetView}
                  title="Reset canvas position and zoom"
                  aria-label="Reset canvas position"
                  className="p-1.5 rounded-md border border-slate-700/60 hover:bg-slate-500/15 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}

          {onToggleFullscreen && (
            <button
              type="button"
              onClick={onToggleFullscreen}
              title={isFullscreen ? 'Exit full-screen animation' : 'Full-screen animation'}
              aria-label={isFullscreen ? 'Exit full-screen animation' : 'Full-screen animation'}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-700/60 hover:bg-slate-500/15 cursor-pointer"
            >
              {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{isFullscreen ? 'Exit' : 'Full'}</span>
            </button>
          )}
        </div>
      </div>

      <div
        ref={viewportRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        className={`flex-1 overflow-auto p-4 ${
          appState === 'VISUALIZER' ? (isPanning ? 'cursor-grabbing select-none' : 'cursor-grab') : ''
        }`}
      >
        {appState === 'TRACING' && (
          <div className="h-full flex flex-col items-center justify-center text-center gap-4 py-8">
            <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
            <div>
              <p className="text-sm font-semibold text-slate-100">
                Tracing {languageLabel} execution…
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Capturing events, object identities, data structures, call stack, and console output.
              </p>
            </div>
            <button
              type="button"
              onClick={onCancelTrace}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors cursor-pointer"
            >
              <XCircle className="w-3.5 h-3.5 text-red-400" />
              <span>Cancel Trace</span>
            </button>
          </div>
        )}

        {appState === 'ERROR' && (
          <div className="space-y-3 max-w-2xl mx-auto py-1">
            <div className="flex items-start gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3.5">
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-red-200">
                  <span>{errorHelp?.categoryLabel || 'Could not visualize this program'}</span>
                  {errorHelp?.affectedLine && (
                    <>
                      <span aria-hidden="true" className="text-red-400/60">·</span>
                      <span className="font-mono text-red-300 tabular-nums">
                        Line {errorHelp.affectedLine}
                      </span>
                    </>
                  )}
                  {errorHelpLoading && (
                    <span className="inline-flex items-center gap-1 text-slate-300 font-normal">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Checking fix suggestions…
                    </span>
                  )}
                </div>
                <p className="text-xs font-mono text-slate-200 bg-[#0b1020] border border-slate-800 rounded px-2.5 py-1.5 break-words">
                  {errorHelp?.originalError || errorMessage || 'Trace generation failed.'}
                </p>
              </div>
            </div>

            {errorHelp && (
              <div className="rounded-lg border border-slate-800 bg-[#0e1424] p-3.5 space-y-2.5 text-xs">
                <div>
                  <div className="text-slate-400 font-medium mb-0.5">What happened (in simple English)</div>
                  <p className="text-slate-100 leading-relaxed">{errorHelp.simpleExplanation}</p>
                </div>
                <div>
                  <div className="text-slate-400 font-medium mb-0.5">What you can do next</div>
                  <p className="text-emerald-200 leading-relaxed">{errorHelp.possibleSolution}</p>
                </div>

                {errorHelp.technicalDetail && (
                  <details className="pt-1 border-t border-slate-800/80 text-[11px] text-slate-400">
                    <summary className="cursor-pointer hover:text-slate-200 select-none">
                      Technical details ({errorHelp.category})
                    </summary>
                    <pre className="mt-1.5 rounded bg-[#0b1020] border border-slate-800 p-2 font-mono text-[11px] text-slate-300 whitespace-pre-wrap break-all">
                      {errorHelp.technicalDetail}
                    </pre>
                  </details>
                )}

                {showFixBlock && errorHelp.suggestedFix && (
                  <div className="pt-2 border-t border-slate-800 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-indigo-300 font-medium">
                        <Wrench className="w-3.5 h-3.5" />
                        <span>
                          Suggested Fix {errorHelp.suggestedFix.isAiSuggestion ? '(AI Suggestion — review before applying)' : ''}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowFixDiff((v) => !v)}
                        className="text-slate-300 hover:text-white underline cursor-pointer"
                      >
                        {showFixDiff ? 'Hide diff preview' : 'Preview diff'}
                      </button>
                    </div>
                    <p className="text-slate-300">{errorHelp.suggestedFix.summary}</p>

                    {showFixDiff && (
                      <pre className="max-h-40 overflow-auto rounded bg-[#0b1020] border border-slate-800 p-2 font-mono text-[11px] leading-5 m-0">
                        {fixDiffLines.map((line, idx) => (
                          <div
                            key={idx}
                            className={
                              line.kind === 'del'
                                ? 'bg-red-500/15 text-red-200 px-1'
                                : line.kind === 'add'
                                  ? 'bg-emerald-500/15 text-emerald-200 px-1'
                                  : 'text-slate-400 px-1'
                            }
                          >
                            {line.kind === 'del' ? '- ' : line.kind === 'add' ? '+ ' : '  '}
                            {line.text}
                          </div>
                        ))}
                      </pre>
                    )}

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => onApplySuggestedFix(errorHelp.suggestedFix!.code)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Apply Fix (Undo available)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setRejectedFixError(errorHelp.originalError || errorMessage || 'dismissed')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Reject</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onRetryVisualize}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition-colors cursor-pointer"
              >
                Re-run Program
              </button>
              <button
                type="button"
                onClick={onBackToEditor}
                className="px-4 py-2 rounded-lg text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors cursor-pointer"
              >
                Back to Editor (Code Preserved)
              </button>
              {onAskTutorAboutError && (
                <button
                  type="button"
                  onClick={() =>
                    onAskTutorAboutError(
                      `My program stopped with this error: "${errorHelp?.originalError || errorMessage || 'Unknown error'}". Why did this happen and how do I fix it?`
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-indigo-200 bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/40 cursor-pointer"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Ask AI Tutor</span>
                </button>
              )}
            </div>
          </div>
        )}

        {appState === 'EDITOR' && (
          <div className="h-full flex flex-col justify-between gap-5">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-medium text-indigo-300">
                <Sparkles className="w-4 h-4" />
                <span>Watch every line execute step by step</span>
              </div>
              <p className="text-sm text-slate-300 leading-relaxed max-w-lg">
                Write, paste, or upload any program on the left — language is detected automatically. Press{' '}
                <strong className="text-white font-semibold">Visualize</strong> to watch how your program runs
                with adaptive tables, trend charts, state diagrams, timelines, waveforms, 2D maps, objects, and
                data structures explained in simple English.
              </p>

              <div aria-hidden="true" className="flex flex-wrap items-center gap-2.5 pt-1">
                <div className="rounded-lg border border-indigo-500/50 bg-[#0e1424] px-3.5 py-2 text-center">
                  <div className="text-[11px] text-slate-400 font-mono">age</div>
                  <div className="text-base font-bold font-mono text-slate-100 tabular-nums">18</div>
                </div>
                <span className="text-slate-500 font-mono">→</span>
                <div className="rounded-lg border border-amber-400/70 bg-amber-500/10 px-3.5 py-2 text-center">
                  <div className="text-[11px] text-amber-300 font-mono">age Δ</div>
                  <div className="text-base font-bold font-mono text-amber-100 tabular-nums">19</div>
                </div>
                <span className="text-slate-500 font-mono">→</span>
                <div className="rounded-lg border border-emerald-400/60 bg-emerald-500/10 px-3.5 py-2 text-center">
                  <div className="text-[11px] text-emerald-300 font-mono">name +</div>
                  <div className="text-base font-bold font-mono text-emerald-100">"Asha"</div>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800/80">
              <p className="text-xs font-medium text-slate-400 mb-2.5">
                Or load a quick runnable program:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {STARTER_EXAMPLES.map((ex) => (
                  <button
                    key={ex.id}
                    type="button"
                    onClick={() => onSelectExample(ex)}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-800 bg-[#0e1424] hover:border-indigo-500/60 hover:bg-slate-800/70 text-left transition-colors cursor-pointer"
                  >
                    <span className="text-xs font-medium text-slate-200 truncate">
                      {ex.label}
                    </span>
                    <Play className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {appState === 'VISUALIZER' && frame && (
          <CanvasErrorBoundary onBackToEditor={onBackToEditor} onRetry={onRetryVisualize}>
          <div
            ref={contentRef}
            className="space-y-4 origin-top-left"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            }}
          >
            {traceWarning && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>Execution stopped partway: {traceWarning}</span>
              </div>
            )}

            {/* Universal Generic Operation Stage (arithmetic, expressions, conditions, loops, calls, output) */}
            <GenericOperationStage
              sourceCode={sourceCode}
              frame={frame}
              prevFrame={prevFrame}
            />

            {/* Universal Adaptive Declarative Scene (tables, charts, state diagrams, timelines, signals, 2D maps, flows) */}
            {universalScene && universalScene.panels.length > 0 && !activeFocusId && (
              <UniversalSceneRenderer scene={universalScene} onInspect={setInspected} />
            )}

            {/* Multi-structure focus toolbar when 2+ structures are active simultaneously */}
            {structures.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5 pb-2 border-b border-slate-800/80 text-xs">
                <span className="text-slate-400 mr-1">Active structures:</span>
                <button
                  type="button"
                  onClick={() => setFocusedStructureId(null)}
                  className={`px-2.5 py-1 rounded border font-medium cursor-pointer transition-colors ${
                    activeFocusId === null
                      ? 'border-indigo-400 bg-indigo-500/20 text-indigo-100'
                      : 'border-slate-700 bg-slate-900/70 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  View All ({structures.length})
                </button>
                {structures.map((s) => (
                  <button
                    key={s.objectId}
                    type="button"
                    onClick={() =>
                      setFocusedStructureId((cur) => (cur === s.objectId ? null : s.objectId))
                    }
                    className={`px-2.5 py-1 rounded border font-mono cursor-pointer transition-colors ${
                      activeFocusId === s.objectId
                        ? 'border-sky-400 bg-sky-500/20 text-sky-100'
                        : 'border-slate-700 bg-slate-900/70 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {s.names[0]}
                  </button>
                ))}
              </div>
            )}

            {/* Click-to-inspect strip */}
            {inspected && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs">
                <div className="flex flex-wrap items-center gap-2 font-mono">
                  <span className="text-sky-200 font-semibold">{inspected.title}</span>
                  <span className="text-slate-500">·</span>
                  <span className="text-white">{inspected.value}</span>
                  <span className="text-slate-500">·</span>
                  <span className="text-slate-300 font-sans">{inspected.status}</span>
                  {inspected.extra && (
                    <>
                      <span className="text-slate-500">·</span>
                      <span className="text-slate-400 font-sans">{inspected.extra}</span>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setInspected(null)}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  Close
                </button>
              </div>
            )}

            {frame.scene && <SceneView scene={frame.scene} />}

            {primitives.length > 0 && !activeFocusId && (
              <div>
                <div className="text-xs font-medium text-slate-400 mb-2">
                  Memory Boxes
                </div>
                <div className="flex flex-wrap gap-2">
                  {primitives.map((item) => {
                    const prevPrim = prevFrame?.workspace.primitives.find(
                      (p) => p.name === item.name
                    );
                    const showTransition =
                      item.status === 'changed' &&
                      prevPrim &&
                      prevPrim.display !== item.display;

                    return (
                      <button
                        type="button"
                        key={item.name}
                        onClick={() =>
                          setInspected({
                            title: item.name,
                            value: item.display,
                            status:
                              item.status === 'new'
                                ? 'Created (+)'
                                : item.status === 'changed'
                                  ? `Updated (${prevPrim ? `${prevPrim.display} → ` : ''}${item.display})`
                                  : 'Unchanged',
                            extra: `Type: ${item.typeTag}`,
                          })
                        }
                        className={`rounded-lg border px-3 py-2 min-w-[82px] text-center cursor-pointer ${
                          item.status === 'new'
                            ? 'border-emerald-400/70 bg-emerald-500/10 ca-anim-new'
                            : item.status === 'changed'
                              ? 'border-amber-400/80 bg-amber-500/15 ca-anim-chg'
                              : 'border-slate-700 bg-[#0e1424]'
                        }`}
                      >
                        <div className="flex items-center justify-center gap-1.5 text-[11px] font-mono text-indigo-300">
                          <span>{item.name}</span>
                          {item.status === 'new' && (
                            <span className="text-[10px] font-sans font-semibold text-emerald-300">+</span>
                          )}
                          {item.status === 'changed' && (
                            <span className="text-[10px] font-sans font-semibold text-amber-300">Δ</span>
                          )}
                        </div>
                        <div className="text-sm font-semibold font-mono text-slate-100 mt-0.5 tabular-nums flex items-center justify-center gap-1">
                          {showTransition && (
                            <>
                              <span className="text-[11px] text-slate-400 line-through">
                                {prevPrim.display}
                              </span>
                              <span className="text-amber-400 text-xs">→</span>
                            </>
                          )}
                          <span>{item.display}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {visibleStructures.length > 0 && (
              <div className="space-y-3">
                {visibleStructures.map((struct) => {
                  const isCollapsed = Boolean(collapsedIds[struct.objectId]);
                  return (
                    <div
                      key={struct.objectId}
                      className={`rounded-lg border border-slate-700/80 bg-[#0e1424] p-3 overflow-x-auto ${
                        struct.status === 'new' ? 'ca-anim-new' : ''
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => toggleCollapse(struct.objectId)}
                            aria-label={isCollapsed ? 'Expand structure' : 'Collapse structure'}
                            className="text-slate-400 hover:text-white cursor-pointer"
                          >
                            {isCollapsed ? (
                              <ChevronRight className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <span className="font-mono font-semibold text-slate-100">
                            {struct.names.join(', ')}
                          </span>
                          <span aria-hidden="true" className="text-slate-600">·</span>
                          <span className="text-slate-400 font-mono">
                            {getStructureSubtitle(struct)}
                          </span>
                          <span aria-hidden="true" className="text-slate-600">·</span>
                          <span className="text-slate-500 font-mono text-[11px]">
                            {struct.objectId}
                          </span>
                          {struct.sharedBy.length > 1 && (
                            <>
                              <span aria-hidden="true" className="text-slate-600">·</span>
                              <span className="text-sky-300 font-mono text-[11px]">
                                shared ({struct.sharedBy.length} refs)
                              </span>
                            </>
                          )}
                        </div>

                        {structures.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setFocusedStructureId((cur) =>
                                cur === struct.objectId ? null : struct.objectId
                              )
                            }
                            className="text-[11px] text-indigo-300 hover:text-indigo-200 cursor-pointer"
                          >
                            {activeFocusId === struct.objectId ? 'Show all' : 'Focus'}
                          </button>
                        )}
                      </div>

                      {!isCollapsed && (
                        <div className="pt-1">
                          {struct.kind === 'array' && (
                            <ArrayRenderer arr={struct} isSwapEvent={isSwapEvent} onInspect={setInspected} />
                          )}
                          {struct.kind === 'set' && <SetRenderer setObj={struct} onInspect={setInspected} />}
                          {struct.kind === 'hash-table' && (
                            <HashTableRenderer table={struct} onInspect={setInspected} />
                          )}
                          {struct.kind === 'tree' && <TreeRenderer tree={struct} onInspect={setInspected} />}
                          {struct.kind === 'linked-list' && (
                            <LinkedListRenderer list={struct} onInspect={setInspected} />
                          )}
                          {struct.kind === 'graph' && <GraphRenderer graph={struct} onInspect={setInspected} />}
                          {struct.kind === 'object' && <ObjectRenderer obj={struct} />}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {animationContract && animationContract.transition.orphanedObjectIds.length > 0 && (
              <div className="text-[11px] font-mono text-slate-400">
                Removed / unreachable on this step: {animationContract.transition.orphanedObjectIds.join(', ')}
              </div>
            )}

            {!frame.scene && primitives.length === 0 && structures.length === 0 && !frame.print && (
              <div className="h-40 flex items-center justify-center text-center">
                <p className="text-xs text-slate-400">
                  {frame.explanation || 'Step forward to inspect how variables and outputs change.'}
                </p>
              </div>
            )}
          </div>
          </CanvasErrorBoundary>
        )}
      </div>
    </section>
  );
}
