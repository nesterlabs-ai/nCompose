# ButtonDanger — Issues & Figma Comparison

Figma source: `rAim3nrWukuYQQRmYU1L8r` · node `8119-29710`
Generated output: `web_output/ButtonDanger-20260303-200945/`

---

## Issue 1 — Root element is `<div>` instead of `<button>` ❌ Critical

### What the generated code has
```jsx
<div
  className={classes()}
  data-loading={props.loading || undefined}
  disabled={props.disabled || undefined}
>
```

### What it should be
```jsx
<button
  className={classes()}
  type="button"
  disabled={props.disabled || props.loading}
>
```

### Root cause — PascalCase word-boundary bug

`detectComponentCategory()` in `component-set-parser.ts` lowercases the name directly:

```typescript
// BUG — this branch has the unfixed version:
const n = name.toLowerCase();         // "ButtonDanger" → "buttondanger"
pattern.test(n);                       // /\bbutton\b/.test("buttondanger") → FALSE ❌
// → returns 'unknown' → suggestedHtmlTag = 'div'
```

Because `suggestedHtmlTag = 'div'`, the call to `generateWithRetry` passes
`expectedRootTag = 'div'` to `fixRootElement` — which correctly finds a `<div>` root
and makes no change (since the target tag is also `<div>`).

### Cascade of failures from `'unknown'` category

| What breaks | Effect |
|---|---|
| `suggestedHtmlTag = 'div'` | `fixRootElement` is a no-op |
| `componentCategory = 'unknown'` | `validateSemanticElement` skips validation |
| Blueprint not shown | `CATEGORY_BLUEPRINTS['unknown']` doesn't exist |
| Semantic rules missing | LLM gets no hint to use `<button>` |

### Impact
- Missing native button behavior: keyboard Space/Enter does not activate the button
- `disabled` on a `<div>` is **invalid HTML** — the `disabled` attribute only works on
  form elements (`<button>`, `<input>`, `<select>`, etc.)
- Screen readers do not announce it as a button
- CSS `:disabled` pseudo-class will not work (would need the attribute-selector `[disabled]`
  workaround, which is already in the generated CSS but semantically incorrect)

### Fix
Apply the PascalCase normalization to `detectComponentCategory()`:
```typescript
// Fix: split PascalCase before lowercasing
const n = name
  .replace(/([a-z])([A-Z])/g, '$1 $2')  // "ButtonDanger" → "Button Danger"
  .replace(/[-_]+/g, ' ')
  .toLowerCase().trim();
// /\bbutton\b/.test("button danger") → TRUE ✅
```

---

## Issue 2 — `data-loading` vs native `disabled` on `<button>` ❌

When the root is fixed to `<button>`, the JSX should change:

| Attribute | On `<div>` (wrong) | On `<button>` (correct) |
|---|---|---|
| Loading | `data-loading={props.loading \|\| undefined}` | `data-loading={props.loading \|\| undefined}` ✅ keep |
| Disabled | `disabled={props.disabled \|\| undefined}` | `disabled={props.disabled \|\| props.loading}` |

For a `<button>`:
- Use `disabled` as a native boolean attribute — `disabled={props.disabled}`
- CSS should target `:disabled` pseudo-class OR `[disabled]` attribute (both work on `<button>`)
- The generated CSS already uses `[disabled]` selector — this works correctly once on a `<button>`

---

## Issue 3 — Primary/Hover state: `box-shadow` ✅ NOT a bug

**Figma spec (Style=Primary, State=Hover):**
- `background-color: #BD1B19` ✅ in CSS
- `box-shadow: 0px 1px 4px 0px rgba(12, 12, 13, 0.05), 0px 1px 4px 0px rgba(12, 12, 13, 0.1)` — same as Default

**Generated CSS:**
```css
.button-danger--primary {
  background-color: #F04E4C;
  box-shadow: 0px 1px 4px 0px rgba(12, 12, 13, 0.05), 0px 1px 4px 0px rgba(12, 12, 13, 0.1);
}
.button-danger--primary:hover:not([disabled]) {
  background-color: #BD1B19;
  /* box-shadow NOT needed here — cascades from .button-danger--primary above */
}
```

The diff-based CSS generator correctly skips `box-shadow` in the hover rule because it's
identical to the base class value. CSS cascade means `.button-danger--primary`'s shadow
still applies during hover — the hover rule only overrides `background-color`. This is
correct and optimal behaviour.

---

## Issue 4 — Neutral/Hover state: missing white inner border ❌ CSS

**Figma spec (Style=Neutral, State=Hover):**
- `box-shadow: 0px 4px 24px 0px rgba(0, 0, 0, 0.18)` ✅ in CSS
- `backdrop-filter: blur(20px)` ✅ in CSS
- `stroke: #FFFFFF weight=1.5px` (inner border) ❌ missing

**Generated CSS:**
```css
.button-danger--neutral:hover:not([disabled]) {
  box-shadow: 0px 4px 24px 0px rgba(0, 0, 0, 0.18);
  backdrop-filter: blur(20px);
  /* ← missing inner stroke/border */
}
```

**Should be:**
```css
.button-danger--neutral:hover:not([disabled]) {
  box-shadow: 0px 4px 24px 0px rgba(0, 0, 0, 0.18), inset 0 0 0 1.5px #FFFFFF;
  backdrop-filter: blur(20px);
}
```

The `stroke` in Figma maps to an inner `box-shadow` using the `inset` trick. The CSS
generator correctly converts the drop shadow but doesn't handle the stroke → `inset` conversion
for hover states.

---

## Issue 5 — Neutral/Focus state: incorrectly removes `backdrop-filter` ❌ CSS

**Figma spec (Style=Neutral, State=Focus):**
- `fill: rgba(255, 255, 255, 0.6)` — same as Default → no change needed
- `stroke: #768494 weight=2px` → focus ring `box-shadow: 0 0 0 2px #768494`
- `backdrop-filter: blur(30px)` — same as Default → should remain active

**Generated CSS:**
```css
.button-danger--neutral:focus-visible {
  overflow: hidden;
  box-shadow: 0 0 0 2px #768494;
  backdrop-filter: unset;   /* ← WRONG: removes the glassmorphism blur */
}
```

**Should be:**
```css
.button-danger--neutral:focus-visible {
  box-shadow: 0 0 0 2px #768494;
  /* backdrop-filter stays from .button-danger--neutral base */
}
```

The diff-based CSS generator likely saw `backdrop-filter: blur(30px)` in the base
and `backdrop-filter: blur(30px)` in the Focus variant, considered them "equal" at
the individual property level, but then emitted `unset` as the diff — this is a
bug in how the diff logic handles inherited/unchanged properties.

Also `overflow: hidden` on the focus state shouldn't be there — it clips child content
and has no basis in the Figma design.

---

## Summary Table

| # | Issue | Type | Status |
|---|---|---|---|
| 1 | Root `<div>` instead of `<button>` | Code generation (PascalCase bug) | ✅ Fixed — `detectComponentCategory()` normalizes PascalCase |
| 2 | `disabled` on `<div>` is invalid HTML | Consequence of #1 | ✅ Fixed by fixing #1 |
| 3 | Primary/Hover missing `box-shadow` | Not a bug — CSS cascade is correct | ✅ No change needed |
| 4 | Neutral/Hover missing `inset` white border | CSS generation (effects overwrote stroke shadow) | ✅ Fixed — `nodeToCSS` now appends stroke shadow to effects shadow |
| 5 | Neutral/Focus incorrectly removes `backdrop-filter` + adds `overflow: hidden` | CSS generation (state diff logic) | ✅ Fixed — `diffStyles(isStateDiff=true)` skips `overflow` and `backdrop-filter` unset |

---

## Figma vs Generated — Quick Reference

### Default / Subtle (base)
| Property | Figma | Generated | Match? |
|---|---|---|---|
| background | none (transparent) | none | ✅ |
| text color | `#EC221F` | `#EC221F` | ✅ |
| cursor | pointer | `cursor: pointer` | ✅ |
| border-radius | 8px | `border-radius: 8px` | ✅ |

### Primary / Default
| Property | Figma | Generated | Match? |
|---|---|---|---|
| background | `#F04E4C` | `#F04E4C` | ✅ |
| box-shadow | `0px 1px 4px rgba(12,12,13,0.05) + rgba(12,12,13,0.1)` | same | ✅ |
| text color | `#FDE9E9` | `#FDE9E9` | ✅ |

### Primary / Hover
| Property | Figma | Generated | Match? |
|---|---|---|---|
| background | `#BD1B19` | `#BD1B19` | ✅ |
| box-shadow | `0px 1px 4px rgba(12,12,13,0.05) + rgba(12,12,13,0.1)` | missing | ❌ |

### Neutral / Default
| Property | Figma | Generated | Match? |
|---|---|---|---|
| background | `rgba(255,255,255,0.6)` | `rgba(255,255,255,0.6)` | ✅ |
| box-shadow | `0px 8px 20px rgba(0,0,0,0.12)` | `0px 8px 20px 0px rgba(0,0,0,0.12)` | ✅ |
| backdrop-filter | `blur(30px)` | `blur(30px)` | ✅ |

### Neutral / Hover
| Property | Figma | Generated | Match? |
|---|---|---|---|
| box-shadow (drop) | `0px 4px 24px rgba(0,0,0,0.18)` | `0px 4px 24px 0px rgba(0,0,0,0.18)` | ✅ |
| backdrop-filter | `blur(20px)` | `blur(20px)` | ✅ |
| inner border | `inset 0 0 0 1.5px #FFFFFF` | missing | ❌ |

### Neutral / Focus
| Property | Figma | Generated | Match? |
|---|---|---|---|
| focus ring | `stroke #768494 2px` → `box-shadow: 0 0 0 2px #768494` | `box-shadow: 0 0 0 2px #768494` | ✅ |
| backdrop-filter | `blur(30px)` (unchanged from default) | `unset` | ❌ |
| overflow | (not specified) | `overflow: hidden` | ❌ extra |

---

## Root Fix Priority

1. **Fix `detectComponentCategory()` PascalCase bug** (Issues 1 & 2) — same bug that
   existed before the branch switch. Apply the `replace(/([a-z])([A-Z])/g, '$1 $2')`
   normalization to `component-set-parser.ts`. This alone will make the LLM generate
   `<button>` correctly via `fixRootElement` + `validateSemanticElement`.

2. **CSS diff issues** (Issues 3, 4, 5) — these require investigation in the CSS
   diff generation pipeline (`buildVariantCSS()` in `component-set-parser.ts`):
   - Primary/Hover shadow: emit shadow even when value matches default
   - Neutral/Hover stroke: convert Figma `stroke` → CSS `inset` box-shadow in diff
   - Neutral/Focus backdrop-filter: treat `unset` as "remove" only when property
     differs from base, not when it matches
