# Plan: Recharts Chart Section — Separate File, Imported by Page

## Current State

All chart-related code was reverted. Starting from scratch:

- `src/figma/chart-detection.ts` — **does not exist**
- `src/compile/chart-codegen.ts` — **does not exist**
- `src/convert.ts` — no chart branch, no `assembleReactPageWithCharts`
- `src/types/index.ts` — no `chartComponents` field
- `src/output.ts` — no chart file writing
- `src/web/public/app.js` — no `chartComponents` in WebContainer tree
- `src/web/server.ts` — COEP/COOP headers ✅ (already added)
- `sanitizeJSXAttributes()` in `convert.ts` ✅ (already added)

---

## Reference Code Pattern (from user)

The generated chart **must match this exact structure**:

```jsx
import React, { useState, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

const MONTHS = ['Jan', 'Feb', ..., 'Dec'];

function useChartData(view) {
  return useMemo(() => {
    const base = [2, 4, 6, 8, 10, 12, 14, 15, 17, 18, 19, 20];
    return MONTHS.map((month, i) => ({
      month,
      'Interest earned': base[i],
    }));
  }, [view]);
}

function InterestEarnedChart() {
  const [view, setView] = useState('ytd');
  const data = useChartData(view);

  return (
    <div className="interest-chart-container">
      <div className="interest-chart-card">
        <div className="interest-chart-wrapper">
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={data} margin={{ top: 12, right: 12, left: 12, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e8e8e8" />
              <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 12 }}
                axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
              <YAxis hide domain={['auto', 'auto']} />
              <Tooltip formatter={(value) => [`${value}`, 'Interest earned']}
                contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb' }}
                labelFormatter={(label) => label} />
              <Legend align="center" wrapperStyle={{ paddingTop: 12 }}
                iconType="circle" iconSize={8}
                formatter={() => (
                  <span style={{ color: '#374151', fontSize: 14 }}>Interest earned</span>
                )} />
              <Line type="monotone" dataKey="Interest earned"
                stroke="#9966CC" strokeWidth={2}
                dot={{ fill: '#9966CC', r: 4, strokeWidth: 0 }}
                activeDot={{ r: 5, fill: '#9966CC', stroke: '#fff', strokeWidth: 2 }}
                connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="interest-chart-toggle">
          <button type="button" className={view === 'lifetime' ? 'active' : ''}
            onClick={() => setView('lifetime')}>Lifetime</button>
          <button type="button" className={view === 'ytd' ? 'active' : ''}
            onClick={() => setView('ytd')}>Year-to-date</button>
        </div>
      </div>
    </div>
  );
}

export default InterestEarnedChart;
```

**Key properties to extract from Figma node 10227-1981:**
- `stroke` color from the VECTOR line node → `#7C3AED` (or override with reference `#9966CC`)
- `seriesName` from Legends TEXT → `"Interest earned"`
- `xAxisLabels` from x axis TEXT nodes → Jan–Dec
- `yAxisLabels` from y axis TEXT nodes → 80, 90, 100, 110, 120
- `periodOptions` from switchers → `["Lifetime", "Year-to-date"]`
- `backgroundColor` from chart frame fill → `#F9FAFB`
- `axisLabelColor` from axis TEXT → `#A1A1A1`

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `src/figma/chart-detection.ts` | **CREATE** |
| `src/compile/chart-codegen.ts` | **CREATE** |
| `src/convert.ts` | **MODIFY** — add PATH D + chart branch in PATH C + `assembleReactPageWithCharts` |
| `src/compile/stitch.ts` | **MODIFY** — add `isChart`, `chartComponentName` to `SectionOutput` |
| `src/types/index.ts` | **MODIFY** — add `chartComponents` to `ConversionResult` |
| `src/output.ts` | **MODIFY** — write `ChartName.jsx` as separate file |
| `src/web/server.ts` | **MODIFY** — include `chartComponents` in SSE event + zip |
| `src/web/public/app.js` | **MODIFY** — add `chartComponents` to WebContainer tree + recharts detection |

---

## Step 1 — `src/figma/chart-detection.ts`

### `isChartSection(node): boolean`

Priority-ordered detection signals:
1. Node `.name` matches `/\b(chart|graph|plot|histogram|pie|donut|sparkline|analytics)\b/i`
2. Any child node name matches `/(y[\s-]?axis|x[\s-]?axis|legend|grid)\b/i`
3. Child GROUP or FRAME named `graph\s*\d*` containing VECTOR children

**Rule**: signal #1 alone = TRUE. signal #2 + #3 = TRUE. Otherwise FALSE.

### `detectChartType(node): ChartType`

**Two-tier approach** — structural first, LLM fallback for ambiguous cases:

**Tier 1 — Structural analysis (no LLM cost):**

| Figma structure | Detected type |
|---|---|
| Node name contains `bar chart` / `histogram` | `'bar'` |
| Node name contains `pie chart` | `'pie'` |
| Node name contains `donut` / `doughnut` | `'donut'` |
| Node name contains `area chart` | `'area'` |
| Node name contains `line chart` | `'line'` |
| Node name contains `scatter` | `'scatter'` |
| VECTOR named `bg` + VECTOR named `line` in graph group | `'area'` |
| VECTOR named `line` only in graph group | `'line'` |
| 3+ RECTANGLEs of similar width arranged in row | `'bar'` |
| ELLIPSE/ARC nodes in radial pattern | `'pie'` |
| None of the above | `'unknown'` |

**Tier 2 — LLM fallback (only when Tier 1 returns `'unknown'`):**

Send a **minimal prompt** to the LLM — just the layer names and types, no code generation:

```
System: You classify Figma chart types. Reply with ONLY one word.
User: Figma layer names: ["chart", "Frame 236", "lines vertical",
      "lines horizontal", "graph 1", "LegendNode", "y axis", "x axis",
      "Legends", "switchers"]
      Node types: FRAME, FRAME, FRAME, FRAME, GROUP, FRAME, FRAME, FRAME, FRAME, INSTANCE
      What chart type? Reply: line | bar | area | pie | donut | scatter
```

LLM returns `"area"` → use it. This is a **single fast token call** — not code generation,
no retry loop, minimal cost (~50 tokens total).

### `extractChartMetadata(node, llmProvider?): Promise<ChartMetadata>`

Walk the raw Figma tree to extract:

```typescript
interface ChartMetadata {
  chartType: 'line' | 'area' | 'bar' | 'pie' | 'donut' | 'scatter' | 'unknown';
  componentName: string;    // PascalCase for the file, e.g. "InterestEarnedChart"
  bemBase: string;          // kebab, e.g. "interest-earned-chart"
  width: number;
  height: number;
  seriesColor: string;      // from VECTOR "line" stroke color → e.g. "#7C3AED"
  seriesName: string;       // from Legends TEXT → e.g. "Interest earned"
  xAxisLabels: string[];    // from "x axis" frame TEXT nodes → ["Jan", ..., "Dec"]
  yAxisMin: number;         // parsed from y axis TEXTs
  yAxisMax: number;
  periodOptions: string[];  // from "switchers" TEXT nodes → ["Lifetime", "Year-to-date"]
  hasSwitcher: boolean;
  backgroundColor: string;  // chart frame fill → "#F9FAFB"
  axisLabelColor: string;   // axis TEXT color → "#A1A1A1"
}
```

After structural extraction, call `detectChartType(node)`:
- If result ≠ `'unknown'` → use it directly (no LLM)
- If result = `'unknown'` AND `llmProvider` provided → call LLM for type only
- If result = `'unknown'` AND no `llmProvider` → default to `'line'`

**Walk algorithm:**
- `seriesColor`: find FRAME/GROUP named `graph*` → find VECTOR named `line` → `strokes[0].color`
- `xAxisLabels`: find FRAME named `x axis` → collect all TEXT `characters` values
- `yAxisMin/Max`: find FRAME named `y axis` → collect TEXT values, parse as numbers, take min/max
- `seriesName`: find FRAME named `Legends` → find TEXT not inside a named rect → `characters`
- `periodOptions`: find INSTANCE named `switchers` → collect all TEXT `characters`
- `backgroundColor`: top-level frame `fills[0].color`
- `axisLabelColor`: any axis TEXT node `fills[0].color`
- `componentName`: derive from `seriesName` → PascalCase + "Chart" suffix
  e.g. `"Interest earned"` → `"InterestEarnedChart"`
- `bemBase`: derive from `componentName` → kebab-case
  e.g. `"InterestEarnedChart"` → `"interest-earned-chart"`

**Fallbacks when walk finds nothing:**
- `seriesColor` → `"#7C3AED"`
- `seriesName` → `"Value"`
- `xAxisLabels` → `["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]`
- `yAxisMin/Max` → `[80, 120]`
- `periodOptions` → `["Lifetime", "Year-to-date"]`
- `backgroundColor` → `"#F9FAFB"`
- `axisLabelColor` → `"#A1A1A1"`

---

## Step 2 — `src/compile/chart-codegen.ts`

### `generateChartCode(meta: ChartMetadata): { reactCode: string; css: string }`

Generates a **complete standalone React file** matching the reference pattern. The file:
- Has no wrapper `<>` fragment — just the outer `<div className="...container">`
- `export default function ${meta.componentName}()` — named for the series
- `const MONTHS = [...]` — from `meta.xAxisLabels`
- `BASE_VALUES` — 12 random ints between `meta.yAxisMin` and `meta.yAxisMax`
- `LIFETIME_VALUES` — separate 12 random ints in same range
- `useChartData(view)` → `useMemo` hook returning `MONTHS.map(...)`
- `dataKey` = `meta.seriesName` (e.g. `"Interest earned"`)
- `stroke` = `meta.seriesColor`
- Toggle buttons from `meta.periodOptions[0]` and `meta.periodOptions[1]`
- `YAxis hide domain={['auto', 'auto']}`
- `Legend` with custom `formatter` showing `meta.seriesName`

**Generated CSS** (uses `meta.bemBase` for class names):

```css
.{bemBase}-container {
  background: {meta.backgroundColor};
  border-radius: 12px;
  padding: 16px;
  width: 350px;
  font-family: inherit;
}
.{bemBase}-card { width: 100%; }
.{bemBase}-wrapper { width: 100%; }
.{bemBase}-toggle {
  display: flex; background: #F5F5F5; border-radius: 8px;
  padding: 3px; margin-top: 12px; gap: 2px;
}
.{bemBase}-toggle button {
  flex: 1; padding: 6px 12px; font-size: 14px; font-weight: 500;
  color: #737373; background: transparent; border: none;
  border-radius: 6px; cursor: pointer;
  transition: background 0.15s, color 0.15s, box-shadow 0.15s;
}
.{bemBase}-toggle button.active {
  background: #ffffff; color: #262626;
  box-shadow: 0 1px 3px rgba(0,0,0,0.10);
}
.{bemBase}-toggle button:hover:not(.active) { color: #404040; }
```

**CSS is NOT injected into the JSX file** — it stays in a separate `.css` field in the result.

### `generateChartPlaceholder(meta, framework): string`

For non-React frameworks, returns:
```html
<!-- Chart: line | Install vue-chartjs / svelte-chartjs / ng2-charts -->
<div class="{bemBase}-container">
  <p>{meta.seriesName} Chart — recharts not available for {framework}</p>
</div>
```

---

## Step 3 — `src/compile/stitch.ts` changes

Add two fields to `SectionOutput`:

```typescript
export interface SectionOutput {
  info: SectionInfo;
  rawCode: string;
  css: string;
  failed?: boolean;
  /** Chart sections carry raw React JSX, skip Mitosis */
  isChart?: boolean;
  /** PascalCase name of the generated chart file, e.g. "InterestEarnedChart" */
  chartComponentName?: string;
}
```

In `stitchPageComponent()`, chart sections emit a **static placeholder** tag (so Mitosis can parse the stitched source):

```typescript
if (section.isChart) {
  const tag = section.info.semanticTag;
  const cls = section.info.baseClass;
  sectionJSXParts.push(`      <${tag} class="${cls}"></${tag}>`);
  continue;
}
```

This placeholder is replaced by the real chart import in `assembleReactPageWithCharts`.

---

## Step 4 — `src/convert.ts` changes

### 4a — PATH D (single chart node, before PATH B)

```typescript
// After PATH C check, before PATH B:
if (isChartSection(enhanced)) {
  return convertChart(enhanced, options, callbacks);
}
```

`convertChart(node, options, callbacks): ConversionResult`:
- Calls `extractChartMetadata(node)` + `generateChartCode(meta)`
- Returns `ConversionResult` with:
  - `frameworkOutputs.react` = `injectCSS(reactCode, css, 'react')`
  - All other frameworks = `generateChartPlaceholder(meta, fw)`
  - `chartComponents` = `[{ name: meta.componentName, reactCode, css }]`

### 4b — Chart branch in PATH C section loop

Inside `convertPage()` for-loop, **before** the compound-section else:

```typescript
} else if (isChartSection(child)) {
  const meta = extractChartMetadata(child);
  const { reactCode, css } = generateChartCode(meta);
  allChartComponents.push({ name: meta.componentName, reactCode, css });
  sectionOutputs.push({
    info: sectionInfo,
    rawCode: '',          // not used for charts
    css,
    failed: false,
    isChart: true,
    chartComponentName: meta.componentName,
  });
}
```

Declare `allChartComponents: Array<{name: string; reactCode: string; css: string}> = []` at the top of `convertPage()`.

### 4c — `assembleReactPageWithCharts(pageName, pageBaseClass, sectionOutputs)`

```typescript
function assembleReactPageWithCharts(
  pageName: string,
  pageBaseClass: string,
  sectionOutputs: SectionOutput[],
): string {
  const chartImports: string[] = [];
  const sectionJSX: string[] = [];

  for (const section of sectionOutputs) {
    if (section.isChart && section.chartComponentName) {
      chartImports.push(
        `import ${section.chartComponentName} from './${section.chartComponentName}.jsx';`
      );
      sectionJSX.push(`      <${section.chartComponentName} />`);
    } else if (!section.failed) {
      const body = sanitizeJSXAttributes(extractJSXBody(section.rawCode));
      const tag = section.info.semanticTag;
      const cls = section.info.baseClass;
      if (body.trim()) {
        sectionJSX.push(`      <${tag} className="${cls}">\n        ${body}\n      </${tag}>`);
      }
    }
  }

  return `import React from 'react';
${chartImports.join('\n')}

export default function ${pageName}() {
  return (
    <div className="${pageBaseClass}">
${sectionJSX.join('\n')}
    </div>
  );
}`;
}
```

### 4d — Step C6 update

```typescript
const hasCharts = sectionOutputs.some(s => s.isChart);

for (const fw of options.frameworks) {
  if (hasCharts && fw === 'react') {
    const pageCode = assembleReactPageWithCharts(pageName, pageBaseClass, sectionOutputs);
    frameworkOutputs[fw] = injectCSS(pageCode, mergedCSS, 'react');
  } else {
    let rawCode = rawFrameworkOutputs[fw as Framework];
    if (rawCode && !rawCode.startsWith('// Error')) {
      if (fw === 'react') rawCode = sanitizeJSXAttributes(rawCode);
      frameworkOutputs[fw] = injectCSS(rawCode, mergedCSS, fw as Framework);
    } else {
      frameworkOutputs[fw] = rawCode;
    }
  }
}
```

### 4e — Return `chartComponents`

```typescript
return {
  componentName,
  mitosisSource,
  frameworkOutputs,
  assets: dedupedAssets,
  css: mergedCSS,
  fidelityReport,
  chartComponents: allChartComponents.length ? allChartComponents : undefined,
};
```

---

## Step 5 — `src/types/index.ts`

Add to `ConversionResult`:

```typescript
chartComponents?: Array<{
  name: string;       // "InterestEarnedChart"
  reactCode: string;  // full JSX source (NO injectCSS — CSS is separate)
  css: string;
}>;
```

---

## Step 6 — `src/output.ts`

In `writeOutputFiles()`, after writing the main `.jsx`:

```typescript
if (options.chartComponents) {
  for (const chart of options.chartComponents) {
    const cssWithStyle = `${chart.css}`;
    const code = `import "./${chart.name}.css";\n${chart.reactCode}`;
    await fs.writeFile(join(dir, `${chart.name}.jsx`), code);
    await fs.writeFile(join(dir, `${chart.name}.css`), cssWithStyle);
  }
}
```

---

## Step 7 — `src/web/server.ts`

In the SSE `complete` event payload, add:
```typescript
chartComponents: result.chartComponents,
```

In the zip endpoint, add chart files:
```typescript
for (const chart of result.chartComponents ?? []) {
  archive.append(chart.reactCode, { name: `${chart.name}.jsx` });
  archive.append(chart.css, { name: `${chart.name}.css` });
}
```

---

## Step 8 — `src/web/public/app.js`

### 8a — Track `currentChartComponents`

```javascript
let currentChartComponents = [];
// In handleComplete:
currentChartComponents = data.chartComponents || [];
```

### 8b — Update `buildViteProjectTree` signature

Add `chartComponents` param:

```javascript
function buildViteProjectTree(componentName, componentCode, componentCss, assets, chartComponents) {
  // Detect recharts in component code OR any chart sub-component
  const allCode = [componentCode, ...(chartComponents || []).map(c => c.reactCode)].join('\n');
  const usesRecharts = /from ['"]recharts['"]/.test(allCode);
  const extraDeps = usesRecharts ? { recharts: '^2.12.0' } : {};

  const packageJson = JSON.stringify({
    dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1', ...extraDeps },
    // ...rest of package.json
  });

  const files = {
    // ...existing files...
  };

  // Add chart sub-component files
  for (const chart of chartComponents || []) {
    files[`src/components/${chart.name}.jsx`] = `import "./${chart.name}.css";\n${chart.reactCode}`;
    files[`src/components/${chart.name}.css`] = chart.css;
  }

  return toFileSystemTree(files);
}
```

### 8c — Pass `currentChartComponents` at call site

```javascript
const tree = buildViteProjectTree(
  currentComponentName, componentCode, componentCss, assets, currentChartComponents
);
```

---

## Output Structure (what the user sees)

For a page with a chart section:
```
web_output/HomeMainMobile-XXXX/
  HomeMainMobile.jsx          ← imports InterestEarnedChart
  HomeMainMobile.lite.tsx
  InterestEarnedChart.jsx     ← recharts component (separate file)
  InterestEarnedChart.css     ← chart CSS
  app/
    src/components/
      HomeMainMobile.jsx
      InterestEarnedChart.jsx
      InterestEarnedChart.css
```

`HomeMainMobile.jsx` contains:
```jsx
import React from 'react';
import InterestEarnedChart from './InterestEarnedChart.jsx';

export default function HomeMainMobile() {
  return (
    <div className="home-main-mobile">
      <InterestEarnedChart />
      <section className="home-main-mobile__banners">...</section>
      ...
    </div>
  );
}
```

---

## Verification

1. `npm run build` — no TypeScript errors
2. Run pipeline on Figma node `10227-1981` (single chart node → PATH D)
   - Should generate `InterestEarnedChart.jsx` with recharts imports
   - `stroke="#7C3AED"` on Line
   - Toggle buttons: Lifetime / Year-to-date
3. Run pipeline on `HomeMainMobile` page (multi-section with chart → PATH C)
   - `HomeMainMobile.jsx` imports `InterestEarnedChart`
   - Chart renders without crashing WebContainer
4. Run on a page WITHOUT charts → no regressions, `sanitizeJSXAttributes` still runs
