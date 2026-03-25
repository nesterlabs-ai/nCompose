# Chart Detection & Codegen — Issues & Fixes

## Fixed: Duplicate chart data constant names cause Babel parse error


⏺ Babel is the tool that converts your JSX code (React's <div> syntax) into regular JavaScript that the browser can run.

  When it sees the same variable name declared twice in the same file:

  const CHART_DATA_WidgetChart = { ... };  // first time ✅
  // ... more code ...
  const CHART_DATA_WidgetChart = { ... };  // second time ❌

  It stops and says "I already have a variable called CHART_DATA_WidgetChart, you can't create another one with the same name."
  That's the parse error — it refuses to process the file at all, so nothing renders.

**Symptom:** When a page has multiple charts with the same Figma name (e.g., 4 "Widget" charts), the WebContainer preview crashes with:
```
Identifier 'CHART_DATA_WidgetChart' has already been declared. (70:6)
```

**Root cause:** The chart dedup logic renames functions (`WidgetChart` → `WidgetChart2`, `WidgetChart3`, `WidgetChart4`) but the rename regex used `\b` (word boundary). Since `_` is a word character in JS regex, `\bWidgetChart\b` does NOT match inside `CHART_DATA_WidgetChart` or `CustomTooltip_WidgetChart`. The data constants and tooltip functions kept the original name, causing duplicate declarations.

**Fix:** Replaced `\b` word boundary with `(?<=^|[^a-zA-Z0-9])` and `(?=[^a-zA-Z0-9]|$)` — treats `_` as a separator so `CHART_DATA_WidgetChart` and `CustomTooltip_WidgetChart` both get correctly renamed.

**File:** `src/convert.ts` — chart name dedup section (~line 2507)

**Test:** Figma link `https://www.figma.com/design/MgOxwvJAELcnhDCncMOKeH/Sqrx-Admin-Portal-Redesign?node-id=340-46823&m=dev` — page with 4 "Widget" chart instances.

---

## Fixed: Chart sibling overlay (purple gradient on top of Recharts)

**Symptom:** A purple gradient rectangle and raw HTML grid lines render on top of the Recharts chart, duplicating what Recharts already draws.

**Root cause:** Figma splits a chart across multiple sibling frames (chart data + axis/grid/gradient frame + legend frame). The chart frame gets Recharts codegen, but the axis/gradient sibling goes to the LLM which renders it as raw HTML divs — overlaying the chart.

**Fix:** Added `mergeChartAdjacentSiblings()` in `src/convert.ts` that:
1. Detects chart sections in page children
2. Checks adjacent siblings for chart-auxiliary content (axis labels, grid lines, gradients — detected structurally, not by name)
3. Merges their children into the chart node (so `extractChartMetadata` finds axis labels, legends)
4. Removes the siblings from the section list

**Additional fix:** Raw children index mismatch after `flattenWrapperFrames` — built an ID-based lookup map from the raw tree instead of relying on array index alignment.

**File:** `src/convert.ts` — `mergeChartAdjacentSiblings()`, `isChartAuxiliaryNode()`, `areSpatiallyRelated()`

**Test:** Figma link `https://www.figma.com/design/iXD0U4acUlOL5KCGN44LWf/Banky-UI-Design?node-id=0-6730&m=dev`

---

## Fixed: Line chart detected instead of Area chart

**Symptom:** A chart with a gradient fill under the line renders as a plain `LineChart` (no gradient) instead of `AreaChart` with gradient fill.

**Root cause:** Area chart detection only checked `VECTOR` nodes for gradient fills. In Figma, the gradient fill is often a `RECTANGLE`, `FRAME`, or `BOOLEAN_OPERATION` node — separate from the line VECTOR.

**Fix:** In `src/figma/chart-detection.ts`:
1. Expanded gradient fill detection to all shape types (`RECTANGLE`, `FRAME`, `BOOLEAN_OPERATION`, etc.)
2. Added spatial co-occurrence check — when a gradient-filled shape exists near a stroked line vector (≥50% width overlap), that's a strong area chart signal

**File:** `src/figma/chart-detection.ts` — `detectChartType()` area detection section

**Test:** Figma link `https://www.figma.com/design/iXD0U4acUlOL5KCGN44LWf/Banky-UI-Design?node-id=832-11551&m=dev`

---

## Fixed: Bar chart color extraction from 3D cylinder bars

**Symptom:** Bar chart renders with wrong color — picks up an inner element's color instead of the outer bar color.

**Root cause:** Figma 3D cylinder bars are `BOOLEAN_OPERATION` (outer, `#9747ff`) containing inner `RECTANGLE` (`#6f86fc`). The color extraction found the inner RECTANGLE fill instead of the outer shape. Also, `extractBarChartData()` was only called when `xAxisLabels` was empty — after chart sibling merge provided labels, it was skipped entirely.

**Fix:** In `src/figma/chart-detection.ts`:
1. Always call `extractBarChartData()` for bar charts (not just when xAxisLabels is empty)
2. Added fallback that finds the most common chromatic fill among all bar-shaped nodes (`RECTANGLE`, `BOOLEAN_OPERATION`, `FRAME`, `VECTOR`) when structured extraction fails
3. Fixed return type to include `color` field

**File:** `src/figma/chart-detection.ts` — bar data extraction section

**Test:** Figma link `https://www.figma.com/design/iXD0U4acUlOL5KCGN44LWf/Banky-UI-Design?node-id=832-11551&m=dev`

---

## Fixed: Chart sibling merge cross-contaminating metadata between charts

**Symptom:** When a page has 2 charts, the first chart shows the second chart's title ("Missed Earnings" instead of "Earning Potential"). Summary section ($59,294 + CTA "Learn how this is calculated here") is missing entirely.

**Root cause:** The `mergeChartAdjacentSiblings` function used a shared `Set` of absorbed siblings and merged ALL absorbed siblings into EVERY chart. Chart B's axis labels got pushed into Chart A's children, so Chart A extracted the wrong title and the real summary texts were displaced.

**Fix:** Changed from a shared `Set<number>` to a `Map<number, number[]>` (chartIndex → siblingIndices). Each chart only receives its own absorbed siblings.

**File:** `src/convert.ts` — `mergeChartAdjacentSiblings()`

**Test:** Figma link `https://www.figma.com/design/iXD0U4acUlOL5KCGN44LWf/Banky-UI-Design?node-id=832-11551&m=dev` — page with 2 bar charts

---

## Fixed: Summary/CTA text excluded by over-aggressive data area filter

**Symptom:** Chart summary ($59,294, "Projected growth...", "Learn how this is calculated here" CTA) missing from the generated Recharts component, even though the text exists in the Figma node.

**Root cause:** `extractChartTextContent` finds frames containing 3+ colored shapes and adds them to an exclusion set. It was matching at too high a level — `BarLineChart` frame got excluded because it contains bar shapes, but the summary text was also inside that same frame. All texts inside the excluded frame were filtered out.

**Fix:** Replaced the flat `findVisibleNodes` search with `findDeepestDataArea` — a recursive function that walks DOWN to the most specific frame containing data shapes. Only the deepest match is excluded, so sibling frames (like the summary Text Container) stay included.

**File:** `src/figma/chart-detection.ts` — `extractChartTextContent()` data area exclusion logic

**Test:** Figma link `https://www.figma.com/design/iXD0U4acUlOL5KCGN44LWf/Banky-UI-Design?node-id=832-11551&m=dev`

---

## Fixed: Text-only sections named "BarLineChart" falsely detected as charts

**Symptom:** Sections containing only text (headings, dollar amounts) but named "BarLineChart" by the designer were detected as line charts and rendered as empty Recharts components.

**Root cause:** The detection had a fragile scoring system where:
1. Name containing "chart" → `semanticNameSignal` returns `'chart'` → lowered acceptance threshold
2. Dollar amounts at frame edges → falsely matched as axis labels (Signal B)
3. 1 weak signal was enough to accept when name said "chart"

The fundamental flaw: the detection accepted nodes WITHOUT actual data shapes (bars, lines, pie slices) based on text arrangement and grid lines alone — which exist in non-chart UI (tables, forms, lists).

**Fix:** Made Signal A (data shapes — `hasDataShapeCluster`) a **required gate** for ALL chart detection paths. No data shapes = not a chart, regardless of name, text layout, or grid lines. The new flow:
```
Has actual data shapes? → NO → NOT a chart. Done.
                        → YES → Use name + axes + grid to confirm and classify
```

**File:** `src/figma/chart-detection.ts` — `isChartSection()` decision logic

**Test:** Figma link `https://www.figma.com/design/iXD0U4acUlOL5KCGN44LWf/Banky-UI-Design?node-id=0-8268&m=dev` — page with text-only "BarLineChart" sections

---

## Fixed: Bar chart false positives from card layouts and button groups

**Symptom:** Non-chart UI elements (card grids, button groups, list items with colored backgrounds) falsely detected as bar charts.

**Root cause:** Bar detection only checked for 3+ colored rectangles sharing a common edge — no verification that they actually look like data bars. Cards, buttons, and status indicators all have colored fills and can align on edges.

**Fix:** Added `isBarLikeGroup()` validation that checks two properties from Figma dimensions:
1. **Width consistency** — bars have similar widths (≥60% within ±50% of median). Cards/buttons may have varied widths.
2. **Height variation** — bars represent different data values so heights must differ (≥15% variation). UI elements at same height are not data bars.

Both checks use `absoluteBoundingBox` from Figma — no hardcoded pixel values.

**File:** `src/figma/chart-detection.ts` — `isBarLikeGroup()`, `hasDataShapeCluster()`, `detectChartType()`
