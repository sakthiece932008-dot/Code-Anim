import {
  validateAndNormalizeTraceDocument,
  type ExecutionSummary,
  type LanguageId,
  type StepExplanationBreakdown,
  type TraceDocument,
} from '../types/trace';
import type { ReconstructedFrame } from './replayEngine';
import { getLanguageSpec, isLanguageSelectable } from './languageRegistry';

export interface PortableCodeAnimProject {
  format: 'code-anim-project';
  version: '1.0';
  exportedAt: string;
  name: string;
  language: LanguageId;
  code: string;
  stdin: string;
  cliArgs: string;
}

export interface PortableCodeAnimTrace {
  format: 'code-anim-trace';
  version: '2.0';
  exportedAt: string;
  name: string;
  code: string;
  stdin: string;
  document: TraceDocument;
}

export type ImportedPayloadResult =
  | {
      ok: true;
      kind: 'project';
      project: PortableCodeAnimProject;
    }
  | {
      ok: true;
      kind: 'trace';
      name: string;
      code: string;
      stdin: string;
      document: TraceDocument;
    }
  | {
      ok: false;
      error: string;
    };

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildPortableProjectJson(params: {
  name: string;
  language: LanguageId;
  code: string;
  stdin: string;
  cliArgs: string;
}): string {
  const payload: PortableCodeAnimProject = {
    format: 'code-anim-project',
    version: '1.0',
    exportedAt: new Date().toISOString(),
    name: params.name.trim() || 'Untitled Project',
    language: params.language,
    code: params.code,
    stdin: params.stdin,
    cliArgs: params.cliArgs,
  };
  return JSON.stringify(payload, null, 2);
}

export function buildTraceExportJson(params: {
  name: string;
  code: string;
  stdin: string;
  document: TraceDocument;
}): string {
  const payload: PortableCodeAnimTrace = {
    format: 'code-anim-trace',
    version: '2.0',
    exportedAt: new Date().toISOString(),
    name: params.name.trim() || 'Untitled Project',
    code: params.code,
    stdin: params.stdin,
    document: params.document,
  };
  return JSON.stringify(payload, null, 2);
}

export function buildExplanationExportText(params: {
  projectName: string;
  languageName: string;
  stepNumber: number;
  totalSteps: number;
  line: number;
  breakdown: StepExplanationBreakdown;
  codeLine: string;
}): string {
  const { projectName, languageName, stepNumber, totalSteps, line, breakdown, codeLine } = params;
  const lines: string[] = [
    `Code Anim — Step Explanation`,
    `Project: ${projectName}`,
    `Language: ${languageName}`,
    `Step: ${stepNumber} of ${totalSteps} (Line ${line})`,
    `Code: ${codeLine.trim() || '(blank line)'}`,
    ``,
    `What this program does:`,
    breakdown.whatProgramDoes,
    ``,
    `What is happening now:`,
    breakdown.whatIsHappeningNow,
    ``,
    `What changed:`,
    ...(breakdown.whatChanged.length > 0
      ? breakdown.whatChanged.map((c) => `- ${c.label}: ${c.before} -> ${c.after}`)
      : ['- No stored values changed on this step.']),
    ``,
    `Why this is happening:`,
    breakdown.whyIsThisHappening,
    ``,
    `What this means:`,
    breakdown.whatDoesThisMean,
  ];
  if (breakdown.finalResult) {
    lines.push('', 'Final result:', breakdown.finalResult);
  }
  return lines.join('\n') + '\n';
}

export function buildExecutionSummaryExportText(
  projectName: string,
  summary: ExecutionSummary
): string {
  const lines: string[] = [
    `Code Anim — Execution Summary`,
    `Project: ${projectName}`,
    `Language: ${summary.detectedLanguage}`,
    `Execution Mode: ${summary.executionMode === 'real' ? 'Live execution' : 'AI simulation'}`,
    `Status: ${summary.status}`,
    `Recorded Steps: ${summary.stepCount}`,
    ...(summary.measuredDurationMs !== undefined
      ? [`Measured Trace Time: ${summary.measuredDurationMs} ms`]
      : []),
    ``,
    `Program Purpose:`,
    summary.purpose,
    ``,
    `Detected Data Structures:`,
    ...summary.detectedStructures.map((s) => `- ${s}`),
    ``,
    `Observed Operations:`,
    ...summary.observedOperations.map((op) => `- ${op}`),
    ``,
    `Theoretical Complexity Estimate (not measured runtime):`,
    `- Time: ${summary.theoreticalTimeComplexity || 'Not determined confidently'}`,
    `- Space: ${summary.theoreticalSpaceComplexity || 'Not determined confidently'}`,
    ...(summary.complexityNote ? [`- Note: ${summary.complexityNote}`] : []),
    ``,
    `Final Console Output:`,
    summary.finalOutput,
  ];
  return lines.join('\n') + '\n';
}

/**
 * Generates a real, valid, self-contained SVG visualization snapshot of the current execution step.
 * Can be saved directly as `.svg` OR rasterized on an HTML5 canvas to `.png`.
 */
export function buildVisualizationSvgSnapshot(params: {
  projectName: string;
  frame: ReconstructedFrame;
  totalSteps: number;
  theme?: 'dark' | 'light';
}): string {
  const { projectName, frame, totalSteps, theme = 'dark' } = params;
  const isLight = theme === 'light';
  const bg = isLight ? '#f8fafc' : '#0f1526';
  const cardBg = isLight ? '#ffffff' : '#161e36';
  const border = isLight ? '#cbd5e1' : '#334155';
  const textMain = isLight ? '#0f172a' : '#f1f5f9';
  const textMuted = isLight ? '#475569' : '#94a3b8';
  const accent = isLight ? '#4f46e5' : '#818cf8';

  const width = 920;
  let y = 28;
  const parts: string[] = [];

  parts.push(
    `<text x="28" y="${y + 14}" fill="${textMain}" font-family="Plus Jakarta Sans, system-ui, sans-serif" font-size="16" font-weight="700">${escapeXml(
      projectName || 'Code Anim Snapshot'
    )}</text>`
  );
  parts.push(
    `<text x="${width - 28}" y="${y + 14}" fill="${textMuted}" font-family="JetBrains Mono, monospace" font-size="12" text-anchor="end">Step ${
      frame.index + 1
    }/${totalSteps} · Line ${frame.line} · ${
      frame.executionMode === 'real' ? 'Live Execution' : 'AI Simulation'
    }</text>`
  );
  y += 38;

  // Primitives row
  if (frame.workspace.primitives.length > 0) {
    parts.push(
      `<text x="28" y="${y + 12}" fill="${textMuted}" font-family="Plus Jakarta Sans, sans-serif" font-size="11" font-weight="600">MEMORY BOXES</text>`
    );
    y += 22;
    let x = 28;
    for (const p of frame.workspace.primitives.slice(0, 10)) {
      const boxW = Math.max(88, Math.min(180, Math.max(p.name.length, p.display.length) * 9 + 28));
      if (x + boxW > width - 28) {
        x = 28;
        y += 58;
      }
      const strokeColor = p.status === 'new' ? '#10b981' : p.status === 'changed' ? '#f59e0b' : border;
      parts.push(
        `<rect x="${x}" y="${y}" width="${boxW}" height="48" rx="8" fill="${cardBg}" stroke="${strokeColor}" stroke-width="1.5" />`
      );
      parts.push(
        `<text x="${x + boxW / 2}" y="${y + 17}" fill="${accent}" font-family="JetBrains Mono, monospace" font-size="11" text-anchor="middle">${escapeXml(
          p.name
        )}</text>`
      );
      parts.push(
        `<text x="${x + boxW / 2}" y="${y + 36}" fill="${textMain}" font-family="JetBrains Mono, monospace" font-size="13" font-weight="600" text-anchor="middle">${escapeXml(
          p.display.slice(0, 18)
        )}</text>`
      );
      x += boxW + 10;
    }
    y += 66;
  }

  // Data structures
  for (const s of frame.workspace.structures.slice(0, 6)) {
    const title = `${s.names.join(', ')} (${s.kind})`;
    parts.push(
      `<text x="28" y="${y + 12}" fill="${textMuted}" font-family="JetBrains Mono, monospace" font-size="11" font-weight="600">${escapeXml(
        title
      )}</text>`
    );
    y += 20;

    if (s.kind === 'array') {
      const cells = s.cells.slice(0, 14);
      const cellW = 54;
      const boxH = 56;
      parts.push(
        `<rect x="28" y="${y}" width="${width - 56}" height="${boxH + 16}" rx="10" fill="${cardBg}" stroke="${border}" />`
      );
      cells.forEach((cell, idx) => {
        const cx = 42 + idx * (cellW + 6);
        const st = cell.status === 'new' ? '#10b981' : cell.status === 'changed' ? '#f59e0b' : accent;
        parts.push(
          `<rect x="${cx}" y="${y + 10}" width="${cellW}" height="38" rx="6" fill="${bg}" stroke="${st}" stroke-width="1.4" />`
        );
        parts.push(
          `<text x="${cx + cellW / 2}" y="${y + 33}" fill="${textMain}" font-family="JetBrains Mono, monospace" font-size="12" font-weight="600" text-anchor="middle">${escapeXml(
            cell.display.slice(0, 7)
          )}</text>`
        );
        parts.push(
          `<text x="${cx + cellW / 2}" y="${y + 62}" fill="${textMuted}" font-family="JetBrains Mono, monospace" font-size="10" text-anchor="middle">${cell.index}</text>`
        );
      });
      y += boxH + 28;
    } else if (s.kind === 'tree') {
      const treeH = Math.max(110, Math.min(240, s.height * 58 + 36));
      parts.push(
        `<rect x="28" y="${y}" width="${width - 56}" height="${treeH}" rx="10" fill="${cardBg}" stroke="${border}" />`
      );
      const byId = new Map(s.nodes.map((n) => [n.objectId, n]));
      const scaleX = Math.min(64, (width - 140) / Math.max(1, s.width));
      const baseX = 70;
      const baseY = y + 32;
      for (const e of s.edges) {
        const a = byId.get(e.fromId);
        const b = byId.get(e.toId);
        if (!a || !b) continue;
        parts.push(
          `<line x1="${baseX + a.x * scaleX}" y1="${baseY + a.y * 54}" x2="${baseX + b.x * scaleX}" y2="${
            baseY + b.y * 54
          }" stroke="${border}" stroke-width="2" />`
        );
      }
      for (const n of s.nodes.slice(0, 24)) {
        const cx = baseX + n.x * scaleX;
        const cy = baseY + n.y * 54;
        const st = n.status === 'new' ? '#10b981' : n.status === 'changed' ? '#f59e0b' : accent;
        parts.push(`<circle cx="${cx}" cy="${cy}" r="18" fill="${bg}" stroke="${st}" stroke-width="2" />`);
        parts.push(
          `<text x="${cx}" y="${cy + 4}" fill="${textMain}" font-family="JetBrains Mono, monospace" font-size="11" font-weight="600" text-anchor="middle">${escapeXml(
            n.display.slice(0, 6)
          )}</text>`
        );
      }
      y += treeH + 14;
    } else if (s.kind === 'linked-list') {
      parts.push(
        `<rect x="28" y="${y}" width="${width - 56}" height="68" rx="10" fill="${cardBg}" stroke="${border}" />`
      );
      s.nodes.slice(0, 10).forEach((n, idx) => {
        const nx = 44 + idx * 82;
        const st = n.status === 'new' ? '#10b981' : n.status === 'changed' ? '#f59e0b' : '#38bdf8';
        parts.push(
          `<rect x="${nx}" y="${y + 14}" width="62" height="38" rx="7" fill="${bg}" stroke="${st}" stroke-width="1.6" />`
        );
        parts.push(
          `<text x="${nx + 31}" y="${y + 37}" fill="${textMain}" font-family="JetBrains Mono, monospace" font-size="12" font-weight="600" text-anchor="middle">${escapeXml(
            n.display.slice(0, 7)
          )}</text>`
        );
        if (idx < Math.min(s.nodes.length, 10) - 1) {
          parts.push(
            `<text x="${nx + 72}" y="${y + 37}" fill="${textMuted}" font-family="JetBrains Mono, monospace" font-size="13" text-anchor="middle">${
              s.isDoublyLinked ? '⇄' : '→'
            }</text>`
          );
        }
      });
      y += 80;
    } else if (s.kind === 'graph') {
      const gh = 160;
      parts.push(
        `<rect x="28" y="${y}" width="${width - 56}" height="${gh}" rx="10" fill="${cardBg}" stroke="${border}" />`
      );
      const count = Math.min(s.nodes.length, 16);
      const cx0 = width / 2;
      const cy0 = y + gh / 2;
      const rx = 240;
      const ry = 54;
      const pos = new Map<string, { x: number; y: number }>();
      s.nodes.slice(0, count).forEach((n, idx) => {
        const angle = (2 * Math.PI * idx) / Math.max(1, count) - Math.PI / 2;
        pos.set(n.id, { x: cx0 + rx * Math.cos(angle), y: cy0 + ry * Math.sin(angle) });
      });
      for (const e of s.edges.slice(0, 32)) {
        const a = pos.get(e.fromId);
        const b = pos.get(e.toId);
        if (!a || !b) continue;
        parts.push(
          `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(
            1
          )}" stroke="${border}" stroke-width="1.6" />`
        );
      }
      for (const n of s.nodes.slice(0, count)) {
        const p = pos.get(n.id)!;
        const st = n.visited ? '#14b8a6' : n.status === 'new' ? '#10b981' : accent;
        parts.push(
          `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="16" fill="${bg}" stroke="${st}" stroke-width="2" />`
        );
        parts.push(
          `<text x="${p.x.toFixed(1)}" y="${(p.y + 4).toFixed(1)}" fill="${textMain}" font-family="JetBrains Mono, monospace" font-size="11" font-weight="600" text-anchor="middle">${escapeXml(
            n.label.slice(0, 6)
          )}</text>`
        );
      }
      y += gh + 14;
    } else {
      const summary =
        s.kind === 'hash-table'
          ? s.entries
              .slice(0, 6)
              .map((e) => `${e.key}: ${e.display}`)
              .join('  ·  ')
          : s.kind === 'set'
            ? `{ ${s.items
                .slice(0, 10)
                .map((it) => it.display)
                .join(', ')} }`
            : s.fields
                .slice(0, 6)
                .map((f) => `${f.key}: ${f.display}`)
                .join('  ·  ');
      parts.push(
        `<rect x="28" y="${y}" width="${width - 56}" height="44" rx="8" fill="${cardBg}" stroke="${border}" />`
      );
      parts.push(
        `<text x="42" y="${y + 26}" fill="${textMain}" font-family="JetBrains Mono, monospace" font-size="12">${escapeXml(
          summary.slice(0, 96) || '(empty)'
        )}</text>`
      );
      y += 56;
    }
  }

  // Console preview
  if (frame.outText.trim()) {
    const outLines = frame.outText.trim().split('\n').slice(-3);
    const outH = 26 + outLines.length * 18;
    parts.push(
      `<text x="28" y="${y + 12}" fill="${textMuted}" font-family="Plus Jakarta Sans, sans-serif" font-size="11" font-weight="600">CONSOLE OUTPUT</text>`
    );
    y += 18;
    parts.push(
      `<rect x="28" y="${y}" width="${width - 56}" height="${outH}" rx="8" fill="${cardBg}" stroke="${border}" />`
    );
    outLines.forEach((line, idx) => {
      parts.push(
        `<text x="42" y="${y + 22 + idx * 18}" fill="#10b981" font-family="JetBrains Mono, monospace" font-size="12">${escapeXml(
          line.slice(0, 98)
        )}</text>`
      );
    });
    y += outH + 16;
  }

  const totalHeight = Math.max(220, y + 18);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalHeight}" viewBox="0 0 ${width} ${totalHeight}">\n  <rect width="100%" height="100%" fill="${bg}" />\n  ${parts.join(
    '\n  '
  )}\n</svg>`;
}

export function triggerTextDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportSvgToPngDownload(filename: string, svgString: string): Promise<boolean> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return false;
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode SVG snapshot for PNG export.'));
      el.src = url;
    });
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, img.width * scale);
    canvas.height = Math.max(1, img.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    const pngUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = pngUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return true;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function getExtensionForLanguage(lang: LanguageId): string {
  const spec = getLanguageSpec(lang);
  return spec?.extensions[0] || '.txt';
}

/**
 * Strictly validates imported `.codeanim.json` project files and `.trace.json` trace files.
 */
export function validateImportedCodeAnimFile(rawText: string): ImportedPayloadResult {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return { ok: false, error: 'Imported file is empty.' };
  }
  if (rawText.length > 2_000_000) {
    return { ok: false, error: 'Imported file exceeds the 2 MB safety limit.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { ok: false, error: 'Imported file is not valid JSON.' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Imported JSON must be a Code Anim project or trace object.' };
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.format === 'code-anim-project') {
    if (typeof obj.code !== 'string') {
      return { ok: false, error: 'Code Anim project file is missing source code.' };
    }
    if (typeof obj.language !== 'string' || !isLanguageSelectable(obj.language)) {
      return {
        ok: false,
        error: `Project specifies unsupported or unavailable language "${String(obj.language)}".`,
      };
    }
    return {
      ok: true,
      kind: 'project',
      project: {
        format: 'code-anim-project',
        version: '1.0',
        exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : new Date().toISOString(),
        name:
          typeof obj.name === 'string' && obj.name.trim()
            ? obj.name.trim().slice(0, 120)
            : 'Imported Project',
        language: obj.language as LanguageId,
        code: obj.code.slice(0, 100_000),
        stdin: typeof obj.stdin === 'string' ? obj.stdin.slice(0, 8000) : '',
        cliArgs: typeof obj.cliArgs === 'string' ? obj.cliArgs.slice(0, 500) : '',
      },
    };
  }

  if (obj.format === 'code-anim-trace' || obj.schemaVersion === '2.0') {
    const docRaw = obj.format === 'code-anim-trace' ? obj.document : obj;
    if (!docRaw || typeof docRaw !== 'object') {
      return { ok: false, error: 'Imported trace file is missing its trace document.' };
    }
    const docObj = docRaw as Record<string, unknown>;
    const langCandidate = typeof docObj.language === 'string' ? docObj.language : 'js';
    if (!isLanguageSelectable(langCandidate)) {
      return { ok: false, error: `Imported trace language "${langCandidate}" is not selectable.` };
    }
    const code = typeof obj.code === 'string' ? obj.code.slice(0, 100_000) : '';
    const lineCount = Math.max(1, code ? code.split('\n').length : 500);
    const spec = getLanguageSpec(langCandidate);

    const validated = validateAndNormalizeTraceDocument(docRaw, lineCount, {
      language: langCandidate as LanguageId,
      executionMode: docObj.executionMode === 'simulated' ? 'simulated' : 'real',
      adapter: {
        id: 'imported-trace',
        language: langCandidate as LanguageId,
        label: spec?.name || langCandidate,
        executionMode: docObj.executionMode === 'simulated' ? 'simulated' : 'real',
        runtimeAvailable: true,
        executionMethod: 'Imported validated Code Anim trace',
        capabilities: {
          primitives: true,
          arrays: true,
          linkedStructures: true,
          trees: true,
          graphs: true,
          callStack: true,
          loopsAndBranches: true,
          objectIdentity: true,
          cancellation: false,
        },
        limitations: ['Loaded from an imported JSON trace file.'],
      },
    });

    if (!validated.ok) {
      return { ok: false, error: `Invalid trace payload: ${validated.error}` };
    }

    return {
      ok: true,
      kind: 'trace',
      name:
        typeof obj.name === 'string' && obj.name.trim()
          ? obj.name.trim().slice(0, 120)
          : 'Imported Trace',
      code,
      stdin: typeof obj.stdin === 'string' ? obj.stdin.slice(0, 8000) : '',
      document: validated.document,
    };
  }

  return {
    ok: false,
    error: 'Unrecognized JSON format. Expected a Code Anim project (.codeanim.json) or trace (.trace.json).',
  };
}
