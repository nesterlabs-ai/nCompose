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

export type ChartType = 'area' | 'line' | 'bar' | 'pie' | 'donut' | 'radial' | 'unknown';

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
  chartType: ChartType;
  width: number;
  height: number;
  /** All chart series (multi-series support) */
  series: SeriesInfo[];
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

  // ── Title/subtitle/summary text extracted from non-chart children ──

  /** Chart section title, e.g. "Earning Potential" */
  chartTitle: string;
  /** Chart section subtitle, e.g. "See how much your money could grow with Banky" */
  chartSubtitle: string;
  /** Summary amount displayed below the chart, e.g. "$1,525" */
  summaryAmount: string;
  /** Summary description text below the amount */
  summaryText: string;
  /** CTA button text, e.g. "Learn how this is calculated here" */
  summaryCtaText: string;

  // ── Title/subtitle styling ──
  titleFontSize: number;
  titleFontWeight: number;
  titleColor: string;
  subtitleFontSize: number;
  subtitleColor: string;

  // ── Summary container styling ──
  summaryBg: string;
  summaryBorderRadius: number;
  summaryBorderColor: string;
  summaryBorderWidth: number;
  summaryPadding: string;

  // ── Amount styling ──
  amountFontSize: number;
  amountFontWeight: number;
  amountColor: string;

  // ── Summary text styling ──
  summaryTextFontSize: number;
  summaryTextColor: string;

  // ── CTA button styling ──
  ctaFontSize: number;
  ctaFontWeight: number;
  ctaColor: string;
  ctaBg: string;
  ctaBorderColor: string;
  ctaBorderRadius: number;
  ctaPadding: string;

  // ── Styling extracted from Figma (no hardcoded values) ──

  /** Grid line color from LINE/VECTOR nodes in grid frames */
  gridLineColor: string;
  /** Grid stroke dash array, e.g. "3 3" or "" for solid */
  gridStrokeDasharray: string;

  /** Chart content area height (excluding legends/switcher) */
  chartAreaHeight: number;

  /** Inner radius ratio for donut charts (0–1, from Figma arcData.innerRadius).
   *  0 = pie (no hole), >0 = donut. Defaults to 0. */
  innerRadiusRatio: number;

  /** Concentric ring data for radial charts. Each ring has a name, color, and progress (0–100). */
  rings: Array<{ name: string; color: string; trackColor: string; progress: number; innerRadius: number; outerRadius: number }>;

  /** Center text inside a donut/radial chart hole, e.g. "9.2K" */
  donutCenterText: string;
  /** Font size of the donut center text */
  donutCenterFontSize: number;
  /** Font weight of the donut center text */
  donutCenterFontWeight: number;
  /** Color of the donut center text */
  donutCenterColor: string;
  /** Secondary center text (subtitle below the main center text), e.g. "Active users" */
  centerSubtext: string;
  /** Font size of the center subtext */
  centerSubtextFontSize: number;
  /** Font weight of the center subtext */
  centerSubtextFontWeight: number;
  /** Color of the center subtext */
  centerSubtextColor: string;

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

// ── Detection ───────────────────────────────────────────────────────────────

/**
 * Returns true if a node looks like a chart/graph section.
 *
 * Uses three independent structural signals — requires at least 2 of 3.
 * For high-confidence single signals (e.g. >= 5 concentric pie ellipses),
 * a single signal suffices.
 *
 * No name-based or keyword-based matching.
 */
export function isChartSection(node: any): boolean {
  if (!node) return false;

  // If the node has multiple children that are each independently chart sections,
  // it's a multi-chart container (e.g. a row of 3 pie charts), not a single chart.
  // Return false so the pipeline routes it to PATH C (multi-section page) or PATH B.
  const children: any[] = node.children ?? [];
  if (children.length >= 2) {
    let chartChildCount = 0;
    for (const child of children) {
      if (child.type === 'FRAME' || child.type === 'GROUP' || child.type === 'INSTANCE') {
        const childSignalA = hasDataShapeCluster(child);
        // Only count high-confidence chart signals to avoid false positives
        // from legend frames (small dots, single decorative vectors, etc.)
        if (childSignalA.detected && childSignalA.highConfidence) chartChildCount++;
      }
      if (chartChildCount >= 2) return false; // multi-chart container, not a single chart
    }
  }

  const signalA = hasDataShapeCluster(node);
  const signalB = hasAxisLikeTextArrangement(node);
  const signalC = hasParallelGridLines(node);

  const signalCount = [signalA.detected, signalB, signalC].filter(Boolean).length;

  // High-confidence single signal: strong pie/donut or bar cluster
  if (signalA.detected && signalA.highConfidence) return true;

  return signalCount >= 2;
}

// ── Signal A: Data shape cluster ────────────────────────────────────────────

interface ShapeClusterResult {
  detected: boolean;
  highConfidence: boolean;
}

export function _debugHasDataShapeCluster(node: any): ShapeClusterResult { return hasDataShapeCluster(node); }
function hasDataShapeCluster(node: any): ShapeClusterResult {
  const none: ShapeClusterResult = { detected: false, highConfidence: false };

  // Check for overlapping ellipses (pie/donut)
  // Include hidden ellipses: Figma charts often have hidden slices as overlays
  const ellipses = findAllNodes(node, (n: any) => n.type === 'ELLIPSE');
  const ellipseGroups = groupByCenter(ellipses, POS_TOLERANCE, SIZE_TOLERANCE);
  for (const group of ellipseGroups) {
    if (group.length >= MIN_PIE_ELLIPSES) {
      const chromaticCount = group.filter((e: any) =>
        (e.fills ?? []).some((f: any) => {
          if (f.type === 'SOLID' && f.color) return isChromatic(f.color);
          if (f.type === 'GRADIENT_LINEAR' || f.type === 'GRADIENT_RADIAL') return true;
          return false;
        }),
      ).length;
      if (chromaticCount >= MIN_PIE_ELLIPSES) {
        return { detected: true, highConfidence: group.length >= 3 };
      }
    }
  }

  // Check for concentric ring charts (same center, different sizes)
  // These are multi-ring progress/donut charts where each ring is a pair of
  // ellipses (background track + progress arc) at different radii.
  const concentricGroups = groupByCenterOnly(ellipses, POS_TOLERANCE);
  for (const group of concentricGroups) {
    if (group.length >= 4) { // At least 2 rings (2 ellipses each: background + progress)
      // Check that there are multiple distinct sizes (concentric rings)
      const sizes = group.map((e: any) => Math.round(e.absoluteBoundingBox?.width ?? 0));
      const uniqueSizes = new Set(sizes);
      // Check that some ellipses have partial arcs (progress indicators)
      const hasPartialArcs = group.some((e: any) => {
        if (!e.arcData) return false;
        const sweep = Math.abs(e.arcData.endingAngle - e.arcData.startingAngle);
        return sweep > 0.01 && Math.abs(sweep - 2 * Math.PI) > 0.01;
      });
      if (uniqueSizes.size >= 2 && hasPartialArcs) {
        return { detected: true, highConfidence: group.length >= 6 };
      }
    }
  }

  // Check for aligned bar rectangles
  const rects = findAllNodes(node, (n: any) => {
    if (n.type !== 'RECTANGLE') return false;
    return (n.fills ?? []).some((f: any) => f.type === 'SOLID' && f.color && isChromatic(f.color));
  });
  if (rects.length >= MIN_BAR_RECTS) {
    // Group by shared bottom-edge y (vertical bars)
    const bottomGroups = groupByProperty(rects, (r: any) => {
      const bb = r.absoluteBoundingBox;
      return bb ? bb.y + bb.height : 0;
    }, POS_TOLERANCE);
    for (const group of bottomGroups) {
      if (group.length >= MIN_BAR_RECTS) {
        // Check varying height
        const heights = group.map((r: any) => r.absoluteBoundingBox?.height ?? 0);
        const heightRange = Math.max(...heights) - Math.min(...heights);
        if (heightRange > 10) {
          return { detected: true, highConfidence: group.length >= 5 };
        }
      }
    }
    // Group by shared left-edge x (horizontal bars)
    const leftGroups = groupByProperty(rects, (r: any) => {
      return r.absoluteBoundingBox?.x ?? 0;
    }, POS_TOLERANCE);
    for (const group of leftGroups) {
      if (group.length >= MIN_BAR_RECTS) {
        const widths = group.map((r: any) => r.absoluteBoundingBox?.width ?? 0);
        const widthRange = Math.max(...widths) - Math.min(...widths);
        if (widthRange > 10) {
          return { detected: true, highConfidence: group.length >= 5 };
        }
      }
    }
  }

  // Check for series vectors (line/area charts)
  const seriesVectors = findAllNodes(node, (n: any) => {
    if (n.type !== 'VECTOR') return false;
    const hasStroke = (n.strokes ?? []).length > 0;
    const bb = n.absoluteBoundingBox;
    const isLandscape = bb && bb.width > bb.height * 2;
    return hasStroke && isLandscape;
  });
  if (seriesVectors.length >= 1) {
    return { detected: true, highConfidence: seriesVectors.length >= 2 };
  }

  return none;
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
    const isBottom = frameBB.y + frameBB.height / 2 > rootBB.y + rootBB.height * 0.7;
    const spansWidth = frameBB.width > rootBB.width * 0.4;
    if (isBottom && spansWidth && textChildren.length >= 3) {
      const allShortText = textChildren.every((t: any) =>
        (t.characters ?? t.content ?? '').trim().length < 8,
      );
      if (allShortText) return true;
    }

    // Y-axis: frame in the left 25% or right 25%, texts arranged vertically with numeric content
    const isLeftEdge = frameBB.x < rootBB.x + rootBB.width * 0.25;
    const isRightEdge = frameBB.x + frameBB.width > rootBB.x + rootBB.width * 0.75;
    const spansHeight = frameBB.height > rootBB.height * 0.3;
    if ((isLeftEdge || isRightEdge) && spansHeight && textChildren.length >= MIN_AXIS_LABELS) {
      const numericCount = textChildren.filter((t: any) => {
        const text = (t.characters ?? t.content ?? '').trim();
        return /^[\d.,\-$%kKmMbB]+$/.test(text);
      }).length;
      if (numericCount >= MIN_AXIS_LABELS) return true;
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
 */
export function detectChartType(node: any): ChartType {
  // 1. PIE / DONUT: overlapping same-sized ellipses with different chromatic fills
  // Include hidden ellipses: Figma charts use hidden overlays as arc slices
  const ellipses = findAllNodes(node, (n: any) => n.type === 'ELLIPSE');
  const ellipseGroups = groupByCenter(ellipses, POS_TOLERANCE, SIZE_TOLERANCE);
  for (const group of ellipseGroups) {
    if (group.length >= MIN_PIE_ELLIPSES) {
      const chromaticEllipses = group.filter((e: any) =>
        (e.fills ?? []).some((f: any) => {
          if (f.type === 'SOLID' && f.color) return isChromatic(f.color);
          if (f.type === 'GRADIENT_LINEAR' || f.type === 'GRADIENT_RADIAL') return true;
          return false;
        }),
      );
      if (chromaticEllipses.length >= MIN_PIE_ELLIPSES) {
        // Determine donut vs pie using ONLY visible structural signals.
        // Hidden nodes (visible: false) are excluded — they don't contribute
        // to what the user sees in the Figma design.

        const visibleGroup = group.filter((e: any) => e.visible !== false);

        // Signal 1 (primary): arcData.innerRadius > 0 on any VISIBLE ellipse.
        // Figma sets innerRadius as a 0–1 ratio; > 0 means the slice has a hole.
        const visibleWithInnerRadius = visibleGroup.filter((e: any) =>
          e.arcData && typeof e.arcData.innerRadius === 'number' && e.arcData.innerRadius > 0,
        );
        if (visibleWithInnerRadius.length > 0) return 'donut';

        // Signal 2: a VISIBLE smaller element centered within the group
        // (e.g. a center label like "90.1%", or a white circle creating the hole).
        const groupBB = getGroupBoundingBox(group);
        const groupCenterX = groupBB.x + groupBB.width / 2;
        const groupCenterY = groupBB.y + groupBB.height / 2;
        const groupSize = Math.max(groupBB.width, groupBB.height);

        const visibleInnerElements = findAllNodes(node, (n: any) => {
          if (group.includes(n)) return false;
          if (n.visible === false) return false;
          const bb = n.absoluteBoundingBox;
          if (!bb) return false;
          const nCenterX = bb.x + bb.width / 2;
          const nCenterY = bb.y + bb.height / 2;
          const isNearCenter = Math.abs(nCenterX - groupCenterX) < groupSize * 0.3
            && Math.abs(nCenterY - groupCenterY) < groupSize * 0.3;
          const isSmaller = bb.width < groupSize * 0.6 && bb.height < groupSize * 0.6;
          return isNearCenter && isSmaller;
        });
        if (visibleInnerElements.length > 0) return 'donut';

        // No donut signals found — it's a pie chart.
        // Note: partial arcs + gradients are NOT donut indicators.
        // Both pie and donut charts use partial arc slices in Figma,
        // and gradients are just shading effects on slices.
        return 'pie';
      }
    }
  }

  // 1b. RADIAL: concentric ring chart (same center, different sizes, partial arcs)
  const concentricGroups = groupByCenterOnly(ellipses, POS_TOLERANCE);
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
        return 'radial';
      }
    }
  }

  // 2. BAR: aligned rectangles with chromatic fills, similar width, varying height
  const rects = findAllNodes(node, (n: any) => {
    if (n.type !== 'RECTANGLE') return false;
    return (n.fills ?? []).some((f: any) => f.type === 'SOLID' && f.color && isChromatic(f.color));
  });
  if (rects.length >= MIN_BAR_RECTS) {
    const bottomGroups = groupByProperty(rects, (r: any) => {
      const bb = r.absoluteBoundingBox;
      return bb ? bb.y + bb.height : 0;
    }, POS_TOLERANCE);
    for (const group of bottomGroups) {
      if (group.length >= MIN_BAR_RECTS) {
        const widths = group.map((r: any) => r.absoluteBoundingBox?.width ?? 0);
        const allSimilarWidth = widths.every((w: number) => Math.abs(w - widths[0]) < SIZE_TOLERANCE);
        if (allSimilarWidth) return 'bar';
      }
    }
    // Horizontal bars
    const leftGroups = groupByProperty(rects, (r: any) => {
      return r.absoluteBoundingBox?.x ?? 0;
    }, POS_TOLERANCE);
    for (const group of leftGroups) {
      if (group.length >= MIN_BAR_RECTS) {
        const heights = group.map((r: any) => r.absoluteBoundingBox?.height ?? 0);
        const allSimilarHeight = heights.every((h: number) => Math.abs(h - heights[0]) < SIZE_TOLERANCE);
        if (allSimilarHeight) return 'bar';
      }
    }
  }

  // 3. AREA: vectors with BOTH strokes AND gradient fills
  const areaVectors = findAllNodes(node, (n: any) => {
    if (n.type !== 'VECTOR') return false;
    const hasStroke = (n.strokes ?? []).length > 0;
    const hasGradient = (n.fills ?? []).some((f: any) => f.type === 'GRADIENT_LINEAR');
    return hasStroke && hasGradient;
  });
  if (areaVectors.length > 0) return 'area';

  // 4. LINE: vectors with strokes, no chromatic fills, landscape aspect
  const lineVectors = findAllNodes(node, (n: any) => {
    if (n.type !== 'VECTOR') return false;
    const hasStroke = (n.strokes ?? []).length > 0;
    const noFill = !(n.fills ?? []).some(
      (f: any) => f.type === 'SOLID' && f.color && isChromatic(f.color),
    );
    const bb = n.absoluteBoundingBox;
    const isLandscape = bb && bb.width > bb.height * 2;
    return hasStroke && noFill && isLandscape;
  });
  if (lineVectors.length > 0) return 'line';

  return 'unknown';
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

  // Background color
  let backgroundColor = '#ffffff';
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

  // Fallback for pie/donut with no legends: extract series directly from visible arc ellipses.
  // Triggers when series is just the generic 1-item fallback (no real legend found).
  const isGenericFallback = series.length === 1 && series[0].name === 'Chart';
  if ((series.length === 0 || isGenericFallback) && (chartType === 'pie' || chartType === 'donut')) {
    const TWO_PI = 2 * Math.PI;
    const visibleEllipses = findVisibleNodes(node, (n: any) =>
      n.type === 'ELLIPSE' && (n.absoluteBoundingBox?.width ?? 0) >= 50,
    );
    // Filter to partial arcs only (skip full-circle backgrounds)
    const sliceEllipses = visibleEllipses.filter((e: any) => {
      if (!e.arcData) return false;
      const sweep = Math.abs(e.arcData.endingAngle - e.arcData.startingAngle);
      return Math.abs(sweep - TWO_PI) > 0.05; // not a full circle
    });
    if (sliceEllipses.length > 0) {
      // Sort by startingAngle for consistent order
      sliceEllipses.sort((a: any, b: any) =>
        (a.arcData?.startingAngle ?? 0) - (b.arcData?.startingAngle ?? 0),
      );
      series = sliceEllipses.map((e: any, i: number) => {
        const solidFill = (e.fills ?? []).find((f: any) => f.type === 'SOLID' && f.color);
        const color = solidFill ? figmaColorToHex(solidFill.color) : '#9747ff';
        const sweep = Math.abs(e.arcData.endingAngle - e.arcData.startingAngle);
        const value = Math.round((sweep / TWO_PI) * 100);
        const name = e.name && e.name !== 'Ellipse' ? e.name : `Series ${i + 1}`;
        return { name, color, legendColor: color, value };
      });
    }
  }

  // Axis label color
  let axisLabelColor = '#A1A1A1';
  const anyAxisFrame = yAxisFrame ?? xAxisFrame;
  if (anyAxisFrame) {
    const textNode = findNodeByType(anyAxisFrame, 'TEXT');
    if (textNode?.fills?.[0]?.color) {
      axisLabelColor = figmaColorToHex(textNode.fills[0].color);
    }
  }

  // X-axis labels
  const xAxisLabels = xAxisFrame
    ? collectTextNodes(xAxisFrame)
        .map((t: any) => t.characters ?? t.content ?? '')
        .filter(Boolean)
    : [];

  // Y-axis labels → parse numeric min/max
  const yAxisTexts = yAxisFrame
    ? collectTextNodes(yAxisFrame)
        .map((t: any) => t.characters ?? t.content ?? '')
        .filter(Boolean)
    : [];
  const yAxisNums = yAxisTexts.map(Number).filter((n) => !isNaN(n));
  const yAxisMin = yAxisNums.length > 0 ? Math.min(...yAxisNums) : 0;
  const yAxisMax = yAxisNums.length > 0 ? Math.max(...yAxisNums) : 100;

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

  // ── Container styling ──
  const containerBorderRadius = node.cornerRadius ?? 0;
  const containerPadding = {
    top: node.paddingTop ?? 0,
    right: node.paddingRight ?? 0,
    bottom: node.paddingBottom ?? 0,
    left: node.paddingLeft ?? 0,
  };

  // ── Chart area height ──
  // If no structural landmarks found (no legend, switcher, axes), use full node height
  const hasNonChartChildren = legendsFrame || switcherFrame || xAxisFrame || yAxisFrame;
  const chartAreaHeight = extractChartAreaHeight(chartAreaFrame, h, !hasNonChartChildren);

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
    // If no visible ellipse has innerRadius, use default donut ratio
    if (innerRadiusRatio === 0) {
      innerRadiusRatio = 0.6;
    }
  }

  // ── Center text (TEXT node in the center of the pie/donut/radial ellipses) ──
  let donutCenterText = '';
  let donutCenterFontSize = 24;
  let donutCenterFontWeight = 600;
  let donutCenterColor = '#101828';
  let centerSubtext = '';
  let centerSubtextFontSize = 14;
  let centerSubtextFontWeight = 400;
  let centerSubtextColor = '#667085';
  if (chartType === 'donut' || chartType === 'pie' || chartType === 'radial') {
    const visibleEllipses = findAllNodes(node, (n: any) =>
      n.type === 'ELLIPSE' && n.visible !== false && (n.absoluteBoundingBox?.width ?? 0) >= 50,
    );
    if (visibleEllipses.length > 0) {
      const ref = visibleEllipses[0].absoluteBoundingBox;
      const cx = ref.x + ref.width / 2;
      const cy = ref.y + ref.height / 2;
      const radius = Math.max(ref.width, ref.height) / 2;
      // Find TEXT nodes near the center of the ellipse cluster
      const centerTexts = findAllNodes(node, (n: any) => {
        if (n.type !== 'TEXT' || n.visible === false) return false;
        const bb = n.absoluteBoundingBox;
        if (!bb) return false;
        const tcx = bb.x + bb.width / 2;
        const tcy = bb.y + bb.height / 2;
        return Math.abs(tcx - cx) < radius * 0.4 && Math.abs(tcy - cy) < radius * 0.4;
      });
      if (centerTexts.length > 0) {
        // Sort by font-size descending — largest is main label, second is subtitle
        centerTexts.sort((a: any, b: any) => (b.style?.fontSize ?? 0) - (a.style?.fontSize ?? 0));
        const ct = centerTexts[0];
        donutCenterText = (ct.characters ?? ct.content ?? '').trim();
        donutCenterFontSize = ct.style?.fontSize ?? 24;
        donutCenterFontWeight = ct.style?.fontWeight ?? 600;
        const textFill = (ct.fills ?? []).find((f: any) => f.type === 'SOLID' && f.color);
        if (textFill) donutCenterColor = figmaColorToCss(textFill.color, textFill.opacity);

        // Secondary center text (subtitle)
        if (centerTexts.length > 1) {
          const st = centerTexts[1];
          centerSubtext = (st.characters ?? st.content ?? '').trim();
          centerSubtextFontSize = st.style?.fontSize ?? 14;
          centerSubtextFontWeight = st.style?.fontWeight ?? 400;
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

    // Strategy 1: match by color (legend dot color === slice fill color)
    for (const s of series) {
      const match = slices.find((sl) => sl.color === s.legendColor);
      if (match) {
        s.value = match.value;
        s.color = match.color; // use the actual slice color from Figma
      }
    }

    // Strategy 2: for unmatched series, assign slices by order
    const unmatchedSeries = series.filter((s) => s.value === undefined);
    const usedColors = new Set(series.filter((s) => s.value !== undefined).map((s) => s.color));
    const unmatchedSlices = slices.filter((sl) => !usedColors.has(sl.color));

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
  if (yAxisFrame?.absoluteBoundingBox?.width) {
    yAxisWidth = Math.round(yAxisFrame.absoluteBoundingBox.width);
  }

  // ── Series stroke width ──
  let seriesStrokeWidth = 2;
  const strokedDataVectors = findAllNodes(node, (n: any) =>
    n.type === 'VECTOR' && (n.strokes ?? []).length > 0 && n.strokeWeight,
  );
  if (strokedDataVectors.length > 0) {
    seriesStrokeWidth = strokedDataVectors[0].strokeWeight;
  }

  // ── Dot styling ──
  const { dotRadius, dotStrokeColor, dotStrokeWidth } = extractDotStyle(node);

  // ── Gradient opacity for area charts ──
  const gradientStartOpacity = extractGradientOpacity(node);

  // ── Bar corner radius ──
  const barRadius = extractBarRadius(node) as [number, number, number, number];

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
    dataPointCount,
    backgroundColor,
    axisLabelColor,
    periodOptions,
    hasSwitcher,
    hasLegend: legendsFrame !== null,

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

  for (const frame of allFrames) {
    const frameBB = frame.absoluteBoundingBox;
    if (!frameBB) continue;

    const textNodes = findDirectTextNodes(frame);
    if (textNodes.length < MIN_AXIS_LABELS) continue;

    // X-axis candidate: bottom 30%, spans width, short text labels
    const frameMidY = frameBB.y + frameBB.height / 2;
    const isBottom = frameMidY > rootBB.y + rootBB.height * 0.7;
    const spansWidth = frameBB.width > rootBB.width * 0.4;
    if (isBottom && spansWidth && textNodes.length >= 3) {
      const allShort = textNodes.every((t: any) =>
        (t.characters ?? t.content ?? '').trim().length < 8,
      );
      if (allShort) {
        const score = textNodes.length;
        if (score > bestXScore) {
          bestXScore = score;
          xAxisFrame = frame;
        }
      }
    }

    // Y-axis candidate: left/right 25%, spans height, numeric labels
    const isLeftEdge = frameBB.x < rootBB.x + rootBB.width * 0.25;
    const isRightEdge = frameBB.x + frameBB.width > rootBB.x + rootBB.width * 0.75;
    const spansHeight = frameBB.height > rootBB.height * 0.3;
    if ((isLeftEdge || isRightEdge) && spansHeight) {
      const numericCount = textNodes.filter((t: any) => {
        const text = (t.characters ?? t.content ?? '').trim();
        return /^[\d.,\-$%kKmMbB]+$/.test(text);
      }).length;
      if (numericCount >= MIN_AXIS_LABELS) {
        const score = numericCount;
        if (score > bestYScore) {
          bestYScore = score;
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

      const dotFill = (dotNode.fills ?? []).find(
        (f: any) => f.type === 'SOLID' && f.color,
      );
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
  const shapes = findAllNodes(node, (n: any) => {
    if (n.type !== 'ELLIPSE' && n.type !== 'RECTANGLE' && n.type !== 'LINE') return false;
    const bb = n.absoluteBoundingBox;
    if (!bb) return false;
    return bb.width <= 16 && bb.height <= 16;
  });
  return shapes[0] ?? null;
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

  // Pick the largest by bounding-box area (not the root)
  let best: any = null;
  let bestArea = 0;
  for (const f of candidates) {
    // Skip if it is a descendant of legend or switcher
    if (legendFrame && isDescendantOf(f, legendFrame)) continue;
    if (switcherFrame && isDescendantOf(f, switcherFrame)) continue;

    const bb = f.absoluteBoundingBox;
    if (!bb) continue;
    const area = bb.width * bb.height;
    if (area > bestArea) {
      bestArea = area;
      best = f;
    }
  }

  return best;
}

// ── Text content extraction ─────────────────────────────────────────────────

/** Return type for extractChartTextContent — text content + styling. */
interface ChartTextContentResult {
  chartTitle: string;
  chartSubtitle: string;
  summaryAmount: string;
  summaryText: string;
  summaryCtaText: string;
  titleFontSize: number;
  titleFontWeight: number;
  titleColor: string;
  subtitleFontSize: number;
  subtitleColor: string;
  summaryBg: string;
  summaryBorderRadius: number;
  summaryBorderColor: string;
  summaryBorderWidth: number;
  summaryPadding: string;
  amountFontSize: number;
  amountFontWeight: number;
  amountColor: string;
  summaryTextFontSize: number;
  summaryTextColor: string;
  ctaFontSize: number;
  ctaFontWeight: number;
  ctaColor: string;
  ctaBg: string;
  ctaBorderColor: string;
  ctaBorderRadius: number;
  ctaPadding: string;
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
    titleFontSize: 18, titleFontWeight: 700, titleColor: '#262626',
    subtitleFontSize: 14, subtitleColor: '#737373',
    summaryBg: '#ffffff', summaryBorderRadius: 12, summaryBorderColor: '#e5e7eb',
    summaryBorderWidth: 1, summaryPadding: '16px',
    amountFontSize: 28, amountFontWeight: 700, amountColor: '#7C3AED',
    summaryTextFontSize: 14, summaryTextColor: '#737373',
    ctaFontSize: 14, ctaFontWeight: 500, ctaColor: '#262626',
    ctaBg: '#ffffff', ctaBorderColor: '#e5e7eb', ctaBorderRadius: 100, ctaPadding: '12px',
  };

  // Build exclusion set: chart data area, axes, legend, switcher
  const excludeFrames = new Set(
    [chartAreaFrame, legendsFrame, switcherFrame, xAxisFrame, yAxisFrame].filter(Boolean),
  );

  // Also exclude any frame containing >= 3 VISIBLE shape nodes with chromatic fills (data areas)
  // Skip the root node itself — it contains everything, excluding it would block all text.
  // Uses findVisibleNodes so hidden subtrees are not walked into.
  const dataAreas = findVisibleNodes(rootNode, (n: any) => {
    if (n === rootNode) return false;
    if (n.type !== 'FRAME' && n.type !== 'GROUP') return false;
    const shapes = findVisibleNodes(n, (c: any) =>
      ['RECTANGLE', 'VECTOR', 'ELLIPSE', 'LINE'].includes(c.type) &&
      (c.fills ?? []).some((f: any) => f.type === 'SOLID' && f.color && isChromatic(f.color)),
    );
    return shapes.length >= 3;
  });
  for (const da of dataAreas) excludeFrames.add(da);

  // Collect visible TEXT nodes NOT inside excluded frames
  const allTextNodes = findVisibleNodes(rootNode, (n: any) => n.type === 'TEXT');
  const outsideTexts = allTextNodes.filter((t: any) => {
    for (const excluded of excludeFrames) {
      if (isDescendantOf(t, excluded)) return false;
    }
    return true;
  });

  // Determine chart area vertical bounds for above/below classification
  const chartAreaBB = chartAreaFrame?.absoluteBoundingBox;
  const chartTop = chartAreaBB?.y ?? 0;
  const chartBottom = chartAreaBB ? chartAreaBB.y + chartAreaBB.height : Infinity;

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
      result.summaryPadding = formatPadding(summaryContainer, result.summaryPadding);
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
      result.ctaPadding = formatPadding(ctaContainer, result.ctaPadding);
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
      const hasDot = directChildren.some((c: any) => {
        if (c.type !== 'ELLIPSE' && c.type !== 'RECTANGLE' && c.type !== 'LINE') return false;
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

        const dotNode = (legendItem.children ?? []).find((c: any) => {
          if (c.type !== 'ELLIPSE' && c.type !== 'RECTANGLE' && c.type !== 'LINE') return false;
          const bb = c.absoluteBoundingBox;
          return bb && bb.width <= 16 && bb.height <= 16;
        });
        let legendColor = '#9747ff';
        if (dotNode) {
          const fill = (dotNode.fills ?? []).find((f: any) => f.type === 'SOLID' && f.color);
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
          findNodeByType(legendItem, 'LINE');
        let legendColor = '#9747ff';
        if (dotNode) {
          const fill = (dotNode.fills ?? []).find((f: any) => f.type === 'SOLID' && f.color);
          if (fill) legendColor = figmaColorToCss(fill.color, fill.opacity);
        }

        seriesList.push({ name: text, color: legendColor, legendColor });
      }

      if (seriesList.length > 0) {
        return seriesList;
      }
    }
  }

  // Fallback: extract a single series from data elements
  const fallbackColor = extractSingleSeriesColor(rootNode);
  return [{ name: 'Chart', color: fallbackColor, legendColor: fallbackColor }];
}

/**
 * Extract data element colors by walking into the chart area frame.
 * Uses structural type checks, not name matching.
 */
function extractDataElementColors(rootNode: any, chartAreaFrame: any | null): string[] {
  const dataArea = chartAreaFrame ?? rootNode;

  // Collect all container nodes with children
  const dataContainers = findAllNodes(dataArea, (n: any) => {
    const type = n.type ?? '';
    return ['BOOLEAN_OPERATION', 'GROUP', 'FRAME'].includes(type) &&
      (n.children ?? []).length > 0;
  });

  const colors: string[] = [];
  const seenColors = new Set<string>();

  for (const container of dataContainers) {
    const innerColor = findInnermostFill(container);
    if (innerColor && !seenColors.has(innerColor)) {
      seenColors.add(innerColor);
      colors.push(innerColor);
    }
  }

  // Also check direct shapes if no containers found
  if (colors.length === 0) {
    const directNodes = findAllNodes(dataArea, (n: any) => {
      const type = n.type ?? '';
      return ['RECTANGLE', 'VECTOR', 'ELLIPSE'].includes(type);
    });
    for (const dn of directNodes) {
      for (const f of dn.fills ?? []) {
        if (f.type === 'SOLID' && f.color && isChromatic(f.color)) {
          const hex = figmaColorToHex(f.color);
          if (!seenColors.has(hex)) {
            seenColors.add(hex);
            colors.push(hex);
          }
        }
      }
    }
  }

  return colors;
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

  return '#9747ff'; // fallback
}

// ── Styling extraction helpers ───────────────────────────────────────────────

/**
 * Extract grid line color and dash pattern structurally.
 * Finds LINE/VECTOR nodes arranged as parallel grid lines (similar length, no chromatic fills).
 */
function extractGridStyle(node: any): { gridLineColor: string; gridStrokeDasharray: string } {
  let gridLineColor = '#E5E7EB';
  let gridStrokeDasharray = '3 3';

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

function extractChartAreaHeight(chartAreaFrame: any | null, fallbackHeight: number, isChartOnly = false): number {
  if (chartAreaFrame?.absoluteBoundingBox?.height) {
    return Math.round(chartAreaFrame.absoluteBoundingBox.height);
  }
  // If the node is purely chart (no legends, header, axes), use full height
  if (isChartOnly) {
    return Math.round(fallbackHeight);
  }
  return Math.round(fallbackHeight * 0.7);
}

/** Extract dot styling from small ELLIPSE nodes. */
function extractDotStyle(node: any): {
  dotRadius: number;
  dotStrokeColor: string;
  dotStrokeWidth: number;
} {
  let dotRadius = 3;
  let dotStrokeColor = '#ffffff';
  let dotStrokeWidth = 2;

  const ellipses = findAllNodes(node, (n: any) => {
    if (n.type !== 'ELLIPSE') return false;
    const size = n.absoluteBoundingBox?.width ?? n.size?.x ?? 0;
    return size > 0 && size <= 20;
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
        const firstStop = fill.gradientStops[0];
        if (firstStop.color?.a !== undefined) {
          return Math.round(firstStop.color.a * 100) / 100;
        }
      }
    }
  }
  return 0.75;
}

/** Extract bar corner radius from RECTANGLE nodes with chromatic fills. */
function extractBarRadius(node: any): [number, number, number, number] {
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
    const r = rect.cornerRadius ?? 0;
    return [r, r, 0, 0];
  }
  return [4, 4, 0, 0];
}

/** Extract chart margin from the chart area frame's auto-layout padding. */
function extractChartMargin(chartAreaFrame: any | null): {
  top: number; right: number; bottom: number; left: number;
} {
  if (chartAreaFrame) {
    return {
      top: chartAreaFrame.paddingTop ?? 8,
      right: chartAreaFrame.paddingRight ?? 0,
      bottom: chartAreaFrame.paddingBottom ?? 0,
      left: chartAreaFrame.paddingLeft ?? 0,
    };
  }
  return { top: 8, right: 0, bottom: 0, left: 0 };
}

/** Extract legend styling from the structurally-found legends frame. */
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

  const legendGap = legendsFrame.itemSpacing ?? defaults.legendGap;

  const legendItem = (legendsFrame.children ?? []).find(
    (c: any) => c.type === 'FRAME' || c.type === 'GROUP' || c.type === 'INSTANCE',
  );
  const legendItemGap = legendItem?.itemSpacing ?? defaults.legendItemGap;

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
      const fill = (dotNode.fills ?? [])[0];
      if (fill?.opacity !== undefined) {
        legendDotOpacity = Math.round(fill.opacity * 100) / 100;
      } else if (dotNode.opacity !== undefined) {
        legendDotOpacity = Math.round(dotNode.opacity * 100) / 100;
      }
    }
  }

  let legendLabelFontSize = defaults.legendLabelFontSize;
  let legendLabelColor = defaults.legendLabelColor;

  const legendText = findNodeByType(legendsFrame, 'TEXT');
  if (legendText) {
    if (legendText.style?.fontSize) legendLabelFontSize = legendText.style.fontSize;
    const fill = (legendText.fills ?? [])[0];
    if (fill?.color) legendLabelColor = figmaColorToHex(fill.color);
  }

  let legendMarginBottom = defaults.legendMarginBottom;
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

/** Extract switcher/tab styling from the structurally-found switcher frame. */
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

  const containerFill = (switcherFrame.fills ?? []).find(
    (f: any) => f.type === 'SOLID' && f.color,
  );
  const switcherBg = containerFill
    ? figmaColorToHex(containerFill.color)
    : defaults.switcherBg;
  const switcherBorderRadius =
    switcherFrame.cornerRadius ?? defaults.switcherBorderRadius;
  const switcherPadding = formatPadding(switcherFrame, defaults.switcherPadding);
  const switcherMarginTop = defaults.switcherMarginTop;

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
  const switcherButtonPadding = buttonChild
    ? formatPadding(buttonChild, defaults.switcherButtonPadding)
    : defaults.switcherButtonPadding;

  const switcherButtonBorderRadius =
    buttonChild?.cornerRadius ?? defaults.switcherButtonBorderRadius;

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
        if (activeText.style?.fontSize)
          switcherButtonFontSize = activeText.style.fontSize;
      }
      const fill = (activeText.fills ?? [])[0];
      if (fill?.color) switcherActiveColor = figmaColorToHex(fill.color);
      if (activeText.style?.fontWeight)
        switcherActiveFontWeight = activeText.style.fontWeight;
    }
  }

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
  // Always try structural detection first — it's more reliable for pie/donut
  // because it uses arcData.innerRadius and visibility which the LLM summary lacks.
  const structuralResult = detectChartType(node);
  if (structuralResult !== 'unknown') return structuralResult;

  // Structural detection couldn't determine — fall back to LLM
  const summary = buildNodeSummary(node);

  const systemPrompt = `You are a design analysis expert. Given a Figma layer tree, identify the chart/graph type.

Respond with ONLY a JSON object — no markdown, no explanation:
{"chartType": "<type>"}

Chart type values:
- "line"    — data shown as connected points/lines
- "area"    — like line but with filled region beneath
- "bar"     — vertical or horizontal bars/columns
- "pie"     — circular segments (full circle, no hole)
- "donut"   — circular segments with hollow center (has inner cutout, text in center, or smaller concentric element)
- "radial"  — concentric rings/progress bars (multiple rings at different radii, each showing progress)
- "unknown" — cannot determine

Analyze the node types (VECTOR, RECTANGLE, ELLIPSE, LINE), their sizes, positions, fills, strokes, and spatial arrangement.
Do NOT rely on layer names — focus on structural properties like overlapping same-sized ellipses, aligned rectangles, stroked vectors, etc.`;

  const userPrompt = `Figma layer tree:\n\n${summary}\n\nWhat type of chart is this?`;

  try {
    const response = await llmProvider.generate(userPrompt, systemPrompt);
    const jsonMatch = response.match(/\{[\s\S]*?"chartType"\s*:\s*"([^"]+)"[\s\S]*?\}/);
    if (jsonMatch) {
      const chartType = jsonMatch[1] as ChartType;
      const valid: ChartType[] = ['area', 'line', 'bar', 'pie', 'donut', 'radial', 'unknown'];
      if (valid.includes(chartType)) return chartType;
    }
  } catch {
    // fall through to structural detection
  }

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
  const attrs = [fills, strokes].filter(Boolean).join(' | ');

  let line = `${indent}${type} "${name}"${size}${pos}${text}${layout}${radius}${attrs ? ` [${attrs}]` : ''}`;

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
