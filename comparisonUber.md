# Comparative Analysis: FigmaToCode vs uSpec

## Overview

| | **FigmaToCode (Our Pipeline)** | **uSpec** |
|---|---|---|
| **Purpose** | Design-to-code generator — produces functional React/Vue/Svelte/Angular/Solid from Figma | Documentation generator — produces anatomy/spec docs rendered as Figma frames |
| **Input** | Any Figma node (page, frame, component set) — auto-detects what's inside | User explicitly provides a specific component link |
| **Output** | Application code (`.jsx`, `.vue`, `.svelte`, `.ts`, `.tsx`) with CSS | Figma documentation frames (anatomy, API, color, structure, accessibility specs) |
| **Component Detection** | Autonomous — identifies buttons, inputs, checkboxes from arbitrary designs using a multi-layer heuristic system (name patterns → visual analysis → property inference). No user input needed to classify what a node is. | No autonomous detection. The user must explicitly navigate to and select the component they want to document. uSpec then classifies the component's internal children by Figma node type (`instance`, `text`, `container`, `structural`) — but never identifies what the component itself is (button vs input vs checkbox). |
| **Code Generation** | Generates functional, interactive, framework-specific code. Each detected component is routed through the appropriate codegen path: shadcn/CVA for UI primitives (with full variant/state support), Recharts for charts, BEM CSS for component sets, or LLM-driven generation for generic layouts. Output is production-ready `.jsx`/`.vue`/`.svelte`/`.ts` with scoped CSS, asset exports, and optional wiring into a starter app. | No code generation. Output is strictly documentation — rendered as Figma annotation frames containing anatomy diagrams, property tables, color token maps, dimensional specs, and accessibility guidelines. There is no path from uSpec output to runnable application code. |
| **AI/ML for Detection** | No ML models or vision AI. All detection is **rule-based** using three types of rules: **(1) Regex name matching** — 25 patterns that match node names to component types (e.g., `/input\s*field\|text\s*field/i` → textInput, `/^button\b\|btn\b\|cta\b/i` → button). **(2) Visual/dimensional heuristics** — if-then rules based on measurable Figma properties: a node with `h ≤ 64px + horizontal layout + has border + wider than tall + has TEXT child` = textInput; a node with `h ≤ 40px + w ≤ 80px + aspect ratio 1.5–2.5:1 + has circle child` = toggle/switch. **(3) Property inference** — inspects `componentProperties` key names for signals: presence of `Checked`/`Selected` → checkbox, `Open`/`Expanded` → select, `Placeholder` → textInput. Additionally, **chart detection** uses weighted token scoring (positive: "chart" +3, "axis" +2, "pie" +2; negative: "button" −2, "form" −3) combined with geometric signal analysis (overlapping ellipses = pie, parallel grid lines = axes). | No ML models or vision AI. All classification is **rule-based** using a single type of rule: **(1) Figma node type matching** — a closed enum that classifies children purely by their `node.type` property: `type === 'INSTANCE'` → instance, `type === 'TEXT'` → text, FRAME/GROUP with multiple children → container, RECTANGLE/VECTOR/ELLIPSE/LINE → structural. One additional heuristic: **slot-wrapper detection** — if a FRAME/GROUP contains only a single INSTANCE descendant (through nested wrappers), it's reclassified as `instance-unwrapped` and named after the inner component. There is no name-based pattern matching, no dimensional analysis, and no property inference — because uSpec doesn't need to determine *what* a component is, only *what's inside* a component the user already identified. |
| **Figma Access** | REST API (Personal Access Token) | Figma Console MCP (WebSocket bridge to Desktop Plugin API) |

---

## Worked Example: How Each System Handles a "Button"

Consider a Figma design containing a button component — a rounded rectangle (44px tall, 120px wide) with a background fill, the text "Submit", and a small arrow icon to the right.

```
Figma Node Tree:
  FRAME "Contact Form"                    ← a section of a page
    ├── TEXT "Get in Touch"               ← heading
    ├── INSTANCE "Input Field / Default"  ← an input
    ├── INSTANCE "Button / Primary"       ← the button (INSTANCE from a design library)
    │     ├── TEXT "Submit"
    │     └── INSTANCE "Arrow Right"      ← icon
    └── FRAME "Submit Action"             ← same button but as a plain FRAME (no library)
          ├── TEXT "Submit"
          └── FRAME "Icon"
                └── VECTOR (arrow path)
```

### FigmaToCode — Autonomous Detection

Our pipeline receives the entire "Contact Form" section and must find and classify every component inside it **without being told what's there**.

**Step 1 — Tree walk starts** at "Contact Form". The walker visits each child:

**For the INSTANCE node "Button / Primary":**
1. **Pass 1 (Name matching):** Node name `"Button / Primary"` is tested against 25 regex patterns. Pattern `/^button\b|btn\b|cta\b/i` matches → `formRole = "button"` ✅
2. Detection stops here — no need for Pass 2 or 3.
3. The node is collected as a `DiscoveredComponent` with `formRole: "button"`, and its `componentProperties` (e.g., `Style=Primary, State=Default, Disabled=false`) are recorded for structural fingerprinting.

**For the plain FRAME "Submit Action" (deepRecurse mode):**
1. **Pass 1 (Name matching):** `"Submit Action"` → tested against all 25 patterns → no match (no "button" or "btn" in name).
2. **Pass 2 (Visual heuristics via `detectFrameBasedWidget`):**
   - Dimensions: 120×44px → `h ≤ 64` ✅
   - Layout: horizontal (icon + text side by side) ✅
   - Children: 2 (TEXT + FRAME) → `1–3 children` ✅
   - Has TEXT child ("Submit") ✅
   - All criteria match → `formRole = "button"` ✅
3. The FRAME is collected as a button even though it's not a component instance.

**For the INSTANCE "Input Field / Default":**
1. **Pass 1:** Name matches `/input\s*field|text\s*field/i` → `formRole = "textInput"` ✅

**Result:** Pipeline autonomously found 2 buttons + 1 input from the section tree. Each gets routed to the appropriate shadcn codegen (`button.tsx`, `input.tsx`).

---

### uSpec — User-Directed Documentation

uSpec cannot process the "Contact Form" section and find the button. The workflow is:

**Step 1 — User navigates to the Button component:**
The user must provide the Figma link to the "Button" COMPONENT_SET (e.g., `figma.com/design/xxx?node-id=123-456`). uSpec calls `figma_navigate` to open it.

**Step 2 — uSpec classifies the button's internal children:**
Given the Button component (which the user already identified as a button), uSpec runs a `figma_execute` script that walks its children:

```
Button / Primary
  ├── TEXT "Submit"        → classified as: text
  └── INSTANCE "Arrow Right"  → classified as: instance
        └── (icon vectors)
```

| Child | Figma `node.type` | uSpec Classification |
|-------|-------------------|---------------------|
| "Submit" | TEXT | `text` |
| "Arrow Right" | INSTANCE | `instance` → `shouldCreateSection: true` |

If there were a FRAME wrapping the arrow icon (slot-wrapper pattern):
```
  └── FRAME "Icon Slot"           → has single INSTANCE descendant
        └── INSTANCE "Arrow Right"   → unwrap!
```
Classification: `instance-unwrapped` (named "Arrow Right", `originalName: "Icon Slot"`)

**Step 3 — uSpec generates documentation:**
It renders Figma frames showing:
- Anatomy diagram with numbered markers pointing to "Submit" text and "Arrow Right" icon
- Property table listing variant axes (Style, State, Size), boolean props (Disabled, Show Icon)
- Color tokens per variant/state
- Dimensional spec (padding, gap, border-radius)

**uSpec never determines that this node IS a button.** It documents whatever the user pointed to. If the user pointed to the Input Field instead, uSpec would document that with the same workflow — it has no opinion on what the component is.

---

### Side-by-Side Summary

| Step | FigmaToCode | uSpec |
|------|------------|-------|
| **1. Find the button** | Automatic — walker finds it by name (`/^button\b/i`) or visual shape (h≤64, horizontal, 1-3 children, has text) | Manual — user must provide the Figma link to the button component |
| **2. Classify it** | Returns `formRole: "button"` | N/A — doesn't classify the component type, only its internal children (`text`, `instance`) |
| **3. Understand its structure** | Extracts `componentProperties`, groups by structural fingerprint, identifies representative node | Runs Plugin API scripts to extract children, boolean bindings, variable tokens, dimensional data |
| **4. Handle variants** | Extracts all variant styles (colors, borders, padding per state) and generates CVA compound variants | Documents variant axes and generates comparison tables showing what changes per state |
| **5. Output** | `button.tsx` (functional React component with CVA variants) + `Button.jsx` (consumer) | Figma annotation frames (anatomy diagram, property table, color tokens, dimensions) |
| **6. Works on plain FRAMEs?** | Yes — visual heuristics detect button-shaped FRAMEs even without a component library | No — requires a proper COMPONENT_SET; plain FRAMEs are classified as `structural` or `container` |

---

## Component Identification & Classification

### Our Pipeline — Multi-Layer Detection

We use a **three-pass heuristic system** that operates on Figma node trees without requiring the user to identify components:

#### Pass 1: Name-Based Pattern Matching
- **25 regex patterns** in `COMPONENT_PATTERNS` (`src/figma/component-discovery.ts:18–44`)
- Maps node names to `formRole` strings (e.g., `/input\s*field|text\s*field/i` → `textInput`)
- Works for both INSTANCE and FRAME nodes
- Covers: buttons, inputs, textareas, selects, checkboxes, radios, toggles, chips, avatars, tooltips, sliders, pagination, tabs, dialogs, toasts, calendars, forms, cards, breadcrumbs, steppers

#### Pass 2: Visual Heuristics
When names don't match, dimensional/structural analysis kicks in (`matchVisualHeuristic()`, lines 296–351):

| Detection | Criteria |
|-----------|----------|
| **Button** | h ≤ 64px, horizontal layout, 1–3 children, has TEXT child |
| **Text Input** | Horizontal, has border, wider than tall, has TEXT, h ≤ 64px |
| **Checkbox** | Horizontal, h ≤ 40px, has TEXT, has small square child (≤28×28) |
| **Toggle** | h ≤ 40px, w ≤ 80px, aspect ratio 1.5–2.5:1, has circle child |
| **Chip/Badge** | Horizontal, h ≤ 36px, border-radius ≥ 40% height, has TEXT |
| **Avatar** | Square (±4px), ≤56×56, has image fill OR single short TEXT (≤3 chars) |

#### Pass 3: Property Inference
For INSTANCE nodes from COMPONENT_SETs that don't match names/visuals (`inferFormRoleFromProperties()`, lines 183–240):
- Inspects `componentProperties` for signals like `Checked`, `Open`, `Placeholder`, `Disabled`
- Returns: `checkbox` (Checked/Selected), `select` (Open/Expanded), `textInput` (Placeholder), `button` (Disabled + Type/Size)

#### Additional: Frame-Based Widget Detection
For plain FRAMEs (not INSTANCE nodes), `detectFrameBasedWidget()` applies name patterns + visual heuristics with a **container exclusion set** (`form`, `card`, `dialog`, `toast`, `tab`, `stepper`) to avoid stopping recursion at structural wrappers.

#### Additional: Chart Detection
Two-phase detection (`src/figma/chart-detection.ts`):
1. **Semantic name scoring** — weighted token matching (chart/graph/pie/axis positive, form/nav/button negative)
2. **Geometric heuristics** — overlapping ellipses (pie), evenly-spaced text (axes), parallel lines (grid)

---

### uSpec — Deterministic Type-Based Classification

uSpec does **not** detect what type of component a node is. Instead, it classifies the **internal elements** of a known component:

| Classification | Rule |
|---|---|
| `instance` | Direct child with Figma `type === 'INSTANCE'` |
| `instance-unwrapped` | FRAME/GROUP wrapping a single INSTANCE descendant (slot wrapper) |
| `text` | Node with `type === 'TEXT'` |
| `container` | FRAME/GROUP with multiple children |
| `structural` | RECTANGLE, VECTOR, ELLIPSE, LINE, etc., or empty FRAME |

**Key heuristics:**
- **Slot-wrapper unwrapping**: If a FRAME contains only a single INSTANCE descendant (through nested wrappers), it's classified as `instance-unwrapped` and the inner component's name replaces the wrapper
- **Section eligibility**: `instance` and `instance-unwrapped` nodes get their own anatomy sub-section, UNLESS they match utility names ("Spacer", "Divider", "Separator")
- **Boolean binding resolution**: Walks `componentProperties`, extracts node ID suffixes, matches layer names to elements → produces `controlledByBoolean: { propName, rawKey, defaultValue }`
- **Variant richness fallback**: If the default variant has ≤1 children, picks the variant with the most children

---

## Figma Data Extraction

| Aspect | Our Pipeline | uSpec |
|--------|------------|-------|
| **Access method** | REST API (`/v1/files/{key}/nodes`) | Figma Console MCP (`figma_execute` Plugin API) |
| **Node properties** | `absoluteBoundingBox`, `size`, `fills`, `strokes`, `cornerRadius`, `layoutMode`, `itemSpacing`, `componentProperties` | Same properties + `absoluteTransform`, variable bindings, style references |
| **Style extraction** | Raw hex from fills/strokes, padding, border, border-radius, gap, font metrics | Variable/token resolution with mode handling |
| **Dimensions** | `absoluteBoundingBox.width/height` or `size.x/y` | `width`, `height` via Plugin API (more reliable) |
| **Layout sizing** | `layoutSizingHorizontal/Vertical`, `layoutGrow`, `layoutAlign` | Same properties via Plugin API |
| **Token resolution** | None — uses raw hex values | Full variable resolution to `{ value, token, display }` tuples |
| **Boolean prop mapping** | Extracts boolean prop definitions but doesn't map to child nodes | Maps boolean props to specific child layers via node ID suffix matching |

---

## Architecture & Pipeline

### Our Pipeline — Three-Path Auto-Routing

```
Any Figma Node
  ├── COMPONENT_SET? ─────────────→ PATH A (variant-aware BEM CSS + LLM)
  │     ├── Chart variants? ──────→ Recharts codegen (deterministic)
  │     └── shadcn supported? ────→ shadcn CVA codegen (LLM)
  ├── Multi-section page? ────────→ PATH C (per-section parallel generation)
  │     ├── Per section: COMPONENT_SET? → PATH A
  │     ├── Per section: Chart? ──→ Recharts codegen
  │     └── Per section: Regular? → Component discovery → shadcn sub-components
  ├── Chart? ─────────────────────→ Recharts codegen (deterministic)
  └── Default ────────────────────→ PATH B (single component LLM)
        └── Has shadcn children? ─→ Composite: shadcn sub-components + layout
```

### uSpec — User-Invoked Skills

```
User provides component link
  └── User invokes a skill:
        ├── create-anatomy → Element classification + marker rendering
        ├── create-property → API property extraction + documentation
        ├── create-color → Color token extraction + annotation
        ├── create-structure → Dimensional extraction + cross-variant comparison
        ├── create-voice → Accessibility spec (VoiceOver, TalkBack, ARIA)
        ├── create-interaction → Interaction pattern documentation
        └── create-screen-reader → Screen reader announcement tables
```

---

## Pros and Cons

### FigmaToCode (Our Pipeline)

| | Detail |
|---|---|
| **PRO: Fully autonomous** | Give it any Figma URL — a page, a frame, a component set — and it finds, classifies, and generates code for every component inside. No human guidance needed to identify what's a button vs. an input vs. a checkbox. |
| **PRO: Works on plain FRAMEs** | Designs that don't use a component library (plain FRAMEs, no INSTANCE nodes) are still detected via visual heuristics — dimensional analysis, border detection, child structure matching. This covers prototypes, one-off pages, and early-stage designs. |
| **PRO: Multi-fallback detection** | Three detection layers (name regex → visual heuristics → property inference) mean if one fails, another catches it. A button named "CTA Primary" fails the visual check but passes the name check. An unnamed button-shaped FRAME fails name matching but passes visual heuristics. |
| **PRO: End-to-end code output** | Produces functional, interactive React/Vue/Svelte/Angular/Solid components with scoped CSS, asset exports, variant support (CVA), and optional wiring into a starter app. Not just documentation — actual shippable code. |
| **PRO: Multi-path pipeline** | Automatically routes COMPONENT_SETs to variant-aware generation, multi-section pages to parallel per-section processing, charts to Recharts codegen, and single nodes to LLM-driven generation. No manual path selection needed. |
| **PRO: Chart detection** | Two-phase detection (semantic name scoring + geometric heuristics) identifies pie, bar, line, and area charts and generates Recharts components deterministically — no LLM needed for chart code. |
| **PRO: shadcn integration** | Detected UI primitives (buttons, inputs, checkboxes, selects, etc.) are routed through shadcn/ui base templates and customized with CVA variants extracted from Figma state data. Output follows established component library patterns. |
| **CON: Fragile on unconventional designs** | A button styled as a 300×200px card with complex nested content would fail all visual heuristics. The system has no way to understand "this looks like a button" beyond fixed dimensional rules. |
| **CON: No visual/pixel understanding** | Cannot "see" the rendered design. A rounded purple rectangle with white "Submit" text is obviously a button to a human, but our system only sees node dimensions and types — not colors, shapes, or visual context. |
| **CON: Name-dependent for ~70% of cases** | Regex name matching handles the majority of real-world cases, but requires designers to follow naming conventions ("Button", "Input Field", etc.). Randomly named nodes fall through to heuristics which only cover common patterns. |
| **CON: No design token resolution** | Extracts raw hex values (`#4432BF`) from fills/strokes instead of resolving Figma variables to design token names (`--color-primary`). Generated code uses hardcoded colors. |
| **CON: No boolean-to-layer mapping** | Extracts boolean property definitions (e.g., `Show Icon: true`) but doesn't trace which specific child layer each boolean controls. The LLM must infer this from the structure tree. |
| **CON: Mixed extraction + LLM** | Deterministic extraction (styles, dimensions, structure) and LLM reasoning (code generation, layout interpretation) are interleaved. LLM sometimes hallucinates dimensions or drops extracted values because the separation isn't clean. |
| **CON: No semantic grouping** | Cannot infer "these 3 radio buttons form a question group" or "these 4 inputs are a form section" from layout proximity or visual context. |

### uSpec

| | Detail |
|---|---|
| **PRO: Deep internal extraction** | Once pointed to a component, extracts exhaustive internal detail — slot-wrapper unwrapping, boolean binding resolution (maps toggle props to specific child layers), variable/token resolution (design tokens, not raw hex), and dimensional data with cross-variant comparison. |
| **PRO: Two-tier model** | Clean separation between Tier 1 (deterministic Plugin API scripts that extract measurements, tokens, hierarchy — zero LLM involvement) and Tier 2 (LLM reasoning for documentation structure and design intent). This minimizes hallucination for factual data. |
| **PRO: Variable/token resolution** | Resolves Figma variable bindings to `{ value, token, display }` tuples including mode handling (light/dark). Documentation uses design token names, not raw hex values. |
| **PRO: Cross-variant comparison** | Compares dimensional values across all variants to identify exactly which properties change per state. This produces precise documentation showing only the deltas — not redundant repeated values. |
| **PRO: Multi-platform accessibility** | Generates iOS VoiceOver, Android TalkBack, and Web ARIA specs from a single component — covering role, label, traits, actions, and announcement patterns per platform. |
| **PRO: Boolean binding resolution** | Walks `componentProperties`, extracts node ID suffixes, and matches them to layer names — producing exact `controlledByBoolean: { propName, rawKey, defaultValue }` mappings per element. Knows which child disappears when `Show Icon` is false. |
| **PRO: Slot-wrapper unwrapping** | Detects the common Figma pattern where a FRAME wraps a single INSTANCE (icon/button slot) and reclassifies it using the inner component's name. Reduces noise in anatomy output. |
| **CON: No component identification** | Cannot take an arbitrary Figma page and find components. The user must manually navigate to and select every component they want to document. On a page with 15 components, the user must invoke uSpec 15 times. |
| **CON: No code generation** | Output is Figma documentation frames — anatomy diagrams, property tables, color token maps, dimensional specs. There is no path from uSpec output to runnable application code. A developer still must manually implement the component. |
| **CON: Requires Figma Desktop + MCP** | Cannot work with the Figma REST API alone. Requires the Figma Desktop app running with the Console MCP WebSocket bridge plugin — adding setup complexity and limiting CI/CD integration. |
| **CON: Requires well-structured components** | Depends on proper COMPONENT_SET structure with variant axes, boolean properties, and named layers. Poorly organized Figma files (flat structures, unnamed layers, no component sets) produce poor documentation. |
| **CON: No plain FRAME support** | Classification is purely by `node.type`. A plain FRAME used as a button is classified as `structural` or `container` — never as a button. Only INSTANCE nodes from component libraries are recognized as meaningful elements. |
| **CON: One component at a time** | Each invocation documents one component. There is no batch mode, no page-level processing, no automatic discovery of "document all components on this page." |
| **CON: No visual heuristics** | Has no dimensional analysis, no border detection, no aspect ratio checks. Cannot identify what a node is by how it's shaped — relies entirely on Figma's type system and the user's identification. |
| **CON: No semantic grouping** | Same as FigmaToCode — cannot infer relationships between sibling components (radio groups, form sections, tab sets) from layout or proximity. |

### Shared Limitations

| Gap | Impact |
|-----|--------|
| **No ML-based visual recognition** | Neither system can identify a button by how it looks — both rely on naming conventions or Figma node types |
| **Assumes well-structured Figma** | Both break down with poorly named/organized Figma files |
| **No semantic grouping** | Neither can infer "these 3 radio buttons form a question group" from layout proximity |
| **No design intent inference** | Can't determine if a card is clickable vs. static without explicit Figma properties |

---

## Transferable Ideas from uSpec

### 1. Slot-Wrapper Unwrapping
**What**: When a FRAME/GROUP wraps a single INSTANCE descendant, treat it as the inner component.
**Why**: Common Figma pattern for icon/button slots. Would improve our component discovery accuracy.
**Effort**: Low — add check in `walkForComponents()`.

### 2. Boolean Binding Resolution
**What**: Map boolean `componentProperties` to specific child layers using node ID suffixes.
**Why**: Would let us understand which parts of a component are optional/toggleable, improving generated prop interfaces.
**Effort**: Medium — requires parsing Figma's `#nodeId` property key format.

### 3. Two-Tier Extraction Model
**What**: Strictly separate deterministic extraction (Tier 1) from LLM reasoning (Tier 2).
**Why**: Reduces LLM hallucination risk for structural/dimensional data.
**Effort**: Medium — would require refactoring our style extraction and prompt assembly.

### 4. Variable/Token Resolution
**What**: Resolve Figma variable bindings to design token names instead of raw hex values.
**Why**: Generated code could use CSS variables or theme tokens instead of hardcoded colors.
**Effort**: High — requires variable API access and mode resolution logic.

### 5. Cross-Variant Dimensional Comparison
**What**: Compare values across variants to identify which properties change per state.
**Why**: Would let us generate more accurate CVA compound variants — only including properties that actually differ.
**Effort**: Medium — partial implementation exists in our `extractVariantStyles()`.

---

## Verdict: Which System Has Better Component Identification?

**FigmaToCode wins on component identification — uSpec doesn't compete in this category.**

| Criteria | FigmaToCode | uSpec |
|----------|------------|-------|
| Can identify a button from an arbitrary page? | Yes | No |
| Can identify an input from an arbitrary page? | Yes | No |
| Can distinguish button vs input vs checkbox? | Yes — via name, shape, and property signals | No — classifies all as `instance` regardless of what they are |
| Works without user guidance? | Yes — fully autonomous | No — requires user to point to the exact component |
| Works on plain FRAMEs (no component library)? | Yes — visual heuristics (dimensions, borders, child structure) | No — plain FRAMEs are just `structural` or `container` |
| Handles poorly named nodes? | Partially — falls back to visual heuristics and property inference | N/A — never reads node names for identification |
| Can process an entire page at once? | Yes — walks the full tree, finds all components | No — one user-selected component at a time |

### Why FigmaToCode's Approach Is Stronger

1. **It actually solves the identification problem.** uSpec delegates identification to the human. Our pipeline does the work of figuring out "this 44×120px horizontal frame with text and an icon is a button" — which is the hard part of design-to-code conversion.

2. **Three fallback layers create resilience.** If the designer named a button "CTA Primary" (no "button" in the name), Pass 1 still catches it via `/cta\b/i`. If they named it "Action Block", Pass 1 fails but Pass 2 detects it by shape (h≤64, horizontal, 1-3 children, has text). If it's a COMPONENT_SET instance with `Disabled` and `Type` properties, Pass 3 infers `button`. uSpec has zero fallback — it doesn't attempt identification at all.

3. **Frame-based detection is unique.** Many Figma designs (especially prototypes or one-off pages) use plain FRAMEs instead of component instances. Our pipeline can still detect these as buttons, inputs, checkboxes via dimensional/structural analysis. uSpec can only work with proper COMPONENT_SET structures.

### Where FigmaToCode's Approach Is Weaker

1. **Fragile on unconventional designs.** A button styled as a full-width card (300×200px with complex children) would fail all visual heuristics and might not match name patterns. Our system has no way to understand design intent beyond names and measurements.

2. **No visual/pixel-level understanding.** Neither system uses ML vision to "look at" a component and recognize it the way a human would. A rounded purple rectangle with white text screams "button" to a human, but our system can only see dimensions and node types — not the visual gestalt.

3. **Name dependency.** Pass 1 (regex matching) handles ~70% of real-world cases, but requires designers to follow reasonable naming conventions. Completely unnamed or randomly named nodes fall through to visual heuristics, which cover common patterns but not edge cases.

### Where uSpec's Approach Is Stronger (Different Problem)

uSpec doesn't try to identify components, but it excels at **understanding component internals** once the user points to one:

1. **Slot-wrapper unwrapping** — detects FRAME→single INSTANCE nesting patterns that our pipeline misses
2. **Boolean binding resolution** — maps toggle props to specific child layers, which we don't do
3. **Variable/token resolution** — resolves design tokens instead of raw hex values
4. **Cross-variant dimensional comparison** — identifies exactly which properties change per state

These are post-identification capabilities that would complement our detection system if adopted.

---

## Conclusion

**For component identification specifically, FigmaToCode is categorically better** — it's the only system of the two that actually does it. uSpec deliberately avoids identification by making the user do it, which is a valid design choice for a documentation tool but means it has no identification logic to evaluate.

**For component understanding (post-identification)**, uSpec has deeper extraction capabilities — slot-wrapper detection, boolean binding resolution, token resolution, and cross-variant comparison. These are areas where our pipeline could improve.

The most impactful improvements we could adopt from uSpec are **slot-wrapper unwrapping** (low effort, immediate accuracy gain) and **boolean binding resolution** (medium effort, better prop interfaces). Their two-tier extraction model is architecturally sound and worth aspiring to as we evolve our pipeline.
