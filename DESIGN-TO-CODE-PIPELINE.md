# Pipeline Flow — PATH A, PATH B, PATH C

---

## Executive Summary

The Figma-to-Code pipeline converts Figma designs into production-ready UI components across multiple frameworks (React, Vue, Svelte, Angular, Solid). The system intelligently routes each Figma node through one of three code-generation paths based on its type and complexity:

- **PATH A** — Handles `COMPONENT_SET` nodes (variant-aware components like Button with Primary/Secondary/Disabled states). Uses shadcn templates when available, with an LLM fallback for deterministic BEM CSS generation.
- **PATH B** — Handles single components (any Figma node that isn't a COMPONENT_SET or a full page). Generates code via LLM with either Mitosis (multi-framework) or React + Tailwind direct output.
- **PATH C** — Handles multi-section pages (landing pages, full screens). Decomposes the page into sections, discovers sub-components within each, generates them individually, then stitches everything into one page component.

Each path supports two output modes:
- **templateMode OFF** — Mitosis pipeline producing 5 framework outputs (React, Vue, Svelte, Angular, Solid)
- **templateMode ON** — React + Tailwind direct output (shadcn for PATH A, plain React for PATH B/C)

The pipeline includes a hierarchical component discovery system that identifies nested Component Sets and Complex Components using three detection strategies: name matching, visual heuristics, and component property inference.

---

## Requirements

### Functional Requirements

1. **Figma-to-Code Conversion** — Accept a Figma design URL and generate framework-ready component code
2. **Multi-Framework Output** — Support React, Vue, Svelte, Angular, and Solid via Mitosis compilation (templateMode OFF)
3. **Template Mode Output** — Support React + Tailwind direct generation with shadcn/ui integration (templateMode ON)
4. **Variant-Aware Generation** — COMPONENT_SET nodes must produce variant-aware components with prop-driven styling (e.g., `variant="primary"`, `disabled={true}`)
5. **Page Decomposition** — Multi-section pages must be split into sections, with sub-components discovered and generated independently
6. **Component Discovery** — Automatically identify UI components (buttons, inputs, dropdowns, etc.) within sections using:
   - Name pattern matching
   - Visual/layout heuristics
   - Figma component property inference (from COMPONENT_SET metadata)
7. **Chart Detection** — Identify chart/graph nodes and generate deterministic Recharts code (no LLM)
8. **Asset Export** — Export SVG icons from all variants, deduplicated by position + content + color
9. **CSS Fidelity** — Generated CSS must match Figma design tokens (colors, typography, spacing, borders)
10. **Structural Fallback** — When LLM fails to produce output, generate minimal structural JSX from the design data

### Non-Functional Requirements

1. **Concurrency Control** — Limit parallel LLM calls to 3 to avoid rate limiting (e.g., DeepSeek 429s)
2. **Retry Logic** — Up to 3 LLM attempts with validation feedback per generation
3. **CSS Scoping** — Prevent class name collisions between sections via BEM scoping
4. **Validation** — Accessibility (axe-core), BEM consistency, semantic HTML, CSS/text/layout fidelity checks
5. **Preview** — Generated code must render in WebContainer live preview

---

## High Level Design

### Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         Figma Design (URL)                               │
│                              │                                           │
│                    ┌─────────▼──────────┐                                │
│                    │  convertFigmaToCode()  │                            │
│                    │    (src/convert.ts)    │                             │
│                    └─────────┬──────────┘                                │
│                              │                                           │
│              ┌───────────────┼───────────────┐                           │
│              │               │               │                           │
│              ▼               ▼               ▼                           │
│     ┌────────────┐  ┌────────────┐  ┌────────────┐                      │
│     │  PATH A    │  │  PATH B    │  │  PATH C    │                      │
│     │ COMPONENT  │  │  Single    │  │ Multi-Sect │                      │
│     │   SET      │  │ Component  │  │   Page     │                      │
│     └──────┬─────┘  └─────┬──────┘  └──────┬─────┘                      │
│            │              │                │                              │
│            ▼              ▼                ▼                              │
│     ┌────────────┐  ┌────────────┐  ┌──────────────┐                    │
│     │ shadcn /   │  │ React or   │  │ Discover →   │                    │
│     │ Mitosis    │  │ Mitosis    │  │ Generate →   │                    │
│     │ pipeline   │  │ pipeline   │  │ Stitch       │                    │
│     └──────┬─────┘  └─────┬──────┘  └──────┬───────┘                    │
│            │              │                │                              │
│            └──────────────┼────────────────┘                             │
│                           ▼                                              │
│                  ┌────────────────┐                                      │
│                  │  Code & Preview │                                     │
│                  │  (Web UI / CLI) │                                     │
│                  └────────────────┘                                      │
└──────────────────────────────────────────────────────────────────────────┘
```

### Routing Decision Tree

```
Figma Node
  ├─ type === COMPONENT_SET?                    → PATH A (variant-aware)
  ├─ isMultiSectionPage()?                      → PATH C (page decomposition)
  │     Signals: name patterns, auto-layout,
  │     size thresholds, chart children, etc.
  └─ otherwise                                  → PATH B (single component)
```

### Output Modes

| Mode | Output | Use Case |
|------|--------|----------|
| **templateMode OFF** | `.lite.tsx` + React, Vue, Svelte, Angular, Solid | Multi-framework projects |
| **templateMode ON** | React + Tailwind (+ shadcn for PATH A) | React starter template projects |

---

## Existing Flow

The original pipeline before component discovery and React direct generation:

### PATH A — COMPONENT_SET (unchanged core)

```
COMPONENT_SET node
  → parseComponentSet()                     extract variant axes, states, CSS tokens
  → collectAssetNodesFromAllVariants()       scan ALL variants for icons
  → exportAssetsFromAllVariants()            download SVGs, deduplicate
  → buildVariantCSS()                        deterministic BEM CSS from Figma tokens
  → buildVariantPromptData()                 derive props + icon-variant mapping
  → LLM generates class-based .lite.tsx      class={state.classes} pattern
  → Mitosis parseJsx() + validators          a11y, BEM, fidelity checks
  → generateFrameworkCode()                  compile to 5 frameworks
  → injectCSS()                              inject deterministic CSS per framework
```

### PATH B — Single Component (original)

```
Single Figma node
  → collectAssetNodes() + exportAssets()     find and export SVG icons
  → buildSemanticHint()                      detect category (button, input, etc.)
  → serializeNodeForPrompt()                 YAML with CSS tokens + asset markers
  → assembleSystemPrompt() + assembleUserPrompt()
  → generateWithRetry(llm)                   LLM → Mitosis parse → validate → retry
  → generateFrameworkCode()                  Mitosis compile to 5 frameworks
  → injectCSS()
```

### PATH C — Multi-Section Page (original, no discovery)

```
Full page node
  → flattenWrapperFrames()                   unwrap plain container frames
  → extractPageLayoutCSS()                   deterministic page-level CSS
  → For each section:
      → serialize entire section to YAML     (monolithic — no component extraction)
      → assemblePageSectionSystemPrompt()
      → assemblePageSectionUserPrompt()
      → generateWithRetry(llm)              LLM generates entire section at once
  → stitchPageComponent()                    merge sections into one component
  → parseMitosisCode() + generateFrameworkCode()
```

**Limitations of existing flow:**
- PATH C treated each section as a monolithic block — the LLM had to generate the entire section (including nested buttons, inputs, dropdowns) in one shot
- No component reuse — identical buttons appearing 3 times in a section were generated as separate inline HTML each time
- No shadcn integration for PATH A
- No React direct output mode (everything went through Mitosis)
- No structural fallback when LLM produced empty output

---

## New Flow

The current pipeline with component discovery, React direct generation, shadcn integration, and structural fallback:

### Routing (in `convertFigmaToCode()` — `src/convert.ts`)

```
Figma Node
  ├─ type === COMPONENT_SET?        → PATH A
  ├─ isMultiSectionPage()?          → PATH C
  └─ otherwise (single node)       → PATH B
```

### PATH A — COMPONENT_SET (variant-aware)

**Trigger:** Root Figma node is a `COMPONENT_SET`
**Function:** `convertComponentSet()` in `src/convert.ts`

#### templateMode OFF (Mitosis pipeline)

```
COMPONENT_SET node
  → parseComponentSet()                         extract axes, states, CSS tokens
  → collectAssetNodesFromAllVariants()           scan ALL variants for icons
  → exportAssetsFromAllVariants()                download SVGs, deduplicate
  → buildAssetMap() + buildDimensionMap()
  → buildVariantCSS()                            deterministic BEM CSS (no LLM)
  → buildVariantPromptData()                     derive props + icon-variant mapping
  → extractDefaultVariantYaml()                  serialize default variant to YAML
  → buildComponentSetSystemPrompt()              ← src/figma/variant-prompt-builder.ts
  → buildComponentSetUserPrompt()                ← src/figma/variant-prompt-builder.ts
  → generateWithRetry(llm)                       LLM generates class-based .lite.tsx
  → generateFrameworkCode()                      Mitosis compiles to 5 frameworks
  → injectCSS()                                  inject deterministic CSS per framework
```

**Output:** `.lite.tsx` + per-framework files. Uses `class={state.classes}` pattern.

#### templateMode ON (shadcn)

```
COMPONENT_SET node
  → parseComponentSet()                          same initial parsing
  → collectAssetNodesFromAllVariants()            same asset collection
  → isShadcnSupported(category)?
    ├─ YES → generateShadcnComponentSet()         ← src/shadcn/shadcn-codegen.ts
    │         → getShadcnComponentType()           map category → shadcn type
    │         → readShadcnSource()                 read base .tsx template
    │         → extractVariantStyles()             ← src/shadcn/style-extractor.ts
    │         → extractComponentContent()          ← src/shadcn/content-extractor.ts
    │         → buildShadcnSystemPrompt()          ← src/shadcn/shadcn-prompt-builder.ts
    │         → buildShadcnUserPrompt()            ← src/shadcn/shadcn-prompt-builder.ts
    │         → LLM generates TWO code blocks:
    │           1. Updated shadcn .tsx (with CVA variants -Class Variance Authority — a library used with shadcn/ui to manage component variant styling through Tailwind classes. )
    │           2. Consumer .jsx (imports from @/components/ui/xxx)
    │         → parseTwoCodeBlocks()
    │
    └─ NO or FAIL → falls back to templateMode OFF pipeline above
```

**Output:** `{shadcnType}.tsx` (updated template) + `{ComponentName}.jsx` (consumer). React only.

---

### PATH B — Single Component

**Trigger:** Not a COMPONENT_SET, not a multi-section page. Any single Figma node.
**Function:** `convertSingleComponent()` in `src/convert.ts`

#### templateMode OFF (Mitosis pipeline)

```
Single Figma node
  → collectAssetNodes() + exportAssets()          find and export SVG icons
  → buildSemanticHint()                           detect category (button, input, etc.)
  → buildAssetMap() + serializeNodeForPrompt()    serialize to CSS-ready YAML
  → assembleSystemPrompt()                        ← src/prompt/assemble.ts
  → assembleUserPrompt()                          ← src/prompt/assemble.ts
  → generateWithRetry(llm)                        LLM → Mitosis parse → validate → retry
  → generateFrameworkCode()                       Mitosis compiles to 5 frameworks
  → injectCSS()
```

**Output:** `.lite.tsx` + per-framework files.

#### templateMode ON — Current Flow (Before shadcn in PATH B)

shadcn is currently used ONLY in PATH A. PATH B uses plain React + Tailwind direct:

```
Single Figma node
  → same asset collection + serialization
  → assembleReactSystemPrompt()                   ← src/prompt/assemble.ts
  → assembleReactUserPrompt()                     ← src/prompt/assemble.ts
  → generateReactDirect(llm)                      ← src/compile/react-direct-gen.ts
                                                    (no Mitosis parsing, no shadcn)
```

**Output:** React + Tailwind only. No Mitosis intermediate step.

#### templateMode ON — Future Flow (After shadcn integration in PATH B)

Once shadcn is integrated into PATH B, single components will first check if they match a shadcn template:

```
Single Figma node
  → same asset collection + serialization
  → detectComponentCategory(name)                 detect category (button, input, etc.)
  → isShadcnSupported(category)?
    │
    ├─ YES → generateShadcnSingleComponent()       ← src/shadcn/shadcn-codegen.ts
    │         → getShadcnComponentType()            map category → shadcn type
    │         → readShadcnSource()                  read base shadcn template (.tsx)
    │         → extractNodeStyle()                  extract Figma styles (single node, no variants)
    │         → extractComponentContent()           extract labels, placeholders, text
    │         → buildShadcnSingleComponentSystemPrompt()
    │         → buildShadcnSingleComponentUserPrompt()
    │         → LLM generates TWO code blocks:
    │           1. Updated shadcn .tsx (with Figma-matched styles, NO CVA variants)
    │           2. Consumer .jsx (imports from @/components/ui/xxx)
    │         → parseTwoCodeBlocks()
    │
    └─ NO or FAIL → fallback to React direct:
                     → assembleReactSystemPrompt()
                     → assembleReactUserPrompt()
                     → generateReactDirect(llm)     React + Tailwind (no Mitosis)
```

**Key difference from PATH A shadcn:**
- PATH A has variant axes (Primary/Secondary × Default/Hover) → generates CVA with `compoundVariants`
- PATH B is a single node (no variants) → generates simple shadcn template with Figma styles applied directly (no CVA needed)

**Output:** `{shadcnType}.tsx` (updated template) + `{ComponentName}.jsx` (consumer). React only.

##### Comparison: Before vs After shadcn in PATH B

| Aspect | Before (current) | After (future with shadcn) |
|--------|------------------|---------------------------|
| **Single Button component** | LLM generates raw React + Tailwind from scratch | LLM uses shadcn Button template with Figma styles applied |
| **Single Input component** | LLM guesses input structure and styling | LLM follows shadcn Input template — consistent with design system |
| **Unsupported component (e.g., custom widget)** | LLM generates from YAML | Same — falls back to React direct (no change) |
| **Output files** | 1 file (React component) | 2 files (shadcn template + consumer component) |
| **Consistency with PATH A** | Different styling approach | Same shadcn foundation — consistent look |

---

### PATH C — Multi-Section Page

**Trigger:** `isMultiSectionPage()` returns true.
**Function:** `convertPage()` in `src/convert.ts`

#### Overview

```
Full page node
  → flattenWrapperFrames()                        unwrap plain container frames
  → extractPageLayoutCSS()                        deterministic page-level CSS
  → For each section (concurrency-limited, 3 at a time):
      → generateCompoundSection()                 ← src/compile/component-gen.ts
          Step 1: discoverComponents()            find sub-components
          Step 2: generate each sub-component     PATH 1 (leaf generation)
          Step 3: substituteComponents()          replace INSTANCEs with generated HTML
          Step 4: generate section layout         PATH 2 (layout generation)
  → stitchPageComponent()                         ← src/compile/stitch.ts
  → replaceDesignWidthInCSS()                     fix hardcoded canvas widths
  → (templateMode OFF) → parseMitosisCode() + generateFrameworkCode()
  → (templateMode ON)  → take React output directly + inline charts
```

#### Step 1 — Component Discovery

`discoverComponents()` in `src/figma/component-discovery.ts`

Walks the section tree looking for INSTANCE nodes. Three detection strategies (applied in order):

| # | Strategy | How It Works | Example |
|---|----------|-------------|---------|
| 1 | **Name matching** | Regex patterns against node names | `/^button\b\|btn\b/i` → `button` |
| 2 | **Visual heuristics** | Layout + dimension analysis | h≤64, horizontal, 1-3 children, has text → `button` |
| 3 | **Component properties** | Infer formRole from COMPONENT_SET variant axes | `Disabled` + `Type=Primary` → `button` |

Groups instances by `name + structural fingerprint`. The fingerprint includes: node type, dimensions, layout direction, fills, strokes, border radius, text content, children count, rotation, and visibility.

Returns `ComponentDiscoveryResult` with discovered components, each having: `formRole`, `representativeNode`, all instances, and `variantKey`.

#### Step 2 — Leaf Component Generation (PATH 1)

`generateSingleComponent()` in `src/compile/component-gen.ts`

For each discovered sub-component (concurrency-limited to 3):

**Charts:**
```
Chart node → extractChartMetadata(llm) → generateChartCode() → Recharts code
```

##### Current Flow (Before shadcn in PATH C)

shadcn is currently used ONLY in PATH A. PATH C sub-components use plain LLM generation:

**UI Components — templateMode ON (current):**
```
UI component node
  → assembleReactSystemPrompt()
  → assembleReactUserPrompt()
  → generateReactDirect()                   React + Tailwind (no shadcn, no Mitosis)
```

**UI Components — templateMode OFF (current):**
```
UI component node
  → assembleSystemPrompt() + assembleUserPrompt()
  → generateWithRetry()                      Mitosis pipeline
  → stripDynamicState()                      remove useStore/state from static sections
  → extractJSXBody()                         strip function wrapper
```

**Limitation:** Even when a discovered sub-component is a known UI type (button, input, select, etc.), it does NOT use shadcn templates. The LLM generates everything from scratch, which can produce inconsistent styling compared to PATH A shadcn output.

##### Future Flow (After shadcn integration in PATH B + C)

Once shadcn is integrated into PATH B and PATH C, discovered sub-components will first check if they match a shadcn template before falling back to plain LLM generation:

**UI Components — templateMode ON (future):**
```
UI component node
  → isShadcnSupported(formRole)?
    │
    ├─ YES → generateShadcnInlineComponent()     ← src/shadcn/shadcn-codegen.ts
    │         → readShadcnSource()                read base shadcn template (.tsx)
    │         → extractNodeStyle()                extract Figma styles (single node)
    │         → extractComponentContent()         extract labels, placeholders, text
    │         → buildShadcnInlineSystemPrompt()   shadcn-aware prompt
    │         → buildShadcnInlineUserPrompt()     includes template + Figma styles
    │         → LLM generates ONE code block:
    │             Self-contained JSX fragment with Tailwind classes
    │             (no export/import — inlined into section layout)
    │         → Returns { html, css }
    │
    └─ NO or FAIL → fallback to React direct:
                     → assembleReactSystemPrompt()
                     → assembleReactUserPrompt()
                     → generateReactDirect()       React + Tailwind (no Mitosis)
```

**Key difference from PATH A shadcn:**
- PATH A generates TWO files (updated shadcn .tsx + consumer .jsx) with CVA variants
- PATH C generates ONE inline JSX fragment (no wrapper, no imports) because it's embedded inside a section layout

**UI Components — templateMode OFF (unchanged):**
```
UI component node
  → assembleSystemPrompt() + assembleUserPrompt()
  → generateWithRetry()                      Mitosis pipeline
  → stripDynamicState()                      remove useStore/state from static sections
  → extractJSXBody()                         strip function wrapper
```

##### Comparison: Before vs After shadcn in PATH C

| Aspect | Before (current) | After (future with shadcn) |
|--------|------------------|---------------------------|
| **Button in a page section** | LLM generates raw HTML from scratch | LLM uses shadcn Button template as structural guide |
| **Input in a form section** | LLM guesses input structure | LLM follows shadcn Input template with exact Figma styles |
| **Unsupported component** | LLM generates from YAML | Same — falls back to React direct (no change) |
| **Consistency with PATH A** | Different styling approach | Same shadcn foundation — consistent look across paths |
| **Output format** | Inline HTML string | Inline HTML string (same — no import/export wrapper) |
| **CSS approach** | Tailwind utilities from LLM | Tailwind utilities guided by shadcn template |

#### Step 3 — Substitution

`substituteComponents()` — walks section tree, replaces INSTANCE subtrees with `COMPONENT_REF` nodes containing pre-generated HTML. Applies per-instance text substitution (property-based + positional strategies).

#### Step 4 — Section Layout Generation (PATH 2)

Generates the section layout code that wraps the substituted component HTML.

**templateMode ON:**
```
→ assembleReactSectionSystemPrompt()         ← src/prompt/assemble.ts
→ assembleReactSectionUserPrompt()           ← src/prompt/assemble.ts
→ generateReactDirect()                      React + Tailwind output
```

**templateMode OFF:**
```
→ assemblePageSectionSystemPrompt()          ← src/prompt/assemble.ts
→ assemblePageSectionUserPrompt()            ← src/prompt/assemble.ts
→ generateWithRetry()                        Mitosis pipeline
```

**Fallback:** If no components are discovered, falls back to monolithic generation. If LLM produces empty JSX, a structural fallback generates minimal JSX from the YAML tree.

#### Step 5 — Stitching

`stitchPageComponent()` in `src/compile/stitch.ts`

```
All section outputs
  → extractJSXBody() per section
  → Wrap each in semantic tag (<section>, <header>, <footer>) with BEM class
  → scopeSectionCSS() per section              prevent class collisions
  → Merge all CSS blocks
  → Chart sections → placeholder div
  → Returns { mitosisSource, mergedCSS }
```

#### Step 6 — Final Output

```
templateMode ON:
  → Take stitched React source directly
  → replaceDesignWidthInCSS()                  fix canvas width → 100%
  → Inline chart component code (imports + functions prepended)
  → Inject CSS
  → React-only output

templateMode OFF:
  → replaceDesignWidthInCSS()
  → parseMitosisCode(mitosisSource)
  → generateFrameworkCode()                    compile to 5 frameworks
  → sanitizeJSXAttributes()                    fix class → className (React)
  → Inline chart code for React
  → injectCSS() per framework
  → Multi-framework output
```

---

## Added Flow

### What changed from the Existing Flow to the New Flow

### 1. Component Discovery System (PATH C)

**Before:** Sections were generated monolithically (Monolithic generation means the entire section is sent to the LLM as one big YAML blob, and the LLM generates all the HTML/CSS for that
   section in a single shot — no decomposition, no component extraction.    — the entire section YAML was sent to the LLM in one shot.

**After:** A hierarchical component discovery pipeline identifies sub-components before generation:

```
Section FRAME
  → discoverComponents()
      │
      ├─ Walk tree for INSTANCE nodes
      │
      ├─ Detection Layer 1: Name Matching
      │   Regex patterns: button, input, dropdown, toggle, chip, etc.
      │
      ├─ Detection Layer 2: Visual Heuristics
      │   Layout + dimension analysis for known component shapes
      │
      └─ Detection Layer 3: Component Properties (NEW)
          Read componentProperties from COMPONENT_SET membership
          Infer formRole from property keys/values:
            "Checked" → checkbox
            "Placeholder" → textInput
            "Disabled" + "Type" → button
            "Open" → dropdown
          Handles both array format (Framelink simplified)
          and object format (raw Figma API)
```

**Impact:** Components are generated once and reused across all instances. A button appearing 5 times in a section is generated once and substituted 5 times with per-instance text differences.

### 2. Hierarchical Generation (PATH C Sub-Pipeline)

**Before:** One LLM call per section.

**After:** Two-pass generation per section:

```
PASS 1 (Leaf Components):
  For each discovered component type (3 at a time):
    → Generate focused component HTML + CSS
    → Cache by variantKey

PASS 2 (Section Layout):
  → Substitute INSTANCE nodes with pre-generated HTML
  → Generate layout code referencing pre-built components
```

**Impact:** LLM receives a simpler, pruned YAML for layout generation. Component CSS is isolated and mergeable.

### 3. shadcn Integration (PATH A only)

**Added:** When `templateMode ON` and the component category is shadcn-supported:

```
COMPONENT_SET
  → isShadcnSupported(category)?
    ├─ YES → generateShadcnComponentSet()
    │         Read base shadcn template (.tsx)
    │         Extract variant styles from Figma
    │         Extract content (labels, placeholders)
    │         LLM generates:
    │           1. Updated shadcn .tsx with CVA variants
    │           2. Consumer .jsx with imports
    │
    └─ NO → fallback to Mitosis BEM pipeline
```

**Scope:** shadcn is used ONLY in PATH A (COMPONENT_SET). PATH B and PATH C do NOT use shadcn — they use React + Tailwind direct generation instead.

**Supported shadcn components:** Button, Input, Select, Checkbox, Radio, Toggle, Switch, Slider, Textarea, Dialog, Dropdown Menu, Tabs, Accordion, Card, Badge, Avatar, Toast, Tooltip, Alert, Alert Dialog, Popover, Sheet, Table, Separator, Label, Progress, Skeleton, Scroll Area.

### 4. React Direct Generation (PATH B + PATH C)

**Added:** `generateReactDirect()` in `src/compile/react-direct-gen.ts`

**Before:** All code generation went through Mitosis (parseJsx + compile).

**After:** When `templateMode ON`, PATH B and PATH C skip Mitosis entirely:

```
LLM → React + Tailwind code → extract code block → output directly
```

**No Mitosis parsing, no framework compilation.** Output is React-only with Tailwind utility classes.

### 5. Structural Fallback (PATH C)

**Added:** `generateStructuralFallback()` in `src/compile/component-gen.ts`

**Before:** If LLM produced empty JSX, the section silently disappeared.

**After:** Walks the serialized YAML tree and emits minimal but structurally correct JSX:

```
TEXT nodes  → <span class="section__name">text content</span>
ICON nodes  → <img src="./assets/file.svg" alt="" />
Containers  → <div class="section__name"> with flex CSS
```

**Impact:** Sections always render visible content even when LLM fails.

### 6. Design Width Replacement (PATH C)

**Added:** `replaceDesignWidthInCSS()` in `src/compile/cleanup.ts`

Replaces hardcoded design-canvas pixel widths (e.g., `width: 1440px`) with `width: 100%` in merged CSS so pages are responsive.

### 7. Enhanced Visual Fingerprinting

**Added to** `computeVisualFingerprint()` in `src/compile/component-gen.ts`:

| New Field | Purpose |
|-----------|---------|
| `type` | INSTANCE vs FRAME vs TEXT affects rendering |
| `strokeWeight` | Border thickness affects visual appearance |
| `text` / `characters` | Two "Label" nodes with different text need different CSS |
| `children count` | Container with 1 vs 3 children needs different layout |
| `rotation` | Rotated arrows are visually different from unrotated |
| `visible` | Hidden elements should not share class with visible ones |

**Impact:** More accurate component deduplication — structurally different components get unique CSS classes.

### 8. Visual Editing in Preview (Web UI)

**Added:** Element selection and live editing in the WebContainer preview:

- Hover highlight (blue outline)
- Click to select element
- Computed style inspection (color, fontSize, margin, padding, etc.)
- Live property editing from parent UI
- Two-way postMessage communication between iframe and parent

---

## Prompt Files Summary

| Scenario | System Prompt | User Prompt | Source File |
|----------|--------------|-------------|-------------|
| PATH A (Mitosis) | `buildComponentSetSystemPrompt()` | `buildComponentSetUserPrompt()` | `src/figma/variant-prompt-builder.ts` |
| PATH A (shadcn) | `buildShadcnSystemPrompt()` | `buildShadcnUserPrompt()` | `src/shadcn/shadcn-prompt-builder.ts` |
| PATH B (Mitosis) | `assembleSystemPrompt()` | `assembleUserPrompt()` | `src/prompt/assemble.ts` |
| PATH B (React direct) | `assembleReactSystemPrompt()` | `assembleReactUserPrompt()` | `src/prompt/assemble.ts` |
| PATH C sub-components (Mitosis) | `assembleSystemPrompt()` | `assembleUserPrompt()` | `src/prompt/assemble.ts` |
| PATH C sub-components (React direct) | `assembleReactSystemPrompt()` | `assembleReactUserPrompt()` | `src/prompt/assemble.ts` |
| PATH C section layout (Mitosis) | `assemblePageSectionSystemPrompt()` | `assemblePageSectionUserPrompt()` | `src/prompt/assemble.ts` |
| PATH C section layout (React) | `assembleReactSectionSystemPrompt()` | `assembleReactSectionUserPrompt()` | `src/prompt/assemble.ts` |

---

## Key Source Files

| File | Role |
|------|------|
| `src/convert.ts` | Main orchestrator — PATH A/B/C routing |
| `src/compile/component-gen.ts` | PATH C sub-pipeline — discovery, generation, substitution, structural fallback |
| `src/compile/stitch.ts` | Stitches page sections into one component |
| `src/compile/react-direct-gen.ts` | LLM → React + Tailwind (no Mitosis) |
| `src/compile/retry.ts` | LLM → Mitosis parse → validate → retry loop |
| `src/compile/cleanup.ts` | CSS cleanup, design width replacement |
| `src/shadcn/shadcn-codegen.ts` | shadcn generation (PATH A only) |
| `src/shadcn/shadcn-prompt-builder.ts` | shadcn LLM prompt construction |
| `src/shadcn/style-extractor.ts` | Extracts colors, borders, padding, typography from Figma |
| `src/shadcn/content-extractor.ts` | Extracts labels, placeholders, text content |
| `src/shadcn/shadcn-types.ts` | formRole → shadcn component type mapping |
| `src/figma/component-discovery.ts` | Discovers sub-components in PATH C sections |
| `src/figma/component-set-parser.ts` | Parses COMPONENT_SET variant axes |
| `src/figma/asset-export.ts` | Icon SVG export and deduplication |
| `src/figma/chart-detection.ts` | Chart/graph node detection |
| `src/compile/chart-codegen.ts` | Deterministic Recharts component generation |
| `src/prompt/assemble.ts` | Non-shadcn prompt assembly (PATH B/C) |
| `src/figma/variant-prompt-builder.ts` | PATH A Mitosis prompt builder |
| `src/web/server.ts` | Express server — SSE conversion, preview, refinement |
| `src/web/public/app.js` | Client-side app — project persistence, WebContainer preview |
