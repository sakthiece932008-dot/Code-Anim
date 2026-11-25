import { memo } from 'react';
import {
  Activity,
  ArrowRight,
  Clock,
  Compass,
  Cpu,
  GitMerge,
  LayoutGrid,
  Table2,
  Workflow,
} from 'lucide-react';
import type {
  UniversalVisualScene,
  VisualAccent,
  VisualCardsPanel,
  VisualChartPanel,
  VisualDiagramPanel,
  VisualFlowPanel,
  VisualGrid2DPanel,
  VisualPanel,
  VisualSignalPanel,
  VisualTablePanel,
  VisualTimelinePanel,
} from '../lib/universalVisualEngine';

interface InspectedItem {
  title: string;
  value: string;
  status: string;
  extra?: string;
}

const ACCENT_HEX: Record<VisualAccent, { stroke: string; fill: string; text: string; softBg: string; border: string }> = {
  indigo: {
    stroke: '#818cf8',
    fill: '#312e81',
    text: 'text-indigo-300',
    softBg: 'bg-indigo-500/15',
    border: 'border-indigo-400/60',
  },
  emerald: {
    stroke: '#34d399',
    fill: '#065f46',
    text: 'text-emerald-300',
    softBg: 'bg-emerald-500/15',
    border: 'border-emerald-400/60',
  },
  amber: {
    stroke: '#fbbf24',
    fill: '#78350f',
    text: 'text-amber-300',
    softBg: 'bg-amber-500/15',
    border: 'border-amber-400/60',
  },
  sky: {
    stroke: '#38bdf8',
    fill: '#0c4a6e',
    text: 'text-sky-300',
    softBg: 'bg-sky-500/15',
    border: 'border-sky-400/60',
  },
  rose: {
    stroke: '#fb7185',
    fill: '#881337',
    text: 'text-rose-300',
    softBg: 'bg-rose-500/15',
    border: 'border-rose-400/60',
  },
  violet: {
    stroke: '#a78bfa',
    fill: '#4c1d95',
    text: 'text-violet-300',
    softBg: 'bg-violet-500/15',
    border: 'border-violet-400/60',
  },
  slate: {
    stroke: '#94a3b8',
    fill: '#1e293b',
    text: 'text-slate-300',
    softBg: 'bg-slate-500/15',
    border: 'border-slate-500/60',
  },
};

const TablePanelView = memo(function TablePanelView({
  panel,
  onInspect,
}: {
  panel: VisualTablePanel;
  onInspect?: (item: InspectedItem) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse font-mono text-xs">
        <thead>
          <tr className="border-b border-slate-700/80 text-[11px] text-slate-400">
            <th className="py-1.5 px-2 font-medium w-8">#</th>
            {panel.columns.map((col) => (
              <th key={col.key} className="py-1.5 px-2.5 font-semibold text-indigo-300 whitespace-nowrap">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {panel.rows.map((row, rIdx) => {
            const changedSet = new Set(row.changedKeys || []);
            return (
              <tr
                key={row.id}
                onClick={() =>
                  onInspect?.({
                    title: `${panel.title} · Row ${rIdx + 1}`,
                    value: panel.columns.map((c) => `${c.label}=${row.cells[c.key] ?? ''}`).join(', '),
                    status:
                      row.status === 'new'
                        ? 'Added (+)'
                        : row.status === 'changed'
                          ? 'Updated (Δ)'
                          : 'Unchanged',
                  })
                }
                className={`border-b border-slate-800/70 cursor-pointer transition-colors hover:bg-slate-800/50 ${
                  row.status === 'new'
                    ? 'bg-emerald-500/10 ca-anim-new'
                    : row.status === 'changed'
                      ? 'bg-amber-500/10'
                      : ''
                }`}
              >
                <td className="py-1.5 px-2 text-slate-500 tabular-nums">{rIdx}</td>
                {panel.columns.map((col) => {
                  const isCellChanged = changedSet.has(col.key);
                  return (
                    <td
                      key={col.key}
                      className={`py-1.5 px-2.5 tabular-nums whitespace-nowrap ${
                        isCellChanged
                          ? 'text-amber-200 font-semibold bg-amber-500/20 ca-anim-chg'
                          : row.status === 'new'
                            ? 'text-emerald-200'
                            : 'text-slate-100'
                      }`}
                    >
                      {row.cells[col.key] ?? ''}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});

const ChartPanelView = memo(function ChartPanelView({
  panel,
  onInspect,
}: {
  panel: VisualChartPanel;
  onInspect?: (item: InspectedItem) => void;
}) {
  const allValues = panel.series.flatMap((s) => s.points.map((p) => p.value));
  const rawMin = Math.min(...allValues, 0);
  const rawMax = Math.max(...allValues, 1);
  const span = Math.max(1e-6, rawMax - rawMin);
  const padMin = rawMin - span * 0.08;
  const padMax = rawMax + span * 0.1;
  const ySpan = Math.max(1e-6, padMax - padMin);

  const width = 420;
  const height = 136;
  const padL = 44;
  const padR = 14;
  const padT = 14;
  const padB = 22;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const maxStep = Math.max(
    1,
    ...panel.series.flatMap((s) => s.points.map((p) => p.step)),
    panel.activeStep
  );

  const xOf = (step: number) => padL + (step / maxStep) * plotW;
  const yOf = (val: number) => padT + (1 - (val - padMin) / ySpan) * plotH;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
        {panel.series.map((s) => {
          const style = ACCENT_HEX[s.accent];
          const delta = s.previousValue !== undefined ? s.currentValue - s.previousValue : 0;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() =>
                onInspect?.({
                  title: s.name,
                  value: String(Number(s.currentValue.toFixed(4))),
                  status: delta !== 0 ? `Delta ${delta > 0 ? '+' : ''}${Number(delta.toFixed(4))}` : 'Stable',
                  extra: `${s.points.length} recorded points`,
                })
              }
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border ${style.border} ${style.softBg} cursor-pointer`}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: style.stroke }} />
              <span className={style.text}>{s.name}:</span>
              <span className="text-slate-100 font-semibold tabular-nums">
                {Number(s.currentValue.toFixed(3))}
              </span>
              {delta !== 0 && (
                <span className={delta > 0 ? 'text-emerald-300' : 'text-rose-300'}>
                  ({delta > 0 ? '+' : ''}
                  {Number(delta.toFixed(2))})
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto">
        <svg
          width="100%"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={panel.title}
          className="max-w-[560px] h-auto block"
        >
          {/* Horizontal guide lines */}
          {[0, 0.5, 1].map((frac) => {
            const y = padT + frac * plotH;
            const val = padMax - frac * ySpan;
            return (
              <g key={frac}>
                <line x1={padL} y1={y} x2={width - padR} y2={y} stroke="#334155" strokeDasharray="3 3" strokeWidth={1} />
                <text x={padL - 6} y={y} fill="#94a3b8" fontSize={9} textAnchor="end" dominantBaseline="central" className="font-mono">
                  {Math.abs(val) >= 100 ? Math.round(val) : Number(val.toFixed(1))}
                </text>
              </g>
            );
          })}

          {panel.chartType === 'bar' && panel.series.length === 1 ? (
            panel.series[0].points.map((pt, idx) => {
              const count = panel.series[0].points.length;
              const bw = Math.max(12, Math.min(34, plotW / count - 6));
              const cx = padL + ((idx + 0.5) / count) * plotW;
              const yZero = yOf(0);
              const yVal = yOf(pt.value);
              const top = Math.min(yZero, yVal);
              const barH = Math.max(2, Math.abs(yZero - yVal));
              const isLast = idx === count - 1;
              const color = ACCENT_HEX[panel.series[0].accent].stroke;
              return (
                <g key={idx}>
                  <rect
                    x={cx - bw / 2}
                    y={top}
                    width={bw}
                    height={barH}
                    rx={3}
                    fill={color}
                    fillOpacity={isLast ? 0.95 : 0.45}
                    stroke={isLast ? '#f8fafc' : 'none'}
                    strokeWidth={1.2}
                  />
                  <text x={cx} y={height - 6} fill="#94a3b8" fontSize={9} textAnchor="middle" className="font-mono">
                    S{pt.label}
                  </text>
                </g>
              );
            })
          ) : (
            panel.series.map((s) => {
              const color = ACCENT_HEX[s.accent].stroke;
              const pathD = s.points
                .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${xOf(pt.step).toFixed(1)} ${yOf(pt.value).toFixed(1)}`)
                .join(' ');
              const lastPt = s.points[s.points.length - 1];
              return (
                <g key={s.id}>
                  <path d={pathD} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" />
                  {s.points.map((pt, idx) => (
                    <circle
                      key={idx}
                      cx={xOf(pt.step)}
                      cy={yOf(pt.value)}
                      r={idx === s.points.length - 1 ? 4.2 : 2.3}
                      fill={idx === s.points.length - 1 ? '#f8fafc' : color}
                      stroke={color}
                      strokeWidth={1.5}
                    />
                  ))}
                  {lastPt && (
                    <text
                      x={Math.min(width - 6, xOf(lastPt.step) + 6)}
                      y={Math.max(12, yOf(lastPt.value) - 6)}
                      fill={color}
                      fontSize={9}
                      fontWeight={700}
                      className="font-mono"
                    >
                      {Number(lastPt.value.toFixed(2))}
                    </text>
                  )}
                </g>
              );
            })
          )}
        </svg>
      </div>
    </div>
  );
});

const TimelinePanelView = memo(function TimelinePanelView({
  panel,
  onInspect,
}: {
  panel: VisualTimelinePanel;
  onInspect?: (item: InspectedItem) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {panel.items.map((item, idx) => {
        const style = ACCENT_HEX[item.accent];
        const isActive = item.status === 'active';
        const isUpcoming = item.status === 'upcoming';
        return (
          <button
            key={item.id}
            type="button"
            onClick={() =>
              onInspect?.({
                title: `${panel.title} · ${item.label}`,
                value:
                  item.stepStart === item.stepEnd
                    ? `Step ${item.stepStart + 1}`
                    : `Steps ${item.stepStart + 1}–${item.stepEnd + 1}`,
                status: isActive ? 'Running now' : isUpcoming ? 'Upcoming' : 'Completed',
              })
            }
            className={`px-2.5 py-1.5 rounded-lg border font-mono text-xs text-left transition-all cursor-pointer ${
              isActive
                ? `${style.border} ${style.softBg} ring-2 ring-indigo-400/50 text-white ca-anim-chg`
                : isUpcoming
                  ? 'border-slate-800 bg-slate-900/40 text-slate-500 opacity-60'
                  : 'border-slate-700/80 bg-slate-900/80 text-slate-200'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-slate-400 tabular-nums">{idx + 1}.</span>
              <span className="font-semibold">{item.label}</span>
            </div>
            <div className="text-[10px] text-slate-400 tabular-nums mt-0.5">
              {item.sublabel ||
                (item.stepStart === item.stepEnd
                  ? `step ${item.stepStart + 1}`
                  : `steps ${item.stepStart + 1}–${item.stepEnd + 1}`)}
            </div>
          </button>
        );
      })}
    </div>
  );
});

const DiagramPanelView = memo(function DiagramPanelView({
  panel,
  onInspect,
}: {
  panel: VisualDiagramPanel;
  onInspect?: (item: InspectedItem) => void;
}) {
  const positions = new Map<string, { x: number; y: number }>();
  let width = 380;
  let height = 160;

  if (panel.layout === 'ring' && panel.nodes.length > 1) {
    const count = panel.nodes.length;
    const radius = Math.min(115, Math.max(58, count * 18));
    width = radius * 2 + 140;
    height = radius * 2 + 100;
    const cx = width / 2;
    const cy = height / 2;
    panel.nodes.forEach((n, idx) => {
      const angle = (2 * Math.PI * idx) / count - Math.PI / 2;
      positions.set(n.id, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
    });
  } else if (panel.layout === 'flow') {
    const stepX = 128;
    width = Math.max(240, panel.nodes.length * stepX + 32);
    height = 112;
    panel.nodes.forEach((n, idx) => {
      positions.set(n.id, { x: 74 + idx * stepX, y: height / 2 });
    });
  } else {
    // Layered layout (neural layers, object relationships, pipelines)
    const byLayer = new Map<number, typeof panel.nodes>();
    panel.nodes.forEach((n, idx) => {
      const layer = n.layer ?? idx % 3;
      const list = byLayer.get(layer) || [];
      list.push(n);
      byLayer.set(layer, list);
    });
    const layers = [...byLayer.keys()].sort((a, b) => a - b);
    const maxPerLayer = Math.max(1, ...[...byLayer.values()].map((l) => l.length));
    const colGap = 152;
    const rowGap = 62;
    width = Math.max(280, layers.length * colGap + 40);
    height = Math.max(116, maxPerLayer * rowGap + 36);
    layers.forEach((layerKey, colIdx) => {
      const colNodes = byLayer.get(layerKey) || [];
      const colH = (colNodes.length - 1) * rowGap;
      const startY = (height - colH) / 2;
      colNodes.forEach((n, rowIdx) => {
        positions.set(n.id, { x: 82 + colIdx * colGap, y: startY + rowIdx * rowGap });
      });
    });
  }

  const markerId = `u-arrow-${panel.id.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <div className="overflow-x-auto py-1">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={panel.title} className="block mx-auto">
        <defs>
          <marker id={markerId} viewBox="0 0 10 10" refX="22" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#94a3b8" />
          </marker>
        </defs>

        {panel.edges.map((edge, idx) => {
          const from = positions.get(edge.from);
          const to = positions.get(edge.to);
          if (!from || !to) return null;
          const midX = (from.x + to.x) / 2;
          const midY = (from.y + to.y) / 2;
          return (
            <g key={`${edge.from}-${edge.to}-${idx}`}>
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={edge.active ? '#34d399' : '#64748b'}
                strokeWidth={edge.active ? 2.4 : 1.5}
                markerEnd={edge.directed !== false ? `url(#${markerId})` : undefined}
              />
              {edge.label && (
                <text x={midX} y={midY - 6} fill="#cbd5e1" fontSize={9.5} textAnchor="middle" className="font-mono">
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}

        {panel.nodes.map((node) => {
          const pos = positions.get(node.id);
          if (!pos) return null;
          const style = ACCENT_HEX[node.accent || 'indigo'];
          const isActive = node.status === 'active' || node.status === 'new' || node.status === 'changed';
          const shortLabel = node.label.length > 14 ? `${node.label.slice(0, 12)}…` : node.label;

          return (
            <g
              key={node.id}
              onClick={() =>
                onInspect?.({
                  title: node.label,
                  value: node.sublabel || node.shape,
                  status: isActive ? 'Active / Highlighted' : 'Connected',
                })
              }
              className="cursor-pointer"
            >
              {node.shape === 'circle' ? (
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={24}
                  fill={isActive ? style.fill : '#1e293b'}
                  stroke={style.stroke}
                  strokeWidth={isActive ? 2.6 : 1.8}
                />
              ) : node.shape === 'diamond' ? (
                <polygon
                  points={`${pos.x},${pos.y - 24} ${pos.x + 36},${pos.y} ${pos.x},${pos.y + 24} ${pos.x - 36},${pos.y}`}
                  fill={isActive ? style.fill : '#1e293b'}
                  stroke={style.stroke}
                  strokeWidth={isActive ? 2.5 : 1.8}
                />
              ) : (
                <rect
                  x={pos.x - 48}
                  y={pos.y - 19}
                  width={96}
                  height={38}
                  rx={node.shape === 'pill' ? 19 : 8}
                  fill={isActive ? style.fill : '#1e293b'}
                  stroke={style.stroke}
                  strokeWidth={isActive ? 2.5 : 1.8}
                />
              )}
              <text
                x={pos.x}
                y={node.sublabel ? pos.y - 4 : pos.y}
                fill="#f8fafc"
                fontSize={10.5}
                fontWeight={600}
                textAnchor="middle"
                dominantBaseline="central"
                className="font-mono"
              >
                {shortLabel}
              </text>
              {node.sublabel && (
                <text
                  x={pos.x}
                  y={pos.y + 10}
                  fill="#94a3b8"
                  fontSize={8.5}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="font-mono"
                >
                  {node.sublabel.slice(0, 14)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
});

const SignalPanelView = memo(function SignalPanelView({ panel }: { panel: VisualSignalPanel }) {
  return (
    <div className="space-y-2">
      {panel.tracks.map((track) => {
        const color = ACCENT_HEX[track.accent].stroke;
        const n = Math.max(1, track.samples.length);
        const stepW = Math.max(14, Math.min(28, 320 / n));
        const svgW = n * stepW + 8;
        const svgH = 28;
        let d = '';
        track.samples.forEach((s, idx) => {
          const x0 = 4 + idx * stepW;
          const x1 = x0 + stepW;
          const y = s.bit === 1 ? 5 : 22;
          if (idx === 0) {
            d = `M ${x0} ${y} L ${x1} ${y}`;
          } else {
            d += ` L ${x0} ${y} L ${x1} ${y}`;
          }
        });
        return (
          <div key={track.id} className="flex items-center gap-3 font-mono text-xs">
            <span className="w-24 truncate text-slate-300 text-right shrink-0">{track.name}</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                track.currentBit === 1
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/50'
                  : 'bg-slate-800 text-slate-400 border border-slate-700'
              }`}
            >
              {track.currentBit === 1 ? 'HIGH (1)' : 'LOW (0)'}
            </span>
            <div className="overflow-x-auto flex-1">
              <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} className="block">
                <line x1={4} y1={22} x2={svgW - 4} y2={22} stroke="#334155" strokeWidth={1} strokeDasharray="2 3" />
                <path d={d} fill="none" stroke={color} strokeWidth={2.2} />
              </svg>
            </div>
          </div>
        );
      })}
    </div>
  );
});

const Grid2DPanelView = memo(function Grid2DPanelView({
  panel,
  onInspect,
}: {
  panel: VisualGrid2DPanel;
  onInspect?: (item: InspectedItem) => void;
}) {
  const width = 360;
  const height = 190;
  const pad = 28;
  const plotW = width - pad * 2;
  const plotH = height - pad * 2;
  const xSpan = Math.max(1, panel.maxX - panel.minX);
  const ySpan = Math.max(1, panel.maxY - panel.minY);
  const px = (x: number) => pad + ((x - panel.minX) / xSpan) * plotW;
  const py = (y: number) => height - pad - ((y - panel.minY) / ySpan) * plotH;

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={panel.title} className="block mx-auto rounded-lg bg-slate-950/60 border border-slate-800">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={pad + f * plotW} y1={pad} x2={pad + f * plotW} y2={height - pad} stroke="#1e293b" strokeWidth={1} />
            <line x1={pad} y1={pad + f * plotH} x2={width - pad} y2={pad + f * plotH} stroke="#1e293b" strokeWidth={1} />
          </g>
        ))}

        {/* Axis bounds */}
        <text x={pad} y={height - 8} fill="#64748b" fontSize={9} className="font-mono">
          ({panel.minX},{panel.minY})
        </text>
        <text x={width - pad} y={height - 8} fill="#64748b" fontSize={9} textAnchor="end" className="font-mono">
          x={panel.maxX}
        </text>
        <text x={pad} y={16} fill="#64748b" fontSize={9} className="font-mono">
          y={panel.maxY}
        </text>

        {panel.entities.map((ent) => {
          const color = ACCENT_HEX[ent.accent].stroke;
          const trailPath =
            ent.trail && ent.trail.length > 1
              ? ent.trail.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${px(pt.x).toFixed(1)} ${py(pt.y).toFixed(1)}`).join(' ')
              : null;
          const cx = px(ent.x);
          const cy = py(ent.y);
          return (
            <g
              key={ent.id}
              onClick={() =>
                onInspect?.({
                  title: ent.label,
                  value: `(${ent.x}, ${ent.y})`,
                  status: `${ent.trail?.length || 1} recorded position(s)`,
                  extra: ent.meta,
                })
              }
              className="cursor-pointer"
            >
              {trailPath && <path d={trailPath} fill="none" stroke={color} strokeWidth={1.8} strokeDasharray="4 3" opacity={0.7} />}
              <circle cx={cx} cy={cy} r={7.5} fill={color} stroke="#f8fafc" strokeWidth={1.8} />
              <text x={cx} y={cy - 12} fill="#f8fafc" fontSize={10} fontWeight={600} textAnchor="middle" className="font-mono">
                {ent.label} ({Number(ent.x.toFixed(1))},{Number(ent.y.toFixed(1))})
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
});

const CardsPanelView = memo(function CardsPanelView({ panel }: { panel: VisualCardsPanel }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      {panel.cards.map((card) => {
        const style = ACCENT_HEX[card.accent];
        return (
          <div key={card.id} className={`rounded-lg border p-2.5 ${style.border} ${style.softBg}`}>
            <div className="flex items-center justify-between gap-2 mb-1.5 text-xs">
              <span className="font-semibold text-slate-100">{card.title}</span>
              {card.badge && <span className={`font-mono text-[10px] ${style.text}`}>{card.badge}</span>}
            </div>
            <div className="space-y-1 font-mono text-[11px]">
              {card.fields.map((f, idx) => (
                <div key={idx} className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">{f.label}</span>
                  <span className={f.changed ? 'text-amber-200 font-semibold' : 'text-slate-100'}>
                    {f.previousValue && f.changed ? `${f.previousValue} → ` : ''}
                    {f.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
});

const FlowPanelView = memo(function FlowPanelView({ panel }: { panel: VisualFlowPanel }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {panel.stages.map((stage, idx) => {
        const style = ACCENT_HEX[stage.accent];
        return (
          <div key={stage.id} className="flex items-center gap-2">
            {idx > 0 && <ArrowRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />}
            <div
              className={`rounded-lg border px-3 py-2 min-w-[115px] ${
                stage.active ? `${style.border} ${style.softBg} ca-anim-chg` : 'border-slate-700/70 bg-slate-900/70'
              }`}
            >
              <div className={`text-[10px] font-semibold uppercase tracking-wide ${style.text}`}>{stage.label}</div>
              <div className="text-xs font-mono text-slate-100 mt-0.5">{stage.detail}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
});

function getPanelIcon(kind: VisualPanel['kind']) {
  switch (kind) {
    case 'table':
      return <Table2 className="w-3.5 h-3.5 text-sky-400" />;
    case 'chart':
      return <Activity className="w-3.5 h-3.5 text-indigo-400" />;
    case 'timeline':
      return <Clock className="w-3.5 h-3.5 text-amber-400" />;
    case 'diagram':
      return <GitMerge className="w-3.5 h-3.5 text-violet-400" />;
    case 'signal':
      return <Cpu className="w-3.5 h-3.5 text-emerald-400" />;
    case 'grid2d':
      return <Compass className="w-3.5 h-3.5 text-sky-400" />;
    case 'cards':
      return <LayoutGrid className="w-3.5 h-3.5 text-indigo-400" />;
    case 'flow':
      return <Workflow className="w-3.5 h-3.5 text-emerald-400" />;
  }
}

export const UniversalSceneRenderer = memo(function UniversalSceneRenderer({
  scene,
  onInspect,
}: {
  scene: UniversalVisualScene;
  onInspect?: (item: InspectedItem) => void;
}) {
  if (!scene || scene.panels.length === 0) return null;

  return (
    <div className="space-y-3" data-testid="universal-scene-renderer">
      {scene.domainLabel && (
        <div className="flex items-center gap-2 text-[11px] font-medium text-sky-300">
          <span>Adaptive View: {scene.domainLabel}</span>
          {scene.source === 'ai-assisted' && (
            <span className="text-slate-400 font-normal">· AI-assisted layout</span>
          )}
        </div>
      )}

      {scene.panels.map((panel) => (
        <div
          key={panel.id}
          className="rounded-lg border border-slate-700/80 bg-[#0e1424] p-3 space-y-2"
          data-panel-kind={panel.kind}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-slate-100">
              {getPanelIcon(panel.kind)}
              <span>{panel.title}</span>
            </div>
            {panel.subtitle && <span className="text-[11px] font-mono text-slate-400">{panel.subtitle}</span>}
          </div>

          {panel.kind === 'table' && <TablePanelView panel={panel} onInspect={onInspect} />}
          {panel.kind === 'chart' && <ChartPanelView panel={panel} onInspect={onInspect} />}
          {panel.kind === 'timeline' && <TimelinePanelView panel={panel} onInspect={onInspect} />}
          {panel.kind === 'diagram' && <DiagramPanelView panel={panel} onInspect={onInspect} />}
          {panel.kind === 'signal' && <SignalPanelView panel={panel} />}
          {panel.kind === 'grid2d' && <Grid2DPanelView panel={panel} onInspect={onInspect} />}
          {panel.kind === 'cards' && <CardsPanelView panel={panel} />}
          {panel.kind === 'flow' && <FlowPanelView panel={panel} />}
        </div>
      ))}
    </div>
  );
});
