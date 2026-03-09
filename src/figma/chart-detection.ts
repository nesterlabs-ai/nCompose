/**
 * Chart detection for Figma nodes.
 *
 * Detects chart/graph sections from the raw Figma tree using structural signals
 * (layer names, VECTOR types, axis frames) and extracts metadata needed to generate
 * Recharts components with placeholder data.
 */

import type { LLMProvider } from '../llm/provider.js';

export type ChartType = 'area' | 'line' | 'bar' | 'pie' | 'donut' | 'unknown';

export interface ChartMetadata {
  chartType: ChartType;
  width: number;
  height: number;
  /** Stroke color of the main line/series, e.g. "#7C3AED" */
  seriesColor: string;
  /** Series label from Legends, e.g. "Interest earned" */
  seriesName: string;
  /** PascalCase component name, e.g. "InterestEarnedChart" */
  componentName: string;
  /** Kebab-case BEM base class, e.g. "interest-earned-chart" */
  bemBase: string;
  /** X-axis labels from Figma, e.g. ["Jan", ..., "Dec"] */
  xAxisLabels: string[];
  /** Y-axis min value */
  yAxisMin: number;
  /** Y-axis max value */
  yAxisMax: number;
  /** Number of data points */
  dataPointCount: number;
  /** Chart container background color */
  backgroundColor: string;
  /** Axis label text color */
  axisLabelColor: string;
  /** Period options from switcher, e.g. ["Lifetime", "Year-to-date"] */
  periodOptions: string[];
  hasSwitcher: boolean;
  hasLegend: boolean;
}

const CHART_NAME_RE = /chart|graph|plot|histogram|pie|donut|sparkline|analytics/i;

/**
 * Returns true if a node looks like a chart/graph section.
 *
 * Uses two detection tiers:
 * 1. Node name contains chart-related keywords
 * 2. Deep children contain both axis frames AND vector graph groups
 */
export function isChartSection(node: any): boolean {
  if (!node) return false;

  // Tier 1: name match on the node itself
  if (CHART_NAME_RE.test(node.name ?? '')) return true;

  // Tier 2: structural — has both axis frames AND graph group with vectors
  const hasAxis =
    findNodeByName(node, /^(y axis|x axis)$/i) !== null ||
    findNodeByName(node, /^y[-_ ]?axis|x[-_ ]?axis$/i) !== null;
  const hasGraphGroup = findNodeByName(node, /^graph(\s*\d+)?$/i) !== null;

  return hasAxis && hasGraphGroup;
}

/**
 * Detect chart type from structural signals in the Figma node tree.
 *
 * Priority: structural VECTOR analysis → name keywords → unknown
 */
export function detectChartType(node: any): ChartType {
  // Look for a graph group containing VECTOR children
  const graphGroup = findNodeByName(node, /^graph(\s*\d+)?$/i);

  if (graphGroup) {
    const children = graphGroup.children ?? [];
    const vectorChildren = children.filter((c: any) => c.type === 'VECTOR');

    const hasLineVector = vectorChildren.some((v: any) => /^line$/i.test(v.name ?? ''));
    const hasAreaVector = vectorChildren.some((v: any) => /^area|^areaFill|^areaSeries/i.test(v.name ?? ''));

    // "line" named VECTOR → line chart (bg is just decorative, not a chart type signal)
    if (hasLineVector) return 'line';
    if (hasAreaVector) return 'area';

    // Multiple rectangles of similar width → bar
    const rectChildren = children.filter((c: any) => c.type === 'RECTANGLE');
    if (rectChildren.length >= 2) {
      const widths = rectChildren.map(
        (r: any) => r.absoluteBoundingBox?.width ?? r.size?.x ?? 0,
      );
      const allSimilar = widths.every((w: number) => Math.abs(w - widths[0]) < 5);
      if (allSimilar) return 'bar';
    }

    // Ellipses arranged radially → pie
    const ellipses = findAllNodes(node, (n: any) => n.type === 'ELLIPSE');
    if (ellipses.length >= 3) return 'pie';
  }

  // Name-based hints
  const name = (node.name ?? '').toLowerCase();
  if (name.includes('area')) return 'area';
  if (name.includes('line') || name.includes('graph')) return 'line';
  if (name.includes('bar')) return 'bar';
  if (name.includes('pie')) return 'pie';
  if (name.includes('donut')) return 'donut';

  // Default to line chart (most common)
  return 'line';
}

/**
 * Extract chart metadata by walking the raw Figma tree.
 * Called only after isChartSection() returns true.
 *
 * @param llmProvider - If provided, the LLM decides the chart type.
 *                      Otherwise falls back to structural heuristics.
 */
export async function extractChartMetadata(
  node: any,
  llmProvider?: LLMProvider,
): Promise<ChartMetadata> {
  const w =
    node.absoluteBoundingBox?.width ??
    node.dimensions?.width ??
    node.size?.x ??
    350;
  const h =
    node.absoluteBoundingBox?.height ??
    node.dimensions?.height ??
    node.size?.y ??
    320;

  // Background color from first solid fill
  const fills = node.fills ?? [];
  const solidFill = fills.find((f: any) => f.type === 'SOLID' && f.color);
  const backgroundColor = solidFill
    ? figmaColorToHex(solidFill.color)
    : '#F9FAFB';

  const chartType = llmProvider
    ? await detectChartTypeWithLLM(node, llmProvider)
    : detectChartType(node);

  // Series color — from VECTOR named "line" stroke
  let seriesColor = '#7C3AED';
  const lineVector = findNodeByName(node, /^line$/i, (n: any) => n.type === 'VECTOR');
  if (lineVector) {
    const stroke = (lineVector.strokes ?? [])[0];
    if (stroke?.color) {
      seriesColor = figmaColorToHex(stroke.color);
    }
  }

  // Axis label color — from TEXT nodes inside axis frames
  let axisLabelColor = '#A1A1A1';
  const axisFrame =
    findNodeByName(node, /^y axis$/i) ?? findNodeByName(node, /^x axis$/i);
  if (axisFrame) {
    const textNode = findNodeByType(axisFrame, 'TEXT');
    if (textNode?.fills?.[0]?.color) {
      axisLabelColor = figmaColorToHex(textNode.fills[0].color);
    }
  }

  // X-axis labels — TEXT characters from "x axis" children
  const xAxisFrame = findNodeByName(node, /^x axis$/i);
  const xAxisLabels = xAxisFrame
    ? collectTextNodes(xAxisFrame)
        .map((t: any) => t.characters ?? t.content ?? '')
        .filter(Boolean)
    : [];

  // Y-axis labels → parse min/max
  const yAxisFrame = findNodeByName(node, /^y axis$/i);
  const yAxisTexts = yAxisFrame
    ? collectTextNodes(yAxisFrame)
        .map((t: any) => t.characters ?? t.content ?? '')
        .filter(Boolean)
    : [];
  const yAxisNums = yAxisTexts.map(Number).filter((n) => !isNaN(n));
  const yAxisMin = yAxisNums.length > 0 ? Math.min(...yAxisNums) : 0;
  const yAxisMax = yAxisNums.length > 0 ? Math.max(...yAxisNums) : 100;

  // Data point count — count LegendNode FRAMEs inside graph group
  const graphGroup = findNodeByName(node, /^graph(\s*\d+)?$/i);
  let dataPointCount = xAxisLabels.length || 12;
  if (graphGroup) {
    const legendNodes = (graphGroup.children ?? []).filter(
      (c: any) => c.type === 'FRAME' && /legend\s*node/i.test(c.name ?? ''),
    );
    if (legendNodes.length > 0) dataPointCount = legendNodes.length;
  }

  // Series name — first TEXT node in a "Legends" frame
  let seriesName = 'Chart';
  const legendsFrame =
    findNodeByName(node, /^legends?$/i) ??
    findNodeByName(node, /^legend$/i);
  if (legendsFrame) {
    const textNodes = collectTextNodes(legendsFrame);
    // Pick the first non-empty text that's not a single character (avoid dots/icons)
    const labelNode = textNodes.find(
      (t: any) => (t.characters ?? t.content ?? '').length > 1,
    );
    if (labelNode) {
      seriesName = labelNode.characters ?? labelNode.content ?? 'Chart';
    }
  }

  // Period options — TEXT nodes inside "switchers" instance
  let periodOptions: string[] = [];
  let hasSwitcher = false;
  const switchers =
    findNodeByName(node, /^switchers?$/i) ??
    findNodeByName(node, /^tabs?$/i);
  if (switchers) {
    hasSwitcher = true;
    periodOptions = collectTextNodes(switchers)
      .map((t: any) => t.characters ?? t.content ?? '')
      .filter(Boolean);
  }
  // Default period options if none found
  if (hasSwitcher && periodOptions.length === 0) {
    periodOptions = ['Lifetime', 'Year-to-date'];
  }

  // Component name derived from series name
  const componentName = toPascalCase(seriesName) + 'Chart';
  const bemBase = toKebabCase(componentName);

  return {
    chartType,
    width: Math.round(w),
    height: Math.round(h),
    seriesColor,
    seriesName,
    componentName,
    bemBase,
    xAxisLabels,
    yAxisMin,
    yAxisMax,
    dataPointCount,
    backgroundColor,
    axisLabelColor,
    periodOptions,
    hasSwitcher,
    hasLegend: legendsFrame !== null,
  };
}

// ── LLM-based chart type detection ──────────────────────────────────────────

/**
 * Ask the LLM to identify the chart type from the Figma node tree.
 * Falls back to structural heuristics if the LLM call fails.
 */
async function detectChartTypeWithLLM(
  node: any,
  llmProvider: LLMProvider,
): Promise<ChartType> {
  const summary = buildNodeSummary(node);

  const systemPrompt = `You are a design analysis expert. Given a Figma layer tree, identify the chart/graph type.

Respond with ONLY a JSON object — no markdown, no explanation:
{"chartType": "<type>"}

Chart type values:
- "line"   — the primary data series VECTOR/shape is named "line", "series", or similar stroke-only name
- "area"   — the primary data series is explicitly named "area", "areaFill", or "areaSeries"
- "bar"    — vertical or horizontal bars (rectangles of uniform width, named "bar" or similar)
- "pie"    — circular pie slices arranged radially (named "pie", "slice", or similar)
- "donut"  — like pie but with a hollow center
- "unknown" — cannot determine from the structure

IMPORTANT RULES:
1. Base the chart type on the NAME of the primary data series layer (the VECTOR/shape that represents data points).
2. A VECTOR named "line" or "Line" → always "line" chart, regardless of other layers.
3. A helper layer named "bg" or "background" (even with GRADIENT fill) is just a decorative background — it does NOT make the chart an area chart.
4. Only return "area" if the primary data series itself is explicitly named "area" or "areaFill".`;

  const userPrompt = `Figma layer tree:\n\n${summary}\n\nWhat type of chart is this?`;

  try {
    const response = await llmProvider.generate(userPrompt, systemPrompt);
    const jsonMatch = response.match(/\{[\s\S]*?"chartType"\s*:\s*"([^"]+)"[\s\S]*?\}/);
    if (jsonMatch) {
      const chartType = jsonMatch[1] as ChartType;
      const valid: ChartType[] = ['area', 'line', 'bar', 'pie', 'donut', 'unknown'];
      if (valid.includes(chartType)) return chartType;
    }
  } catch {
    // fall through to structural detection
  }

  return detectChartType(node);
}

/**
 * Build a compact text summary of the Figma node tree for the LLM prompt.
 * Caps depth at 7 and children per node at 20 to keep prompts short.
 */
function buildNodeSummary(node: any, depth = 0, maxDepth = 7): string {
  if (!node || depth > maxDepth) return '';

  const indent = '  '.repeat(depth);
  const name = node.name ?? '?';
  const type = node.type ?? '?';

  const size = node.absoluteBoundingBox
    ? ` ${Math.round(node.absoluteBoundingBox.width)}×${Math.round(node.absoluteBoundingBox.height)}`
    : node.size
      ? ` ${Math.round(node.size.x ?? 0)}×${Math.round(node.size.y ?? 0)}`
      : '';

  const fills = (node.fills ?? [])
    .map((f: any) => {
      if (f.type === 'SOLID' && f.color) return `SOLID ${figmaColorToHex(f.color)}`;
      if (f.type === 'GRADIENT_LINEAR') return 'GRADIENT_LINEAR';
      return f.type ?? '';
    })
    .filter(Boolean)
    .join(', ');

  const strokes = (node.strokes ?? [])
    .map((s: any) => {
      if (s.type === 'SOLID' && s.color) return `stroke:${figmaColorToHex(s.color)}`;
      return s.type ? `stroke:${s.type}` : '';
    })
    .filter(Boolean)
    .join(', ');

  const text = type === 'TEXT' ? ` "${node.characters ?? node.content ?? ''}"` : '';
  const attrs = [fills, strokes].filter(Boolean).join(' | ');

  let line = `${indent}${type} "${name}"${size}${text}${attrs ? ` [${attrs}]` : ''}`;

  const children = node.children ?? [];
  if (children.length > 0) {
    const shown = children.slice(0, 20);
    const childLines = shown
      .map((c: any) => buildNodeSummary(c, depth + 1, maxDepth))
      .filter(Boolean);
    if (childLines.length) line += '\n' + childLines.join('\n');
    if (children.length > 20) {
      line += `\n${indent}  ... (${children.length - 20} more)`;
    }
  }

  return line;
}

// ── Internal helpers ────────────────────────────────────────────────────────

function findNodeByName(
  node: any,
  nameRe: RegExp,
  typePredicate?: (n: any) => boolean,
): any | null {
  if (!node) return null;
  if (nameRe.test(node.name ?? '')) {
    if (!typePredicate || typePredicate(node)) return node;
  }
  for (const child of node.children ?? []) {
    const found = findNodeByName(child, nameRe, typePredicate);
    if (found) return found;
  }
  return null;
}

function findNodeByType(node: any, type: string): any | null {
  if (!node) return null;
  if (node.type === type) return node;
  for (const child of node.children ?? []) {
    const found = findNodeByType(child, type);
    if (found) return found;
  }
  return null;
}

function findAllNodes(node: any, predicate: (n: any) => boolean): any[] {
  const results: any[] = [];
  if (!node) return results;
  if (predicate(node)) results.push(node);
  for (const child of node.children ?? []) {
    results.push(...findAllNodes(child, predicate));
  }
  return results;
}

function collectTextNodes(node: any): any[] {
  return findAllNodes(node, (n) => n.type === 'TEXT');
}

function figmaColorToHex(c: any): string {
  if (!c) return '#000000';
  const r = Math.round((c.r ?? 0) * 255)
    .toString(16)
    .padStart(2, '0');
  const g = Math.round((c.g ?? 0) * 255)
    .toString(16)
    .padStart(2, '0');
  const b = Math.round((c.b ?? 0) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${r}${g}${b}`;
}

function toPascalCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
}
