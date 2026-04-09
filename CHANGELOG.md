# Changelog

All notable changes to nCompose will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial open-source release

---

## [0.1.0] - 2026-03-12

### Added
- Full project state persistence — `componentPropertyDefinitions`, `assets`, `templateWired`, and `chartComponents` saved to localStorage
- Full variant grid in offline preview — client-side `buildVariantGridApp()` renders complete variant combinations with icons inlined as data URIs
- UI state persistence — `activeFile`, `openFiles`, and `codeViewMode` saved/restored on project switch
- Server disk fallback — when in-memory sessions expire (1hr TTL), server reads from `output/` directory on disk
- localStorage quota protection — progressive stripping of `assets`, `chatHistory`, oldest projects on `QuotaExceededError`
- Wired app restoration — fetches wired-app-files from server (with disk fallback) on project restore

### Changed
- Server SSE `complete` event now includes `componentPropertyDefinitions` and `assets`

### Housekeeping
- Removed 8 root-level test/debug scripts, 5 stale markdown files, 13 outdated docs, 3 empty eval output directories
- Created `docs/WORKFLOW.md` — comprehensive end-to-end service workflow documentation
- Updated `CLAUDE.md` to reflect three-path architecture

## 2026-03-10 — Chart Detection & Recharts Codegen

### Added
- Chart detection (`src/figma/chart-detection.ts`) — identifies chart nodes by arc segments, grid patterns, and naming conventions
- Recharts codegen (`src/compile/chart-codegen.ts`) — deterministic React component generation from chart metadata, bypasses Mitosis
- Pipeline integration for standalone chart nodes, chart COMPONENT_SETs, and chart sections within PATH C pages

## 2026-03-08 — Multi-Section Page Pipeline (PATH C)

### Added
- Page detection via 6 heuristic signals: name patterns, vertical auto-layout, size thresholds, wide children, chart clusters, nested sections
- Page layout extraction with deterministic CSS from root auto-layout
- Per-section parallel generation — COMPONENT_SET sections use PATH A, chart sections use Recharts, simple sections use PATH B
- Section stitching — merges all section JSX + CSS into single page component
- Wrapper frame flattening and compound section generation

## 2026-03-05 — Web UI Enhancements

### Added
- WebContainer integration — Vite dev server in-browser with hot module replacement
- Monaco editor with syntax highlighting, multi-tab editing, save-to-server, WebContainer sync
- Project sidebar with thumbnails, duplicate detection, deletion
- GitHub push via OAuth
- Starter template wiring with Tailwind + cn() + CSS variables
- Light/dark theme toggle, sidebar collapse, file explorer tree, editor tabs
- Chat-based iterative refinement after initial conversion

## 2026-03-01 — Color-Aware SVG Deduplication & Behavioral CSS

### Added
- Color-aware SVG deduplication — groups by position + path shape + color, most-used color gets clean filename
- Visibility check — `collectAssetNodes()` skips `node.visible === false`
- Behavioral CSS for interactive components: `cursor: pointer`, `cursor: not-allowed`, transitions, `user-select: none`, spinner animation, `:not([disabled])` guards

## 2026-02-27 — CSS/JSX Class Mismatch Fix & Variant Text Diffs

### Fixed
- Semantic key renaming for CSS-unsafe characters in Figma node names
- BEM validation now flags invented element classes not present in CSS
- INSTANCE skip bug — children inside INSTANCE nodes were invisible to the LLM
- Asset map key mismatch — `buildAssetMap()` keys were nodeIds but lookup used BEM keys
- SVG colors — removed `makeColorInheritable()` since SVGs in `<img>` tags can't inherit CSS `color`

### Added
- Variant text diffs — `collectVariantTextDiffs()` tracks per-variant text changes for conditional rendering
- Expanded `isAssetNode()` to include INSTANCE, VECTOR, BOOLEAN_OPERATION, LINE, ELLIPSE, STAR, GROUP

## 2026-02-27 — Class-Based Styling for PATH B

### Changed
- PATH B now generates class-based components with BEM names instead of `css={{...}}` inline styles
- LLM output format changed to `.lite.tsx` with `---CSS---` delimiter

## 2026-02-26 — Semantic HTML, Accessibility Validation, SVG Fixes

### Added
- Semantic HTML generation — 3-layer approach: prompt enrichment, metadata, validation
- Accessibility validation via axe-core — renders JSX in jsdom, audits for serious/critical violations
- BEM class name validation — ensures JSX class names exist in CSS
- Multi-color SVG preservation — SVGs with >1 distinct color keep original colors
- Retry loop integration — axe-core + BEM validation errors fed back to LLM (up to 3 retries)

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| [axe-core](https://github.com/dequelabs/axe-core) | ^4.11.1 | WCAG accessibility validation |
| [jsdom](https://github.com/jsdom/jsdom) | ^28.1.0 | DOM environment for axe-core |
| [recharts](https://recharts.org/) | ^2.12.0 | React charting library |
| [monaco-editor](https://microsoft.github.io/monaco-editor/) | 0.45.0 | Code editor (CDN) |
| [@webcontainer/api](https://webcontainers.io/) | 1.2.4 | In-browser Node.js runtime |
| [archiver](https://github.com/archiverjs/node-archiver) | ^7.0.1 | ZIP archive generation |
