# Changelog

## 2026-03-12 — Full Project State Persistence

**Problem:** Switching between projects or reloading the browser degraded the experience — preview lost variant grid and icons, code tabs reset, wired app toggle disappeared. Root cause: `componentPropertyDefinitions`, assets, and UI state were never persisted, and server sessions expire after 1 hour.

### Changes

- **Server SSE payload** (`src/web/server.ts`) — `complete` event now includes `componentPropertyDefinitions` and `assets` (filename + SVG content) so clients can persist them.
- **Client persistence** (`src/web/public/app.js`) — `handleComplete()` saves `componentPropertyDefinitions`, `assets`, `templateWired`, and `chartComponents` to localStorage alongside existing project data.
- **Full variant grid in offline preview** — Ported `buildVariantGridApp()` to client-side JS. Offline preview now renders the complete variant combination grid (matching server preview quality) with icons inlined as data URIs.
- **UI state persistence** — `activeFile`, `openFiles`, and `codeViewMode` are saved on every change and restored when switching back to a project.
- **Server disk fallback** — When in-memory sessions expire (1hr TTL), the server reads conversion results from the `output/` directory on disk. Applied to preview, asset, download, wired-app-files, push-files, and save-file endpoints. Sessions are re-hydrated into memory on first disk hit.
- **localStorage quota protection** — `saveProjects()` catches `QuotaExceededError` and progressively strips `assets` → `chatHistory` → oldest projects to fit within quota.
- **Wired app restoration** — On project restore, if `templateWired` is true, wired-app-files are fetched from the server (which now has disk fallback). Toggle is hidden gracefully if files are unavailable.

---

## 2026-03-12 — Repository Cleanup

Removed stale test scripts, debug artifacts, and outdated documentation:
- 8 root-level test/debug scripts (`test-detect-chart.ts`, `analyze-node.ts`, `check-all-variant-borders.ts`, etc.)
- 5 stale markdown files (`AGENTS.md`, `OPEN_ISSUES.md`, `button-danger-issues.md`, etc.)
- 13 outdated docs (`docs/DEEP-AUDIT-REPORT.md`, `docs/SERVICE_DOCUMENTATION.md`, etc.)
- 3 empty eval output directories, 1 debug image, `output/` directory

Created `docs/WORKFLOW.md` — comprehensive end-to-end service workflow documentation covering all 3 pipeline paths, validation, preview system, session persistence, and template wiring.

Updated `CLAUDE.md` — reflects three-path architecture (PATH A/B/C + chart codegen), complete source file inventory (50+ files), validation layer, web UI features, and session persistence.

---

## 2026-03-10 — Chart Detection & Recharts Codegen

**Problem:** Figma chart/graph designs (pie charts, line charts, bar charts, area charts) were being processed by the standard LLM pipeline, producing static SVG recreations instead of interactive, data-driven chart components.

### Changes

- **Chart detection** (`src/figma/chart-detection.ts`) — Identifies chart nodes by arc segments (pie/donut), grid patterns (line/bar/area), and naming conventions. Extracts chart metadata (type, data points, colors, labels, dimensions) via LLM.
- **Recharts codegen** (`src/compile/chart-codegen.ts`) — Deterministically generates React components using the Recharts library from extracted metadata. Bypasses Mitosis entirely since Recharts is React-only.
- **Pipeline integration** (`src/convert.ts`) — Charts are detected at three points: standalone chart nodes (PATH B fallback), chart COMPONENT_SETs (all variants rendered in grid), and chart sections within PATH C pages.
- **PATH C chart sections** — Chart children within multi-section pages are generated via Recharts codegen instead of the normal LLM prompt chain. Chart component code is inlined into the page's React output.

---

## 2026-03-08 — PATH C: Multi-Section Page Pipeline

**Problem:** Full page designs with multiple sections (header, hero, features, footer) were processed as a single monolithic component, exceeding LLM context limits and producing poor results.

### Changes

- **Page detection** (`src/convert.ts`) — `isMultiSectionPage()` detects pages via 6 heuristic signals: name patterns, vertical auto-layout with fill-width children, size thresholds, wide children count, chart clusters, and nested sections.
- **Page layout extraction** (`src/figma/page-layout.ts`) — Extracts deterministic layout CSS from the root auto-layout (flex direction, gap, padding, section positioning).
- **Per-section generation** — Each section is processed independently and in parallel. COMPONENT_SET sections use PATH A, chart sections use Recharts codegen, compound sections get specialized generation, simple sections use PATH B with page context.
- **Section stitching** (`src/compile/stitch.ts`) — Merges all section JSX + CSS into a single page component. Handles component imports, chart inlining, and CSS deduplication.
- **Wrapper frame flattening** — Plain container frames with no visual properties are unwrapped so their children become direct sections.
- **Compound section generation** (`src/compile/component-gen.ts`) — Handles sections with multiple child frames (e.g., a row of 3 feature cards).

---

## 2026-03-05 — Web UI Enhancements

### Live Preview & WebContainer

- **WebContainer integration** — Boots a full Vite dev server in-browser for live preview with hot module replacement. Changes in Monaco editor sync to preview in real-time.
- **Preview fallback chain** — WebContainer (live) → server static preview → inline offline preview.
- **Preview reload** — Button to force-reload the preview iframe.

### Code Editor

- **Monaco editor** — Replaced plain `<pre>` code display with Monaco editor (VS Code's editor). Supports syntax highlighting for TypeScript, JavaScript, HTML, CSS, JSON.
- **Edit & save** — Code editing with save-to-server functionality. Edited files persist to disk.
- **WebContainer sync** — Edits to React code auto-sync to the live WebContainer preview with debouncing.

### Project Management

- **Sidebar project list** — Shows recent projects with thumbnails, timestamps, click to restore.
- **Duplicate detection** — Warns when converting a URL that was already converted, offers to open existing project.
- **Project deletion** — Delete button on each project in sidebar.

### GitHub Push

- **GitHub integration** — Push generated code or wired app to GitHub via Supabase OAuth. Supports both generated files and wired app mode.

### Template Wiring

- **Starter template** — `--template` flag wires generated component into a pre-built starter app with Tailwind + cn() + CSS variables.
- **Wired app view** — "Generated | Wired app" toggle in code view shows the full runnable app with file explorer tree.

### UI Polish

- **Light/dark theme** — Toggle with localStorage persistence.
- **Sidebar collapse** — Desktop collapse/expand, mobile overlay with hamburger menu.
- **File explorer** — Tree view with folder expand/collapse, file type icons (configurable via `explorer-icons.config.json`).
- **Editor tabs** — Multi-tab code editor with open/close/switch.
- **Chat refinement** — Iterative refinement via chat input after initial conversion.

---

## 2026-03-01 — Color-Aware SVG Deduplication & Behavioral CSS

### Color-Aware Deduplication

**Problem:** Icons with the same shape but different colors (e.g., star icon in primary vs danger variant) were collapsed into one file, losing color information.

- **`src/figma/asset-export.ts`** — `exportAssetsFromAllVariants()` now groups by position + path shape + color. New `extractSVGColorSignature()` function creates deterministic color keys. Most-used color gets the clean filename; less common colors get `-2`, `-3` suffixes.
- **Visibility check** — `collectAssetNodes()` now skips `node.visible === false`, preventing hidden icon slots from being exported.

### Web Behavioral CSS

**Problem:** Figma can't represent web-specific interactive behaviors like cursors, transitions, and user-select.

- **`src/figma/component-set-parser.ts`** — Re-added behavioral CSS for interactive components:
  - `cursor: pointer` on base (interactive categories only)
  - `cursor: not-allowed` on `[disabled]` / `[aria-disabled]`
  - `transition: background-color 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease`
  - `user-select: none` on interactive elements
  - `@keyframes spin` animation for spinner children
  - `:not([disabled])` guard on `:hover` and `:active` selectors

---

## 2026-02-27 — CSS/JSX Class Mismatch Fix & Variant Text Diffs

### Class Mismatch Fix

**Problem:** Figma node names used as CSS class names contained unsafe characters, and nodes not in the default variant had no CSS rules.

- **`src/figma/component-set-parser.ts`** — Added semantic key renaming (`isAutoGeneratedKey()`, `inferSemanticKey()`, `buildSemanticRenameMap()`). `toKebabCase()` now strips CSS-unsafe characters. `emitDiffRules()` and `emitStateOverrides()` accept rename map.
- **`src/figma/variant-prompt-builder.ts`** — Prompt now includes "Exact Child CSS Classes" section extracted from variant CSS.
- **`src/compile/bem-validate.ts`** — Also flags invented BEM element classes not present in CSS.

### Variant Text Diffs

**Problem:** Text content that changed across variants (e.g., button label changing from "Submit" to "Loading...") was invisible to the LLM.

- **`src/figma/component-set-parser.ts`** — Added `collectVariantTextDiffs()` which walks ALL variant nodes and compares TEXT content by BEM key. New `VariantTextDiff` interface tracks per-variant text changes.
- **`src/figma/variant-prompt-builder.ts`** — Prompt now includes "Variant-Specific Text Content" section with conditional rendering hints.

### Critical Bug Fixes

- **INSTANCE skip** — `extractChildLayers()` and `collectNamedChildStyles()` had `child.type !== 'INSTANCE'` guard that skipped all children inside INSTANCE nodes. Buttons in modals are INSTANCE nodes, so their text labels and icon frames were invisible to the LLM.
- **isAssetNode() expansion** — Expanded icon detection from FRAME-only to include INSTANCE (small+square), VECTOR/BOOLEAN_OPERATION/LINE/ELLIPSE/STAR (small), and GROUP (small+square+vector content). Threshold increased to 80px.
- **Asset map key mismatch** — `buildAssetMap()` keys were Figma nodeIds but `describeLayer()` looked up by BEM key. Added `nodeId` to ChildLayerInfo for correct lookup.
- **SVG colors** — Removed `makeColorInheritable()` calls since SVGs in `<img>` tags can't inherit CSS `color`.

---

## 2026-02-27 — Class-Based Styling for PATH B

**Problem:** PATH B (single component) used `css={{...}}` inline styles. Mitosis compiled these into auto-hashed class names like `div-9e2b321e` — meaningless and unreadable.

**Solution:** PATH B now generates class-based components with meaningful BEM names, matching PATH A's approach.

### Changes

- **`prompts/system.md`** — Rewrote output format: LLM now outputs `.lite.tsx` with `class="..."` + a `---CSS---` delimiter + CSS block. Added BEM naming rules.
- **`src/compile/cleanup.ts`** — Added `extractStyleBlock()` to split LLM output at `---CSS---` into JSX + CSS.
- **`src/compile/parse-and-validate.ts`** — Passes only JSX to `parseJsx()`, threads extracted CSS through `ParseResult`.
- **`src/compile/retry.ts`** — BEM validation uses extracted CSS for PATH B.
- **`src/convert.ts`** — PATH B now calls `injectCSS()` per framework with extracted CSS (same as PATH A).

---

## 2026-02-26 — Semantic HTML, Accessibility Validation, SVG Fixes

### Semantic HTML Generation

**Problem:** LLM wrapped everything in `<div>` elements, recreating Figma's deep frame nesting.

**Solution:** 3-layer approach — prompt enrichment + metadata + validation.

- **`prompts/system.md`** — Added "Semantic HTML — The #1 Rule" section with signal-based element inference. Added "Frame Flattening — CRITICAL" rules.
- **`src/figma/component-set-parser.ts`** — Added `detectComponentCategoryEnhanced()` — infers component type from variant axis values and child node names.

### Accessibility Validation (axe-core)

- **`src/compile/a11y-validate.ts`** — Renders generated JSX in jsdom, runs axe-core audit, returns actionable errors for LLM retry. Filters to serious/critical violations only.

### BEM Class Name Validation

- **`src/compile/bem-validate.ts`** — Validates that class names in JSX exist in the CSS. Detects BEM prefix mismatches and feeds corrections back to LLM.

### Multi-Color SVG Fix

- **`src/figma/asset-export.ts`** — Counts distinct non-white colors. If >1 color found, preserves original colors instead of replacing with `currentColor`.

### Retry Loop Integration

- **`src/compile/retry.ts`** — Integrated axe-core + BEM validation into the generate-parse-retry loop. Validation errors fed back to LLM for self-correction (up to 3 retries).

---

## Dependencies Added

| Package | Version | Purpose |
|---------|---------|---------|
| [axe-core](https://github.com/dequelabs/axe-core) | ^4.11.1 | WCAG accessibility validation engine |
| [jsdom](https://github.com/jsdom/jsdom) | ^28.1.0 | DOM environment for running axe-core |
| [recharts](https://recharts.org/) | ^2.12.0 | React charting library (used in generated chart components) |
| [monaco-editor](https://microsoft.github.io/monaco-editor/) | 0.45.0 | Code editor (loaded via CDN in web UI) |
| [@webcontainer/api](https://webcontainers.io/) | 1.2.4 | In-browser Node.js runtime for live preview |
| [archiver](https://github.com/archiverjs/node-archiver) | — | ZIP archive generation for downloads |
