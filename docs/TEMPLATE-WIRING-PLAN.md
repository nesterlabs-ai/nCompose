# Using figma-to-code-starter-main as a Template (Lovable-style)

## Goal

Instead of generating a **full project from scratch**, the pipeline should:

1. **LLM generates only the component file(s)** (e.g. one React component from Figma).
2. **Use `figma-to-code-starter-main` as the template** — a pre-built app with routing, theme, shadcn, Supabase.
3. **Wire the generated component into the template** (add file + import + route or usage).
4. **Deliver the final output** as a runnable project (e.g. zip or folder) so the user gets “template + my new component” in one go.

---

## 1. Template overview: `src/figma-to-code-starter-main/`

| Path | Purpose |
|------|--------|
| **Root** | Vite + React 19, TypeScript, Tailwind v4, `@` → `./src` |
| **src/App.tsx** | React Router: `/` → Landing, `/dashboard` → Dashboard; **TODO** comment for more routes |
| **src/pages/** | `landing.tsx`, `dashboard.tsx` — use `@/components/ui/button`, `@/components/ui/card` |
| **src/components/** | `theme-provider.tsx`, `theme-toggle.tsx` |
| **src/components/ui/** | shadcn primitives: `button.tsx`, `card.tsx` — use `cn()` from `@/lib/utils`, CSS variables from `index.css` |
| **src/lib/** | `utils.ts` (`cn()`), `supabase.ts` |
| **src/index.css** | `@theme { ... }` — CSS variables for colors/radius (Figma token alignment point) |

**Wiring convention:** No global registry. New components are added by:

- **Reusable UI:** Create `src/components/MyComponent.tsx` (or `src/components/ui/MyComponent.tsx`), then `import { MyComponent } from "@/components/MyComponent"` where used.
- **New page:** Create `src/pages/my-page.tsx`, then in `App.tsx`: add `import { MyPage } from "@/pages/my-page"` and `<Route path="/my-page" element={<MyPage />} />`.

So the “template” is a fixed folder structure + conventions; “wiring” = add one (or two) files + one import + one route.

---

## 2. How Lovable does it (reference)

- **Templates:** Full project copies used as **starting points** (heavy boilerplate, framework variants, complex setup).
- **Design systems:** Ongoing instructions Lovable **reads on every generation** (`.lovable` folder: `system.md`, `rules/components/*.md`). When you ask for a “button component”, Lovable:
  - Reads the connected design system (install instructions, guidelines, existing components).
  - **Generates only the new piece** (e.g. the button) that fits the existing stack.
  - **Wires it into the current project** (add file, import, use in a page or layout) so the app stays runnable.

So: **template = scaffold once; design system = “how to generate and where to put new things.”** For our case, the “design system” is: “we have a Vite+React+Tailwind+shadcn starter; new Figma→code output is a single React component; put it in `src/components/` and expose it on a route.”

---

## 3. Proposed flow for figma-to-code

### Current flow (today)

```
Figma URL → convert → LLM generates .lite.tsx → Mitosis → framework outputs (.jsx, .vue, …)
→ writeOutputFiles() → ./output/ComponentName-<sessionId>/
→ optional: --preview → setupPreview() copies into separate preview-app and overwrites App.jsx
```

So we already have a “wire into an app” step for **preview** (copy component + assets, generate a minimal `App.jsx`). The starter is a **richer** app (routing, theme, pages, shadcn).

### Target flow (template-based)

1. **Conversion unchanged:** Figma → LLM → Mitosis → framework outputs (we still get `ComponentName.jsx` + assets).
2. **New option:** e.g. `--template <path>` or `--output-mode project` (or both).
3. **When template mode is on:**
   - **Copy** the entire `figma-to-code-starter-main` (or a packaged template) to the output directory (e.g. `./output/MyProject-<sessionId>/`).
   - **Write only the generated React component** into the template:
     - `src/components/<ComponentName>.tsx` (or `.jsx`) ← from our React output.
     - `src/components/assets/` or `public/assets/` ← generated SVGs.
   - **Wire the component into the app:**
     - Add a **page** that renders the new component: e.g. `src/pages/component-preview.tsx` (or a name derived from Figma).
     - In `App.tsx`, add:  
       `import { ComponentPreviewPage } from "@/pages/component-preview"` and  
       `<Route path="/component" element={<ComponentPreviewPage />} />`  
       (path can be configurable or derived from component name).
   - **Path/import fixes:** Our generated code may use `./assets/...`; the template might use `@/components/assets/` or `public/assets/`. Rewrite asset paths in the copied component so they work inside the template (same idea as in `preview.ts` for the current preview app).
4. **Deliver:** User gets a single folder (or zip) that is the **starter + their component**, ready to `npm install && npm run dev`.

### What the LLM must do (no change to “full project” generation)

- The LLM **already** generates only the component (Mitosis .lite.tsx → one React component). We do **not** ask the LLM to generate the whole app.
- We may want to **constrain** the LLM so the generated component is **template-friendly**:
  - Prefer `className` + Tailwind (or at least compatible with `cn()` and existing CSS variables).
  - Document in the system prompt that the output will be dropped into a Vite + React + Tailwind + `@/` alias app with `cn()` available; avoid creating duplicate theme or router code.

So “LLM generates only the component” is already the case; the new work is **pipeline and wiring**, not changing what the LLM generates (except optional prompt tweaks for template compatibility).

---

## 4. Implementation outline

| Step | Action |
|------|--------|
| 1 | Add CLI flag and/or config: e.g. `--template-dir <path>` (default: `src/figma-to-code-starter-main`) and/or `--output-mode project \| files` (default: `files`). |
| 2 | Add a **template copy** function: copy the starter (or a built “template” tarball) to `output/<ProjectName>-<sessionId>/`. |
| 3 | Add a **wire-into-template** function (similar to `setup-preview.ts` but for the starter): |
| 3a | Write `result.componentName`.jsx (or .tsx) to `src/components/<ComponentName>.tsx`. |
| 3b | Write assets to `src/components/assets/` or `public/assets/`, and rewrite asset paths in the component (e.g. `./assets/x.svg` → `@/components/assets/x.svg` or `/assets/x.svg`). |
| 3c | Create a page component, e.g. `src/pages/component-preview.tsx`, that imports and renders `<ComponentName />` (and optionally variant grid if we have metadata). |
| 3d | Patch `App.tsx`: insert new `import` and new `<Route path="..." element={...} />` (e.g. path `/component` or `/<componentName>`). |
| 4 | When `--output-mode project` (or `--template-dir` set): after `writeOutputFiles()`, run the template copy + wire step instead of (or in addition to) writing only to `./output/ComponentName-<sessionId>/` raw files. |
| 5 | Optional: add a small **template README** or comment in the starter’s `App.tsx` describing “how we add a generated component” so future changes stay consistent. |

### Existing code to reuse

- **`writeOutputFiles()`** — still used to get the React (and other framework) outputs; we only change **where** we write the React file when in project mode (into the copied template).
- **`setup-preview.ts`** — pattern for copying component + assets and generating an App that renders the component; the new “wire into starter” is the same idea but: copy full app first, then add one component file, one page file, and patch `App.tsx` instead of replacing it.
- **Asset path rewriting** — same logic as in `src/web/preview.ts` (e.g. `./assets/foo.svg` → path valid in the template).

### Lovable-style “design system” (optional later)

- Add a **`.figma-to-code`** (or similar) folder inside the template with:
  - **system.md** (or **rules.md**): “This project is Vite + React + Tailwind; use `@/` imports; use `cn()` and CSS variables from `index.css`; generated components go in `src/components/` and are exposed via a page and route.”
  - So when we **refine prompts** for “template mode”, we can point the LLM at this file (or embed its contents in the system prompt) so the generated component fits the starter’s conventions.

---

## 5. Summary

- **Template:** `figma-to-code-starter-main` is the fixed scaffold (Vite, React, Router, theme, shadcn, Supabase).
- **LLM:** Already generates only the component; optionally tighten prompts so output is Tailwind/`cn()`/CSS-variable friendly.
- **Wiring:** Copy template → write generated React component + assets into template → add a preview page → patch `App.tsx` (import + route).
- **Output:** User gets a single runnable project (template + component) instead of only loose files; optional zip for distribution.
- **Lovable parallel:** Same idea as Lovable’s “design system + project”: read a fixed structure and rules, generate only the new artifact, then wire it into the existing app so the result is a complete, runnable app.

This gives you a Lovable-like experience: “create a button from Figma” → one component is generated and wired into the starter so the user immediately has a full app that includes that button on a dedicated route.
