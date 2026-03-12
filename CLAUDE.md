# figma-to-code — CLAUDE.md

CLI + Web service that converts Figma designs to import-ready components for React, Vue, Svelte, Angular, and Solid via [Mitosis](https://github.com/BuilderIO/mitosis).

For a detailed end-to-end workflow walkthrough, see [docs/WORKFLOW.md](docs/WORKFLOW.md).

---

## Dev Commands

```bash
npm run dev   # Run CLI via tsx (no build step)
npm run build # tsc → dist/
npm test      # vitest run
```

### CLI

Binary: `figma-to-code` (entry: `src/index.ts`)

```bash
# Requires FIGMA_TOKEN in .env
npm run dev -- convert "https://www.figma.com/design/XXXX/...?node-id=123-456" \
  -f react,vue,svelte \
  --llm claude \
  -o ./output
```

### Web UI

```bash
npm run dev -- serve   # Start Express server at localhost:3000
```

Entry: `src/web/server.ts` — serves the web UI, SSE conversion endpoint, preview, and iterative refinement.

### Environment Variables

```
FIGMA_TOKEN=<personal access token>   # Required
ANTHROPIC_API_KEY=<key>               # Required for --llm claude
OPENAI_API_KEY=<key>                  # Required for --llm openai or deepseek
```

---

## Architecture: Three-Path Pipeline

The pipeline detects the Figma node type and routes to the appropriate path:

| Condition | Path | CSS Strategy |
|-----------|------|-------------|
| Node type is `COMPONENT_SET` | **PATH A** — Variant-aware | Deterministic BEM CSS from Figma tokens |
| Multi-section page detected | **PATH C** — Per-section generation + stitching | Deterministic layout + per-section CSS |
| Chart/graph node detected | **Chart codegen** — Recharts (deterministic) | Component-scoped CSS |
| Everything else | **PATH B** — Single component | LLM-generated class-based CSS |

### PATH A — COMPONENT_SET (variant-aware)

```
Figma COMPONENT_SET
  → parseComponentSet()                      extract axes, states, CSS tokens
  → collectAssetNodesFromAllVariants()       scan ALL variants for icons
  → exportAssetsFromAllVariants()            download SVGs, deduplicate by position + content + color
  → buildVariantCSS()                        deterministic BEM CSS from tokens
  → buildVariantPromptData(assetMap, assets) derive props + icon-variant relationships
  → LLM + generateWithRetry()               generates class-based .lite.tsx
  → Mitosis parseJsx() + validators          accessibility, BEM, fidelity checks
  → generateFrameworkCode()                  compile to target frameworks
  → injectCSS()                             inject deterministic CSS into each output
```

LLM generates `class={state.classes}` — **not** `css={{}}`.

### PATH B — Single Component

```
Single Figma node
  → serializeNodeForPrompt()       CSS-ready YAML with asset markers
  → collectAssetNodes()            find icon nodes in tree
  → exportAssets()                 download SVGs to assets/
  → assembleSystemPrompt()         loads prompts/system.md
  → assembleUserPrompt()           includes semantic HTML hints
  → LLM + generateWithRetry()     generates class-based .lite.tsx
  → Mitosis parseJsx()
  → generateFrameworkCode()
  → injectCSS()                   inject extracted CSS into each output
```

### PATH C — Multi-Section Page

```
Multi-section page
  → extractPageLayoutCSS()         deterministic layout CSS from auto-layout
  → flattenWrapperFrames()         unwrap plain container frames
  → For each section (in parallel):
      → COMPONENT_SET? → PATH A prompt chain
      → Chart? → Recharts codegen
      → Compound? → generateCompoundSection()
      → Simple? → PATH B prompt chain with page context
  → stitchPageComponent()          merge all sections into one component
  → Mitosis parseJsx()
  → generateFrameworkCode()
  → injectCSS()                   inject merged CSS
```

### Chart Detection & Recharts Codegen

When a node is identified as a chart/graph, it bypasses the LLM → Mitosis pipeline entirely:
- Detects charts by arc segments (pie/donut), grid patterns (line/bar/area), or naming
- Extracts chart metadata (type, data points, colors, labels) via LLM
- Generates Recharts React component deterministically
- Other frameworks get a placeholder directing to the React version

---

## Source Files

### Core Pipeline

| File | Role |
|------|------|
| `src/index.ts` | CLI entry — Commander.js, option validation, spinner |
| `src/convert.ts` | Pipeline orchestrator — path detection, all 3 paths + chart codegen |
| `src/output.ts` | Writes `.lite.tsx`, framework files, assets, meta.json to output dir |
| `src/config.ts` | Centralized configuration (page detection thresholds, fidelity, server) |
| `src/types/index.ts` | `Framework`, `ConvertOptions`, `ConversionResult`, `AssetEntry`, etc. |

### Figma Data

| File | Role |
|------|------|
| `src/figma/fetch.ts` | Figma REST API client (PAT auth) |
| `src/figma/simplify.ts` | Framelink `simplifyRawFigmaObject()` wrapper |
| `src/figma/component-set-parser.ts` | Variant parsing, state classification, BEM CSS generation |
| `src/figma/asset-export.ts` | Icon export: all-variant scan, position-aware dedup, color-aware grouping |
| `src/figma/variant-prompt-builder.ts` | PATH A LLM prompt construction (props, icons, variant text diffs) |
| `src/figma/chart-detection.ts` | Chart/graph node detection and metadata extraction |
| `src/figma/component-discovery.ts` | Component discovery for PATH C sections |
| `src/figma/page-layout.ts` | Page layout CSS extraction from auto-layout data |

### Complete Design Extractor

| File | Role |
|------|------|
| `src/figma-complete/index.ts` | Main extractor entry, `extractCompleteDesign()` |
| `src/figma-complete/design-extractor.ts` | Core extraction logic |
| `src/figma-complete/node-walker.ts` | Recursive node tree walker |
| `src/figma-complete/api-parser.ts` | Raw Figma API response parser |
| `src/figma-complete/extractors/` | Property extractors (layout, visuals, text, component, variables) |
| `src/figma-complete/transformers/` | Property transformers (layout, text, style, effects, component) |

### Compilation & Validation

| File | Role |
|------|------|
| `src/compile/parse-and-validate.ts` | Mitosis `parseJsx()` wrapper |
| `src/compile/generate.ts` | Mitosis framework generators |
| `src/compile/retry.ts` | LLM → parse → validate → retry loop (3 attempts + fallback) |
| `src/compile/cleanup.ts` | Strip markdown fences, fix missing Mitosis imports |
| `src/compile/inject-css.ts` | Post-compile CSS injection per framework |
| `src/compile/font-resolver.ts` | Google Fonts detection and `@import` generation |
| `src/compile/stitch.ts` | PATH C section stitching into single page component |
| `src/compile/component-gen.ts` | Compound section generation for PATH C |
| `src/compile/chart-codegen.ts` | Recharts component generation from chart metadata |
| `src/compile/a11y-validate.ts` | axe-core + jsdom accessibility validation |
| `src/compile/bem-validate.ts` | BEM class name consistency check (JSX vs CSS) |
| `src/compile/semantic-validate.ts` | Semantic HTML validation by component category |
| `src/compile/css-fidelity-validate.ts` | CSS property coverage validation |
| `src/compile/text-fidelity-validate.ts` | Text content presence validation |
| `src/compile/layout-fidelity-validate.ts` | Layout class coverage validation |
| `src/compile/fidelity-report.ts` | Aggregated fidelity report builder |

### LLM Providers

| File | Role |
|------|------|
| `src/llm/provider.ts` | `LLMProvider` interface |
| `src/llm/claude.ts` | Anthropic Claude provider (claude-sonnet-4-5) |
| `src/llm/openai.ts` | OpenAI GPT-4o provider |
| `src/llm/deepseek.ts` | DeepSeek provider (OpenAI-compatible) |
| `src/llm/index.ts` | Provider factory |

### Prompts

| File | Role |
|------|------|
| `src/prompt/index.ts` | Prompt assembly entry |
| `src/prompt/assemble.ts` | System + user prompt construction for PATH B/C |
| `src/prompt/system-prompt.ts` | System prompt builder |
| `src/prompt/few-shot-examples.ts` | Few-shot examples for LLM |
| `prompts/system.md` | PATH B system prompt template |
| `prompts/page-section.md` | PATH C section system prompt template |

### Web UI & Preview

| File | Role |
|------|------|
| `src/web/server.ts` | Express server — SSE convert, refine, preview, download, disk fallback |
| `src/web/preview.ts` | Preview HTML generator (variant grid, Babel transpilation) |
| `src/web/refine.ts` | Iterative refinement via LLM chat |
| `src/web/public/app.js` | Client-side app — project persistence, inline preview, Monaco editor |
| `src/web/public/index.html` | Web UI HTML |

### Other

| File | Role |
|------|------|
| `src/utils/figma-url-parser.ts` | Parse `fileKey` and `nodeId` from Figma URLs |
| `src/utils/session-id.ts` | Session ID generator |
| `src/template/wire-into-starter.ts` | Wire generated component into starter app |
| `src/preview/setup-preview.ts` | CLI preview app setup |

---

## Mitosis Rules (Critical)

Violating any of these causes a compile/parse failure:

- **Use `class`, not `className`**
- **`css={state.X}` does NOT work** — PATH A uses `class={state.classes}` with a `useStore` getter
- **`css={{}}` values must be plain string literals** — no expressions, ternaries, variables, or template literals
- **No `.map()` in JSX** — use `<For each={...}>{(item) => (...)}</For>`
- **No ternaries for JSX elements** — use `<Show when={...}>...</Show>`
- **State variable must be named `state`** — `const state = useStore(...)`
- **Event handler param must be named `event`**
- **All numeric CSS values need units** — `'16px'` not `16`

### Mitosis Generator Config

| Framework | Config |
|-----------|--------|
| React | `componentToReact({ stateType: 'useState', stylesType: 'style-tag' })` |
| Vue | `componentToVue({ api: 'composition' })` |
| Svelte | `componentToSvelte({ stateType: 'variables' })` |
| Angular | `componentToAngular({ standalone: true })` |
| Solid | `componentToSolid({ stateType: 'store', stylesType: 'style-tag' })` |

---

## BEM Class Convention (PATH A)

```
.component-name              base — default variant + default state
.component-name--primary     prop axis modifier (diff from default)
.component-name:hover        interactive state (diff from default)
.component-name[data-error]  boolean state modifier
.component-name__label       named child element
```

CSS injection per framework:
- **React/Solid**: `<style>{\`css\`}</style>` before last `</>`
- **Vue**: `<style scoped>` section
- **Svelte**: `<style>` section
- **Angular**: `styles: [\`css\`]` in `@Component`

---

## Validation Layer

After Mitosis parse succeeds, the retry loop runs validators that feed errors back to the LLM:

1. **Accessibility** — renders JSX in jsdom, runs axe-core, reports serious/critical WCAG violations
2. **BEM Consistency** — checks static class names in JSX exist in CSS
3. **Semantic HTML** — validates correct HTML elements for detected component category
4. **CSS Fidelity** — validates CSS property coverage against Figma data
5. **Text Fidelity** — ensures expected text content from Figma appears in output
6. **Layout Fidelity** — validates CSS class coverage for child elements

On the final attempt, the result is returned even if validators report issues.

A **fidelity report** (`ComponentName.fidelity.json`) is generated per conversion with pass/fail per check.

---

## Icon Export System

Icons are collected from **ALL variants** (not just default) and intelligently grouped:

- **Detection**: Empty frames, small frames with vector content, INSTANCE nodes (≤80px)
- **Deduplication**: Groups by position + SVG path shape + color signature
- **Filenames**: `{position}-{icon-name}.svg` (e.g., `left-icon-spinner.svg`)
- **Variant tracking**: Each asset records which variants it appears in
- **Color variants**: Same shape with different colors get `-2`, `-3` suffixes
- **Visibility check**: Hidden icon slots (e.g., `visible: false`) are skipped

---

## Web UI Features

### Preview System (prioritized)
1. **WebContainer live preview** — Full Vite dev server in-browser, supports live editing
2. **Server static preview** — `GET /api/preview/{sessionId}` with variant grid
3. **Inline offline preview** — Reconstructed from localStorage with data-URI assets

### Session Persistence
- **Server**: In-memory sessions (1hr TTL) with disk fallback from `output/` directory
- **Client**: localStorage with `componentPropertyDefinitions`, `assets`, `frameworkOutputs`, `chatHistory`, UI state (`activeFile`, `openFiles`, `codeViewMode`)
- **Quota protection**: On `QuotaExceededError`, progressively strips assets → chatHistory → oldest projects

### Iterative Refinement
Chat-based refinement sends current code + conversation history to LLM. CSS is preserved if LLM drops it. Last 20 conversation turns maintained.

### Template Wiring
`--template` flag wires generated component into `src/figma-to-code-starter-main/` starter app (Tailwind + cn() + CSS variables). Available as "Wired app" view in code editor.

---

## Figma Data Patterns

- **Variant names**: `"Style=Primary, State=Default, Size=Medium"` — split on `,` then `=`
- **Compound states**: `"Error-Hover"`, `"Filled in - Hover"` — split on ` - ` first, then `-`
- **Multi-word states**: `"Filled in"` → camelCase prop `filledIn` via `toBooleanPropName()`
- **`_` prefixed nodes** with no children/text are filtered from LLM prompts
- **State axis detection**: axis named `"State"` exactly, or heuristic (2+ values match `STATE_KEYWORDS`)

---

## LLM Providers

| `--llm` | Env var | Model |
|---------|---------|-------|
| `claude` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-5` |
| `openai` | `OPENAI_API_KEY` | `gpt-4o` |
| `deepseek` | `OPENAI_API_KEY` | DeepSeek (OpenAI-compatible API) |

---

## Output

Written to `./output/{ComponentName}-{sessionId}/`:

| File | Content |
|------|---------|
| `ComponentName.lite.tsx` | Mitosis source |
| `ComponentName.jsx` | React |
| `ComponentName.vue` | Vue |
| `ComponentName.svelte` | Svelte |
| `ComponentName.ts` | Angular |
| `ComponentName.tsx` | Solid |
| `ComponentName.meta.json` | Variant axes + component property definitions |
| `ComponentName.fidelity.json` | Fidelity diagnostics report |
| `assets/*.svg` | Exported SVG icons |
| `app/` | Wired starter app (when `--template` used) |

---

## Known Pre-existing TS Errors (do not fix)

1. `src/compile/generate.ts:41` — `stateType: 'store'` not in `ToSolidOptions` type (works at runtime)
2. `src/figma/simplify.ts:26` — `@figma/rest-api-spec` version mismatch between packages
3. `src/verify-imports.ts:7` — `collapseSvgContainers` not exported from `figma-developer-mcp`
