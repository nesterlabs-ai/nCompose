# Issue: "Dropdown" in Node Name Triggers Wrong shadcn Select Codegen

**Priority: High**
**Discovered: 2026-03-17**
**Affected Component: `Dropdown with Columns` (node `9485:1709`)**

---

## Problem

Any Figma node with "dropdown" in its name is misclassified as a `select` component category, causing the pipeline to generate a collapsed `<Select>` (Radix UI) instead of rendering the actual visible UI structure from Figma.

The Figma design for "Dropdown with Columns" is a **multi-select panel with two visible columns, each containing chip tags, a search input, and a scrollable checkbox list** — it is NOT a single-select dropdown widget.

---

## Root Cause

The misclassification happens at **two levels**:

### Level 1: Root node name detection

**File**: `src/figma/component-set-parser.ts:451`

```typescript
[/\bselect\b|\bdropdown\b/, 'select'],
```

The node name `"Dropdown with Columns"` contains `dropdown` → matched to `'select'` category.

**File**: `src/convert.ts:1486-1489`

```typescript
if (options.templateMode) {
  const category = hintedCategory ?? detectComponentCategory(rootNode?.name ?? '');
  if (isShadcnSupported(category)) {  // isShadcnSupported('select') → true
```

This triggers `generateShadcnSingleComponent()` which tries to make the entire component a `<Select>`. It fails (too complex), but the damage continues at Level 2.

### Level 2: Child node name detection during composite discovery

**File**: `src/figma/component-discovery.ts:20`

```typescript
{ pattern: /dropdown\s*field|drop\s*down/i, formRole: 'select' },
```

When the pipeline falls back to composite discovery (`discoverComponents` with `deepRecurse: true`), it walks the children and finds:

- **"Dropdown List of Items"** → matches `/drop\s*down/i` → `formRole: 'select'`
- **"Dropdown Field"** → matches `/dropdown\s*field/i` → `formRole: 'select'`

These child INSTANCE nodes get mapped to shadcn `<Select>` components, replacing the **visible checkbox list rows** with a collapsed select widget.

---

## Evidence: Comparison with Working Component

**`Categories1`** (same Figma file, similar UI structure) generates correctly because:

| | Categories1 | DropdownWithColumns |
|---|---|---|
| Root name | `"Categories1"` | `"Dropdown with Columns"` |
| `detectComponentCategory()` | `'unknown'` (no match) | `'select'` (dropdown matches) |
| shadcn single-select attempted? | No | Yes (fails, falls through) |
| Child list node name | (no "dropdown" in name) | `"Dropdown List of Items"` |
| Child formRole | `'radio'` (correct) | `'select'` (wrong) |
| Generated list UI | Visible `RadioGroupItem` rows | Collapsed `<Select>` |
| **Result** | Faithful to Figma design | Broken — wrong interaction model |

---

## What the Generated Code Gets Wrong

### Expected (from Figma)
- Two visible columns side by side
- Each column: title + "Clear all" button + chip tags + search input + **visible scrollable list of items with checkboxes**
- Items 2-4 have checked checkboxes (purple `#4432BF` fill)
- Items 1,5 have unchecked checkboxes (stroke `#768494`)
- Cancel and Apply buttons at the bottom

### Actual (generated)
- Two columns rendered correctly (layout, colors, chips, search all match)
- **List items replaced with `<Select>` + `<SelectContent>` + `<SelectItem>`** — hidden behind a trigger, single-select, no checkboxes
- Lost: checkbox checked/unchecked states, multi-select behavior, visible item rows, per-item layout

---

## Affected Files

| File | Line(s) | What happens |
|------|---------|--------------|
| `src/figma/component-set-parser.ts` | 451 | `CATEGORY_PATTERNS`: `/\bdropdown\b/` → `'select'` |
| `src/figma/component-discovery.ts` | 20 | `COMPONENT_PATTERNS`: `/dropdown\s*field\|drop\s*down/i` → `'select'` |
| `src/convert.ts` | 1486-1521 | Root category check triggers shadcn single-select path |
| `src/convert.ts` | 1523-1661 | Composite discovery also picks up child "Dropdown" nodes as select |

---

## Suggested Fixes

### Option A: Structural analysis over name matching

Instead of relying solely on node names, analyze the actual Figma structure:
- A collapsed dropdown/select should have: a trigger element, hidden content, single interaction point
- A visible list panel should have: multiple visible child rows, checkboxes/radios, no collapsed trigger
- If the node has visible children with checkboxes → classify as `'list'` or `'checkbox-list'`, not `'select'`

### Option B: Exclude compound/panel names from select detection

Add negative patterns to prevent multi-word names like "Dropdown with Columns" from matching:
```typescript
// Skip if name suggests a compound panel, not a simple select widget
[/\b(dropdown|select)\b(?!.*\b(with|panel|columns|list|multi|group)\b)/i, 'select'],
```

### Option C: Defer classification to composite discovery

When the root node has many children (e.g., > 10 descendants), skip the single-component shadcn path entirely and go straight to composite discovery. Let the leaf nodes (Checkbox Field, Radio Field, Button) determine the shadcn primitives instead of the container name.

### Option D: Two-pass detection

1. First pass: discover all leaf UI primitives (checkbox, radio, button, input)
2. If leaf primitives are found, use composite path regardless of root name
3. Only fall back to single-component shadcn if no leaf primitives are discovered

---

## Reproduction

```bash
# Generates broken output (collapsed Select)
npm run dev -- convert "https://www.figma.com/design/rAim3nrWukuYQQRmYU1L8r/SquareX-Design-System--Copy-?node-id=9485-1709&m=dev" \
  -f react --llm claude --template -o ./web_output

# Generates correct output (visible list with radio buttons)
# (Categories1 node — same design system, similar structure, different name)
npm run dev -- convert "https://www.figma.com/design/rAim3nrWukuYQQRmYU1L8r/SquareX-Design-System--Copy-?node-id=<categories1-node-id>&m=dev" \
  -f react --llm claude --template -o ./web_output
```

---

## Impact

This affects **any Figma component with "dropdown", "select", or "combobox" in the node name** that is actually a visible panel/list rather than a collapsed select widget. Common examples:
- Multi-select panels
- Filter panels with checkboxes
- Dropdown menus rendered as visible lists
- Autocomplete suggestion panels
- Column-based selection UIs
