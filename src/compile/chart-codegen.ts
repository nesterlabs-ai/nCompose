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
  radar: {
    chart: 'RadarChart',
    dataElement: 'Radar',
    extras: ['PolarGrid', 'PolarAngleAxis', 'PolarRadiusAxis', 'Tooltip', 'Legend'],
    cartesian: false,
  },
  scatter: {
    chart: 'ScatterChart',
    dataElement: 'Scatter',
    extras: ['CartesianGrid', 'XAxis', 'YAxis', 'Tooltip', 'Legend', 'Cell'],
    cartesian: true,
  },
  funnel: {
    chart: 'FunnelChart',
    dataElement: 'Funnel',
    extras: ['Tooltip', 'Legend', 'Cell', 'LabelList'],
    cartesian: false,
  },
  treemap: {
    chart: 'Treemap',
    dataElement: 'Treemap',
    extras: ['Tooltip'],
    cartesian: false,
  },
  bar: {
    chart: 'BarChart',
    dataElement: 'Bar',
    extras: ['CartesianGrid', 'XAxis', 'YAxis', 'Tooltip', 'Legend', 'LabelList'],
    cartesian: true,
  },
  // "composed" from LLM means bar+line overlay — render as BarChart (primary visual)
  composed: {
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

// ── Shared helper: build tick prop from optional Figma values ────────────────

function buildTickProp(meta: ChartMetadata): string {
  const parts: string[] = [];
  if (meta.axisLabelColor) parts.push(`fill: '${meta.axisLabelColor}'`);
  if (meta.axisFontSize != null) parts.push(`fontSize: ${meta.axisFontSize}`);
  return parts.length > 0 ? ` tick={{ ${parts.join(', ')} }}` : '';
}

// ── Dynamic import resolution ──────────────────────────────────────────────

function resolveImports(def: RechartsComponentDef): string[] {
  const imports = new Set<string>();
  imports.add('ResponsiveContainer');
  imports.add(def.chart);
  imports.add(def.dataElement);
  for (const extra of def.extras) imports.add(extra);
  // Cell is needed for pie/donut data coloring, and bar charts with per-bar colors
  if (def.dataElement === 'Pie') imports.add('Cell');
  if (def.dataElement === 'Bar') imports.add('Cell'); // included conditionally in JSX
  return [...imports];
}

// ── Helper functions (CustomTooltip, etc.) ─────────────────────────────────

function tooltipName(meta: ChartMetadata): string {
  return `CustomTooltip_${meta.componentName}`;
}

function buildHelperFunctions(meta: ChartMetadata): string {
  const { bemBase } = meta;
  const name = tooltipName(meta);

  // Custom tooltip styled from Figma metadata — unique name per chart to avoid collisions
  const tooltip = `
const ${name} = ({ active, payload, label }) => {
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

  // Radar: axis-based data with series values per axis
  if (chartType === 'radar') {
    // Use extracted axis labels or fallback to x-axis labels or generic labels
    const axes = meta.radarAxes.length > 0
      ? meta.radarAxes
      : xAxisLabels.length > 0
        ? xAxisLabels
        : Array.from({ length: 6 }, (_, i) => `Axis ${i + 1}`);
    const seriesCount = series.length;
    const points = axes.map((axis, i) => {
      const seriesValues = seriesCount > 1
        ? series.map((s, si) => {
            // Generate plausible values that vary per axis and series
            const value = Math.round(50 + 40 * Math.sin((i + si * 2) * 1.1));
            return `${JSON.stringify(s.name)}: ${value}`;
          }).join(', ')
        : `value: ${Math.round(50 + 40 * Math.sin(i * 1.1))}`;
      return `    { subject: ${JSON.stringify(axis)}, ${seriesValues}, fullMark: 100 }`;
    });
    return (
      `const CHART_DATA_${componentName} = {\n` +
      `  "default": [\n${points.join(',\n')}\n  ]\n` +
      `};`
    );
  }

  // Funnel: descending value data
  if (chartType === 'funnel' && series.length > 0) {
    const funnelPoints = series.map((s, i) => {
      const value = s.value ?? Math.round(100 - (i * 100 / series.length));
      return `    { name: ${JSON.stringify(s.name)}, value: ${value}, fill: ${JSON.stringify(s.color)} }`;
    });
    return (
      `const CHART_DATA_${componentName} = {\n` +
      `  "default": [\n${funnelPoints.join(',\n')}\n  ]\n` +
      `};`
    );
  }

  // Treemap: nested rectangle data
  if (chartType === 'treemap' && series.length > 0) {
    const treemapPoints = series.map((s, i) => {
      const value = s.value ?? Math.round(100 - i * 10);
      return `    { name: ${JSON.stringify(s.name)}, size: ${value}, fill: ${JSON.stringify(s.color)} }`;
    });
    return (
      `const CHART_DATA_${componentName} = {\n` +
      `  "default": [\n${treemapPoints.join(',\n')}\n  ]\n` +
      `};`
    );
  }

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

  // Bar chart with extracted data from Figma bar heights — use actual values
  if (chartType === 'bar' && meta.barData && meta.barData.length > 0) {
    const hasPerBarColors = meta.barData.some((d) => d.color);
    const barPoints = meta.barData.map((d) => {
      const colorPart = hasPerBarColors && d.color ? `, color: ${JSON.stringify(d.color)}` : '';
      return `    { name: ${JSON.stringify(d.name)}, value: ${d.value}${colorPart} }`;
    });
    return (
      `const CHART_DATA_${componentName} = {\n` +
      `  "default": [\n${barPoints.join(',\n')}\n  ]\n` +
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

  // Treemap: it IS both container and data element
  if (chartType === 'treemap') {
    return (
      `<Treemap\n` +
      `          data={data}\n` +
      `          dataKey="size"\n` +
      `          nameKey="name"\n` +
      `          aspectRatio={4 / 3}\n` +
      `          stroke="#fff"\n` +
      `          content={({ x, y, width, height, name, fill }) => (\n` +
      `            <g>\n` +
      `              <rect x={x} y={y} width={width} height={height} fill={fill} stroke="#fff" />\n` +
      `              {width > 50 && height > 20 && (\n` +
      `                <text x={x + width / 2} y={y + height / 2} textAnchor="middle" dominantBaseline="central" fontSize={12} fill="#fff">{name}</text>\n` +
      `              )}\n` +
      `            </g>\n` +
      `          )}\n` +
      `        />`
    );
  }

  if (!def.cartesian) {
    // Non-cartesian (pie, donut, radial, radar, funnel) — no cartesian axes/grid
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
    `          <Tooltip content={<${tooltipName(meta)} />} />\n` +
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

  if (chartType === 'radar') {
    const outerR = Math.round(meta.chartAreaHeight * 0.35);
    return ` cx="50%" cy="50%" outerRadius={${outerR}} data={data}`;
  }

  if (chartType === 'funnel') {
    return ''; // FunnelChart takes no special container props
  }

  if (chartType === 'treemap') {
    return ''; // Treemap is both container and data element
  }

  // Cartesian charts — only emit margin if Figma provided padding data
  if (!chartMargin) return '';
  const { top, right, bottom, left } = chartMargin;
  return ` margin={{ top: ${top}, right: ${right}, left: ${left}, bottom: ${bottom} }}`;
}

// ── Data element props (Pie, Bar, Line, Area, RadialBar) ───────────────────

function buildDataElementProps(meta: ChartMetadata, def: RechartsComponentDef): string {
  const { chartType, series } = meta;
  const primaryColor = series[0]?.color ?? '#000000';
  const isMultiSeries = series.length > 1;
  const el = def.dataElement; // 'Pie', 'Bar', 'Line', 'Area', 'RadialBar'

  // ── Pie / Donut ──
  if (el === 'Pie') {
    const outerRadius = Math.round(meta.chartAreaHeight / 2);
    const innerRadius = chartType === 'donut'
      ? Math.round(outerRadius * (meta.innerRadiusRatio > 0 ? meta.innerRadiusRatio : 0.6))
      : 0;

    // Center label for donut (e.g. "9.2K") — only emit style props that Figma provided
    let centerLabel = '';
    if (chartType === 'donut' && meta.donutCenterText) {
      const styleParts: string[] = [];
      if (meta.donutCenterFontSize != null) styleParts.push(`fontSize: '${meta.donutCenterFontSize}px'`);
      if (meta.donutCenterFontWeight != null) styleParts.push(`fontWeight: ${meta.donutCenterFontWeight}`);
      if (meta.donutCenterColor) styleParts.push(`fill: '${meta.donutCenterColor}'`);
      const styleAttr = styleParts.length > 0 ? ` style={{ ${styleParts.join(', ')} }}` : '';
      centerLabel = `\n            <Label position="center" value="${meta.donutCenterText}"${styleAttr} />`;
    }

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
      `          <Tooltip content={<${tooltipName(meta)} />} />\n`
    );
  }

  // ── Radial Bar ──
  if (el === 'RadialBar') {
    const trackColor = meta.rings[0]?.trackColor ?? '#f0f0f0';
    const cornerRadius = Math.round(meta.chartAreaHeight * 0.05);

    // Center label for radial charts — only emit style props that Figma provided
    let centerLabel = '';
    if (meta.donutCenterText) {
      const hasSubtext = meta.centerSubtext;
      const mainY = hasSubtext ? '46%' : '50%';
      const mainStyle: string[] = [];
      if (meta.donutCenterFontSize != null) mainStyle.push(`fontSize: '${meta.donutCenterFontSize}px'`);
      if (meta.donutCenterFontWeight != null) mainStyle.push(`fontWeight: ${meta.donutCenterFontWeight}`);
      if (meta.donutCenterColor) mainStyle.push(`fill: '${meta.donutCenterColor}'`);
      const mainStyleAttr = mainStyle.length > 0 ? ` style={{ ${mainStyle.join(', ')} }}` : '';
      centerLabel = `\n          <text x="50%" y="${mainY}" textAnchor="middle" dominantBaseline="central"${mainStyleAttr}>${meta.donutCenterText}</text>`;
      if (hasSubtext) {
        const subStyle: string[] = [];
        if (meta.centerSubtextFontSize != null) subStyle.push(`fontSize: '${meta.centerSubtextFontSize}px'`);
        if (meta.centerSubtextFontWeight != null) subStyle.push(`fontWeight: ${meta.centerSubtextFontWeight}`);
        if (meta.centerSubtextColor) subStyle.push(`fill: '${meta.centerSubtextColor}'`);
        const subStyleAttr = subStyle.length > 0 ? ` style={{ ${subStyle.join(', ')} }}` : '';
        centerLabel += `\n          <text x="50%" y="56%" textAnchor="middle" dominantBaseline="central"${subStyleAttr}>${meta.centerSubtext}</text>`;
      }
    }

    return (
      `          <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />\n` +
      `          <${el}\n` +
      `            background={{ fill: '${trackColor}' }}\n` +
      `            dataKey="value"\n` +
      `            angleAxisId={0}\n` +
      `            cornerRadius={${cornerRadius}}\n` +
      `          />\n` +
      `          <Tooltip content={<${tooltipName(meta)} />} />${centerLabel}\n`
    );
  }

  // ── Radar ──
  if (el === 'Radar') {
    const radarAxes = meta.radarAxes ?? [];
    const angleAxisDataKey = radarAxes.length > 0 ? 'subject' : 'name';

    let radarElements = '';
    if (isMultiSeries) {
      radarElements = series.map((s) =>
        `          <${el} name="${s.name}" dataKey=${JSON.stringify(s.name)} stroke="${s.color}" fill="${s.color}" fillOpacity={0.15} />\n`,
      ).join('');
    } else {
      radarElements =
        `          <${el} name="Value" dataKey="value" stroke="${primaryColor}" fill="${primaryColor}" fillOpacity={0.25} />\n`;
    }

    return (
      `          <PolarGrid />\n` +
      `          <PolarAngleAxis dataKey="${angleAxisDataKey}"${buildTickProp(meta)} />\n` +
      `          <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />\n` +
      radarElements +
      `          <Tooltip content={<${tooltipName(meta)} />} />\n`
    );
  }

  // ── Funnel ──
  if (el === 'Funnel') {
    return (
      `          <Tooltip content={<${tooltipName(meta)} />} />\n` +
      `          <${el} dataKey="value" data={data} isAnimationActive>\n` +
      `            <LabelList position="right" fill="#000" stroke="none" dataKey="name" />\n` +
      `            {data.map((entry, index) => (\n` +
      `              <Cell key={index} fill={entry.fill} />\n` +
      `            ))}\n` +
      `          </${el}>\n`
    );
  }

  // ── Treemap ──
  if (el === 'Treemap') {
    // Treemap is special — it's both the container and data element
    // The container props are built here instead
    return (
      `          <Tooltip content={<${tooltipName(meta)} />} />\n`
    );
  }

  // ── Scatter ──
  if (el === 'Scatter') {
    if (isMultiSeries) {
      return series.map((s) =>
        `          <${el} name="${s.name}" data={data} fill="${s.color}" />\n`,
      ).join('');
    }
    return `          <${el} name="Data" data={data} fill="${primaryColor}" />\n`;
  }

  // ── Bar with Figma-extracted barData (per-bar colors + values) ──
  // When barData exists, data uses { name, value, color } — single dataKey "value".
  // This MUST be checked before multi-series branch, because series.length may be > 1
  // (from legend extraction) but the data is NOT multi-series — it's one value per bar.
  if (el === 'Bar' && meta.barData && meta.barData.length > 0) {
    const hasPerBarColors = meta.barData.some((d) => d.color);
    const radiusProp = meta.barRadius ? ` radius={[${meta.barRadius.join(', ')}]}` : '';
    if (hasPerBarColors) {
      return (
        `          <${el} dataKey="value"${radiusProp}>\n` +
        `            {data.map((entry, index) => (\n` +
        `              <Cell key={index} fill={entry.color} />\n` +
        `            ))}\n` +
        `          </${el}>\n`
      );
    }
    return `          <${el} dataKey="value" fill="${primaryColor}"${radiusProp} />\n`;
  }

  // ── Cartesian elements (Bar without barData, Line, Area) — single series ──
  if (!isMultiSeries) {
    return `          <${el} ${buildElementProps(el, 'value', primaryColor, meta, 0)} />\n`;
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

  // Dot props — only emit what Figma provided
  const dotParts: string[] = [`fill: '${color}'`];
  if (dotStrokeColor) dotParts.push(`stroke: '${dotStrokeColor}'`);
  if (dotStrokeWidth != null) dotParts.push(`strokeWidth: ${dotStrokeWidth}`);
  if (dotRadius != null) dotParts.push(`r: ${dotRadius}`);
  const activeParts = [...dotParts.filter(p => !p.startsWith('r:'))];
  if (dotRadius != null) activeParts.push(`r: ${dotRadius + 2}`);
  const dotProps = `dot={{ ${dotParts.join(', ')} }} activeDot={{ ${activeParts.join(', ')} }}`;

  const strokeW = seriesStrokeWidth != null ? ` strokeWidth={${seriesStrokeWidth}}` : '';

  switch (el) {
    case 'Bar': {
      const radiusProp = barRadius ? ` radius={[${barRadius.join(', ')}]}` : '';
      return `dataKey="${dataKey}" fill="${color}"${radiusProp}`;
    }
    case 'Area': {
      const gradientId = meta.series.length > 1 ? `${bemBase}-gradient-${index}` : `${bemBase}-gradient`;
      return `type="monotone" dataKey="${dataKey}" stroke="${color}"${strokeW} fill="url(#${gradientId})" ${dotProps}`;
    }
    case 'Line':
    default:
      return `type="monotone" dataKey="${dataKey}" stroke="${color}"${strokeW} ${dotProps}`;
  }
}

// ── Cartesian axes + grid ──────────────────────────────────────────────────

function buildCartesianProps(meta: ChartMetadata): string {
  const { axisLabelColor, axisFontSize, gridLineColor, gridStrokeDasharray, yAxisMin, yAxisMax, yAxisWidth } = meta;

  // Grid — only emit stroke props if Figma provided them
  const gridParts: string[] = [];
  if (gridStrokeDasharray) gridParts.push(`strokeDasharray="${gridStrokeDasharray}"`);
  if (gridLineColor) gridParts.push(`stroke="${gridLineColor}"`);
  const gridProps = gridParts.length > 0 ? gridParts.join(' ') : '';

  // Axis tick styling — only emit what Figma provided
  const tickParts: string[] = [];
  if (axisLabelColor) tickParts.push(`fill: '${axisLabelColor}'`);
  if (axisFontSize != null) tickParts.push(`fontSize: ${axisFontSize}`);
  const tickProp = tickParts.length > 0 ? ` tick={{ ${tickParts.join(', ')} }}` : '';

  const xAxisProps = `dataKey="name"${tickProp} axisLine={false} tickLine={false}`;

  // Y-axis ticks
  const yTicks = meta.yAxisTicks?.length >= 2
    ? meta.yAxisTicks
    : (() => {
        const yRange = yAxisMax - yAxisMin;
        const yStep = yRange > 0 ? Math.round(yRange / 4) : 10;
        return [yAxisMin, yAxisMin + yStep, yAxisMin + yStep * 2, yAxisMin + yStep * 3, yAxisMax];
      })();

  const yAxisParts = [
    `domain={[${yAxisMin}, ${yAxisMax}]}`,
    `ticks={[${yTicks.join(', ')}]}`,
  ];
  if (tickParts.length > 0) yAxisParts.push(`tick={{ ${tickParts.join(', ')} }}`);
  yAxisParts.push('axisLine={false}', 'tickLine={false}');
  if (yAxisWidth != null) yAxisParts.push(`width={${yAxisWidth}}`);

  return (
    `          <CartesianGrid ${gridProps} />\n` +
    `          <XAxis ${xAxisProps} />\n` +
    `          <YAxis ${yAxisParts.join(' ')} />\n`
  );
}

// ── Gradient defs for area charts ──────────────────────────────────────────

function buildGradientDefs(meta: ChartMetadata): string {
  const { series, bemBase, gradientStartOpacity } = meta;
  const isMultiSeries = series.length > 1;
  // Only emit stopOpacity if Figma provided a gradient opacity value
  const opacityProp = gradientStartOpacity != null ? ` stopOpacity={${gradientStartOpacity}}` : '';

  const gradients = isMultiSeries
    ? series.map((s, i) =>
        `            <linearGradient id="${bemBase}-gradient-${i}" x1="0" y1="0" x2="0" y2="1">\n` +
        `              <stop offset="0%" stopColor="${s.color}"${opacityProp} />\n` +
        `              <stop offset="100%" stopColor="${s.color}" stopOpacity={0} />\n` +
        `            </linearGradient>`,
      ).join('\n')
    : `            <linearGradient id="${bemBase}-gradient" x1="0" y1="0" x2="0" y2="1">\n` +
      `              <stop offset="0%" stopColor="${series[0]?.color ?? '#000'}"${opacityProp} />\n` +
      `              <stop offset="100%" stopColor="${series[0]?.color ?? '#000'}" stopOpacity={0} />\n` +
      `            </linearGradient>`;

  return (
    `          <defs>\n` +
    gradients + '\n' +
    `          </defs>\n`
  );
}

// ── CSS generation ─────────────────────────────────────────────────────────

/**
 * Helper: builds a CSS rule block, only including properties that have defined values.
 * Omits the entire block if no properties have values.
 */
function cssBlock(selector: string, props: Array<[string, string | number | undefined]>): string {
  const lines = props
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `  ${k}: ${v};`);
  if (lines.length === 0) return '';
  return `${selector} {\n${lines.join('\n')}\n}\n`;
}

function buildCSS(meta: ChartMetadata): string {
  const { bemBase } = meta;
  const p = meta.containerPadding;
  const padStr = p ? `${p.top}px ${p.right}px ${p.bottom}px ${p.left}px` : undefined;

  let css = '';

  // Container
  css += cssBlock(`.${bemBase}`, [
    ['background', meta.backgroundColor],
    ['border-radius', meta.containerBorderRadius != null ? `${meta.containerBorderRadius}px` : undefined],
    ['padding', padStr],
    ['width', '100%'],
    ['box-sizing', 'border-box'],
    ['overflow', 'hidden'],
    ['position', 'relative'],
  ]);

  // Legends
  css += cssBlock(`.${bemBase}__legends`, [
    ['display', 'flex'],
    ['align-items', 'center'],
    ['gap', meta.legendGap != null ? `${meta.legendGap}px` : undefined],
    ['margin-bottom', meta.legendMarginBottom != null ? `${meta.legendMarginBottom}px` : undefined],
    ['flex-wrap', 'wrap'],
  ]);

  css += cssBlock(`.${bemBase}__legend`, [
    ['display', 'flex'],
    ['align-items', 'center'],
    ['gap', meta.legendItemGap != null ? `${meta.legendItemGap}px` : undefined],
  ]);

  css += cssBlock(`.${bemBase}__legend-dot`, [
    ['width', meta.legendDotSize != null ? `${meta.legendDotSize}px` : undefined],
    ['height', meta.legendDotSize != null ? `${meta.legendDotSize}px` : undefined],
    ['border-radius', meta.legendDotBorderRadius],
    ['display', 'inline-block'],
    ['opacity', meta.legendDotOpacity != null ? `${meta.legendDotOpacity}` : undefined],
  ]);

  css += cssBlock(`.${bemBase}__legend-label`, [
    ['font-size', meta.legendLabelFontSize != null ? `${meta.legendLabelFontSize}px` : undefined],
    ['color', meta.legendLabelColor],
  ]);

  // Tooltip — minimal structural CSS only, no hardcoded colors
  css += cssBlock(`.${bemBase}__tooltip`, [
    ['background', meta.backgroundColor],
    ['border-radius', '8px'],
    ['padding', '8px 12px'],
  ]);

  css += cssBlock(`.${bemBase}__tooltip-label`, [
    ['margin', '0 0 4px 0'],
  ]);

  css += cssBlock(`.${bemBase}__tooltip-item`, [
    ['margin', '2px 0'],
  ]);

  // Switchers
  css += cssBlock(`.${bemBase}__switchers`, [
    ['display', 'flex'],
    ['background', meta.switcherBg],
    ['border-radius', meta.switcherBorderRadius != null ? `${meta.switcherBorderRadius}px` : undefined],
    ['padding', meta.switcherPadding],
    ['margin-top', meta.switcherMarginTop != null ? `${meta.switcherMarginTop}px` : undefined],
  ]);

  css += cssBlock(`.${bemBase}__switcher`, [
    ['flex', '1'],
    ['padding', meta.switcherButtonPadding],
    ['font-size', meta.switcherButtonFontSize != null ? `${meta.switcherButtonFontSize}px` : undefined],
    ['color', meta.switcherButtonColor],
    ['background', 'transparent'],
    ['border', 'none'],
    ['border-radius', meta.switcherButtonBorderRadius != null ? `${meta.switcherButtonBorderRadius}px` : undefined],
    ['cursor', 'pointer'],
  ]);

  css += cssBlock(`.${bemBase}__switcher--active`, [
    ['background', meta.switcherActiveBg],
    ['color', meta.switcherActiveColor],
    ['font-weight', meta.switcherActiveFontWeight != null ? `${meta.switcherActiveFontWeight}` : undefined],
    ['box-shadow', meta.switcherActiveBoxShadow],
  ]);

  // Header / title / subtitle — only if title exists
  if (meta.chartTitle) {
    css += cssBlock(`.${bemBase}__title`, [
      ['font-size', meta.titleFontSize != null ? `${meta.titleFontSize}px` : undefined],
      ['font-weight', meta.titleFontWeight != null ? `${meta.titleFontWeight}` : undefined],
      ['margin', '0 0 4px 0'],
      ['color', meta.titleColor],
    ]);

    if (meta.chartSubtitle) {
      css += cssBlock(`.${bemBase}__subtitle`, [
        ['font-size', meta.subtitleFontSize != null ? `${meta.subtitleFontSize}px` : undefined],
        ['color', meta.subtitleColor],
        ['margin', '0'],
      ]);
    }
  }

  // Summary — only if summary amount exists
  if (meta.summaryAmount) {
    css += cssBlock(`.${bemBase}__summary`, [
      ['margin-top', '16px'],
      ['padding', meta.summaryPadding],
      ['border-radius', meta.summaryBorderRadius != null ? `${meta.summaryBorderRadius}px` : undefined],
      ['border', meta.summaryBorderWidth != null && meta.summaryBorderColor ? `${meta.summaryBorderWidth}px solid ${meta.summaryBorderColor}` : undefined],
      ['background', meta.summaryBg],
    ]);

    css += cssBlock(`.${bemBase}__amount`, [
      ['display', 'block'],
      ['font-size', meta.amountFontSize != null ? `${meta.amountFontSize}px` : undefined],
      ['font-weight', meta.amountFontWeight != null ? `${meta.amountFontWeight}` : undefined],
      ['color', meta.amountColor],
    ]);

    if (meta.summaryText) {
      css += cssBlock(`.${bemBase}__summary-text`, [
        ['font-size', meta.summaryTextFontSize != null ? `${meta.summaryTextFontSize}px` : undefined],
        ['color', meta.summaryTextColor],
        ['margin', '0 0 12px 0'],
      ]);
    }

    if (meta.summaryCtaText) {
      css += cssBlock(`.${bemBase}__summary-cta`, [
        ['display', 'block'],
        ['width', '100%'],
        ['padding', meta.ctaPadding],
        ['font-size', meta.ctaFontSize != null ? `${meta.ctaFontSize}px` : undefined],
        ['font-weight', meta.ctaFontWeight != null ? `${meta.ctaFontWeight}` : undefined],
        ['color', meta.ctaColor],
        ['background', meta.ctaBg],
        ['border', meta.ctaBorderColor ? `1px solid ${meta.ctaBorderColor}` : undefined],
        ['border-radius', meta.ctaBorderRadius != null ? `${meta.ctaBorderRadius}px` : undefined],
        ['cursor', 'pointer'],
        ['text-align', 'center'],
      ]);
    }
  }

  return css;
}
