# PATH B — shadcn Integration

## Context

PATH B (`convertSingleComponent()` in `src/convert.ts`) handles single Figma COMPONENT nodes. When `templateMode` is ON, it currently uses `generateReactDirect()` for ALL components — a generic LLM → React + Tailwind path with no shadcn template guidance. This means recognized components (buttons, inputs, selects, etc.) miss the structural quality that shadcn templates provide.

**Goal**: When `templateMode` is ON and the component is shadcn-supported, use `generateShadcnSingleComponent()` instead. Fall back to `generateReactDirect()` for unrecognized components or on shadcn failure.

**Key insight**: All the building blocks already exist — `generateShadcnSingleComponent()` is fully implemented in `src/shadcn/shadcn-codegen.ts:118-189` but never called. This is purely a wiring task.

---

## What Already Exists (no new code needed)

| Function | File | Status |
|----------|------|--------|
| `generateShadcnSingleComponent()` | `src/shadcn/shadcn-codegen.ts:118` | Implemented, wired in |
| `isShadcnSupported()` | `src/shadcn/shadcn-types.ts` | Imported in convert.ts |
| `detectComponentCategory()` | `src/figma/component-set-parser.ts` | Imported in convert.ts |
| `buildShadcnSingleComponentSystemPrompt()` | `src/shadcn/shadcn-prompt-builder.ts:264` | Implemented |
| `buildShadcnSingleComponentUserPrompt()` | `src/shadcn/shadcn-prompt-builder.ts:316` | Implemented |
| `extractNodeStyle()` | `src/shadcn/style-extractor.ts` | Implemented |
| `extractComponentContent()` | `src/shadcn/content-extractor.ts` | Implemented |
| `readShadcnSource()` | `src/shadcn/shadcn-source-reader.ts` | Implemented |

---

## Changes Made

### 1. Added import in `src/convert.ts`

**Line 55** — added `generateShadcnSingleComponent` to the existing shadcn-codegen import:

```typescript
import { generateShadcnComponentSet, generateShadcnSingleComponent } from './shadcn/shadcn-codegen.js';
```

### 2. Added shadcn intercept in `convertSingleComponent()` templateMode block

**Location**: `src/convert.ts` — inside the `if (options.templateMode)` block, BEFORE the existing `generateReactDirect()` call.

**Pattern**: Matches the existing PATH A intercept at lines 920-988.

```typescript
if (options.templateMode) {
  // shadcn intercept for recognized components
  const category = hintedCategory ?? detectComponentCategory(rootNode?.name ?? '');
  if (isShadcnSupported(category)) {
    try {
      onStep?.(`[shadcn] Detected "${category}" → using shadcn single-component codegen...`);
      const shadcnResult = await generateShadcnSingleComponent(
        rootNode,
        category,
        options.name ?? toPascalCase(rootNode?.name ?? 'Component'),
        llm,
        onStep,
        assets,
        llmYaml,   // pass serialized YAML for structural context
      );

      // React gets consumer code, others get placeholder
      const frameworkOutputs: Record<string, string> = {};
      for (const fw of options.frameworks) {
        frameworkOutputs[fw] = fw === 'react'
          ? shadcnResult.consumerCode
          : `// ${shadcnResult.componentName} — shadcn/ui component (React only).\n`;
      }

      return {
        componentName: shadcnResult.componentName,
        mitosisSource: `// shadcn/ui codegen — see React output.\n${shadcnResult.consumerCode}`,
        frameworkOutputs: frameworkOutputs as Record<Framework, string>,
        assets,
        updatedShadcnSource: shadcnResult.updatedShadcnSource,
        shadcnComponentName: shadcnResult.shadcnComponentName,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onStep?.(`[shadcn] Failed: ${msg} — falling back to React + Tailwind direct`);
      // Fall through to generic React direct path below
    }
  }

  // Fallback: React + Tailwind direct (no shadcn)
  onStep?.(`Generating React + Tailwind component via ${llm.name}...`);
  // ... existing generateReactDirect() code ...
}
```

### 3. No other files needed changes

- `shadcn-codegen.ts` — `generateShadcnSingleComponent()` already exists with correct signature
- `shadcn-prompt-builder.ts` — prompts already exist and were recently improved
- `shadcn-types.ts` — `isShadcnSupported()` already imported in convert.ts
- `output.ts` — already handles `updatedShadcnSource` and `shadcnComponentName` from `ConversionResult`

---

## Flow After Change

```
convertSingleComponent() + templateMode ON:
  ├─ Detect category from node name / semantic hint
  ├─ isShadcnSupported(category)?
  │   ├─ YES → generateShadcnSingleComponent()
  │   │         ├─ readShadcnSource(type)       ← base template from starter
  │   │         ├─ extractNodeStyle(rootNode)    ← Figma styles + COMPONENT TREE
  │   │         ├─ extractComponentContent()     ← labels, placeholders, text
  │   │         ├─ LLM generates two code blocks
  │   │         └─ Return: updated .tsx + consumer .jsx
  │   │
  │   └─ FAIL → catch → fall through to React direct
  │
  └─ NO (or fallback) → generateReactDirect()   ← existing generic path
```

---

## Known Limitation: Composite Components Skip shadcn

**Issue**: Components like "Categories1" (a composite panel with search, chips, category list, radio buttons, and action buttons) go through PATH B but do NOT take the shadcn route. They fall back to `generateReactDirect()`.

**Why**: `detectComponentCategory("Categories1")` returns `'unknown'` because the name doesn't match any pattern in `CATEGORY_PATTERNS` (`src/figma/component-set-parser.ts:445-494`). The patterns only match single-purpose component names like `button`, `input`, `select`, `checkbox`, etc.

**This is by design**: shadcn templates are for **single primitives** — one input, one button, one select. A composite panel that combines search + chips + list + radios + buttons has no single shadcn template to match. The generic React + Tailwind direct path handles these correctly by generating the entire component from the Figma data.

**When shadcn DOES activate in PATH B**: Only when the Figma node name (or semantic hint) matches a recognized category — e.g. "Input Field", "SearchBar", "PrimaryButton", "SelectDropdown", "CheckboxField", etc. The full list of 50+ regex patterns is in `CATEGORY_PATTERNS` at `src/figma/component-set-parser.ts:445-494`, and the shadcn-supported subset (37 types) is in `src/shadcn/shadcn-types.ts`.

### Example: "Categories1" Structural Analysis

"Categories1" is a composite UI panel. Its name gives no hint, but its **Figma child structure** reveals multiple shadcn primitives:

```
Categories1 (root container — card-like: rounded, shadow, backdrop-blur)
├── Section 1: Search bar
│   ├── 🔍 magnifying glass icon
│   └── <input placeholder="Search">
├── Divider line
├── Section 2: Chip filters (2 rows × 3 chips)
│   └── 6× button with "Label" + ✕ close icon
├── Section 3: Category list with radio selection
│   └── "Category" header with caret
│       └── 5× item rows with radio buttons
└── Section 4: Action footer
    ├── Cancel button
    └── Apply button
```

**Sub-component → shadcn template mapping:**

| Section in Categories1 | Nearest shadcn template | Why |
|---|---|---|
| Search bar (icon + input) | `input.tsx` | Text input with icon — matches input template structure |
| Chip filters (Label + ✕) | `badge.tsx` | Small labeled elements with dismiss — badge/chip pattern |
| Category list + radios | `radio.tsx` | Radio group with labels — matches radio template |
| Cancel / Apply buttons | `button.tsx` | Action buttons — matches button template |
| Overall container | `card.tsx` | Rounded container with header/content/footer sections |

**Key insight**: The root name "Categories1" is useless for detection, but walking the Figma child nodes reveals 4-5 recognizable shadcn primitives (`input`, `badge`, `radio`, `button`, `card`). The component name is unreliable — the **child node names and structure** are the real signal.

### Future Improvement Options

1. **Deep child scan**: Walk the Figma node tree, run `detectComponentCategory()` on each child node name. Generate recognized children with shadcn inline, compose them into the parent via React direct. Unrecognized children still use generic Tailwind. Works within PATH B, reuses existing detection logic.

2. **Route to PATH C pipeline**: When a single component has many children (e.g. >5 direct children or >3 detected primitives), treat it like a mini multi-section page. Use PATH C's decompose → generate sub-components → stitch approach.

3. **Enhanced detection heuristics**: Improve `detectComponentCategory()` to also inspect child names, component properties, and structural patterns — not just the root name. If children include nodes named "Search", "Checkbox", "Radio", detect the parent as composite and route sub-components individually to shadcn.

---

## Verification

1. **TypeScript**: `npx tsc --noEmit` passes
2. **Manual test — shadcn path**: Run pipeline with `--template` on a Figma input field / button (single COMPONENT, not COMPONENT_SET) → should see `[shadcn] Detected "input"` in logs, output should have `input.tsx` + consumer `.jsx`
3. **Manual test — fallback path**: Run pipeline with `--template` on a custom/unrecognized component → should fall through to React + Tailwind direct (no `[shadcn]` in logs)
4. **Manual test — shadcn error recovery**: If shadcn codegen fails (e.g. bad LLM output), should see `[shadcn] Failed: ... — falling back` and still produce output via React direct
5. **Existing PATH A unchanged**: Run pipeline on a COMPONENT_SET with `--template` → still uses `generateShadcnComponentSet()` (the PATH A path at line 920)
6. **templateMode OFF unchanged**: Run pipeline without `--template` → uses Mitosis pipeline as before
