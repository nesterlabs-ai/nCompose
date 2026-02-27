# Changelog

## 2026-02-27 — Class-Based Styling for PATH B

**Problem:** PATH B (single component) used `css={{...}}` inline styles. Mitosis compiled these into auto-hashed class names like `div-9e2b321e` — meaningless and unreadable.

**Solution:** PATH B now generates class-based components with meaningful BEM names, matching PATH A's approach.

### Changes

- **`prompts/system.md`** — Rewrote output format: LLM now outputs `.lite.tsx` with `class="..."` + a `---CSS---` delimiter + CSS block. Added BEM naming rules. All style mapping examples converted from JS object syntax (`css={{}}`) to plain CSS. Removed all `css={{...}}` references.
- **`src/compile/cleanup.ts`** — Added `extractStyleBlock()` to split LLM output at `---CSS---` into JSX + CSS. `cleanLLMOutput()` now returns `{ jsx, css }`.
- **`src/compile/parse-and-validate.ts`** — Passes only JSX to `parseJsx()`, threads extracted CSS through `ParseResult`.
- **`src/types/index.ts`** — Added `css?: string` to `ParseResult`.
- **`src/compile/retry.ts`** — BEM validation uses extracted CSS for PATH B.
- **`src/convert.ts`** — PATH B now calls `injectCSS()` per framework with extracted CSS (same as PATH A).
- **`test/cleanup.test.ts`** — Updated for new return type, added CSS extraction tests.

---

## 2026-02-26 — Semantic HTML, Accessibility Validation, SVG Fixes

### Semantic HTML Generation

**Problem:** LLM wrapped everything in `<div>` elements, recreating Figma's deep frame nesting (5+ levels).

**Solution:** 3-layer approach — prompt enrichment + metadata + validation.

- **`prompts/system.md`** — Added comprehensive "Semantic HTML — The #1 Rule" section with signal-based element inference (layer names, visual structure, interactive signals). Added "Frame Flattening — CRITICAL" rules with concrete WRONG/CORRECT examples. Added text-to-heading size mapping.
- **`src/figma/component-set-parser.ts`** — Added `detectComponentCategoryEnhanced()` — infers component type from variant axis values and child node names (e.g., `checked/unchecked` axes → checkbox), without hardcoding.

### Accessibility Validation (axe-core) — NEW

**Problem:** No automated check for semantic HTML correctness.

**Solution:** Post-generation validation using axe-core in the retry loop.

- **`src/compile/a11y-validate.ts`** *(new file)* — Renders generated JSX in jsdom, runs axe-core audit, returns actionable errors for LLM retry. Filters to serious/critical violations only.
- **Open-source deps added:** `axe-core` ^4.11.1, `jsdom` ^28.1.0, `@types/jsdom` ^28.0.0

### BEM Class Name Validation — NEW

**Problem:** LLM sometimes used short class names in JSX (`frame-1`) that didn't match full BEM paths in CSS (`checkbox-field__frame-1`).

- **`src/compile/bem-validate.ts`** *(new file)* — Validates that class names in JSX exist in the CSS. Detects BEM prefix mismatches and feeds corrections back to LLM.

### Multi-Color SVG Fix

**Problem:** `makeColorInheritable()` replaced all colors with `currentColor`, breaking multi-color SVGs (e.g., icons with distinct fill and stroke colors).

- **`src/figma/asset-export.ts`** — Now counts distinct non-white colors. If >1 color found, preserves original colors instead of replacing with `currentColor`.

### Retry Loop Integration

- **`src/compile/retry.ts`** — Integrated axe-core + BEM validation into the generate-parse-retry loop. Validation errors are fed back to the LLM for self-correction (up to 3 retries).

---

## Open-Source Libraries Added

| Package | Version | Purpose |
|---------|---------|---------|
| [axe-core](https://github.com/dequelabs/axe-core) | ^4.11.1 | WCAG accessibility validation engine |
| [jsdom](https://github.com/jsdom/jsdom) | ^28.1.0 | DOM environment for running axe-core on generated HTML |
