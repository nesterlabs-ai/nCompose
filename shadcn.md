# shadcn/ui Integration — Implementation Plan (Option A: Starter Template)

## Overview

When a Figma component is recognized as a shadcn-supported type (button, input, select, etc.), the pipeline uses an LLM-driven codegen path that:

1. **Detects** the component type from Figma (deterministic — regex/heuristics)
2. **Reads** the base shadcn component source from the local starter template on disk (`src/figma-to-code-starter-main/src/components/ui/{name}.tsx`)
3. **Extracts** exact Figma design data (colors, padding, radius, shadows per variant/state)
4. **Sends both** to the LLM, which customizes the shadcn component with Figma styles
5. **Outputs two files**: a customized shadcn component (.tsx) and a consumer component (.jsx)
6. **Previews** all variant × size × state combinations in a grid

**Source approach**: Read base shadcn component files from the starter template that ships with the tool. No network requests, no registry API, no npx commands. Fast and offline-capable.

---

## Why Option A (Starter Template)

| Option | How it works | Pros | Cons |
|--------|-------------|------|------|
| **A (chosen)** | Read from starter template files on disk | No network needed, fast, works offline | Files must exist locally |
| B | Fetch from shadcn registry API at runtime | Always latest | Needs internet, latency |
| C | Run `npx shadcn add button` at runtime | Guaranteed correct output | Slow (~5-10s per component), needs npx |
| D | LLM generates from scratch | No dependency on anything | LLM output may vary from official source |
| E | User provides their own component | Matches user's exact setup | Extra input required from user |

Option A is chosen because:
- The starter template (`figma-to-code-starter-main`) already ships with the tool
- No network dependency = faster, more reliable
- shadcn components are stable — the local copy is sufficient
- New components can be added to the starter template as needed

---

## User Flow

```
Step 1:  User pastes Figma link → clicks Convert

Step 2:  Pipeline fetches Figma data (Figma REST API)
         - Gets component tree, variant axes, fills, padding, radius, effects

Step 3:  Detects COMPONENT_SET → parses variants
         - Example: Style(3) × State(5) × Size(2) = 30 variants

Step 4:  Detects component category (deterministic regex on node name)
         - "ButtonDanger" → category: "button" → formRole: "button"

Step 5:  isShadcnSupported("button") → true

Step 6:  getShadcnComponentType("button") → "button"

Step 7:  readShadcnSource("button")
         → Reads src/figma-to-code-starter-main/src/components/ui/button.tsx
         → Returns the base shadcn button source (CVA, forwardRef, cn())
         → Instant, no network needed

Step 8:  Extracts Figma styles per variant (all 30)
         - Primary/Default  → bg: #F04E4C, text: #FDE9E9
         - Primary/Hover    → bg: #BD1B19
         - Subtle/Default   → text: #EC221F
         - Neutral/Disabled → bg: #DBDBDB, text: #A6A6A6
         - ...etc for all style × state combinations

Step 9:  Builds LLM prompt (automatic, internal)
         - System prompt: rules for CVA structure, state handling, output format
         - User prompt: Figma axes + per-variant styles + per-state styles + base shadcn source

Step 10: LLM generates TWO files
         - button.tsx       → base shadcn source + Figma CVA variants/sizes/states + compoundVariants
         - Buttondanger.jsx → consumer component that imports from @/components/ui/button

Step 11: Pipeline parses LLM output → extracts 2 code blocks

Step 12: Preview renders all 30 variants in grid
         - 3 styles × 2 sizes × 5 states
         - Each with exact Figma hex colors
         - States rendered statically via `state` CVA prop (no CSS pseudo-classes)

Step 13: Wired template copies files to starter app
         - button.tsx         → app/src/components/ui/button.tsx
         - Buttondanger.jsx   → app/src/components/Buttondanger.jsx
```

User does nothing extra — just pastes the Figma link. Steps 5–11 happen automatically in ~10 seconds.

---

## Architecture

```
Figma Node → discoverComponents() → formRole assigned
  ├─ "chart"              → chart-codegen.ts         (existing, unchanged)
  ├─ shadcn supported     → shadcn-codegen.ts        (read from starter + LLM)
  └─ else                 → LLM + Mitosis            (existing fallback)
```

### Three-Way Pipeline

| Path | Trigger | How it works |
|------|---------|-------------|
| **Chart** | `formRole === "chart"` | Deterministic codegen (no LLM) |
| **shadcn** | `isShadcnSupported(formRole)` + `templateMode` | Read base from starter template → LLM customizes with Figma styles |
| **Generic** | Everything else | LLM generates Mitosis .lite.tsx → compiled to all frameworks |

---

## Starter Template: Required Component Files

The base shadcn component files must exist in `src/figma-to-code-starter-main/src/components/ui/`.

**Already present:**
- `button.tsx` — Button with CVA variants
- `card.tsx` — Card component

**Need to add:**
- `input.tsx` — Input component
- `badge.tsx` — Badge component
- `label.tsx` — Label component (used by input/checkbox)
- `select.tsx` — Select with Trigger/Content/Item
- `checkbox.tsx` — Checkbox component
- `switch.tsx` — Switch/Toggle component
- `avatar.tsx` — Avatar with Image/Fallback
- `tabs.tsx` — Tabs with List/Trigger/Content
- `textarea.tsx` — Textarea component

These are standard shadcn/ui component files (~20-60 lines each). They ship with the tool and serve as the base that the LLM customizes with Figma styles.

---

## Implementation Phases

### Phase 1: Core Infrastructure (3 new files)

#### 1A. `src/shadcn/shadcn-types.ts` — Component Type Mapping

Simple mapping from `formRole` / `ComponentCategory` to shadcn component name.

```typescript
const FORM_ROLE_TO_SHADCN: Record<string, string> = {
  button: 'button',
  textInput: 'input',
  chip: 'badge',
  select: 'select',
  checkbox: 'checkbox',
  toggle: 'switch',
  avatar: 'avatar',
  tab: 'tabs',
  card: 'card',
};

export function isShadcnSupported(formRole: string): boolean { ... }
export function getShadcnComponentType(formRole: string): string | undefined { ... }
```

Also includes `ShadcnCodegenResult` interface for the two-file output.

#### 1B. `src/shadcn/shadcn-source-reader.ts` — Local File Reader

Reads base shadcn component source from the starter template on disk.

```
readShadcnSource("button")
  1. Build path: src/figma-to-code-starter-main/src/components/ui/button.tsx
  2. Read file → return source string
  3. If file doesn't exist → throw error, pipeline falls back to generic LLM path
```

Features:
- In-memory cache (avoid re-reading same file in one pipeline run)
- Simple `readFileSync` — no network, no async needed
- `clearSourceCache()` for testing

#### 1C. `src/shadcn/style-extractor.ts` — Figma Style Extraction

Extracts raw style data from ALL Figma variant nodes (not just Default state).

Returns:
- `byVariant` — styles per Style axis value (Primary, Subtle, Neutral) for State=Default
- `bySize` — styles per Size axis value (Medium, Small) for State=Default
- `byVariantState` — styles per Style×State combination (Primary|Hover, Subtle|Focus, etc.)

Each entry contains: bg color (hex), text color, padding, borderRadius, fontSize, fontWeight, border, shadow, gap, dimensions, opacity.

#### 1D. `src/shadcn/content-extractor.ts` — Content Extraction

Extracts labels, placeholders, helper texts, icons, options from Figma nodes.

- Walks node tree, classifies TEXT nodes by name heuristics
- Returns: `label`, `placeholder`, `helperText`, `options[]`, `booleanProps`, `allTexts[]`

### Phase 2: LLM Prompt + Codegen (2 files)

#### 2A. `src/shadcn/shadcn-prompt-builder.ts` — Prompt Construction

Builds system + user prompts for the LLM.

**System prompt tells LLM to:**
- Take the base shadcn source (from starter template) and ADD new CVA variants matching Figma
- Keep all existing shadcn variants intact
- Use exact hex colors as Tailwind arbitrary values (`bg-[#F04E4C]`)
- Add `state` as a CVA variant axis with `compoundVariants` for each style×state combo
- NOT use `hover:` CSS pseudo-classes (all states must be explicit for static preview)
- Output TWO fenced code blocks (shadcn .tsx + consumer .jsx)

**User prompt includes:**
- Figma variant axes (Style, Size)
- Per-variant styles (State=Default) with exact hex colors
- Per-state styles (Hover, Focus, Disabled, Loading) for compoundVariants
- Extracted content (label, placeholder, icons)
- Boolean properties (Show Left Icon, Show Right Icon)
- The base shadcn source from starter template to customize

#### 2B. `src/shadcn/shadcn-codegen.ts` — Orchestrator

Two entry points:
- `generateShadcnComponentSet()` — for COMPONENT_SET nodes (PATH A)
- `generateShadcnSingleComponent()` — for single INSTANCE nodes (PATH 1/2)

Flow:
```
1. getShadcnComponentType(formRole) → "button"
2. readShadcnSource("button") → base source from starter template (instant)
3. extractVariantStyles(rootNode) → per-variant Figma styles
4. extractComponentContent(node, formRole) → labels, icons
5. buildShadcnSystemPrompt() + buildShadcnUserPrompt({...}) → prompts
6. llm.generate(userPrompt, systemPrompt) → raw LLM response
7. parseTwoCodeBlocks(response) → { shadcnSource, consumerCode }
8. Return both files
```

Retry logic: if LLM output can't be parsed (missing code blocks), retry once with explicit instruction.

### Phase 3: Pipeline Integration (4 files to modify)

#### 3A. `src/types/index.ts` — Add shadcn fields to ConversionResult

```typescript
interface ConversionResult {
  // ... existing fields ...
  updatedShadcnSource?: string;    // LLM-generated shadcn .tsx
  shadcnComponentName?: string;    // e.g. "button"
}
```

#### 3B. `src/convert.ts` — PATH A Intercept

Inside the `isComponentSet()` block, after the chart check but before `convertComponentSet()`:

```typescript
if (options.templateMode) {
  const category = detectComponentCategory(rootNode.name);
  if (isShadcnSupported(category)) {
    // shadcn codegen path
    const result = await generateShadcnComponentSet(rootNode, category, componentSetData, name, llm);
    return { ...result, componentPropertyDefinitions, variantMetadata };
  }
}
// Fall through to standard convertComponentSet
```

Graceful fallback: if shadcn codegen throws, log warning and fall through to standard LLM path.

#### 3C. `src/compile/component-gen.ts` — PATH 1/2 Intercept

In `generateCompoundSection()`, add a third bucket alongside chart and UI:

```typescript
const shadcnComps = uiComps.filter(c => templateMode && isShadcnSupported(c.formRole));
const genericComps = uiComps.filter(c => !(templateMode && isShadcnSupported(c.formRole)));
```

shadcn components generated via `generateShadcnSingleComponent()`, stored in `componentCache`.

#### 3D. `src/web/server.ts` — SSE Event Data

Include in the `complete` SSE event:
- `updatedShadcnSource` — LLM-generated shadcn component source
- `shadcnComponentName` — component file name (e.g., "button")
- `componentPropertyDefinitions` — already included

### Phase 4: Preview + Wired Template (3 files to modify)

#### 4A. `src/web/public/app.js` — WebContainer Preview

Add shadcn file to WebContainer tree:
```javascript
if (updatedShadcnSource && shadcnComponentName) {
  files[`src/components/ui/${shadcnComponentName}.tsx`] = updatedShadcnSource;
}
```

**Update `buildVariantGridApp()`** to:
- Accept `componentPropertyDefinitions` from Figma metadata
- Read variant/size/state options from `componentPropertyDefinitions` (not regex on code)
- Render full grid: rows = styles, columns = states, each cell shows all sizes
- Pass `state` prop to each component instance

#### 4B. `src/template/wire-into-starter.ts` — Wired Template

- When shadcn result is present, copy `updatedShadcnSource` to `app/src/components/ui/{name}.tsx`
- Update state mapping: pass `state: "hover"` (string prop) instead of `hover: true` (boolean)
- Add `updatedShadcnSource` and `shadcnComponentName` to `WireIntoStarterOptions`

#### 4C. `src/preview/setup-preview.ts` — Preview State Fix

Same state mapping fix as wire-into-starter: `stateValueToProps()` should return `{ state: "hover" }` instead of `{ hover: true }`.

### Phase 5: Add Missing Starter Template Components

Add standard shadcn/ui component source files to `src/figma-to-code-starter-main/src/components/ui/`:

- `input.tsx` — standard shadcn Input
- `badge.tsx` — standard shadcn Badge with CVA variants
- `label.tsx` — standard shadcn Label
- `select.tsx` — shadcn Select (Trigger, Content, Item, etc.)
- `checkbox.tsx` — shadcn Checkbox
- `switch.tsx` — shadcn Switch
- `avatar.tsx` — shadcn Avatar (Image, Fallback)
- `tabs.tsx` — shadcn Tabs (List, Trigger, Content)
- `textarea.tsx` — shadcn Textarea

Each file is ~20-60 lines of standard shadcn source. These are the base that the LLM customizes.

---

## Files Summary

| Action | File | Description |
|--------|------|-------------|
| **Create** | `src/shadcn/shadcn-types.ts` | formRole → shadcn name mapping + types (~70 lines) |
| **Create** | `src/shadcn/shadcn-source-reader.ts` | Reads from starter template on disk (~50 lines) |
| **Create** | `src/shadcn/style-extractor.ts` | Extracts ALL variant/state styles from Figma nodes (~250 lines) |
| **Create** | `src/shadcn/content-extractor.ts` | Extracts labels, placeholders, icons (~180 lines) |
| **Create** | `src/shadcn/shadcn-prompt-builder.ts` | System + user prompt construction (~120 lines) |
| **Create** | `src/shadcn/shadcn-codegen.ts` | Orchestrator: read source → extract → prompt → LLM → parse (~170 lines) |
| **Modify** | `src/types/index.ts` | Add `updatedShadcnSource`, `shadcnComponentName` to ConversionResult |
| **Modify** | `src/convert.ts` | shadcn intercept in PATH A (COMPONENT_SET) |
| **Modify** | `src/compile/component-gen.ts` | shadcn intercept in PATH 1/2 (compound sections) |
| **Modify** | `src/web/server.ts` | Add shadcn fields to SSE complete event |
| **Modify** | `src/web/public/app.js` | Add shadcn file to WebContainer tree + variant grid |
| **Modify** | `src/template/wire-into-starter.ts` | Copy shadcn .tsx + fix state mapping |
| **Modify** | `src/preview/setup-preview.ts` | Fix state mapping |
| **Add** | `src/figma-to-code-starter-main/src/components/ui/input.tsx` | shadcn Input base |
| **Add** | `src/figma-to-code-starter-main/src/components/ui/badge.tsx` | shadcn Badge base |
| **Add** | `src/figma-to-code-starter-main/src/components/ui/label.tsx` | shadcn Label base |
| **Add** | More ui/ files as needed (select, checkbox, switch, avatar, tabs, textarea) |

---

## Dependency Graph

```
Phase 1A (shadcn-types)          ─┐
Phase 1B (shadcn-source-reader)  ─┤
Phase 1C (style-extractor)       ─┼─→ Phase 2 (prompt + codegen) ─→ Phase 3 (pipeline) ─→ Phase 4 (preview) ─→ Phase 5 (add ui files)
Phase 1D (content-extractor)     ─┘
```

Phase 1A, 1B, 1C, 1D are fully independent and can be built in parallel.

---

## Supported Component Types

| formRole / category | shadcn Type | Starter Template Path |
|---------------------|-------------|-----------------------|
| `button` | button | `ui/button.tsx` (exists) |
| `textInput` / `input` | input | `ui/input.tsx` (to add) |
| `chip` / `badge` | badge | `ui/badge.tsx` (to add) |
| `select` | select | `ui/select.tsx` (to add) |
| `checkbox` | checkbox | `ui/checkbox.tsx` (to add) |
| `toggle` / `switch` | switch | `ui/switch.tsx` (to add) |
| `avatar` | avatar | `ui/avatar.tsx` (to add) |
| `tab` | tabs | `ui/tabs.tsx` (to add) |
| `card` | card | `ui/card.tsx` (exists) |

---

## LLM Output Format

The LLM returns exactly two fenced code blocks:

### Block 1: Updated shadcn component (button.tsx)

```tsx
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva("base classes...", {
  variants: {
    variant: {
      // Original shadcn variants preserved
      default: "bg-primary text-primary-foreground",
      destructive: "bg-destructive text-destructive-foreground",
      // Figma variants added with exact hex colors
      primary: "bg-[#F04E4C] text-[#FDE9E9]",
      subtle: "text-[#EC221F]",
      neutral: "bg-white/60 text-[#EC221F] border border-white",
    },
    size: {
      default: "h-9 px-4 py-2",
      medium: "h-10 px-6 text-sm rounded-lg",
      small: "h-9 px-5 text-sm rounded-lg",
    },
    state: {
      default: "",
      hover: "",
      focus: "",
      disabled: "opacity-50 pointer-events-none",
      loading: "opacity-70 pointer-events-none",
    },
  },
  compoundVariants: [
    { variant: "primary", state: "hover", class: "bg-[#BD1B19]" },
    { variant: "primary", state: "focus", class: "ring-2 ring-[#768494]" },
    { variant: "primary", state: "disabled", class: "bg-[#DBDBDB] text-[#A6A6A6]" },
    // ... one entry per style × state combination
  ],
  defaultVariants: { variant: "primary", size: "medium", state: "default" },
});
```

### Block 2: Consumer component (Buttondanger.jsx)

```jsx
import { Button } from "@/components/ui/button";

export default function Buttondanger({
  variant = "primary",
  size = "medium",
  state = "default",
  label = "Button",
  disabled = false,
  showLeftIcon = true,
  showRightIcon = true,
  children,
  ...props
}) {
  return (
    <Button variant={variant} size={size} state={disabled ? "disabled" : state} disabled={disabled} {...props}>
      {showLeftIcon && <span>...</span>}
      {children ?? label ?? "Button"}
      {showRightIcon && <span>...</span>}
    </Button>
  );
}
```

---

## Preview Grid

The preview renders ALL variant combinations in a grid:

```
BUTTONDANGER — ALL VARIANTS
3 styles × 2 sizes × 5 states = 30 variants

Primary
  Default    Hover      Focus      Disabled   Loading
  [medium]   [medium]   [medium]   [medium]   [medium]
  [small]    [small]    [small]    [small]    [small]

Subtle
  Default    Hover      Focus      Disabled   Loading
  ...

Neutral
  Default    Hover      Focus      Disabled   Loading
  ...
```

Each button renders with the exact Figma colors for that specific style + state combination, displayed statically via the `state` CVA prop (no CSS pseudo-classes needed).

The variant grid reads variant/size/state options from `componentPropertyDefinitions` (Figma metadata passed via SSE), NOT from regex patterns on the generated code. This ensures all variants are always shown regardless of how the LLM structures the consumer component.
