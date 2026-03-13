# Open Issues & Improvements

---

## 1. Route large pages to PATH C for shadcn support

**Priority: High**

Currently, full-page designs (e.g. "Desktop" settings page) fall into PATH B — one giant LLM call, no component discovery, no shadcn. Output is a monolithic `.jsx` with BEM CSS.

**Problem**: Buttons, inputs, toggles, selects inside these pages are generated as plain HTML+CSS instead of reusable shadcn components with Tailwind.

**Fix**: Change routing logic so large nodes (descendant count > threshold, e.g. 30+) go to PATH C instead of PATH B. PATH C already has component discovery + shadcn support.

**Decisions needed**:
- Threshold for PATH C routing (descendant count? presence of INSTANCE nodes?)
- Layout wrapper output: Tailwind or keep BEM CSS?
- Non-variant sub-components (plain INSTANCEs without variant axes) — shadcn with default variant only?

**Files**: `src/convert.ts` (routing logic)

---

## 2. Modal: `position: fixed` + overlay breaks variant grid preview

**Priority: Medium**

The dialog base template uses `position: fixed` + backdrop overlay. In the variant grid preview, this causes the modal to cover the entire viewport instead of rendering inline in a card.

**Fix**: Update the base dialog template (`src/figma-to-code-starter-main/src/components/ui/dialog.tsx`) to render as an inline block element. Add a prompt rule telling the LLM not to use `position: fixed` for dialog/modal/toast — render as normal block element for preview compatibility.

**Files**: `src/figma-to-code-starter-main/src/components/ui/dialog.tsx`, `src/shadcn/shadcn-prompt-builder.ts`

---

## 3. Font family not loaded in WebContainer preview

**Priority: Medium**

The LLM generates `font-['Host_Grotesk']` in Tailwind classes, but the WebContainer preview doesn't load custom fonts. The font falls back to `system-ui`.

**Fix options**:
- Add a Google Fonts `@import` to the generated `index.css` if the style extractor detects a non-system font
- Or embed the font URL in the Vite project tree (`buildViteProjectTree` in `app.js`)

**Files**: `src/web/public/app.js` (buildViteProjectTree), `src/shadcn/style-extractor.ts`

---

## 4. Expand shadcn component registry

**Priority: Medium**

Currently supported: button, input, textarea, badge, toast, dialog/modal.

**To add**:
- checkbox
- radio button
- switch / toggle
- tabs
- accordion
- avatar
- card
- select / dropdown

Each needs:
1. Detection pattern in `src/figma/component-discovery.ts`
2. Mapping in `src/shadcn/shadcn-types.ts`
3. Base template in `src/figma-to-code-starter-main/src/components/ui/`
4. No Radix — plain HTML + CVA (WebContainer doesn't have Radix installed)

---

## 5. LLM output quality — still misses some Figma values

**Priority: Low**

Even with the enhanced structure tree (actual colors, sizes, gaps, alignment), the LLM occasionally:
- Uses wrong colors for deeply nested elements
- Misses alignment on inner containers
- Collapses shared styles when variants should look different

**Possible improvements**:
- Post-validation: compare LLM output colors/sizes against extracted Figma data, flag mismatches
- Shorter, more focused prompts per component (reduce prompt length so LLM doesn't lose details)
- Few-shot examples in the prompt for complex component types (modal, toast)

**Files**: `src/shadcn/shadcn-prompt-builder.ts`, `src/shadcn/style-extractor.ts`

---

## 6. PATH B → Tailwind migration (long-term)

**Priority: Low**

PATH B currently outputs inline CSS via `css={{}}` through Mitosis. To unify the codebase on Tailwind:
- Would need to skip Mitosis compilation for PATH B
- Change PATH B prompt to output Tailwind classes instead of inline styles
- This is essentially merging PATH B into PATH C

**Depends on**: Issue #1 (routing change). If all complex pages go through PATH C, PATH B only handles truly simple single-element nodes where inline CSS is fine.

---

## 7. Preview container: card wrapper visible behind wide components

**Priority: Low**

Fixed with flex-wrap, but the white card wrapper (`background: #fff`, `border: 1px solid #e5e7eb`) is still visible behind/around each variant. For wide components (toast 419px, modal 427px), the card border looks odd.

**Fix**: Make the card wrapper background transparent or remove it for shadcn components. Let the component's own background/border be the only visible container.

**Files**: `src/web/public/app.js` (buildShadcnVariantGridApp template string)
