# Figma-to-Code Pipeline — Actual Flow

## Corrections from Original Diagram

| Original Diagram | Actual Code |
|------------------|-------------|
| Only shows PATH A and PATH B | **4 paths**: PATH A, PATH B, PATH C, Chart |
| PATH B feeds back to PATH A for component sets | PATH B has its own **composite delegation** — generates shadcn sub-components inline, does NOT route to PATH A |
| Missing templateMode branching | PATH B has two major branches: `templateMode ON` (React + Tailwind direct) and `templateMode OFF` (Mitosis pipeline) |
| Missing PATH C entirely | PATH C handles multi-section pages with per-section generation + stitching |
| Missing Chart codegen | Charts bypass LLM entirely — deterministic Recharts codegen |
| "Code & Preview" is one box | Preview has 3-tier fallback: WebContainer → Server static → Offline Babel |
| No retry/validation loop shown | All LLM paths go through retry loop (3 attempts + validators) |

---

## Entry Point

```
Figma URL → Parse (fileKey, nodeId)
          → Fetch (Figma REST API)
          → Simplify (extractCompleteDesign)
          → Route to Path
```

---

## Path Routing (convert.ts → convertFigmaToCode)

```
                        ┌──────────────────┐
                        │   Figma Node     │
                        │   (simplified)   │
                        └────────┬─────────┘
                                 │
                    ┌────────────┼────────────────────┐
                    │            │                     │
              ┌─────▼─────┐ ┌───▼────────┐    ┌──────▼──────┐
              │ COMPONENT  │ │ Multi-     │    │ Everything  │
              │ _SET?      │ │ Section    │    │ else        │
              │            │ │ Page?      │    │             │
              └─────┬──────┘ └───┬────────┘    └──────┬──────┘
                    │            │                     │
                    │            │              ┌──────▼──────┐
                    │            │              │ Chart/      │
                    │            │              │ Graph?      │
                    │            │              └──┬───────┬──┘
                    │            │                 │       │
                    ▼            ▼                 ▼       ▼
               PATH A        PATH C            Chart   PATH B
                                              Codegen
```

**Detection logic:**
- `COMPONENT_SET` → node type check (`nodes[0].type === 'COMPONENT_SET'`)
- Multi-section page → vertical auto-layout with ≥N fill-width children + semantic section names
- Chart → arc segments (pie/donut), grid patterns (bar/line), or name heuristics
- Everything else → PATH B

---

## PATH A — Component Set (Variant-Aware)

**Trigger:** Root node type is `COMPONENT_SET`

```
COMPONENT_SET
     │
     ▼
┌─────────────────────┐
│ Parse Variants       │ parseComponentSet()
│ • Extract axes       │ (Type, Size, State, Color, etc.)
│ • Detect states      │ (default, hover, focus, disabled)
│ • Find default       │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Export SVG Assets    │ collectAssetNodesFromAllVariants()
│ • Scan ALL variants  │ (not just default)
│ • Dedup by position  │ + content + color
│ • Download parallel  │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Deterministic CSS    │ buildVariantCSS()
│ • BEM class names    │ .component--variant, :hover, [data-state]
│ • From Figma tokens  │ (colors, fonts, spacing — no LLM)
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ LLM → Mitosis       │ generateWithRetry()
│ • Prompt = variant   │ data + CSS + assets
│ • Output = .lite.tsx │ (class={state.classes})
│ • Retry ×3 +         │ validators
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Compile Frameworks   │ Mitosis → React, Vue, Svelte, Angular, Solid
│ • Inject CSS         │ (per-framework injection)
│ • Font imports       │
└─────────────────────┘
```

---

## PATH B — Single Component

**Trigger:** Not COMPONENT_SET, not multi-section, not chart

```
Single Figma Node
     │
     ▼
┌──────────────────────┐
│ Export Assets + YAML   │
│ • collectAssetNodes()  │ (icons, SVGs)
│ • serializeNodeForPrompt() │ (CSS-ready YAML)
│ • detectComponentCategory() │
└─────────┬────────────┘
          │
          ├─── templateMode OFF ──────────────────────────┐
          │                                                │
          ▼                                                ▼
   templateMode ON                              ┌──────────────────┐
          │                                     │ Standard Mitosis  │
          │                                     │ • assemblePrompt  │
          ▼                                     │ • generateWithRetry│
┌──────────────────┐                            │ • compile frameworks│
│ Root matches      │                           └──────────────────┘
│ shadcn category?  │
│ (isShadcnSupported)│
└──┬────────────┬──┘
   │ YES        │ NO
   ▼            ▼
┌────────┐  ┌──────────────────────────────────────────┐
│shadcn  │  │ COMPOSITE DELEGATION                      │
│Single  │  │                                            │
│Codegen │  │ 1. discoverComponents(deepRecurse: true)   │
│        │  │    • Walk entire tree                       │
│ Reads  │  │    • Name matching (button, checkbox, etc.) │
│ base   │  │    • Visual heuristics (dimensions, layout) │
│ .tsx   │  │    • Property inference (Expanded → select) │
│        │  │    • Never stop recursion (find ALL)         │
│ LLM →  │  │                                            │
│ Block 1│  │ 2. Filter containers                        │
│ (.tsx) │  │    • If parent AND child found → drop parent │
│ Block 2│  │    • Keeps leaf primitives only              │
│ (.jsx) │  │                                            │
└──┬─────┘  │ 3. Deduplicate by shadcn type               │
   │        │    • chip + button → one button.tsx          │
   │ FAIL   │    • Prefer direct formRole match            │
   │   │    │                                            │
   │   └───►│ 4. For each unique shadcn type:              │
   │        │    └─ generateShadcnSingleComponent()        │
   │        │       (reads base template, LLM customizes)  │
   │        │                                            │
   │        │ 5. Enrich React Direct prompt                │
   │        │    • "MUST import Button, Checkbox, etc."    │
   │        │    • Include Figma node → component mapping  │
   │        │                                            │
   │        │ 6. generateReactDirect() with enriched prompt│
   │        └──────────────────────┬───────────────────────┘
   │                               │
   │                               │ FAIL (no shadcn children found)
   │                               ▼
   │                     ┌──────────────────┐
   │                     │ React Direct      │
   │                     │ Fallback           │
   │                     │ (plain Tailwind)   │
   │                     └────────┬───────────┘
   │                              │
   ▼                              ▼
┌──────────────────────────────────────┐
│ Output:                               │
│ • ComponentName.jsx (imports shadcn)  │
│ • button.tsx, checkbox.tsx, etc.      │
│   (customized shadcn sub-components) │
└──────────────────────────────────────┘
```

### Composite Delegation — Detection Methods

```
┌─────────────────────────────────────────────────────────┐
│         INSTANCE Node Found During Walk                  │
└─────────────────────┬───────────────────────────────────┘
                      │
         ┌────────────┼────────────┐
         ▼            ▼            ▼
  ┌─────────────┐ ┌─────────┐ ┌──────────────────┐
  │ Name Pattern │ │ Visual  │ │ Component        │
  │ Matching     │ │Heuristic│ │ Property         │
  │              │ │         │ │ Inference        │
  │ "Button" →   │ │ h≤64,  │ │ hasKey(checked)  │
  │   button     │ │ horiz, │ │   → checkbox     │
  │ "Checkbox    │ │ TEXT   │ │ hasKey(expanded)  │
  │  Field" →    │ │  → btn │ │   → select       │
  │   checkbox   │ │        │ │ hasKey(disabled)  │
  │ "Radio" →    │ │ Small  │ │  +type → button  │
  │   radio      │ │ square │ │                  │
  │ "Chip" →     │ │  → chk │ │ Fallback:        │
  │   chip       │ │        │ │   → 'component'  │
  │ "Dropdown"→  │ │        │ │   (generic)      │
  │   select     │ │        │ │                  │
  └──────┬───────┘ └────┬───┘ └────────┬─────────┘
         │              │              │
         ▼              ▼              ▼
  ┌──────────────────────────────────────────┐
  │ In deepRecurse mode:                      │
  │ • Collect if formRole != 'component'      │
  │ • ALWAYS continue recursing into children │
  │ • Skip root node (depth 0)                │
  │                                           │
  │ In normal mode (PATH C):                  │
  │ • Collect and STOP recursion              │
  │ • Recognized nodes are leaf units         │
  └──────────────────────────────────────────┘
```

---

## PATH C — Multi-Section Page

**Trigger:** Vertical auto-layout with ≥N fill-width children + semantic section names

```
Multi-Section Page
     │
     ▼
┌──────────────────────┐
│ Flatten Wrappers      │ flattenWrapperFrames()
│ Extract Layout CSS    │ extractPageLayoutCSS()
│ (deterministic flex)  │
└─────────┬────────────┘
          │
          ▼
┌──────────────────────────────────────────────┐
│ For Each Section (IN PARALLEL):               │
│                                               │
│  ┌─ COMPONENT_SET? ──► PATH A prompt chain    │
│  │                                            │
│  ├─ Chart? ──────────► Recharts codegen       │
│  │                     (deterministic)        │
│  │                                            │
│  ├─ Compound? ───────► Component discovery    │
│  │                     + per-component LLM    │
│  │                                            │
│  └─ Simple? ─────────► PATH B prompt chain    │
│                        (with page context)    │
└─────────┬────────────────────────────────────┘
          │
          ▼
┌──────────────────────┐
│ Stitch All Sections   │ stitchPageComponent()
│ • Merge JSX            │
│ • Merge CSS            │
│ • Layout wrapper       │
└─────────┬────────────┘
          │
          ▼
┌──────────────────────┐
│ Compile Frameworks    │ (if templateMode OFF)
│ OR React Direct       │ (if templateMode ON)
└──────────────────────┘
```

---

## Chart Codegen

**Trigger:** Node detected as chart/graph (arc segments, grid patterns, naming)

```
Chart Node
     │
     ▼
┌──────────────────────┐
│ Extract Metadata      │ extractChartMetadata()
│ • Type (pie, bar,     │ line, area, scatter)
│ • Data points         │
│ • Colors, labels      │
│ (LLM assists here)    │
└─────────┬────────────┘
          │
          ▼
┌──────────────────────┐
│ Deterministic Codegen │ generateChartCode()
│ • Recharts component  │ (no LLM for code gen)
│ • React only          │
└──────────────────────┘
```

---

## LLM Retry Loop (shared by PATH A, B, C)

```
┌───────────────────────────────────────────────────┐
│                RETRY LOOP (max 3 + fallback)       │
│                                                    │
│  Attempt 1 ──► LLM.generate()                      │
│             ──► parseMitosisCode() / extractReact() │
│             ──► Validators:                         │
│                  ├─ Accessibility (axe-core)        │
│                  ├─ BEM Consistency                  │
│                  ├─ Layout Fidelity [blocking]       │
│                  ├─ Semantic HTML [blocking]         │
│                  ├─ Text Fidelity [blocking]         │
│                  └─ CSS Fidelity [advisory]          │
│             ──► Pass? → RETURN                       │
│             ──► Fail? → feed errors back to LLM     │
│                                                    │
│  Attempt 2 ──► Same with error feedback in prompt   │
│  Attempt 3 ──► Same                                 │
│                                                    │
│  Final Fallback ──► Simplified prompt               │
│                  ──► "Generate SIMPLEST valid code"  │
│                  ──► Return result (even with issues)│
└───────────────────────────────────────────────────┘
```

---

## shadcn Single Component Codegen

**Used by:** PATH B (single shadcn intercept) + Composite Delegation (per sub-component)

```
┌──────────────────────┐
│ Input:                │
│ • rootNode (Figma)    │
│ • category (formRole) │
│ • base .tsx template  │
└─────────┬────────────┘
          │
          ▼
┌──────────────────────┐
│ Read Base Template    │ readShadcnSource("button")
│ (from starter app)   │ → button.tsx (Radix + Tailwind)
└─────────┬────────────┘
          │
          ▼
┌──────────────────────┐
│ Extract from Figma    │
│ • Styles (colors,     │ extractNodeStyle()
│   fonts, spacing)     │
│ • Content (text,      │ extractComponentContent()
│   icons)              │
│ • Structure tree      │ extractStructureTree()
│ • Boolean props       │
└─────────┬────────────┘
          │
          ▼
┌──────────────────────┐
│ LLM Generates         │
│ TWO code blocks:       │
│                        │
│ Block 1: Updated .tsx  │ (customized shadcn base)
│  e.g., button.tsx with │ design-specific colors,
│  sizes, radius         │
│                        │
│ Block 2: Consumer .jsx │ (component using shadcn)
│  e.g., MyButton.jsx    │ imports <Button> from
│  @/components/ui/button│
└──────────────────────┘
```

---

## Output & Preview

```
┌─────────────────────────────────────────────────────────────┐
│ OUTPUT FILES (writeOutputFiles)                              │
│                                                              │
│ output/{ComponentName}-{sessionId}/                          │
│ ├── ComponentName.lite.tsx    (Mitosis source / React code)  │
│ ├── ComponentName.jsx         (React)                        │
│ ├── ComponentName.vue         (Vue — if templateMode OFF)    │
│ ├── ComponentName.svelte      (Svelte — if templateMode OFF) │
│ ├── ComponentName.ts          (Angular — if templateMode OFF)│
│ ├── ComponentName.tsx         (Solid — if templateMode OFF)  │
│ ├── button.tsx                (shadcn sub-component)         │
│ ├── checkbox.tsx              (shadcn sub-component)         │
│ ├── radio.tsx                 (shadcn sub-component)         │
│ ├── ComponentName.meta.json   (variant axes + properties)    │
│ ├── ComponentName.fidelity.json (validation report)          │
│ ├── assets/                                                  │
│ │   ├── icon-name.svg                                        │
│ │   └── ...                                                  │
│ └── app/                      (wired starter template)       │
│     └── src/components/ui/    (shadcn files copied here)     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ PREVIEW (3-tier fallback)                                    │
│                                                              │
│ 1. WebContainer Live Preview (highest fidelity)              │
│    • Full Vite dev server in-browser                         │
│    • Hot reload on code edits                                │
│    • Runs actual React/Tailwind/Radix                        │
│                                                              │
│ 2. Server Static Preview                                     │
│    • GET /api/preview/{sessionId}                            │
│    • Babel transpilation on server                           │
│    • Variant grid support                                    │
│                                                              │
│ 3. Offline Preview                                           │
│    • Reconstructed from localStorage                         │
│    • @babel/standalone in-browser                            │
│    • Assets as data-URIs                                     │
└─────────────────────────────────────────────────────────────┘
```

---

## Web Server SSE Flow

```
Browser                          Server
  │                                │
  │  POST /api/convert             │
  │  { figmaUrl, token, ... }      │
  │ ──────────────────────────────►│
  │                                │──► convertFigmaToCode()
  │  SSE: event: step              │
  │  { message: "Fetching..." }    │
  │ ◄──────────────────────────────│
  │                                │
  │  SSE: event: step              │
  │  { message: "[shadcn-comp]..." }│
  │ ◄──────────────────────────────│
  │                                │
  │  ...more steps...              │
  │                                │
  │  SSE: event: complete          │
  │  { sessionId,                  │
  │    frameworkOutputs,           │
  │    assets,                     │
  │    shadcnSubComponents,        │
  │    fidelityReport }            │
  │ ◄──────────────────────────────│
  │                                │
  │  Opens WebContainer preview    │
  │  Stores in localStorage        │
  │                                │
  │  POST /api/refine              │
  │  { sessionId, prompt }         │
  │ ──────────────────────────────►│
  │  SSE: event: complete          │
  │  { updated frameworkOutputs }  │
  │ ◄──────────────────────────────│
```
