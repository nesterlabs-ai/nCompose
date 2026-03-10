/**
 * Recharts code generator — config-driven.
 *
 * Instead of hardcoded JSX per chart type, uses a single RECHARTS_MAP
 * that defines which Recharts components each chart type needs.
 * The builder dynamically assembles imports, data, JSX, and props
 * from this map + Figma-extracted metadata.
 *
 * To add a new chart type: add one entry to RECHARTS_MAP + one case in buildChartJSX.
 */

import type { ChartMetadata } from '../figma/chart-detection.js';

export interface ChartCodeResult {
  reactCode: string;
  css: string;
}

// ── Recharts component map ─────────────────────────────────────────────────
// Single source of truth: chart type → what Recharts components it needs.

interface RechartsComponentDef {
  /** The top-level chart container component (e.g. 'PieChart', 'BarChart') */
  chart: string;
  /** The data-rendering component (e.g. 'Pie', 'Bar', 'Line', 'Area') */
  dataElement: string;
  /** Additional Recharts components this chart type uses */
  extras: string[];
  /** Whether this chart type uses cartesian axes (XAxis, YAxis, CartesianGrid) */
  cartesian: boolean;
}

const RECHARTS_MAP: Record<string, RechartsComponentDef> = {
  pie: {
    chart: 'PieChart',
    dataElement: 'Pie',
    extras: ['Cell', 'Tooltip', 'Legend', 'Label'],
    cartesian: false,
  },
  donut: {
    chart: 'PieChart',
    dataElement: 'Pie',
    extras: ['Cell', 'Tooltip', 'Legend', 'Label'],
    cartesian: false,
  },
  radial: {
    chart: 'RadialBarChart',
    dataElement: 'RadialBar',
    extras: ['PolarAngleAxis', 'Legend', 'Tooltip'],
    cartesian: false,
  },
  bar: {
    chart: 'BarChart',
    dataElement: 'Bar',
    extras: ['CartesianGrid', 'XAxis', 'YAxis', 'Tooltip', 'Legend', 'LabelList'],
    cartesian: true,
  },
  area: {
    chart: 'AreaChart',
    dataElement: 'Area',
    extras: ['CartesianGrid', 'XAxis', 'YAxis', 'Tooltip', 'Legend'],
    cartesian: true,
  },
  line: {
    chart: 'LineChart',
    dataElement: 'Line',
    extras: ['CartesianGrid', 'XAxis', 'YAxis', 'Tooltip', 'Legend'],
    cartesian: true,
  },
};

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Generate a complete standalone React chart component + CSS.
 */
export function generateChartCode(meta: ChartMetadata): ChartCodeResult {
  const reactCode = buildReactCode(meta);
  const css = buildCSS(meta);
  return { reactCode, css };
}

// ── React code generation ──────────────────────────────────────────────────

function buildReactCode(meta: ChartMetadata): string {
  const { componentName, bemBase, hasSwitcher, periodOptions, hasLegend, series } = meta;
  const def = RECHARTS_MAP[meta.chartType] ?? RECHARTS_MAP.line;

  // Dynamically collect imports from the map
  const rechartsImports = resolveImports(def);
  const dataCode = buildChartData(meta, componentName);
  const chartJSX = buildChartJSX(meta, def);
  const helperFns = buildHelperFunctions(meta);

  const defaultPeriod =
    hasSwitcher && periodOptions.length >= 2
      ? periodOptions[1]
      : periodOptions[0] ?? 'default';

  const switcherButtons = hasSwitcher
    ? periodOptions
        .map(
          (opt) =>
            `        <button\n` +
            `          className={\`${bemBase}__switcher\${view === '${opt}' ? ' ${bemBase}__switcher--active' : ''}\`}\n` +
            `          onClick={() => setView('${opt}')}\n` +
            `        >${opt}</button>`,
        )
        .join('\n')
    : '';

  const switcherSection = hasSwitcher
    ? `\n      <div className="${bemBase}__switchers">\n${switcherButtons}\n      </div>`
    : '';

  // Use Recharts <Legend> for cartesian charts, custom HTML for pie/donut/radial
  const legendsSection = hasLegend
    ? `\n      <div className="${bemBase}__legends">\n` +
      series.map((s) =>
        `        <div className="${bemBase}__legend">\n` +
        `          <span className="${bemBase}__legend-dot" style={{ background: '${s.legendColor}' }} />\n` +
        `          <span className="${bemBase}__legend-label">${s.name}</span>\n` +
        `        </div>`,
      ).join('\n') + `\n` +
      `      </div>`
    : '';

  const titleSection = meta.chartTitle
    ? `\n      <div className="${bemBase}__header">` +
      `\n        <h3 className="${bemBase}__title">${meta.chartTitle}</h3>` +
      (meta.chartSubtitle ? `\n        <p className="${bemBase}__subtitle">${meta.chartSubtitle}</p>` : '') +
      `\n      </div>`
    : '';

  const summarySection = meta.summaryAmount
    ? `\n      <div className="${bemBase}__summary">` +
      `\n        <span className="${bemBase}__amount">${meta.summaryAmount}</span>` +
      (meta.summaryText ? `\n        <p className="${bemBase}__summary-text">${meta.summaryText}</p>` : '') +
      (meta.summaryCtaText ? `\n        <button className="${bemBase}__summary-cta">${meta.summaryCtaText}</button>` : '') +
      `\n      </div>`
    : '';

  return `import { useState, useMemo } from 'react';
import {
  ${rechartsImports.join(',\n  ')}
} from 'recharts';
import './${componentName}.css';

${dataCode}
${helperFns}
export default function ${componentName}() {
  const [view, setView] = useState('${defaultPeriod}');
  const data = useMemo(() => CHART_DATA_${componentName}[view] ?? CHART_DATA_${componentName}['${defaultPeriod}'], [view]);

  return (
    <figure className="${bemBase}">${titleSection}${legendsSection}
      <ResponsiveContainer width="100%" height={${meta.chartAreaHeight}}>
        ${chartJSX}
      </ResponsiveContainer>${switcherSection}${summarySection}
    </figure>
  );
}
`;
}

// ── Dynamic import resolution ──────────────────────────────────────────────

function resolveImports(def: RechartsComponentDef): string[] {
  const imports = new Set<string>();
  imports.add('ResponsiveContainer');
  imports.add(def.chart);
  imports.add(def.dataElement);
  for (const extra of def.extras) imports.add(extra);
  // Cell is needed for pie/donut data coloring
  if (def.dataElement === 'Pie') imports.add('Cell');
  return [...imports];
}

// ── Helper functions (CustomTooltip, etc.) ─────────────────────────────────

function buildHelperFunctions(meta: ChartMetadata): string {
  const { bemBase } = meta;

  // Custom tooltip styled from Figma metadata
  const tooltip = `
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="${bemBase}__tooltip">
      {label && <p className="${bemBase}__tooltip-label">{label}</p>}
      {payload.map((entry, i) => (
        <p key={i} className="${bemBase}__tooltip-item" style={{ color: entry.color || entry.payload?.fill || entry.payload?.color }}>
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  );
};
`;

  return tooltip;
}

// ── Data generation ────────────────────────────────────────────────────────

function buildChartData(meta: ChartMetadata, componentName: string): string {
  const { xAxisLabels, yAxisMin, yAxisMax, dataPointCount, periodOptions, hasSwitcher, series, chartType } = meta;

  // Radial: ring data with progress values from Figma arc sweeps
  if (chartType === 'radial' && meta.rings.length > 0) {
    const ringData = meta.rings.map((r) =>
      `    { name: ${JSON.stringify(r.name)}, value: ${r.progress}, fill: ${JSON.stringify(r.color)} }`,
    );
    return (
      `const CHART_DATA_${componentName} = {\n` +
      `  "default": [\n${ringData.join(',\n')}\n  ]\n` +
      `};`
    );
  }

  // Pie/donut: flat array with { name, value, color } — values from Figma arc sweeps
  if (chartType === 'pie' || chartType === 'donut') {
    const pieData = series.map((s) => {
      const value = s.value ?? Math.round(100 / series.length);
      return `    { name: ${JSON.stringify(s.name)}, value: ${value}, color: ${JSON.stringify(s.color)} }`;
    });
    return (
      `const CHART_DATA_${componentName} = {\n` +
      `  "default": [\n${pieData.join(',\n')}\n  ]\n` +
      `};`
    );
  }

  // Cartesian charts: per-period data arrays
  const count = Math.max(dataPointCount, xAxisLabels.length || 1);
  const labels =
    xAxisLabels.length > 0
      ? xAxisLabels
      : Array.from({ length: count }, (_, i) => `Point ${i + 1}`);

  const periods =
    hasSwitcher && periodOptions.length >= 1 ? periodOptions : ['default'];

  const seriesCount = series.length;

  const periodDataEntries = periods.map((period, periodIdx) => {
    const points = labels.map((name, i) => {
      const range = Math.max(yAxisMax - yAxisMin, 1);
      const base = yAxisMin + range * 0.5;
      const amplitude = range * 0.25;

      if (seriesCount <= 1) {
        const value = Math.round(base + amplitude * Math.sin((i + periodIdx * 3) * 0.8));
        return `    { name: ${JSON.stringify(name)}, value: ${value} }`;
      } else {
        const seriesValues = Array.from({ length: seriesCount }, (_, si) => {
          const value = Math.round(base + amplitude * Math.sin((i + periodIdx * 3 + si * 2) * 0.8));
          return `series${si}: ${value}`;
        });
        return `    { name: ${JSON.stringify(name)}, ${seriesValues.join(', ')} }`;
      }
    });
    return `  ${JSON.stringify(period)}: [\n${points.join(',\n')}\n  ]`;
  });

  return (
    `const CHART_DATA_${componentName} = {\n` +
    `${periodDataEntries.join(',\n')}\n` +
    `};`
  );
}

// ── Chart JSX builder — uses RECHARTS_MAP + Figma metadata ─────────────────

function buildChartJSX(meta: ChartMetadata, def: RechartsComponentDef): string {
  const { chartType } = meta;

  // ── Cartesian shared props (axes, grid, margin) ──
  const cartesianProps = def.cartesian ? buildCartesianProps(meta) : null;

  // ── Build data element props from Figma metadata ──
  const dataElementProps = buildDataElementProps(meta, def);

  // ── Assemble the chart ──
  const chartTag = def.chart;
  const chartOpenProps = buildChartContainerProps(meta, def);

  if (!def.cartesian) {
    // Non-cartesian (pie, donut, radial) — no axes/grid
    return (
      `<${chartTag}${chartOpenProps}>\n` +
      dataElementProps +
      `        </${chartTag}>`
    );
  }

  // Cartesian (bar, area, line) — with axes, grid, gradients
  const gradientDefs = chartType === 'area' ? buildGradientDefs(meta) : '';

  return (
    `<${chartTag} data={data}${chartOpenProps}>\n` +
    gradientDefs +
    cartesianProps +
    `          <Tooltip content={<CustomTooltip />} />\n` +
    dataElementProps +
    `        </${chartTag}>`
  );
}

// ── Chart container props ──────────────────────────────────────────────────

function buildChartContainerProps(meta: ChartMetadata, _def: RechartsComponentDef): string {
  const { chartType, chartMargin } = meta;

  if (chartType === 'pie' || chartType === 'donut') {
    return ''; // PieChart takes no data/margin props
  }

  if (chartType === 'radial') {
    const rings = meta.rings;
    const innerR = rings.length > 0 ? rings[rings.length - 1].innerRadius : 20;
    const outerR = rings.length > 0 ? rings[0].outerRadius : Math.round(meta.chartAreaHeight / 2);
    return ` innerRadius="${innerR}" outerRadius="${outerR}" data={data} startAngle={90} endAngle={-270}`;
  }

  // Cartesian charts
  const { top, right, bottom, left } = chartMargin;
  return ` margin={{ top: ${top}, right: ${right}, left: ${left}, bottom: ${bottom} }}`;
}

// ── Data element props (Pie, Bar, Line, Area, RadialBar) ───────────────────

function buildDataElementProps(meta: ChartMetadata, def: RechartsComponentDef): string {
  const { chartType, series } = meta;
  const primaryColor = series[0]?.color ?? '#9747ff';
  const isMultiSeries = series.length > 1;
  const el = def.dataElement; // 'Pie', 'Bar', 'Line', 'Area', 'RadialBar'

  // ── Pie / Donut ──
  if (el === 'Pie') {
    const outerRadius = Math.round(meta.chartAreaHeight / 2);
    const innerRadius = chartType === 'donut'
      ? Math.round(outerRadius * (meta.innerRadiusRatio > 0 ? meta.innerRadiusRatio : 0.6))
      : 0;

    // Center label for donut (e.g. "9.2K")
    const centerLabel = chartType === 'donut' && meta.donutCenterText
      ? `\n            <Label position="center" value="${meta.donutCenterText}" style={{ fontSize: '${meta.donutCenterFontSize}px', fontWeight: ${meta.donutCenterFontWeight}, fill: '${meta.donutCenterColor}' }} />`
      : '';

    return (
      `          <${el}\n` +
      `            data={data}\n` +
      `            dataKey="value"\n` +
      `            nameKey="name"\n` +
      `            cx="50%"\n` +
      `            cy="50%"\n` +
      `            innerRadius={${innerRadius}}\n` +
      `            outerRadius={${outerRadius}}\n` +
      `            strokeWidth={0}\n` +
      `          >\n` +
      `            {data.map((entry, index) => (\n` +
      `              <Cell key={index} fill={entry.color} />\n` +
      `            ))}${centerLabel}\n` +
      `          </${el}>\n` +
      `          <Tooltip content={<CustomTooltip />} />\n`
    );
  }

  // ── Radial Bar ──
  if (el === 'RadialBar') {
    const trackColor = meta.rings[0]?.trackColor ?? '#f0f0f0';
    const cornerRadius = Math.round(meta.chartAreaHeight * 0.05);

    return (
      `          <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />\n` +
      `          <${el}\n` +
      `            background={{ fill: '${trackColor}' }}\n` +
      `            dataKey="value"\n` +
      `            angleAxisId={0}\n` +
      `            cornerRadius={${cornerRadius}}\n` +
      `          />\n` +
      `          <Tooltip content={<CustomTooltip />} />\n`
    );
  }

  // ── Cartesian elements (Bar, Line, Area) ──
  if (!isMultiSeries) {
    const color = primaryColor;
    const dataKey = 'value';
    return `          <${el} ${buildElementProps(el, dataKey, color, meta, 0)} />\n`;
  }

  // Multi-series: one element per series
  return series.map((s, i) => {
    const dataKey = `series${i}`;
    return `          <${el} ${buildElementProps(el, dataKey, s.color, meta, i)} />`;
  }).join('\n') + '\n';
}

// ── Per-element prop builder (single Bar/Line/Area element) ────────────────

function buildElementProps(
  el: string,
  dataKey: string,
  color: string,
  meta: ChartMetadata,
  index: number,
): string {
  const { seriesStrokeWidth, dotRadius, dotStrokeColor, dotStrokeWidth, barRadius, bemBase } = meta;
  const activeDotRadius = dotRadius + 2;

  const dotProps =
    `dot={{ fill: '${color}', stroke: '${dotStrokeColor}', strokeWidth: ${dotStrokeWidth}, r: ${dotRadius} }} ` +
    `activeDot={{ fill: '${color}', stroke: '${dotStrokeColor}', strokeWidth: ${dotStrokeWidth}, r: ${activeDotRadius} }}`;

  switch (el) {
    case 'Bar':
      return `dataKey="${dataKey}" fill="${color}" radius={[${barRadius.join(', ')}]}`;
    case 'Area': {
      const gradientId = index > 0 ? `${bemBase}-gradient-${index}` : `${bemBase}-gradient`;
      return `type="monotone" dataKey="${dataKey}" stroke="${color}" strokeWidth={${seriesStrokeWidth}} fill="url(#${gradientId})" ${dotProps}`;
    }
    case 'Line':
    default:
      return `type="monotone" dataKey="${dataKey}" stroke="${color}" strokeWidth={${seriesStrokeWidth}} ${dotProps}`;
  }
}

// ── Cartesian axes + grid ──────────────────────────────────────────────────

function buildCartesianProps(meta: ChartMetadata): string {
  const { axisLabelColor, axisFontSize, gridLineColor, gridStrokeDasharray, yAxisMin, yAxisMax, yAxisWidth } = meta;

  const gridProps = gridStrokeDasharray
    ? `strokeDasharray="${gridStrokeDasharray}" stroke="${gridLineColor}"`
    : `stroke="${gridLineColor}"`;

  const xAxisProps = `dataKey="name" tick={{ fill: '${axisLabelColor}', fontSize: ${axisFontSize} }} axisLine={false} tickLine={false}`;

  const yRange = yAxisMax - yAxisMin;
  const yStep = yRange > 0 ? Math.round(yRange / 4) : 10;
  const yTicks = [yAxisMin, yAxisMin + yStep, yAxisMin + yStep * 2, yAxisMin + yStep * 3, yAxisMax];
  const yAxisProps =
    `domain={[${yAxisMin}, ${yAxisMax}]} ticks={[${yTicks.join(', ')}]} ` +
    `tick={{ fill: '${axisLabelColor}', fontSize: ${axisFontSize} }} axisLine={false} tickLine={false} width={${yAxisWidth}}`;

  return (
    `          <CartesianGrid ${gridProps} />\n` +
    `          <XAxis ${xAxisProps} />\n` +
    `          <YAxis ${yAxisProps} />\n`
  );
}

// ── Gradient defs for area charts ──────────────────────────────────────────

function buildGradientDefs(meta: ChartMetadata): string {
  const { series, bemBase, gradientStartOpacity } = meta;
  const isMultiSeries = series.length > 1;

  const gradients = isMultiSeries
    ? series.map((s, i) =>
        `            <linearGradient id="${bemBase}-gradient-${i}" x1="0" y1="0" x2="0" y2="1">\n` +
        `              <stop offset="0%" stopColor="${s.color}" stopOpacity={${gradientStartOpacity}} />\n` +
        `              <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />\n` +
        `            </linearGradient>`,
      ).join('\n')
    : `            <linearGradient id="${bemBase}-gradient" x1="0" y1="0" x2="0" y2="1">\n` +
      `              <stop offset="0%" stopColor="${series[0]?.color ?? '#9747ff'}" stopOpacity={${gradientStartOpacity}} />\n` +
      `              <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />\n` +
      `            </linearGradient>`;

  return (
    `          <defs>\n` +
    gradients + '\n' +
    `          </defs>\n`
  );
}

// ── CSS generation ─────────────────────────────────────────────────────────

function buildCSS(meta: ChartMetadata): string {
  const {
    bemBase, backgroundColor,
    containerBorderRadius, containerPadding,
    legendGap, legendItemGap, legendDotSize, legendDotBorderRadius,
    legendDotOpacity, legendLabelFontSize, legendLabelColor, legendMarginBottom,
    switcherBg, switcherBorderRadius, switcherPadding, switcherMarginTop,
    switcherButtonPadding, switcherButtonFontSize, switcherButtonColor,
    switcherButtonBorderRadius, switcherActiveBg, switcherActiveColor,
    switcherActiveFontWeight, switcherActiveBoxShadow,
  } = meta;

  const padStr = `${containerPadding.top}px ${containerPadding.right}px ${containerPadding.bottom}px ${containerPadding.left}px`;

  return `.${bemBase} {
  background: ${backgroundColor};
  border-radius: ${containerBorderRadius}px;
  padding: ${padStr};
  width: 100%;
  box-sizing: border-box;
  overflow: hidden;
  position: relative;
}

.${bemBase}__legends {
  display: flex;
  align-items: center;
  gap: ${legendGap}px;
  margin-bottom: ${legendMarginBottom}px;
  flex-wrap: wrap;
}

.${bemBase}__legend {
  display: flex;
  align-items: center;
  gap: ${legendItemGap}px;
}

.${bemBase}__legend-dot {
  width: ${legendDotSize}px;
  height: ${legendDotSize}px;
  border-radius: ${legendDotBorderRadius};
  display: inline-block;
  opacity: ${legendDotOpacity};
}

.${bemBase}__legend-label {
  font-size: ${legendLabelFontSize}px;
  color: ${legendLabelColor};
}

.${bemBase}__tooltip {
  background: ${backgroundColor};
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 8px 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.${bemBase}__tooltip-label {
  font-size: 12px;
  color: #737373;
  margin: 0 0 4px 0;
}

.${bemBase}__tooltip-item {
  font-size: 13px;
  font-weight: 500;
  margin: 2px 0;
}

.${bemBase}__switchers {
  display: flex;
  background: ${switcherBg};
  border-radius: ${switcherBorderRadius}px;
  padding: ${switcherPadding};
  margin-top: ${switcherMarginTop}px;
}

.${bemBase}__switcher {
  flex: 1;
  padding: ${switcherButtonPadding};
  font-size: ${switcherButtonFontSize}px;
  color: ${switcherButtonColor};
  background: transparent;
  border: none;
  border-radius: ${switcherButtonBorderRadius}px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.${bemBase}__switcher--active {
  background: ${switcherActiveBg};
  color: ${switcherActiveColor};
  font-weight: ${switcherActiveFontWeight};
  box-shadow: ${switcherActiveBoxShadow};
}

.${bemBase}__header {
  margin-bottom: 8px;
}

.${bemBase}__title {
  font-size: ${meta.titleFontSize}px;
  font-weight: ${meta.titleFontWeight};
  margin: 0 0 4px 0;
  color: ${meta.titleColor};
}

.${bemBase}__subtitle {
  font-size: ${meta.subtitleFontSize}px;
  color: ${meta.subtitleColor};
  margin: 0;
}

.${bemBase}__summary {
  margin-top: 16px;
  padding: ${meta.summaryPadding};
  border-radius: ${meta.summaryBorderRadius}px;
  border: ${meta.summaryBorderWidth}px solid ${meta.summaryBorderColor};
  background: ${meta.summaryBg};
}

.${bemBase}__amount {
  display: block;
  font-size: ${meta.amountFontSize}px;
  font-weight: ${meta.amountFontWeight};
  color: ${meta.amountColor};
  margin-bottom: 4px;
}

.${bemBase}__summary-text {
  font-size: ${meta.summaryTextFontSize}px;
  color: ${meta.summaryTextColor};
  margin: 0 0 12px 0;
}

.${bemBase}__summary-cta {
  display: block;
  width: 100%;
  padding: ${meta.ctaPadding};
  font-size: ${meta.ctaFontSize}px;
  font-weight: ${meta.ctaFontWeight};
  color: ${meta.ctaColor};
  background: ${meta.ctaBg};
  border: 1px solid ${meta.ctaBorderColor};
  border-radius: ${meta.ctaBorderRadius}px;
  cursor: pointer;
  text-align: center;
}
`;
}
