# Variant Config — Problem & Solution

## Current Scenario

When a Figma COMPONENT_SET (e.g., Button with 40 variants) is converted:

1. Parser extracts all variant styles (colors, padding, borders) into memory
2. LLM generates one component with BEM CSS covering all variants
3. Output saves `meta.json` with only axis names + prop labels
4. **All per-variant visual specs (text, color, border, padding) are thrown away** — not persisted

```
meta.json (what we save today):
{
  "axes": [{ "name": "Style", "values": ["Primary", "Secondary"] }],
  "variants": [{ "name": "Primary, Medium", "props": { "Style": "Primary" } }]
}
// No colors. No text content. No borders. No padding. Nothing visual.
```

## Problem

On visual edit, user says "change Primary button text to Submit" or "change Primary color to red":

1. We don't have per-variant specs stored anywhere
2. We can't tell the LLM "only change this one variant's text/color"
3. LLM gets the full code + user request and regenerates everything
4. **Other variants may drift** — Secondary might lose its border, Neutral text might shift
5. No isolated variant context to send to LLM

The root issue: **we don't know what each variant carries** (its text, color, border, etc.) because we throw that data away after initial generation.

## Solution

Persist a `variant-spec.json` that stores every variant's visual specifications. This becomes the **source of truth** for what each variant looks like.

On visual edit:
1. Read `variant-spec.json`
2. Update only the target variant's spec (e.g., Primary's background)
3. Send updated spec to LLM — LLM regenerates code with the new spec
4. Other variants' specs are unchanged, so LLM keeps them intact
5. Save updated `variant-spec.json`

### How specs are auto-detected (no manual schema)

The algorithm compares all variants from Figma:

```
For each CSS property across ALL variants:
  SAME in all variants   → goes in "base" (shared)
  CHANGES across variants → goes in axis diff (per-variant configurable)
```

This works for any component — Button, Chip, InputField, Toast, Card — without manually defining what's configurable.

### Config structure

```json
{
  "componentName": "Button",
  "base": {
    "container": { "border-radius": "8px", "gap": "8px", "layout": "horizontal" },
    "text": { "font-family": "Host Grotesk", "font-weight": "500", "font-size": "14px" },
    "icon": { "width": "14px", "height": "14px" }
  },
  "axes": {
    "Style": {
      "Primary (Action Violet)": {
        "container": { "background": "#4432BF", "border": "1px solid #000" },
        "text": { "color": "#ECEAF9", "content": "Button" },
        "icon": { "fill": "#ECEAF9" }
      },
      "Secondary (Brand Purple)": {
        "container": { "background": "#B897D9", "border": "none" },
        "text": { "color": "#36204C", "content": "Button" },
        "icon": { "fill": "#36204C" }
      }
    },
    "State": {
      "Default": {},
      "Hover": { "container": { "background-adjustment": "darken(5%)" } },
      "Disabled": { "container": { "opacity": "0.5" }, "text": { "color": "#A6A6A6" } }
    },
    "Size": {
      "Medium": { "container": { "padding": "8px 16px", "height": "40px" } },
      "Small": { "container": { "padding": "6px 12px", "height": "36px" } }
    }
  },
  "properties": {
    "Label": { "type": "text", "default": "Button" },
    "Show Left Icon": { "type": "boolean", "default": true },
    "Show Right Icon": { "type": "boolean", "default": true }
  }
}
```

### Visual edit flow

**Before (no config):**
```
User: "Change Primary text to Submit"
  → No record of what Primary's text is
  → Send full code + request to LLM
  → LLM regenerates all variants
  → Secondary text might accidentally change too
```

**After (with variant-spec.json):**
```
User: "Change Primary text to Submit"
  → Read variant-spec.json
  → Find: axes.Style["Primary"].text.content = "Button"
  → Update to: "Submit"
  → Send updated spec + code to LLM for regeneration
  → LLM knows exactly what changed and what to preserve
  → Only Primary text changes, all other variants intact
  → Save updated variant-spec.json
```

### What's configurable per variant (auto-detected from Figma data)

| Category | Properties |
|----------|-----------|
| **Container** | background, border-color, border-weight, border-radius, padding, gap, opacity, shadow |
| **Text** | color, content, font-family, font-weight, font-size, line-height, letter-spacing |
| **Icons** | size, visibility, fill color |


### Output files

```
output/Button-abc123/
  ├── Button.lite.tsx
  ├── Button.jsx / .vue / .svelte / .ts / .tsx
  ├── Button.meta.json            ← existing (axes + prop names)
  ├── Button.variant-spec.json    ← NEW (full visual specs per variant)
  ├── Button.fidelity.json
  └── assets/
```
