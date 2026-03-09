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
  const dataCode = buildChartData(meta, componentName);
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
  const data = useMemo(() => CHART_DATA_${componentName}[view] ?? CHART_DATA_${componentName}['${defaultPeriod}'], [view]);

  return (
    <figure className="${bemBase}">${legendsSection}
      <ResponsiveContainer width="100%" height={${meta.chartAreaHeight}}>
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

function buildChartData(meta: ChartMetadata, componentName: string): string {
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
    `const CHART_DATA_${componentName} = {\n` +
    `${periodDataEntries.join(',\n')}\n` +
    `};`
  );
}

function buildChartJSX(meta: ChartMetadata): string {
  const {
    chartType, seriesColor, axisLabelColor, bemBase, yAxisMin, yAxisMax,
    axisFontSize, gridLineColor, gridStrokeDasharray, yAxisWidth,
    dotRadius, dotStrokeColor, dotStrokeWidth, seriesStrokeWidth,
    gradientStartOpacity, barRadius, chartMargin,
  } = meta;

  const mTop = chartMargin.top;
  const mRight = chartMargin.right;
  const mBottom = chartMargin.bottom;
  const mLeft = chartMargin.left;

  const xAxisProps = 'dataKey="name" tick={{ fill: \'' + axisLabelColor + '\', fontSize: ' + axisFontSize + ' }} axisLine={false} tickLine={false}';
  const gridProps = gridStrokeDasharray
    ? 'strokeDasharray="' + gridStrokeDasharray + '" stroke="' + gridLineColor + '"'
    : 'stroke="' + gridLineColor + '"';

  // Build Y-axis ticks from extracted Figma values
  const yRange = yAxisMax - yAxisMin;
  const yStep = yRange > 0 ? Math.round(yRange / 4) : 10;
  const yTicks = [yAxisMin, yAxisMin + yStep, yAxisMin + yStep * 2, yAxisMin + yStep * 3, yAxisMax];
  const yAxisProps =
    'domain={[' + yAxisMin + ', ' + yAxisMax + ']} ticks={[' + yTicks.join(', ') + ']} ' +
    'tick={{ fill: \'' + axisLabelColor + '\', fontSize: ' + axisFontSize + ' }} axisLine={false} tickLine={false} width={' + yAxisWidth + '}';

  const activeDotRadius = dotRadius + 2;
  const dotProps =
    'dot={{ fill: \'' + seriesColor + '\', stroke: \'' + dotStrokeColor + '\', strokeWidth: ' + dotStrokeWidth + ', r: ' + dotRadius + ' }} ' +
    'activeDot={{ fill: \'' + seriesColor + '\', stroke: \'' + dotStrokeColor + '\', strokeWidth: ' + dotStrokeWidth + ', r: ' + activeDotRadius + ' }}';

  const marginAttr = 'margin={{ top: ' + mTop + ', right: ' + mRight + ', left: ' + mLeft + ', bottom: ' + mBottom + ' }}';

  switch (chartType) {
    case 'area':
      return (
        '<AreaChart data={data} ' + marginAttr + '>\n' +
        '          <defs>\n' +
        '            <linearGradient id="' + bemBase + '-gradient" x1="0" y1="0" x2="0" y2="1">\n' +
        '              <stop offset="0%" stopColor="' + seriesColor + '" stopOpacity={' + gradientStartOpacity + '} />\n' +
        '              <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />\n' +
        '            </linearGradient>\n' +
        '          </defs>\n' +
        '          <CartesianGrid ' + gridProps + ' />\n' +
        '          <XAxis ' + xAxisProps + ' />\n' +
        '          <YAxis ' + yAxisProps + ' />\n' +
        '          <Tooltip />\n' +
        '          <Area type="monotone" dataKey="value" stroke="' + seriesColor + '" strokeWidth={' + seriesStrokeWidth + '} fill="url(#' + bemBase + '-gradient)" ' + dotProps + ' />\n' +
        '        </AreaChart>'
      );

    case 'bar':
      return (
        '<BarChart data={data} ' + marginAttr + '>\n' +
        '          <CartesianGrid ' + gridProps + ' />\n' +
        '          <XAxis ' + xAxisProps + ' />\n' +
        '          <YAxis ' + yAxisProps + ' />\n' +
        '          <Tooltip />\n' +
        '          <Bar dataKey="value" fill="' + seriesColor + '" radius={[' + barRadius.join(', ') + ']} />\n' +
        '        </BarChart>'
      );

    case 'line':
    case 'unknown':
    default:
      return (
        '<LineChart data={data} ' + marginAttr + '>\n' +
        '          <CartesianGrid ' + gridProps + ' />\n' +
        '          <XAxis ' + xAxisProps + ' />\n' +
        '          <YAxis ' + yAxisProps + ' />\n' +
        '          <Tooltip />\n' +
        '          <Line type="monotone" dataKey="value" stroke="' + seriesColor + '" strokeWidth={' + seriesStrokeWidth + '} ' + dotProps + ' />\n' +
        '        </LineChart>'
      );
  }
}

// ── CSS generation ──────────────────────────────────────────────────────────

function buildCSS(meta: ChartMetadata): string {
  const {
    bemBase, backgroundColor, seriesColor,
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
}

.${bemBase}__legends {
  display: flex;
  align-items: center;
  gap: ${legendGap}px;
  margin-bottom: ${legendMarginBottom}px;
}

.${bemBase}__legend {
  display: flex;
  align-items: center;
  gap: ${legendItemGap}px;
}

.${bemBase}__legend-dot {
  width: ${legendDotSize}px;
  height: ${legendDotSize}px;
  background: ${seriesColor};
  border-radius: ${legendDotBorderRadius};
  display: inline-block;
  opacity: ${legendDotOpacity};
}

.${bemBase}__legend-label {
  font-size: ${legendLabelFontSize}px;
  color: ${legendLabelColor};
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
`;
}
