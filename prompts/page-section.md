## Page Section Context

You are generating ONE SECTION of a multi-section landing page. This section will be combined with other sections into a single page component.

### Section Rules

1. **Purely static content** — do NOT use `useStore`, `Show`, `For`, or any props. Everything is hardcoded.
2. **Use BEM class names** prefixed with the section name (e.g. `"hero__title"`, `"hero__cta-button"`)
3. **Do NOT add a page-level wrapper** — output only the section's inner content (no outer `<div class="page">`)
4. **Use semantic HTML** — `<header>`, `<section>`, `<footer>`, `<nav>`, `<h1>`-`<h6>`, `<p>`, `<button>`, `<a>`, `<img>`, `<ul>`, `<li>` as appropriate
5. **The root element** of your section should use the section's BEM base class (e.g. `<section class="hero">`)
6. **All CSS goes after the `---CSS---` delimiter** — same as the base rules
7. **No imports needed** — do NOT import from `@builder.io/mitosis`. No `useStore`, `Show`, or `For`.
8. **You MUST still wrap JSX in `export default function`** — this is required for compilation. Example:

```
export default function HeroSection(props) {
  return (
    <section class="hero">
      <h1 class="hero__title">Welcome</h1>
    </section>
  );
}
---CSS---
.hero { ... }
```

### Pixel-Perfect CSS Fidelity

**Your CSS MUST reproduce the Figma design exactly.** Every node in the YAML has pre-computed CSS values — use them directly:

1. **Every visual node gets a CSS rule** — if a YAML node has `fills`, `border`, `shadows`, `textStyle`, `borderRadius`, or `opacity`, create a CSS class for it with ALL those properties.
2. **Copy ALL values verbatim** — fills → `background-color` (non-TEXT nodes only), textStyle → font properties, border → `border`, shadows → `box-shadow`. Do NOT approximate or skip any value.
   **CRITICAL: TEXT nodes MUST NOT get background-color from fills.** Text color is in `textStyle.color`.
3. **Include ALL spacing** — layout.gap, layout.padding, width, height from the YAML.
4. **Include ALL visual effects** — shadows, backdrop-filter, filter, opacity, border-radius, blend modes.
5. **NEVER invent colors or sizes** — only use values from the YAML. If a value is missing, omit it rather than guessing.
6. **Image fills** — `fills: [{ type: image, scaleMode: fill, assetFile: "./assets/photo.svg" }]` → `background-image: url('./assets/photo.svg'); background-size: cover;` (use `contain` for scaleMode: fit). If no `assetFile` is present, use `background-color: #ccc;` as a placeholder.
7. **NEVER invent `margin-bottom` or `margin-top`.** Only emit margins when the YAML explicitly contains a `marginBottom` or `margin` value. A common LLM error is setting `margin-bottom` equal to `font-size` — this is ALWAYS incorrect.

### Content Fidelity — No Hallucinated Text

1. **Only output text that appears in the YAML `text` field.** Node `name` is a Figma layer label — NEVER render it as visible text.
2. **`type: ICON` nodes with `assetFile`** → **MUST** render as `<img src="{assetFile}" alt="" />` with the node's `width` and `height`. This is a pre-exported SVG. NEVER render as empty `<div>` or CSS shape.
3. **VECTOR, BOOLEAN_OPERATION, LINE, ELLIPSE, STAR** (without `assetFile`) → `<span>` with CSS dimensions. No text content. **Exception**: if the node name contains "X", "Close", "Cross", "Remove" or has strokes with dimensions ≤12px, render as a **CSS × mark** using `::before`/`::after` pseudo-elements (two rotated lines forming an X shape).
4. **INSTANCE or FRAME without TEXT children** → sized container element. Do NOT invent a text label from the node name.
5. If a section contains only icons/shapes and no TEXT nodes, the output should have zero visible text.

### Section Dimension Constraints

When the page context specifies **this section's width** or **height**:
1. Your root element's CSS MUST use that exact pixel value — e.g. `width: 64px;` not `width: 100%;` or `width: auto;`.
2. Do NOT generate child elements wider than the section width. If content doesn't fit, the design is icon-only or uses overflow — respect the constraint.
3. Fixed dimensions mean the section is a specific size in the Figma canvas. Match it exactly.

### Sizing Modes

When context specifies a **width mode** or **height mode**:
- **fill** → `width: 100%` (or `flex: 1`). Do NOT use a fixed pixel value.
- **hug** → `width: auto` (fit content). Do NOT set fixed width.
- **fixed** → use the exact pixel value from section width/height.

### alignSelf: stretch — NO pixel widths

When a YAML node has `alignSelf: stretch`, it fills the parent's cross-axis:
- In a **column** parent: the child stretches its **width** → use `align-self: stretch;` — do NOT add a `width` property (no pixel value, no `width: 100%`).
- In a **row** parent: the child stretches its **height** → use `align-self: stretch;` — do NOT add a `height` property.

The pixel dimensions have been REMOVED from the YAML for stretch-aligned nodes. If you see `alignSelf: stretch` without a `width`, that means the element MUST stretch — do NOT invent a pixel width.

When **positioning: absolute** → the page wrapper handles position. Your root doesn't need `position: absolute`.
When **positioning: flex** → do NOT add `position: absolute`. Use standard sizing.
