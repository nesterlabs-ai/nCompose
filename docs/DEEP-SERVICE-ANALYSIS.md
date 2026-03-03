# Deep Service Analysis — figma-to-mitosis

> Comprehensive audit of all pipelines (PATH A, PATH B, PATH C) identifying every
> root cause that prevents the service from producing pixel-accurate, import-ready code
> from any Figma component, component set, or page URL.
>
> **All findings are based on direct code reading. No assumptions.**

---

## Table of Contents

1. [Pipeline Overview](#1-pipeline-overview)
2. [CRITICAL — Data Extraction Issues](#2-critical--data-extraction-issues)
3. [CRITICAL — LLM Prompt & Token Issues](#3-critical--llm-prompt--token-issues)
4. [HIGH — CSS Generation Issues (PATH A)](#4-high--css-generation-issues-path-a)
5. [HIGH — Color & Visual Fidelity Issues](#5-high--color--visual-fidelity-issues)
6. [HIGH — Typography Issues](#6-high--typography-issues)
7. [HIGH — Layout & Sizing Issues](#7-high--layout--sizing-issues)
8. [HIGH — Icon / SVG Asset Issues](#8-high--icon--svg-asset-issues)
9. [HIGH — Page Pipeline Issues (PATH C)](#9-high--page-pipeline-issues-path-c)
10. [MEDIUM — Validation & Retry Issues](#10-medium--validation--retry-issues)
11. [MEDIUM — Framework Output Issues](#11-medium--framework-output-issues)
12. [MEDIUM — Web Server Issues](#12-medium--web-server-issues)
13. [LOW — Miscellaneous Issues](#13-low--miscellaneous-issues)
14. [Summary Table](#14-summary-table)

---

## 1. Pipeline Overview

### PATH A — COMPONENT_SET (variant-aware)
```
Figma URL → FigmaClient.getNode() → extractCompleteDesign()
  → parseComponentSet()               axes, states, CSS tokens
  → collectAssetNodesFromAllVariants() scan ALL variant icon nodes
  → exportAssetsFromAllVariants()      SVGs, deduplicated
  → buildVariantCSS()                  deterministic BEM CSS
  → buildVariantPromptData()           props + icon relationships
  → buildComponentSetUserPrompt()      includes defaultVariantYaml
  → LLM.generate() + retry loop       class-based .lite.tsx
  → Mitosis parseJsx()
  → generateFrameworkCode()
  → injectCSS()
```

### PATH B — Single Component
```
Figma URL → FigmaClient.getNode() → extractCompleteDesign()
  → serializeNodeForPrompt()          CSS-ready YAML
  → collectAssetNodes() → exportAssets()
  → assembleSystemPrompt() + assembleUserPrompt()
  → LLM.generate() + retry loop       inline-styled .lite.tsx
  → Mitosis parseJsx()
  → generateFrameworkCode()
```

### PATH C — Multi-section Page
```
Figma URL → FigmaClient.getNode() → extractCompleteDesign()
  → isMultiSectionPage() detection
  → extractPageLayoutCSS()            deterministic page CSS
  → For each section:
    → serializeNodeForPrompt()
    → assemblePageSectionUserPrompt()
    → LLM.generate() + retry loop
  → stitchPageComponent()             merge JSX + CSS
  → parseMitosisCode()
  → generateFrameworkCode()
  → injectCSS()
```

---

## 2. CRITICAL — Data Extraction Issues

### 2.1 Figma-complete extractors only process first stroke

**File**: `src/figma-complete/visuals.ts` ~line 353
**Problem**: `buildSimplifiedStroke()` processes `node.strokes[0]` only.
**Impact**: Figma nodes with multiple layered strokes (common in complex border designs) lose strokes [1], [2], etc. Only the topmost stroke is extracted.
**Solution**: Iterate all visible strokes and produce an array of border CSS values or stacked box-shadows.

---

### 2.2 Variable values never resolved to the correct default mode

**File**: `src/figma-complete/api-parser.ts` ~line 234
**Code**:
```typescript
const targetModeId = modeId || Object.keys(variable.valuesByMode)[0];
```
**Problem**: When `modeId` is undefined, the code picks the **first** mode in the object, NOT the collection's `defaultModeId`. `variableCollections[].defaultModeId` exists in the API data but is never consulted.
**Impact**: Components that use design tokens get the wrong values (e.g., dark mode colors instead of light mode) if the first mode happens to not be the default.
**Solution**: Look up `variableCollections[varDef.variableCollectionId].defaultModeId` and use it as the fallback.

---

### 2.3 Paint-level opacity not propagated to CSS output

**File**: `src/figma-complete/visuals.ts` ~lines 325-326
**Problem**: Each Figma paint (fill/stroke) has its own `opacity` field that is SEPARATE from the color's alpha channel. The `simplified.opacity` is stored but when converting fills to CSS, `rgbaToString()` only reads `color.a` — the paint-level opacity is ignored.
**Impact**: Semi-transparent fills that use paint opacity (rather than color alpha) lose their transparency. Background colors appear fully opaque when they should be translucent.
**Solution**: Multiply `fill.opacity * color.a` when computing the final CSS alpha value, as done in `solidFillToCSS()` in `component-set-parser.ts`.

---

### 2.4 `createStyleHash()` collision risk

**File**: `src/figma-complete/node-walker.ts` ~lines 131-137
**Code**:
```typescript
const parts = sortedKeys.map((key) => `${key}:${JSON.stringify(obj[key])}`);
return parts.join('|');
```
**Problem**: Two objects like `{a: 1, b: "2|c:3"}` and `{a: 1, b: "2", c: 3}` produce identical hashes because the pipe delimiter can appear in values.
**Impact**: `globalVars` deduplication silently merges distinct styles, causing one element to reference another element's style.
**Solution**: Use a proper hash function (e.g., `JSON.stringify` on the whole object then hash), or use unique sequential IDs.

---

### 2.5 Component property references not resolved

**File**: `src/figma-complete/component.ts` ~lines 60-62
**Problem**: `componentPropertyReferences` stores raw child-node-ID → property-name mappings but never validates or resolves them against the actual node tree.
**Impact**: When building prompts, the service cannot map which TEXT layer is controlled by which text property unless the defaultValue exact-matches. Stale or unresolvable references persist silently.
**Solution**: Resolve `componentPropertyReferences` at extraction time by walking the node tree and validating each reference target exists.

---

## 3. CRITICAL — LLM Prompt & Token Issues

### 3.1 `defaultVariantYaml` placed DEEP in PATH A prompt — gets truncated first

**File**: `src/convert.ts:599` and `src/compile/retry.ts:66-82`
**Problem**: `buildComponentSetUserPrompt()` embeds the `defaultVariantYaml` (the actual node structure with colors, sizes, text) deep inside the prompt, after ~6,000-8,000 tokens of instruction text. When `truncateToFit()` runs, it finds the `\`\`\`yaml` fence and truncates **within the YAML block** — meaning the actual design data (colors, typography, spacing, text content) gets cut while all the instruction boilerplate is preserved.
**Impact**: The LLM sees detailed structural guidance but no actual design values. It hallucinates colors, typography, spacing, and text content.
**Solution**: Place the `defaultVariantYaml` BEFORE the instruction sections so it is preserved during truncation. Or implement smarter truncation that prioritizes YAML data over instruction text.

---

### 3.2 Token estimation uses fixed 3.5 chars/token ratio

**File**: `src/compile/retry.ts:19-21`
**Code**:
```typescript
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}
```
**Problem**: Real tokenization varies: ASCII text ≈ 4-5 chars/token, YAML syntax ≈ 3-4, Unicode ≈ 1-2. The fixed 3.5 ratio systematically underestimates YAML token counts (which have many colons, brackets, and special chars).
**Impact**: Prompts that appear to fit the context window actually exceed it, causing the API to error or silently truncate. Large component designs are more aggressively truncated than necessary.
**Solution**: Use provider-specific tokenizer APIs, or at minimum use different ratios for YAML (3.0) vs. code (4.0) content.

---

### 3.3 Web server ignores LLM selection from client

**File**: `src/web/server.ts:82`
**Code**:
```typescript
llm: config.server.defaultLLM as any,
```
**Problem**: The endpoint reads `{ figmaUrl, figmaToken, frameworks, name }` from `req.body` but does NOT accept an `llm` parameter. The `as any` cast silently bypasses TypeScript validation. All web UI requests use the server default (deepseek).
**Impact**: Users cannot switch LLM providers from the web UI. DeepSeek may produce lower quality output for complex components compared to Claude.
**Solution**: Accept `llm` from request body, validate against `SUPPORTED_LLM_PROVIDERS`, and pass it through.

---

### 3.4 No output token budget scaling for PATH A complexity

**File**: `src/compile/retry.ts:29-35`
**Problem**: `scaleOutputTokens()` calculates output budget as `userPromptChars / 8`, capped at `4 × baseMax`. For PATH A component sets, the prompt is very large due to instruction text (~6-8K tokens), but this instruction text doesn't need more output — only the design data complexity does. The current heuristic over-allocates for instructions and under-allocates for actual design complexity.
**Impact**: Complex component sets with many variants get the same output budget as simple ones, despite needing more tokens for conditional rendering, state management, and multiple CSS class references.
**Solution**: Base output budget scaling on design complexity metrics (variant count, child count, state count) rather than raw prompt character length.

---

### 3.5 PATH B fallback sends raw Paint objects when `cssReadyNode` is null

**File**: `src/convert.ts:906-909`
**Code**:
```typescript
const llmYaml = cssReadyNode
  ? dump(cssReadyNode, { lineWidth: 120, noRefs: true })
  : yamlContent;
```
**Problem**: If `serializeNodeForPrompt()` returns null (e.g., root node has `name` starting with `_`), the raw `yamlContent` is sent to the LLM. This YAML contains Figma Paint objects like `{r: 0.23, g: 0.51, b: 0.96}` instead of CSS strings like `rgb(59,130,246)`.
**Impact**: The LLM receives uninterpretable color formats and must guess the intended colors, producing wrong CSS.
**Solution**: Never fall back to raw `yamlContent`. If `serializeNodeForPrompt` fails, serialize the node differently or throw an error.

---

## 4. HIGH — CSS Generation Issues (PATH A)

### 4.1 `!important` on border and outline forces override of variant styles

**File**: `src/figma/component-set-parser.ts:2192`
**Code**:
```typescript
if (!defaultContainer['border']) { lines.push(`  border: none !important;`); lines.push(`  outline: none;`); }
```
**Problem**: `border: none !important` on the base class prevents any variant modifier from adding a border via CSS specificity. A variant that needs `border: 1px solid red` will be overridden.
**Impact**: Variant borders never appear in the rendered output.
**Solution**: Remove `!important` from base rule. Use a lower-specificity reset or rely on the variant selectors having adequate specificity.

---

### 4.2 `!important` on all CENTER-aligned strokes

**File**: `src/figma/component-set-parser.ts:1761-1768`
**Code**:
```typescript
if (strokes.sides) {
  const val = `${weight} solid ${color} !important`;
  ...
} else {
  css['border'] = `${weight} solid ${color} !important`;
}
```
**Problem**: Every border from stroke extraction gets `!important`, making it impossible for variant CSS overrides to change border colors/widths in different states (e.g., error state red border vs default gray).
**Impact**: Border colors remain fixed across all states.
**Solution**: Remove `!important`; rely on CSS specificity from BEM modifier selectors.

---

### 4.3 Behavioral CSS disabled by default

**File**: `src/config.ts:174`
**Code**:
```typescript
injectBehavioralStyles: envBool('CSS_INJECT_BEHAVIORAL_STYLES', false),
```
**Problem**: `cursor: pointer`, `transition`, `user-select: none`, focus ring, and hover guards are OFF by default.
**Impact**: Interactive components (buttons, links, toggles) have no cursor change, no transition animations, and no focus indicators — making them look and feel broken compared to the Figma prototype.
**Solution**: Default to `true` for interactive component categories. The system already detects `INTERACTIVE_CATEGORIES`; use that to auto-enable.

---

### 4.4 Icon color stripped from child CSS rules

**File**: `src/figma/component-set-parser.ts:2211, 2389`
**Code**:
```typescript
if (isIconKey(childKey) && merged['color']) delete merged['color'];
```
**Problem**: Icon child CSS rules have their `color` property deleted. This was intended to prevent `currentColor` issues with `<img>` tags, but it also removes intentional icon colors.
**Impact**: Icons that have specific Figma fill colors (e.g., red error icon, green success icon) lose their color completely.
**Solution**: Only delete `color` from icon keys when the icon is served as `<img>` with `currentColor`. If the SVG preserves original colors, keep the CSS `color` value.

---

### 4.5 Radial gradient center position lost

**File**: `src/figma/component-set-parser.ts:1718-1721`
**Code**:
```typescript
function radialGradientToCSS(fill: any): string {
  if (!fill.gradientStops?.length) return 'radial-gradient(transparent, transparent)';
  return `radial-gradient(circle, ${gradientStopsToCSS(fill.gradientStops)})`;
}
```
**Problem**: `gradientHandlePositions` are completely ignored for radial gradients. The center point always defaults to the shape center.
**Impact**: Off-center radial gradients (e.g., a glow effect positioned at the top-left) render centered instead.
**Solution**: Read `fill.gradientHandlePositions[0]` and compute `radial-gradient(circle at X% Y%, ...)`.

---

### 4.6 Angular gradient rotation lost

**File**: `src/figma/component-set-parser.ts:1723-1726`
**Code**:
```typescript
function angularGradientToCSS(fill: any): string {
  return `conic-gradient(${gradientStopsToCSS(fill.gradientStops)})`;
}
```
**Problem**: Angular gradient start angle and center position from `gradientHandlePositions` are ignored.
**Impact**: Conic gradients always start from 0° at center instead of their Figma-defined rotation.
**Solution**: Compute angle from handle positions and emit `conic-gradient(from Xdeg at Y% Z%, ...)`.

---

### 4.7 Diamond gradient approximated as radial

**File**: `src/figma/component-set-parser.ts:1691`
**Code**:
```typescript
case 'GRADIENT_DIAMOND': result.push(radialGradientToCSS(fill)); break;
```
**Problem**: Figma's diamond gradient has no CSS equivalent and is approximated as a plain radial gradient.
**Impact**: Diamond-shaped gradients render as circles instead of diamond shapes.
**Solution**: No perfect CSS equivalent exists. Document this limitation. For higher fidelity, could use a CSS `conic-gradient` with 4-stop diamond approximation, or emit a background SVG.

---

## 5. HIGH — Color & Visual Fidelity Issues

### 5.1 Multi-layer fills only use first fill

**File**: `src/figma/component-set-parser.ts:1650-1670`
**Code**:
```typescript
const primary = fills[0];
if (!primary) return;
...
if (fills.length > 1) css['background'] = [...fills.slice(1), primary].join(', ');
```
**Problem**: While multi-fill is handled for gradients, Figma allows stacking solid fills with blend modes. The code joins them as comma-separated `background` values, but CSS `background` with multiple solid colors just picks the first — there's no `mix-blend-mode` per background layer.
**Impact**: Layered fill effects (e.g., a semi-transparent red over a blue) collapse to a single color.
**Solution**: For multi-fill with blend modes, emit overlapping `<div>` layers with individual `mix-blend-mode` or use CSS `background-blend-mode`.

---

### 5.2 `serializeNodeForPrompt` sends `paragraphSpacing` as invalid CSS property

**File**: `src/convert.ts:347-349`
**Code**:
```typescript
if (node.style.paragraphSpacing && node.style.paragraphSpacing > 0) {
  ts.paragraphSpacing = `${node.style.paragraphSpacing}px`;
}
```
**Problem**: CSS has no `paragraph-spacing` property. The valid CSS equivalent is `margin-bottom` on block elements.
**Impact**: LLM receives a non-existent CSS property and either ignores it or generates invalid CSS. Paragraph spacing from Figma is lost.
**Solution**: Emit as `marginBottom` or include a comment hint like `/* paragraph-spacing: 16px → apply margin-bottom to <p> elements */`.

---

### 5.3 Image fills emit `url(/* imageRef */)` placeholder

**File**: `src/figma/component-set-parser.ts:1692-1694`
**Code**:
```typescript
case 'IMAGE':
  result.push(fill.imageRef ? `url(/* ${fill.imageRef} */)` : 'url()');
```
**Problem**: Image fills are never downloaded from Figma. The CSS gets a comment-only `url()` that renders nothing.
**Impact**: Any node with an image fill (photos, patterns, textures) renders with no background at all.
**Solution**: Download image fills via `FigmaClient.getImages()` (same as SVG assets), save them to the assets folder, and reference them with a real path like `url(./assets/image-nodeId.png)`.

---

### 5.4 Shadow effect `showShadowBehindNode` not handled

**File**: `src/figma/component-set-parser.ts:1832-1858`
**Problem**: Figma's `showShadowBehindNode` flag determines whether a drop shadow is visible behind the element (relevant for transparent backgrounds). CSS `box-shadow` always shows behind the element. There is no check for this flag.
**Impact**: Minimal for opaque elements, but transparent elements may show an unexpected shadow visible through the background.
**Solution**: When `showShadowBehindNode === false` and the element has a transparent/no fill, document the limitation or use `filter: drop-shadow()` instead of `box-shadow`.

---

## 6. HIGH — Typography Issues

### 6.1 `serializeNodeForPrompt` emits `-webkit-` properties as camelCase

**File**: `src/convert.ts:340-345`
**Code**:
```typescript
ts.webkitLineClamp = node.style.maxLines;
ts.webkitBoxOrient = 'vertical';
```
**Problem**: These are emitted as JavaScript camelCase keys (`webkitLineClamp`), but when dumped to YAML for the LLM, they appear as invalid CSS property names. The LLM generates `webkitLineClamp: 3` instead of `-webkit-line-clamp: 3`.
**Impact**: Multi-line text truncation doesn't work in the generated code.
**Solution**: Use kebab-case keys: `ts['-webkit-line-clamp'] = node.style.maxLines`.

---

### 6.2 Letter spacing unit conversion missing in `serializeNodeForPrompt`

**File**: `src/convert.ts:320`
**Code**:
```typescript
if (node.style.letterSpacing) ts.letterSpacing = `${Math.round(node.style.letterSpacing * 100) / 100}px`;
```
**Problem**: Figma's `letterSpacing` can be in pixels OR as a percentage of font size (stored in `node.style.letterSpacing` with a `unit` field). This code always outputs `px`. In the `component-set-parser.ts:1270-1278`, this is handled correctly with unit detection — but `serializeNodeForPrompt` does not replicate that logic.
**Impact**: PATH B components get wrong letter spacing — a percentage value like `5` (meaning 5% of font size) gets emitted as `5px`, which is wildly different.
**Solution**: Check `node.style.letterSpacing.unit` if it's an object, similar to line 1270 in component-set-parser.ts.

---

### 6.3 Vertical text alignment not converted to CSS

**File**: `src/convert.ts:329-334`
**Problem**: `serializeNodeForPrompt` extracts `textAlignHorizontal` but does NOT extract `textAlignVertical` (`TOP`, `CENTER`, `BOTTOM`).
**Impact**: Text elements that are vertically centered in Figma (very common in buttons, headers, badges) are top-aligned in generated code.
**Solution**: Extract `textAlignVertical` and map to CSS techniques: `CENTER` → `display: flex; align-items: center;` on the parent, or `vertical-align: middle`.

---

### 6.4 Named text style reference not resolved

**File**: `src/figma-complete/text.ts` ~line 56-57
**Problem**: When a TEXT node uses a named text style (e.g., "Heading/H1"), only the style reference string is stored — the actual font-family, font-size, font-weight, line-height values are NOT extracted from the style definition.
**Impact**: Text nodes using named styles have NO typography CSS in the extracted data. The LLM has to guess font sizes and weights.
**Solution**: Resolve named style references at extraction time by looking up the style ID in `completeDesign.styles` and inlining the actual CSS properties.

---

### 6.5 Text color in `serializeNodeForPrompt` crashes on style reference string

**File**: `src/convert.ts:358-360`
**Code**:
```typescript
} else if (node.style.fills?.[0]?.color) {
  ts.color = figmaColorToCSS(node.style.fills[0].color, node.style.fills[0].opacity);
}
```
**Problem**: Framelink-simplified nodes may have `node.style.fills` as a **style reference string** (like `"color_ABC123"`), not an array. Accessing `[0]?.color` on a string returns `undefined` silently but could also crash if the string is iterable.
**Impact**: Text colors are undefined for Framelink-simplified nodes.
**Solution**: Add explicit `Array.isArray(node.style.fills)` guard before the fallback access.

---

## 7. HIGH — Layout & Sizing Issues

### 7.1 Absolute positioning uses `node.x/y` but these may be undefined

**File**: `src/figma/component-set-parser.ts:1593-1594`
**Code**:
```typescript
if (node.x !== undefined) css['left'] = `${Math.round(node.x)}px`;
if (node.y !== undefined) css['top']  = `${Math.round(node.y)}px`;
```
**Problem**: For absolutelypositioned nodes without `constraints`, the code relies on `node.x` and `node.y`. But in `extractCompleteDesign` data, these properties may not exist — only `absoluteBoundingBox` or `relativeTransform` might be available.
**Impact**: Absolutely positioned elements get `position: absolute` but no `left`/`top` values, floating to `0,0`.
**Solution**: Fall back to `relativeTransform[0][2]` (x) and `relativeTransform[1][2]` (y) when `node.x/y` are undefined.

---

### 7.2 HUG sizing emits `min-width` only — no actual width constraint

**File**: `src/figma/component-set-parser.ts:1568-1569`
**Code**:
```typescript
} else if (hug) {
  css['min-width'] = `${width}px`;
}
```
**Problem**: HUG content sizing in Figma means "shrink to content but don't go below this size." The code emits `min-width` without `width: fit-content` or `width: max-content`. Without an explicit width strategy, the browser may stretch the element to fill available space.
**Impact**: HUG-sized elements expand to fill their container instead of wrapping to content.
**Solution**: Emit `width: fit-content; min-width: Xpx;` for HUG sizing.

---

### 7.3 `layoutWrap` + `counterAxisSpacing` only applied inside `resolveGrid`

**File**: `src/figma/component-set-parser.ts:1498-1501`
**Code**:
```typescript
if (node.layoutWrap === 'WRAP' && css['display'] === 'flex') {
  css['flex-wrap'] = 'wrap';
  if (node.counterAxisSpacing) css['row-gap'] = `${node.counterAxisSpacing}px`;
}
```
**Problem**: This wrap handling is inside `resolveGrid()`, which only fires if `node.layoutGrids` is non-empty. A plain WRAP auto-layout without grid definitions never reaches this code.
**Impact**: Auto-layout frames with `layoutWrap: WRAP` don't get `flex-wrap: wrap` CSS.
**Solution**: Move the wrap check to `resolveLayout()` or add a separate wrap resolution step that runs for all flex containers.

---

### 7.4 `preserveRatio` emits aspect ratio but doesn't constrain sizing

**File**: `src/figma/component-set-parser.ts:1542-1546`
**Problem**: `aspect-ratio` CSS is emitted when `preserveRatio === true`, but both `width` AND `height` are also set as fixed values. When both dimensions are fixed, `aspect-ratio` has no effect.
**Impact**: Elements that should maintain aspect ratio when resized are locked to fixed dimensions instead.
**Solution**: When `preserveRatio` is true, emit only one dimension (width) and let `aspect-ratio` control the other.

---

## 8. HIGH — Icon / SVG Asset Issues

### 8.1 Icon color variant switching not implemented

**File**: `src/figma/variant-prompt-builder.ts` ~lines 800-900
**Problem**: When the same icon position has multiple color variants (e.g., star icon in 4 different colors for default/hover/disabled/error), the code creates separate SVG files and documents them in the prompt. But the prompt does NOT tell the LLM how to conditionally switch between the SVG files based on variant state.
**Impact**: Only the default color variant SVG is referenced in the generated code. State-specific icon colors are lost.
**Solution**: Generate explicit conditional rendering guidance: "When state=error, use `left-icon-star-error.svg`. When state=default, use `left-icon-star.svg`."

---

### 8.2 SVG dimension extraction regex ignores units

**File**: `src/figma/asset-export.ts` ~lines 686-687
**Code**:
```typescript
width="(\d+(?:\.\d+)?)"
```
**Problem**: The regex only matches bare numbers. Figma SVGs may include `width="24px"` (with unit) or `width="100%"` which won't match.
**Impact**: SVG dimensions silently default to viewBox-based sizing, which may not match the intended icon size.
**Solution**: Extend regex to handle units: `width="(\d+(?:\.\d+)?)(px|%|em)?"`.

---

### 8.3 Asset dimensions collected but never injected into CSS

**Files**: `src/figma/asset-export.ts` (builds `AssetEntry.dimensions`), `src/figma/variant-prompt-builder.ts` (receives `dimensionMap`)
**Problem**: Icon dimensions from SVGs are collected via `buildDimensionMap()` and passed through the pipeline, but the generated `<img>` tags have no explicit `width`/`height` attributes.
**Impact**: Icons may render at wrong sizes if the SVG viewBox doesn't match Figma's intended size. Browser has to calculate from viewBox aspect ratio.
**Solution**: Emit `width` and `height` attributes on `<img>` tags using the dimension map data.

---

### 8.4 Silent asset download failure

**File**: `src/output.ts` ~lines 93-98
**Code**:
```typescript
for (const asset of assets) {
  if (!asset.content) continue; // skip if download failed
}
```
**Problem**: If an SVG download fails (network error, rate limit, etc.), the asset is silently skipped. The generated code still references `./assets/icon.svg` but the file doesn't exist.
**Impact**: Missing icon images in the output. No warning in the build output or fidelity report.
**Solution**: Log a warning for each skipped asset and include it in the fidelity report.

---

## 9. HIGH — Page Pipeline Issues (PATH C)

### 9.1 `isMultiSectionPage()` requires section-like child names

**File**: `src/convert.ts:86-124`
**Problem**: All three detection signals require `hasSectionLikeChild` to be true — at least one child name must match `/header|hero|footer|navbar|nav|section|feature|...`. A page with children named "Block 1", "Block 2", "Block 3" (common in real Figma files) won't be detected as a page.
**Impact**: Pages with non-standard section names fall through to PATH B (single component), which generates a single massive component instead of per-section code.
**Solution**: Add a fallback signal: if the root has vertical auto-layout AND ≥3 children each spanning >80% of parent width, treat as a page regardless of child names.

---

### 9.2 Page layout CSS uses fixed pixel width

**File**: `src/figma/page-layout.ts` ~line 140
**Code**:
```typescript
if (width) rootCSS += `  width: ${width}px;\n`;
```
**Problem**: Page width is hardcoded from Figma's canvas width (e.g., 1440px or 1920px). No `max-width`, no `width: 100%`, no responsive handling.
**Impact**: Generated pages are locked to the exact Figma canvas width. They overflow on mobile or leave blank space on larger screens.
**Solution**: Emit `max-width: ${width}px; width: 100%; margin: 0 auto;` instead of fixed `width`.

---

### 9.3 Per-section LLM calls have no cross-section context

**File**: `src/convert.ts:1106-1141`
**Problem**: Each section is generated independently. The LLM for section 3 doesn't know what section 2 looks like. Common elements like navigation links or footer structure have no consistency guarantee.
**Impact**: Repeated patterns across sections (e.g., same button style, same grid structure) may be generated differently in each section.
**Solution**: Include a brief summary of already-generated sections (class names, patterns used) in subsequent section prompts.

---

### 9.4 CSS class collision detection misses nested and pseudo selectors

**File**: `src/compile/stitch.ts:211`
**Code**:
```typescript
const classMatches = section.css.matchAll(/^\s*\.([\w-]+)\s*[{,]/gm);
```
**Problem**: Only matches top-level `.classname {` patterns. Misses `.parent .child {}`, `.button:hover {}`, `@media (...) { .button {} }`, and other nested selectors.
**Impact**: Two sections can both define `.button { color: red; }` and `.button { color: blue; }` without triggering the collision warning.
**Solution**: Use a CSS parser (like `postcss`) to extract all defined class names, or at minimum expand the regex to handle nested contexts.

---

### 9.5 Section semantic tag inference is name-pattern-only

**File**: `src/figma/page-layout.ts` ~lines 29-41
**Problem**: Semantic tag assignment (header, footer, section, nav) relies entirely on regex matching the Figma layer name. A section named "TopBar" won't be detected as `<header>` if the regex doesn't match.
**Impact**: Wrong semantic HTML tags: navigation becomes `<section>`, hero becomes `<section>`, etc.
**Solution**: Add position-based heuristics: first child → `<header>`, last child → `<footer>`, remaining → `<section>`. Also check for nav/link patterns in children.

---

### 9.6 `extractJSXBody` picks LAST return statement — may extract wrong function

**File**: `src/compile/stitch.ts:44-45`
**Code**:
```typescript
const returnMatch = matches[matches.length - 1];
```
**Problem**: If the LLM generates helper functions after the main component (or inline arrow functions with returns), the code picks the wrong return statement.
**Impact**: The stitched page may include only a helper function's JSX instead of the main section content.
**Solution**: Find the return statement that belongs to the `export default function` block specifically, rather than just the last one in the file.

---

## 10. MEDIUM — Validation & Retry Issues

### 10.1 BEM validation is blocking — may cause unnecessary retries

**File**: `src/compile/retry.ts:113-124`
**Problem**: BEM class consistency check is treated as a blocking error. If the LLM generates correct visual output but uses slightly different class names than the deterministic CSS, the attempt is rejected and retried.
**Impact**: Perfectly valid visual output is rejected because class names don't match 1:1, wasting LLM calls and potentially getting worse output on retries.
**Solution**: Make BEM validation advisory (not blocking) or implement a class-name correction pass that renames classes in the generated code to match the CSS.

---

### 10.2 Layout fidelity validation only runs for PATH A

**File**: `src/compile/retry.ts:127-139`
**Problem**: `enforceLayoutFidelity` is only `true` for PATH A (component sets). PATH B and PATH C never validate layout fidelity.
**Impact**: Single components and page sections can have completely wrong layouts without triggering a retry.
**Solution**: Enable layout fidelity validation for all paths (adjusting thresholds per path type).

---

### 10.3 Text fidelity check doesn't verify text is in the correct element

**File**: `src/compile/retry.ts:157-166`
**Problem**: `validateTextFidelity` only checks that expected text strings appear somewhere in the raw code. It doesn't verify they're in the right HTML element or have the right styling.
**Impact**: Text can be present but in the wrong location (e.g., button label appearing in a comment) and still pass validation.
**Solution**: Validate that each expected text literal appears inside a JSX text node or attribute, not in a comment or import statement.

---

## 11. MEDIUM — Framework Output Issues

### 11.1 CSS injection paren balancing ignores JSX string context (React/Solid)

**File**: `src/compile/inject-css.ts` ~lines 54-62
**Problem**: The parenthesis depth tracking for finding the `return(` closing paren doesn't account for parens inside JSX string attributes: `<div onClick={() => alert("hello (world)")}>`.
**Impact**: CSS injection splits the JSX at the wrong position, resulting in malformed code.
**Solution**: Use the same string-context-aware paren balancing that `extractJSXBody()` in `stitch.ts` uses.

---

### 11.2 Vue/Svelte CSS injection replaces ALL existing styles

**File**: `src/compile/inject-css.ts` ~lines 101-115
**Problem**: Uses regex replacement that wipes the entire existing `<style>` block. If Mitosis generated any scoped styles, they're lost.
**Impact**: Mitosis-generated layout styles are overwritten by the injected variant CSS.
**Solution**: Append to the existing style block instead of replacing it.

---

### 11.3 React and Solid both output `.tsx` — file collision

**File**: `src/types/index.ts` (FRAMEWORK_EXTENSIONS)
**Problem**: Both React (`.jsx`) and Solid (`.tsx`) frameworks are supported, but if a user selects both, they write to different extensions. However, Solid's `.tsx` could conflict with the Mitosis source `.lite.tsx` in consumers that auto-detect file types.
**Impact**: Minor — mainly a naming confusion. Not a functional issue unless the build tool incorrectly picks up `.lite.tsx` as Solid code.

---

## 12. MEDIUM — Web Server Issues

### 12.1 `process.env.FIGMA_TOKEN` is mutated globally per request

**File**: `src/web/server.ts:69-70`
**Code**:
```typescript
const previousToken = process.env.FIGMA_TOKEN;
process.env.FIGMA_TOKEN = figmaToken;
```
**Problem**: The Figma token is set globally on `process.env`. If two concurrent requests arrive, the second request's token overwrites the first's.
**Impact**: Concurrent web UI users may use each other's Figma tokens, causing authentication failures or unauthorized access.
**Solution**: Pass the token directly to `FigmaClient` constructor rather than using `process.env`. Thread the token through the call chain.

---

### 12.2 Session storage is in-memory with no expiry

**File**: `src/web/server.ts:22`
**Code**:
```typescript
const sessions = new Map<string, ConversionResult>();
```
**Problem**: Sessions are never cleaned up. Each conversion result (including full framework code + SVG assets) is stored in memory permanently.
**Impact**: Memory leak — the server's RAM usage grows unbounded with each conversion.
**Solution**: Add a TTL (e.g., 1 hour) or LRU cache with a max entry count.

---

### 12.3 Client disconnect doesn't cancel the conversion pipeline

**File**: `src/web/server.ts:151-154`
**Code**:
```typescript
req.on('close', () => {
  // Client disconnected — pipeline continues but events stop
});
```
**Problem**: If the client disconnects (closes browser tab), the LLM calls and Figma API requests continue running, wasting compute and API quota.
**Impact**: Wasted LLM tokens and API calls for abandoned requests.
**Solution**: Pass an `AbortSignal` through the pipeline and cancel pending LLM/Figma requests on disconnect.

---

## 13. LOW — Miscellaneous Issues

### 13.1 `cornerSmoothing` approximation is linear

**File**: `src/figma/component-set-parser.ts:1814-1815`
**Code**:
```typescript
css['border-radius'] = `${Math.round(r * (1 + node.cornerSmoothing * 0.5))}px`;
```
**Problem**: Figma's `cornerSmoothing` (squircle) cannot be represented by CSS `border-radius` alone. The linear approximation `r * (1 + smooth * 0.5)` doesn't produce the correct iOS-style squircle shape.
**Impact**: Rounded corners appear slightly different from Figma's squircle rendering.
**Solution**: No CSS equivalent exists. For high fidelity, use CSS `mask-image` with an SVG squircle path. The current approximation is a reasonable fallback — document the limitation.

---

### 13.2 `heuristicCursor()` based on name only

**File**: `src/figma/component-set-parser.ts:1905-1913`
**Problem**: Cursor type is inferred from the node name (e.g., "button" → `pointer`). This is purely heuristic and may be wrong for renamed layers.
**Impact**: Minor — cursor is cosmetic and the heuristic covers common cases.

---

### 13.3 `Figma's `transitionDuration` used for CSS transition hint

**File**: `src/figma/component-set-parser.ts:1916-1925`
**Problem**: `buildTransitionHint()` reads `node.transitionDuration` and `node.transitionEasing`, which are Figma PROTOTYPE properties (page navigation transitions), NOT CSS transitions. The code resolves this correctly by not emitting them (comment at line 1429), but the function exists and could be accidentally called.
**Impact**: None currently — the function is dead code.
**Solution**: Remove the unused function or clearly mark it as prototype-specific.

---

### 13.4 No font loading or @font-face generation

**Problem**: The entire pipeline generates CSS that references font families (e.g., `"Inter", sans-serif`, `"Host Grotesk", sans-serif`) but never generates `@font-face` declarations or Google Fonts import links.
**Impact**: Generated components display in the system's fallback font unless the developer manually imports the fonts.
**Solution**: Collect all unique `font-family` values from the CSS, detect if they're Google Fonts, and emit an `@import` or `<link>` for each.

---

## 14. Summary Table

| # | Severity | Category | Issue | Path |
|---|----------|----------|-------|------|
| 2.1 | CRITICAL | Extraction | Only first stroke extracted | A,B,C |
| 2.2 | CRITICAL | Extraction | Variable mode fallback picks wrong default | A,B,C |
| 2.3 | CRITICAL | Extraction | Paint-level opacity lost in CSS | A,B,C |
| 2.4 | CRITICAL | Extraction | Style hash collision in globalVars | A,B,C |
| 2.5 | CRITICAL | Extraction | Component property refs not resolved | A |
| 3.1 | CRITICAL | LLM | defaultVariantYaml truncated first in PATH A | A |
| 3.2 | CRITICAL | LLM | Token estimation inaccurate (3.5 char/token) | A,B,C |
| 3.3 | CRITICAL | Server | Web server ignores LLM selection | Web |
| 3.4 | CRITICAL | LLM | No output budget scaling for design complexity | A |
| 3.5 | CRITICAL | LLM | Raw Paint objects sent when cssReadyNode is null | B |
| 4.1 | HIGH | CSS | `!important` on border blocks variant overrides | A |
| 4.2 | HIGH | CSS | `!important` on all CENTER strokes | A |
| 4.3 | HIGH | CSS | Behavioral styles disabled by default | A |
| 4.4 | HIGH | CSS | Icon color deleted from child CSS | A |
| 4.5 | HIGH | CSS | Radial gradient center position lost | A,B |
| 4.6 | HIGH | CSS | Angular gradient rotation lost | A,B |
| 4.7 | HIGH | CSS | Diamond gradient approximated as radial | A,B |
| 5.1 | HIGH | Visual | Multi-layer fills with blend modes collapse | A,B |
| 5.2 | HIGH | Visual | `paragraphSpacing` not valid CSS | B |
| 5.3 | HIGH | Visual | Image fills not downloaded — empty url() | A,B |
| 5.4 | HIGH | Visual | `showShadowBehindNode` flag ignored | A,B |
| 6.1 | HIGH | Typography | `-webkit-` properties as camelCase | B |
| 6.2 | HIGH | Typography | Letter spacing unit conversion missing | B |
| 6.3 | HIGH | Typography | Vertical text alignment not extracted | B |
| 6.4 | HIGH | Typography | Named text style not resolved | A,B,C |
| 6.5 | HIGH | Typography | Text color crashes on style reference string | B |
| 7.1 | HIGH | Layout | Absolute positioned elements missing left/top | A,B |
| 7.2 | HIGH | Layout | HUG sizing missing `width: fit-content` | A,B |
| 7.3 | HIGH | Layout | `layoutWrap` handling gated behind `layoutGrids` | A,B |
| 7.4 | HIGH | Layout | `preserveRatio` ineffective with fixed dimensions | A,B |
| 8.1 | HIGH | Icons | Icon color variant switching not implemented | A |
| 8.2 | HIGH | Icons | SVG dimension regex ignores units | A |
| 8.3 | HIGH | Icons | Asset dimensions not in generated code | A |
| 8.4 | HIGH | Icons | Silent asset download failure | A,B,C |
| 9.1 | HIGH | Page | Page detection requires section-like names | C |
| 9.2 | HIGH | Page | Fixed pixel width for pages | C |
| 9.3 | HIGH | Page | No cross-section context for LLM | C |
| 9.4 | HIGH | Page | CSS collision detection misses nested selectors | C |
| 9.5 | HIGH | Page | Section semantic tag name-pattern only | C |
| 9.6 | HIGH | Page | `extractJSXBody` picks wrong return | C |
| 10.1 | MEDIUM | Validation | BEM validation too aggressive | A |
| 10.2 | MEDIUM | Validation | Layout fidelity only for PATH A | B,C |
| 10.3 | MEDIUM | Validation | Text fidelity doesn't check position | A,B,C |
| 11.1 | MEDIUM | Output | CSS injection paren bug (React/Solid) | A,B,C |
| 11.2 | MEDIUM | Output | Vue/Svelte style replacement wipes existing | A,B,C |
| 11.3 | MEDIUM | Output | React/Solid extension potential confusion | All |
| 12.1 | MEDIUM | Server | FIGMA_TOKEN mutated globally (race condition) | Web |
| 12.2 | MEDIUM | Server | Session storage never expires (memory leak) | Web |
| 12.3 | MEDIUM | Server | Client disconnect doesn't cancel pipeline | Web |
| 13.1 | LOW | Visual | cornerSmoothing squircle approximation | A,B |
| 13.2 | LOW | Visual | Cursor heuristic name-based only | A,B |
| 13.3 | LOW | Code | Dead `buildTransitionHint` function | — |
| 13.4 | LOW | Visual | No @font-face / Google Fonts import | A,B,C |

---

**Total: 50 issues**
- CRITICAL: 10
- HIGH: 28
- MEDIUM: 9
- LOW: 4

Each issue above is based on direct code reading with file/line references. Solutions are the minimal changes needed to fix each root cause without over-engineering.
