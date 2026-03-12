# Known Issues & Improvement Roadmap

Deep audit of every layer — Figma extraction, pipeline routing, CSS generation, LLM prompts, validation, compilation, web UI, and server infrastructure. Goal: handle **all** Figma design types and produce import-ready code that matches the original design exactly.

---

## Table of Contents

1. [P0 — Critical (Data Loss / Broken Output)](#p0--critical)
2. [P1 — High (Significant Quality Gaps)](#p1--high)
3. [P2 — Medium (Edge Cases & Missing Features)](#p2--medium)
4. [P3 — Low (Polish & Optimization)](#p3--low)
5. [Security](#security)
6. [Performance](#performance)

---

## P0 — Critical

### 1. Image Fills Never Downloaded — All Image Backgrounds Lost

**Files**: `src/figma-complete/extractors/visuals.ts`, `src/figma/asset-export.ts`

Figma image fills store an `imageRef` hash, not a URL. The pipeline captures the hash but never calls `GET /v1/images/:key` to download the actual image. Every frame/shape with an image fill renders with no background in the output. This affects hero sections, card thumbnails, avatar images, and any design using photos.

**Fix**: Add an image download pipeline — resolve `imageRef` → download URL → save to `assets/` → rewrite as `background-image: url(./assets/...)`.

---

### 2. LLM Output Silently Truncated — No `finish_reason` Check

**Files**: `src/llm/claude.ts`, `src/llm/openai.ts`, `src/llm/deepseek.ts`

None of the LLM providers check `stop_reason` / `finish_reason`. When output hits the token limit, the response is truncated mid-code. The truncated output fails Mitosis parsing, wastes a retry attempt, and the error message ("unexpected token") doesn't tell the LLM to produce shorter output.

**Fix**: Check `finish_reason === 'length'` / `stop_reason === 'max_tokens'`. When detected, retry with increased `maxTokens` or a simplified prompt.

---

### 3. Few-Shot Examples Use Wrong YAML Format

**File**: `prompts/examples/`

The 4 few-shot examples use an old YAML format (`globalVars`, `layout_001`, `fill_001` references). The actual pipeline produces inline properties on nodes. The LLM sees training examples in one format and real input in another — causing confusion about how to interpret the design data.

**Fix**: Regenerate all examples using the current `serializeNodeForPrompt()` output format.

---

### 4. Contradictory SVG Rendering Instructions (PATH A)

**Files**: `src/figma/variant-prompt-builder.ts` lines 1351, 1384

Rule #10: "SVG icons MUST be rendered INLINE — NEVER use `<img src>`."
But the inline checkbox example (line 1384) uses `<img src="./assets/check.svg">`. The LLM gets contradictory signals and inconsistently switches between inline SVG and `<img>` tags.

**Fix**: Align the example with the rule — either use inline SVGs everywhere or `<img>` tags everywhere. Since assets are exported as files, `<img>` is the correct pattern; update rule #10 accordingly.

---

### 5. Retry Loop Does Not Use Multi-Turn — LLM Can't See Its Own Previous Output

**File**: `src/compile/retry.ts` lines 252-258

Each retry concatenates the error to the full user prompt. The LLM never sees its own previous attempt — it can't understand what went wrong. This drastically reduces retry success rates. Additionally, the prompt grows with each retry (error messages accumulate), causing truncation of design data.

**Fix**: Use multi-turn conversation: send previous LLM output as an assistant message, then error feedback as a user message.

---

### 6. Card Example Teaches LLM to Invent CSS Values

**File**: `prompts/examples/card.md` lines 142-148

The card example contains CSS values not present in the YAML: `padding: 0 16px 16px`, `width: calc(100% + 32px)`, `margin: 0 -16px`, `background-color: #E5E7EB`. This teaches the LLM to hallucinate CSS values, directly contradicting the "NEVER invent CSS values" rule.

**Fix**: Rewrite the card example so all CSS values come directly from the YAML data.

---

### 7. `fixInlineStyleStrings()` Creates Forbidden `css={{}}`

**File**: `src/compile/cleanup.ts` line 603

The cleanup function converts `style="color: red"` → `css={{ color: 'red' }}`. But the system prompt explicitly forbids `css={{...}}` for PATH B/C. The cleanup actively creates code that violates the prompt rules and may cause Mitosis compile issues.

**Fix**: Convert `style="..."` to `class="..."` + CSS rules, or remove the conversion entirely.

---

### 8. Letter-Spacing Percentage Conversion is Wrong

**File**: `src/convert.ts` lines 539-544

Figma's PERCENT letter-spacing (e.g., `1` meaning 1% of font-size) is directly used as `em` value (`1em`). It should be divided by 100 to get `0.01em`. This makes all percentage-based letter spacing 100x too large.

**Fix**: `letterSpacing.value / 100` for PERCENT mode.

---

### 9. Advisory Validation Errors Trigger Unnecessary Retries

**File**: `src/compile/retry.ts` lines 299-307

Advisory (non-blocking) validation errors are combined with blocking errors and trigger retries. A cosmetic advisory issue (e.g., minor a11y suggestion) consumes a retry attempt that could be used for actual parse failures. This wastes LLM API calls.

**Fix**: Only trigger retries for blocking errors. Include advisory errors in the feedback message but don't use them as retry triggers.

---

### 10. Refinement Breaks After Server Session Expiry

**Files**: `src/web/server.ts` lines 356-359, `src/web/public/app.js`

The refine endpoint uses `getSessionEntry()` which does NOT have disk fallback (unlike preview/download endpoints). When a user restores a project from localStorage after the 1-hour session has expired, refinement returns "Session not found or expired" with no recovery path.

**Fix**: Add disk fallback to the refine endpoint. Re-hydrate session from disk when the in-memory session is missing.

---

## P1 — High

### 11. No Responsive Design Output

**Files**: `src/convert.ts`, `src/figma/page-layout.ts`, `src/compile/generate.ts`

All CSS output uses fixed pixel values. No `rem`/`em` conversion, no `clamp()` for fluid typography, no media queries derived from Figma constraints, no container queries. Designs with `FILL` sizing, `minWidth`/`maxWidth`, or constraint-based positioning produce static pixel layouts that break on different screen sizes.

---

### 12. Missing CSS Properties — Shadows, Filters, Blend Modes

**Files**: `src/compile/css-fidelity-validate.ts`, `src/figma-complete/transformers/`

Not generated or validated:
- `box-shadow` / `text-shadow` (Figma drop shadow and inner shadow effects)
- `backdrop-filter` / `filter` (blur, brightness, contrast, saturate)
- `mix-blend-mode` (Figma layer blend modes)
- `mask` / `clip-path` (complex clipping)
- `opacity` (node-level opacity)
- `aspect-ratio`
- `text-overflow: ellipsis` + `white-space: nowrap` (Figma text truncation)

---

### 13. Gradient Direction Lost

**Files**: `src/convert.ts` lines 458-463, `src/compile/css-fidelity-validate.ts` lines 109-117

Gradient color stops are extracted but the gradient angle/direction from `gradientHandlePositions` is only partially computed. The CSS fidelity validator only checks color stops — `linear-gradient(90deg, red, blue)` and `linear-gradient(180deg, red, blue)` are considered equivalent.

---

### 14. `GRADIENT_DIAMOND` Not Handled

**Files**: `src/figma-complete/extractors/visuals.ts`, `src/figma-complete/transformers/style.ts`

Diamond gradients fall through to a `linear-gradient()` approximation, which is visually incorrect.

---

### 15. Figma API — No Rate Limit Retry / Backoff

**File**: `src/figma/fetch.ts` lines 82-87

429 (rate limited) responses throw immediately. For component sets with many icon variants, sequential `getImages()` calls easily trigger rate limits and fail the entire pipeline.

**Fix**: Add exponential backoff retry for 429/500/503 responses.

---

### 16. Figma API — No Request Timeout

**File**: `src/figma/fetch.ts` lines 67-93

The `fetch()` call has no `AbortController` or timeout. If the Figma API hangs, the entire pipeline hangs indefinitely.

---

### 17. No LLM API Retry on Transient Errors

**Files**: `src/llm/claude.ts`, `src/llm/openai.ts`, `src/llm/deepseek.ts`

None of the providers implement retries for 429/500/503 errors. A single transient API error fails the entire conversion.

---

### 18. `maxTokens: 8192` Too Low for Complex Components

**File**: `src/config.ts` line 142

For complex component sets (30+ variants, many child elements), 8192 output tokens is insufficient. Claude supports 16384 output tokens. The `scaleOutputTokens()` can scale to 4x (32768) but only when input is large enough. Base should be higher.

---

### 19. PATH C False Positive — 3 Wide Children Triggers Multi-Section

**File**: `src/convert.ts` lines 216-224

Signal 4 for multi-section detection has no `hasSectionLikeChild` requirement. Three wide children (any names) trigger PATH C even for a simple 3-column card grid, which should be PATH B.

---

### 20. Section CSS Not Scoped — Styles Leak Between Sections

**File**: `src/compile/stitch.ts` lines 228-261

`scopeSectionCSS()` only scopes class selectors (`.foo`). Element selectors (`h1`, `button`, `div`), attribute selectors (`[data-theme]`), and `@media` query internals pass through unscoped, causing global style leaks.

---

### 21. Missing System Prompt Guidance for Complex UI Patterns

**File**: `prompts/system.md`

No guidance for: tables, accordions, modals/dialogs, dropdowns/popovers, carousels, pagination, breadcrumbs, progress bars, tooltips, toast notifications. The LLM guesses at structure and ARIA patterns for these common components.

---

### 22. Only 4 Few-Shot Examples — Sparse Coverage

**File**: `prompts/examples/`

Only button, card, form, and navbar. Missing: data table, modal, sidebar, dashboard, tab component, accordion, image gallery, pricing table, footer, hero section.

---

### 23. PATH A System Prompt Has No Few-Shot Examples

**File**: `src/figma/variant-prompt-builder.ts` lines 1299-1401

PATH A uses a fully custom system prompt with only one hardcoded inline example (checkbox). PATH B gets all 4 few-shot examples. PATH A (the most complex path) gets the least training signal.

---

### 24. Absolute Positioning Produces Non-Responsive Layout

**File**: `src/figma/page-layout.ts` lines 290-338

When there's no auto-layout, all children get `position: absolute` with pixel coordinates. No attempt to infer relative positioning, percentage-based layouts, or flex/grid alternatives.

---

### 25. Font Resolver — No Validation That Font Exists on Google Fonts

**File**: `src/compile/font-resolver.ts`

If a font is not on Google Fonts (e.g., "Circular", "Gilroy", "Proxima Nova"), the generated `@import` URL returns a 404 with no warning. The output silently falls back to system fonts.

**Fix**: Validate font availability or emit a warning comment in the CSS.

---

### 26. CSS Fidelity Threshold Too Lenient (50%)

**File**: `src/config.ts` line 183

`minCSSCoverage: 0.5` means half the design's visual properties can be missing and validation still passes.

---

### 27. `deterministic-css.ts` May Be Missing From Branch

The MEMORY.md documents `buildDeterministicCSS()`, `injectClassNames()`, `stripInlineCSS()` in this file. If it's missing, PATH B/C deterministic CSS is non-functional — falling back to LLM-generated CSS.

**Fix**: Verify file exists on the current branch. If missing, restore from the branch where it was created.

---

### 28. Accessibility Validator Strips Dynamic ARIA Attributes

**File**: `src/compile/a11y-validate.ts` lines 139-157

`extractHTMLFromJSX()` replaces ALL `{...}` expressions with "content" — including `aria-label={...}`, `role={...}`, `tabIndex={...}`. axe-core never sees dynamic ARIA attributes, causing false positives for missing labels/roles that are actually present.

---

### 29. BEM Validator Misses `class={state.classes}` (PATH A)

**File**: `src/compile/bem-validate.ts` lines 31-42

Only static `class="..."` is parsed. PATH A uses `class={state.classes}` — BEM validation effectively does nothing for the most complex path.

---

### 30. Fidelity Report Missing CSS and A11y Checks

**File**: `src/compile/fidelity-report.ts` lines 37-92

`buildFidelityReport()` does not call `validateCSSFidelity()` or `validateAccessibility()`. These are only run in the retry loop, not in the final report.

---

## P2 — Medium

### 31. `minWidth`/`maxWidth`/`minHeight`/`maxHeight` Not Extracted

**Files**: `src/figma-complete/extractors/layout.ts`, `src/figma-complete/types.ts`

Critical auto-layout v5 properties for responsive design are not extracted by the complete extractor. The pipeline accesses them directly from raw node data, but they're absent from the extraction types.

---

### 32. Figma Variables Never Fetched — Require Separate API Call

**Files**: `src/figma/fetch.ts`, `src/figma-complete/api-parser.ts` lines 101-106

Variables require `GET /v1/files/:key/variables/local` — a separate API call not implemented. The variables extractor runs but always has empty data.

---

### 33. Variable Alias Chains Not Resolved

**File**: `src/figma-complete/design-extractor.ts` lines 88-111

Variables with `type: VARIABLE_ALIAS` are stored as raw references, not resolved to concrete values. Alias chains (variable → variable → value) are never walked.

---

### 34. No Design Token Export

No extraction pipeline produces design tokens in W3C DTCG format, Style Dictionary format, or any other standard. Variable data is captured but never transformed into usable token structures.

---

### 35. `layoutSizing` Derivation Can't Detect FILL Mode

**File**: `src/figma-complete/extractors/layout.ts` lines 50-61

The extractor derives sizing from old-style `primaryAxisSizingMode` / `counterAxisSizingMode` which only distinguish FIXED vs HUG. The newer `layoutSizingHorizontal` / `layoutSizingVertical` (which include FILL) are not extracted.

---

### 36. Static Width/Height Prevents Responsive Output

**File**: `src/figma-complete/extractors/layout.ts` lines 243-247

The simplified layout always sets explicit `width` and `height` from `absoluteBoundingBox`, even when the node uses HUG or FILL sizing. This produces fixed dimensions that prevent responsive behavior.

---

### 37. VIDEO and EMOJI Paint Types Not Handled

**File**: `src/figma-complete/extractors/visuals.ts`

VIDEO fills and EMOJI fills are silently dropped in the simplified representation.

---

### 38. Chart Detection False Positives — Common Words

**File**: `src/figma/chart-detection.ts` lines 277-291

Chart-positive tokens include `'bar'` (weight 1) and `'line'` (weight 1). "Search bar", "Divider line", "Progress bar" all score chart-positive points, potentially triggering incorrect chart detection.

---

### 39. Chart Codegen — Missing Chart Types

**File**: `src/compile/chart-codegen.ts` lines 33-101

Not supported: histogram, waterfall, candlestick, gauge/speedometer, sankey, heatmap, bubble chart. `composed` type maps to just BarChart (losing line overlay).

---

### 40. Compound State Splitting Fragile

**File**: `src/figma/component-set-parser.ts` lines 400-411

Only splits on `" - "` and `-`. Slash-separated states (`"Error/Hover"`), multi-word kebab states (`"Filled-In-Hover"` splits as `["Filled", "In-Hover"]` instead of `["Filled-In", "Hover"]`) are not handled.

---

### 41. `truncateToFit()` Can Cut Mid-YAML

**File**: `src/compile/retry.ts` lines 54-119

When YAML is too large, truncation cuts by character count — potentially in the middle of a node definition, leaving broken YAML that confuses the LLM.

**Fix**: Truncate at node boundaries (complete YAML blocks).

---

### 42. No Concurrent Section Throttling (PATH C)

**File**: `src/convert.ts` line 1763

`Promise.all(sectionPromises)` runs all sections in parallel. With 10+ sections, this creates 10+ concurrent LLM API calls, potentially hitting rate limits.

---

### 43. Section Stitching Loses State

**File**: `src/compile/stitch.ts` lines 272-353

The stitched page component is static (no `useStore`). If any section's LLM output included stateful logic (event handlers, toggles), that state is lost during JSX body extraction.

---

### 44. `extractCSSElementClasses` Regex Too Simple

**File**: `src/figma/variant-prompt-builder.ts` lines 857-870

Regex-based class extraction misses classes in nested selectors, escaped characters, and multi-line selectors.

---

### 45. Cleanup `fixSVGAttributes` Incomplete

**File**: `src/compile/cleanup.ts` lines 249-264

Missing JSX conversions for SVG attributes: `font-family`, `font-size`, `font-weight`, `text-anchor`, `dominant-baseline`, `text-decoration`, `stop-color`, `stop-opacity`, `baseline-shift`, `pointer-events`, `image-rendering`.

---

### 46. `fixMapToFor()` String-Based — Breaks on Complex Cases

**File**: `src/compile/cleanup.ts` lines 452-520

`.map()` to `<For>` conversion uses string manipulation, not AST. Breaks on chained maps, complex callbacks, nested maps, and maps inside template literals.

---

### 47. `hoistLocalConsts()` Can Corrupt Variable Names

**File**: `src/compile/cleanup.ts` line 224

Regex replaces all occurrences of a variable name in JSX. If a declaration name matches text content (e.g., `const items = [...]` and there's "items" in the UI), the text gets corrupted to `state.items`.

---

### 48. `Roboto` Classified as System Font

**File**: `src/compile/font-resolver.ts` line 26

Roboto is in `SYSTEM_FAMILIES` but is NOT installed by default on macOS or Windows (only Android). Designs using Roboto silently fall back to system fonts on desktop.

---

### 49. Font Weight Range Incomplete

**File**: `src/compile/font-resolver.ts` lines 68-76

Google Fonts import only requests weights 300-700. Missing: 100 (Thin), 200 (Extra Light), 800 (Extra Bold), 900 (Black). No italic variant support.

---

### 50. No Font Shorthand Parsing

**File**: `src/compile/font-resolver.ts` lines 37-58

Only `font-family` declarations are scanned. The `font` shorthand (e.g., `font: 400 16px/24px "Inter"`) is not parsed.

---

### 51. Component Name Not Sanitized for JavaScript

**File**: `src/figma/variant-prompt-builder.ts` line 784

`componentName = data.name.replace(/\s+/g, '')` only strips spaces. Names with parens like `"Button (Primary)"` become `"Button(Primary)"` — invalid JavaScript identifier.

---

### 52. `inferSemanticTag` Position-Based — Can Misassign Header/Footer

**File**: `src/figma/page-layout.ts` lines 31-48

First section is always `header`, last is always `footer`. Incorrect for pages where the first section is a hero or where there's no footer.

---

### 53. CSS Fidelity — No Shadow, Border, Line-Height, Letter-Spacing Validation

**File**: `src/compile/css-fidelity-validate.ts`

Only validates colors, font sizes, font weights, border radius, and gradient colors. Missing: box-shadow, text-shadow, border-width, border-color, line-height, letter-spacing, opacity, text-transform.

---

### 54. CSS Fidelity — No Hex/RGB Normalization

**File**: `src/compile/css-fidelity-validate.ts` lines 51-75

`#FF0000` and `rgb(255,0,0)` won't match because they're compared as raw strings. No format normalization between color representations.

---

### 55. Semantic Validator — Missing Component Categories

**File**: `src/compile/semantic-validate.ts` lines 38-68

Not mapped (validation skipped entirely): accordion, alert/toast/snackbar, progress, meter, tooltip, carousel, dropdown/popover, tree/treeview, avatar, skeleton.

---

### 56. Semantic Validator — Doesn't Handle Fragment Root `<>`

**File**: `src/compile/semantic-validate.ts` lines 89-121

If root is a fragment `<>`, the regex `^\s*<(\w+)` won't match. Root tag validation is skipped entirely.

---

### 57. `a11y-validate.ts` — Errors Silently Return Passed

**File**: `src/compile/a11y-validate.ts` line 128

The catch block returns `{ passed: true }` on any error. If axe-core or jsdom crashes, the validator reports "passed" and the issue is never detected.

---

### 58. `a11y-validate.ts` — Color Contrast Disabled

**File**: `src/compile/a11y-validate.ts` line 94

`color-contrast` rule is disabled unconditionally. But for deterministic CSS paths (PATH A/B/C) where all colors are known, this could catch real contrast violations.

---

### 59. No Token Usage Tracking

**Files**: `src/llm/claude.ts`, `src/llm/openai.ts`, `src/llm/deepseek.ts`

No input/output token tracking. Can't detect truncation, optimize costs, or report usage metrics.

---

### 60. No Streaming — Full Response Wait

**Files**: `src/llm/claude.ts`, `src/llm/openai.ts`, `src/llm/deepseek.ts`

All providers wait for the complete LLM response. For large components (30-60s generation), there's no progress indication or early failure detection.

---

### 61. Temperature Not Increased on Retries

**File**: `src/compile/retry.ts`

Temperature is 0.1 for all attempts. When the LLM gets stuck in the same error pattern, slightly increasing temperature (0.1 → 0.2 → 0.3) on retries could help escape local minima.

---

### 62. Form Example Contradicts "No useStore" Rule

**File**: `prompts/examples/form.md`

The form example uses `useStore` with `name`, `email`, `message` state and `onChange` handlers. The system prompt says "Render ONLY the default variant as a completely static component" and "Do NOT create useStore state."

---

### 63. Refinement — No Validation (a11y, BEM, Fidelity)

**File**: `src/web/refine.ts`

Refinement only does Mitosis parse validation. No accessibility, BEM, semantic, text, CSS, or layout fidelity checks. A refinement can introduce regressions with no detection.

---

### 64. Refinement — Only 1 Retry on Parse Failure

**File**: `src/web/refine.ts` lines 115-132

Main generation does 3 retries + 1 fallback. Refinement does only 1 retry. Users invest time in conversation and expect it to work.

---

### 65. Figma URL — Branch, Prototype, FigJam URLs Not Supported

**File**: `src/utils/figma-url-parser.ts` lines 12-41

Only matches `/file/` and `/design/` paths. Missing: `/proto/` (prototypes), `/board/` (FigJam), `?branch-id=` (branches), multi-node selection URLs.

---

### 66. Multi-Node API Response Drops All But First Node

**File**: `src/figma-complete/api-parser.ts` lines 17-24

When `GetFileNodesResponse` contains multiple node IDs, only the first is used. All others are silently discarded.

---

### 67. Two Parallel Data Extraction Paths — Inconsistent

The codebase has `src/figma/simplify.ts` (Framelink) AND `src/figma-complete/` (custom). The pipeline references properties from both systems AND accesses raw Figma data directly, creating three competing data sources.

---

### 68. `flex-grow: 1` AND `width: 100%` Both Set for FILL

**File**: `src/figma/component-set-parser.ts` line 1859

When `fill` is detected, both `flex-grow: 1` AND `width: 100%` are set. In a flex container, `flex-grow: 1` alone is sufficient — `width: 100%` can cause overflow with siblings.

---

### 69. Right/Bottom Constraint — Offset Lost

**File**: `src/figma/component-set-parser.ts` line 1896-1905

For RIGHT/MAX constraints, `right: '0'` is set without the actual offset from Figma. Only correct if the element should be flush right.

---

### 70. Chart Components Skip All Validation

**File**: `src/compile/component-gen.ts`

Charts generated via `generateChartCode()` bypass the `generateWithRetry` validation loop. No a11y, BEM, text fidelity, or CSS fidelity checks.

---

### 71. `isAutoGeneratedKey` Threshold Too High

**File**: `src/figma/variant-prompt-builder.ts` line 58

The `\d{3,}` regex requires 3+ digits. Figma node IDs can be short (e.g., `frame-42`), which would not match — auto-generated segments get used as prop names, producing cryptic identifiers.

---

---

## P3 — Low

### 72. No Animation/Transition Extraction

Only `@keyframes spin` is auto-generated (for spinners). No transition property extraction from Figma prototyping data. No hover/focus/active transitions. No entrance/exit animations. No scroll-driven animations.

---

### 73. No CSS Grid Support

Only flexbox is generated. Figma auto-layout maps to flex, but some designs would be better served by CSS Grid (especially for PATH C page layouts and dashboard grids).

---

### 74. No CSS Custom Properties (Variables)

No design token extraction to CSS custom properties. All values are hardcoded in the CSS, making theming impossible without manual refactoring.

---

### 75. No Dark Mode / Theme Support for Charts

**File**: `src/compile/chart-codegen.ts`

All chart colors are hardcoded. No CSS custom properties or theme tokens. Dark mode requires editing every color value.

---

### 76. `extractStyleBlock` Non-Greedy — May Miss First `<style>` Block

**File**: `src/compile/cleanup.ts` line 80

Regex `/<style>([\s\S]*?)<\/style>\s*$/` uses non-greedy matching. With multiple `<style>` blocks, it matches only the last one and extracts the smallest content.

---

### 77. `repairTruncatedCSS` Doesn't Handle `@media` Blocks

**File**: `src/compile/cleanup.ts` lines 286-308

Brace-counting repair logic doesn't account for `@media` and `@supports` at-rules. Truncation inside a `@media` block produces invalid CSS.

---

### 78. Text Color Only From First Fill

**File**: `src/figma-complete/extractors/text.ts` lines 222-227

Text nodes can have multiple fills (gradient text). Only the first fill is used for text color — gradient text is lost.

---

### 79. Font Fallback Always `sans-serif`

**File**: `src/figma-complete/extractors/text.ts` lines 164-165

Font family is always wrapped as `"FontName", sans-serif`. No check for serif, monospace, or other categories.

---

### 80. OpenType Features Lost in Simplification

**File**: `src/figma-complete/extractors/text.ts` lines 160-248

`opentypeFlags` is extracted but not included in `buildSimplifiedTextStyle()`. Font features like ligatures and stylistic alternates are lost.

---

### 81. `StrokeStyleDefinition.styleType` is `'FILL'` Instead of `'STROKE'`

**File**: `src/figma-complete/types.ts` line 375

Type bug — stroke styles would be classified as fill styles.

---

### 82. Prototype Reactions Stored as Raw `any[]`

**File**: `src/figma-complete/extractors/component.ts` lines 100-116

Reactions (prototype interactions) have no typing or validation. Trigger types, action types, transition types are all untyped.

---

### 83. No Structured Output / Tool Use for LLM

All providers use free-form text generation parsed by regex. Structured output (JSON mode, tool use) would guarantee JSX/CSS separation, eliminate `---CSS---` delimiter issues, and reduce parse failures.

---

### 84. No Model Selection Based on Component Complexity

Simple components (badge, divider) don't need Claude Sonnet. A cheaper/faster model could handle simple components. No complexity-based model routing.

---

### 85. No LLM Response Caching

Converting the same Figma node twice calls the LLM fresh each time. A content-addressable cache (keyed by prompt hash) would avoid redundant API calls during development/testing.

---

### 86. Config Values Computed Once — No Dynamic Reload

**File**: `src/config.ts` lines 137-221

All config values are computed at module load time. Changing environment variables after startup has no effect.

---

### 87. `defaultLLM` is `deepseek` But Docs Say `claude`

**File**: `src/config.ts` line 195

CLI default is `deepseek` but CLAUDE.md/README show `--llm claude`. Users following docs need to explicitly specify provider.

---

### 88. `deepseek` Base URL Missing `/v1`

**File**: `src/config.ts` line 155

Default `baseURL` is `https://api.deepseek.com` but DeepSeek's API base is `https://api.deepseek.com/v1`.

---

### 89. Refinement Mentions `css={{}}` as Valid

**File**: `src/web/refine.ts` line 29

"Follow all Mitosis rules (`css={{}}` values must be plain string literals, etc.)" — references `css={{}}` as if valid, contradicting "Do NOT use `css={{...}}`."

---

### 90. Template Wiring Uses Brittle String Replacement

**File**: `src/template/wire-into-starter.ts` lines 317-329

`appContent.replace(importMarker, ...)` and `appContent.replace('<Route path="/" element={<LandingPage />} />', ...)` silently fail if the starter template changes format. No error reported.

---

---

## Security

### S1. XSS via Preview HTML Injection (CRITICAL)

**File**: `src/web/preview.ts` lines 300-305, 338

`componentName` and LLM-generated code are interpolated into HTML template. While backticks and `$` are escaped, carefully crafted escape sequences could break out of the template literal. Same pattern exists in client-side preview (`app.js` lines 810-811).

---

### S2. Path Traversal in Asset Serving (HIGH)

**File**: `src/web/server.ts` lines 769-803

`:filename` parameter used directly in `path.join()`. `filename=../../etc/passwd` resolves outside the assets directory. No validation that resolved path is within the expected directory.

**Fix**: Validate that `path.resolve(assetPath)` starts with the expected directory prefix.

---

### S3. Path Traversal in Save File Endpoint (HIGH)

**File**: `src/web/server.ts` lines 582-622

`componentOutputDir` depends on `result.componentName` (LLM-derived). A crafted name like `../../etc` allows writing outside the output directory.

---

### S4. No Rate Limiting on LLM Endpoints (HIGH)

**File**: `src/web/server.ts`

No rate limiting on `/api/convert` or `/api/refine`. A single user can drain LLM API credits rapidly.

---

### S5. Figma Token in localStorage — Vulnerable to XSS

**File**: `src/web/public/app.js` lines 204-217

Figma PAT stored in `localStorage` is accessible to any JavaScript on the same origin. If the preview XSS (S1) is exploited, the Figma token can be exfiltrated.

---

### S6. Session IDs Are Only Authentication

**File**: `src/web/server.ts`

Anyone who knows a session ID can access all generated code, download files, view preview, and push to GitHub. Session IDs must be cryptographically random and sufficiently long.

---

### S7. `innerHTML` Used with Unsanitized Data

**File**: `src/web/public/app.js` line 361

```javascript
duplicateMessage.innerHTML = `<strong>${name}</strong> was already converted...`;
```
`name` originates from LLM-derived `componentName`. `escapeHtml()` is not used here.

---

### S8. Preview Iframe Sandbox Negated

**File**: `src/web/public/index.html` line 454

`sandbox="allow-scripts allow-same-origin"` — the combination negates sandbox protection since same-origin scripts can remove the sandbox attribute.

---

### S9. No CSRF Protection

**File**: `src/web/server.ts`

No CSRF tokens or origin checks on POST endpoints. All mutations accept JSON bodies without verification.

---

---

## Performance

### P-1. Unbounded In-Memory Session Storage

**File**: `src/web/server.ts` lines 38, 60-69

No upper bound on session count. Each session holds full `ConversionResult` with all framework outputs and assets. Heavy usage leads to OOM.

**Fix**: Add max session count (e.g., 100). Evict oldest sessions when limit reached.

---

### P-2. Pipeline Continues After Client Disconnect

**File**: `src/web/server.ts` lines 332-335

When client disconnects during conversion, the full pipeline (Figma API + LLM calls + file generation) continues. Wastes LLM credits and server resources.

**Fix**: Pass an `AbortSignal` through the pipeline. Cancel on client disconnect.

---

### P-3. Synchronous File Reads in Request Handlers

**File**: `src/web/server.ts` lines 99-132

`loadResultFromDisk()` uses `readFileSync` calls in async handlers, blocking the event loop.

---

### P-4. Large SSE Payload on Complete Event

**File**: `src/web/server.ts` lines 298-321

All framework outputs + all assets (full SVG content) sent in one SSE event. Can be megabytes for asset-heavy components.

---

### P-5. No Debounce on Convert Requests

**File**: `src/web/public/app.js` lines 1103-1236

No server-side protection against concurrent conversions for the same URL. Each triggers full LLM pipeline.

---

### P-6. No SSE Heartbeat / Keep-Alive

**File**: `src/web/server.ts`

No periodic heartbeat during long LLM operations (30-60s). Proxies and browsers may timeout the connection.

---

### P-7. No Concurrent Request Lock on Session Mutation

**File**: `src/web/server.ts` lines 421-436

Two concurrent refinement requests for the same session both read the same conversation, send overlapping LLM calls, and race to update the session. Conversation history gets corrupted.

---

### P-8. WebContainer `npm install` on Every Conversion

**File**: `src/web/public/app.js` lines 1520-1556

WebContainer remounts the file tree and runs `npm install` on every new conversion instead of reusing the existing install.

---

---

## Issue Count Summary

| Priority | Count | Description |
|----------|-------|-------------|
| **P0** | 10 | Data loss, broken output, wrong code |
| **P1** | 20 | Significant quality gaps |
| **P2** | 40 | Edge cases, missing features |
| **P3** | 19 | Polish, optimization |
| **Security** | 9 | XSS, path traversal, auth |
| **Performance** | 8 | Memory, latency, waste |
| **Total** | **106** | |
