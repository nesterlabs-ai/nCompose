/**
 * Chart detection for Figma nodes.
 *
 * Detects chart/graph sections from the raw Figma tree using generic structural
 * signals — NOT hardcoded design-specific names. Works with any Figma file.
 *
 * Detection strategy:
 *   Tier 1: Any descendant name contains chart keywords (chart, graph, plot, etc.)
 *   Tier 2: Structural — has axis-like frames + VECTOR/LINE data elements
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

  // ── Styling extracted from Figma (no hardcoded values) ──

  /** Grid line color from LINE/VECTOR nodes in grid frames */
  gridLineColor: string;
  /** Grid stroke dash array, e.g. "3 3" or "" for solid */
  gridStrokeDasharray: string;

  /** Chart content area height (excluding legends/switcher) */
  chartAreaHeight: number;

  /** Container corner radius */
  containerBorderRadius: number;
  /** Container padding from auto-layout */
  containerPadding: { top: number; right: number; bottom: number; left: number };

  /** Axis tick font size */
  axisFontSize: number;
  /** Y-axis frame width */
  yAxisWidth: number;

  /** Series line/bar stroke width */
  seriesStrokeWidth: number;

  /** Data dot radius */
  dotRadius: number;
  /** Data dot stroke (border) color */
  dotStrokeColor: string;
  /** Data dot stroke width */
  dotStrokeWidth: number;

  /** Gradient start opacity for area charts */
  gradientStartOpacity: number;

  /** Bar corner radius [topLeft, topRight, bottomLeft, bottomRight] */
  barRadius: [number, number, number, number];

  /** Chart area margin */
  chartMargin: { top: number; right: number; bottom: number; left: number };

  // ── Legend styling ──

  /** Gap between legend items */
  legendGap: number;
  /** Gap between legend dot and label */
  legendItemGap: number;
  /** Legend dot size (width/height) */
  legendDotSize: number;
  /** Legend dot border-radius ('50%' for circle, 'Npx' for rounded rect) */
  legendDotBorderRadius: string;
  /** Legend dot opacity */
  legendDotOpacity: number;
  /** Legend label font size */
  legendLabelFontSize: number;
  /** Legend label text color */
  legendLabelColor: string;
  /** Margin below legends section */
  legendMarginBottom: number;

  // ── Switcher/tab styling ──

  /** Switcher container background */
  switcherBg: string;
  /** Switcher container border-radius */
  switcherBorderRadius: number;
  /** Switcher container padding */
  switcherPadding: string;
  /** Margin above switcher */
  switcherMarginTop: number;
  /** Switcher button padding */
  switcherButtonPadding: string;
  /** Switcher button font size */
  switcherButtonFontSize: number;
  /** Switcher button text color (inactive) */
  switcherButtonColor: string;
  /** Switcher button border-radius */
  switcherButtonBorderRadius: number;
  /** Active tab background */
  switcherActiveBg: string;
  /** Active tab text color */
  switcherActiveColor: string;
  /** Active tab font weight */
  switcherActiveFontWeight: number;
  /** Active tab box-shadow */
  switcherActiveBoxShadow: string;
}

// ── Generic keyword patterns ────────────────────────────────────────────────

/** Chart keywords to match against individual words (after splitting camelCase/separators). */
const CHART_KEYWORDS = new Set([
  'chart', 'graph', 'plot', 'histogram', 'pie', 'donut', 'sparkline', 'analytics',
]);

/** Axis — any node with "axis" in the name (xAxis, y axis, x-axis, yAxisLeft, etc.) */
const AXIS_RE = /axis/i;

/** Legend — any node with "legend" in the name */
const LEGEND_RE = /legend/i;

/** Switcher/tabs — any node with "switcher" or "tab" in the name */
const SWITCHER_RE = /switch|toggle|tab/i;

// ── Detection ───────────────────────────────────────────────────────────────

/**
 * Returns true if a node looks like a chart/graph section.
 *
 * Tier 1: Any descendant name contains chart keywords.
 * Tier 2: Structural — has axis frames AND multiple VECTOR/LINE data elements.
 *
 * Generic: no design-specific names are hardcoded.
 */
export function isChartSection(node: any): boolean {
  if (!node) return false;

  // Tier 1: any descendant (including self) has a chart keyword as a word in its name
  if (hasChartKeywordInTree(node)) return true;

  // Tier 2: structural — has axis frame(s) AND visual data elements (VECTORs/LINEs)
  // Use a stricter axis pattern (name starts with x/y + axis) to avoid "Chart&Axis" false positives
  const hasAxis = findNodeByName(node, /^[xy][-_ ]?axis/i) !== null;
  const vectors = findAllNodes(node, (n: any) =>
    n.type === 'VECTOR' || n.type === 'LINE',
  );
  // A chart typically has at least 2 vector elements (grid lines, data series, etc.)
  const hasDataElements = vectors.length >= 2;

  return hasAxis && hasDataElements;
}

// ── Chart type detection ────────────────────────────────────────────────────

/**
 * Detect chart type from structural signals.
 * Uses descendant names and node types — no hardcoded design names.
 */
export function detectChartType(node: any): ChartType {
  // Collect all words from descendant names (camelCase-split)
  const allWords = collectAllNames(node)
    .flatMap(splitIntoWords)
    .map((w) => w.toLowerCase());
  const wordSet = new Set(allWords);

  // Check for explicit type keywords — order: more specific first
  if (wordSet.has('pie')) return 'pie';
  if (wordSet.has('donut')) return 'donut';
  if (wordSet.has('bar')) return 'bar';
  if (wordSet.has('area')) return 'area';
  if (wordSet.has('line')) return 'line';

  // Structural analysis: look for VECTOR/RECTANGLE patterns
  const vectors = findAllNodes(node, (n: any) => n.type === 'VECTOR');
  const rects = findAllNodes(node, (n: any) => n.type === 'RECTANGLE');
  const ellipses = findAllNodes(node, (n: any) => n.type === 'ELLIPSE');

  // Multiple rectangles of similar width → bar chart
  if (rects.length >= 3) {
    const widths = rects.map(
      (r: any) => r.absoluteBoundingBox?.width ?? r.size?.x ?? 0,
    );
    const allSimilar = widths.every((w: number) => Math.abs(w - widths[0]) < 5);
    if (allSimilar) return 'bar';
  }

  // Ellipses arranged in a group → pie
  if (ellipses.length >= 3) return 'pie';

  // VECTORs with strokes → line chart
  const strokedVectors = vectors.filter(
    (v: any) => (v.strokes ?? []).length > 0,
  );
  if (strokedVectors.length > 0) return 'line';

  // Default
  return 'unknown';
}

/**
 * Extract chart metadata by walking the raw Figma tree.
 * Called only after isChartSection() returns true.
 *
 * All lookups use generic patterns (axis, legend, etc.) — not design-specific names.
 *
 * @param llmProvider - If provided, the LLM decides the chart type.
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

  // Background color — use the chart container's own fill (not a random descendant).
  // Look for the first FRAME descendant that has a chart keyword in its name and a fill,
  // otherwise use the top node's fill, otherwise default to white.
  let backgroundColor = '#ffffff';
  const topFills = node.fills ?? [];
  const topSolid = topFills.find((f: any) => f.type === 'SOLID' && f.color);
  if (topSolid) {
    backgroundColor = figmaColorToHex(topSolid.color);
  } else {
    // Look for the chart container frame (e.g. "BarLineChart") that has a fill
    const chartFrame = findNodeByName(node, /\bchart\b|\bgraph\b/i);
    if (chartFrame) {
      const cf = (chartFrame.fills ?? []).find((f: any) => f.type === 'SOLID' && f.color);
      if (cf) backgroundColor = figmaColorToHex(cf.color);
    }
  }

  // Chart type — LLM decides if available, otherwise structural heuristics
  const chartType = llmProvider
    ? await detectChartTypeWithLLM(node, llmProvider)
    : detectChartType(node);

  // Series color — find the primary data element's fill or stroke color.
  // Strategy: look for colored fills on data elements (BOOLEAN_OPERATION, RECTANGLE, VECTOR)
  // that are NOT black/white/gray (those are typically text/grid/background).
  let seriesColor = '#9747ff'; // fallback purple
  const dataNodes = findAllNodes(node, (n: any) => {
    const type = n.type ?? '';
    return ['BOOLEAN_OPERATION', 'RECTANGLE', 'VECTOR', 'ELLIPSE'].includes(type);
  });
  for (const dn of dataNodes) {
    // Check fills first (for bars/shapes)
    for (const f of dn.fills ?? []) {
      if (f.type === 'SOLID' && f.color && isChromatic(f.color)) {
        seriesColor = figmaColorToHex(f.color);
        break;
      }
    }
    if (seriesColor !== '#9747ff') break;
    // Then strokes (for lines)
    for (const s of dn.strokes ?? []) {
      if (s.type === 'SOLID' && s.color && isChromatic(s.color)) {
        seriesColor = figmaColorToHex(s.color);
        break;
      }
    }
    if (seriesColor !== '#9747ff') break;
  }

  // Find axis frames — only match frames/groups whose name starts with x/y + axis
  // (e.g. "xAxis", "yAxisLeft") to avoid matching parent containers like "Chart&Axis"
  const allAxisFrames = findAllNodes(node, (n: any) => {
    const name = n.name ?? '';
    return /^[xy][-_ ]?axis/i.test(name);
  });

  // Separate x-axis vs y-axis
  const xAxisFrame = allAxisFrames.find((n: any) => /^x/i.test(n.name ?? ''));
  const yAxisFrame = allAxisFrames.find((n: any) => /^y/i.test(n.name ?? ''));

  const effectiveXAxis = xAxisFrame ?? null;
  const effectiveYAxis = yAxisFrame ?? null;

  // Axis label color — from TEXT nodes inside any axis frame
  let axisLabelColor = '#A1A1A1';
  const anyAxisFrame = effectiveYAxis ?? effectiveXAxis;
  if (anyAxisFrame) {
    const textNode = findNodeByType(anyAxisFrame, 'TEXT');
    if (textNode?.fills?.[0]?.color) {
      axisLabelColor = figmaColorToHex(textNode.fills[0].color);
    }
  }

  // X-axis labels — TEXT from x-axis frame
  const xAxisLabels = effectiveXAxis
    ? collectTextNodes(effectiveXAxis)
        .map((t: any) => t.characters ?? t.content ?? '')
        .filter(Boolean)
    : [];

  // Y-axis labels → parse numeric min/max
  const yAxisTexts = effectiveYAxis
    ? collectTextNodes(effectiveYAxis)
        .map((t: any) => t.characters ?? t.content ?? '')
        .filter(Boolean)
    : [];
  const yAxisNums = yAxisTexts.map(Number).filter((n) => !isNaN(n));
  const yAxisMin = yAxisNums.length > 0 ? Math.min(...yAxisNums) : 0;
  const yAxisMax = yAxisNums.length > 0 ? Math.max(...yAxisNums) : 100;

  // Data point count — prefer x-axis label count, fallback 12
  const dataPointCount = xAxisLabels.length || 12;

  // Series name — from any "legend" descendant's TEXT content
  let seriesName = 'Chart';
  const legendsFrame = findNodeByName(node, LEGEND_RE);
  if (legendsFrame) {
    const textNodes = collectTextNodes(legendsFrame);
    const labelNode = textNodes.find(
      (t: any) => (t.characters ?? t.content ?? '').length > 1,
    );
    if (labelNode) {
      seriesName = labelNode.characters ?? labelNode.content ?? 'Chart';
    }
  }

  // Period options — from any "switcher"/"tab" descendant's TEXT content
  let periodOptions: string[] = [];
  let hasSwitcher = false;
  const switcherFrame = findNodeByName(node, SWITCHER_RE);
  if (switcherFrame) {
    hasSwitcher = true;
    periodOptions = collectTextNodes(switcherFrame)
      .map((t: any) => t.characters ?? t.content ?? '')
      .filter(Boolean);
  }

  // Component name derived from series name
  const componentName = toPascalCase(seriesName) + 'Chart';
  const bemBase = toKebabCase(componentName);

  // ── Grid line styling ──
  const { gridLineColor, gridStrokeDasharray } = extractGridStyle(node);

  // ── Container styling ──
  const containerBorderRadius = node.cornerRadius ?? 0;
  const containerPadding = {
    top: node.paddingTop ?? 0,
    right: node.paddingRight ?? 0,
    bottom: node.paddingBottom ?? 0,
    left: node.paddingLeft ?? 0,
  };

  // ── Chart area height — find the content frame (contains axes/graph), excluding legends/switcher ──
  const chartAreaHeight = extractChartAreaHeight(node, h);

  // ── Axis font size ──
  let axisFontSize = 10;
  if (anyAxisFrame) {
    const axisText = findNodeByType(anyAxisFrame, 'TEXT');
    if (axisText?.style?.fontSize) {
      axisFontSize = axisText.style.fontSize;
    }
  }

  // ── Y-axis width ──
  let yAxisWidth = 28;
  if (effectiveYAxis?.absoluteBoundingBox?.width) {
    yAxisWidth = Math.round(effectiveYAxis.absoluteBoundingBox.width);
  }

  // ── Series stroke width — from primary VECTOR data element ──
  let seriesStrokeWidth = 2;
  const strokedDataVectors = findAllNodes(node, (n: any) =>
    n.type === 'VECTOR' && (n.strokes ?? []).length > 0 && n.strokeWeight,
  );
  if (strokedDataVectors.length > 0) {
    seriesStrokeWidth = strokedDataVectors[0].strokeWeight;
  }

  // ── Dot styling — from ELLIPSE nodes in graph area ──
  const { dotRadius, dotStrokeColor, dotStrokeWidth } = extractDotStyle(node);

  // ── Gradient opacity for area charts ──
  const gradientStartOpacity = extractGradientOpacity(node);

  // ── Bar corner radius ──
  const barRadius = extractBarRadius(node) as [number, number, number, number];

  // ── Chart margin from the chart content frame ──
  const chartMargin = extractChartMargin(node);

  // ── Legend styling ──
  const legendStyle = extractLegendStyle(legendsFrame, node);

  // ── Switcher styling ──
  const switcherStyle = extractSwitcherStyle(switcherFrame);

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

    // Styling from Figma
    gridLineColor,
    gridStrokeDasharray,
    chartAreaHeight,
    containerBorderRadius,
    containerPadding,
    axisFontSize,
    yAxisWidth,
    seriesStrokeWidth,
    dotRadius,
    dotStrokeColor,
    dotStrokeWidth,
    gradientStartOpacity,
    barRadius,
    chartMargin,
    ...legendStyle,
    ...switcherStyle,
  };
}

// ── Styling extraction helpers ───────────────────────────────────────────────

/** Extract grid line color and dash pattern from LINE/VECTOR nodes in grid-like frames. */
function extractGridStyle(node: any): { gridLineColor: string; gridStrokeDasharray: string } {
  let gridLineColor = '#E5E7EB';
  let gridStrokeDasharray = '3 3';

  // Look for grid frames (names containing "line", "grid")
  const gridFrame = findNodeByName(node, /\bline|grid/i);
  if (gridFrame) {
    const lineNode =
      findNodeByType(gridFrame, 'LINE') ?? findNodeByType(gridFrame, 'VECTOR');
    if (lineNode) {
      const stroke = (lineNode.strokes ?? [])[0];
      if (stroke?.color) gridLineColor = figmaColorToHex(stroke.color);
      if (lineNode.strokeDashes && Array.isArray(lineNode.strokeDashes)) {
        gridStrokeDasharray =
          lineNode.strokeDashes.length > 0
            ? lineNode.strokeDashes.join(' ')
            : '';
      }
    }
  }

  return { gridLineColor, gridStrokeDasharray };
}

/** Extract chart area height (the graph content frame, excluding legends/switcher). */
function extractChartAreaHeight(node: any, fallbackHeight: number): number {
  // Look for a frame that contains axis references — that's the chart content area
  const chartContentFrame = findAllNodes(node, (n: any) => {
    if (n.type !== 'FRAME' && n.type !== 'GROUP') return false;
    const name = (n.name ?? '').toLowerCase();
    return name.includes('chart') || name.includes('graph') || name.includes('axis');
  });

  // Pick the largest frame that isn't the root
  let best: any = null;
  for (const f of chartContentFrame) {
    if (f === node) continue;
    const fh = f.absoluteBoundingBox?.height ?? 0;
    if (!best || fh > (best.absoluteBoundingBox?.height ?? 0)) {
      best = f;
    }
  }

  return best?.absoluteBoundingBox?.height
    ? Math.round(best.absoluteBoundingBox.height)
    : Math.round(fallbackHeight * 0.7);
}

/** Extract dot styling from ELLIPSE nodes in the graph area. */
function extractDotStyle(node: any): {
  dotRadius: number;
  dotStrokeColor: string;
  dotStrokeWidth: number;
} {
  let dotRadius = 3;
  let dotStrokeColor = '#ffffff';
  let dotStrokeWidth = 2;

  // Find small ELLIPSE nodes (data dots on the chart line)
  const ellipses = findAllNodes(node, (n: any) => {
    if (n.type !== 'ELLIPSE') return false;
    const size = n.absoluteBoundingBox?.width ?? n.size?.x ?? 0;
    return size > 0 && size <= 20; // small dots only
  });

  if (ellipses.length > 0) {
    const dot = ellipses[0];
    const size = dot.absoluteBoundingBox?.width ?? dot.size?.x ?? 6;
    dotRadius = Math.round(size / 2);
    if (dot.strokeWeight) dotStrokeWidth = dot.strokeWeight;
    const stroke = (dot.strokes ?? [])[0];
    if (stroke?.color) dotStrokeColor = figmaColorToHex(stroke.color);
  }

  return { dotRadius, dotStrokeColor, dotStrokeWidth };
}

/** Extract gradient start opacity from GRADIENT_LINEAR fills. */
function extractGradientOpacity(node: any): number {
  const gradientNodes = findAllNodes(node, (n: any) =>
    (n.fills ?? []).some((f: any) => f.type === 'GRADIENT_LINEAR'),
  );
  for (const gn of gradientNodes) {
    for (const fill of gn.fills ?? []) {
      if (fill.type === 'GRADIENT_LINEAR' && fill.gradientStops?.length > 0) {
        // First stop opacity
        const firstStop = fill.gradientStops[0];
        if (firstStop.color?.a !== undefined) {
          return Math.round(firstStop.color.a * 100) / 100;
        }
      }
    }
  }
  return 0.75;
}

/** Extract bar corner radius from RECTANGLE nodes. */
function extractBarRadius(node: any): [number, number, number, number] {
  const rects = findAllNodes(node, (n: any) => {
    if (n.type !== 'RECTANGLE') return false;
    // Look for bar-shaped rectangles (taller than wide, or with fills)
    const fills = (n.fills ?? []).filter((f: any) => f.type === 'SOLID' && f.color);
    return fills.length > 0 && isChromatic(fills[0].color);
  });

  if (rects.length > 0) {
    const rect = rects[0];
    if (rect.rectangleCornerRadii) {
      return rect.rectangleCornerRadii as [number, number, number, number];
    }
    const r = rect.cornerRadius ?? 0;
    // For bars, typically only top corners are rounded
    return [r, r, 0, 0];
  }
  return [4, 4, 0, 0];
}

/** Extract chart margin from chart content frame auto-layout padding. */
function extractChartMargin(node: any): { top: number; right: number; bottom: number; left: number } {
  // Find chart/graph content frame
  const contentFrame = findNodeByName(node, /chart|graph|axis/i);
  if (contentFrame) {
    return {
      top: contentFrame.paddingTop ?? 8,
      right: contentFrame.paddingRight ?? 0,
      bottom: contentFrame.paddingBottom ?? 0,
      left: contentFrame.paddingLeft ?? 0,
    };
  }
  return { top: 8, right: 0, bottom: 0, left: 0 };
}

/** Extract legend styling from the legends frame. */
function extractLegendStyle(legendsFrame: any, rootNode: any): {
  legendGap: number;
  legendItemGap: number;
  legendDotSize: number;
  legendDotBorderRadius: string;
  legendDotOpacity: number;
  legendLabelFontSize: number;
  legendLabelColor: string;
  legendMarginBottom: number;
} {
  const defaults = {
    legendGap: 8,
    legendItemGap: 6,
    legendDotSize: 10,
    legendDotBorderRadius: '50%',
    legendDotOpacity: 0.75,
    legendLabelFontSize: 12,
    legendLabelColor: '#262626',
    legendMarginBottom: 12,
  };

  if (!legendsFrame) return defaults;

  // Gap between legend items
  const legendGap = legendsFrame.itemSpacing ?? defaults.legendGap;

  // Find a legend item child (first direct child frame)
  const legendItem = (legendsFrame.children ?? []).find(
    (c: any) => c.type === 'FRAME' || c.type === 'GROUP' || c.type === 'INSTANCE',
  );
  const legendItemGap = legendItem?.itemSpacing ?? defaults.legendItemGap;

  // Legend dot (ELLIPSE or RECTANGLE inside legend item)
  let legendDotSize = defaults.legendDotSize;
  let legendDotBorderRadius = defaults.legendDotBorderRadius;
  let legendDotOpacity = defaults.legendDotOpacity;

  if (legendItem) {
    const dotNode =
      findNodeByType(legendItem, 'ELLIPSE') ?? findNodeByType(legendItem, 'RECTANGLE');
    if (dotNode) {
      legendDotSize = Math.round(
        dotNode.absoluteBoundingBox?.width ?? dotNode.size?.x ?? defaults.legendDotSize,
      );
      legendDotBorderRadius =
        dotNode.type === 'ELLIPSE'
          ? '50%'
          : `${dotNode.cornerRadius ?? 0}px`;
      // Opacity from fill
      const fill = (dotNode.fills ?? [])[0];
      if (fill?.opacity !== undefined) {
        legendDotOpacity = Math.round(fill.opacity * 100) / 100;
      } else if (dotNode.opacity !== undefined) {
        legendDotOpacity = Math.round(dotNode.opacity * 100) / 100;
      }
    }
  }

  // Legend label text styling
  let legendLabelFontSize = defaults.legendLabelFontSize;
  let legendLabelColor = defaults.legendLabelColor;

  const legendText = findNodeByType(legendsFrame, 'TEXT');
  if (legendText) {
    if (legendText.style?.fontSize) legendLabelFontSize = legendText.style.fontSize;
    const fill = (legendText.fills ?? [])[0];
    if (fill?.color) legendLabelColor = figmaColorToHex(fill.color);
  }

  // Margin below legends — spacing from legend frame to next sibling
  let legendMarginBottom = defaults.legendMarginBottom;
  // Use parent's itemSpacing if available (auto-layout gap)
  if (rootNode.itemSpacing !== undefined) {
    legendMarginBottom = rootNode.itemSpacing;
  }

  return {
    legendGap,
    legendItemGap,
    legendDotSize,
    legendDotBorderRadius,
    legendDotOpacity,
    legendLabelFontSize,
    legendLabelColor,
    legendMarginBottom,
  };
}

/** Extract switcher/tab styling from the switcher frame. */
function extractSwitcherStyle(switcherFrame: any): {
  switcherBg: string;
  switcherBorderRadius: number;
  switcherPadding: string;
  switcherMarginTop: number;
  switcherButtonPadding: string;
  switcherButtonFontSize: number;
  switcherButtonColor: string;
  switcherButtonBorderRadius: number;
  switcherActiveBg: string;
  switcherActiveColor: string;
  switcherActiveFontWeight: number;
  switcherActiveBoxShadow: string;
} {
  const defaults = {
    switcherBg: '#F5F5F5',
    switcherBorderRadius: 6,
    switcherPadding: '3px',
    switcherMarginTop: 12,
    switcherButtonPadding: '6px 12px',
    switcherButtonFontSize: 14,
    switcherButtonColor: '#737373',
    switcherButtonBorderRadius: 4,
    switcherActiveBg: '#ffffff',
    switcherActiveColor: '#262626',
    switcherActiveFontWeight: 500,
    switcherActiveBoxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
  };

  if (!switcherFrame) return defaults;

  // Container styling
  const containerFill = (switcherFrame.fills ?? []).find(
    (f: any) => f.type === 'SOLID' && f.color,
  );
  const switcherBg = containerFill
    ? figmaColorToHex(containerFill.color)
    : defaults.switcherBg;
  const switcherBorderRadius =
    switcherFrame.cornerRadius ?? defaults.switcherBorderRadius;
  const switcherPadding = formatPadding(switcherFrame, defaults.switcherPadding);

  // Margin — from parent itemSpacing (auto-layout)
  const switcherMarginTop = defaults.switcherMarginTop;

  // Find child tab frames
  const children = (switcherFrame.children ?? []).filter(
    (c: any) => c.type === 'FRAME' || c.type === 'INSTANCE' || c.type === 'GROUP',
  );

  // Identify active vs inactive tab by looking for a filled child
  let activeChild: any = null;
  let inactiveChild: any = null;

  for (const child of children) {
    const solidFill = (child.fills ?? []).find(
      (f: any) => f.type === 'SOLID' && f.color && (f.visible !== false),
    );
    if (solidFill) {
      activeChild = child;
    } else if (!inactiveChild) {
      inactiveChild = child;
    }
  }

  // If no active child found by fill, use first two children
  if (!activeChild && children.length > 0) activeChild = children[0];
  if (!inactiveChild && children.length > 1) inactiveChild = children[1];

  // Button padding
  const buttonChild = activeChild ?? inactiveChild;
  const switcherButtonPadding = buttonChild
    ? formatPadding(buttonChild, defaults.switcherButtonPadding)
    : defaults.switcherButtonPadding;

  // Button border-radius
  const switcherButtonBorderRadius =
    buttonChild?.cornerRadius ?? defaults.switcherButtonBorderRadius;

  // Button font size + colors — from TEXT nodes
  let switcherButtonFontSize = defaults.switcherButtonFontSize;
  let switcherButtonColor = defaults.switcherButtonColor;
  let switcherActiveBg = defaults.switcherActiveBg;
  let switcherActiveColor = defaults.switcherActiveColor;
  let switcherActiveFontWeight = defaults.switcherActiveFontWeight;

  if (inactiveChild) {
    const inactiveText = findNodeByType(inactiveChild, 'TEXT');
    if (inactiveText) {
      if (inactiveText.style?.fontSize)
        switcherButtonFontSize = inactiveText.style.fontSize;
      const fill = (inactiveText.fills ?? [])[0];
      if (fill?.color) switcherButtonColor = figmaColorToHex(fill.color);
    }
  }

  if (activeChild) {
    const activeFill = (activeChild.fills ?? []).find(
      (f: any) => f.type === 'SOLID' && f.color,
    );
    if (activeFill) switcherActiveBg = figmaColorToHex(activeFill.color);

    const activeText = findNodeByType(activeChild, 'TEXT');
    if (activeText) {
      if (!inactiveChild) {
        // Use active text for button font size if no inactive available
        if (activeText.style?.fontSize)
          switcherButtonFontSize = activeText.style.fontSize;
      }
      const fill = (activeText.fills ?? [])[0];
      if (fill?.color) switcherActiveColor = figmaColorToHex(fill.color);
      if (activeText.style?.fontWeight)
        switcherActiveFontWeight = activeText.style.fontWeight;
    }
  }

  // Box shadow from active child effects
  const switcherActiveBoxShadow = extractBoxShadow(activeChild) ?? defaults.switcherActiveBoxShadow;

  return {
    switcherBg,
    switcherBorderRadius,
    switcherPadding,
    switcherMarginTop,
    switcherButtonPadding,
    switcherButtonFontSize,
    switcherButtonColor,
    switcherButtonBorderRadius,
    switcherActiveBg,
    switcherActiveColor,
    switcherActiveFontWeight,
    switcherActiveBoxShadow,
  };
}

/** Format padding from Figma auto-layout properties into CSS string. */
function formatPadding(node: any, fallback: string): string {
  const top = node.paddingTop;
  const right = node.paddingRight;
  const bottom = node.paddingBottom;
  const left = node.paddingLeft;

  if (top === undefined && right === undefined && bottom === undefined && left === undefined) {
    return fallback;
  }

  const t = top ?? 0;
  const r = right ?? 0;
  const b = bottom ?? 0;
  const l = left ?? 0;

  if (t === b && l === r && t === l) return `${t}px`;
  if (t === b && l === r) return `${t}px ${r}px`;
  return `${t}px ${r}px ${b}px ${l}px`;
}

/** Extract box-shadow from Figma DROP_SHADOW effects. */
function extractBoxShadow(node: any): string | null {
  if (!node?.effects) return null;
  const shadows = (node.effects as any[]).filter(
    (e) => e.type === 'DROP_SHADOW' && e.visible !== false,
  );
  if (shadows.length === 0) return null;

  return shadows
    .map((s) => {
      const x = s.offset?.x ?? 0;
      const y = s.offset?.y ?? 0;
      const blur = s.radius ?? 0;
      const spread = s.spread ?? 0;
      const c = s.color ?? { r: 0, g: 0, b: 0, a: 0.1 };
      const r = Math.round((c.r ?? 0) * 255);
      const g = Math.round((c.g ?? 0) * 255);
      const b = Math.round((c.b ?? 0) * 255);
      const a = Math.round((c.a ?? 0.1) * 100) / 100;
      return `${x}px ${y}px ${blur}px${spread ? ` ${spread}px` : ''} rgba(${r}, ${g}, ${b}, ${a})`;
    })
    .join(', ');
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
- "line"    — data shown as connected points/lines
- "area"    — like line but with filled region beneath
- "bar"     — vertical or horizontal bars/columns
- "pie"     — circular segments
- "donut"   — pie with hollow center
- "unknown" — cannot determine

Analyze the layer names, node types (VECTOR, RECTANGLE, ELLIPSE, LINE), and structure.
Look for clues like: data series vectors, bar rectangles, pie slices, axis labels.`;

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

/** Collect all node names in the subtree (depth-limited to 5 levels). */
function collectAllNames(node: any, depth = 0): string[] {
  if (!node || depth > 5) return [];
  const names: string[] = [];
  if (node.name) names.push(node.name);
  for (const child of node.children ?? []) {
    names.push(...collectAllNames(child, depth + 1));
  }
  return names;
}

/**
 * Split a name into words — handles camelCase, PascalCase, spaces, underscores, hyphens.
 *   "BarLineChart" → ["Bar", "Line", "Chart"]
 *   "Chart&Axis"   → ["Chart", "Axis"]
 *   "Paragraph"    → ["Paragraph"]
 *   "graph 1"      → ["graph", "1"]
 */
function splitIntoWords(name: string): string[] {
  return name
    // Insert space before uppercase letters in camelCase: "BarLineChart" → "Bar Line Chart"
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    // Split on non-alphanumeric characters
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
}

/** Returns true if any descendant name contains a chart keyword as a distinct word. */
function hasChartKeywordInTree(node: any, depth = 0): boolean {
  if (!node || depth > 5) return false;
  const words = splitIntoWords(node.name ?? '');
  if (words.some((w) => CHART_KEYWORDS.has(w.toLowerCase()))) return true;
  for (const child of node.children ?? []) {
    if (hasChartKeywordInTree(child, depth + 1)) return true;
  }
  return false;
}

/** Walk down to find the first node (frame/group) with a SOLID fill. */
function findFirstNodeWithFill(node: any, depth = 0): any | null {
  if (!node || depth > 4) return null;
  const fills = node.fills ?? [];
  const solidFill = fills.find((f: any) => f.type === 'SOLID' && f.color);
  if (solidFill) return node;
  for (const child of node.children ?? []) {
    const found = findFirstNodeWithFill(child, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Returns true if a Figma color is "chromatic" — i.e. NOT black, white, or gray.
 * Used to skip text/grid/background colors when looking for series colors.
 */
function isChromatic(c: any): boolean {
  if (!c) return false;
  const r = c.r ?? 0, g = c.g ?? 0, b = c.b ?? 0;
  // Check if all channels are roughly equal (grayscale)
  const maxDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
  return maxDiff > 0.05; // needs at least 5% channel difference to be "colorful"
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
