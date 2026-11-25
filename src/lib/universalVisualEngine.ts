/**
 * CODE ANIM — UNIVERSAL DECLARATIVE VISUALIZATION ENGINE
 *
 * Dynamically analyzes ANY program's live trace history, variables, heap objects,
 * state transitions, numeric trends, 2D coordinates, binary signals, record tables,
 * and execution timelines — then composes a validated declarative UniversalVisualScene
 * built from reusable visual primitives (boxes, circles, diamonds, arrows, connecting
 * lines, tables, grids, charts, bars, timelines, waveforms, cards, and flow pipelines).
 *
 * SECURITY:
 * - Pure declarative JSON data structures only.
 * - NEVER accepts or executes arbitrary HTML, CSS, SVG strings, or JavaScript.
 * - Strict runtime validation (`validateVisualScene`) enforces allowlists and bounds
 *   on both locally synthesized scenes and optional AI-suggested visual layouts.
 */

import {
  isObjectRef,
  type HeapObject,
  type TraceDocument,
  type TraceEvent,
  type ValueRef,
} from '../types/trace';
import type { ReconstructedFrame } from './replayEngine';

export type VisualAccent = 'indigo' | 'emerald' | 'amber' | 'sky' | 'rose' | 'violet' | 'slate';

const ALLOWED_ACCENTS = new Set<VisualAccent>([
  'indigo',
  'emerald',
  'amber',
  'sky',
  'rose',
  'violet',
  'slate',
]);

export interface VisualTableColumn {
  key: string;
  label: string;
}

export interface VisualTableRow {
  id: string;
  cells: Record<string, string>;
  status?: 'new' | 'changed' | 'active' | 'unchanged';
  changedKeys?: string[];
}

export interface VisualTablePanel {
  id: string;
  kind: 'table';
  title: string;
  subtitle?: string;
  accent?: VisualAccent;
  columns: VisualTableColumn[];
  rows: VisualTableRow[];
}

export interface VisualChartPoint {
  step: number;
  label: string;
  value: number;
}

export interface VisualChartSeries {
  id: string;
  name: string;
  accent: VisualAccent;
  currentValue: number;
  previousValue?: number;
  points: VisualChartPoint[];
}

export interface VisualChartPanel {
  id: string;
  kind: 'chart';
  title: string;
  subtitle?: string;
  chartType: 'line' | 'bar';
  series: VisualChartSeries[];
  activeStep: number;
}

export interface VisualTimelineItem {
  id: string;
  label: string;
  sublabel?: string;
  stepStart: number;
  stepEnd: number;
  accent: VisualAccent;
  status: 'past' | 'active' | 'upcoming';
}

export interface VisualTimelinePanel {
  id: string;
  kind: 'timeline';
  title: string;
  subtitle?: string;
  items: VisualTimelineItem[];
  currentStep: number;
  totalSteps: number;
}

export interface VisualDiagramNode {
  id: string;
  label: string;
  sublabel?: string;
  shape: 'box' | 'circle' | 'diamond' | 'pill';
  layer?: number;
  accent?: VisualAccent;
  status?: 'new' | 'changed' | 'active' | 'unchanged';
}

export interface VisualDiagramEdge {
  from: string;
  to: string;
  label?: string;
  directed?: boolean;
  active?: boolean;
}

export interface VisualDiagramPanel {
  id: string;
  kind: 'diagram';
  title: string;
  subtitle?: string;
  layout: 'layered' | 'ring' | 'flow';
  nodes: VisualDiagramNode[];
  edges: VisualDiagramEdge[];
}

export interface VisualSignalTrack {
  id: string;
  name: string;
  accent: VisualAccent;
  samples: Array<{ step: number; bit: 0 | 1; raw: string }>;
  currentBit: 0 | 1;
}

export interface VisualSignalPanel {
  id: string;
  kind: 'signal';
  title: string;
  subtitle?: string;
  tracks: VisualSignalTrack[];
  activeStep: number;
}

export interface VisualGridEntity {
  id: string;
  label: string;
  x: number;
  y: number;
  accent: VisualAccent;
  trail?: Array<{ x: number; y: number }>;
  meta?: string;
}

export interface VisualGrid2DPanel {
  id: string;
  kind: 'grid2d';
  title: string;
  subtitle?: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  entities: VisualGridEntity[];
}

export interface VisualCardField {
  label: string;
  value: string;
  previousValue?: string;
  changed?: boolean;
}

export interface VisualCardItem {
  id: string;
  title: string;
  badge?: string;
  accent: VisualAccent;
  status?: 'new' | 'changed' | 'active' | 'unchanged';
  fields: VisualCardField[];
}

export interface VisualCardsPanel {
  id: string;
  kind: 'cards';
  title: string;
  subtitle?: string;
  cards: VisualCardItem[];
}

export interface VisualFlowStage {
  id: string;
  label: string;
  detail: string;
  accent: VisualAccent;
  active?: boolean;
}

export interface VisualFlowPanel {
  id: string;
  kind: 'flow';
  title: string;
  subtitle?: string;
  stages: VisualFlowStage[];
}

export type VisualPanel =
  | VisualTablePanel
  | VisualChartPanel
  | VisualTimelinePanel
  | VisualDiagramPanel
  | VisualSignalPanel
  | VisualGrid2DPanel
  | VisualCardsPanel
  | VisualFlowPanel;

export interface UniversalVisualScene {
  schemaVersion: '1.0';
  source: 'synthesized' | 'ai-assisted';
  domainLabel?: string;
  summaryLine?: string;
  panels: VisualPanel[];
}

const MAX_PANELS = 8;
const MAX_ITEMS = 32;
const MAX_STR = 96;

function safeText(v: unknown, maxLen = MAX_STR): string {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function safeAccent(v: unknown, fallback: VisualAccent = 'indigo'): VisualAccent {
  if (typeof v === 'string' && ALLOWED_ACCENTS.has(v as VisualAccent)) {
    return v as VisualAccent;
  }
  return fallback;
}

function safeFinite(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Strictly validates any UniversalVisualScene (whether locally synthesized or AI-generated).
 * Rejects unknown panel kinds, unsafe shapes, malformed structures, and excessive item counts.
 */
export function validateVisualScene(raw: unknown): UniversalVisualScene | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.panels)) return null;

  const panels: VisualPanel[] = [];

  for (const rawPanel of obj.panels.slice(0, MAX_PANELS)) {
    if (!rawPanel || typeof rawPanel !== 'object' || Array.isArray(rawPanel)) continue;
    const p = rawPanel as Record<string, unknown>;
    const kind = p.kind;
    const id = safeText(p.id, 48) || `panel_${panels.length + 1}`;
    const title = safeText(p.title, 80);
    if (!title) continue;
    const subtitle = safeText(p.subtitle, 120) || undefined;

    if (kind === 'table' && Array.isArray(p.columns) && Array.isArray(p.rows)) {
      const columns: VisualTableColumn[] = [];
      for (const c of p.columns.slice(0, 12)) {
        if (c && typeof c === 'object') {
          const ck = safeText((c as Record<string, unknown>).key, 40);
          const cl = safeText((c as Record<string, unknown>).label, 40) || ck;
          if (ck) columns.push({ key: ck, label: cl });
        }
      }
      if (columns.length === 0) continue;
      const rows: VisualTableRow[] = [];
      for (const r of p.rows.slice(0, MAX_ITEMS)) {
        if (!r || typeof r !== 'object') continue;
        const rr = r as Record<string, unknown>;
        const rawCells = rr.cells && typeof rr.cells === 'object' ? (rr.cells as Record<string, unknown>) : {};
        const cells: Record<string, string> = {};
        for (const col of columns) {
          cells[col.key] = safeText(rawCells[col.key], 64);
        }
        const status =
          rr.status === 'new' || rr.status === 'changed' || rr.status === 'active'
            ? rr.status
            : 'unchanged';
        const changedKeys = Array.isArray(rr.changedKeys)
          ? rr.changedKeys.map((k) => safeText(k, 40)).filter(Boolean)
          : undefined;
        rows.push({
          id: safeText(rr.id, 40) || `row_${rows.length}`,
          cells,
          status,
          changedKeys,
        });
      }
      panels.push({ id, kind: 'table', title, subtitle, accent: safeAccent(p.accent, 'sky'), columns, rows });
    } else if (kind === 'chart' && Array.isArray(p.series)) {
      const series: VisualChartSeries[] = [];
      for (const s of p.series.slice(0, 6)) {
        if (!s || typeof s !== 'object') continue;
        const ss = s as Record<string, unknown>;
        const name = safeText(ss.name, 48);
        if (!name || !Array.isArray(ss.points)) continue;
        const points: VisualChartPoint[] = [];
        for (const pt of ss.points.slice(0, 60)) {
          if (!pt || typeof pt !== 'object') continue;
          const pp = pt as Record<string, unknown>;
          const val = Number(pp.value);
          if (!Number.isFinite(val)) continue;
          points.push({
            step: Math.max(0, Math.round(safeFinite(pp.step, points.length))),
            label: safeText(pp.label, 24) || `S${points.length + 1}`,
            value: val,
          });
        }
        if (points.length === 0) continue;
        const prevVal = ss.previousValue !== undefined ? Number(ss.previousValue) : undefined;
        series.push({
          id: safeText(ss.id, 40) || `s_${series.length}`,
          name,
          accent: safeAccent(ss.accent, 'indigo'),
          currentValue: safeFinite(ss.currentValue, points[points.length - 1].value),
          previousValue: prevVal !== undefined && Number.isFinite(prevVal) ? prevVal : undefined,
          points,
        });
      }
      if (series.length > 0) {
        panels.push({
          id,
          kind: 'chart',
          title,
          subtitle,
          chartType: p.chartType === 'bar' ? 'bar' : 'line',
          series,
          activeStep: Math.max(0, Math.round(safeFinite(p.activeStep, 0))),
        });
      }
    } else if (kind === 'timeline' && Array.isArray(p.items)) {
      const items: VisualTimelineItem[] = [];
      for (const it of p.items.slice(0, MAX_ITEMS)) {
        if (!it || typeof it !== 'object') continue;
        const ii = it as Record<string, unknown>;
        const label = safeText(ii.label, 48);
        if (!label) continue;
        const stepStart = Math.max(0, Math.round(safeFinite(ii.stepStart, 0)));
        const stepEnd = Math.max(stepStart, Math.round(safeFinite(ii.stepEnd, stepStart)));
        items.push({
          id: safeText(ii.id, 40) || `tl_${items.length}`,
          label,
          sublabel: safeText(ii.sublabel, 48) || undefined,
          stepStart,
          stepEnd,
          accent: safeAccent(ii.accent, 'indigo'),
          status: ii.status === 'active' || ii.status === 'upcoming' ? ii.status : 'past',
        });
      }
      if (items.length > 0) {
        panels.push({
          id,
          kind: 'timeline',
          title,
          subtitle,
          items,
          currentStep: Math.max(0, Math.round(safeFinite(p.currentStep, 0))),
          totalSteps: Math.max(1, Math.round(safeFinite(p.totalSteps, 1))),
        });
      }
    } else if (kind === 'diagram' && Array.isArray(p.nodes)) {
      const nodes: VisualDiagramNode[] = [];
      const nodeIds = new Set<string>();
      for (const n of p.nodes.slice(0, MAX_ITEMS)) {
        if (!n || typeof n !== 'object') continue;
        const nn = n as Record<string, unknown>;
        const nid = safeText(nn.id, 40);
        const label = safeText(nn.label, 48);
        if (!nid || !label || nodeIds.has(nid)) continue;
        nodeIds.add(nid);
        const shape =
          nn.shape === 'circle' || nn.shape === 'diamond' || nn.shape === 'pill' ? nn.shape : 'box';
        const status =
          nn.status === 'new' || nn.status === 'changed' || nn.status === 'active'
            ? nn.status
            : 'unchanged';
        nodes.push({
          id: nid,
          label,
          sublabel: safeText(nn.sublabel, 48) || undefined,
          shape,
          layer: typeof nn.layer === 'number' && Number.isFinite(nn.layer) ? Math.max(0, Math.min(8, Math.round(nn.layer))) : undefined,
          accent: safeAccent(nn.accent, 'indigo'),
          status,
        });
      }
      const edges: VisualDiagramEdge[] = [];
      if (Array.isArray(p.edges)) {
        for (const e of p.edges.slice(0, 64)) {
          if (!e || typeof e !== 'object') continue;
          const ee = e as Record<string, unknown>;
          const from = safeText(ee.from, 40);
          const to = safeText(ee.to, 40);
          if (!from || !to || !nodeIds.has(from) || !nodeIds.has(to)) continue;
          edges.push({
            from,
            to,
            label: safeText(ee.label, 36) || undefined,
            directed: ee.directed !== false,
            active: ee.active === true,
          });
        }
      }
      if (nodes.length > 0) {
        const layout = p.layout === 'ring' || p.layout === 'flow' ? p.layout : 'layered';
        panels.push({ id, kind: 'diagram', title, subtitle, layout, nodes, edges });
      }
    } else if (kind === 'signal' && Array.isArray(p.tracks)) {
      const tracks: VisualSignalTrack[] = [];
      for (const t of p.tracks.slice(0, 10)) {
        if (!t || typeof t !== 'object') continue;
        const tt = t as Record<string, unknown>;
        const name = safeText(tt.name, 40);
        if (!name || !Array.isArray(tt.samples)) continue;
        const samples: Array<{ step: number; bit: 0 | 1; raw: string }> = [];
        for (const s of tt.samples.slice(0, 48)) {
          if (!s || typeof s !== 'object') continue;
          const ss = s as Record<string, unknown>;
          samples.push({
            step: Math.max(0, Math.round(safeFinite(ss.step, samples.length))),
            bit: ss.bit === 1 ? 1 : 0,
            raw: safeText(ss.raw, 20),
          });
        }
        if (samples.length > 0) {
          tracks.push({
            id: safeText(tt.id, 40) || `sig_${tracks.length}`,
            name,
            accent: safeAccent(tt.accent, 'emerald'),
            samples,
            currentBit: tt.currentBit === 1 ? 1 : 0,
          });
        }
      }
      if (tracks.length > 0) {
        panels.push({
          id,
          kind: 'signal',
          title,
          subtitle,
          tracks,
          activeStep: Math.max(0, Math.round(safeFinite(p.activeStep, 0))),
        });
      }
    } else if (kind === 'grid2d' && Array.isArray(p.entities)) {
      const entities: VisualGridEntity[] = [];
      for (const ent of p.entities.slice(0, 16)) {
        if (!ent || typeof ent !== 'object') continue;
        const ee = ent as Record<string, unknown>;
        const label = safeText(ee.label, 36);
        const x = Number(ee.x);
        const y = Number(ee.y);
        if (!label || !Number.isFinite(x) || !Number.isFinite(y)) continue;
        const trail = Array.isArray(ee.trail)
          ? ee.trail
              .slice(0, 40)
              .filter(
                (pt): pt is { x: number; y: number } =>
                  Boolean(pt && typeof pt === 'object' && Number.isFinite(Number((pt as Record<string, unknown>).x)) && Number.isFinite(Number((pt as Record<string, unknown>).y)))
              )
              .map((pt) => ({ x: Number(pt.x), y: Number(pt.y) }))
          : undefined;
        entities.push({
          id: safeText(ee.id, 40) || `ent_${entities.length}`,
          label,
          x,
          y,
          accent: safeAccent(ee.accent, 'sky'),
          trail,
          meta: safeText(ee.meta, 64) || undefined,
        });
      }
      if (entities.length > 0) {
        const minX = safeFinite(p.minX, 0);
        const maxX = Math.max(minX + 1, safeFinite(p.maxX, 10));
        const minY = safeFinite(p.minY, 0);
        const maxY = Math.max(minY + 1, safeFinite(p.maxY, 10));
        panels.push({ id, kind: 'grid2d', title, subtitle, minX, maxX, minY, maxY, entities });
      }
    } else if (kind === 'cards' && Array.isArray(p.cards)) {
      const cards: VisualCardItem[] = [];
      for (const c of p.cards.slice(0, 12)) {
        if (!c || typeof c !== 'object') continue;
        const cc = c as Record<string, unknown>;
        const cTitle = safeText(cc.title, 48);
        if (!cTitle || !Array.isArray(cc.fields)) continue;
        const fields: VisualCardField[] = [];
        for (const f of cc.fields.slice(0, 12)) {
          if (!f || typeof f !== 'object') continue;
          const ff = f as Record<string, unknown>;
          const fl = safeText(ff.label, 36);
          if (!fl) continue;
          fields.push({
            label: fl,
            value: safeText(ff.value, 64),
            previousValue: safeText(ff.previousValue, 64) || undefined,
            changed: ff.changed === true,
          });
        }
        cards.push({
          id: safeText(cc.id, 40) || `card_${cards.length}`,
          title: cTitle,
          badge: safeText(cc.badge, 32) || undefined,
          accent: safeAccent(cc.accent, 'indigo'),
          status:
            cc.status === 'new' || cc.status === 'changed' || cc.status === 'active'
              ? cc.status
              : 'unchanged',
          fields,
        });
      }
      if (cards.length > 0) {
        panels.push({ id, kind: 'cards', title, subtitle, cards });
      }
    } else if (kind === 'flow' && Array.isArray(p.stages)) {
      const stages: VisualFlowStage[] = [];
      for (const st of p.stages.slice(0, 8)) {
        if (!st || typeof st !== 'object') continue;
        const ss = st as Record<string, unknown>;
        const label = safeText(ss.label, 40);
        if (!label) continue;
        stages.push({
          id: safeText(ss.id, 40) || `st_${stages.length}`,
          label,
          detail: safeText(ss.detail, 80),
          accent: safeAccent(ss.accent, 'indigo'),
          active: ss.active === true,
        });
      }
      if (stages.length > 0) {
        panels.push({ id, kind: 'flow', title, subtitle, stages });
      }
    }
  }

  return {
    schemaVersion: '1.0',
    source: obj.source === 'ai-assisted' ? 'ai-assisted' : 'synthesized',
    domainLabel: safeText(obj.domainLabel, 64) || undefined,
    summaryLine: safeText(obj.summaryLine, 160) || undefined,
    panels,
  };
}

// ---------------------------------------------------------------------------
// UNIVERSAL DATA-DRIVEN SCENE SYNTHESIZER (ZERO HARDCODED EXAMPLES)
// ---------------------------------------------------------------------------

const ACCENT_ROTATION: VisualAccent[] = ['indigo', 'emerald', 'amber', 'sky', 'violet', 'rose'];

function formatShortVal(ref: ValueRef | undefined, heap: Record<string, HeapObject>): string {
  if (ref === null || ref === undefined) return 'null';
  if (typeof ref === 'number') {
    return Number.isInteger(ref) ? String(ref) : Number(ref.toFixed(4)).toString();
  }
  if (typeof ref === 'boolean') return ref ? 'true' : 'false';
  if (typeof ref === 'string') return ref.length > 36 ? `${ref.slice(0, 33)}…` : ref;
  if (isObjectRef(ref)) {
    const o = heap[ref.__ref];
    if (!o) return ref.__ref;
    if (o.kind === 'array') return `[${(o.elements || []).length} items]`;
    if (o.kind === 'set') return `Set(${(o.elements || []).length})`;
    if (o.entries) {
      const preview = Object.entries(o.entries)
        .slice(0, 2)
        .map(([k, v]) => `${k}:${isObjectRef(v) ? v.__ref : String(v)}`)
        .join(', ');
      return o.className ? `${o.className}{${preview}}` : `{${preview}}`;
    }
    return o.className || ref.__ref;
  }
  return String(ref);
}

/**
 * Extracts flattened scalar values from an event (top-level locals + 1-level object fields)
 * so numeric trends, state transitions, and binary signals work identically for procedural
 * variables AND OOP object properties (e.g., `account.balance`, `player.x`, `fsm.state`).
 */
function extractScalarBindings(event: TraceEvent): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  const heap = event.heap || {};
  for (const [name, ref] of Object.entries(event.locals || {})) {
    if (typeof ref === 'number' || typeof ref === 'string' || typeof ref === 'boolean') {
      out[name] = ref;
    } else if (isObjectRef(ref)) {
      const obj = heap[ref.__ref];
      if (obj && (obj.kind === 'object' || obj.kind === 'map') && obj.entries) {
        const entries = Object.entries(obj.entries);
        if (entries.length <= 14) {
          for (const [k, v] of entries) {
            if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
              out[`${name}.${k}`] = v;
            }
          }
        }
      }
    }
  }
  return out;
}

/**
 * 1. Detect Arrays of Records / Objects (e.g., transactions, DB query rows, processes, tasks,
 *    users, orders, game entities) and turn them into interactive Data Tables.
 */
function synthesizeRecordTablePanels(
  frame: ReconstructedFrame,
  prevFrame: ReconstructedFrame | null
): VisualTablePanel[] {
  const panels: VisualTablePanel[] = [];
  const heap = frame.event.heap || {};
  const prevHeap = prevFrame?.event.heap || {};
  const seenOids = new Set<string>();

  for (const [varName, ref] of Object.entries(frame.event.locals || {})) {
    if (!isObjectRef(ref) || seenOids.has(ref.__ref)) continue;
    const arr = heap[ref.__ref];
    if (!arr || arr.kind !== 'array') continue;
    const elements = arr.elements || [];
    if (elements.length === 0) continue;

    // Check if elements are objects/maps representing structured records
    const recordObjs: Array<{ idx: number; id: string; obj: HeapObject }> = [];
    for (let i = 0; i < elements.length && recordObjs.length < 24; i++) {
      const el = elements[i];
      if (isObjectRef(el)) {
        const target = heap[el.__ref];
        if (target && (target.kind === 'object' || target.kind === 'map') && target.entries) {
          const keys = Object.keys(target.entries);
          if (keys.length > 0 && !('left' in target.entries && 'right' in target.entries)) {
            recordObjs.push({ idx: i, id: target.id, obj: target });
          }
        }
      }
    }
    if (recordObjs.length === 0 || recordObjs.length < Math.ceil(Math.min(elements.length, 24) * 0.6)) {
      continue;
    }

    seenOids.add(ref.__ref);
    const colOrder: string[] = [];
    const colSet = new Set<string>();
    for (const r of recordObjs) {
      for (const k of Object.keys(r.obj.entries || {})) {
        if (!colSet.has(k) && colOrder.length < 8) {
          colSet.add(k);
          colOrder.push(k);
        }
      }
    }
    if (colOrder.length === 0) continue;

    const prevArr = prevHeap[ref.__ref];
    const prevElCount = prevArr?.elements?.length ?? 0;

    const rows: VisualTableRow[] = recordObjs.map((rec) => {
      const prevRec = prevHeap[rec.id];
      const cells: Record<string, string> = {};
      const changedKeys: string[] = [];
      for (const k of colOrder) {
        const curStr = formatShortVal(rec.obj.entries?.[k], heap);
        cells[k] = curStr;
        if (prevRec?.entries) {
          const prevStr = formatShortVal(prevRec.entries[k], prevHeap);
          if (prevStr !== curStr) changedKeys.push(k);
        }
      }
      const isNew = !prevArr || rec.idx >= prevElCount || !prevRec;
      return {
        id: `${rec.id}_${rec.idx}`,
        cells,
        status: isNew ? 'new' : changedKeys.length > 0 ? 'changed' : 'unchanged',
        changedKeys,
      };
    });

    panels.push({
      id: `table_${varName}`,
      kind: 'table',
      title: `${varName} Table`,
      subtitle: `${rows.length} record${rows.length === 1 ? '' : 's'} · ${colOrder.length} field${colOrder.length === 1 ? '' : 's'}`,
      accent: 'sky',
      columns: colOrder.map((k) => ({ key: k, label: k })),
      rows,
    });
  }

  return panels.slice(0, 2);
}

/**
 * 2. Detect Numeric Metrics Evolving Over Time (balances, scores, losses, temperatures,
 *    velocities, totals, weights, predictions, probabilities) and plot real step curves.
 */
function synthesizeNumericChartPanel(
  events: TraceEvent[],
  currentStepIndex: number
): VisualChartPanel | null {
  const historySlice = events.slice(0, currentStepIndex + 1);
  if (historySlice.length < 2) return null;

  const seriesMap = new Map<string, VisualChartPoint[]>();

  for (let i = 0; i < historySlice.length; i++) {
    const scalars = extractScalarBindings(historySlice[i]);
    for (const [key, val] of Object.entries(scalars)) {
      if (typeof val !== 'number' || !Number.isFinite(val)) continue;
      // Ignore trivial loop counters like i, j, k, idx when richer numeric variables exist
      const list = seriesMap.get(key) || [];
      list.push({ step: i, label: `${i + 1}`, value: val });
      seriesMap.set(key, list);
    }
  }

  // Keep numeric series whose values actually changed across at least 2 distinct values
  const loopIndexPattern = /(?:^|\.)(?:i|j|k|idx|index|step|tick|t|row|col|r|c|iter|round)$/i;
  const richChanged: Array<{ key: string; points: VisualChartPoint[]; isLoopIdx: boolean; distinct: number }> = [];

  for (const [key, points] of seriesMap.entries()) {
    if (points.length < 2) continue;
    const distinct = new Set(points.map((p) => p.value)).size;
    if (distinct < 2) continue;
    // Skip pure 0/1 binary signals (handled better by the Digital Signal Waveform panel)
    const isBinaryOnly = points.every((p) => p.value === 0 || p.value === 1);
    if (isBinaryOnly) continue;
    richChanged.push({ key, points, isLoopIdx: loopIndexPattern.test(key), distinct });
  }

  const nonLoop = richChanged.filter((s) => !s.isLoopIdx);
  const chosen = (nonLoop.length > 0 ? nonLoop : []).sort((a, b) => b.distinct - a.distinct).slice(0, 4);

  if (chosen.length === 0) return null;

  const series: VisualChartSeries[] = chosen.map((item, idx) => {
    const pts = item.points;
    // Downsample evenly if > 40 points while always preserving first and last point
    let compact = pts;
    if (pts.length > 40) {
      const stride = (pts.length - 1) / 39;
      compact = Array.from({ length: 40 }, (_, k) => pts[Math.round(k * stride)]);
    }
    const curr = pts[pts.length - 1].value;
    const prev = pts.length >= 2 ? pts[pts.length - 2].value : undefined;
    return {
      id: `metric_${item.key}`,
      name: item.key,
      accent: ACCENT_ROTATION[idx % ACCENT_ROTATION.length],
      currentValue: curr,
      previousValue: prev,
      points: compact,
    };
  });

  return {
    id: 'numeric_trends',
    kind: 'chart',
    title: 'Changing Numeric Values',
    subtitle: `Live history across steps 1–${currentStepIndex + 1}`,
    chartType: series.length === 1 && series[0].points.length <= 10 ? 'bar' : 'line',
    series,
    activeStep: currentStepIndex,
  };
}

/**
 * 3. Detect 2D Coordinate / Spatial Entities (e.g., game players/enemies/projectiles/robots/particles
 *    having numeric (x, y) or (row, col) coordinates) and plot a live 2D space with trails!
 */
function synthesizeSpatialGridPanel(
  events: TraceEvent[],
  currentStepIndex: number
): VisualGrid2DPanel | null {
  const historySlice = events.slice(0, currentStepIndex + 1);
  if (historySlice.length === 0) return null;

  const currentEvent = historySlice[historySlice.length - 1];
  const heap = currentEvent.heap || {};
  const entityDefs: Array<{
    id: string;
    label: string;
    xKey: string;
    yKey: string;
    objectId?: string;
  }> = [];

  // Check top-level (x, y) or (px, py) or (posX, posY)
  const locals = currentEvent.locals || {};
  const topPairs: Array<[string, string, string]> = [
    ['x', 'y', 'Position'],
    ['px', 'py', 'Position'],
    ['posX', 'posY', 'Position'],
    ['playerX', 'playerY', 'Player'],
    ['row', 'col', 'Cursor'],
  ];
  for (const [xk, yk, label] of topPairs) {
    if (typeof locals[xk] === 'number' && typeof locals[yk] === 'number') {
      entityDefs.push({ id: `top_${xk}_${yk}`, label, xKey: xk, yKey: yk });
    }
  }

  // Check heap objects with numeric x & y fields (e.g. player, ball, enemy, particle, drone)
  const seenObj = new Set<string>();
  for (const [name, ref] of Object.entries(locals)) {
    if (!isObjectRef(ref) || seenObj.has(ref.__ref)) continue;
    const obj = heap[ref.__ref];
    if (!obj || obj.kind !== 'object' || !obj.entries) continue;
    const e = obj.entries;
    if (typeof e.x === 'number' && typeof e.y === 'number') {
      seenObj.add(ref.__ref);
      entityDefs.push({ id: ref.__ref, label: name, xKey: 'x', yKey: 'y', objectId: ref.__ref });
    } else if (typeof e.posX === 'number' && typeof e.posY === 'number') {
      seenObj.add(ref.__ref);
      entityDefs.push({ id: ref.__ref, label: name, xKey: 'posX', yKey: 'posY', objectId: ref.__ref });
    }
  }

  if (entityDefs.length === 0) return null;

  const entities: VisualGridEntity[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  entityDefs.slice(0, 8).forEach((def, idx) => {
    const trail: Array<{ x: number; y: number }> = [];
    for (const ev of historySlice) {
      let xv: unknown;
      let yv: unknown;
      if (def.objectId) {
        const hObj = ev.heap?.[def.objectId];
        xv = hObj?.entries?.[def.xKey];
        yv = hObj?.entries?.[def.yKey];
      } else {
        xv = ev.locals?.[def.xKey];
        yv = ev.locals?.[def.yKey];
      }
      if (typeof xv === 'number' && Number.isFinite(xv) && typeof yv === 'number' && Number.isFinite(yv)) {
        const last = trail[trail.length - 1];
        if (!last || last.x !== xv || last.y !== yv) {
          trail.push({ x: xv, y: yv });
        }
        minX = Math.min(minX, xv);
        maxX = Math.max(maxX, xv);
        minY = Math.min(minY, yv);
        maxY = Math.max(maxY, yv);
      }
    }
    if (trail.length === 0) return;
    const cur = trail[trail.length - 1];
    // Collect helpful meta from object (e.g., hp, score, velocity)
    let meta: string | undefined;
    if (def.objectId) {
      const entries = heap[def.objectId]?.entries || {};
      const extra = Object.entries(entries)
        .filter(([k, v]) => k !== def.xKey && k !== def.yKey && !isObjectRef(v) && v !== null)
        .slice(0, 3)
        .map(([k, v]) => `${k}=${v}`);
      if (extra.length > 0) meta = extra.join(', ');
    }
    entities.push({
      id: def.id,
      label: def.label,
      x: cur.x,
      y: cur.y,
      accent: ACCENT_ROTATION[idx % ACCENT_ROTATION.length],
      trail,
      meta,
    });
  });

  if (entities.length === 0) return null;

  // Ensure meaningful coordinate range padding
  const padX = Math.max(1, Math.ceil((maxX - minX) * 0.15));
  const padY = Math.max(1, Math.ceil((maxY - minY) * 0.15));
  const finalMinX = Math.min(0, Math.floor(minX - padX));
  const finalMaxX = Math.max(finalMinX + 4, Math.ceil(maxX + padX));
  const finalMinY = Math.min(0, Math.floor(minY - padY));
  const finalMaxY = Math.max(finalMinY + 4, Math.ceil(maxY + padY));

  return {
    id: 'spatial_2d',
    kind: 'grid2d',
    title: '2D Position & Movement Map',
    subtitle: entities.map((e) => `${e.label}(${e.x}, ${e.y})`).join(' · '),
    minX: finalMinX,
    maxX: finalMaxX,
    minY: finalMinY,
    maxY: finalMaxY,
    entities,
  };
}

/**
 * 4. Detect Digital Logic / Binary Signals / Bitwise Operations / Toggling Booleans
 *    and render a square-wave Digital Signal Timing Diagram!
 */
function synthesizeDigitalSignalPanel(
  sourceCode: string,
  events: TraceEvent[],
  currentStepIndex: number
): VisualSignalPanel | null {
  const historySlice = events.slice(0, currentStepIndex + 1);
  if (historySlice.length < 2) return null;

  const hasBitwiseSyntax = /(?:\^|<<|>>|\s&\s|\s\|\s|\b(?:clk|clock|pin|led|gate|bit|signal|carry|xor|nand|nor|latch|flipflop|sensor|switch)\b)/i.test(
    sourceCode
  );

  const trackMap = new Map<string, Array<{ step: number; bit: 0 | 1; raw: string }>>();

  for (let i = 0; i < historySlice.length; i++) {
    const scalars = extractScalarBindings(historySlice[i]);
    for (const [k, v] of Object.entries(scalars)) {
      if (typeof v === 'boolean' || v === 0 || v === 1) {
        const bit: 0 | 1 = v === true || v === 1 ? 1 : 0;
        const arr = trackMap.get(k) || [];
        arr.push({ step: i, bit, raw: String(v) });
        trackMap.set(k, arr);
      }
    }
  }

  const tracks: VisualSignalTrack[] = [];
  let idx = 0;
  for (const [name, samples] of trackMap.entries()) {
    if (samples.length < 2) continue;
    const toggles = samples.some((s, sIdx) => sIdx > 0 && s.bit !== samples[sIdx - 1].bit);
    const looksDigitalName =
      /(?:bit|clk|clock|pin|led|gate|sig|signal|flag|carry|sum|out|in|a|b|q|en|enable|reset|high|low|active|valid|ready|done|locked)/i.test(
        name
      );
    if (!toggles && !(hasBitwiseSyntax && looksDigitalName)) continue;

    tracks.push({
      id: `sig_${name}`,
      name,
      accent: ACCENT_ROTATION[idx++ % ACCENT_ROTATION.length],
      samples: samples.slice(-28),
      currentBit: samples[samples.length - 1].bit,
    });
    if (tracks.length >= 6) break;
  }

  if (tracks.length === 0) return null;
  // Require either bitwise/signal syntax OR at least 2 tracks (or a track that toggled >= 2 times)
  const totalToggles = tracks.reduce(
    (sum, t) => sum + t.samples.filter((s, i) => i > 0 && s.bit !== t.samples[i - 1].bit).length,
    0
  );
  if (!hasBitwiseSyntax && tracks.length < 2 && totalToggles < 2) return null;

  return {
    id: 'digital_signals',
    kind: 'signal',
    title: 'Logic States & Signal Waveform',
    subtitle: 'HIGH (1) / LOW (0) levels across execution steps',
    tracks,
    activeStep: currentStepIndex,
  };
}

/**
 * 5. Detect State Machines / Discrete Status Transitions (e.g. IDLE -> RUNNING -> DONE,
 *    PENDING -> APPROVED -> SETTLED, RED -> GREEN -> YELLOW) and build a live State Diagram!
 */
function synthesizeStateDiagramPanel(
  events: TraceEvent[],
  currentStepIndex: number
): VisualDiagramPanel | null {
  const historySlice = events.slice(0, currentStepIndex + 1);
  if (historySlice.length < 2) return null;

  const stringHistory = new Map<string, string[]>();
  for (const ev of historySlice) {
    const scalars = extractScalarBindings(ev);
    for (const [k, v] of Object.entries(scalars)) {
      if (typeof v !== 'string') continue;
      const trimmed = v.trim();
      if (!trimmed || trimmed.length > 26 || trimmed.includes('\n')) continue;
      const arr = stringHistory.get(k) || [];
      if (arr.length === 0 || arr[arr.length - 1] !== trimmed) {
        arr.push(trimmed);
      }
      stringHistory.set(k, arr);
    }
  }

  // Pick best state-like variable whose string value transitioned across >= 2 discrete states
  let bestKey: string | null = null;
  let bestSeq: string[] = [];
  let bestScore = -1;

  for (const [k, seq] of stringHistory.entries()) {
    const unique = new Set(seq);
    if (unique.size < 2 || unique.size > 10) continue;
    const isStateName = /(?:state|status|phase|mode|stage|signal|light|screen|step|turn|role|action)/i.test(k);
    // Avoid string accumulators (where each next value strictly appends to the previous value)
    let looksLikeConcat = 0;
    for (let i = 1; i < seq.length; i++) {
      if (seq[i].length > seq[i - 1].length && seq[i].startsWith(seq[i - 1])) {
        looksLikeConcat++;
      }
    }
    if (looksLikeConcat >= seq.length - 1) continue;

    const score = (isStateName ? 10 : 0) + seq.length;
    if (score > bestScore) {
      bestScore = score;
      bestKey = k;
      bestSeq = seq;
    }
  }

  if (!bestKey || bestSeq.length < 2) return null;

  const uniqueStates: string[] = [];
  for (const s of bestSeq) {
    if (!uniqueStates.includes(s)) uniqueStates.push(s);
  }
  const activeState = bestSeq[bestSeq.length - 1];
  const lastFrom = bestSeq.length >= 2 ? bestSeq[bestSeq.length - 2] : null;

  const nodes: VisualDiagramNode[] = uniqueStates.map((st, idx) => ({
    id: `st_${idx}`,
    label: st,
    sublabel: st === activeState ? 'ACTIVE' : undefined,
    shape: 'circle',
    layer: idx,
    accent: st === activeState ? 'emerald' : 'indigo',
    status: st === activeState ? 'active' : 'unchanged',
  }));

  const stateToId = new Map(uniqueStates.map((st, idx) => [st, `st_${idx}`]));
  const edgeKeys = new Set<string>();
  const edges: VisualDiagramEdge[] = [];
  for (let i = 1; i < bestSeq.length; i++) {
    const from = stateToId.get(bestSeq[i - 1])!;
    const to = stateToId.get(bestSeq[i])!;
    const key = `${from}->${to}`;
    if (!edgeKeys.has(key)) {
      edgeKeys.add(key);
      edges.push({
        from,
        to,
        directed: true,
        active: bestSeq[i - 1] === lastFrom && bestSeq[i] === activeState,
      });
    }
  }

  return {
    id: `state_diagram_${bestKey}`,
    kind: 'diagram',
    title: `State Transitions (${bestKey})`,
    subtitle: `Current state: ${activeState} · ${bestSeq.length - 1} transition${bestSeq.length - 1 === 1 ? '' : 's'}`,
    layout: uniqueStates.length <= 4 ? 'flow' : 'ring',
    nodes,
    edges,
  };
}

/**
 * 6. Detect Object Relationships, Neural/Pipeline Layers, or Function/Event Call Flows
 *    and synthesize a Composable Node-and-Edge Diagram!
 */
function synthesizeRelationalOrLayerDiagram(
  frame: ReconstructedFrame,
  events: TraceEvent[],
  currentStepIndex: number
): VisualDiagramPanel | null {
  const heap = frame.event.heap || {};
  const locals = frame.event.locals || {};

  // A. Check for layered numeric vector pipeline (e.g., inputs -> hidden/weights -> outputs)
  const numericVectors: Array<{ name: string; values: number[]; layer: number }> = [];
  for (const [name, ref] of Object.entries(locals)) {
    if (!isObjectRef(ref)) continue;
    const obj = heap[ref.__ref];
    if (!obj || obj.kind !== 'array' || !obj.elements || obj.elements.length === 0 || obj.elements.length > 8) {
      continue;
    }
    if (!obj.elements.every((el) => typeof el === 'number')) continue;
    const lower = name.toLowerCase();
    let layer = -1;
    if (/^(?:x|in|input|inputs|features|layer0|signal)$/.test(lower)) layer = 0;
    else if (/(?:weight|w1|w2|hidden|h1|z|act|layer1|kernel|filter)/.test(lower)) layer = 1;
    else if (/(?:out|output|outputs|pred|probs|logits|y_hat|yhat|result|layer2)/.test(lower)) layer = 2;
    if (layer >= 0) {
      numericVectors.push({ name, values: obj.elements as number[], layer });
    }
  }

  const distinctLayers = new Set(numericVectors.map((v) => v.layer));
  if (distinctLayers.size >= 2) {
    const sorted = [...numericVectors].sort((a, b) => a.layer - b.layer);
    const nodes: VisualDiagramNode[] = [];
    const edges: VisualDiagramEdge[] = [];
    const layerIds = new Map<number, string[]>();

    for (const vec of sorted) {
      const ids: string[] = [];
      vec.values.slice(0, 5).forEach((val, idx) => {
        const nid = `${vec.name}_${idx}`;
        ids.push(nid);
        nodes.push({
          id: nid,
          label: Number.isInteger(val) ? String(val) : val.toFixed(2),
          sublabel: `${vec.name}[${idx}]`,
          shape: 'circle',
          layer: vec.layer,
          accent: vec.layer === 0 ? 'sky' : vec.layer === 1 ? 'violet' : 'emerald',
          status: vec.layer === 2 ? 'active' : 'unchanged',
        });
      });
      layerIds.set(vec.layer, [...(layerIds.get(vec.layer) || []), ...ids]);
    }

    const orderedLayers = [...layerIds.keys()].sort((a, b) => a - b);
    for (let li = 0; li < orderedLayers.length - 1; li++) {
      const fromIds = layerIds.get(orderedLayers[li]) || [];
      const toIds = layerIds.get(orderedLayers[li + 1]) || [];
      for (const f of fromIds) {
        for (const t of toIds) {
          edges.push({ from: f, to: t, directed: true, active: li === orderedLayers.length - 2 });
        }
      }
    }

    return {
      id: 'layered_data_flow',
      kind: 'diagram',
      title: 'Layered Computation & Data Flow',
      subtitle: sorted.map((v) => `${v.name}(${v.values.length})`).join(' → '),
      layout: 'layered',
      nodes,
      edges: edges.slice(0, 48),
    };
  }

  // B. Check for OOP Object-to-Object Reference Diagram (non-tree/non-list domain objects pointing to each other)
  const objNames = new Map<string, string>();
  for (const [name, ref] of Object.entries(locals)) {
    if (isObjectRef(ref) && heap[ref.__ref]?.kind === 'object') {
      objNames.set(ref.__ref, name);
    }
  }

  const domainNodes: VisualDiagramNode[] = [];
  const domainEdges: VisualDiagramEdge[] = [];
  const addedIds = new Set<string>();

  for (const [oid, obj] of Object.entries(heap)) {
    if (obj.kind !== 'object' || !obj.entries) continue;
    if ('left' in obj.entries || 'right' in obj.entries || 'next' in obj.entries) continue;
    for (const [prop, val] of Object.entries(obj.entries)) {
      if (isObjectRef(val) && heap[val.__ref]?.kind === 'object' && val.__ref !== oid) {
        const target = heap[val.__ref];
        if (target.entries && ('left' in target.entries || 'right' in target.entries || 'next' in target.entries)) {
          continue;
        }
        if (!addedIds.has(oid)) {
          addedIds.add(oid);
          domainNodes.push({
            id: oid,
            label: objNames.get(oid) || obj.className || oid,
            sublabel: obj.className || 'Object',
            shape: 'box',
            layer: 0,
            accent: 'indigo',
            status: 'active',
          });
        }
        if (!addedIds.has(val.__ref)) {
          addedIds.add(val.__ref);
          domainNodes.push({
            id: val.__ref,
            label: objNames.get(val.__ref) || target.className || val.__ref,
            sublabel: target.className || 'Object',
            shape: 'box',
            layer: 1,
            accent: 'sky',
            status: 'unchanged',
          });
        }
        domainEdges.push({ from: oid, to: val.__ref, label: prop, directed: true, active: true });
      }
    }
  }

  if (domainNodes.length >= 2 && domainEdges.length >= 1) {
    return {
      id: 'object_relationships',
      kind: 'diagram',
      title: 'Object & Entity Relationships',
      subtitle: `${domainNodes.length} connected entities`,
      layout: 'layered',
      nodes: domainNodes.slice(0, 12),
      edges: domainEdges.slice(0, 20),
    };
  }

  // C. Multi-function Call / Message Flow Diagram when >= 2 distinct non-main functions execute
  const historySlice = events.slice(0, currentStepIndex + 1);
  const fnOrder: string[] = [];
  const callEdges = new Map<string, { from: string; to: string; count: number; lastStep: number }>();

  for (let i = 0; i < historySlice.length; i++) {
    const stack = historySlice[i].callStack || [];
    if (stack.length >= 2) {
      const caller = stack[stack.length - 2].name || 'main';
      const callee = stack[stack.length - 1].name || 'fn';
      if (!fnOrder.includes(caller)) fnOrder.push(caller);
      if (!fnOrder.includes(callee)) fnOrder.push(callee);
      const ek = `${caller}->${callee}`;
      const existing = callEdges.get(ek);
      callEdges.set(ek, {
        from: caller,
        to: callee,
        count: (existing?.count || 0) + (historySlice[i].type === 'function_call' ? 1 : 0),
        lastStep: i,
      });
    }
  }

  if (fnOrder.length >= 3 && callEdges.size >= 2) {
    const activeFn = frame.event.functionName || fnOrder[fnOrder.length - 1];
    const nodes: VisualDiagramNode[] = fnOrder.slice(0, 8).map((fn, idx) => ({
      id: `fn_${fn}`,
      label: `${fn}()`,
      shape: 'pill',
      layer: idx,
      accent: fn === activeFn ? 'emerald' : 'violet',
      status: fn === activeFn ? 'active' : 'unchanged',
    }));
    const validSet = new Set(nodes.map((n) => n.id));
    const edges: VisualDiagramEdge[] = [...callEdges.values()]
      .filter((e) => validSet.has(`fn_${e.from}`) && validSet.has(`fn_${e.to}`))
      .map((e) => ({
        from: `fn_${e.from}`,
        to: `fn_${e.to}`,
        label: e.count > 1 ? `×${e.count}` : undefined,
        directed: true,
        active: e.lastStep === currentStepIndex,
      }));
    if (edges.length > 0) {
      return {
        id: 'call_flow_diagram',
        kind: 'diagram',
        title: 'Execution & Function Flow',
        subtitle: `Active: ${activeFn}()`,
        layout: 'flow',
        nodes,
        edges,
      };
    }
  }

  return null;
}

/**
 * 7. Detect Process / Task / Async / Transaction / Event Execution Timelines (Gantt slices)
 *    from active process/task/event variables, call frames, or console/output milestones!
 */
function synthesizeTimelinePanel(
  events: TraceEvent[],
  currentStepIndex: number
): VisualTimelinePanel | null {
  if (events.length < 3) return null;

  // A. Check for a process/task/job/tx/event/request/thread identifier switching across steps
  const sliceKeyRegex = /(?:^|\.)(?:current|active|running|pid|proc|process|task|job|thread|worker|req|request|event|tx|transaction|stage|handler)(?:name|id)?$/i;
  const segmentsByKey = new Map<string, VisualTimelineItem[]>();

  for (let i = 0; i < events.length; i++) {
    const scalars = extractScalarBindings(events[i]);
    for (const [k, v] of Object.entries(scalars)) {
      if (!sliceKeyRegex.test(k)) continue;
      if (typeof v !== 'string' && typeof v !== 'number') continue;
      const label = String(v).trim();
      if (!label || label.length > 28) continue;

      const list = segmentsByKey.get(k) || [];
      const prev = list[list.length - 1];
      if (prev && prev.label === label && prev.stepEnd === i - 1) {
        prev.stepEnd = i;
      } else {
        const colorHash = [...label].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
        list.push({
          id: `${k}_${i}`,
          label,
          stepStart: i,
          stepEnd: i,
          accent: ACCENT_ROTATION[colorHash % ACCENT_ROTATION.length],
          status: i < currentStepIndex ? 'past' : i === currentStepIndex ? 'active' : 'upcoming',
        });
      }
      segmentsByKey.set(k, list);
    }
  }

  let bestKey: string | null = null;
  let bestSegs: VisualTimelineItem[] = [];
  for (const [k, segs] of segmentsByKey.entries()) {
    const distinctLabels = new Set(segs.map((s) => s.label)).size;
    if (distinctLabels >= 2 && segs.length > bestSegs.length) {
      bestKey = k;
      bestSegs = segs;
    }
  }

  if (bestKey && bestSegs.length >= 2) {
    const normalized = bestSegs.slice(0, 20).map((seg) => ({
      ...seg,
      status: (
        currentStepIndex >= seg.stepStart && currentStepIndex <= seg.stepEnd
          ? 'active'
          : currentStepIndex > seg.stepEnd
            ? 'past'
            : 'upcoming'
      ) as 'past' | 'active' | 'upcoming',
    }));
    return {
      id: `timeline_${bestKey}`,
      kind: 'timeline',
      title: `Execution Timeline (${bestKey})`,
      subtitle: `${normalized.length} scheduled slices across ${events.length} steps`,
      items: normalized,
      currentStep: currentStepIndex,
      totalSteps: events.length,
    };
  }

  // B. Fallback: Output / Request / Event Milestone Timeline when >= 3 distinct printed events occur
  const outputMilestones: VisualTimelineItem[] = [];
  for (let i = 0; i < events.length; i++) {
    const txt = (events[i].print || '').trim();
    if (!txt) continue;
    outputMilestones.push({
      id: `out_${i}`,
      label: txt.length > 26 ? `${txt.slice(0, 23)}…` : txt,
      sublabel: `Step ${i + 1}`,
      stepStart: i,
      stepEnd: i,
      accent: ACCENT_ROTATION[outputMilestones.length % ACCENT_ROTATION.length],
      status: i === currentStepIndex ? 'active' : i < currentStepIndex ? 'past' : 'upcoming',
    });
  }

  if (outputMilestones.length >= 3) {
    return {
      id: 'event_output_timeline',
      kind: 'timeline',
      title: 'Output & Event Sequence',
      subtitle: `${outputMilestones.length} emitted events`,
      items: outputMilestones.slice(0, 16),
      currentStep: currentStepIndex,
      totalSteps: events.length,
    };
  }

  return null;
}

/**
 * 8. Synthesize a Universal Execution Flow strip whenever no specialized data structure
 *    OR rich universal panel was triggered (ensures EVERY ordinary/unfamiliar program
 *    receives an adaptive, meaningful visual representation!).
 */
function synthesizeUniversalFlowPanel(
  frame: ReconstructedFrame,
  prevFrame: ReconstructedFrame | null
): VisualFlowPanel {
  const inputsCount = Object.keys(frame.event.locals || {}).length;
  const changedNames = frame.event.changes
    .filter((c) => c.kind === 'create' || c.kind === 'update')
    .map((c) => c.target)
    .slice(0, 3);
  const outNow = (frame.print || frame.outText || '').trim();
  const shortOut = outNow.length > 42 ? `${outNow.slice(0, 39)}…` : outNow;

  const isPrint = Boolean(frame.print?.trim());
  const isChange = changedNames.length > 0;
  const isControl =
    frame.eventType === 'branch_decision' ||
    frame.eventType === 'loop_iteration' ||
    frame.eventType === 'function_call' ||
    frame.eventType === 'function_return';

  return {
    id: 'universal_step_flow',
    kind: 'flow',
    title: 'Program Execution Flow',
    subtitle: `Step ${frame.index + 1} · Line ${frame.line}`,
    stages: [
      {
        id: 'stage_state',
        label: 'Active State',
        detail: `${inputsCount} active value${inputsCount === 1 ? '' : 's'}`,
        accent: 'sky',
        active: !isChange && !isPrint && !isControl,
      },
      {
        id: 'stage_action',
        label: isControl ? 'Control Flow' : 'Compute / Update',
        detail: isChange
          ? `Updated: ${changedNames.join(', ')}`
          : frame.event.functionName
            ? `In ${frame.event.functionName}()`
            : `Line ${frame.line}`,
        accent: 'indigo',
        active: isChange || isControl,
      },
      {
        id: 'stage_output',
        label: 'Output',
        detail: shortOut || (prevFrame?.outText ? 'Previous output retained' : 'None yet'),
        accent: 'emerald',
        active: isPrint,
      },
    ],
  };
}

/**
 * Main Universal Declarative Scene Synthesizer.
 * Combines all dynamically detected program behaviors into a single validated scene,
 * optionally merging validated AI-suggested conceptual panels (clearly labeled).
 */
export function synthesizeUniversalScene(params: {
  sourceCode: string;
  traceDocument: TraceDocument | null;
  currentStepIndex: number;
  frame: ReconstructedFrame;
  prevFrame: ReconstructedFrame | null;
  aiVisualScene?: UniversalVisualScene | null;
}): UniversalVisualScene {
  const { sourceCode, traceDocument, currentStepIndex, frame, prevFrame, aiVisualScene } = params;
  const events = traceDocument?.events || [frame.event];
  const panels: VisualPanel[] = [];

  // 1. Structured Record Tables (DB rows, transactions, processes, entities)
  panels.push(...synthesizeRecordTablePanels(frame, prevFrame));

  // 2. 2D Spatial / Coordinate / Game / Physics Board
  const spatial = synthesizeSpatialGridPanel(events, currentStepIndex);
  if (spatial) panels.push(spatial);

  // 3. Digital Logic & Signal Waveforms
  const signals = synthesizeDigitalSignalPanel(sourceCode, events, currentStepIndex);
  if (signals) panels.push(signals);

  // 4. State Transition Diagram
  const stateDiagram = synthesizeStateDiagramPanel(events, currentStepIndex);
  if (stateDiagram) panels.push(stateDiagram);

  // 5. Layered Data-Flow / Object Relationship / Call-Flow Diagram
  const relDiagram = synthesizeRelationalOrLayerDiagram(frame, events, currentStepIndex);
  if (relDiagram) panels.push(relDiagram);

  // 6. Changing Numeric Trend Chart (balances, scores, losses, physics, metrics)
  const chart = synthesizeNumericChartPanel(events, currentStepIndex);
  if (chart) panels.push(chart);

  // 7. Execution / Process / Event Timeline
  const timeline = synthesizeTimelinePanel(events, currentStepIndex);
  if (timeline) panels.push(timeline);

  // 8. Merge any validated AI-suggested conceptual panels (without duplicating kinds already synthesized)
  let domainLabel: string | undefined;
  let source: 'synthesized' | 'ai-assisted' = 'synthesized';
  if (aiVisualScene) {
    const validatedAi = validateVisualScene(aiVisualScene);
    if (validatedAi) {
      domainLabel = validatedAi.domainLabel;
      const existingKinds = new Set(panels.map((p) => p.kind));
      for (const aiPanel of validatedAi.panels) {
        if (panels.length >= MAX_PANELS) break;
        if (!existingKinds.has(aiPanel.kind) || aiPanel.kind === 'diagram' || aiPanel.kind === 'cards') {
          panels.push(aiPanel);
          source = 'ai-assisted';
        }
      }
    }
  }

  // 9. Universal fallback flow when the program has no specialized structures or rich panels yet
  if (panels.length === 0 && frame.workspace.structures.length === 0) {
    panels.push(synthesizeUniversalFlowPanel(frame, prevFrame));
  }

  const rawScene: UniversalVisualScene = {
    schemaVersion: '1.0',
    source,
    domainLabel,
    panels: panels.slice(0, MAX_PANELS),
  };

  return validateVisualScene(rawScene) || { schemaVersion: '1.0', source: 'synthesized', panels: [] };
}
