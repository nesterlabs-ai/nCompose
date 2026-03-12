# Figma-to-Code Service — Detailed Workflow

This document describes the end-to-end workflow of the figma-to-code service, covering how a Figma design URL becomes production-ready component code for React, Vue, Svelte, Angular, and Solid.

---

## Table of Contents

1. [High-Level Architecture](#high-level-architecture)
2. [Entry Points](#entry-points)
3. [Pipeline Overview](#pipeline-overview)
4. [Step 1: URL Parsing](#step-1-url-parsing)
5. [Step 2: Figma API Fetch](#step-2-figma-api-fetch)
6. [Step 3: Design Data Extraction](#step-3-design-data-extraction)
7. [Step 4: Path Detection & Routing](#step-4-path-detection--routing)
8. [PATH A: Component Set (Variant-Aware)](#path-a-component-set-variant-aware)
9. [PATH B: Single Component](#path-b-single-component)
10. [PATH C: Multi-Section Page](#path-c-multi-section-page)
11. [Chart Detection & Recharts Codegen](#chart-detection--recharts-codegen)
12. [LLM Generation & Retry Loop](#llm-generation--retry-loop)
13. [Mitosis Compilation](#mitosis-compilation)
14. [CSS Injection](#css-injection)
15. [Fidelity Validation](#fidelity-validation)
16. [Output Writing](#output-writing)
17. [Web UI & Preview System](#web-ui--preview-system)
18. [Iterative Refinement (Chat)](#iterative-refinement-chat)
19. [Session Persistence & Recovery](#session-persistence--recovery)
20. [Template Wiring (Starter App)](#template-wiring-starter-app)

---

## High-Level Architecture

```
Figma Design URL
      │
      ▼
┌─────────────────┐
│  URL Parser      │  Extract fileKey + nodeId
└────────┬────────┘
         ▼
┌─────────────────┐
│  Figma REST API  │  Fetch node tree (PAT auth)
└────────┬────────┘
         ▼
┌─────────────────┐
│  Design Extractor│  Preserve ALL Figma properties
└────────┬────────┘
         ▼
┌─────────────────────────────────────────┐
│            Path Detection               │
│  ┌───────┐  ┌───────┐  ┌─────────────┐ │
│  │PATH A │  │PATH B │  │  PATH C     │ │
│  │Variant│  │Single │  │  Page       │ │
│  │  Set  │  │Component│ │  (sections) │ │
│  └───┬───┘  └───┬───┘  └──────┬──────┘ │
└──────┼──────────┼─────────────┼────────┘
       ▼          ▼             ▼
┌─────────────────────────────────────────┐
│         LLM Code Generation             │
│    (Claude / GPT-4o / DeepSeek)         │
│    + Retry Loop with Validation         │
└────────────────┬────────────────────────┘
                 ▼
┌─────────────────────────────────────────┐
│       Mitosis Parse & Compile           │
│  .lite.tsx → React / Vue / Svelte /     │
│              Angular / Solid            │
└────────────────┬────────────────────────┘
                 ▼
┌─────────────────────────────────────────┐
│     CSS Injection + Font Resolution     │
└────────────────┬────────────────────────┘
                 ▼
┌─────────────────────────────────────────┐
│     Output Files + Preview + Download   │
└─────────────────────────────────────────┘
```

---

## Entry Points

The service has two entry points:

### CLI (`figma-to-code convert`)
- Parses command-line arguments (URL, frameworks, LLM provider, output dir)
- Calls the core pipeline function
- Writes output files to disk
- Optionally sets up a preview app

### Web UI (`/api/convert`)
- Express.js server at `localhost:3000`
- Accepts JSON body with `figmaUrl`, `figmaToken`, `frameworks`
- Streams progress via Server-Sent Events (SSE)
- Stores results in an in-memory session store (1-hour TTL)
- Serves live preview via iframe, WebContainer, or inline fallback

---

## Pipeline Overview

All paths share the same first three steps, then diverge based on what the Figma node is:

1. Parse Figma URL → extract `fileKey` and `nodeId`
2. Fetch raw node tree from Figma REST API
3. Extract complete design data (all visual/layout properties preserved)
4. Detect path:
   - **COMPONENT_SET** → PATH A (variant-aware pipeline)
   - **Multi-section page** → PATH C (per-section generation + stitching)
   - **Chart/graph node** → Recharts codegen (deterministic, no Mitosis)
   - **Everything else** → PATH B (single component)

---

## Step 1: URL Parsing

Input: A Figma URL like `https://www.figma.com/design/ABC123/MyFile?node-id=123-456`

Output:
- `fileKey`: `ABC123`
- `nodeId`: `123:456` (decoded from URL format `123-456`)

The parser handles both `/file/` and `/design/` URL formats. If no `node-id` is specified, the entire file root is fetched.

---

## Step 2: Figma API Fetch

Uses a personal access token (PAT) to call the Figma REST API:
- **With nodeId**: `GET /v1/files/{fileKey}/nodes?ids={nodeId}&depth={depth}`
- **Without nodeId**: `GET /v1/files/{fileKey}?depth={depth}`

The depth parameter (default: configurable) controls how deep the tree is fetched. Deeper trees provide more detail but increase payload size.

---

## Step 3: Design Data Extraction

The raw Figma API response is processed through the "complete design extractor" which:
- Preserves ALL node properties (fills, strokes, effects, layout, text styles, etc.)
- Maintains the full tree hierarchy
- Preserves absolute bounding boxes and relative transforms
- Optionally keeps hidden nodes for state-aware processing

The extracted data is then serialized to YAML for LLM consumption. During serialization:
- Figma RGBA colors (0-1 floats) → CSS color strings (`rgb()`, `rgba()`, hex)
- Auto-layout properties → CSS flex equivalents (direction, gap, padding, alignment)
- Sizing modes → `fill` (100%), `hug` (auto), or fixed pixel values
- Fills → CSS `background-color` or `linear-gradient()`
- Strokes → CSS `border`
- Effects → CSS `box-shadow`, `filter`, `backdrop-filter`
- Text styles → CSS font properties
- Icon/asset nodes → `type: ICON, assetFile: "./assets/filename.svg"` markers

---

## Step 4: Path Detection & Routing

### COMPONENT_SET Detection
Triggered when the root node's type is `COMPONENT_SET`. These are Figma's grouped variant components (e.g., a Button with Style, Size, and State variants).

### Multi-Section Page Detection (PATH C)
Uses multiple heuristic signals (any one sufficient):
1. **Name heuristics**: Root frame name contains "page", "landing", "home", "layout", "screen", etc.
2. **Vertical auto-layout with fill-width children**: Root is vertical flex, children span full width
3. **Size-based threshold**: Multiple children each cover ≥90% of parent width and ≥100px tall
4. **Wide children (≥3)**: At least 3 children spanning ≥80% of parent width
5. **Chart cluster**: ≥2 child frames that are individually chart sections
6. **Nested sections**: A large child frame contains multiple wide "card" frames

All signals (except 4 and 5) also require at least one child with a section-like name (header, hero, footer, nav, section, feature, etc.).

### Chart Detection
Identifies chart/graph nodes by checking for:
- Arc segments (pie/donut charts)
- Grid patterns with data points (line/bar/area charts)
- Chart-like naming conventions

---

## PATH A: Component Set (Variant-Aware)

This is the most complex path, handling components with multiple variants (e.g., a Button with primary/secondary styles, small/medium/large sizes, and default/hover/disabled states).

### A1: Variant Parsing
- Splits the COMPONENT_SET into individual variants
- Parses variant names: `"Style=Primary, State=Default, Size=Medium"` → structured props
- Identifies **prop axes** (Style, Size) vs the **state axis** (State)
- Classifies states: Default, Hover, Focus, Disabled, Loading, Error, Active, Pressed
- Handles compound states: `"Error-Hover"` → `{ error: true, hover: true }`
- Detects component category: button, input, checkbox, toggle, card, etc.

### A2: Icon Export from ALL Variants
Unlike PATH B which only scans the default variant, PATH A scans every variant for icon nodes:
- Identifies icon containers using multiple heuristics (empty frames, small frames with vector content, INSTANCE nodes)
- Downloads SVGs from Figma's export API
- **Deduplicates** by position + SVG path content: 60 icon nodes across 30 variants may reduce to 4 unique SVG files
- Tracks which variants each icon appears in (e.g., spinner only in loading variants)
- Generates position-aware filenames: `left-icon-spinner.svg`, `right-icon-star.svg`
- Groups color variants (same shape, different colors) with numbered suffixes

### A3: Deterministic CSS Generation
CSS is generated entirely from Figma data — NOT by the LLM:
- Extracts visual tokens (colors, spacing, borders, shadows, typography) from each variant
- Diffs each variant against the default to produce minimal override rules
- Uses BEM naming convention:
  - `.component-name` — base/default styles
  - `.component-name--primary` — prop axis modifiers
  - `.component-name:hover` — interactive state pseudo-selectors
  - `.component-name[data-error]` — boolean state data attributes
  - `.component-name__label` — named child elements
- Adds web behavioral CSS: `cursor: pointer`, `transition`, `user-select: none`
- Adds `:not([disabled])` guard to `:hover` and `:active` selectors
- Auto-generates `@keyframes spin` for spinner children

### A4: LLM Prompt Construction
The LLM prompt includes:
- Component structure (props, variant axes, state mappings)
- Default variant YAML (CSS-ready serialized node tree)
- Pre-generated CSS class names the LLM must use
- Icon conditional rendering guidance (which icons appear in which variants)
- Semantic HTML hints (button → `<button type="button">`, etc.)
- Text content per variant (from variant text diff analysis)

### A5: LLM Code Generation
The LLM generates a Mitosis `.lite.tsx` component that:
- Uses `class={state.classes}` with a `useStore` getter (NOT `css={{}}`)
- Maps props to BEM class modifiers
- Maps states to pseudo-selectors and data attributes
- Renders icons with `<img src="./assets/...">` tags
- Handles conditional rendering with `<Show when={...}>` and `<For each={...}>`

### A6: Compilation & CSS Injection
- Mitosis parses and validates the `.lite.tsx`
- Compiles to all target frameworks (React, Vue, Svelte, Angular, Solid)
- The deterministic CSS is injected into each framework output:
  - React/Solid: `<style>{\`css\`}</style>` before closing tag
  - Vue: `<style scoped>` section
  - Svelte: `<style>` section
  - Angular: `styles: [\`css\`]` in `@Component`

---

## PATH B: Single Component

For non-variant, non-page nodes (individual cards, modals, forms, etc.).

### B1: Asset Export
- Scans the node tree for icon containers
- Downloads SVGs from Figma
- Builds asset map (nodeId → filename) so icons appear as `type: ICON` in YAML

### B2: Semantic Detection
- Detects component category from name and child names (button, input, card, etc.)
- Only applies to small trees (≤20 descendants) to avoid misclassifying page layouts
- Generates semantic HTML hints for the LLM

### B3: LLM Code Generation
- Serializes the node tree to CSS-ready YAML with icon markers embedded
- LLM generates Mitosis code with `css={{}}` inline styles (plain string literals only)
- Class-based CSS is also extracted if the LLM outputs it

### B4: Compilation
- Mitosis parses and compiles to target frameworks
- CSS (if extracted) is injected into each framework output

---

## PATH C: Multi-Section Page

For full pages with multiple sections (header, hero, features, footer, etc.).

### C1: Page Layout Extraction
- Extracts page-level CSS from root auto-layout (flex direction, gap, padding)
- Generates a layout class for each section with positioning info
- Flattens "wrapper frames" — plain containers with no visual properties get unwrapped

### C2: Per-Section Generation
Each section is processed independently (in parallel):
- **COMPONENT_SET sections** → Use PATH A's prompt chain
- **Chart sections** → Use Recharts codegen (deterministic)
- **Compound sections** (multiple child frames) → Specialized compound generation
- **Simple sections** → Use PATH B's prompt chain with page-section context

Each section receives context about its neighbors (prev/next section names), page width, gap, and padding so sections align visually.

### C3: Stitching
All section outputs are stitched into a single page component:
- Section JSX snippets are wrapped in a page container div
- All CSS is merged (layout CSS + per-section CSS)
- Component references from nested COMPONENT_SET sections become imports
- Chart components are inlined into the React output

### C4: Parse & Compile
- The stitched component is parsed through Mitosis
- Falls back to monolithic LLM generation if stitching/parsing fails
- Compiled to all target frameworks with merged CSS injection

---

## Chart Detection & Recharts Codegen

When a node is identified as a chart/graph, it bypasses the normal LLM → Mitosis pipeline:

1. **Detection**: Checks for arc segments (pie/donut), grid patterns (line/bar/area), or chart-like naming
2. **Metadata Extraction**: Uses the LLM to analyze the chart's data points, type, colors, labels, and dimensions
3. **Code Generation**: Deterministically generates a Recharts React component from the metadata
4. **Output**: React code is the primary output; other frameworks get a placeholder comment directing developers to the React version

For COMPONENT_SET charts (multiple chart variants), each variant generates a separate chart function, and a wrapper component renders all variants in a grid.

---

## LLM Generation & Retry Loop

### Providers
- **Claude** (claude-sonnet-4-5) via Anthropic API
- **GPT-4o** via OpenAI API
- **DeepSeek** via OpenAI-compatible API

### Retry Logic (3 attempts + fallback)
1. Send system + user prompt to LLM
2. Clean up response: strip markdown fences, fix missing Mitosis imports
3. Parse through Mitosis `parseJsx()`
4. If parse fails → feed error back to LLM and retry

### Validation Gates (after successful parse)
Each retry attempt runs validators that feed errors back to the LLM:
- **Accessibility**: Renders JSX in jsdom, runs axe-core, checks WCAG (serious/critical violations only)
- **BEM Consistency**: Checks that static class names in JSX exist in the CSS
- **CSS Fidelity**: Validates CSS property coverage matches Figma data
- **Text Fidelity**: Ensures expected text content from Figma appears in the output
- **Semantic HTML**: Validates correct HTML elements for detected component category

On the final attempt, the result is returned even if validators report issues (to avoid complete failure).

---

## Mitosis Compilation

Mitosis is the intermediate representation (IR) that enables multi-framework output:

### Parse Rules (violations cause compile failure)
- `class` not `className`
- `css={{}}` values must be plain string literals (no expressions, ternaries, variables)
- No `.map()` in JSX — use `<For each={...}>`
- No ternary JSX — use `<Show when={...}>`
- State variable must be named `state` via `useStore()`
- Event handler parameter must be named `event`
- All numeric CSS values need units (`'16px'` not `16`)

### Framework Generators
| Framework | Config |
|-----------|--------|
| React | `componentToReact({ stateType: 'useState', stylesType: 'style-tag' })` |
| Vue | `componentToVue({ api: 'composition' })` |
| Svelte | `componentToSvelte({ stateType: 'variables' })` |
| Angular | `componentToAngular({ standalone: true })` |
| Solid | `componentToSolid({ stateType: 'store', stylesType: 'style-tag' })` |

---

## CSS Injection

After Mitosis compilation, deterministic CSS (from PATH A's `buildVariantCSS` or PATH B's extracted CSS) is injected into each framework's output:

| Framework | Injection Method |
|-----------|-----------------|
| React / Solid | `<style>{\`css\`}</style>` before last closing tag |
| Vue | `<style scoped>css</style>` appended |
| Svelte | `<style>css</style>` appended |
| Angular | `styles: [\`css\`]` in `@Component()` decorator |

Google Fonts used in the CSS are detected and a `@import` is prepended for font loading.

---

## Fidelity Validation

After code generation, a fidelity report is built to measure output quality:

- **Semantic Check**: Validates correct HTML elements for the component category
- **BEM Check**: Validates class names in JSX match those in CSS
- **Text Check**: Validates expected text content from Figma appears in output
- **Layout Check**: Validates CSS class coverage for all child elements

The report is saved as `ComponentName.fidelity.json` alongside the output. If configured, generation fails when the report doesn't pass.

---

## Output Writing

Each conversion produces a session-specific directory:

```
output/ComponentName-{sessionId}/
├── ComponentName.lite.tsx      # Mitosis source
├── ComponentName.jsx           # React
├── ComponentName.vue           # Vue
├── ComponentName.svelte        # Svelte
├── ComponentName.ts            # Angular
├── ComponentName.tsx           # Solid
├── ComponentName.meta.json     # Variant axes + property definitions
├── ComponentName.fidelity.json # Fidelity diagnostics report
└── assets/
    ├── left-icon-star.svg
    ├── right-icon-spinner.svg
    └── ...
```

---

## Web UI & Preview System

### Preview Rendering (prioritized)
1. **WebContainer (live)**: Boots a full Vite dev server in the browser with React + the generated component. Supports live editing — changes in the code editor sync to the preview in real-time.
2. **Server-side static preview**: `GET /api/preview/{sessionId}` — generates a standalone HTML page with React CDN + Babel for in-browser JSX transpilation. Includes variant grid for COMPONENT_SET results.
3. **Inline offline preview**: When the server session has expired, the client reconstructs the preview from localStorage using stored React code, `componentPropertyDefinitions` (for variant grid), and `assets` (converted to data URIs).

### Variant Grid Preview
For COMPONENT_SET results, the preview renders ALL variant combinations in a grid:
- Separates variant axes (Style, Size) from state axis (State)
- Builds a cartesian product of all prop axis values × state entries
- Renders each combination with a label showing its variant props

### Asset Serving
SVG assets are served via `GET /api/preview/{sessionId}/assets/{filename}`. When the in-memory session expires, assets are read directly from the output directory on disk.

---

## Iterative Refinement (Chat)

After initial conversion, users can refine the component through a chat interface:

1. User sends a natural language prompt describing desired changes
2. The refinement system sends the current Mitosis source + CSS + conversation history to the LLM
3. LLM generates updated code
4. Updated code is parsed, compiled, and CSS is re-injected
5. Session is updated; preview refreshes automatically
6. Conversation history is maintained (last 20 turns) for context

If the LLM drops CSS during refinement, the original CSS is automatically re-injected as a safety net.

---

## Session Persistence & Recovery

### In-Memory Sessions (Server)
- Conversion results are stored in an in-memory `Map` with a 1-hour TTL
- Sessions are cleaned up every 10 minutes
- Each session stores: result, conversation history, LLM provider, frameworks

### Disk Fallback (Server)
When an in-memory session expires, the server falls back to reading from the output directory on disk:
- Scans `output/` for a directory ending with `-{sessionId}`
- Reads framework files, meta.json, and SVG assets
- Re-hydrates the session store for subsequent requests
- Applied to: preview, assets, download, wired-app-files, push-files, and save-file endpoints

### Client-Side Persistence (localStorage)
- Projects are saved to localStorage with: framework outputs, mitosis source, componentPropertyDefinitions, assets, chat history, UI state (active file, open files, code view mode)
- Quota protection: on `QuotaExceededError`, progressively strips assets → chat history → oldest projects
- On project restore: tries server preview first, falls back to inline preview with data-URI assets and full variant grid

---

## Template Wiring (Starter App)

When the `--template` flag is used (always enabled in web UI):
- The generated component is wired into a pre-built starter app (`figma-to-code-starter-main/`)
- The starter uses Tailwind CSS + `cn()` utility + CSS variables
- Component file, CSS, and assets are copied into the starter's `src/components/` directory
- The starter's `App.tsx` is updated to import and render the generated component
- The wired app is available as a "Wired app" view in the code editor
- Users can download or push the complete runnable app to GitHub
