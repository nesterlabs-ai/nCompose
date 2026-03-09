/**
 * Recharts code generator.
 *
 * Generates a standalone React component file (.jsx) and CSS file (.css)
 * for a chart section detected from the Figma tree.
 *
 * The generated component follows the reference pattern:
 * - useState for period switching
 * - useMemo for filtered data
 * - Recharts LineChart/AreaChart with axis styling from Figma
 * - Period toggle buttons
 */

import type { ChartMetadata, ChartType } from '../figma/chart-detection.js';

export interface ChartCodeResult {
  reactCode: string;
  css: string;
}

/**
 * Generate a complete standalone React chart component + CSS.
 */
export function generateChartCode(meta: ChartMetadata): ChartCodeResult {
  const reactCode = buildReactCode(meta);
  const css = buildCSS(meta);
  return { reactCode, css };
}

// ── React code generation ───────────────────────────────────────────────────

function buildReactCode(meta: ChartMetadata): string {
  const { componentName, bemBase, hasSwitcher, periodOptions, hasLegend, seriesName } = meta;

  const rechartsImports = getRechartsImports(meta.chartType);
  const dataCode = buildChartData(meta);
  const chartJSX = buildChartJSX(meta);

  // Default state: second option or first if only one
  const defaultPeriod =
    hasSwitcher && periodOptions.length >= 2
      ? periodOptions[1]
      : periodOptions[0] ?? 'default';

  // Switcher buttons
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

  const legendsSection = hasLegend
    ? `\n      <div className="${bemBase}__legends">\n` +
      `        <div className="${bemBase}__legend">\n` +
      `          <span className="${bemBase}__legend-dot" />\n` +
      `          <span className="${bemBase}__legend-label">${seriesName}</span>\n` +
      `        </div>\n` +
      `      </div>`
    : '';

  return `import { useState, useMemo } from 'react';
import {
  ${rechartsImports.join(',\n  ')}
} from 'recharts';
import './${componentName}.css';

${dataCode}

export default function ${componentName}() {
  const [view, setView] = useState('${defaultPeriod}');
  const data = useMemo(() => CHART_DATA[view] ?? CHART_DATA['${defaultPeriod}'], [view]);

  return (
    <figure className="${bemBase}">${legendsSection}
      <ResponsiveContainer width="100%" height={229}>
        ${chartJSX}
      </ResponsiveContainer>${switcherSection}
    </figure>
  );
}
`;
}

function getRechartsImports(chartType: ChartType): string[] {
  const base = ['ResponsiveContainer', 'CartesianGrid', 'XAxis', 'YAxis', 'Tooltip'];
  switch (chartType) {
    case 'area':
      return ['AreaChart', 'Area', ...base];
    case 'bar':
      return ['BarChart', 'Bar', ...base];
    case 'pie':
    case 'donut':
      return ['PieChart', 'Pie', 'Cell', 'Tooltip', 'ResponsiveContainer', 'Legend'];
    case 'line':
    case 'unknown':
    default:
      return ['LineChart', 'Line', ...base];
  }
}

function buildChartData(meta: ChartMetadata): string {
  const { xAxisLabels, yAxisMin, yAxisMax, dataPointCount, periodOptions, hasSwitcher } = meta;

  const count = Math.max(dataPointCount, xAxisLabels.length || 1);
  const labels =
    xAxisLabels.length > 0
      ? xAxisLabels
      : Array.from({ length: count }, (_, i) => `Point ${i + 1}`);

  const periods =
    hasSwitcher && periodOptions.length >= 1 ? periodOptions : ['default'];

  const periodDataEntries = periods.map((period, periodIdx) => {
    const points = labels.map((name, i) => {
      // Deterministic synthetic values using a sine curve
      const range = Math.max(yAxisMax - yAxisMin, 1);
      const base = yAxisMin + range * 0.5;
      const amplitude = range * 0.25;
      const value = Math.round(base + amplitude * Math.sin((i + periodIdx * 3) * 0.8));
      return `    { name: ${JSON.stringify(name)}, value: ${value} }`;
    });
    return `  ${JSON.stringify(period)}: [\n${points.join(',\n')}\n  ]`;
  });

  return (
    `const CHART_DATA = {\n` +
    `${periodDataEntries.join(',\n')}\n` +
    `};`
  );
}

function buildChartJSX(meta: ChartMetadata): string {
  const { chartType, seriesColor, axisLabelColor, bemBase, yAxisMin, yAxisMax } = meta;

  const xAxisProps = `dataKey="name" tick={{ fill: '${axisLabelColor}', fontSize: 10 }} axisLine={false} tickLine={false}`;
  // Include both vertical and horizontal grid lines (matching Figma)
  const gridProps = `strokeDasharray="3 3" stroke="#E5E7EB"`;

  // Build Y-axis ticks from extracted Figma values
  const yRange = yAxisMax - yAxisMin;
  const yStep = yRange > 0 ? Math.round(yRange / 4) : 10;
  const yTicks = [yAxisMin, yAxisMin + yStep, yAxisMin + yStep * 2, yAxisMin + yStep * 3, yAxisMax];
  const yAxisProps =
    `domain={[${yAxisMin}, ${yAxisMax}]} ticks={[${yTicks.join(', ')}]} ` +
    `tick={{ fill: '${axisLabelColor}', fontSize: 10 }} axisLine={false} tickLine={false} width={28}`;

  // Dot styling: purple fill + white border (matching Figma LegendNode ELLIPSE)
  const dotProps = `dot={{ fill: '${seriesColor}', stroke: '#ffffff', strokeWidth: 2, r: 3 }} activeDot={{ fill: '${seriesColor}', stroke: '#ffffff', strokeWidth: 2, r: 5 }}`;

  switch (chartType) {
    case 'area':
      return (
        `<AreaChart data={data} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>\n` +
        `          <defs>\n` +
        `            <linearGradient id="${bemBase}-gradient" x1="0" y1="0" x2="0" y2="1">\n` +
        // Figma bg vector: GRADIENT_LINEAR from rgba(series,0.75) → rgba(white,0)
        `              <stop offset="0%" stopColor="${seriesColor}" stopOpacity={0.75} />\n` +
        `              <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />\n` +
        `            </linearGradient>\n` +
        `          </defs>\n` +
        `          <CartesianGrid ${gridProps} />\n` +
        `          <XAxis ${xAxisProps} />\n` +
        `          <YAxis ${yAxisProps} />\n` +
        `          <Tooltip />\n` +
        `          <Area type="monotone" dataKey="value" stroke="${seriesColor}" strokeWidth={2} fill="url(#${bemBase}-gradient)" ${dotProps} />\n` +
        `        </AreaChart>`
      );

    case 'bar':
      return (
        `<BarChart data={data} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>\n` +
        `          <CartesianGrid ${gridProps} />\n` +
        `          <XAxis ${xAxisProps} />\n` +
        `          <YAxis ${yAxisProps} />\n` +
        `          <Tooltip />\n` +
        `          <Bar dataKey="value" fill="${seriesColor}" radius={[4, 4, 0, 0]} />\n` +
        `        </BarChart>`
      );

    case 'line':
    case 'unknown':
    default:
      return (
        `<LineChart data={data} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>\n` +
        `          <CartesianGrid ${gridProps} />\n` +
        `          <XAxis ${xAxisProps} />\n` +
        `          <YAxis ${yAxisProps} />\n` +
        `          <Tooltip />\n` +
        `          <Line type="monotone" dataKey="value" stroke="${seriesColor}" strokeWidth={2} ${dotProps} />\n` +
        `        </LineChart>`
      );
  }
}

// ── CSS generation ──────────────────────────────────────────────────────────

function buildCSS(meta: ChartMetadata): string {
  const { bemBase, backgroundColor, seriesColor } = meta;

  return `.${bemBase} {
  background: ${backgroundColor};
  border-radius: 8px;
  padding: 16px;
  width: 100%;
  box-sizing: border-box;
}

.${bemBase}__legends {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.${bemBase}__legend {
  display: flex;
  align-items: center;
  gap: 6px;
}

.${bemBase}__legend-dot {
  width: 10px;
  height: 10px;
  background: ${seriesColor};
  border-radius: 50%;
  display: inline-block;
  opacity: 0.75;
}

.${bemBase}__legend-label {
  font-size: 12px;
  color: #262626;
}

.${bemBase}__switchers {
  display: flex;
  background: #F5F5F5;
  border-radius: 6px;
  padding: 3px;
  margin-top: 12px;
}

.${bemBase}__switcher {
  flex: 1;
  padding: 6px 12px;
  font-size: 14px;
  color: #737373;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.${bemBase}__switcher--active {
  background: #ffffff;
  color: #262626;
  font-weight: 500;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
`;
}
