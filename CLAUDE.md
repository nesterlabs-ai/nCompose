# figma-to-mitosis — CLAUDE.md

CLI tool: converts Figma designs to import-ready components for React, Vue, Svelte, Angular, and Solid via the [Mitosis](https://github.com/BuilderIO/mitosis) compiler.

---

## Dev Commands

```bash
npm run dev   # Run CLI via tsx (no build step)
npm run build # tsc → dist/
npm test      # vitest run
```

CLI binary: `figma-to-code` (entry: `src/index.ts`)

```bash
# Requires FIGMA_TOKEN in .env
npm run dev -- convert "https://www.figma.com/design/XXXX/...?node-id=123-456" \
  -f react,vue,svelte \
  --llm claude \
  -o ./output
```

### Environment Variables

```
FIGMA_TOKEN=<personal access token>   # Required
ANTHROPIC_API_KEY=<key>               # Required for --llm claude
OPENAI_API_KEY=<key>                  # Required for --llm openai or deepseek
```

---

## Architecture: Two-Path Pipeline

### PATH A — COMPONENT_SET (variant-aware)

Triggered when the Figma node is a `COMPONENT_SET` (a group of variants).

```
Figma COMPONENT_SET
  → parseComponentSet()                      extract axes, states, CSS tokens
  → collectAssetNodesFromAllVariants()       scan ALL variants for icons (not just default) ⭐
  → exportAssetsFromAllVariants()            download SVGs, group by (position + content) ⭐
  → buildAssetMap()                          nodeId → "./assets/filename.svg"
  → buildVariantCSS()                        deterministic BEM CSS from tokens
  → buildVariantPromptData(assetMap, assets) derive props + icon-variant relationships ⭐
  → buildComponentSetSystemPrompt()
  → buildComponentSetUserPrompt()            includes icon conditional rendering guidance ⭐
  → LLM + generateWithRetry()                generates class-based .lite.tsx with <img> tags
  → Mitosis parseJsx()                       validate + parse
  → generateFrameworkCode()                  compile to target frameworks
  → injectCSS()                              inject deterministic CSS into each output
```

LLM generates `class={state.classes}` — **not** `css={{}}`.
Icon slots with exported SVGs get explicit `<img src="./assets/...">` hints in the prompt.

### PATH B — Single Component

Triggered for all non-COMPONENT_SET nodes.

```
Single Figma node
  → collectAssetNodes()              find icon nodes in tree
  → exportAssets()                   download SVGs to assets/
  → assembleSystemPrompt()           loads prompts/system.md
  → assembleUserPrompt()
  → LLM + generateWithRetry()        generates inline-styled .lite.tsx
  → Mitosis parseJsx()
  → generateFrameworkCode()
```

LLM generates `css={{ color: '#fff' }}` — plain string literal values only.

---

## Source Files

| File | Role |
|------|------|
| [src/index.ts](src/index.ts) | CLI entry — Commander.js, option validation, spinner |
| [src/convert.ts](src/convert.ts) | Pipeline orchestrator — detects PATH A vs B |
| [src/output.ts](src/output.ts) | Writes `.lite.tsx` + framework files to output dir |
| [src/figma/fetch.ts](src/figma/fetch.ts) | Figma REST API client (PAT auth) |
| [src/figma/simplify.ts](src/figma/simplify.ts) | Framelink `simplifyRawFigmaObject()` wrapper |
| [src/figma/enhance.ts](src/figma/enhance.ts) | Rotation math (currently passthrough) |
| [src/figma/component-set-parser.ts](src/figma/component-set-parser.ts) | Variant parsing, state classification, diff-based CSS |
| [src/figma/asset-export.ts](src/figma/asset-export.ts) | Comprehensive icon export: scan all variants, position-aware grouping, variant tracking |
| [src/figma/variant-prompt-builder.ts](src/figma/variant-prompt-builder.ts) | Dynamic LLM prompt for PATH A (includes `<img>` hints from assetMap) |
| [src/compile/parse-and-validate.ts](src/compile/parse-and-validate.ts) | `parseJsx()` wrapper |
| [src/compile/generate.ts](src/compile/generate.ts) | Mitosis framework generators |
| [src/compile/retry.ts](src/compile/retry.ts) | LLM → parse → retry loop (3 attempts + fallback) |
| [src/compile/cleanup.ts](src/compile/cleanup.ts) | Strip markdown fences, fix missing Mitosis imports |
| [src/compile/inject-css.ts](src/compile/inject-css.ts) | Post-compile CSS injection per framework |
| [src/compile/component-set-codegen.ts](src/compile/component-set-codegen.ts) | Deterministic codegen fallback (bypasses Mitosis) |
| [src/llm/provider.ts](src/llm/provider.ts) | `LLMProvider` interface |
| [src/types/index.ts](src/types/index.ts) | `Framework`, `ConvertOptions`, `ConversionResult`, etc. |
| [src/utils/figma-url-parser.ts](src/utils/figma-url-parser.ts) | Parse `fileKey` and `nodeId` from Figma URLs |
| [prompts/system.md](prompts/system.md) | PATH B system prompt — edit to iterate on LLM output |

---

## Mitosis Rules (Critical)

Violating any of these causes a compile/parse failure:

- **Use `class`, not `className`**
- **`css={state.X}` does NOT work** — dynamic expressions in `css` prop fail at compile. PATH A uses `class={state.classes}` with a `useStore` getter instead.
- **`css={{}}` values must be plain string literals** — no expressions, ternaries, variables, or template literals. `css={{ color: state.x ? 'red' : 'blue' }}` is wrong.
- **No `.map()` in JSX** — use `<For each={...}>{(item) => (...)}</For>`
- **No ternaries for JSX elements** — use `<Show when={...}>...</Show>`
- **State variable must be named `state`** — `const state = useStore(...)`
- **Event handler param must be named `event`**
- **All numeric CSS values need units** — `'16px'` not `16`

### Mitosis Generator Config

```typescript
react:   componentToReact({ stateType: 'useState', stylesType: 'style-tag' })
vue:     componentToVue({ api: 'composition' })
svelte:  componentToSvelte({ stateType: 'variables' })
angular: componentToAngular({ standalone: true })
solid:   componentToSolid({ stateType: 'store', stylesType: 'style-tag' })
```

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

## Comprehensive Icon Export System (PATH A)

### Overview

Icons are collected from **ALL variants** (not just default) and intelligently grouped by position and content. This ensures icons that only appear in specific states (e.g., spinner in loading) are correctly identified and exported.

### Collection Strategy

```typescript
// Step 1: Collect from all variants
collectAssetNodesFromAllVariants(allVariantNodes)
  → scans each of 30 variants (e.g., ButtonDanger)
  → finds icon nodes in each variant
  → extracts inner child name (e.g., "Star", "Spinner")
  → tracks parent position (e.g., "Left Icon", "Right Icon")
  → returns 60 icon nodes with position + name metadata

// Step 2: Export and deduplicate
exportAssetsFromAllVariants(contexts, fileKey, client)
  → downloads SVGs from Figma (scale=1 for correct dimensions)
  → replaces hardcoded colors with currentColor for CSS control
  → groups by (parentName + SVG path signature)
  → merges variant lists for each group
  → generates position-aware filenames
  → returns 4 unique files (e.g., left-icon-spinner.svg)
```

### Deduplication Logic

Icons are grouped by **position + SVG content**:

```
Example: ButtonDanger with 30 variants

Input: 60 icon nodes
- Loading variants (6): Left Icon/Spinner + Right Icon/Spinner
- Other variants (24): Left Icon/Star + Right Icon/Star

Grouping:
1. "Left Icon" + <spinner path> → left-icon-spinner.svg (6 variants)
2. "Right Icon" + <spinner path> → right-icon-spinner.svg (6 variants)
3. "Left Icon" + <star path> → left-icon-star.svg (24 variants)
4. "Right Icon" + <star path> → right-icon-star.svg (24 variants)

Output: 4 unique SVG files (93% reduction from 60 → 4)
```

### Filename Generation

- **Pattern**: `{position}-{icon-name}.svg`
- **Examples**:
  - `left-icon-spinner.svg` — Spinner on left side
  - `right-icon-star.svg` — Star on right side
  - `left-icon-chevron.svg` — Chevron on left side

### Variant Tracking

Each asset entry includes:
- `variants: string[]` — List of variant names where this icon appears
- `parentName: string` — Position info ("Left Icon", "Right Icon")
- `nodeName: string` — Actual icon name ("Star", "Spinner", "Chevron")

This metadata is passed to the LLM via `buildVariantPromptData()` to generate intelligent conditional rendering.

### Generated Code Pattern

```jsx
{props.showLeftIcon !== false ? (
  <div className="button__left-icon">
    {props.loading ? (
      <img src="./assets/left-icon-spinner.svg" />
    ) : (
      <>
        {props.chooseLeftIcon || (
          <img src="./assets/left-icon-star.svg" />
        )}
      </>
    )}
  </div>
) : null}
```

### Key Functions

| Function | Purpose |
|----------|---------|
| `collectAssetNodesFromAllVariants()` | Scans all variant nodes for icons |
| `exportAssetsFromAllVariants()` | Downloads and groups by position + content |
| `extractSVGPathSignature()` | Extracts path data for shape comparison |
| `makeColorInheritable()` | Replaces colors with `currentColor` |
| `buildEnhancedAssetMap()` | Creates nodeId → AssetEntry map with variant info |

### Icon Node Detection

Identifies icon containers using multiple heuristics:

```typescript
isAssetNode(node):
  1. Legacy Framelink: node.type === 'IMAGE-SVG'
  2. Empty frame: node.type === 'FRAME' && no children
  3. Small frame with vector content:
     - Size ≤ 32×32 pixels
     - Square-ish (width ≈ height within 4px)
     - Contains only INSTANCE/VECTOR/BOOLEAN_OPERATION children
```

### SVG Processing

All exported SVGs are processed to enable CSS control:

```typescript
makeColorInheritable(svg):
  stroke="#EC221F" → stroke="currentColor"
  fill="#FDE9E9"   → fill="currentColor"
```

This allows variant-specific colors to be applied via CSS:

```css
.button-danger__left-icon { color: #EC221F; }
.button-danger--primary .button-danger__left-icon { color: #FDE9E9; }
```

---

## Figma Data Patterns

- **Variant names**: `"Style=Primary, State=Default, Size=Medium"` — split on `,` then `=`
- **Compound states**: `"Error-Hover"`, `"Filled in - Hover"` — split on ` - ` first, then `-`
- **Multi-word states**: `"Filled in"` → camelCase prop `filledIn` via `toBooleanPropName()`
- **`_` prefixed nodes** (`_meta`, `_hidden`) are filtered from LLM prompts
- **State axis detection**: axis named `"State"` exactly, or heuristic (2+ values match `STATE_KEYWORDS`)

---

## LLM Providers

| `--llm` | Env var | Model |
|---------|---------|-------|
| `claude` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-5` |
| `openai` | `OPENAI_API_KEY` | `gpt-4o` |
| `deepseek` | `OPENAI_API_KEY` | DeepSeek (OpenAI-compatible API) |

---

## Known Pre-existing TS Errors (do not fix)

1. `src/compile/generate.ts:41` — `stateType: 'store'` not in `ToSolidOptions` type (works at runtime)
2. `src/figma/simplify.ts:26` — `@figma/rest-api-spec` version mismatch between packages
3. `src/verify-imports.ts:7` — `collapseSvgContainers` not exported from `figma-developer-mcp`

---

## Output

Written to `./output/` (or `-o <dir>`):

| File | Framework |
|------|-----------|
| `ComponentName.lite.tsx` | Mitosis source |
| `ComponentName.jsx` | React |
| `ComponentName.vue` | Vue |
| `ComponentName.svelte` | Svelte |
| `ComponentName.ts` | Angular |
| `ComponentName.tsx` | Solid |
