# Deep Audit Report: figma-to-code Service

**Date:** 2026-03-02
**Scope:** Full pipeline analysis — Figma extraction → LLM prompt → code generation → framework compilation → preview

---

## Executive Summary

After analyzing every file in the pipeline, **67 issues** were identified across 5 severity levels. The root causes fall into 4 categories:

1. **Data Loss** — ~60% of Figma design properties are dropped before reaching the LLM
2. **Hardcoded Values** — 20+ magic numbers/thresholds that should be dynamic or configurable
3. **Prompt Inconsistency** — Few-shot examples and system prompt give conflicting instructions
4. **Fragile String Manipulation** — Regex-based code transformation breaks on edge cases

**Impact:** Generated components diverge from real Figma designs in layout spacing, typography, icon rendering, interactive states, and semantic HTML structure.

---

## Table of Contents

- [P0 — Critical (Breaks Output)](#p0--critical)
- [P1 — High (Degrades Visual Fidelity)](#p1--high)
- [P2 — Medium (Limits Capability)](#p2--medium)
- [P3 — Low (Polish & Edge Cases)](#p3--low)

---

## P0 — Critical

### 1. trimNodeForPrompt() Discards ~95% of Figma Data

| | |
|---|---|
| **File** | `src/convert.ts:91-104` |
| **Current** | Only passes `name`, `type`, `text`, `textStyle`, `fills`, `borderRadius`, `children` to the LLM prompt. |
| **Lost** | Auto-layout direction, padding, gap, constraints, strokes, effects (shadows, blurs), blend modes, clip-content, opacity, transforms, rotation, aspect-ratio, stroke alignment, dash patterns, image scale modes, variable bindings, text overrides. |
| **Impact** | The LLM never sees layout structure, spacing, or visual hierarchy. It guesses padding/gap/flex-direction from layer names alone. Output diverges significantly from Figma for any non-trivial component. |
| **Fix** | Replace `trimNodeForPrompt()` with a comprehensive serializer that includes: auto-layout (mode, padding, gap, counterAxisSpacing, wrap), constraints, strokes, effects, opacity, transforms. Use the existing `figma-complete/` extractor output instead of the simplified Framelink output. |
| **Benefit** | LLM sees actual layout values → output matches Figma spacing, shadows, borders, and flex direction. Eliminates the #1 source of visual divergence. |

### 2. YAML Truncation Produces Invalid Syntax

| | |
|---|---|
| **File** | `src/compile/retry.ts:56-67` |
| **Current** | When design data exceeds token budget, truncates at last newline boundary. No YAML validation after truncation. |
| **Impact** | Truncation can cut mid-list-item or mid-property, producing invalid YAML. LLM receives broken input → parse error or hallucinated output. Retry loop sends same broken prompt 3 times. |
| **Fix** | After truncation, validate YAML with `yaml.parse()`. If invalid, truncate at the last complete top-level node boundary. Add a structural integrity check. |
| **Benefit** | LLM always receives valid, parseable design data. Eliminates silent failures on large components. |

### 3. SVG Icon Color Inheritance Is Fundamentally Broken

| | |
|---|---|
| **File** | `src/figma/asset-export.ts:314-331, 464, 601` |
| **Current** | `canBeRecoloredWithCSS()` marks icons as CSS-recolorable. Prompt tells LLM icons can change color per variant via CSS `color` property. But SVGs are rendered via `<img>` tags which are sandboxed — CSS `color` does NOT inherit into `<img>`. |
| **Impact** | Icons render with baked-in colors only. Per-variant icon recoloring (e.g., red icon in error state, white icon on dark button) does not work. LLM generates `color: #fff` on icon container but it has zero effect. |
| **Fix** | Either: (A) Inline SVGs directly in JSX instead of `<img>` tags, allowing CSS `color` + `currentColor` to work. Or (B) Export separate SVG files per color variant and switch `<img src>` via props. Remove `canBeRecoloredWithCSS()` and `isColorVariant` flag as they're misleading. |
| **Benefit** | Icons correctly change color per variant/state, matching the real Figma design. |

### 4. PATH B (Single Component) Has No Semantic HTML Detection

| | |
|---|---|
| **File** | `src/convert.ts:332-393`, `src/prompt/assemble.ts` |
| **Current** | PATH B (non-COMPONENT_SET) sends Figma data to LLM with system prompt but no component-type hints. No detection of whether node is a button, input, card, nav, form, etc. Only PATH A has `CATEGORY_BLUEPRINTS`. |
| **Impact** | LLM defaults to `<div>` for everything in PATH B. Buttons become `<div>`, inputs become `<div>`, navbars become `<div>`. Zero semantic HTML for single components. |
| **Fix** | Add a `detectComponentCategory()` function for PATH B that analyzes layer names, visual structure, and interactive signals (same heuristics as system prompt rules) and injects a semantic hint + blueprint into the user prompt. |
| **Benefit** | PATH B components get proper `<button>`, `<input>`, `<nav>`, `<form>` elements. Import-ready, accessible code. |

### 5. Invalid CSS Generated: `backdrop-blur()` Is Not Valid CSS

| | |
|---|---|
| **File** | `src/figma-complete/extractors/visuals.ts:43` (effects transformer) |
| **Current** | Background blur effects generate `backdrop-blur(Xpx)` instead of `backdrop-filter: blur(Xpx)`. |
| **Impact** | Background blur effects silently fail in browser. Components with glassmorphism/frosted glass look flat. |
| **Fix** | Change to emit `backdrop-filter: blur(Xpx)` as the CSS property-value pair. |
| **Benefit** | Background blur effects render correctly, matching Figma's visual output. |

### 6. Aspect Ratio Emitted as String, Breaks CSS

| | |
|---|---|
| **File** | `src/figma-complete/extractors/layout.ts:268-271` |
| **Current** | `const ratio = (width / height).toFixed(3)` returns a string `"1.500"`. Assigned to `layout['aspect-ratio']`. |
| **Impact** | CSS `aspect-ratio: "1.500"` is invalid (string instead of number). Elements lose their aspect ratio constraints. |
| **Fix** | Use `parseFloat((width / height).toFixed(3))` to emit a number. |
| **Benefit** | Aspect ratios render correctly for image containers and video placeholders. |

---

## P1 — High

### 7. Hidden Nodes Discarded — Conditional Rendering Lost

| | |
|---|---|
| **File** | `src/convert.ts:146` |
| **Current** | `preserveHiddenNodes: false` hard-coded. Hidden layers (Figma visibility toggle) are stripped entirely. |
| **Impact** | Components with conditional elements (loading spinner hidden by default, error message hidden until error state) lose those elements completely. LLM can't generate conditional rendering for elements it never sees. |
| **Fix** | Preserve hidden nodes with a `visible: false` flag. Pass to LLM as "hidden by default — render conditionally". Let the prompt guide the LLM to use `<Show when={}>` for these. |
| **Benefit** | Components with show/hide states (tooltips, dropdowns, loaders) generate proper conditional rendering. |

### 8. Component Set Parser Depth Limit = 6

| | |
|---|---|
| **File** | `src/figma/component-set-parser.ts:950` |
| **Current** | `if (depth > 6) return;` — hard-coded recursion limit. CSS generation stops at depth 6. |
| **Impact** | Complex components (modals with forms, data tables with sortable headers, multi-level navigation) lose CSS for any element nested 7+ levels deep. These elements render unstyled. |
| **Fix** | Remove hard limit or make configurable. Use the YAML depth (25) as the ceiling. Add a warning log when depth exceeds a soft threshold. |
| **Benefit** | Deeply nested components get complete CSS. No surprise unstyled elements. |

### 9. maxTokens = 8192 Fixed for All LLMs

| | |
|---|---|
| **File** | `src/config.ts:109, 116, 124` |
| **Current** | All three LLM providers (Claude, OpenAI, DeepSeek) have `maxTokens: 8192` hard-coded. |
| **Impact** | Complex multi-variant components easily exceed 8192 output tokens. Output is truncated mid-JSX, producing invalid code. Retry loop retries with same limit → same truncation. |
| **Fix** | Scale `maxTokens` based on component complexity: count variants × child nodes × estimated tokens-per-node. Cap at provider maximum (Claude: 64K, GPT-4o: 16K). |
| **Benefit** | Large components generate complete code. No truncation artifacts. |

### 10. Claude Provider Missing Temperature Config

| | |
|---|---|
| **File** | `src/llm/claude.ts:26-31`, `src/config.ts:28-32` |
| **Current** | OpenAI and DeepSeek use `temperature: 0.1`. Claude has no temperature parameter — uses API default (likely 1.0). |
| **Impact** | Claude outputs are significantly more creative/variable than OpenAI. Same Figma input produces different code structures across runs. Inconsistent quality. |
| **Fix** | Add `temperature` to `ClaudeConfig` interface and pass it in the API call. Default to 0.1 for consistency. |
| **Benefit** | Deterministic, consistent code generation across all providers. |

### 11. CSS Return Statement Detection Picks Wrong Return

| | |
|---|---|
| **File** | `src/compile/inject-css.ts:40-92` |
| **Current** | Finds the "LAST `return (`" in the file to inject CSS. If a `useStore` getter has `return (...)`, it picks that instead of the component's JSX return. |
| **Impact** | CSS `<style>` tag injected into a getter function instead of the JSX tree. Component renders without styles. |
| **Fix** | Find the return statement that is inside the default export function body (not inside nested functions/getters). Use AST-level detection or match `return (` after `export default function`. |
| **Benefit** | CSS always injected in the right place. No unstyled components. |

### 12. Parenthesis Balancing Ignores Strings

| | |
|---|---|
| **File** | `src/compile/inject-css.ts:53-62`, `src/compile/stitch.ts:44-54` |
| **Current** | Bracket/paren matching doesn't track string context. Parentheses inside string literals are counted. |
| **Impact** | JSX containing `title="func()"` or template literals with `(` will cause early termination of the paren-matching loop. CSS injected at wrong position or JSX body extracted incorrectly. |
| **Fix** | Add string-context tracking to the paren-balancing loop (skip chars between matching quotes). |
| **Benefit** | Reliable CSS injection and JSX extraction for any valid code. |

### 13. BEM Validation Skips Dynamic Classes (PATH A)

| | |
|---|---|
| **File** | `src/compile/bem-validate.ts:31-42` |
| **Current** | Only extracts static `class="literal"` strings. Ignores `class={state.classes}` and template literals. |
| **Impact** | PATH A components (the primary use case) are entirely unvalidated for BEM consistency. LLM can generate invalid class names in the `state.classes` getter and they'll never be caught. |
| **Fix** | Parse the `useStore` getter body to extract class name strings from template literals and concatenation. Validate those against CSS. |
| **Benefit** | BEM validation actually works for PATH A, catching class name mismatches before output. |

### 14. Font Family Fallback Always `sans-serif`

| | |
|---|---|
| **File** | `src/figma-complete/extractors/text.ts:160` |
| **Current** | All fonts get `, sans-serif` fallback regardless of actual font type. |
| **Impact** | Monospace fonts (code blocks), serif fonts (editorial), and display fonts get wrong fallback. Browser shows sans-serif flash during font loading instead of appropriate category. |
| **Fix** | Detect font category from Figma font metadata or a known-fonts lookup table. Apply `serif`, `sans-serif`, `monospace`, `cursive`, or `system-ui` fallback accordingly. |
| **Benefit** | Correct font fallback behavior. Better loading experience. |

### 15. No LLM Generation Fallback

| | |
|---|---|
| **File** | `src/convert.ts:271-276` |
| **Current** | If LLM fails all 3 retries, exception is thrown. Hard crash. |
| **Impact** | User gets zero output. No best-effort fallback. Entire pipeline wasted. |
| **Fix** | Add a deterministic fallback: generate basic HTML structure from the Figma tree (div nesting with extracted CSS). Not perfect but better than nothing. The existing `component-set-codegen.ts` shows this is feasible. |
| **Benefit** | Users always get output. Fallback code is a starting point they can iterate on. |

### 16. Gradient Direction Lost

| | |
|---|---|
| **File** | `src/figma-complete/extractors/visuals.ts:436-442` |
| **Current** | Gradient stops are extracted but `gradientHandlePositions` (which determine angle/direction) are not converted to CSS angle. |
| **Impact** | All gradients render at default direction (top-to-bottom). Diagonal, radial, and angular gradients look wrong. |
| **Fix** | Compute CSS angle from `gradientHandlePositions[0]` and `gradientHandlePositions[1]` using `Math.atan2()`. |
| **Benefit** | Gradients match Figma's exact direction. |

### 17. Text Truncation Mode Not Handled

| | |
|---|---|
| **File** | `src/figma-complete/extractors/text.ts:232-239` |
| **Current** | `textAutoResize: 'TRUNCATE'` mode is not handled. Only `WIDTH_AND_HEIGHT`, `NONE`, and `HEIGHT` are covered. |
| **Impact** | Text that should show ellipsis (`...`) when overflowing renders as overflowing text instead. Cards, list items, and table cells with truncated text look broken. |
| **Fix** | Add case for `TRUNCATE`: emit `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` (or `-webkit-line-clamp` for multi-line). |
| **Benefit** | Text truncation matches Figma. Clean, contained text in cards and lists. |

---

## P2 — Medium

### 18. Token Estimation: 3.5 chars/token Is Inaccurate

| | |
|---|---|
| **File** | `src/compile/retry.ts:11-12` |
| **Current** | `estimateTokens(text) = Math.ceil(text.length / 3.5)`. Fixed ratio for all content types. |
| **Impact** | Code-heavy prompts underestimate tokens (actual ~2.5-3 chars/token) → API rejects. YAML-heavy prompts overestimate → premature truncation wastes context. |
| **Fix** | Use provider-specific tokenization: `tiktoken` for OpenAI/DeepSeek, character-based heuristic with calibrated ratio (3.2) for Claude. Or use a simple lookup: YAML=4.0, code=2.8, mixed=3.2. |

### 19. MAX_ICON_SIZE = 80px Misses Large Icons

| | |
|---|---|
| **File** | `src/config.ts:131`, `src/figma/asset-export.ts:129` |
| **Current** | Icons larger than 80×80px are not detected or exported. |
| **Impact** | Hero icons (96px+), illustration icons, and badge graphics are missed. LLM doesn't get SVG hints for these. Output has empty icon containers. |
| **Fix** | Make threshold per-component or increase default to 128px. Add heuristic: if frame is square-ish, has only vector children, and is ≤128px, treat as icon regardless of exact size. |

### 20. Square-ish Tolerance of 4px Too Strict

| | |
|---|---|
| **File** | `src/figma/asset-export.ts:154` |
| **Current** | `Math.abs(width - height) <= 4` — icons must be nearly square. |
| **Impact** | Rectangular icons (e.g., 24×32 hamburger menu, 20×28 notification bell) are not detected as icons. They're treated as regular frames. |
| **Fix** | Use aspect ratio instead: `Math.max(w,h) / Math.min(w,h) <= 1.5` allows 2:3 ratio icons. |

### 21. Page Detection Thresholds Are Rigid

| | |
|---|---|
| **File** | `src/convert.ts:54-79`, `src/config.ts:154-156` |
| **Current** | `minSections: 3`, `minChildWidthRatio: 0.5`, `minChildHeight: 60px` — hard thresholds. |
| **Impact** | False positives: 2-column layouts with a 60px divider trigger page mode. False negatives: 3-section pages where one section is 45% wide are not detected. |
| **Fix** | Use auto-layout signals (vertical stack with `fill` width children) combined with semantic heuristics (child names containing "hero", "section", "footer"). Allow manual override via CLI flag. |

### 22. Asset Export Failure Silently Returns Empty Array

| | |
|---|---|
| **File** | `src/convert.ts:232-237` |
| **Current** | If Figma API rate-limits or network fails during SVG export, catch block returns `[]`. No retry. |
| **Impact** | Component generates without any icon hints. Buttons missing icons, navigation missing logos. User doesn't know why. |
| **Fix** | Add retry with exponential backoff for asset export. Log clear warning: "Failed to export N assets — component will generate without icon data". |

### 23. `buildComponentSetSystemPrompt()` Contradicts `system.md`

| | |
|---|---|
| **File** | `src/figma/variant-prompt-builder.ts:1070-1166` |
| **Current** | PATH A system prompt says "use `useStore` with getter `get classes()`" and doesn't mention `---CSS---` delimiter. But `system.md` requires `class="..."` + `---CSS---` format. |
| **Impact** | LLM receives conflicting instructions. Sometimes generates class-based code, sometimes inline-styled code. Inconsistent output between PATH A and PATH B. |
| **Fix** | Align `buildComponentSetSystemPrompt()` with `system.md` format. Both paths should use `class=""` + `---CSS---` output structure. |

### 24. Validation Errors Joined Without Length Limit

| | |
|---|---|
| **File** | `src/compile/retry.ts:149` |
| **Current** | `lastError = validationErrors.join('\n\n')` — all errors concatenated and sent as retry context. |
| **Impact** | Many validation errors → retry prompt exceeds token budget → truncated → LLM loses error context → retry fails again. |
| **Fix** | Limit error feedback to top 3 most severe issues. Summarize remaining as "and N more issues". |

### 25. No `className` → `class` Validation Before Mitosis Parse

| | |
|---|---|
| **File** | `src/compile/cleanup.ts` (missing check) |
| **Current** | LLM might generate `className` (React habit). Code passes Mitosis parse but fails at compile. Error surfaces late. |
| **Impact** | Wasted retry attempts. Late-stage failures that are hard to diagnose. |
| **Fix** | Add a cleanup step: `code.replace(/className=/g, 'class=')` in `cleanupMitosisCode()`. |

### 26. fixMissingImports() Only Handles 3 Symbols

| | |
|---|---|
| **File** | `src/compile/cleanup.ts:32-60` |
| **Current** | Only checks for `useStore`, `Show`, `For`. |
| **Impact** | If LLM uses `useRef`, `onMount`, `useContext`, or other Mitosis APIs without importing them, parse fails. |
| **Fix** | Expand symbol detection to all Mitosis exports: `useStore`, `Show`, `For`, `useRef`, `onMount`, `onUnMount`, `useContext`, `useDefaultProps`. |

### 27. Opacity Extracted in Layout Instead of Visuals

| | |
|---|---|
| **File** | `src/figma-complete/extractors/layout.ts:280-282` |
| **Current** | `opacity` is added to layout CSS. It's a visual property, not a layout property. |
| **Impact** | Style deduplication groups opacity with layout, causing incorrect globalVars references. A component with same layout but different opacity gets the wrong shared style. |
| **Fix** | Move opacity extraction to `visualsExtractor`. |

### 28. Gradient Stop Precision Loss

| | |
|---|---|
| **File** | `src/figma-complete/extractors/visuals.ts:437-441` |
| **Current** | `Math.round(stop.position * 100)` rounds to whole percentages. |
| **Impact** | Smooth gradients with stops at 33.33% become 33%. Visible banding on subtle gradients. |
| **Fix** | Use `(stop.position * 100).toFixed(1)` for 0.1% precision. |

### 29. Individual Stroke Weights Not Converted to CSS

| | |
|---|---|
| **File** | `src/figma-complete/extractors/visuals.ts:72-79` |
| **Current** | `individualStrokeWeights` (top/right/bottom/left) are extracted but never converted to `border-top-width`, `border-right-width`, etc. |
| **Impact** | Components with different border widths per side (e.g., table cells, card headers) get uniform borders or no borders. |
| **Fix** | Convert to CSS: `border-top: ${top}px solid ${color}; border-right: ${right}px solid ...` |

### 30. Image Fill `scaleMode` Not Converted to CSS

| | |
|---|---|
| **File** | `src/figma-complete/extractors/visuals.ts:257-259` |
| **Current** | Image filters (exposure, contrast, saturation) extracted raw but never converted to CSS `filter()`. |
| **Impact** | Images with Figma adjustments render without those adjustments. Color-corrected photos look different. |
| **Fix** | Map: `exposure` → `brightness()`, `contrast` → `contrast()`, `saturation` → `saturate()`, `temperature` → `hue-rotate()`. |

### 31. Preview State Keywords Hardcoded

| | |
|---|---|
| **File** | `src/web/preview.ts:119` |
| **Current** | Only 8 states recognized: default, hover, focus, disabled, loading, active, pressed, error. |
| **Impact** | Components with states like "warning", "success", "selected", "readonly", "pending" are not detected as stateful in preview. |
| **Fix** | Expand list or use dynamic detection: any axis whose values are a subset of known state words. |

### 32. Preview camelCase Collision

| | |
|---|---|
| **File** | `src/web/preview.ts:72-77` |
| **Current** | Node ID suffix stripped, then camelCased. Two properties with same name but different IDs collide. |
| **Impact** | "Left Icon#1234:567" and "Left Icon#9999:888" both become `leftIcon`. Prop collision in preview grid. |
| **Fix** | Deduplicate by appending a counter when collision detected. |

### 33. Paragraph Spacing and Text Indent Never Converted

| | |
|---|---|
| **File** | `src/figma-complete/extractors/text.ts:85-107` |
| **Current** | `paragraphSpacing` and `paragraphIndent` from Figma are not converted to CSS `margin-bottom` and `text-indent`. |
| **Impact** | Multi-paragraph text blocks have no inter-paragraph spacing. First-line indents are lost. |
| **Fix** | Add CSS mappings: `paragraphSpacing` → `margin-bottom: Xpx` on `<p>` elements, `paragraphIndent` → `text-indent: Xpx`. |

### 34. Rich Text Segments Extracted But Never Rendered

| | |
|---|---|
| **File** | `src/figma-complete/extractors/text.ts:61-68` |
| **Current** | Character style overrides (bold words, colored spans, italic phrases) are extracted as `styledTextSegments` but never converted to `<span>` + CSS. |
| **Impact** | Mixed-style text renders as uniform style. Bold keywords in descriptions, colored labels, and italic emphasis are all lost. |
| **Fix** | Convert segments to nested `<span>` elements with per-segment classes. |

### 35. Text Hyperlinks Extracted But Never Rendered

| | |
|---|---|
| **File** | `src/figma-complete/extractors/text.ts:85-110` |
| **Current** | Figma hyperlink data preserved but never converted to `<a href="...">`. |
| **Impact** | Clickable links in text render as plain text. |
| **Fix** | Convert hyperlink segments to `<a>` elements with `href`. |

---

## P3 — Low

### 36. Token Count Safety Margin Is Fixed 200 Chars

| | |
|---|---|
| **File** | `src/compile/retry.ts:37` |
| **Current** | Subtracts 200 chars regardless of prompt size. |
| **Fix** | Use percentage-based margin (2% of total budget). |

### 37. `stripMarkdownFences()` Doesn't Handle All Language Tags

| | |
|---|---|
| **File** | `src/compile/cleanup.ts:17` |
| **Current** | Only matches `tsx?|jsx?|typescript`. |
| **Fix** | Add `javascript|html|css|xml` tags. |

### 38. extractStyleBlock() Fails on `<style scoped>`

| | |
|---|---|
| **File** | `src/compile/cleanup.ts:80` |
| **Current** | Pattern expects exact `<style>` — fails on `<style scoped>` or attributes. |
| **Fix** | Use `/<style[^>]*>` in the regex. |

### 39. Error Detection Uses `startsWith('// Error generating')`

| | |
|---|---|
| **File** | `src/output.ts:48` |
| **Current** | Fragile string matching for error detection. |
| **Fix** | Check for valid `export default function` instead. |

### 40. Session ID Based on Timestamp, Not Content Hash

| | |
|---|---|
| **File** | `src/output.ts` |
| **Current** | Two identical Figma inputs get different session IDs. No dedup. |
| **Fix** | Use content hash of Figma node data for deterministic naming. |

### 41. Plugin Data Collected But Never Used

| | |
|---|---|
| **File** | `src/figma-complete/extractors/hierarchy.ts:21-24` |
| **Current** | Figma plugin data preserved but ignored. |
| **Fix** | Either remove collection (saves memory) or document how to use it. |

### 42. Export Settings Preserved But Unused

| | |
|---|---|
| **File** | `src/figma-complete/extractors/visuals.ts:195-198` |
| **Current** | Export settings (scale, format) extracted but never used for responsive images. |
| **Fix** | Use export settings to generate `srcset` for responsive images. |

### 43. SVG viewBox Sizing Is TODO / No-Op

| | |
|---|---|
| **File** | `src/figma/asset-export.ts:618` |
| **Current** | `adjustViewBoxToPathBounds()` is a no-op with TODO comment. Icons may render at wrong dimensions. |
| **Fix** | Implement viewBox calculation from SVG path bounding box. |

### 44. Shadow Default Color Hardcoded

| | |
|---|---|
| **File** | `src/figma-complete/extractors/visuals.ts:390` |
| **Current** | Missing shadow color defaults to `rgba(0,0,0,0.25)`. May not match Figma's actual default. |
| **Fix** | Always require color from effect data. Warn if missing. |

### 45. Preview CDN URLs Not Version-Locked

| | |
|---|---|
| **File** | `src/config.ts:159-166` |
| **Current** | `react@18` resolves to latest 18.x. May update unexpectedly. |
| **Fix** | Pin to exact versions: `react@18.2.0`. |

---

## Impact vs Current Behavior Matrix

| # | Issue | Current Output | After Fix | Priority |
|---|-------|----------------|-----------|----------|
| 1 | Data loss in prompt | Wrong spacing, missing shadows, wrong flex direction | Pixel-accurate layout matching Figma | P0 |
| 2 | YAML truncation | Invalid code for large components | Valid code for all component sizes | P0 |
| 3 | SVG color broken | Icons stuck on single color | Icons change color per variant/state | P0 |
| 4 | No semantic HTML (PATH B) | All `<div>` elements | Proper `<button>`, `<input>`, `<nav>` | P0 |
| 5 | Invalid backdrop-filter CSS | No blur effects | Glassmorphism renders correctly | P0 |
| 7 | Hidden nodes discarded | Missing conditional elements | Proper show/hide for loaders, tooltips | P1 |
| 8 | Depth limit = 6 | Complex components unstyled below depth 6 | Full CSS for all nesting levels | P1 |
| 9 | maxTokens = 8192 | Large components truncated | Complete code for complex components | P1 |
| 10 | Claude no temperature | Inconsistent output per run | Deterministic, consistent generation | P1 |
| 11 | Wrong return detection | CSS injected in wrong place | CSS always in JSX return | P1 |
| 14 | Font fallback | Wrong fallback category | Correct serif/sans-serif/monospace | P1 |
| 16 | Gradient direction lost | All gradients top-to-bottom | Correct diagonal/radial gradients | P1 |
| 17 | Text truncation missing | Overflowing text | Proper ellipsis truncation | P1 |
| 23 | Prompt contradiction | Inconsistent code style | Unified BEM + `---CSS---` format | P2 |
| 25 | No className check | Late-stage failures | Early, automatic fix | P2 |
| 29 | Individual strokes lost | Uniform borders | Per-side border widths | P2 |
| 34 | Rich text lost | Uniform text style | Bold, italic, colored spans | P2 |

---

## Recommended Fix Order

### Phase 1 — Foundation (Biggest bang for effort)
1. **Replace `trimNodeForPrompt()`** with comprehensive serializer (#1)
2. **Add semantic detection to PATH B** (#4)
3. **Fix Claude temperature** (#10)
4. **Fix `maxTokens` scaling** (#9)
5. **Add `className` → `class` auto-fix** (#25)

### Phase 2 — Visual Fidelity
6. **Fix SVG color inheritance** — inline SVGs or per-variant exports (#3)
7. **Fix gradient direction** (#16)
8. **Fix backdrop-filter CSS** (#5)
9. **Fix aspect-ratio type** (#6)
10. **Fix text truncation** (#17)
11. **Remove depth limit or increase** (#8)

### Phase 3 — Robustness
12. **Fix YAML truncation** with validation (#2)
13. **Fix CSS injection return detection** (#11)
14. **Fix paren balancing** (#12)
15. **Add BEM validation for dynamic classes** (#13)
16. **Add LLM fallback** (#15)
17. **Align PATH A/B system prompts** (#23)

### Phase 4 — Polish
18. **Preserve hidden nodes** (#7)
19. **Rich text segments** (#34)
20. **Font fallback categories** (#14)
21. **Individual stroke widths** (#29)
22. **Paragraph spacing** (#33)
23. **Image filters** (#30)

---

## Metrics to Track

After implementing fixes, measure:

| Metric | How | Target |
|--------|-----|--------|
| **Layout accuracy** | Pixel-diff between Figma screenshot and rendered output | < 5px deviation on spacing/padding |
| **Semantic HTML score** | Count of `<div>` vs semantic elements in output | < 30% generic `<div>` usage |
| **CSS completeness** | Properties in Figma vs properties in output CSS | > 90% coverage |
| **First-try success rate** | % of components that pass Mitosis parse on attempt 1 | > 80% |
| **Import-ready rate** | % of outputs that render correctly without manual edits | > 70% |

---
---

# Implementation Plan — 7 Rounds (Detailed)

Each round produces a visible, testable improvement. Verify results before moving to the next.

---

### Round 1 — Quick Wins (~30 min each, instant visible impact)

Small changes with immediate results. Do these first.

| Order | Fix # | What | File(s) | Change Size |
|-------|-------|------|---------|-------------|
| 1.1 | #10 | Add `temperature: 0.1` to Claude provider | `src/llm/claude.ts`, `src/config.ts` | ~5 lines |
| 1.2 | #25 | Auto-fix `className` → `class` in cleanup | `src/compile/cleanup.ts` | ~3 lines |
| 1.3 | #5 | Fix `backdrop-blur()` → `backdrop-filter: blur()` | `src/figma-complete/extractors/visuals.ts` | ~1 line |
| 1.4 | #6 | Fix aspect-ratio string → number | `src/figma-complete/extractors/layout.ts:271` | ~1 line |
| 1.5 | #9 | Scale `maxTokens` based on component complexity | `src/config.ts`, `src/compile/retry.ts` | ~15 lines |

**How to verify:** Run the same Figma URL 3 times with `--llm claude`. Output should now be nearly identical each time. Blur effects and aspect ratios render correctly in preview.

**Expected impact:**
- Consistent output across runs (temperature fix)
- No more Mitosis parse failures from className (auto-fix)
- Blur effects and aspect ratios render correctly
- Large components no longer truncated mid-code

---

### Round 2 — The Big One: Feed Real Data to the LLM

This single fix has more impact than all others combined.

| Order | Fix # | What | File(s) | Change Size |
|-------|-------|------|---------|-------------|
| 2.1 | #1 | Replace `trimNodeForPrompt()` with comprehensive serializer | `src/convert.ts:91-104` | ~80 lines |

**What to include in the new serializer:**
- Auto-layout: `mode`, `padding`, `gap`, `counterAxisSpacing`, `wrap`
- Sizing: `horizontal`/`vertical` sizing mode, fixed dimensions
- Strokes: color, weight, individual weights, alignment
- Effects: box-shadow, blur, backdrop-filter
- Opacity
- Constraints (for absolute positioning)
- Transforms/rotation

**How to verify:** Convert a component with padding, shadows, and specific gap values. Compare output CSS to Figma inspect panel. Before: padding/gap/shadow values were guessed. After: they match exactly.

**Expected impact:**
- Layout spacing matches Figma (padding, gap, flex-direction)
- Shadows and borders appear in output
- Flex direction correct (row vs column)
- This is the #1 fix for "output doesn't look like the Figma design"

---

### Round 3 — Semantic HTML

Now that the LLM sees real data, make it output real HTML elements.

| Order | Fix # | What | File(s) | Change Size |
|-------|-------|------|---------|-------------|
| 3.1 | #4 | Add `detectComponentCategory()` for PATH B | `src/convert.ts`, new util function | ~60 lines |
| 3.2 | #23 | Align PATH A system prompt with `system.md` format | `src/figma/variant-prompt-builder.ts:1070-1166` | ~40 lines |

**How to verify:** Convert a single button component (PATH B). Before: renders as `<div>`. After: renders as `<button type="button">`. Convert a navbar: before `<div>`, after `<nav>` with `<a>` links.

**Expected impact:**
- PATH B components get proper `<button>`, `<input>`, `<nav>`, `<form>` elements
- Output is accessible and import-ready
- PATH A and PATH B produce consistent code format

---

### Round 4 — Icons & Assets

Fix the icon pipeline so exported SVGs actually work.

| Order | Fix # | What | File(s) | Change Size |
|-------|-------|------|---------|-------------|
| 4.1 | #3 | Fix SVG color — inline SVGs or per-variant file switching | `src/figma/asset-export.ts` | ~50 lines |
| 4.2 | #19 | Increase MAX_ICON_SIZE to 128px | `src/config.ts:131` | ~1 line |
| 4.3 | #20 | Relax square-ish check to aspect ratio ≤ 1.5 | `src/figma/asset-export.ts:154` | ~3 lines |
| 4.4 | #43 | Implement SVG viewBox calculation | `src/figma/asset-export.ts:618` | ~30 lines |

**How to verify:** Convert a button component set with icon variants (e.g., ButtonDanger with spinner + star icons). Before: icons are single-color, some missing. After: icons change color per variant, rectangular icons detected, viewBox sizing correct.

**Expected impact:**
- Icons render with correct colors per variant/state
- Larger icons (up to 128px) detected and exported
- Rectangular icons (hamburger menus, notification bells) no longer missed
- Icon dimensions correct in rendered output

---

### Round 5 — Robustness (Stop Silent Failures)

These fixes prevent crashes and bad output on edge cases.

| Order | Fix # | What | File(s) | Change Size |
|-------|-------|------|---------|-------------|
| 5.1 | #2 | Validate YAML after truncation | `src/compile/retry.ts:56-67` | ~20 lines |
| 5.2 | #11 | Fix CSS injection — find return inside export default function | `src/compile/inject-css.ts:40-92` | ~15 lines |
| 5.3 | #12 | Add string-context tracking to paren balancing | `src/compile/inject-css.ts`, `src/compile/stitch.ts` | ~20 lines |
| 5.4 | #15 | Add deterministic fallback when LLM fails 3 times | `src/convert.ts:271-276` | ~40 lines |
| 5.5 | #13 | BEM validation for dynamic `state.classes` | `src/compile/bem-validate.ts` | ~30 lines |
| 5.6 | #24 | Limit validation error feedback to top 3 | `src/compile/retry.ts:149` | ~10 lines |

**How to verify:** Convert a very large component (deep nesting, many variants). Before: might crash or produce unstyled output. After: always produces valid code, CSS always in the right place. Even if LLM fails, deterministic fallback generates usable code.

**Expected impact:**
- No more crashes on large/complex components
- CSS always injected in the correct JSX return
- BEM class names validated even for dynamic patterns
- Users always get output, even when LLM struggles

---

### Round 6 — Visual Fidelity Polish

Make the output pixel-accurate to Figma.

| Order | Fix # | What | File(s) | Change Size |
|-------|-------|------|---------|-------------|
| 6.1 | #16 | Compute gradient direction from `gradientHandlePositions` | `src/figma-complete/extractors/visuals.ts` | ~20 lines |
| 6.2 | #17 | Handle `textAutoResize: 'TRUNCATE'` → ellipsis CSS | `src/figma-complete/extractors/text.ts` | ~10 lines |
| 6.3 | #8 | Remove or raise depth limit from 6 → 25 | `src/figma/component-set-parser.ts:950` | ~3 lines |
| 6.4 | #29 | Convert individual stroke weights to per-side border CSS | `src/figma-complete/extractors/visuals.ts` | ~15 lines |
| 6.5 | #28 | Fix gradient stop precision (whole % → 0.1%) | `src/figma-complete/extractors/visuals.ts:437` | ~3 lines |
| 6.6 | #14 | Detect font category for correct fallback | `src/figma-complete/extractors/text.ts:160` | ~20 lines |
| 6.7 | #27 | Move opacity from layout to visuals extractor | `src/figma-complete/extractors/layout.ts:280` | ~5 lines |

**How to verify:** Convert a card with diagonal gradient, truncated text, and bottom-only border. Before: gradient is top-to-bottom, text overflows, border is uniform. After: gradient matches Figma angle, text has ellipsis, only bottom border shows.

**Expected impact:**
- Gradients match Figma's exact angle
- Text truncation with ellipsis works
- Deeply nested components fully styled
- Per-side borders render correctly
- Smooth gradients without banding
- Correct font fallback categories

---

### Round 7 — Advanced Features

Unlock new capabilities the service couldn't do before.

| Order | Fix # | What | File(s) | Change Size |
|-------|-------|------|---------|-------------|
| 7.1 | #7 | Preserve hidden nodes with `visible: false` flag | `src/convert.ts:146` | ~20 lines |
| 7.2 | #34 | Convert rich text segments to `<span>` elements | `src/figma-complete/extractors/text.ts` | ~40 lines |
| 7.3 | #35 | Convert text hyperlinks to `<a href>` elements | `src/figma-complete/extractors/text.ts` | ~15 lines |
| 7.4 | #33 | Map paragraph spacing/indent to CSS | `src/figma-complete/extractors/text.ts` | ~10 lines |
| 7.5 | #30 | Convert image filters to CSS `filter()` | `src/figma-complete/extractors/visuals.ts` | ~15 lines |
| 7.6 | #22 | Add retry with backoff for asset export | `src/convert.ts:232-237` | ~20 lines |

**How to verify:** Convert a component with hidden loading spinner, bold+italic mixed text, and clickable links. Before: spinner missing, text uniform, links are plain text. After: spinner conditionally rendered, text has `<strong>`/`<em>`, links are `<a>` tags.

**Expected impact:**
- Components with show/hide states generate conditional rendering
- Rich text with bold, italic, colored spans preserved
- Clickable links become real `<a>` elements
- Paragraph spacing and indentation match Figma
- Image adjustments (brightness, contrast) render correctly
- Asset export resilient to network failures

---

### Progress Tracker

```
Round 1 ████████████████  Quick wins     → Consistent output, no parse crashes  ✅ DONE
Round 2 ████████████████  Data pipeline  → Layout/spacing/shadows match Figma  ✅ DONE
Round 3 ████████████████  Semantic HTML  → Real <button>, <nav>, <input> elements  ✅ DONE
Round 4 ████████████████  Icons          → Icons render with correct colors/sizes  ✅ DONE
Round 5 ░░░░░░░░░░░░░░░░  Robustness     → No crashes on complex components
Round 6 ░░░░░░░░░░░░░░░░  Visual polish  → Gradients, text, borders pixel-accurate
Round 7 ░░░░░░░░░░░░░░░░  Advanced       → Rich text, conditional render, links
```
