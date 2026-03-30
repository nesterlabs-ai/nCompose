/**
 * Chart detection for Figma nodes.
 *
 * Detects chart/graph sections from the raw Figma tree using PURE STRUCTURAL
 * analysis of node properties (type, size, position, fills, strokes, layout).
 *
 * NO hardcoded keywords, names, or content patterns.
 *
 * Detection strategy (multi-signal, require >= 2 of 3):
 *   Signal A: Data shape cluster (overlapping ellipses, aligned bars, series vectors)
 *   Signal B: Axis-like text arrangement (evenly-spaced labels at edges)
 *   Signal C: Parallel grid lines (LINE/VECTOR nodes with strokes, evenly spaced)
 */

import type { LLMProvider } from '../llm/provider.js';
import { toKebabCase } from './component-set-parser.js';

/**
 * Chart type is a string — NOT a fixed union.
 * The LLM can return any Recharts-supported type (radar, scatter, funnel, treemap, etc.)
 * Structural heuristics only detect well-known types; the LLM handles the rest.
 */
export type ChartType = string;

export interface SeriesInfo {
  /** Series label, e.g. "Total invested" */
  name: string;
  /** Visually dominant data element fill, e.g. "#6f86fc" */
  color: string;
  /** Legend dot fill color, e.g. "#9747ff" */
  legendColor: string;
  /** Data value derived from Figma (e.g. arc sweep percentage for pie/donut). Optional — codegen uses fallback if missing. */
  value?: number;
}

export interface ChartMetadata {
  // ── Structural fields (always required — identity & data) ──

  chartType: ChartType;
  width: number;
  height: number;
  series: SeriesInfo[];
  componentName: string;
  bemBase: string;
  xAxisLabels: string[];
  yAxisMin: number;
  yAxisMax: number;
  yAxisTicks: number[];
  dataPointCount: number;
  periodOptions: string[];
  hasSwitcher: boolean;
  hasLegend: boolean;
  /** Bar chart data extracted from Figma bar structure. Null if not detected. */
  barData: Array<{ name: string; value: number; color?: string }> | null;
  /** Radar chart axis labels extracted from radially arranged TEXT nodes. */
  radarAxes: string[];
  /** Concentric ring data for radial charts. */
  rings: Array<{ name: string; color: string; trackColor: string; progress: number; innerRadius: number; outerRadius: number }>;
  /** Inner radius ratio for donut charts (0–1, from Figma arcData.innerRadius). */
  innerRadiusRatio: number;
  /** Chart content area height (excluding legends/switcher) */
  chartAreaHeight: number;

  // ── Text content (empty string when not found in Figma) ──

  chartTitle: string;
  chartSubtitle: string;
  summaryAmount: string;
  summaryText: string;
  summaryCtaText: string;
  donutCenterText: string;
  centerSubtext: string;

  // ── All styling fields below are OPTIONAL ──
  // Only populated when Figma provides the value.
  // When undefined, codegen omits the prop and lets Recharts use its own defaults.

  // Container
  backgroundColor?: string;
  containerBorderRadius?: number;
  containerPadding?: { top: number; right: number; bottom: number; left: number };

  // Title/subtitle styling
  titleFontSize?: number;
  titleFontWeight?: number;
  titleColor?: string;
  subtitleFontSize?: number;
  subtitleColor?: string;

  // Summary container styling
  summaryBg?: string;
  summaryBorderRadius?: number;
  summaryBorderColor?: string;
  summaryBorderWidth?: number;
  summaryPadding?: string;

  // Amount styling
  amountFontSize?: number;
  amountFontWeight?: number;
  amountColor?: string;

  // Summary text styling
  summaryTextFontSize?: number;
  summaryTextColor?: string;

  // CTA button styling
  ctaFontSize?: number;
  ctaFontWeight?: number;
  ctaColor?: string;
  ctaBg?: string;
  ctaBorderColor?: string;
  ctaBorderRadius?: number;
  ctaPadding?: string;

  // Axis styling
  axisLabelColor?: string;
  axisFontSize?: number;
  yAxisWidth?: number;

  // Grid styling
  gridLineColor?: string;
  gridStrokeDasharray?: string;

  // Series / line / area styling
  seriesStrokeWidth?: number;
  gradientStartOpacity?: number;

  // Dot styling
  dotRadius?: number;
  dotStrokeColor?: string;
  dotStrokeWidth?: number;

  // Bar styling
  barRadius?: [number, number, number, number];

  // Chart area margin
  chartMargin?: { top: number; right: number; bottom: number; left: number };

  // Donut/radial center text styling
  donutCenterFontSize?: number;
  donutCenterFontWeight?: number;
  donutCenterColor?: string;
  centerSubtextFontSize?: number;
  centerSubtextFontWeight?: number;
  centerSubtextColor?: string;

  // Legend styling
  legendGap?: number;
  legendItemGap?: number;
  legendDotSize?: number;
  legendDotBorderRadius?: string;
  legendDotOpacity?: number;
  legendLabelFontSize?: number;
  legendLabelColor?: string;
  legendMarginBottom?: number;

  // Switcher/tab styling
  switcherBg?: string;
  switcherBorderRadius?: number;
  switcherPadding?: string;
  switcherMarginTop?: number;
  switcherButtonPadding?: string;
  switcherButtonFontSize?: number;
  switcherButtonColor?: string;
  switcherButtonBorderRadius?: number;
  switcherActiveBg?: string;
  switcherActiveColor?: string;
  switcherActiveFontWeight?: number;
  switcherActiveBoxShadow?: string;
}

// ── Structural thresholds (named constants, not magic numbers) ──────────────

/** Minimum overlapping same-sized ellipses to consider a pie/donut cluster */
const MIN_PIE_ELLIPSES = 2;
/** Minimum aligned rectangles with chromatic fills to consider a bar group */
const MIN_BAR_RECTS = 3;
/** Minimum parallel line/vector nodes to consider grid lines */
const MIN_GRID_LINES = 3;
/** Minimum text nodes in a row/column to consider an axis */
const MIN_AXIS_LABELS = 2;
/** Position tolerance in pixels for grouping by center/edge */
const POS_TOLERANCE = 5;
/** Size tolerance in pixels for grouping same-sized shapes */
const SIZE_TOLERANCE = 5;

/**
 * Minimum diameter (px) for an ELLIPSE to be considered a pie/donut slice.
 * Ellipses smaller than this are data-point dots on line/area charts, legend
 * swatches, or decorative elements — never pie/donut arcs.
 *
 * Derived from the node tree: real pie slices are typically ≥ 15% of the
 * container dimension, while data-point dots are 3–13 px.
 */
const MIN_PIE_ELLIPSE_DIAMETER = 20;

/**
 * Minimum height (px) for a stroked VECTOR to be treated as a chart data
 * series (line / area).  Decorative divider lines have height ≈ 0; actual
 * data-series paths always span a measurable vertical range.
 */
const MIN_SERIES_VECTOR_HEIGHT = 3;

// ── Property-Based Visual Node Collection ────────────────────────────────────
//
// Instead of hardcoding which Figma node types to look for (VECTOR, ELLIPSE,
// RECTANGLE, etc.), we collect ALL visual nodes based on their PROPERTIES
// (fills, strokes, geometry) and classify them by structural patterns.

/** Cached properties of a visual Figma node for chart detection. */
interface VisualNode {
  node: any;
  type: string;
  bbox: { x: number; y: number; w: number; h: number };
  center: { cx: number; cy: number };
  aspectRatio: number;
  area: number;
  fills: any[];           // chromatic solid fills + gradients
  strokes: any[];         // chromatic strokes
  isPolygonal: boolean;   // REGULAR_POLYGON or STAR
  hasArcData: boolean;
  arcSweep: number;       // |endAngle - startAngle|, 0 if none
  innerRadius: number;    // arcData.innerRadius, 0 if none
  hasTextDescendant: boolean;
  strokeWeight: number;
}

/**
 * Property-based check: is this node a visual shape?
 * Returns true for ANY node that has fills, strokes, or geometry —
 * regardless of its Figma type. Excludes TEXT (content, not shape)
 * and GROUP (structural wrapper, not visual).
 */
function isVisualNode(n: any): boolean {
  if (!n) return false;
  // Include hidden nodes that have arcData — these are pie/donut slices the
  // designer toggled off (e.g., showing only the dominant slice in a gauge view).
  // They still define the chart structure and are needed for detection.
  if (n.visible === false && !n.arcData) return false;
  if (n.type === 'TEXT' || n.type === 'GROUP') return false;
  const hasFills = Array.isArray(n.fills) && n.fills.some(
    (f: any) => f.visible !== false && (
      f.type === 'SOLID' || f.type === 'GRADIENT_LINEAR' || f.type === 'GRADIENT_RADIAL'
      || (typeof f === 'string') // simplified format: CSS color string
      || (f.color && !f.type) // simplified format: {color: '#hex'} without type
    ),
  );
  const hasStrokes = Array.isArray(n.strokes) && n.strokes.some(
    (s: any) => s.visible !== false && (
      s.type === 'SOLID'
      || (typeof s === 'string') // simplified format
      || (s.color && !s.type) // simplified format
    ),
  );
  // Also check for arcData (ELLIPSE with arcs) even without fills
  const hasArcData = !!n.arcData;
  const hasBBox = !!n.absoluteBoundingBox;
  return (hasFills || hasStrokes || hasArcData) && hasBBox;
}

/**
 * Collects all visual nodes in a subtree in a single recursive walk.
 * Returns an array of VisualNode with cached properties for fast filtering.
 * Replaces 10+ independent findAllNodes calls with one O(n) pass.
 */
function collectVisualNodes(root: any): VisualNode[] {
  const results: VisualNode[] = [];

  function walk(n: any): boolean {
    if (!n) return false;
    // Skip hidden nodes UNLESS they have arcData (hidden pie/donut slices
    // that define the chart structure — designer toggled them off visually)
    if (n.visible === false && !n.arcData) return false;

    let hasTextChild = n.type === 'TEXT';
    for (const child of (n.children ?? [])) {
      if (walk(child)) hasTextChild = true;
    }

    if (isVisualNode(n)) {
      const bb = n.absoluteBoundingBox;
      const w = bb?.width ?? 0;
      const h = bb?.height ?? 0;
      const chromaticFills = (n.fills ?? []).filter((f: any) => {
        if (f.visible === false) return false;
        if (f.type === 'GRADIENT_LINEAR' || f.type === 'GRADIENT_RADIAL') return true;
        if (f.type === 'SOLID' && f.color) return isChromatic(f.color);
        // Simplified format: fill is a string or object without type
        if (typeof f === 'string') return true;
        if (f.color && !f.type) return true;
        return false;
      });
      const chromaticStrokes = (n.strokes ?? []).filter((s: any) => {
        if (s.visible === false) return false;
        if (s.type === 'SOLID' && s.color) return isChromatic(s.color);
        if (typeof s === 'string') return true;
        if (s.color && !s.type) return true;
        return false;
      });

      const arcData = n.arcData;
      results.push({
        node: n,
        type: n.type ?? '',
        bbox: { x: bb?.x ?? 0, y: bb?.y ?? 0, w, h },
        center: { cx: (bb?.x ?? 0) + w / 2, cy: (bb?.y ?? 0) + h / 2 },
        aspectRatio: h > 0 ? w / h : 0,
        area: w * h,
        fills: chromaticFills,
        strokes: chromaticStrokes,
        isPolygonal: n.type === 'REGULAR_POLYGON' || n.type === 'STAR',
        hasArcData: !!arcData,
        arcSweep: arcData ? Math.abs((arcData.endingAngle ?? 0) - (arcData.startingAngle ?? 0)) : 0,
        innerRadius: arcData?.innerRadius ?? 0,
        hasTextDescendant: hasTextChild,
        strokeWeight: n.strokeWeight ?? 0,
      });
    }

    return hasTextChild;
  }

  walk(root);
  return results;
}

// ── LLM-First Chart Detection ────────────────────────────────────────────────

/**
 * Detects ALL charts in a page/section with a single LLM call.
 * The LLM understands context — distinguishes chart data from icons, maps,
 * tables, and decorative elements better than structural heuristics.
 */
export async function detectChartsInPage(
  node: any,
  llm: LLMProvider,
): Promise<Array<{ name: string; chartType: ChartType }>> {
  if (!node) return [];

  const bb = node.absoluteBoundingBox;
  if (bb) {
    const h = bb.height ?? 0;
    const w = bb.width ?? 0;
    if (h < 60 || h < w * 0.15) return [];
  }

  try {
    const summary = buildNodeSummary(node, 0, 6);

    const systemPrompt = `You are a Figma design analyzer. Given a page's node tree, identify ALL chart/graph sections and their types.

Charts have DATA SHAPES (bars, lines, pie slices, radar polygons, area fills) arranged to visualize numerical values. Look for:
- VECTOR/RECTANGLE nodes arranged as bars (varying heights, aligned edges)
- VECTOR nodes with strokes forming lines or area fills with gradients
- ELLIPSE/ARC nodes with arcData forming pie or donut slices
- Concentric shapes forming radar/spider grids
- Axis labels (numeric text at edges), grid lines, legends (colored dots + text)

NOT charts:
- Tables with rows/columns of data (even if they have colored cells or status indicators)
- Icons, logos, or decorative illustrations
- Google Maps or map mockups
- Forms, input fields, buttons, cards, navigation
- Decorative chart previews inside promotional/CTA pages
- Progress bars or loading indicators
- Sidebars, navbars, or any navigation elements

Chart types: line, area, bar, pie, donut, radar, radial, scatter, funnel, treemap, composed

For EACH chart found (even if multiple charts share the same name), provide:
- "name": the Figma node name exactly as shown in the tree
- "chartType": the chart type

IMPORTANT: If the tree has multiple charts with the same name, list EACH one separately.

Respond with ONLY JSON — no markdown, no explanation:
{"charts": [{"name": "exact node name", "chartType": "bar"}]}
or {"charts": []} if no charts found.`;

    const userPrompt = `Identify all charts in this Figma node tree:\n\n${summary}`;

    const response = await llm.generate(userPrompt, systemPrompt);
    const jsonMatch = response.match(/\{[\s\S]*?"charts"\s*:\s*\[[\s\S]*?\]\s*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed.charts)) {
        return parsed.charts
          .filter((c: any) => c.name && c.chartType && c.chartType !== 'unknown')
          .map((c: any) => ({ name: c.name, chartType: c.chartType as ChartType }));
      }
    }
  } catch {
    // LLM failed — return empty
  }

  return [];
}

/**
 * Sync chart detection using structural analysis — does NOT rely on node names.
 * Requires MULTIPLE confirming signals to avoid false positives on UI sections
 * (maps, card grids, icon layouts) that have colored shapes.
 * Used as fallback when LLM detection is unavailable.
 */
export function isChartSection(node: any): boolean {
  if (!node) return false;
  const bb = node.absoluteBoundingBox;
  if (bb && (bb.height < 60 || bb.height < bb.width * 0.15)) return false;

  // Require at least 2 of 3 signals: data shapes (via chart type), axis text, grid lines
  const chartType = detectChartType(node);
  if (chartType === 'unknown') return false;

  const hasAxes = hasAxisLikeTextArrangement(node);
  const hasGrid = hasParallelGridLines(node);

  // Arc-based charts (pie/donut/radial) are high confidence from shape alone
  if (chartType === 'pie' || chartType === 'donut' || chartType === 'radial') return true;

  // Cartesian charts need at least one supporting signal (axes or grid)
  return hasAxes || hasGrid;
}

// ── Signal A: Data shape cluster ────────────────────────────────────────────

interface ShapeClusterResult {
  detected: boolean;
  highConfidence: boolean;
  /** Number of bar-like elements found (used for scoring) */
  count?: number;
}

/**
 * Validates that a group of aligned shapes actually looks like chart bars,
 * not UI elements (cards, buttons, list items).
 *
 * Checks from Figma data only:
 * 1. Consistent size on the NON-varying dimension (bars have similar widths)
 * 2. Varying size on the data dimension (bars have different heights)
 * 3. The variation is significant relative to the shapes themselves
 *
 * @param group - Array of Figma nodes sharing a common edge
 * @param direction - 'vertical' (shared bottom) or 'horizontal' (shared left)
 */
function isBarLikeGroup(group: any[], direction: 'vertical' | 'horizontal'): boolean {
  const bbs = group.map((r: any) => r.absoluteBoundingBox).filter(Boolean);
  if (bbs.length < 3) return false;

  if (direction === 'vertical') {
    // Vertical bars: widths should be consistent, heights should vary
    const widths = bbs.map((bb: any) => bb.width);
    const heights = bbs.map((bb: any) => bb.height);

    const medianWidth = widths.sort((a: number, b: number) => a - b)[Math.floor(widths.length / 2)];
    const maxHeight = Math.max(...heights);
    const minHeight = Math.min(...heights);

    // Width consistency: most bars within ±50% of median width
    const consistentWidths = widths.filter(
      (w: number) => w >= medianWidth * 0.5 && w <= medianWidth * 1.5,
    ).length;
    if (consistentWidths < widths.length * 0.6) return false;

    // Height variation: range must be significant relative to the tallest bar
    // (bars represent different data values, so heights should differ)
    if (maxHeight === 0) return false;
    const heightVariation = (maxHeight - minHeight) / maxHeight;
    if (heightVariation < 0.15) return false; // less than 15% variation → not a data chart

  } else {
    // Horizontal bars: heights should be consistent, widths should vary
    const widths = bbs.map((bb: any) => bb.width);
    const heights = bbs.map((bb: any) => bb.height);

    const medianHeight = heights.sort((a: number, b: number) => a - b)[Math.floor(heights.length / 2)];
    const maxWidth = Math.max(...widths);
    const minWidth = Math.min(...widths);

    const consistentHeights = heights.filter(
      (h: number) => h >= medianHeight * 0.5 && h <= medianHeight * 1.5,
    ).length;
    if (consistentHeights < heights.length * 0.6) return false;

    if (maxWidth === 0) return false;
    const widthVariation = (maxWidth - minWidth) / maxWidth;
    if (widthVariation < 0.15) return false;
  }

  return true;
}

// ── Signal B: Axis-like text arrangement ────────────────────────────────────

function hasAxisLikeTextArrangement(node: any): boolean {
  const rootBB = node.absoluteBoundingBox;
  if (!rootBB) return false;

  const allFrames = findAllNodes(node, (n: any) =>
    n.type === 'FRAME' || n.type === 'GROUP',
  );

  for (const frame of allFrames) {
    const frameBB = frame.absoluteBoundingBox;
    if (!frameBB) continue;

    const textChildren = findAllNodes(frame, (n: any) => n.type === 'TEXT');
    if (textChildren.length < MIN_AXIS_LABELS) continue;

    // X-axis: frame in the bottom 30%, texts arranged horizontally with short labels
    // AND text nodes must be spread across the frame width (axis-like distribution).
    const isBottom = frameBB.y + frameBB.height / 2 > rootBB.y + rootBB.height * 0.7;
    const spansWidth = frameBB.width > rootBB.width * 0.4;
    if (isBottom && spansWidth && textChildren.length >= 3) {
      const allShortText = textChildren.every((t: any) =>
        (t.characters ?? t.content ?? '').trim().length < 8,
      );
      if (allShortText) {
        // Check that text nodes are spread horizontally across the frame
        const textXPositions = textChildren
          .map((t: any) => t.absoluteBoundingBox?.x ?? 0)
          .sort((a: number, b: number) => a - b);
        const textSpread = textXPositions[textXPositions.length - 1] - textXPositions[0];
        // Text nodes should span at least 50% of the frame width to be axis-like
        if (textSpread > frameBB.width * 0.5) return true;
      }
    }

    // Y-axis: frame in the left 25% or right 25%, texts arranged vertically with numeric content.
    // Y-axis frames are narrow (label columns), not wide like content containers.
    const isLeftEdge = frameBB.x < rootBB.x + rootBB.width * 0.25;
    const isRightEdge = frameBB.x + frameBB.width > rootBB.x + rootBB.width * 0.75;
    const spansHeight = frameBB.height > rootBB.height * 0.3;
    const isNarrowEnough = frameBB.width < rootBB.width * 0.4;
    if ((isLeftEdge || isRightEdge) && spansHeight && isNarrowEnough && textChildren.length >= MIN_AXIS_LABELS) {
      const numericTexts = textChildren.filter((t: any) => {
        const text = (t.characters ?? t.content ?? '').trim();
        return /^[\d.,\-$%kKmMbB]+$/.test(text);
      });
      if (numericTexts.length >= MIN_AXIS_LABELS) {
        // Y-axis labels should be vertically spread across the frame
        const textYPositions = numericTexts
          .map((t: any) => t.absoluteBoundingBox?.y ?? 0)
          .sort((a: number, b: number) => a - b);
        const textSpread = textYPositions[textYPositions.length - 1] - textYPositions[0];
        if (textSpread > frameBB.height * 0.4) return true;
      }
    }
  }

  return false;
}

// ── Signal C: Parallel grid lines ───────────────────────────────────────────

function hasParallelGridLines(node: any): boolean {
  const lineNodes = findAllNodes(node, (n: any) => {
    const type = n.type;
    if (type !== 'LINE' && type !== 'VECTOR') return false;
    const hasStroke = (n.strokes ?? []).length > 0;
    const hasNoFill = !(n.fills ?? []).some(
      (f: any) => f.type === 'SOLID' && f.color && isChromatic(f.color),
    );
    return hasStroke && hasNoFill;
  });

  if (lineNodes.length < MIN_GRID_LINES) return false;

  // Group horizontal lines (similar width, similar x, different y)
  const horizontal = lineNodes.filter((n: any) => {
    const bb = n.absoluteBoundingBox;
    return bb && bb.width > bb.height * 3;
  });
  if (horizontal.length >= MIN_GRID_LINES) {
    const widths = horizontal.map((n: any) => n.absoluteBoundingBox.width);
    const avgWidth = widths.reduce((a: number, b: number) => a + b, 0) / widths.length;
    const similarWidth = widths.every((w: number) => Math.abs(w - avgWidth) / avgWidth < 0.15);
    if (similarWidth) return true;
  }

  // Group vertical lines (similar height, similar y, different x)
  const vertical = lineNodes.filter((n: any) => {
    const bb = n.absoluteBoundingBox;
    return bb && bb.height > bb.width * 3;
  });
  if (vertical.length >= MIN_GRID_LINES) {
    const heights = vertical.map((n: any) => n.absoluteBoundingBox.height);
    const avgHeight = heights.reduce((a: number, b: number) => a + b, 0) / heights.length;
    const similarHeight = heights.every((h: number) => Math.abs(h - avgHeight) / avgHeight < 0.15);
    if (similarHeight) return true;
  }

  return false;
}

// ── Chart type detection ────────────────────────────────────────────────────

/**
 * Detect chart type from structural analysis of node properties.
 * Analyzes shapes, positions, fills, strokes — not names.
 *
 * Uses a **competitive scoring** approach instead of first-match-wins:
 * each chart type accumulates a confidence score and the highest wins.
 * This prevents tiny data-point ellipses from overriding strong
 * line/area/bar signals.
 */
function detectChartType(node: any): ChartType {
  const rootBB = node.absoluteBoundingBox;
  const rootSize = rootBB ? Math.max(rootBB.width, rootBB.height) : 0;

  // Collect scores: { type → confidence }
  const scores: Record<string, number> = {};
  const addScore = (type: string, score: number) => {
    scores[type] = (scores[type] ?? 0) + score;
  };

  // ── Cartesian axis signals (shared by line / area / bar) ─────────────────
  // Detecting axes early lets us weight cartesian types higher when axes exist.
  const hasAxes = hasAxisLikeTextArrangement(node);
  const hasGrid = hasParallelGridLines(node);
  const cartesianBoost = (hasAxes ? 3 : 0) + (hasGrid ? 2 : 0);

  // Single-pass collection of ALL visual nodes — property-based, not type-based
  const visualNodes = collectVisualNodes(node);

  // ── 1. PIE / DONUT — circular shapes with chromatic fills ────────────────
  // Must be circular (aspect ratio ~1:1). arcData alone is not enough —
  // bar overlay ellipses (29×16 ovals) have arcData but aren't pie slices.
  const pieShapes = visualNodes.filter((vn) => {
    const diameter = Math.max(vn.bbox.w, vn.bbox.h);
    if (diameter < MIN_PIE_ELLIPSE_DIAMETER) return false;
    const isCircular = vn.bbox.w > 0 && vn.bbox.h > 0
      && Math.max(vn.bbox.w, vn.bbox.h) / Math.min(vn.bbox.w, vn.bbox.h) <= 1.3;
    return isCircular;
  });
  const pieNodes = pieShapes.map((vn) => vn.node);

  let pieType: 'pie' | 'donut' | null = null;
  const pieGroups = groupByCenter(pieNodes, POS_TOLERANCE, SIZE_TOLERANCE);
  for (const group of pieGroups) {
    if (group.length >= MIN_PIE_ELLIPSES) {
      const chromaticEllipses = group.filter((e: any) =>
        (e.fills ?? []).some((f: any) => {
          if (f.type === 'SOLID' && f.color) return isChromatic(f.color);
          if (f.type === 'GRADIENT_LINEAR' || f.type === 'GRADIENT_RADIAL') return true;
          return false;
        }),
      );
      if (chromaticEllipses.length >= MIN_PIE_ELLIPSES) {
        const visibleGroup = group.filter((e: any) => e.visible !== false);
        const visibleWithInnerRadius = visibleGroup.filter((e: any) =>
          e.arcData && typeof e.arcData.innerRadius === 'number' && e.arcData.innerRadius > 0,
        );
        // Donut vs pie: determined by arcData.innerRadius on VISIBLE slices only.
        // Hidden slices may have innerRadius from a shared template — they don't
        // represent what the chart actually looks like.
        // Center text (e.g. "9.2K") doesn't determine the type — both pies and
        // donuts can have center labels.
        pieType = visibleWithInnerRadius.length > 0 ? 'donut' : 'pie';
        const pieScore = 5 + chromaticEllipses.length - cartesianBoost;
        addScore(pieType, pieScore);
        break;
      }
    }
  }

  // ── 1b. RADIAL: concentric ring chart ───────────────────────────────────
  const concentricGroups = groupByCenterOnly(pieNodes, POS_TOLERANCE);
  for (const group of concentricGroups) {
    if (group.length >= 4) {
      const sizes = group.map((e: any) => Math.round(e.absoluteBoundingBox?.width ?? 0));
      const uniqueSizes = new Set(sizes);
      const hasPartialArcs = group.some((e: any) => {
        if (!e.arcData) return false;
        const sweep = Math.abs(e.arcData.endingAngle - e.arcData.startingAngle);
        return sweep > 0.01 && Math.abs(sweep - 2 * Math.PI) > 0.01;
      });
      if (uniqueSizes.size >= 2 && hasPartialArcs) {
        addScore('radial', 6 + group.length);
        break;
      }
    }
  }

  // ── 1c. RADAR: concentric shapes (any type) arranged with radial text ──
  // Radar grids can be REGULAR_POLYGON, STAR, or VECTOR paths.
  // Detect by: 3+ shapes sharing a center with different sizes + radial text.
  const radarCandidates = visualNodes.filter((vn) =>
    !vn.hasTextDescendant && vn.bbox.w >= 20 && vn.bbox.h >= 20,
  );
  if (radarCandidates.length >= 3) {
    const rcNodes = radarCandidates.map((vn) => vn.node);
    const rcGroups = groupByCenterOnly(rcNodes, POS_TOLERANCE * 3);
    for (const group of rcGroups) {
      if (group.length >= 3) {
        const sizes = group.map((e: any) => {
          const ebb = e.absoluteBoundingBox;
          return ebb ? Math.round(Math.max(ebb.width, ebb.height)) : 0;
        });
        const uniqueSizes = new Set(sizes);
        if (uniqueSizes.size >= 3) {
          // Check for radially arranged text (axis labels around center)
          const groupBB = getGroupBoundingBox(group);
          const cx = groupBB.x + groupBB.width / 2;
          const cy = groupBB.y + groupBB.height / 2;
          const radius = Math.max(groupBB.width, groupBB.height) / 2;
          const allTexts = findAllNodes(node, (n: any) => n.type === 'TEXT');
          const radialTexts = allTexts.filter((t: any) => {
            const tbb = t.absoluteBoundingBox;
            if (!tbb) return false;
            const tx = tbb.x + tbb.width / 2;
            const ty = tbb.y + tbb.height / 2;
            const dist = Math.sqrt((tx - cx) ** 2 + (ty - cy) ** 2);
            return dist >= radius * 0.4 && dist <= radius * 2;
          });

          const dataOverlays = visualNodes.filter((vn) =>
            vn.fills.length > 0 && vn.bbox.w > 30 && vn.bbox.h > 30
            && !vn.hasTextDescendant,
          );

          // Strong radar signal: concentric shapes + radial text + data overlays
          if (radialTexts.length >= 3) {
            addScore('radar', 10 + group.length + (dataOverlays.length >= 1 ? 3 : 0));
          } else if (group.length >= 4) {
            addScore('radar', 6 + group.length + (dataOverlays.length >= 1 ? 3 : 0));
          }
          break;
        }
      }
    }
  }

  // ── 2. BAR — ANY filled visual node, validated by structural alignment ──
  // Skip bar detection if pie/donut or radar already found — the same shapes
  // can falsely match as aligned bars (pie slices at edges, radar rings as columns).
  const hasRadarScore = (scores['radar'] ?? 0) > 0;
  const barCandidates = (pieType || hasRadarScore) ? [] : visualNodes.filter((vn) => {
    if (vn.fills.length === 0) return false;
    if (vn.hasTextDescendant) return false;
    if (vn.bbox.w < 3 || vn.bbox.h < 3) return false;
    // Exclude small square shapes — data point dots, legend dots, markers
    if (vn.bbox.w <= 12 && vn.bbox.h <= 12) return false;
    return true;
  });
  const barNodes = barCandidates.map((vn) => vn.node);
  if (barNodes.length >= MIN_BAR_RECTS) {
    const bottomGroups = groupByProperty(barNodes, (r: any) => {
      const bb = r.absoluteBoundingBox;
      return bb ? bb.y + bb.height : 0;
    }, POS_TOLERANCE);
    for (const group of bottomGroups) {
      if (group.length >= MIN_BAR_RECTS && isBarLikeGroup(group, 'vertical')) {
        addScore('bar', 5 + group.length + cartesianBoost);
      }
    }
    const leftGroups = groupByProperty(barNodes, (r: any) => {
      return r.absoluteBoundingBox?.x ?? 0;
    }, POS_TOLERANCE);
    for (const group of leftGroups) {
      if (group.length >= MIN_BAR_RECTS && isBarLikeGroup(group, 'horizontal')) {
        addScore('bar', 5 + group.length + cartesianBoost);
      }
    }
  }

  // Strategy B: Structural bar detection (empty FRAMEs without fills).
  // Skip if pie/donut/radar already detected — their shapes falsely match as bars.
  if (!pieType && !hasRadarScore) {
    const structuralBarResult = findStructuralBarGroups(node);
    if (structuralBarResult.detected) {
      addScore('bar', 6 + (structuralBarResult.count ?? 0) + cartesianBoost);
    }
  }

  // ── 3. AREA — ANY node with strokes + gradient fills ────────────────────
  const areaShapes = visualNodes.filter((vn) => {
    if (vn.bbox.h < MIN_SERIES_VECTOR_HEIGHT) return false;
    if (rootSize > 0 && vn.bbox.w < rootSize * 0.15) return false;
    const hasGradient = vn.fills.some((f: any) => f.type === 'GRADIENT_LINEAR' || f.type === 'GRADIENT_RADIAL');
    return vn.strokes.length > 0 && hasGradient;
  });
  if (areaShapes.length > 0) {
    addScore('area', 8 + areaShapes.length + cartesianBoost);
  }

  // Fill-only area shapes (gradient without stroke)
  const fillOnlyAreaShapes = visualNodes.filter((vn) => {
    if (vn.bbox.h < MIN_SERIES_VECTOR_HEIGHT) return false;
    if (rootSize > 0 && vn.bbox.w < rootSize * 0.15) return false;
    const hasGradient = vn.fills.some((f: any) => f.type === 'GRADIENT_LINEAR' || f.type === 'GRADIENT_RADIAL');
    return hasGradient && vn.strokes.length === 0 && vn.bbox.w > vn.bbox.h;
  });
  if (fillOnlyAreaShapes.length > 0) {
    addScore('area', 4 + fillOnlyAreaShapes.length + cartesianBoost);
  }

  // Spatial co-occurrence: gradient fill near a stroked path
  const linePaths = visualNodes.filter((vn) => {
    if (vn.strokes.length === 0) return false;
    if (vn.bbox.w <= vn.bbox.h * 2) return false;
    if (vn.bbox.h < MIN_SERIES_VECTOR_HEIGHT) return false;
    if (rootSize > 0 && vn.bbox.w < rootSize * 0.15) return false;
    return true;
  });
  if (linePaths.length > 0 && fillOnlyAreaShapes.length > 0) {
    for (const lineVN of linePaths) {
      for (const fillVN of fillOnlyAreaShapes) {
        const overlapLeft = Math.max(lineVN.bbox.x, fillVN.bbox.x);
        const overlapRight = Math.min(lineVN.bbox.x + lineVN.bbox.w, fillVN.bbox.x + fillVN.bbox.w);
        const hOverlap = overlapRight - overlapLeft;
        const minW = Math.min(lineVN.bbox.w, fillVN.bbox.w);
        if (minW > 0 && hOverlap / minW >= 0.5) {
          addScore('area', 6 + cartesianBoost);
          break;
        }
      }
    }
  }

  // ── 4. LINE — ANY stroked node, no chromatic fills, landscape ───────────
  const lineShapes = visualNodes.filter((vn) => {
    if (vn.strokes.length === 0) return false;
    // No chromatic solid fills (stroked paths without fill = line)
    const hasChromaticSolid = vn.fills.some((f: any) => f.type === 'SOLID');
    if (hasChromaticSolid) return false;
    if (vn.bbox.w <= vn.bbox.h * 2) return false;
    if (vn.bbox.h < MIN_SERIES_VECTOR_HEIGHT) return false;
    if (rootSize > 0 && vn.bbox.w < rootSize * 0.15) return false;
    return true;
  });
  if (lineShapes.length > 0) {
    addScore('line', 5 + lineShapes.length + cartesianBoost);
  }

  // ── Pick winner ──────────────────────────────────────────────────────────
  let bestType: ChartType = 'unknown';
  let bestScore = 0;
  for (const [type, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestType = type;
    }
  }

  return bestType;
}

// ── Metadata extraction ─────────────────────────────────────────────────────

/**
 * Extract chart metadata by walking the raw Figma tree.
 * Called only after isChartSection() returns true.
 *
 * All lookups use structural patterns — not design-specific names.
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

  // ── Find structural landmarks first (compute once, reuse everywhere) ──
  const legendsFrame = findLegendFrameStructurally(node);
  const switcherFrame = findSwitcherFrameStructurally(node);
  const { xAxisFrame, yAxisFrame } = findAxisFramesStructurally(node);
  const chartAreaFrame = findChartAreaFrame(node, legendsFrame, switcherFrame);

  // Background color — only set when Figma provides it
  let backgroundColor: string | undefined;
  const topFills = node.fills ?? [];
  const topSolid = topFills.find((f: any) => f.type === 'SOLID' && f.color);
  if (topSolid) {
    backgroundColor = figmaColorToHex(topSolid.color);
  } else if (chartAreaFrame) {
    const cf = (chartAreaFrame.fills ?? []).find((f: any) => f.type === 'SOLID' && f.color);
    if (cf) backgroundColor = figmaColorToHex(cf.color);
  }

  // Chart type — LLM decides if available, otherwise structural heuristics
  const chartType = llmProvider
    ? await detectChartTypeWithLLM(node, llmProvider)
    : detectChartType(node);

  // ── Multi-series extraction ──
  let series: SeriesInfo[] = extractSeriesFromLegends(node, legendsFrame, chartAreaFrame);

  // For pie/donut: prefer arc-based extraction over legends when arcs provide more data.
  // Arc data is the source of truth for slice count and proportions.
  if (chartType === 'pie' || chartType === 'donut') {
    const TWO_PI = 2 * Math.PI;
    // Collect ALL ellipses then explicitly filter out hidden ones (visible === false)
    const allEllipses = findAllNodes(node, (n: any) =>
      (n.type === 'ELLIPSE' || n.type === 'ARC') &&
      n.visible !== false &&
      (n.absoluteBoundingBox?.width ?? 0) >= 50,
    );

    // Filter to partial arcs only (skip full-circle backgrounds)
    const sliceEllipses = allEllipses.filter((e: any) => {
      if (!e.arcData) return false;
      const sweep = Math.abs(e.arcData.endingAngle - e.arcData.startingAngle);
      return Math.abs(sweep - TWO_PI) > 0.05; // not a full circle
    });
    // Always prefer arc data for pie/donut — arcs represent the actual visible slices.
    // Legends may have more or fewer items than visible arcs (hidden legend items,
    // sub-categories, etc.). Use legend names only for labeling via color matching.
    if (sliceEllipses.length > 0) {
      if (sliceEllipses.length > 0) {
        // Sort by startingAngle for consistent order
        sliceEllipses.sort((a: any, b: any) =>
          (a.arcData?.startingAngle ?? 0) - (b.arcData?.startingAngle ?? 0),
        );
        // Try to match legend names by color for labelling (fuzzy match)
        const legendByColor = new Map<string, string>();
        for (const s of series) {
          if (s.color) legendByColor.set(s.color.toLowerCase(), s.name);
        }
        series = sliceEllipses.map((e: any, i: number) => {
          const solidFill = (e.fills ?? []).find((f: any) => f.type === 'SOLID' && f.color);
          const color = solidFill ? figmaColorToHex(solidFill.color) : '#000000';
          const sweep = Math.abs(e.arcData.endingAngle - e.arcData.startingAngle);
          const value = Math.round((sweep / TWO_PI) * 100);
          const legendName = fuzzyColorMapGet(legendByColor, color);
          const ellipseName = e.name && e.name !== 'Ellipse' ? e.name : '';
          const name = legendName ?? (ellipseName || `Series ${i + 1}`);
          return { name, color, legendColor: color, value };
        });
      }
    }
  }

  // For radar charts: extract series from colored VECTOR polygon nodes (data shapes).
  // Radar charts have multiple overlaid polygons with different fill/stroke colors.
  // This is more reliable than legend-based extraction for radar charts because
  // some legend items may be hidden in Figma.
  if (chartType === 'radar') {
    // Find VECTOR nodes with chromatic fills (the data polygons, not grid lines)
    // Find VECTOR nodes with chromatic fills that are likely data polygons (not grid lines).
    // Data polygons: larger, have semi-transparent fills, fewer in number.
    // Grid lines: thin stroked lines, often achromatic, repeated in patterns.
    const dataVectors = findVisibleNodes(node, (n: any) => {
      if (n.type !== 'VECTOR') return false;
      const fills = n.fills ?? [];
      const hasChromaticFill = fills.some((f: any) =>
        f.type === 'SOLID' && f.color && isChromatic(f.color) && (f.opacity ?? 1) > 0.05,
      );
      if (!hasChromaticFill) return false;
      // Exclude very thin vectors (grid lines / axis lines)
      const bb = n.absoluteBoundingBox;
      if (!bb) return false;
      const minDim = Math.min(bb.width, bb.height);
      // Grid lines have one tiny dimension; data polygons are more square-ish
      if (minDim < 3) return false;
      return true;
    });
    if (dataVectors.length >= 1) {
      // Deduplicate by color
      const colorMap = new Map<string, any>();
      for (const v of dataVectors) {
        const fill = (v.fills ?? []).find((f: any) => f.type === 'SOLID' && f.color && isChromatic(f.color));
        if (!fill) continue;
        const hex = figmaColorToHex(fill.color);
        if (!colorMap.has(hex)) colorMap.set(hex, v);
      }
      // Also check for VECTOR nodes with chromatic strokes (some polygons use strokes only)
      const strokedVectors = findVisibleNodes(node, (n: any) => {
        if (n.type !== 'VECTOR') return false;
        const bb = n.absoluteBoundingBox;
        if (!bb || Math.min(bb.width, bb.height) < 3) return false;
        return (n.strokes ?? []).some((s: any) =>
          s.type === 'SOLID' && s.color && isChromatic(s.color),
        );
      });
      for (const v of strokedVectors) {
        const stroke = (v.strokes ?? []).find((s: any) => s.type === 'SOLID' && s.color && isChromatic(s.color));
        if (!stroke) continue;
        const hex = figmaColorToHex(stroke.color);
        if (!colorMap.has(hex)) colorMap.set(hex, v);
      }
      if (colorMap.size >= 1) {
        // If legends exist, use legend names; otherwise use Series 1, 2, ...
        const legendNames = series.length > 0 && series[0].name !== 'Chart' ? series.map((s) => s.name) : [];
        const colors = [...colorMap.keys()];
        series = colors.map((color, i) => ({
          name: legendNames[i] ?? `Series ${i + 1}`,
          color,
          legendColor: color,
        }));
      }
    }
  }

  // Axis label color — only set when Figma provides it
  let axisLabelColor: string | undefined;
  const anyAxisFrame = yAxisFrame ?? xAxisFrame;
  if (anyAxisFrame) {
    const textNode = findNodeByType(anyAxisFrame, 'TEXT');
    if (textNode?.fills?.[0]?.color) {
      axisLabelColor = figmaColorToHex(textNode.fills[0].color);
    }
  }

  // X-axis labels — exclude text nodes that belong to the Y-axis frame
  let xAxisLabels = xAxisFrame
    ? collectTextNodes(xAxisFrame)
        .filter((t: any) => !yAxisFrame || !isDescendantOf(t, yAxisFrame))
        .map((t: any) => t.characters ?? t.content ?? '')
        .filter(Boolean)
    : [];

  // Y-axis labels → parse numeric min/max (also check hidden Y-axis frames at root level)
  let yAxisTexts = yAxisFrame
    ? collectTextNodes(yAxisFrame)
        .map((t: any) => t.characters ?? t.content ?? '')
        .filter(Boolean)
    : [];

  // For bar/line/area: if no Y-axis frame found, check hidden sibling frames with numeric labels
  if (yAxisTexts.length === 0 && (chartType === 'bar' || chartType === 'line' || chartType === 'area')) {
    for (const child of node.children ?? []) {
      if (child.visible !== false) continue; // only check hidden siblings
      const texts = collectTextNodes(child)
        .map((t: any) => (t.characters ?? t.content ?? '').trim())
        .filter(Boolean);
      const nums = texts.map((t: string) => parseAxisNumber(t)).filter((n) => !isNaN(n));
      if (nums.length >= 3) {
        yAxisTexts = texts;
        break;
      }
    }
  }

  const yAxisNums = yAxisTexts.map((t: string) => parseAxisNumber(t)).filter((n) => !isNaN(n));
  const yAxisMin = yAxisNums.length > 0 ? Math.min(...yAxisNums) : 0;
  const yAxisMax = yAxisNums.length > 0 ? Math.max(...yAxisNums) : 100;
  const yAxisTicks = yAxisNums.length > 0 ? [...new Set(yAxisNums)].sort((a, b) => a - b) : [];

  // ── Bar chart data extraction: extract labels + values + colors from bar column structure ──
  // Always run for bar charts — even when xAxisLabels exist from axis frames.
  // The bar fills carry the actual colors from Figma (which may differ from legend colors).
  let barSeriesData: Array<{ name: string; value: number; color?: string }> | null = null;
  if (chartType === 'bar') {
    barSeriesData = extractBarChartData(node, yAxisMin, yAxisMax);
    if (barSeriesData && barSeriesData.length > 0) {
      // Only use bar labels if we don't already have axis labels
      if (xAxisLabels.length === 0) {
        xAxisLabels = barSeriesData.map((d) => d.name);
      }
      // Update series color from actual bar fills if available
      // (legend dot color may differ from the actual bar fill color)
      const firstBarColor = barSeriesData.find((d) => d.color)?.color;
      if (firstBarColor && series.length > 0) {
        series[0].color = firstBarColor;
      }
    }

    // Fallback: when extractBarChartData can't match the column structure
    // AND no legend provided a color, extract from bar shapes directly.
    // Only applies when series color came from the single-color fallback
    // (series name is 'Chart'), not from an actual legend extraction.
    if (!barSeriesData && series.length > 0 && series[0].name === 'Chart') {
      const barVNs = collectVisualNodes(node);
      const barLikeShapes = barVNs.filter((vn) => {
        if (vn.fills.length === 0) return false;
        if (vn.bbox.w < 3 || vn.bbox.h < 10) return false;
        if (vn.bbox.h < vn.bbox.w * 0.5) return false;
        return true;
      }).map((vn) => vn.node);

      if (barLikeShapes.length >= 3) {
        const colorCounts = new Map<string, number>();
        for (const shape of barLikeShapes) {
          const fill = (shape.fills ?? []).find((f: any) =>
            f.type === 'SOLID' && f.visible !== false && f.color && isChromatic(f.color));
          if (fill) {
            const hex = figmaColorToHex(fill.color);
            colorCounts.set(hex, (colorCounts.get(hex) ?? 0) + 1);
          }
        }
        let bestColor = '';
        let bestCount = 0;
        for (const [hex, count] of colorCounts) {
          if (count > bestCount) { bestCount = count; bestColor = hex; }
        }
        if (bestColor) {
          series[0].color = bestColor;
        }
      }
    }
  }

  // Data point count
  const dataPointCount = xAxisLabels.length || 12;

  // Period options — from switcher
  let periodOptions: string[] = [];
  let hasSwitcher = false;
  if (switcherFrame) {
    hasSwitcher = true;
    periodOptions = collectTextNodes(switcherFrame)
      .map((t: any) => t.characters ?? t.content ?? '')
      .filter(Boolean);
  }

  // Extract title early so we can use it for component naming
  const textContentStyle = extractChartTextContent(
    node, chartAreaFrame, legendsFrame, switcherFrame, xAxisFrame, yAxisFrame,
  );

  // Component name: prefer chart title, fall back to first series name
  const namingSource = textContentStyle.chartTitle || series[0]?.name || 'Chart';
  const componentName = toPascalCase(namingSource) + 'Chart';
  const bemBase = toKebabCase(componentName);

  // ── Grid line styling ──
  const { gridLineColor, gridStrokeDasharray } = extractGridStyle(node);

  // ── Container styling — only set when Figma provides it ──
  const containerBorderRadius = node.cornerRadius ?? undefined;
  const hasPadding = node.paddingTop != null || node.paddingRight != null || node.paddingBottom != null || node.paddingLeft != null;
  const containerPadding = hasPadding
    ? { top: node.paddingTop ?? 0, right: node.paddingRight ?? 0, bottom: node.paddingBottom ?? 0, left: node.paddingLeft ?? 0 }
    : undefined;

  // ── Chart area height ──
  // If no structural landmarks found (no legend, switcher, axes), use full node height
  const hasNonChartChildren = legendsFrame || switcherFrame || xAxisFrame || yAxisFrame;
  const chartAreaHeight = extractChartAreaHeight(chartAreaFrame, h, !hasNonChartChildren, yAxisFrame);

  // ── Inner radius ratio for donut charts (from visible Figma arcData) ──
  let innerRadiusRatio = 0;
  if (chartType === 'donut') {
    const visibleEllipses = findAllNodes(node, (n: any) =>
      n.type === 'ELLIPSE' && n.visible !== false,
    );
    for (const e of visibleEllipses) {
      if (e.arcData && typeof e.arcData.innerRadius === 'number' && e.arcData.innerRadius > 0) {
        innerRadiusRatio = e.arcData.innerRadius;
        break;
      }
    }
  }

  // ── Center text (TEXT node in the center of the pie/donut/radial ellipses) ──
  let donutCenterText = '';
  let donutCenterFontSize: number | undefined;
  let donutCenterFontWeight: number | undefined;
  let donutCenterColor: string | undefined;
  let centerSubtext = '';
  let centerSubtextFontSize: number | undefined;
  let centerSubtextFontWeight: number | undefined;
  let centerSubtextColor: string | undefined;
  if (chartType === 'donut' || chartType === 'pie' || chartType === 'radial') {
    const visibleEllipses = findAllNodes(node, (n: any) =>
      n.type === 'ELLIPSE' && n.visible !== false && (n.absoluteBoundingBox?.width ?? 0) >= 50,
    );
    if (visibleEllipses.length > 0) {
      const ref = visibleEllipses[0].absoluteBoundingBox;
      const cx = ref.x + ref.width / 2;
      const cy = ref.y + ref.height / 2;
      const radius = Math.max(ref.width, ref.height) / 2;
      const centerTexts = findAllNodes(node, (n: any) => {
        if (n.type !== 'TEXT' || n.visible === false) return false;
        const bb = n.absoluteBoundingBox;
        if (!bb) return false;
        const tcx = bb.x + bb.width / 2;
        const tcy = bb.y + bb.height / 2;
        return Math.abs(tcx - cx) < radius * 0.4 && Math.abs(tcy - cy) < radius * 0.4;
      });
      if (centerTexts.length > 0) {
        centerTexts.sort((a: any, b: any) => (b.style?.fontSize ?? 0) - (a.style?.fontSize ?? 0));
        const ct = centerTexts[0];
        donutCenterText = (ct.characters ?? ct.content ?? '').trim();
        donutCenterFontSize = ct.style?.fontSize;
        donutCenterFontWeight = ct.style?.fontWeight;
        const textFill = (ct.fills ?? []).find((f: any) => f.type === 'SOLID' && f.color);
        if (textFill) donutCenterColor = figmaColorToCss(textFill.color, textFill.opacity);

        if (centerTexts.length > 1) {
          const st = centerTexts[1];
          centerSubtext = (st.characters ?? st.content ?? '').trim();
          centerSubtextFontSize = st.style?.fontSize;
          centerSubtextFontWeight = st.style?.fontWeight;
          const stFill = (st.fills ?? []).find((f: any) => f.type === 'SOLID' && f.color);
          if (stFill) centerSubtextColor = figmaColorToCss(stFill.color, stFill.opacity);
        }
      }
    }
  }

  // ── Pie/donut arc sweep values → derive actual data proportions ──
  // Skip if series already have values (e.g. extracted directly from ellipses)
  const seriesNeedValues = series.some((s) => s.value === undefined);
  if ((chartType === 'pie' || chartType === 'donut') && series.length > 0 && seriesNeedValues) {
    const visibleEllipses = findAllNodes(node, (n: any) =>
      n.type === 'ELLIPSE' && n.visible !== false && (n.absoluteBoundingBox?.width ?? 0) >= 50,
    );
    const TWO_PI = 2 * Math.PI;

    // Extract sweep data from each visible ellipse, sorted by startingAngle
    const slices = visibleEllipses
      .filter((e: any) => e.arcData)
      .map((e: any) => {
        const solidFill = (e.fills ?? []).find((f: any) => f.type === 'SOLID' && f.color);
        const color = solidFill ? figmaColorToCss(solidFill.color, solidFill.opacity) : '';
        const sweep = Math.abs(e.arcData.endingAngle - e.arcData.startingAngle);
        const sweepNorm = sweep < 0 ? sweep + TWO_PI : sweep;
        return { color, value: Math.round((sweepNorm / TWO_PI) * 100), start: e.arcData.startingAngle };
      })
      .sort((a, b) => a.start - b.start);

    // Strategy 1: match by color (legend dot color ≈ slice fill color, fuzzy)
    for (const s of series) {
      const match = slices.find((sl) => colorsMatch(sl.color, s.legendColor));
      if (match) {
        s.value = match.value;
        s.color = match.color; // use the actual slice color from Figma
      }
    }

    // Strategy 2: for unmatched series, assign slices by order
    const unmatchedSeries = series.filter((s) => s.value === undefined);
    const matchedColors = series.filter((s) => s.value !== undefined).map((s) => s.color);
    const unmatchedSlices = slices.filter((sl) => !matchedColors.some((mc) => colorsMatch(mc, sl.color)));

    for (let i = 0; i < unmatchedSeries.length && i < unmatchedSlices.length; i++) {
      unmatchedSeries[i].value = unmatchedSlices[i].value;
      unmatchedSeries[i].color = unmatchedSlices[i].color; // use actual slice color
    }

    // Fallback: if still unmatched, assign equal proportions
    if (series.every((s) => s.value === undefined)) {
      const equalValue = Math.round(100 / series.length);
      for (const s of series) s.value = equalValue;
    }
  }

  // ── Radial chart ring extraction ──
  let rings: ChartMetadata['rings'] = [];
  if (chartType === 'radial') {
    rings = extractRadialRings(node, chartAreaHeight);
  }

  // ── Radar chart axis extraction ──
  let radarAxes: string[] = [];
  if (chartType === 'radar') {
    const excludeFromRadar = new Set([legendsFrame, switcherFrame, xAxisFrame, yAxisFrame].filter(Boolean));
    radarAxes = extractRadarAxes(node, chartAreaFrame, excludeFromRadar);
  }

  // ── Axis font size ──
  const axisFontSize = anyAxisFrame
    ? findNodeByType(anyAxisFrame, 'TEXT')?.style?.fontSize
    : undefined;

  // ── Y-axis width ──
  const yAxisWidth = yAxisFrame?.absoluteBoundingBox?.width
    ? Math.round(yAxisFrame.absoluteBoundingBox.width)
    : undefined;

  // ── Series stroke width ──
  const strokedDataVectors = findAllNodes(node, (n: any) =>
    n.type === 'VECTOR' && (n.strokes ?? []).length > 0 && n.strokeWeight,
  );
  const seriesStrokeWidth = strokedDataVectors.length > 0
    ? strokedDataVectors[0].strokeWeight
    : undefined;

  // ── Dot styling ──
  const { dotRadius, dotStrokeColor, dotStrokeWidth } = extractDotStyle(node);

  // ── Gradient opacity for area charts ──
  const gradientStartOpacity = extractGradientOpacity(node);

  // ── Bar corner radius ──
  const barRadius = extractBarRadius(node);

  // ── Chart margin ──
  const chartMargin = extractChartMargin(chartAreaFrame);

  // ── Legend styling ──
  const legendStyle = extractLegendStyle(legendsFrame, node);

  // ── Switcher styling ──
  const switcherStyle = extractSwitcherStyle(switcherFrame);

  return {
    chartType,
    width: Math.round(w),
    height: Math.round(h),
    series,
    componentName,
    bemBase,
    xAxisLabels,
    yAxisMin,
    yAxisMax,
    yAxisTicks,
    dataPointCount,
    backgroundColor,
    axisLabelColor,
    periodOptions,
    hasSwitcher,
    hasLegend: legendsFrame !== null || (chartType === 'radar' && series.length > 1),

    ...textContentStyle,

    gridLineColor,
    gridStrokeDasharray,
    chartAreaHeight,
    innerRadiusRatio,
    rings,
    donutCenterText,
    donutCenterFontSize,
    donutCenterFontWeight,
    donutCenterColor,
    centerSubtext,
    centerSubtextFontSize,
    centerSubtextFontWeight,
    centerSubtextColor,
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
    barData: barSeriesData ?? null,
    radarAxes,
    chartMargin,
    ...legendStyle,
    ...switcherStyle,
  };
}

// ── Structural finders ──────────────────────────────────────────────────────

/**
 * Find axis frames structurally by analyzing position, layout, and text content.
 * X-axis: horizontal frame near the bottom with short evenly-spaced text labels.
 * Y-axis: vertical frame near the left/right edge with numeric text labels.
 */
function findAxisFramesStructurally(
  node: any,
): { xAxisFrame: any | null; yAxisFrame: any | null } {
  const rootBB = node.absoluteBoundingBox;
  if (!rootBB) return { xAxisFrame: null, yAxisFrame: null };

  const allFrames = findAllNodes(node, (n: any) =>
    (n.type === 'FRAME' || n.type === 'GROUP') && n !== node,
  );

  let xAxisFrame: any = null;
  let yAxisFrame: any = null;
  let bestXScore = 0;
  let bestYScore = 0;

  let bestXArea = Infinity;
  let bestYArea = Infinity;

  for (const frame of allFrames) {
    const frameBB = frame.absoluteBoundingBox;
    if (!frameBB) continue;

    const textNodes = findDirectTextNodes(frame);
    if (textNodes.length < MIN_AXIS_LABELS) continue;

    const frameArea = frameBB.width * frameBB.height;

    // X-axis candidate: bottom 30%, spans width, short text labels
    const frameMidY = frameBB.y + frameBB.height / 2;
    const frameBottomEdge = frameBB.y + frameBB.height;
    const isBottom = frameMidY > rootBB.y + rootBB.height * 0.7
      || frameBottomEdge > rootBB.y + rootBB.height * 0.85;
    const spansWidth = frameBB.width > rootBB.width * 0.4;
    if (isBottom && spansWidth && textNodes.length >= 3) {
      const allShort = textNodes.every((t: any) =>
        (t.characters ?? t.content ?? '').trim().length < 8,
      );
      if (allShort) {
        const score = textNodes.length;
        // Prefer smaller (tighter) frames when scores tie — avoids selecting
        // a large container that also encompasses Y-axis labels.
        if (score > bestXScore || (score === bestXScore && frameArea < bestXArea)) {
          bestXScore = score;
          bestXArea = frameArea;
          xAxisFrame = frame;
        }
      }
    }

    // Fallback: frame spans width but its midpoint isn't at the bottom.
    // Check if its TEXT children are individually positioned at the bottom.
    // This catches tall container frames (e.g. chart+axis wrapper).
    if (!isBottom && spansWidth && textNodes.length >= 3) {
      const bottomTexts = textNodes.filter((t: any) => {
        const tBB = t.absoluteBoundingBox;
        if (!tBB) return false;
        const tMidY = tBB.y + tBB.height / 2;
        return tMidY > rootBB.y + rootBB.height * 0.7;
      });
      if (bottomTexts.length >= 3) {
        const allShort = bottomTexts.every((t: any) =>
          (t.characters ?? t.content ?? '').trim().length < 8,
        );
        if (allShort) {
          const score = bottomTexts.length;
          if (score > bestXScore || (score === bestXScore && frameArea < bestXArea)) {
            bestXScore = score;
            bestXArea = frameArea;
            xAxisFrame = frame;
          }
        }
      }
    }

    // Y-axis candidate: left/right 25%, spans height, narrow, numeric labels
    const isLeftEdge = frameBB.x < rootBB.x + rootBB.width * 0.25;
    const isRightEdge = frameBB.x + frameBB.width > rootBB.x + rootBB.width * 0.75;
    const spansHeight = frameBB.height > rootBB.height * 0.3;
    const isNarrow = frameBB.width < rootBB.width * 0.2; // Y-axis frames are narrow
    if ((isLeftEdge || isRightEdge) && spansHeight && isNarrow) {
      const numericCount = textNodes.filter((t: any) => {
        const text = (t.characters ?? t.content ?? '').trim();
        return /^[\d.,\-$%kKmMbB]+$/.test(text);
      }).length;
      if (numericCount >= MIN_AXIS_LABELS) {
        const score = numericCount;
        if (score > bestYScore || (score === bestYScore && frameArea < bestYArea)) {
          bestYScore = score;
          bestYArea = frameArea;
          yAxisFrame = frame;
        }
      }
    }
  }

  return { xAxisFrame, yAxisFrame };
}

/**
 * Find the legend frame structurally by looking for repeating [dot + text] patterns.
 * A legend frame contains >= 2 child frames, each with a small colored shape and a text label.
 */
function findLegendFrameStructurally(node: any): any | null {
  const candidates = findAllNodes(node, (n: any) =>
    (n.type === 'FRAME' || n.type === 'GROUP') && n !== node,
  );

  let bestFrame: any = null;
  let bestScore = 0;

  // Helper: count legend items in a frame (direct children that have text + dot)
  // Respects visible: false — hidden items are not counted
  const countLegendItems = (frame: any): { matchCount: number; dotColors: Set<string> } => {
    const children = (frame.children ?? []).filter(
      (c: any) => (c.type === 'FRAME' || c.type === 'GROUP' || c.type === 'INSTANCE') && c.visible !== false,
    );
    let matchCount = 0;
    const dotColors = new Set<string>();

    for (const child of children) {
      const textNode = findNodeByType(child, 'TEXT');
      const text = (textNode?.characters ?? textNode?.content ?? '').trim();
      if (!textNode || text.length <= 1) continue;

      const dotNode = findSmallShapeNode(child);
      if (!dotNode) continue;

      const dotFill = findFirstChromaticFill(dotNode);
      if (dotFill) dotColors.add(figmaColorToHex(dotFill.color));
      matchCount++;
    }
    return { matchCount, dotColors };
  };

  for (const candidate of candidates) {
    // Count legend items from direct children
    let { matchCount } = countLegendItems(candidate);

    // Also check if children are rows containing nested legend items.
    // Use whichever approach finds more items.
    const rows = (candidate.children ?? []).filter(
      (c: any) => c.type === 'FRAME' || c.type === 'GROUP',
    );
    let nestedCount = 0;
    for (const row of rows) {
      nestedCount += countLegendItems(row).matchCount;
    }
    if (nestedCount > matchCount) {
      matchCount = nestedCount;
    }

    if (matchCount >= 2 && matchCount > bestScore) {
      bestScore = matchCount;
      bestFrame = candidate;
    }
  }

  return bestFrame;
}

/**
 * Find small shape node (dot) inside a frame — ELLIPSE or RECTANGLE with bbox <= 16x16.
 */
function findSmallShapeNode(node: any): any | null {
  // Property-based: any small visual node (≤16×16)
  const shapes = findAllNodes(node, (n: any) => {
    if (!isVisualNode(n)) return false;
    const bb = n.absoluteBoundingBox;
    if (!bb) return false;
    return bb.width <= 16 && bb.height <= 16;
  });
  return shapes[0] ?? null;
}

/**
 * Recursively find the first chromatic solid fill in a node's subtree.
 * Checks the node itself first, then children depth-first.
 * Used for legend dot colors where the fill may be on a nested VECTOR inside an INSTANCE.
 */
function findFirstChromaticFill(node: any): { color: any; opacity?: number } | null {
  if (!node) return null;
  for (const f of node.fills ?? []) {
    if (f.type === 'SOLID' && f.color && isChromatic(f.color) && f.visible !== false) {
      return { color: f.color, opacity: f.opacity };
    }
  }
  for (const child of node.children ?? []) {
    const found = findFirstChromaticFill(child);
    if (found) return found;
  }
  return null;
}

/**
 * Find the switcher/tab frame structurally by looking for similar-sized
 * child frames with text, where one has a distinct fill (active state).
 */
function findSwitcherFrameStructurally(node: any): any | null {
  const rootBB = node.absoluteBoundingBox;
  const candidates = findAllNodes(node, (n: any) =>
    (n.type === 'FRAME' || n.type === 'GROUP') && n !== node,
  );

  for (const candidate of candidates) {
    const candidateBB = candidate.absoluteBoundingBox;
    // Switchers are typically narrower than the full width
    if (rootBB && candidateBB && candidateBB.width > rootBB.width * 0.9) continue;

    const children = (candidate.children ?? []).filter(
      (c: any) => c.type === 'FRAME' || c.type === 'INSTANCE' || c.type === 'GROUP',
    );
    if (children.length < 2) continue;

    // Each child should have a TEXT node
    const withText = children.filter((c: any) => findNodeByType(c, 'TEXT') !== null);
    if (withText.length < 2) continue;

    // Children should be similar size
    const heights = children.map((c: any) => c.absoluteBoundingBox?.height ?? 0);
    const allSimilarHeight = heights.every((h: number) => Math.abs(h - heights[0]) < 5);
    if (!allSimilarHeight) continue;

    // Check for one child with a distinct fill (active tab)
    let filledCount = 0;
    let unfilledCount = 0;
    for (const child of children) {
      const hasFill = (child.fills ?? []).some(
        (f: any) => f.type === 'SOLID' && f.color && (f.visible !== false),
      );
      if (hasFill) filledCount++;
      else unfilledCount++;
    }

    // Exactly one active (filled) tab among multiple children
    if (filledCount === 1 && unfilledCount >= 1) return candidate;
    // Or the container itself has a fill (track background) with multiple tab children
    const containerHasFill = (candidate.fills ?? []).some(
      (f: any) => f.type === 'SOLID' && f.color,
    );
    if (containerHasFill && children.length >= 2 && (candidate.cornerRadius ?? 0) > 0) {
      return candidate;
    }
  }

  return null;
}

/**
 * Find the main chart data area frame (contains shape/vector elements,
 * is not the legend, switcher, or a text-only frame).
 */
function findChartAreaFrame(
  rootNode: any,
  legendFrame: any | null,
  switcherFrame: any | null,
): any | null {
  const skipSet = new Set([legendFrame, switcherFrame].filter(Boolean));

  const candidates = findAllNodes(rootNode, (n: any) => {
    if (n === rootNode) return false;
    if (skipSet.has(n)) return false;
    if (n.type !== 'FRAME' && n.type !== 'GROUP') return false;
    // Must contain shape nodes
    const hasShapes = findAllNodes(n, (c: any) =>
      ['RECTANGLE', 'VECTOR', 'ELLIPSE', 'LINE', 'BOOLEAN_OPERATION'].includes(c.type),
    ).length > 0;
    return hasShapes;
  });

  // Score candidates: prefer frames that directly contain chart data shapes
  // (not wrapper frames that also contain headings/text above the chart).
  // A good chart area frame has a high ratio of shape area to total area.
  let best: any = null;
  let bestScore = 0;
  for (const f of candidates) {
    // Skip if it is a descendant of legend or switcher
    if (legendFrame && isDescendantOf(f, legendFrame)) continue;
    if (switcherFrame && isDescendantOf(f, switcherFrame)) continue;

    const bb = f.absoluteBoundingBox;
    if (!bb) continue;
    const area = bb.width * bb.height;

    // Count direct chromatic shape children (indicates a data-focused frame).
    // Exclude plain lines/vectors (separators, grid lines) which are decorative.
    const directShapes = (f.children ?? []).filter((c: any) => {
      if (!['RECTANGLE', 'ELLIPSE', 'BOOLEAN_OPERATION'].includes(c.type)) return false;
      return (c.fills ?? []).some((fl: any) => fl.type === 'SOLID' && fl.color && isChromatic(fl.color));
    }).length;
    // Check if this frame is a wrapper/container that holds both
    // non-chart content (headings, text labels) and a chart sub-frame.
    // Wrappers have child frames but no direct shapes — the data shapes
    // are nested deeper. We want the deepest frame that directly contains shapes.
    const fChildren = (f.children ?? []).filter((c: any) => c.visible !== false);
    const hasTextChild = fChildren.some((c: any) =>
      c.type === 'TEXT' || (
        (c.type === 'FRAME' || c.type === 'INSTANCE') &&
        findAllNodes(c, (n: any) => n.type === 'TEXT').length > 0 &&
        findAllNodes(c, (n: any) => ['RECTANGLE', 'ELLIPSE'].includes(n.type)).length === 0
      ),
    );
    const hasChartChild = fChildren.some((c: any) =>
      (c.type === 'FRAME' || c.type === 'GROUP') &&
      findAllNodes(c, (n: any) => {
        if (!['RECTANGLE', 'ELLIPSE', 'VECTOR', 'LINE'].includes(n.type)) return false;
        // Check chromatic fills OR chromatic strokes (chart vectors often use strokes)
        const hasChromaticFill = (n.fills ?? []).some(
          (fl: any) => fl.type === 'SOLID' && fl.color && isChromatic(fl.color),
        );
        const hasChromaticStroke = (n.strokes ?? []).some(
          (s: any) => s.type === 'SOLID' && s.color && isChromatic(s.color),
        );
        return hasChromaticFill || hasChromaticStroke;
      }).length >= 3,
    );
    const isWrapper = hasTextChild && hasChartChild && directShapes === 0;

    // Score: area * bonus for direct shapes, penalize wrappers
    const shapeBonus = directShapes > 0 ? 2 : 1;
    const wrapperPenalty = isWrapper ? 0.1 : 1;
    const score = area * shapeBonus * wrapperPenalty;

    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }

  return best;
}

// ── Text content extraction ─────────────────────────────────────────────────

/** Return type for extractChartTextContent — text content + styling. All styling fields optional. */
interface ChartTextContentResult {
  chartTitle: string;
  chartSubtitle: string;
  summaryAmount: string;
  summaryText: string;
  summaryCtaText: string;
  titleFontSize?: number;
  titleFontWeight?: number;
  titleColor?: string;
  subtitleFontSize?: number;
  subtitleColor?: string;
  summaryBg?: string;
  summaryBorderRadius?: number;
  summaryBorderColor?: string;
  summaryBorderWidth?: number;
  summaryPadding?: string;
  amountFontSize?: number;
  amountFontWeight?: number;
  amountColor?: string;
  summaryTextFontSize?: number;
  summaryTextColor?: string;
  ctaFontSize?: number;
  ctaFontWeight?: number;
  ctaColor?: string;
  ctaBg?: string;
  ctaBorderColor?: string;
  ctaBorderRadius?: number;
  ctaPadding?: string;
}

/**
 * Extract title, subtitle, summary amount, summary text, and CTA from non-chart
 * TEXT nodes — using POSITION and FONT HIERARCHY, not content patterns.
 */
function extractChartTextContent(
  rootNode: any,
  chartAreaFrame: any | null,
  legendsFrame: any,
  switcherFrame: any,
  xAxisFrame: any,
  yAxisFrame: any,
): ChartTextContentResult {
  const result: ChartTextContentResult = {
    chartTitle: '', chartSubtitle: '', summaryAmount: '', summaryText: '', summaryCtaText: '',
  };

  // Build exclusion set: chart data area, axes, legend, switcher
  const excludeFrames = new Set(
    [chartAreaFrame, legendsFrame, switcherFrame, xAxisFrame, yAxisFrame].filter(Boolean),
  );

  // Also exclude frames that directly contain chart data shapes.
  // Walk DOWN to find the DEEPEST frame that still matches — this prevents
  // excluding a parent (e.g. BarLineChart) that contains both chart bars
  // AND summary text. Only the most specific data area is excluded.
  function isDataArea(n: any): boolean {
    if (n.type !== 'FRAME' && n.type !== 'GROUP') return false;
    const directShapes = (n.children ?? []).filter((c: any) =>
      ['RECTANGLE', 'VECTOR', 'ELLIPSE', 'LINE'].includes(c.type) &&
      (c.fills ?? []).some((f: any) => f.type === 'SOLID' && f.color && isChromatic(f.color)),
    ).length;
    if (directShapes >= 3) return true;
    const childFramesWithBars = (n.children ?? []).filter((c: any) => {
      if (c.type !== 'FRAME' && c.type !== 'GROUP') return false;
      return (c.children ?? []).some((gc: any) =>
        gc.type === 'RECTANGLE' && (gc.fills ?? []).some((f: any) =>
          f.type === 'SOLID' && f.color && isChromatic(f.color)));
    }).length;
    return childFramesWithBars >= 3;
  }

  function findDeepestDataArea(n: any): any | null {
    if (n === rootNode && !isDataArea(n)) {
      // Root doesn't match — check children
    } else if (!isDataArea(n)) {
      return null;
    }
    // Check if any child is a deeper match
    for (const child of (n.children ?? [])) {
      if (child.visible === false) continue;
      if (excludeFrames.has(child)) continue;
      const deeper = findDeepestDataArea(child);
      if (deeper) return deeper;
    }
    // No deeper child matches — this is the deepest (or root pass-through)
    return (n !== rootNode && isDataArea(n)) ? n : null;
  }

  // Find deepest data areas starting from root's children
  for (const child of (rootNode.children ?? [])) {
    if (child.visible === false || excludeFrames.has(child)) continue;
    const deepest = findDeepestDataArea(child);
    if (deepest) excludeFrames.add(deepest);
  }

  // Collect visible TEXT nodes NOT inside excluded frames
  const allTextNodes = findVisibleNodes(rootNode, (n: any) => n.type === 'TEXT');
  const outsideTexts = allTextNodes.filter((t: any) => {
    for (const excluded of excludeFrames) {
      if (isDescendantOf(t, excluded)) return false;
    }
    return true;
  });

  // Determine chart area vertical bounds for above/below classification.
  // Use yAxisFrame or xAxisFrame position as more reliable reference than chartAreaFrame,
  // since chartAreaFrame might be a wrapper that includes the heading.
  const yAxisBB = yAxisFrame?.absoluteBoundingBox;
  const xAxisBB = xAxisFrame?.absoluteBoundingBox;
  const chartAreaBB = chartAreaFrame?.absoluteBoundingBox;
  const chartTop = yAxisBB?.y ?? xAxisBB?.y ?? chartAreaBB?.y ?? 0;
  const chartBottom = xAxisBB
    ? xAxisBB.y + xAxisBB.height
    : yAxisBB
      ? yAxisBB.y + yAxisBB.height
      : chartAreaBB
        ? chartAreaBB.y + chartAreaBB.height
        : Infinity;

  // Sort by vertical position
  const sorted = outsideTexts.sort((a: any, b: any) => {
    const ay = a.absoluteBoundingBox?.y ?? 0;
    const by = b.absoluteBoundingBox?.y ?? 0;
    return ay - by;
  });

  // Classify by position relative to chart area + font hierarchy
  const aboveChart: any[] = [];
  const belowChart: any[] = [];

  for (const textNode of sorted) {
    const text = (textNode.characters ?? textNode.content ?? '').trim();
    if (!text || text.length <= 1) continue;

    const textY = textNode.absoluteBoundingBox?.y ?? 0;
    if (textY < chartTop) {
      aboveChart.push(textNode);
    } else if (textY > chartBottom - 10) {
      belowChart.push(textNode);
    }
  }

  // Title: largest/boldest text ABOVE the chart area
  if (aboveChart.length > 0) {
    // Sort by fontSize desc, then fontWeight desc
    const titleCandidates = [...aboveChart].sort((a: any, b: any) => {
      const aSize = a.style?.fontSize ?? 14;
      const bSize = b.style?.fontSize ?? 14;
      if (bSize !== aSize) return bSize - aSize;
      return (b.style?.fontWeight ?? 400) - (a.style?.fontWeight ?? 400);
    });

    const titleNode = titleCandidates[0];
    const titleText = (titleNode.characters ?? titleNode.content ?? '').trim();
    if (titleText.length < 80) {
      result.chartTitle = titleText;
      result.titleFontSize = titleNode.style?.fontSize ?? 18;
      result.titleFontWeight = titleNode.style?.fontWeight ?? 700;
      const fill = titleNode.fills?.[0]?.color;
      if (fill) result.titleColor = figmaColorToHex(fill);
    }

    // Subtitle: next text node below the title, smaller font
    if (titleCandidates.length > 1) {
      const subtitleNode = aboveChart.find((n: any) => n !== titleNode);
      if (subtitleNode) {
        const subtitleText = (subtitleNode.characters ?? subtitleNode.content ?? '').trim();
        if (subtitleText.length >= 3 && subtitleText.length <= 120) {
          result.chartSubtitle = subtitleText;
          result.subtitleFontSize = subtitleNode.style?.fontSize ?? 14;
          const fill = subtitleNode.fills?.[0]?.color;
          if (fill) result.subtitleColor = figmaColorToHex(fill);
        }
      }
    }
  }

  // Below-chart text: classify by font hierarchy + container properties
  let amountTextNode: any = null;
  let ctaTextNode: any = null;

  for (const textNode of belowChart) {
    const text = (textNode.characters ?? textNode.content ?? '').trim();
    const fontSize = textNode.style?.fontSize ?? 14;
    const fontWeight = textNode.style?.fontWeight ?? 400;
    const textColor = textNode.fills?.[0]?.color
      ? figmaColorToHex(textNode.fills[0].color)
      : undefined;

    // Summary amount: largest/boldest below chart
    if ((fontSize >= 20 || fontWeight >= 600) && !result.summaryAmount && text.length < 20) {
      result.summaryAmount = text;
      result.amountFontSize = fontSize;
      result.amountFontWeight = fontWeight;
      if (textColor) result.amountColor = textColor;
      amountTextNode = textNode;
      continue;
    }

    // CTA: text inside a button-like container (parent with cornerRadius + stroke/fill)
    const parentFrame = findParentFrame(rootNode, textNode);
    if (parentFrame && !result.summaryCtaText) {
      const hasRadius = (parentFrame.cornerRadius ?? 0) > 0;
      const hasStroke = (parentFrame.strokes ?? []).length > 0;
      const hasFill = (parentFrame.fills ?? []).some(
        (f: any) => f.type === 'SOLID' && f.color,
      );
      if (hasRadius && (hasStroke || hasFill) && text.length < 80) {
        result.summaryCtaText = text;
        result.ctaFontSize = fontSize;
        result.ctaFontWeight = fontWeight;
        if (textColor) result.ctaColor = textColor;
        ctaTextNode = textNode;
        continue;
      }
    }

    // Summary text: medium-length descriptive text
    if (text.length > 10 && text.length < 200 && !result.summaryText) {
      result.summaryText = text;
      result.summaryTextFontSize = fontSize;
      if (textColor) result.summaryTextColor = textColor;
      continue;
    }

    // Short subtitle (if not already set from above-chart)
    if (!result.chartSubtitle && text.length >= 3 && text.length <= 100) {
      result.chartSubtitle = text;
      result.subtitleFontSize = fontSize;
      if (textColor) result.subtitleColor = textColor;
    }
  }

  // Summary container styling
  if (amountTextNode) {
    const summaryContainer = findParentFrame(rootNode, amountTextNode);
    if (summaryContainer) {
      const fill = (summaryContainer.fills ?? []).find((f: any) => f.type === 'SOLID' && f.color);
      if (fill) result.summaryBg = figmaColorToHex(fill.color);
      if (summaryContainer.cornerRadius !== undefined) result.summaryBorderRadius = summaryContainer.cornerRadius;
      const stroke = (summaryContainer.strokes ?? [])[0];
      if (stroke?.color) result.summaryBorderColor = figmaColorToHex(stroke.color);
      if (summaryContainer.strokeWeight !== undefined) result.summaryBorderWidth = summaryContainer.strokeWeight;
      const sp = formatPadding(summaryContainer);
      if (sp) result.summaryPadding = sp;
    }
  }

  // CTA button styling
  if (ctaTextNode) {
    const ctaContainer = findParentFrame(rootNode, ctaTextNode);
    if (ctaContainer) {
      const fill = (ctaContainer.fills ?? []).find((f: any) => f.type === 'SOLID' && f.color);
      if (fill) result.ctaBg = figmaColorToHex(fill.color);
      const stroke = (ctaContainer.strokes ?? [])[0];
      if (stroke?.color) result.ctaBorderColor = figmaColorToHex(stroke.color);
      if (ctaContainer.cornerRadius !== undefined) result.ctaBorderRadius = ctaContainer.cornerRadius;
      const cp = formatPadding(ctaContainer);
      if (cp) result.ctaPadding = cp;
    }
  }

  return result;
}

// ── Parent frame helpers ────────────────────────────────────────────────────

function findParentFrame(rootNode: any, target: any): any | null {
  if (!rootNode || !target) return null;

  const stack: any[] = [rootNode];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const child of current.children ?? []) {
      if (child === target && (current.type === 'FRAME' || current.type === 'GROUP' || current.type === 'INSTANCE')) {
        return current;
      }
      stack.push(child);
    }
  }

  return findParentFrameRecursive(rootNode, target);
}

function findParentFrameRecursive(node: any, target: any): any | null {
  if (!node) return null;
  for (const child of node.children ?? []) {
    if (child === target) {
      if (node.type === 'FRAME' || node.type === 'GROUP' || node.type === 'INSTANCE') return node;
      return null;
    }
    if (isDescendantOf(target, child)) {
      const childResult = findParentFrameRecursive(child, target);
      if (childResult) return childResult;
      if ((child.type === 'FRAME' || child.type === 'GROUP' || child.type === 'INSTANCE') && isDescendantOf(target, child)) {
        return child;
      }
    }
  }
  return null;
}

function isDescendantOf(node: any, ancestor: any): boolean {
  if (!ancestor || !node) return false;
  if (node === ancestor) return true;
  for (const child of ancestor.children ?? []) {
    if (isDescendantOf(node, child)) return true;
  }
  return false;
}

// ── Series extraction ────────────────────────────────────────────────────────

/**
 * Extract series info from legend items (found structurally).
 * Falls back to scanning data elements if no legends are found.
 */
function extractSeriesFromLegends(
  rootNode: any,
  legendsFrame: any | null,
  _chartAreaFrame: any | null,
): SeriesInfo[] {
  if (legendsFrame) {
    // Find individual legend items: a frame/group that directly contains
    // both a small colored shape (dot) and a TEXT label.
    // Legends may be nested in rows, so we search recursively.
    const legendItems = findAllNodes(legendsFrame, (n: any) => {
      if (n === legendsFrame) return false;
      if (n.visible === false) return false;
      if (n.type !== 'FRAME' && n.type !== 'GROUP' && n.type !== 'INSTANCE') return false;
      const directChildren = n.children ?? [];
      const hasText = directChildren.some((c: any) => c.type === 'TEXT');
      // Property-based: any small visual node as legend dot
      const hasDot = directChildren.some((c: any) => {
        if (!isVisualNode(c)) return false;
        const bb = c.absoluteBoundingBox;
        return bb && bb.width <= 16 && bb.height <= 16;
      });
      return hasText && hasDot;
    });

    if (legendItems.length > 0) {
      const seriesList: SeriesInfo[] = [];

      for (const legendItem of legendItems) {
        const textNode = findNodeByType(legendItem, 'TEXT');
        const text = (textNode?.characters ?? textNode?.content ?? '').trim();
        if (!textNode || text.length <= 1) continue;

        // Property-based: any small visual node as legend dot
        const dotNode = (legendItem.children ?? []).find((c: any) => {
          if (!isVisualNode(c)) return false;
          const bb = c.absoluteBoundingBox;
          return bb && bb.width <= 16 && bb.height <= 16;
        });
        let legendColor = '#000000';
        if (dotNode) {
          const fill = findFirstChromaticFill(dotNode);
          if (fill) legendColor = figmaColorToCss(fill.color, fill.opacity);
        }

        seriesList.push({ name: text, color: legendColor, legendColor });
      }

      if (seriesList.length > 0) {
        return seriesList;
      }
    }

    // Fallback: direct children of legend frame (flat layout), skip hidden
    const legendChildren = (legendsFrame.children ?? []).filter(
      (c: any) => (c.type === 'FRAME' || c.type === 'GROUP' || c.type === 'INSTANCE') && c.visible !== false,
    );

    if (legendChildren.length > 0) {
      const seriesList: SeriesInfo[] = [];

      for (const legendItem of legendChildren) {
        const textNode = findNodeByType(legendItem, 'TEXT');
        const text = (textNode?.characters ?? textNode?.content ?? '').trim();
        if (!textNode || text.length <= 1) continue;

        const dotNode =
          findNodeByType(legendItem, 'ELLIPSE') ??
          findNodeByType(legendItem, 'RECTANGLE') ??
          findNodeByType(legendItem, 'LINE') ??
          findNodeByType(legendItem, 'VECTOR') ??
          findNodeByType(legendItem, 'INSTANCE');
        let legendColor = '#000000';
        if (dotNode) {
          const fill = findFirstChromaticFill(dotNode);
          if (fill) legendColor = figmaColorToCss(fill.color, fill.opacity);
        }

        seriesList.push({ name: text, color: legendColor, legendColor });
      }

      if (seriesList.length > 0) {
        return seriesList;
      }
    }
  }

  // Fallback: detect series from the actual data shapes' visual properties.
  // Group stroked paths by unique stroke color — each color = one series.
  // This handles charts without legends (the shape colors ARE the series data).
  const dataShapes = collectVisualNodes(rootNode);
  const rootBB = rootNode.absoluteBoundingBox;
  const rootMax = rootBB ? Math.max(rootBB.width, rootBB.height) : 0;

  // Find series-like paths: stroked, landscape aspect, meaningful size
  const seriesPaths = dataShapes.filter((vn) =>
    vn.strokes.length > 0
    && vn.bbox.w > vn.bbox.h
    && vn.bbox.h >= MIN_SERIES_VECTOR_HEIGHT
    && (rootMax === 0 || vn.bbox.w >= rootMax * 0.15),
  );

  if (seriesPaths.length > 1) {
    // Group by unique stroke color
    const colorMap = new Map<string, VisualNode>();
    for (const vn of seriesPaths) {
      const stroke = vn.strokes[0];
      if (stroke?.color) {
        const hex = figmaColorToHex(stroke.color);
        if (!colorMap.has(hex)) colorMap.set(hex, vn);
      }
    }
    if (colorMap.size > 1) {
      const series: SeriesInfo[] = [];
      let idx = 0;
      for (const [hex] of colorMap) {
        series.push({ name: `Series ${idx + 1}`, color: hex, legendColor: hex });
        idx++;
      }
      return series;
    }
  }

  // Also check filled shapes (bars, pie slices) by unique fill color
  const filledShapes = dataShapes.filter((vn) =>
    vn.fills.length > 0 && vn.bbox.w >= 3 && vn.bbox.h >= 3 && !vn.hasTextDescendant,
  );
  if (filledShapes.length > 1) {
    const fillColorMap = new Map<string, VisualNode>();
    for (const vn of filledShapes) {
      const fill = vn.fills[0];
      if (fill?.type === 'SOLID' && fill.color) {
        const hex = figmaColorToHex(fill.color);
        if (!fillColorMap.has(hex)) fillColorMap.set(hex, vn);
      }
    }
    if (fillColorMap.size > 1) {
      const series: SeriesInfo[] = [];
      let idx = 0;
      for (const [hex] of fillColorMap) {
        series.push({ name: `Series ${idx + 1}`, color: hex, legendColor: hex });
        idx++;
      }
      return series;
    }
  }

  // Final fallback: single series from any chromatic color found
  const fallbackColor = extractSingleSeriesColor(rootNode);
  return [{ name: 'Chart', color: fallbackColor, legendColor: fallbackColor }];
}

/**
 * Walk deepest into a node tree to find the innermost chromatic fill.
 * Prioritizes RECTANGLE type children (structural type, not name).
 */
function findInnermostFill(node: any, depth = 0): string | null {
  if (!node || depth > 8) return null;

  const children = node.children ?? [];

  // Prioritize RECTANGLE type children (structural — the inner fill element)
  const rectChild = children
    .filter((c: any) => c.type === 'RECTANGLE')
    .sort((a: any, b: any) => {
      const areaA = (a.absoluteBoundingBox?.width ?? 0) * (a.absoluteBoundingBox?.height ?? 0);
      const areaB = (b.absoluteBoundingBox?.width ?? 0) * (b.absoluteBoundingBox?.height ?? 0);
      return areaA - areaB; // smallest first = innermost
    })[0];

  if (rectChild) {
    const fill = (rectChild.fills ?? []).find(
      (f: any) => f.type === 'SOLID' && f.color && isChromatic(f.color),
    );
    if (fill) return figmaColorToHex(fill.color);
  }

  // Recurse into children — deepest fill wins
  for (const child of children) {
    const innerResult = findInnermostFill(child, depth + 1);
    if (innerResult) return innerResult;
  }

  // Check this node
  for (const f of node.fills ?? []) {
    if (f.type === 'SOLID' && f.color && isChromatic(f.color)) {
      return figmaColorToHex(f.color);
    }
  }

  return null;
}

/**
 * Fallback: extract a single series color from data elements.
 */
function extractSingleSeriesColor(rootNode: any): string {
  const dataNodes = findAllNodes(rootNode, (n: any) => {
    const type = n.type ?? '';
    return ['BOOLEAN_OPERATION', 'RECTANGLE', 'VECTOR', 'ELLIPSE'].includes(type);
  });

  for (const dn of dataNodes) {
    if (dn.type === 'BOOLEAN_OPERATION') {
      const inner = findInnermostFill(dn);
      if (inner) return inner;
    }
  }

  for (const dn of dataNodes) {
    for (const f of dn.fills ?? []) {
      if (f.type === 'SOLID' && f.color && isChromatic(f.color)) {
        return figmaColorToHex(f.color);
      }
    }
    for (const s of dn.strokes ?? []) {
      if (s.type === 'SOLID' && s.color && isChromatic(s.color)) {
        return figmaColorToHex(s.color);
      }
    }
  }

  return '#000000'; // only if zero chromatic fills found anywhere in the tree
}

// ── Styling extraction helpers ───────────────────────────────────────────────

/**
 * Extract grid line color and dash pattern structurally.
 * Finds LINE/VECTOR nodes arranged as parallel grid lines (similar length, no chromatic fills).
 */
function extractGridStyle(node: any): { gridLineColor?: string; gridStrokeDasharray?: string } {
  let gridLineColor: string | undefined;
  let gridStrokeDasharray: string | undefined;

  // Find horizontal or vertical LINE/VECTOR nodes with strokes but no chromatic fills
  const lineNodes = findAllNodes(node, (n: any) => {
    const type = n.type;
    if (type !== 'LINE' && type !== 'VECTOR') return false;
    const hasStroke = (n.strokes ?? []).length > 0;
    const hasNoFill = !(n.fills ?? []).some(
      (f: any) => f.type === 'SOLID' && f.color && isChromatic(f.color),
    );
    return hasStroke && hasNoFill;
  });

  // Find group of similar-length lines (grid lines)
  const horizontal = lineNodes.filter((n: any) => {
    const bb = n.absoluteBoundingBox;
    return bb && bb.width > bb.height * 3;
  });

  if (horizontal.length >= MIN_GRID_LINES) {
    const widths = horizontal.map((n: any) => n.absoluteBoundingBox.width);
    const avgWidth = widths.reduce((a: number, b: number) => a + b, 0) / widths.length;
    const similarWidth = widths.every((w: number) => Math.abs(w - avgWidth) / avgWidth < 0.15);

    if (similarWidth) {
      const lineNode = horizontal[0];
      const stroke = (lineNode.strokes ?? [])[0];
      if (stroke?.color) gridLineColor = figmaColorToCss(stroke.color, stroke.opacity);
      if (lineNode.strokeDashes && Array.isArray(lineNode.strokeDashes)) {
        gridStrokeDasharray = lineNode.strokeDashes.length > 0
          ? lineNode.strokeDashes.join(' ')
          : '';
      }
    }
  }

  return { gridLineColor, gridStrokeDasharray };
}

/** Extract chart area height from the chart area frame (found structurally). */
/**
 * Extract concentric ring data for radial charts.
 * Figma structure: pairs of ellipses at each ring size (background track + progress arc).
 * Returns rings sorted outermost-first with colors, progress %, and Recharts radii.
 */
function extractRadialRings(
  node: any,
  chartAreaHeight: number,
): ChartMetadata['rings'] {
  const allEllipses = findAllNodes(node, (n: any) => n.type === 'ELLIPSE' && n.visible !== false);
  if (allEllipses.length === 0) return [];

  // Group ellipses by size (each ring has 2 ellipses of the same size: background + progress)
  const sizeGroups = new Map<number, any[]>();
  for (const e of allEllipses) {
    const w = Math.round(e.absoluteBoundingBox?.width ?? 0);
    if (w === 0) continue;
    const existing = [...sizeGroups.keys()].find((k) => Math.abs(k - w) < SIZE_TOLERANCE);
    const key = existing ?? w;
    if (!sizeGroups.has(key)) sizeGroups.set(key, []);
    sizeGroups.get(key)!.push(e);
  }

  // Sort by size descending (outermost ring first)
  const sortedSizes = [...sizeGroups.keys()].sort((a, b) => b - a);

  const outerRadius = Math.round(chartAreaHeight / 2);
  const rings: ChartMetadata['rings'] = [];

  for (let i = 0; i < sortedSizes.length; i++) {
    const size = sortedSizes[i];
    const group = sizeGroups.get(size) ?? [];

    // Find the progress arc (partial) and background (full circle)
    let progressEllipse: any = null;
    let backgroundEllipse: any = null;
    for (const e of group) {
      if (!e.arcData) continue;
      const sweep = Math.abs(e.arcData.endingAngle - e.arcData.startingAngle);
      const isFull = Math.abs(sweep - 2 * Math.PI) < 0.01;
      if (isFull) {
        backgroundEllipse = e;
      } else {
        progressEllipse = e;
      }
    }

    // Calculate progress percentage from arc sweep
    let progress = 75; // fallback
    if (progressEllipse?.arcData) {
      const sweep = Math.abs(progressEllipse.arcData.endingAngle - progressEllipse.arcData.startingAngle);
      progress = Math.round((sweep / (2 * Math.PI)) * 100);
    }

    // Extract colors from strokes (ring charts use stroke-based rendering)
    const getStrokeColor = (e: any): string => {
      const stroke = (e?.strokes ?? []).find((s: any) => s.type === 'SOLID' && s.color);
      if (stroke) return figmaColorToHex(stroke.color);
      // Fall back to fills
      const fill = (e?.fills ?? []).find((f: any) => f.type === 'SOLID' && f.color);
      if (fill) return figmaColorToHex(fill.color);
      return '#9747ff';
    };

    const progressColor = getStrokeColor(progressEllipse ?? group[0]);
    const trackColor = getStrokeColor(backgroundEllipse ?? group[0]);

    // Compute Recharts radii proportional to Figma sizes
    const scale = outerRadius / (sortedSizes[0] / 2);
    const ringOuter = Math.round((size / 2) * scale);
    // Estimate stroke width from the ellipse (Figma strokeWeight)
    const strokeW = progressEllipse?.strokeWeight ?? backgroundEllipse?.strokeWeight ?? Math.round(size * 0.1);
    const ringInner = Math.max(ringOuter - strokeW, 0);

    // Use parent frame name (e.g. "Ring outer") instead of ellipse name (e.g. "Line")
    const ringEllipse = progressEllipse ?? backgroundEllipse ?? group[0];
    const parentFrame = findParentFrame(node, ringEllipse);
    const ringName = parentFrame?.name ?? ringEllipse?.name ?? `Ring ${i + 1}`;

    rings.push({
      name: ringName,
      color: progressColor,
      trackColor,
      progress,
      innerRadius: ringInner,
      outerRadius: ringOuter,
    });
  }

  return rings;
}

/**
 * Extract radar/spider chart axis labels from TEXT nodes arranged radially around the chart center.
 * Radar charts have labels positioned around a central polygon — the labels are the axis names.
 *
 * Uses the chart area frame (not root) as center reference, and excludes text from
 * known structural frames (legends, switchers, axes) to avoid polluting axis labels
 * with title, subtitle, legend, or summary text.
 */
function extractRadarAxes(
  node: any,
  chartAreaFrame: any | null,
  excludeFrames: Set<any>,
): string[] {
  const rootBB = node.absoluteBoundingBox;
  if (!rootBB) return [];

  // Build set of all node IDs inside excluded frames (legend, switcher, axes)
  const excludedNodeIds = new Set<string>();
  for (const frame of excludeFrames) {
    if (!frame) continue;
    const allInFrame = findAllNodes(frame, () => true);
    for (const n of allInFrame) {
      if (n.id) excludedNodeIds.add(n.id);
    }
  }

  // For radar charts, axis labels sit OUTSIDE the chart area polygon,
  // so we need to find the center from the chart data shapes (vectors/ellipses)
  // rather than using chartAreaFrame which may be too small.
  // Strategy: find the center of the VECTOR/shape cluster in the chart area.
  const searchArea = chartAreaFrame ?? node;
  const shapeNodes = findVisibleNodes(searchArea, (n: any) =>
    ['VECTOR', 'ELLIPSE', 'LINE'].includes(n.type) && n.absoluteBoundingBox,
  );

  let cx: number, cy: number, chartRadius: number;
  if (shapeNodes.length >= 3) {
    // Compute bounding box of all shapes to find chart center
    const allX = shapeNodes.flatMap((n: any) => [n.absoluteBoundingBox.x, n.absoluteBoundingBox.x + n.absoluteBoundingBox.width]);
    const allY = shapeNodes.flatMap((n: any) => [n.absoluteBoundingBox.y, n.absoluteBoundingBox.y + n.absoluteBoundingBox.height]);
    const minX = Math.min(...allX), maxX = Math.max(...allX);
    const minY = Math.min(...allY), maxY = Math.max(...allY);
    cx = (minX + maxX) / 2;
    cy = (minY + maxY) / 2;
    chartRadius = Math.max(maxX - minX, maxY - minY) / 2;
  } else {
    // Fallback to chart area or root center
    const ref = chartAreaFrame?.absoluteBoundingBox ?? rootBB;
    cx = ref.x + ref.width / 2;
    cy = ref.y + ref.height / 2;
    chartRadius = Math.min(ref.width, ref.height) / 2;
  }

  // Collect all visible TEXT nodes from the root, excluding structural frames
  const textNodes = findVisibleNodes(node, (n: any) => {
    if (n.type !== 'TEXT') return false;
    if (n.id && excludedNodeIds.has(n.id)) return false;
    return true;
  });
  if (textNodes.length === 0) return [];

  // Filter to text nodes positioned radially around the chart center
  const radialTexts = textNodes
    .map((t: any) => {
      const bb = t.absoluteBoundingBox;
      if (!bb) return null;
      const tcx = bb.x + bb.width / 2;
      const tcy = bb.y + bb.height / 2;
      const dist = Math.sqrt((tcx - cx) ** 2 + (tcy - cy) ** 2);
      const angle = Math.atan2(tcy - cy, tcx - cx);
      const text = (t.characters ?? t.content ?? '').trim();
      const fontSize = t.style?.fontSize ?? 12;

      // Skip very short or very long labels
      if (text.length < 2 || text.length > 25) return null;
      // Skip numeric-only labels (axis tick values, totals like "9100")
      if (/^[\d.,\-%$kKmMbB\s]+$/.test(text)) return null;
      // Skip labels that look like titles (large font)
      if (fontSize >= 16) return null;
      // Must be near the chart polygon (between 40%–150% of chart radius from center)
      if (dist < chartRadius * 0.4 || dist > chartRadius * 1.5) return null;
      return { text, dist, angle, tcx, tcy, fontSize };
    })
    .filter(Boolean) as Array<{ text: string; dist: number; angle: number; tcx: number; tcy: number; fontSize: number }>;

  if (radialTexts.length < 3) return [];

  // Check radial arrangement: texts should span at least ~180° (not all in a row)
  const angles = radialTexts.map((t) => t.angle);
  const angleRange = Math.max(...angles) - Math.min(...angles);
  if (angleRange < Math.PI * 0.7) return [];

  // Check they are at similar distances from center (axis labels form a ring)
  const dists = radialTexts.map((t) => t.dist);
  const avgDist = dists.reduce((a, b) => a + b, 0) / dists.length;
  // Keep only texts within 50% of average distance (removes outliers like title/summary)
  const filtered = radialTexts.filter((t) => Math.abs(t.dist - avgDist) < avgDist * 0.5);
  if (filtered.length < 3) return [];

  // Sort by angle (clockwise from top: -π/2) for consistent ordering
  filtered.sort((a, b) => {
    const na = ((a.angle + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI));
    const nb = ((b.angle + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI));
    return na - nb;
  });

  return filtered.map((t) => t.text);
}

function extractChartAreaHeight(
  chartAreaFrame: any | null,
  fallbackHeight: number,
  isChartOnly = false,
  yAxisFrame?: any | null,
): number {
  // The Y-axis frame height is the most reliable indicator of chart plot area height
  // because the Y-axis spans exactly the plot area vertically.
  const yAxisHeight = yAxisFrame?.absoluteBoundingBox?.height;
  if (yAxisHeight && yAxisHeight > 50) {
    return Math.round(yAxisHeight);
  }

  if (chartAreaFrame?.absoluteBoundingBox?.height) {
    const h = Math.round(chartAreaFrame.absoluteBoundingBox.height);
    // Guard: chartAreaFrame might be a heading/small frame picked by mistake
    if (h >= 100) return h;
  }
  // If the node is purely chart (no legends, header, axes), use full height
  if (isChartOnly) {
    return Math.round(fallbackHeight);
  }
  return Math.round(fallbackHeight * 0.7);
}

/** Extract dot styling from small ELLIPSE nodes. Only returns values found in Figma. */
function extractDotStyle(node: any): {
  dotRadius?: number;
  dotStrokeColor?: string;
  dotStrokeWidth?: number;
} {
  const ellipses = findAllNodes(node, (n: any) => {
    if (n.type !== 'ELLIPSE') return false;
    const size = n.absoluteBoundingBox?.width ?? n.size?.x ?? 0;
    return size > 0 && size <= 20;
  });

  if (ellipses.length === 0) return {};

  const dot = ellipses[0];
  const size = dot.absoluteBoundingBox?.width ?? dot.size?.x;
  const dotRadius = size ? Math.round(size / 2) : undefined;
  const dotStrokeWidth = dot.strokeWeight ?? undefined;
  const stroke = (dot.strokes ?? [])[0];
  const dotStrokeColor = stroke?.color ? figmaColorToHex(stroke.color) : undefined;

  return { dotRadius, dotStrokeColor, dotStrokeWidth };
}

/** Extract gradient start opacity from GRADIENT_LINEAR fills. Returns undefined if not found. */
function extractGradientOpacity(node: any): number | undefined {
  const gradientNodes = findAllNodes(node, (n: any) =>
    (n.fills ?? []).some((f: any) => f.type === 'GRADIENT_LINEAR'),
  );
  for (const gn of gradientNodes) {
    for (const fill of gn.fills ?? []) {
      if (fill.type === 'GRADIENT_LINEAR' && fill.gradientStops?.length > 0) {
        const firstStop = fill.gradientStops[0];
        if (firstStop.color?.a !== undefined) {
          return Math.round(firstStop.color.a * 100) / 100;
        }
      }
    }
  }
  return undefined;
}

/** Extract bar corner radius from RECTANGLE nodes with chromatic fills. Returns undefined if not found. */
function extractBarRadius(node: any): [number, number, number, number] | undefined {
  const rects = findAllNodes(node, (n: any) => {
    if (n.type !== 'RECTANGLE') return false;
    const fills = (n.fills ?? []).filter((f: any) => f.type === 'SOLID' && f.color);
    return fills.length > 0 && isChromatic(fills[0].color);
  });

  if (rects.length > 0) {
    const rect = rects[0];
    if (rect.rectangleCornerRadii) {
      return rect.rectangleCornerRadii as [number, number, number, number];
    }
    if (rect.cornerRadius != null) {
      const r = rect.cornerRadius;
      return [r, r, 0, 0];
    }
  }
  return undefined;
}

/**
 * Parse axis label text to a number, handling suffixes like k, K, M, B.
 * e.g. "100k" → 100000, "50" → 50, "2.5M" → 2500000
 */
function parseAxisNumber(text: string): number {
  const cleaned = text.replace(/[$%,\s]/g, '').trim();
  const match = cleaned.match(/^(-?\d+(?:\.\d+)?)\s*([kKmMbBtT]?)$/);
  if (!match) return Number(cleaned);
  const num = parseFloat(match[1]);
  const suffix = match[2].toLowerCase();
  switch (suffix) {
    case 'k': return num * 1000;
    case 'm': return num * 1000000;
    case 'b': return num * 1000000000;
    case 't': return num * 1000000000000;
    default: return num;
  }
}

/**
 * Extract bar chart data (labels + values) from bar column structures.
 *
 * Detects the common Figma pattern for bar charts:
 *   Parent FRAME (horizontal layout) → child column FRAMEs (vertical layout)
 *     Each column has: FRAME/RECTANGLE "Bar" + TEXT label
 *
 * Returns array of { name, value } where value is derived from bar height
 * relative to the Y-axis scale, or null if the pattern isn't found.
 */
function extractBarChartData(
  node: any, yAxisMin: number, yAxisMax: number,
): Array<{ name: string; value: number; color?: string }> | null {
  // Find the bar chart container: a frame with multiple visible child frames,
  // each containing a rectangle/frame (bar) and a text node (label).
  const barContainers = findAllNodes(node, (n: any) => {
    if (n.type !== 'FRAME' && n.type !== 'GROUP') return false;
    const visibleChildren = (n.children ?? []).filter((c: any) => c.visible !== false);
    if (visibleChildren.length < 3) return false;

    // Check if children look like bar columns: each has a rectangle-ish frame + text
    let columnCount = 0;
    for (const child of visibleChildren) {
      if (child.type !== 'FRAME' && child.type !== 'GROUP') continue;
      const cc = (child.children ?? []).filter((gc: any) => gc.visible !== false);
      const hasBar = cc.some((gc: any) =>
        gc.type === 'RECTANGLE' || (gc.type === 'FRAME' && !gc.children?.length) ||
        (gc.type === 'FRAME' && gc.name?.toLowerCase().includes('bar')),
      );
      const hasLabel = cc.some((gc: any) => gc.type === 'TEXT');
      if (hasBar && hasLabel) columnCount++;
    }

    return columnCount >= 3;
  });

  if (barContainers.length === 0) return null;

  // Pick the largest bar container
  let bestContainer: any = null;
  let bestArea = 0;
  for (const c of barContainers) {
    const bb = c.absoluteBoundingBox;
    if (!bb) continue;
    const area = bb.width * bb.height;
    if (area > bestArea) { bestArea = area; bestContainer = c; }
  }
  if (!bestContainer) return null;

  // Extract data from each bar column
  const result: Array<{ name: string; value: number; color?: string }> = [];
  const containerBB = bestContainer.absoluteBoundingBox;
  if (!containerBB) return null;

  // Filter to visible column frames (skip Y-axis number frames)
  const visibleColumns = (bestContainer.children ?? []).filter((c: any) => {
    if (c.visible === false) return false;
    if (c.type !== 'FRAME' && c.type !== 'GROUP') return false;
    // Must have a TEXT child (the label) to be a bar column
    const cc = (c.children ?? []).filter((gc: any) => gc.visible !== false);
    return cc.some((gc: any) => gc.type === 'TEXT');
  });

  // Helper: find the actual colored bar element within a column.
  // Pattern 1: direct RECTANGLE child with chromatic fill
  // Pattern 2: FRAME "Bar" containing a RECTANGLE with chromatic fill
  function findBarRect(col: any): any | null {
    const cc = (col.children ?? []).filter((gc: any) => gc.visible !== false);
    // Direct rectangle
    const directRect = cc.find((gc: any) =>
      gc.type === 'RECTANGLE' && (gc.fills ?? []).some((f: any) =>
        f.type === 'SOLID' && f.color && isChromatic(f.color)),
    );
    if (directRect) return directRect;
    // Rectangle inside a "Bar" frame or any child frame
    for (const gc of cc) {
      if (gc.type !== 'FRAME') continue;
      const innerRect = (gc.children ?? []).find((igc: any) =>
        igc.type === 'RECTANGLE' && (igc.fills ?? []).some((f: any) =>
          f.type === 'SOLID' && f.color && isChromatic(f.color)),
      );
      if (innerRect) return innerRect;
    }
    return null;
  }

  // Find the max bar slot height (the tallest column's available space for bars)
  let maxBarSlotHeight = 0;
  for (const col of visibleColumns) {
    const colBB = col.absoluteBoundingBox;
    if (!colBB) continue;
    const colChildren = (col.children ?? []).filter((gc: any) => gc.visible !== false);
    const labelNode = colChildren.find((gc: any) => gc.type === 'TEXT');
    const labelHeight = labelNode?.absoluteBoundingBox?.height ?? 15;
    const slotHeight = colBB.height - labelHeight;
    if (slotHeight > maxBarSlotHeight) maxBarSlotHeight = slotHeight;
  }

  if (maxBarSlotHeight <= 0) return null;

  for (const col of visibleColumns) {
    const colChildren = (col.children ?? []).filter((gc: any) => gc.visible !== false);
    const labelNode = colChildren.find((gc: any) => gc.type === 'TEXT');
    const barRect = findBarRect(col);

    if (!labelNode || !barRect) continue;

    const label = (labelNode.characters ?? labelNode.content ?? '').trim();
    if (!label) continue;

    const barBB = barRect.absoluteBoundingBox;
    if (!barBB) continue;

    // Value is proportional: barRectHeight / maxSlotHeight * yAxisRange
    const barHeight = barBB.height;
    const proportion = barHeight / maxBarSlotHeight;
    const value = Math.round(yAxisMin + proportion * (yAxisMax - yAxisMin));

    // Extract bar color
    const solidFill = (barRect.fills ?? []).find((f: any) => f.type === 'SOLID' && f.color);
    const color = solidFill ? figmaColorToHex(solidFill.color) : undefined;

    result.push({ name: label, value, color });
  }

  return result.length > 0 ? result : null;
}

/** Extract chart margin from the chart area frame's auto-layout padding. Returns undefined if no padding found. */
function extractChartMargin(chartAreaFrame: any | null): { top: number; right: number; bottom: number; left: number } | undefined {
  if (!chartAreaFrame) return undefined;
  const top = chartAreaFrame.paddingTop;
  const right = chartAreaFrame.paddingRight;
  const bottom = chartAreaFrame.paddingBottom;
  const left = chartAreaFrame.paddingLeft;
  if (top == null && right == null && bottom == null && left == null) return undefined;
  return { top: top ?? 0, right: right ?? 0, bottom: bottom ?? 0, left: left ?? 0 };
}

/** Extract legend styling from the structurally-found legends frame. Only returns Figma-extracted values. */
function extractLegendStyle(legendsFrame: any, rootNode: any): {
  legendGap?: number;
  legendItemGap?: number;
  legendDotSize?: number;
  legendDotBorderRadius?: string;
  legendDotOpacity?: number;
  legendLabelFontSize?: number;
  legendLabelColor?: string;
  legendMarginBottom?: number;
} {
  if (!legendsFrame) return {};

  const legendGap = legendsFrame.itemSpacing ?? undefined;

  const legendItem = (legendsFrame.children ?? []).find(
    (c: any) => c.type === 'FRAME' || c.type === 'GROUP' || c.type === 'INSTANCE',
  );
  const legendItemGap = legendItem?.itemSpacing ?? undefined;

  let legendDotSize: number | undefined;
  let legendDotBorderRadius: string | undefined;
  let legendDotOpacity: number | undefined;

  if (legendItem) {
    // Use findSmallShapeNode FIRST — it has a ≤16×16 size constraint that prevents
    // picking up large mask rectangles or other non-dot shapes from component internals.
    // Fall back to findNodeByType only for standard ELLIPSE/RECTANGLE dots with size validation.
    let dotNode = findSmallShapeNode(legendItem);
    if (!dotNode) {
      const ellipse = findNodeByType(legendItem, 'ELLIPSE');
      const rect = findNodeByType(legendItem, 'RECTANGLE');
      // Only accept ELLIPSE/RECTANGLE if reasonably small (≤ 24px) — avoids mask/bg shapes
      for (const candidate of [ellipse, rect].filter(Boolean)) {
        const cw = candidate.absoluteBoundingBox?.width ?? 0;
        const ch = candidate.absoluteBoundingBox?.height ?? 0;
        if (cw > 0 && cw <= 24 && ch > 0 && ch <= 24) {
          dotNode = candidate;
          break;
        }
      }
    }
    if (dotNode) {
      const dotW = dotNode.absoluteBoundingBox?.width ?? dotNode.size?.x;
      if (dotW) legendDotSize = Math.round(dotW);
      legendDotBorderRadius =
        dotNode.type === 'ELLIPSE' || dotNode.type === 'VECTOR' || dotNode.type === 'INSTANCE'
          ? '50%'
          : dotNode.cornerRadius != null ? `${dotNode.cornerRadius}px` : undefined;
      const chromaticFill = findFirstChromaticFill(dotNode);
      if (chromaticFill?.opacity !== undefined) {
        legendDotOpacity = Math.round(chromaticFill.opacity * 100) / 100;
      } else if (dotNode.opacity !== undefined) {
        legendDotOpacity = Math.round(dotNode.opacity * 100) / 100;
      }
    }
  }

  let legendLabelFontSize: number | undefined;
  let legendLabelColor: string | undefined;

  const legendText = findNodeByType(legendsFrame, 'TEXT');
  if (legendText) {
    if (legendText.style?.fontSize) legendLabelFontSize = legendText.style.fontSize;
    const fill = (legendText.fills ?? [])[0];
    if (fill?.color) legendLabelColor = figmaColorToHex(fill.color);
  }

  const legendMarginBottom = rootNode.itemSpacing ?? undefined;

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

/** Extract switcher/tab styling from the structurally-found switcher frame. Only returns Figma-extracted values. */
function extractSwitcherStyle(switcherFrame: any): {
  switcherBg?: string;
  switcherBorderRadius?: number;
  switcherPadding?: string;
  switcherMarginTop?: number;
  switcherButtonPadding?: string;
  switcherButtonFontSize?: number;
  switcherButtonColor?: string;
  switcherButtonBorderRadius?: number;
  switcherActiveBg?: string;
  switcherActiveColor?: string;
  switcherActiveFontWeight?: number;
  switcherActiveBoxShadow?: string;
} {
  if (!switcherFrame) return {};

  const containerFill = (switcherFrame.fills ?? []).find(
    (f: any) => f.type === 'SOLID' && f.color,
  );
  const switcherBg = containerFill ? figmaColorToHex(containerFill.color) : undefined;
  const switcherBorderRadius = switcherFrame.cornerRadius ?? undefined;
  const switcherPadding = formatPadding(switcherFrame);

  const children = (switcherFrame.children ?? []).filter(
    (c: any) => c.type === 'FRAME' || c.type === 'INSTANCE' || c.type === 'GROUP',
  );

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

  if (!activeChild && children.length > 0) activeChild = children[0];
  if (!inactiveChild && children.length > 1) inactiveChild = children[1];

  const buttonChild = activeChild ?? inactiveChild;
  const switcherButtonPadding = buttonChild ? formatPadding(buttonChild) : undefined;
  const switcherButtonBorderRadius = buttonChild?.cornerRadius ?? undefined;

  let switcherButtonFontSize: number | undefined;
  let switcherButtonColor: string | undefined;
  let switcherActiveBg: string | undefined;
  let switcherActiveColor: string | undefined;
  let switcherActiveFontWeight: number | undefined;

  if (inactiveChild) {
    const inactiveText = findNodeByType(inactiveChild, 'TEXT');
    if (inactiveText) {
      switcherButtonFontSize = inactiveText.style?.fontSize;
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
        switcherButtonFontSize = activeText.style?.fontSize;
      }
      const fill = (activeText.fills ?? [])[0];
      if (fill?.color) switcherActiveColor = figmaColorToHex(fill.color);
      switcherActiveFontWeight = activeText.style?.fontWeight;
    }
  }

  const switcherActiveBoxShadow = extractBoxShadow(activeChild) ?? undefined;

  return {
    switcherBg,
    switcherBorderRadius,
    switcherPadding,
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

/** Format padding from Figma auto-layout properties into CSS string. Returns undefined if no padding found. */
function formatPadding(node: any): string | undefined {
  const top = node.paddingTop;
  const right = node.paddingRight;
  const bottom = node.paddingBottom;
  const left = node.paddingLeft;

  if (top === undefined && right === undefined && bottom === undefined && left === undefined) {
    return undefined;
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
  // Structural detection is most reliable for arc-based charts (pie/donut/radial)
  // because it uses arcData.innerRadius which the LLM summary lacks.
  // For those, trust the structural detector (which now has proper size filtering).
  const structuralResult = detectChartType(node);
  if (structuralResult === 'pie' || structuralResult === 'donut' || structuralResult === 'radial') {
    return structuralResult;
  }
  // If the structural detector already has a strong non-unknown answer for
  // cartesian types (line/area/bar), still pass through to LLM for validation,
  // but use structuralResult as the fallback.

  // For ALL other chart types, use the LLM as primary detector.
  // This makes the pipeline generic — the LLM can identify radar, scatter, funnel,
  // treemap, or any other chart type from the Figma structure.
  const summary = buildNodeSummary(node);

  const systemPrompt = `You are a design analysis expert. Given a Figma layer tree, identify the chart/graph type.

Respond with ONLY a JSON object — no markdown, no explanation:
{"chartType": "<type>"}

Chart type values (use exactly these strings):
- "line"       — data shown as connected points/lines
- "area"       — like line but with filled region beneath
- "bar"        — vertical or horizontal bars/columns
- "pie"        — circular segments (full circle, no hole)
- "donut"      — circular segments with hollow center
- "radial"     — concentric rings/progress bars
- "radar"      — spider/web chart with data plotted on radial axes from a center point (look for: polygon shapes, hexagonal/pentagonal grid lines, axis labels arranged in a circle)
- "scatter"    — dots/points plotted on X-Y axes without connecting lines
- "funnel"     — progressively narrowing horizontal sections (widest at top, narrowest at bottom)
- "treemap"    — nested rectangles filling the entire area, sized by value
- "composed"   — multiple chart types overlaid (e.g. bars + lines together)
- "unknown"    — cannot determine

Key structural patterns to look for:
- Radar/spider charts: VECTOR nodes forming polygon shapes (hexagonal, pentagonal, etc.) with text labels arranged radially around a center point. Grid lines form concentric polygon shapes.
- Bar charts: aligned RECTANGLE nodes with chromatic fills, similar width, varying height.
- Line charts: VECTOR nodes with strokes, landscape aspect ratio, no gradient fills.
- Area charts: VECTOR nodes with BOTH strokes AND gradient fills.
- Scatter charts: many small ELLIPSE/RECTANGLE nodes scattered across a 2D area without connections.
- Funnel charts: RECTANGLE/VECTOR nodes decreasing in width from top to bottom.
- Treemap charts: many adjacent RECTANGLEs filling the container with different colors.

Analyze the node types (VECTOR, RECTANGLE, ELLIPSE, LINE), their sizes, positions, fills, strokes, and spatial arrangement.
Do NOT rely on layer names — focus on structural properties.`;

  const userPrompt = `Figma layer tree:\n\n${summary}\n\nWhat type of chart is this?`;

  try {
    const response = await llmProvider.generate(userPrompt, systemPrompt);
    const jsonMatch = response.match(/\{[\s\S]*?"chartType"\s*:\s*"([^"]+)"[\s\S]*?\}/);
    if (jsonMatch) {
      const chartType = jsonMatch[1];
      // Accept any non-empty chart type from the LLM
      if (chartType && chartType !== 'unknown') {
        // For "composed", prefer the structural result if it's specific (bar/line/area).
        // The structural detector is more reliable at distinguishing individual chart types.
        if (chartType === 'composed' && structuralResult !== 'unknown') {
          return structuralResult;
        }
        return chartType;
      }
    }
  } catch {
    // fall through to structural detection
  }

  // Fallback to structural heuristics if LLM fails or returns unknown
  return structuralResult;
}

/**
 * Build a compact text summary of the Figma node tree for the LLM prompt.
 * Includes structural properties (types, sizes, fills, strokes) — not just names.
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

  const pos = node.absoluteBoundingBox
    ? ` @(${Math.round(node.absoluteBoundingBox.x)},${Math.round(node.absoluteBoundingBox.y)})`
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
  const layout = node.layoutMode ? ` layout:${node.layoutMode}` : '';
  const radius = node.cornerRadius ? ` radius:${node.cornerRadius}` : '';
  const arcInfo = node.arcData ? ` arc:${node.arcData.startingAngle.toFixed(2)}→${node.arcData.endingAngle.toFixed(2)}` : '';
  const strokeW = node.strokeWeight ? ` strokeW:${node.strokeWeight}` : '';
  const visible = node.visible === false ? ' HIDDEN' : '';
  const attrs = [fills, strokes].filter(Boolean).join(' | ');

  let line = `${indent}${type} "${name}"${size}${pos}${text}${layout}${radius}${arcInfo}${strokeW}${visible}${attrs ? ` [${attrs}]` : ''}`;

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

/** Like findAllNodes but skips hidden subtrees (visible: false). */
function findVisibleNodes(node: any, predicate: (n: any) => boolean): any[] {
  const results: any[] = [];
  if (!node) return results;
  if (node.visible === false) return results;
  if (predicate(node)) results.push(node);
  for (const child of node.children ?? []) {
    results.push(...findVisibleNodes(child, predicate));
  }
  return results;
}

function collectTextNodes(node: any): any[] {
  return findAllNodes(node, (n) => n.type === 'TEXT');
}

/** Find direct TEXT children (not deeply nested) — up to 2 levels deep. */
function findDirectTextNodes(node: any, depth = 0): any[] {
  if (!node || depth > 2) return [];
  const results: any[] = [];
  for (const child of node.children ?? []) {
    if (child.type === 'TEXT') results.push(child);
    else results.push(...findDirectTextNodes(child, depth + 1));
  }
  return results;
}

/**
 * Group nodes by their bounding-box center point and size.
 * Returns arrays of nodes that share the same center and size within tolerance.
 */
function groupByCenterOnly(nodes: any[], posTolerance: number): any[][] {
  const groups: any[][] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < nodes.length; i++) {
    if (assigned.has(i)) continue;
    const bb1 = nodes[i].absoluteBoundingBox;
    if (!bb1) continue;

    const group = [nodes[i]];
    assigned.add(i);
    const cx1 = bb1.x + bb1.width / 2;
    const cy1 = bb1.y + bb1.height / 2;

    for (let j = i + 1; j < nodes.length; j++) {
      if (assigned.has(j)) continue;
      const bb2 = nodes[j].absoluteBoundingBox;
      if (!bb2) continue;
      const cx2 = bb2.x + bb2.width / 2;
      const cy2 = bb2.y + bb2.height / 2;
      if (Math.abs(cx1 - cx2) < posTolerance && Math.abs(cy1 - cy2) < posTolerance) {
        group.push(nodes[j]);
        assigned.add(j);
      }
    }

    groups.push(group);
  }

  return groups;
}

function groupByCenter(nodes: any[], posTolerance: number, sizeTolerance: number): any[][] {
  const groups: any[][] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < nodes.length; i++) {
    if (assigned.has(i)) continue;
    const bb1 = nodes[i].absoluteBoundingBox;
    if (!bb1) continue;

    const group = [nodes[i]];
    assigned.add(i);
    const cx1 = bb1.x + bb1.width / 2;
    const cy1 = bb1.y + bb1.height / 2;

    for (let j = i + 1; j < nodes.length; j++) {
      if (assigned.has(j)) continue;
      const bb2 = nodes[j].absoluteBoundingBox;
      if (!bb2) continue;
      const cx2 = bb2.x + bb2.width / 2;
      const cy2 = bb2.y + bb2.height / 2;
      const sameCenter = Math.abs(cx1 - cx2) < posTolerance && Math.abs(cy1 - cy2) < posTolerance;
      const sameSize = Math.abs(bb1.width - bb2.width) < sizeTolerance
        && Math.abs(bb1.height - bb2.height) < sizeTolerance;
      if (sameCenter && sameSize) {
        group.push(nodes[j]);
        assigned.add(j);
      }
    }

    groups.push(group);
  }

  return groups;
}

/**
 * Group nodes by a numeric property value within tolerance.
 */
function groupByProperty(nodes: any[], propFn: (n: any) => number, tolerance: number): any[][] {
  const groups: any[][] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < nodes.length; i++) {
    if (assigned.has(i)) continue;
    const val1 = propFn(nodes[i]);
    const group = [nodes[i]];
    assigned.add(i);

    for (let j = i + 1; j < nodes.length; j++) {
      if (assigned.has(j)) continue;
      const val2 = propFn(nodes[j]);
      if (Math.abs(val1 - val2) < tolerance) {
        group.push(nodes[j]);
        assigned.add(j);
      }
    }

    groups.push(group);
  }

  return groups;
}

/**
 * Structural bar detection using two strategies:
 *
 * 1. Sibling detection: parent nodes whose children form bar-like groups
 *    (same width + varying height, or same height + varying width).
 *
 * 2. Cross-tree detection: collect ALL small FRAME/BOOLEAN_OPERATION/RECTANGLE
 *    nodes across the tree that share similar width but vary in height
 *    (or similar height, varying width). This catches bars split across
 *    multiple BarGroup/BarBlock parents — common in grouped bar charts.
 *
 * No fills required — catches bars styled via Figma variables/styles.
 */
function findStructuralBarGroups(root: any): ShapeClusterResult {
  const none: ShapeClusterResult = { detected: false, highConfidence: false };
  const _dbg = process.env.CHART_DEBUG ? (msg: string) => console.log(`[structuralBars "${root.name ?? '?'}"] ${msg}`) : () => {};

  // ── Strategy 1: Sibling-based ──
  const candidates: any[][] = [];
  (function walk(node: any) {
    const children = node.children ?? [];
    if (children.length >= MIN_BAR_RECTS) {
      const visual = children.filter((c: any) => {
        const bb = c.absoluteBoundingBox;
        if (!bb || bb.width < 2 || bb.height < 2) return false;
        return c.type !== 'TEXT' && c.type !== 'LINE';
      });

      if (visual.length >= MIN_BAR_RECTS) {
        const widths = visual.map((c: any) => c.absoluteBoundingBox?.width ?? 0);
        const heights = visual.map((c: any) => c.absoluteBoundingBox?.height ?? 0);
        const avgWidth = widths.reduce((a: number, b: number) => a + b, 0) / widths.length;
        const avgHeight = heights.reduce((a: number, b: number) => a + b, 0) / heights.length;
        const allSimilarWidth = widths.every((w: number) => Math.abs(w - avgWidth) < SIZE_TOLERANCE);
        const heightRange = Math.max(...heights) - Math.min(...heights);

        // Bars need meaningful height variation (>10px, matching chromatic bar threshold)
        // and bar-like proportions (narrow relative to tall, not wide card-like elements).
        const rootBB = root.absoluteBoundingBox;
        const rootW = rootBB?.width ?? 0;
        const maxBarWidth = rootW > 0 ? rootW * 0.3 : 120;
        const areBarsNarrow = avgWidth < maxBarWidth;

        if (allSimilarWidth && heightRange > 10 && areBarsNarrow) {
          candidates.push(visual);
        } else {
          const allSimilarHeight = heights.every((h: number) => Math.abs(h - avgHeight) < SIZE_TOLERANCE);
          const widthRange = Math.max(...widths) - Math.min(...widths);
          const maxBarHeight = (rootBB?.height ?? 0) > 0 ? rootBB.height * 0.3 : 120;
          const areBarsShort = avgHeight < maxBarHeight;
          if (allSimilarHeight && widthRange > 10 && areBarsShort) {
            candidates.push(visual);
          }
        }
      }
    }
    for (const child of children) {
      walk(child);
    }
  })(root);

  // Filter out UI container groups (nav items, cards) where >= 50% of candidates contain TEXT
  const validCandidates = candidates.filter((group) => {
    const withText = group.filter((r: any) =>
      findAllNodes(r, (n: any) => n.type === 'TEXT').length > 0,
    ).length;
    return withText < group.length * 0.5;
  });

  _dbg(`Strategy1: ${candidates.length} candidate groups, ${validCandidates.length} after text-filter`);
  for (const group of validCandidates) {
    for (const n of group) {
      const bb = n.absoluteBoundingBox;
      _dbg(`  S1 bar: "${n.name}" type=${n.type} ${bb?.width}x${bb?.height}`);
    }
  }

  if (validCandidates.length > 0) {
    const best = validCandidates.reduce((a, b) => (a.length >= b.length ? a : b));
    _dbg(`Strategy1 → detected, count=${best.length}, highConf=${best.length >= 5}`);
    return { detected: true, highConfidence: best.length >= 5, count: best.length };
  }

  // ── Strategy 2: Cross-tree leaf-node grouping ──
  // Collect all small "bar-shaped" leaf-ish nodes (few or no children),
  // then group by similar width to find vertical bars.
  // Guard: bar candidates must occupy a meaningful area of the container.
  // Tiny icons, legend dots, and button groups are filtered out.
  const rootBB = root.absoluteBoundingBox;
  const rootW = rootBB?.width ?? 0;
  const rootH = rootBB?.height ?? 0;
  const minBarDim = Math.max(Math.min(rootW, rootH) * 0.08, 15); // bars ≥8% of shorter axis or 15px
  const barLeaves: any[] = [];
  (function collectLeaves(node: any) {
    const children = node.children ?? [];
    const bb = node.absoluteBoundingBox;
    if (!bb || bb.width < 2 || bb.height < 1) {
      for (const child of children) collectLeaves(child);
      return;
    }
    // Consider leaf-ish visual nodes (0-3 children, not the root, not huge)
    const isLeafLike = children.length <= 3 && node !== root;
    const isSmallEnough = rootW > 0 ? bb.width < rootW * 0.25 : bb.width < 80;
    const isTallEnough = bb.height >= minBarDim || bb.width >= minBarDim;
    const isVisual = node.type !== 'TEXT' && node.type !== 'LINE';
    if (isLeafLike && isSmallEnough && isTallEnough && isVisual) {
      barLeaves.push(node);
    }
    for (const child of children) {
      collectLeaves(child);
    }
  })(root);

  // Dedup overlapping leaves: if multiple nodes share nearly the same bounding box
  // (stacked layers of one icon), keep only one representative per position.
  const dedupedLeaves: any[] = [];
  for (const leaf of barLeaves) {
    const bb = leaf.absoluteBoundingBox;
    if (!bb) continue;
    const isDuplicate = dedupedLeaves.some((existing: any) => {
      const ebb = existing.absoluteBoundingBox;
      return ebb &&
        Math.abs(bb.x - ebb.x) < POS_TOLERANCE &&
        Math.abs(bb.y - ebb.y) < POS_TOLERANCE &&
        Math.abs(bb.width - ebb.width) < SIZE_TOLERANCE &&
        Math.abs(bb.height - ebb.height) < SIZE_TOLERANCE;
    });
    if (!isDuplicate) dedupedLeaves.push(leaf);
  }
  _dbg(`Strategy2: deduped ${barLeaves.length} → ${dedupedLeaves.length} leaves`);

  if (dedupedLeaves.length >= MIN_BAR_RECTS) {
    // Helper: check that bar candidates share a common edge (like real chart bars).
    // Vertical bars share a bottom-edge y; horizontal bars share a left-edge x.
    // Scattered UI elements (amounts, buttons) at different positions don't qualify.
    const groupIsAligned = (group: any[], axis: 'vertical' | 'horizontal'): boolean => {
      const bbs = group.map((n: any) => n.absoluteBoundingBox);
      if (axis === 'vertical') {
        // Check shared bottom-edge y
        const bottomYs = bbs.map((b: any) => Math.round(b.y + b.height));
        const edgeGroups = new Map<number, number>();
        for (const y of bottomYs) {
          let matched = false;
          for (const [key, count] of edgeGroups) {
            if (Math.abs(y - key) < POS_TOLERANCE) {
              edgeGroups.set(key, count + 1);
              matched = true;
              break;
            }
          }
          if (!matched) edgeGroups.set(y, 1);
        }
        return Math.max(...edgeGroups.values()) >= MIN_BAR_RECTS;
      } else {
        // Check shared left-edge x
        const leftXs = bbs.map((b: any) => Math.round(b.x));
        const edgeGroups = new Map<number, number>();
        for (const x of leftXs) {
          let matched = false;
          for (const [key, count] of edgeGroups) {
            if (Math.abs(x - key) < POS_TOLERANCE) {
              edgeGroups.set(key, count + 1);
              matched = true;
              break;
            }
          }
          if (!matched) edgeGroups.set(x, 1);
        }
        return Math.max(...edgeGroups.values()) >= MIN_BAR_RECTS;
      }
    };

    _dbg(`Strategy2: ${barLeaves.length} leaf candidates → ${dedupedLeaves.length} after dedup (minBarDim=${minBarDim.toFixed(1)})`);
    for (const n of dedupedLeaves.slice(0, 20)) {
      const bb = n.absoluteBoundingBox;
      _dbg(`  S2 leaf: "${n.name}" type=${n.type} ${bb?.width?.toFixed(1)}x${bb?.height?.toFixed(1)} children=${(n.children ?? []).length}`);
    }
    if (dedupedLeaves.length > 20) _dbg(`  ... and ${dedupedLeaves.length - 20} more`);

    // Group by similar width (vertical bars)
    const widthGroups = groupByProperty(dedupedLeaves,
      (n: any) => n.absoluteBoundingBox?.width ?? 0, SIZE_TOLERANCE);
    for (const group of widthGroups) {
      if (group.length >= MIN_BAR_RECTS) {
        const heights = group.map((n: any) => n.absoluteBoundingBox?.height ?? 0);
        const heightRange = Math.max(...heights) - Math.min(...heights);
        // Filter: if >= 50% of bars contain text, it's UI not chart bars
        const textBarCount = group.filter((n: any) =>
          findAllNodes(n, (c: any) => c.type === 'TEXT').length > 0).length;
        const aligned = groupIsAligned(group, 'vertical');
        _dbg(`  S2 widthGroup: count=${group.length} heightRange=${heightRange.toFixed(1)} aligned=${aligned} textBars=${textBarCount}/${group.length}`);
        for (const n of group) {
          const bb = n.absoluteBoundingBox;
          _dbg(`    "${n.name}" type=${n.type} ${bb?.width?.toFixed(1)}x${bb?.height?.toFixed(1)} @(${bb?.x?.toFixed(0)},${bb?.y?.toFixed(0)})`);
        }
        // Bars must be spatially spread along the x-axis (not overlapping at same position)
        const xPositions = group.map((n: any) => n.absoluteBoundingBox?.x ?? 0);
        const xSpread = Math.max(...xPositions) - Math.min(...xPositions);
        const spreadEnough = xSpread > (rootW > 0 ? rootW * 0.1 : 20);
        _dbg(`    xSpread=${xSpread.toFixed(1)} spreadEnough=${spreadEnough}`);
        if (heightRange > 10 && aligned && spreadEnough && textBarCount < group.length * 0.5) {
          _dbg(`  Strategy2 widthGroup → detected, count=${group.length}`);
          return { detected: true, highConfidence: group.length >= 5, count: group.length };
        }
      }
    }
    // Group by similar height (horizontal bars)
    const heightGroups = groupByProperty(dedupedLeaves,
      (n: any) => n.absoluteBoundingBox?.height ?? 0, SIZE_TOLERANCE);
    for (const group of heightGroups) {
      if (group.length >= MIN_BAR_RECTS) {
        const widths = group.map((n: any) => n.absoluteBoundingBox?.width ?? 0);
        const widthRange = Math.max(...widths) - Math.min(...widths);
        const textBarCount2 = group.filter((n: any) =>
          findAllNodes(n, (c: any) => c.type === 'TEXT').length > 0).length;
        const aligned2 = groupIsAligned(group, 'horizontal');
        _dbg(`  S2 heightGroup: count=${group.length} widthRange=${widthRange.toFixed(1)} aligned=${aligned2} textBars=${textBarCount2}/${group.length}`);
        for (const n of group) {
          const bb = n.absoluteBoundingBox;
          _dbg(`    "${n.name}" type=${n.type} ${bb?.width?.toFixed(1)}x${bb?.height?.toFixed(1)} @(${bb?.x?.toFixed(0)},${bb?.y?.toFixed(0)})`);
        }
        // Bars must be spatially spread along the y-axis (not overlapping at same position)
        const yPositions = group.map((n: any) => n.absoluteBoundingBox?.y ?? 0);
        const ySpread = Math.max(...yPositions) - Math.min(...yPositions);
        const spreadEnough2 = ySpread > (rootH > 0 ? rootH * 0.1 : 20);
        _dbg(`    ySpread=${ySpread.toFixed(1)} spreadEnough=${spreadEnough2}`);
        if (widthRange > 10 && aligned2 && spreadEnough2 && textBarCount2 < group.length * 0.5) {
          _dbg(`  Strategy2 heightGroup → detected, count=${group.length}`);
          return { detected: true, highConfidence: group.length >= 5, count: group.length };
        }
      }
    }
  }

  return none;
}

/** Get the combined bounding box of a group of nodes. */
function getGroupBoundingBox(nodes: any[]): { x: number; y: number; width: number; height: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const bb = n.absoluteBoundingBox;
    if (!bb) continue;
    minX = Math.min(minX, bb.x);
    minY = Math.min(minY, bb.y);
    maxX = Math.max(maxX, bb.x + bb.width);
    maxY = Math.max(maxY, bb.y + bb.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Returns true if a Figma color is "chromatic" — NOT black, white, or gray.
 */
function isChromatic(c: any): boolean {
  if (!c) return false;
  const r = c.r ?? 0, g = c.g ?? 0, b = c.b ?? 0;
  const maxDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
  return maxDiff > 0.05;
}

function figmaColorToCss(c: any, paintOpacity?: number): string {
  if (!c) return '#000000';
  const r = Math.round((c.r ?? 0) * 255);
  const g = Math.round((c.g ?? 0) * 255);
  const b = Math.round((c.b ?? 0) * 255);
  const a = paintOpacity ?? c.a ?? 1;
  if (a >= 1) return figmaColorToHex(c);
  return `rgba(${r}, ${g}, ${b}, ${parseFloat(a.toFixed(2))})`;
}

function figmaColorToHex(c: any): string {
  if (!c) return '#000000';
  const toHex = (v: number) => Math.min(255, Math.max(0, Math.round((v ?? 0) * 255)))
    .toString(16)
    .padStart(2, '0');
  return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`;
}

/**
 * Parse a hex color string to RGB components (0–255).
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

/**
 * Fuzzy color match: returns true if two hex colors are perceptually similar.
 * Uses Euclidean distance in RGB space. The threshold is 10% of the max possible
 * distance (√(255²×3) ≈ 441), so ~44 units — enough to match #ddbdfe vs #d8b4fe
 * (distance ≈ 12) while rejecting truly different colors.
 */
function colorsMatch(hex1: string, hex2: string): boolean {
  if (hex1.toLowerCase() === hex2.toLowerCase()) return true;
  const a = hexToRgb(hex1);
  const b = hexToRgb(hex2);
  if (!a || !b) return false;
  const dist = Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
  // 10% of max RGB distance (√(255²×3) ≈ 441)
  return dist < 441 * 0.10;
}

/**
 * Find the closest matching color from a map using fuzzy comparison.
 * Returns the map value for the closest matching key, or undefined if none match.
 */
function fuzzyColorMapGet(map: Map<string, string>, targetColor: string): string | undefined {
  // Try exact match first
  const exact = map.get(targetColor.toLowerCase());
  if (exact) return exact;
  // Fuzzy search
  for (const [mapColor, mapValue] of map) {
    if (colorsMatch(mapColor, targetColor)) return mapValue;
  }
  return undefined;
}

function toPascalCase(str: string): string {
  const result = str
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('')
    .replace(/^[0-9]+/, ''); // JS identifiers can't start with digits
  return result || 'Component';
}

// toKebabCase imported from component-set-parser.ts for consistency
