# LLM-Based Chart Detection

## Problem

Structural analysis alone cannot reliably distinguish chart data shapes from UI elements. Icons, maps, card backgrounds, and decorative previews all have fills, strokes, and geometry — the same properties as chart bars, lines, and pie slices. This caused false positives where contact pages, CTA sections, and icon grids were detected as charts.

## Solution

Added LLM verification as the final decision layer for ambiguous cases. Structural analysis handles clear accepts/rejects. The LLM only steps in when structural signals are inconclusive.

## Flow

```
Node enters isChartSection
  │
  ├─ Gate 1: Size check (from absoluteBoundingBox) → too small? REJECT
  ├─ Gate 2: Complexity (children count) → too many? REJECT
  ├─ Gate 3: Spatial spread → shapes in tiny corner? REJECT
  │
  ├─ Signal A: Collect visual nodes → find data shapes (bars, pies, lines)
  │   → No shapes? REJECT
  │
  ├─ Signal B: Check for axis-like text arrangement
  ├─ Signal C: Check for parallel grid lines
  │
  ├─ All signals collected. DECIDE:
  │
  │  ├─ Strong evidence (shapes + axes + grid)? → ACCEPT (no LLM)
  │  ├─ Root named "chart" + strong shapes? → ACCEPT (no LLM)
  │  ├─ No shapes at all? → REJECT (no LLM)
  │  ├─ UI names + low confidence + no support? → REJECT (no LLM)
  │  │
  │  └─ AMBIGUOUS → Send to LLM
  │       │
  │       ├─ Build compact node tree summary (~200-500 tokens)
  │       ├─ Ask: "Is this a chart/graph? Reply {isChart: true/false}"
  │       ├─ LLM sees context: node names, types, text content
  │       │
  │       ├─ LLM says YES → ACCEPT
  │       ├─ LLM says NO → REJECT
  │       └─ LLM fails → REJECT (conservative fallback)
```

## Implementation

### Two functions

- `isChartSection(node)` — sync, structural only, for backward compatibility
- `isChartSectionAsync(node, llmProvider?)` — async, structural + LLM verification

### When LLM is called

Only for ambiguous cases:
- Signal A found shapes but confidence isn't strong enough
- AND/OR supporting signals (axes, grid) are missing
- AND/OR semantic names suggest UI content

### When LLM is NOT called (fast path)

- Node fails size/complexity/spatial gates → reject immediately
- Signal A not detected → reject immediately
- Signal A highConfidence + root has chart name → accept immediately
- Signal A + 2+ supporting signals (axes + grid) → accept immediately

### What the LLM receives

A compact text summary of the node tree:
```
Node: "Widget" (FRAME) 560x400
  "Numbers" (FRAME) — TEXT: "100k", "50k", "20k"
  "Heading" — TEXT: "Threat Overview", "Total 9100"
  "SVG" (FRAME) 250x250 — 10 VECTOR shapes
  "Legend" (FRAME) — 5 items with colored dots + text
```

### LLM prompt

```
System: You are a design analysis expert. Given a Figma layer tree,
determine if this is a data chart/graph or a regular UI section.

Key differences:
- Charts have DATA SHAPES arranged to visualize data values
- UI sections have ICONS, BUTTONS, TEXT FIELDS, CARDS, MAPS
- Colored icons aligned vertically is NOT a chart
- Colored shapes are chart data only when they represent numerical values

Respond: {"isChart": true} or {"isChart": false}
```

### Cost

- ~200-500 tokens input, ~10 tokens output per call
- 0-3 calls per page (most nodes resolved structurally)
- Only called on genuinely ambiguous cases

## Files Changed

- `src/figma/chart-detection.ts`
  - Added `isChartSectionAsync()` with LLM verification
  - Refactored `isChartSectionStructural()` to return `'accept' | 'reject' | 'ambiguous'`
  - Kept sync `isChartSection()` as backward-compatible wrapper

- `src/convert.ts`
  - Top-level path detection uses `isChartSectionAsync` with LLM provider
  - COMPONENT_SET variant check uses async version

## Examples

| Page | Structural Result | LLM Result | Correct? |
|------|------------------|------------|----------|
| Contact page (3 icons + Google Maps) | AMBIGUOUS (shapes found, UI names) | NOT a chart | ✅ |
| CTA page (decorative chart preview) | AMBIGUOUS (pie shapes in child) | NOT a chart | ✅ |
| Radar widget (real chart with axes) | ACCEPT (strong shapes + signals) | — (not called) | ✅ |
| Bar chart (data bars + grid) | ACCEPT (highConf + axes) | — (not called) | ✅ |
| KYC form (input fields) | REJECT (no data shapes) | — (not called) | ✅ |
| Verification page (icon cards) | REJECT (shapes in tiny area) | — (not called) | ✅ |
