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

import type { ChartMetadata, ChartType, SeriesInfo } from '../figma/chart-detection.js';

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
  const { componentName, bemBase, hasSwitcher, periodOptions, hasLegend, series } = meta;

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
      series.map((s, i) =>
        `        <div className="${bemBase}__legend">\n` +
        `          <span className="${bemBase}__legend-dot" style={{ background: '${s.legendColor}' }} />\n` +
        `          <span className="${bemBase}__legend-label">${s.name}</span>\n` +
        `        </div>`,
      ).join('\n') + `\n` +
      `      </div>`
    : '';

  // Title/subtitle section above the chart
  const titleSection = meta.chartTitle
    ? `\n      <div className="${bemBase}__header">` +
      `\n        <h3 className="${bemBase}__title">${meta.chartTitle}</h3>` +
      (meta.chartSubtitle ? `\n        <p className="${bemBase}__subtitle">${meta.chartSubtitle}</p>` : '') +
      `\n      </div>`
    : '';

  // Summary section below the chart (amount + description + CTA)
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
  const { xAxisLabels, yAxisMin, yAxisMax, dataPointCount, periodOptions, hasSwitcher, series } = meta;

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
        // Single series — use "value" key for backwards compatibility
        const value = Math.round(base + amplitude * Math.sin((i + periodIdx * 3) * 0.8));
        return `    { name: ${JSON.stringify(name)}, value: ${value} }`;
      } else {
        // Multi-series — one key per series
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

function buildChartJSX(meta: ChartMetadata): string {
  const {
    chartType, series, axisLabelColor, bemBase, yAxisMin, yAxisMax,
    axisFontSize, gridLineColor, gridStrokeDasharray, yAxisWidth,
    dotRadius, dotStrokeColor, dotStrokeWidth, seriesStrokeWidth,
    gradientStartOpacity, barRadius, chartMargin,
  } = meta;

  const primaryColor = series[0]?.color ?? '#9747ff';
  const isMultiSeries = series.length > 1;

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

  const marginAttr = 'margin={{ top: ' + mTop + ', right: ' + mRight + ', left: ' + mLeft + ', bottom: ' + mBottom + ' }}';

  const commonAxes =
    '          <CartesianGrid ' + gridProps + ' />\n' +
    '          <XAxis ' + xAxisProps + ' />\n' +
    '          <YAxis ' + yAxisProps + ' />\n' +
    '          <Tooltip />\n';

  // Build per-series dot props helper
  const buildDotProps = (color: string) => {
    const activeDotRadius = dotRadius + 2;
    return 'dot={{ fill: \'' + color + '\', stroke: \'' + dotStrokeColor + '\', strokeWidth: ' + dotStrokeWidth + ', r: ' + dotRadius + ' }} ' +
      'activeDot={{ fill: \'' + color + '\', stroke: \'' + dotStrokeColor + '\', strokeWidth: ' + dotStrokeWidth + ', r: ' + activeDotRadius + ' }}';
  };

  // Build series data elements
  const buildSeriesElements = (elementType: 'Area' | 'Bar' | 'Line'): string => {
    if (!isMultiSeries) {
      const color = primaryColor;
      const dataKey = 'value';
      switch (elementType) {
        case 'Area':
          return '          <Area type="monotone" dataKey="' + dataKey + '" stroke="' + color + '" strokeWidth={' + seriesStrokeWidth + '} fill="url(#' + bemBase + '-gradient)" ' + buildDotProps(color) + ' />\n';
        case 'Bar':
          return '          <Bar dataKey="' + dataKey + '" fill="' + color + '" radius={[' + barRadius.join(', ') + ']} />\n';
        case 'Line':
          return '          <Line type="monotone" dataKey="' + dataKey + '" stroke="' + color + '" strokeWidth={' + seriesStrokeWidth + '} ' + buildDotProps(color) + ' />\n';
      }
    }

    return series.map((s, i) => {
      const dataKey = `series${i}`;
      const color = s.color;
      switch (elementType) {
        case 'Area':
          return '          <Area type="monotone" dataKey="' + dataKey + '" stroke="' + color + '" strokeWidth={' + seriesStrokeWidth + '} fill="url(#' + bemBase + '-gradient-' + i + ')" ' + buildDotProps(color) + ' />';
        case 'Bar':
          return '          <Bar dataKey="' + dataKey + '" fill="' + color + '" radius={[' + barRadius.join(', ') + ']} />';
        case 'Line':
          return '          <Line type="monotone" dataKey="' + dataKey + '" stroke="' + color + '" strokeWidth={' + seriesStrokeWidth + '} ' + buildDotProps(color) + ' />';
      }
    }).join('\n') + '\n';
  };

  switch (chartType) {
    case 'area': {
      const gradientDefs = isMultiSeries
        ? series.map((s, i) =>
            '            <linearGradient id="' + bemBase + '-gradient-' + i + '" x1="0" y1="0" x2="0" y2="1">\n' +
            '              <stop offset="0%" stopColor="' + s.color + '" stopOpacity={' + gradientStartOpacity + '} />\n' +
            '              <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />\n' +
            '            </linearGradient>',
          ).join('\n')
        : '            <linearGradient id="' + bemBase + '-gradient" x1="0" y1="0" x2="0" y2="1">\n' +
          '              <stop offset="0%" stopColor="' + primaryColor + '" stopOpacity={' + gradientStartOpacity + '} />\n' +
          '              <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />\n' +
          '            </linearGradient>';

      return (
        '<AreaChart data={data} ' + marginAttr + '>\n' +
        '          <defs>\n' +
        gradientDefs + '\n' +
        '          </defs>\n' +
        commonAxes +
        buildSeriesElements('Area') +
        '        </AreaChart>'
      );
    }

    case 'bar':
      return (
        '<BarChart data={data} ' + marginAttr + '>\n' +
        commonAxes +
        buildSeriesElements('Bar') +
        '        </BarChart>'
      );

    case 'line':
    case 'unknown':
    default:
      return (
        '<LineChart data={data} ' + marginAttr + '>\n' +
        commonAxes +
        buildSeriesElements('Line') +
        '        </LineChart>'
      );
  }
}

// ── CSS generation ──────────────────────────────────────────────────────────

function buildCSS(meta: ChartMetadata): string {
  const {
    bemBase, backgroundColor, series,
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
