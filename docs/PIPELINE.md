# Pipeline Architecture — PATH A / B / C / Chart

## Overview

```
Figma Node
    ↓
┌─────────────────────────────────────────────────┐
│  What is this node?                             │
├─────────────────────────────────────────────────┤
│  COMPONENT_SET?          → PATH A               │
│  Structural shadcn?      → PATH B-Structural    │
│  Multi-section page?     → PATH C               │
│  Chart/graph?            → Chart Path            │
│  Everything else         → PATH B               │
└─────────────────────────────────────────────────┘
```

---

## Path Detection (src/convert.ts)

```typescript
const isCompSet    = isComponentSet(enhanced);       // node.type === 'COMPONENT_SET'
const isStructural = isStructuralShadcn(enhanced);   // sidebar/table + templateMode
const isPage       = isMultiSectionPage(enhanced);   // ≥2 children with semantic roles
const detectedCharts = await detectChartsInPage(rawDocumentNode, llm);  // LLM-first
const isChart      = !isPage && detectedCharts.length > 0;

// Priority order:
PATH A       → isCompSet
B-Structural → isStructuralShadcn
PATH C       → isPage
Chart        → isChart
PATH B       → fallback
```

---

## PATH A — COMPONENT_SET (variant-aware)

**When**: Root node type is `COMPONENT_SET` (has variant axes like Type, Size, State).

**Flow**:
```
COMPONENT_SET
  → parseComponentSet()               — extract variant axes, states, CSS tokens
  → collectAssetNodesFromAllVariants() — scan ALL variants for icons
  → exportAssetsFromAllVariants()      — download SVGs, dedup by position+shape
  → buildVariantCSS()                  — deterministic BEM CSS from tokens
  → buildVariantPromptData()           — derive props, icon mappings
  → LLM generates .lite.tsx            — class-based, uses state.classes
  → Mitosis parseJsx() + validators    — a11y, BEM, fidelity checks
  → generateFrameworkCode()            — compile to React/Vue/Svelte/Angular/Solid
  → injectCSS()                        — inject deterministic CSS into each output
```

**shadcn intercept**: If `templateMode` ON and `isShadcnSupported(category)`:
- Calls `generateShadcnComponentSet()` → React only
- Generates CVA variant structure matching Figma variant axes
- Other frameworks get placeholder

**Chart variants**: If any variant is a chart:
- Generates one Recharts chart per variant
- Wraps all in a grid wrapper component

---

## PATH B — Single Component

**When**: Not a COMPONENT_SET, not a page, not a chart.

**Flow**:
```
Single Figma node
  → serializeNodeForPrompt()    — CSS-ready YAML with asset markers
  → collectAssetNodes()         — find icon nodes in tree
  → exportAssets()              — download SVGs to assets/
  → LLM generates .lite.tsx     — class-based component
  → Mitosis parseJsx()
  → generateFrameworkCode()
  → injectCSS()
```

**shadcn intercept** (templateMode):
- `matchComponentPattern(name)` detects formRole (button, input, select, etc.)
- If `isShadcnSupported(formRole)` → `generateShadcnSingleComponent()`
- LLM receives shadcn base template + Figma YAML
- Returns React consumer code importing from `@/components/ui/xxx`

### PATH B-Structural — Sidebar / Table

**When**: Root node name matches sidebar or table pattern + `templateMode` ON.

**Detection**:
```typescript
const STRUCTURAL_SHADCN_ROLES_TOP = new Set(['sidebar', 'table']);
const rootNameFormRole = matchComponentPattern(rootName);
// e.g. "SideNav" → sidebar, "Data Table" → table
```

**Flow**: `generateShadcnStructuralComponent()` with full Figma tree
- Receives leaf component info (buttons, checkboxes found inside)
- LLM composes the structural layout using shadcn sub-components

---

## PATH C — Multi-Section Page

**When**: Root FRAME has ≥2 children with semantic roles (header, footer, nav, hero, etc.).

**Flow**:
```
Multi-section page
  → flattenWrapperFrames()        — unwrap plain layout containers (uses RAW children
                                     to preserve names like "table" that the simplifier
                                     may rename)
  → mergeChartAdjacentSiblings()  — remove chart overlay siblings
  → extractPageLayoutCSS()        — deterministic layout from auto-layout
  → For each section (parallel):
      ├─ COMPONENT_SET?  → PATH A logic
      ├─ Chart?          → Recharts codegen
      ├─ Compound?       → generateCompoundSection()  ← most sections
      └─ Simple?         → standard LLM prompt
  → stitchPageComponent()         — merge all sections into one component
  → Mitosis parse + compile
  → injectCSS()
```

### Compound Section Generation (src/compile/component-gen.ts)

Most PATH C sections go through this two-pass generator:

**Pass 1 — Discover & generate leaf components**:
```
discoverComponents(sectionNode, rawNode, { deepRecurse, chartNodeNames })
  → walkForComponents() traverses the tree:
      depth 0: check chart (LLM names) + structural (table/sidebar)
      depth 1+: check INSTANCE name patterns + FRAME heuristics + structural
  → Returns: DiscoveredComponent[] with formRole for each
```

Then for each discovered component:
- **Charts** → `extractChartMetadata()` + `generateChartCode()` (Recharts, deterministic)
- **shadcn leaf** (button, input, checkbox) → `generateShadcnSingleComponent()`
- **shadcn structural** (table, sidebar) → `generateShadcnStructuralComponent()` with leaf info
- **Other UI** → `generateSingleComponent()` via LLM

**Pass 2 — Generate section layout**:
```
substituteComponents()  — replace INSTANCE nodes with pre-generated HTML placeholders
LLM generates section layout using the placeholders
Merge all component CSS + section CSS
```

---

## Chart Path — Recharts Codegen

**When**: `detectChartsInPage()` returns non-empty array.

### Detection — LLM-First (src/figma/chart-detection.ts)

```
detectChartsInPage(rawNode, llm)
  → buildNodeSummary(node)         — compact tree text for LLM
  → LLM prompt: "Identify ALL charts in this tree"
  → Returns: [{ name: "BarLineChart", chartType: "composed" }]
  → Or [] if no charts
```

The LLM is told what IS and ISN'T a chart:
- **IS**: bars, lines, pie slices, radar polygons, area fills visualizing data
- **NOT**: tables, icons, maps, forms, cards, navigation, progress bars

This single LLM call replaces 500+ lines of structural heuristics.

### `detectedChartNames` flows through the entire pipeline:

| Where | What it does |
|-------|-------------|
| `flattenWrapperFrames()` | Don't unwrap chart containers |
| `mergeChartAdjacentSiblings()` | Use LLM names to identify chart siblings |
| `generateCompoundSection()` | Pass to `discoverComponents()` |
| `walkForComponents()` | `chartNodeNames.has(name)` instead of structural check |

### Codegen — Deterministic (src/compile/chart-codegen.ts)

```
extractChartMetadata(rawNode, llm)   — LLM extracts series, colors, labels, axes
generateChartCode(metadata)          — deterministic Recharts JSX + CSS
```

No LLM generates the final code — it's template-based from metadata.

### Sync Fallback

`isChartSection(node)` — minimal name-only check (`/chart|graph|plot/`).
Used only when LLM detection hasn't run (e.g. `isMultiSectionPage` filter).

---

## Component Discovery (src/figma/component-discovery.ts)

### What gets detected and how

| Detection Layer | What | How |
|----------------|------|-----|
| **Chart (depth 0)** | Chart sections | `chartNodeNames.has(nodeName)` — from LLM |
| **Structural (depth 0)** | Table/sidebar at section root | `matchComponentPattern(name)` + `matchComponentPattern(rawNode.name)` + `isStructuralTable()` |
| **Structural (depth 1+)** | Table/sidebar nested inside section | Same as above, in `deepRecurse` mode |
| **INSTANCE name** | Button, Input, Checkbox, Select, etc. | `matchComponentPattern(name)` against 25+ regex patterns |
| **INSTANCE properties** | Components from design systems | `inferFormRoleFromProperties()` — checks variant axes |
| **FRAME heuristic** | Plain FRAMEs used as widgets | `detectFrameBasedWidget()` — visual checks (border, aspect ratio, text child) |
| **Structural table** | Table without "table" name | `isStructuralTable()` — ≥3 same-width rows with ≥3 cells each |

### Name Pattern Examples

```typescript
/\btable\b|data\s*table|data\s*grid/     → 'table'
/\bsidebar\b|side\s*nav|sidenav/         → 'sidebar'
/dropdown\s*field|drop\s*down/            → 'select'
/input\s*field|text\s*field/              → 'textInput'
/^button\b|btn\b|cta\b/                  → 'button'
/checkbox/                                → 'checkbox'
/toggle|switch/                           → 'toggle'
/chip\b|tag\b|badge\b/                   → 'chip'
```

### Raw Node Name Fallback

The Figma simplifier may rename nodes (e.g. `"table"` → `"Frame 2147225802"`).
Discovery checks both `node.name` (simplified) and `rawNode.name` (original Figma name):

```typescript
let role = matchComponentPattern(node.name);
if (!role && rawNode?.name !== node.name) {
  role = matchComponentPattern(rawNode.name);  // original Figma name
}
```

---

## shadcn Integration Summary

### When shadcn is used

| Path | Condition | What happens |
|------|-----------|-------------|
| **A** | `templateMode` + `isShadcnSupported(category)` | `generateShadcnComponentSet()` |
| **B** | `templateMode` + leaf component detected | `generateShadcnSingleComponent()` |
| **B-Structural** | `templateMode` + sidebar/table root | `generateShadcnStructuralComponent()` |
| **C (leaf)** | `templateMode` + leaf inside section | `generateShadcnSingleComponent()` per leaf |
| **C (structural)** | `templateMode` + table/sidebar inside section | `generateShadcnStructuralComponent()` with leaf info |
| **Chart** | Never | Charts always use Recharts codegen |

### shadcn Prompt Rules

1. Return base template EXACTLY as provided — apply Figma styling via `className` only
2. Consumer component imports from `@/components/ui/xxx`
3. NEVER use raw HTML elements when shadcn sub-component exists
   - `<table>` → `<Table>`, `<tr>` → `<TableRow>`, `<td>` → `<TableCell>`
4. Import ALL needed sub-components (not just the base)
5. Self-contained data: declare `.map()` arrays inside the component
6. `<Sidebar>` must be wrapped in `<SidebarProvider>`

### shadcn Output

For each shadcn component, the output includes:
- `{component}.tsx` — the shadcn library source (base template, mostly unchanged)
- Consumer code in `{Page}.jsx` — imports and composes the sub-components

Import injection scans the final React code for actual usage — only components
referenced in JSX get imported (no unused imports).

---

## Key Files

| File | Role |
|------|------|
| `src/convert.ts` | Path router, `convertPage()`, `flattenWrapperFrames()`, `mergeChartAdjacentSiblings()` |
| `src/compile/component-gen.ts` | `generateCompoundSection()` (2-pass), `generateSingleComponent()` |
| `src/figma/component-discovery.ts` | `discoverComponents()`, `walkForComponents()`, pattern matching |
| `src/figma/chart-detection.ts` | `detectChartsInPage()` (LLM), `extractChartMetadata()`, `isChartSection()` |
| `src/compile/chart-codegen.ts` | `generateChartCode()` — deterministic Recharts JSX |
| `src/shadcn/shadcn-types.ts` | `isShadcnSupported()`, `getShadcnComponentType()` |
| `src/shadcn/shadcn-codegen.ts` | `generateShadcnSingleComponent()`, `generateShadcnStructuralComponent()` |
| `src/shadcn/shadcn-prompt-builder.ts` | Prompt construction for shadcn LLM calls |
| `src/compile/stitch.ts` | `stitchPageComponent()` — merge sections into one component |
| `src/prompt/assemble.ts` | Prompt construction for all paths |
