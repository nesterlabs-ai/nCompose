# Template mode: Vite + React + Tailwind + shadcn starter

When **template mode** is enabled, the generated component will be dropped into a pre-built app that has:

- **Vite** + **React 19** + **TypeScript**
- **Tailwind v4** with path alias `@/` → `./src`
- **shadcn-style** UI: `cn()` from `@/lib/utils` for merging/conditional classes
- **CSS variables** in `@theme` (see below) — use these instead of hardcoded colors

## Styling rules in template mode

1. **Use Tailwind utility classes** for layout, spacing, typography, and borders:
   - Layout: `flex`, `flex-col`, `items-center`, `justify-between`, `gap-2`, `gap-4`
   - Sizing: `w-full`, `h-9`, `min-w-[140px]`, `max-w-6xl`
   - Spacing: `p-4`, `px-4`, `py-2`, `m-0`, `mt-6`
   - Typography: `text-sm`, `text-lg`, `font-medium`, `font-bold`, `tracking-tight`
   - Borders: `border`, `border-b`, `rounded-md`, `rounded-lg`
   - Effects: `shadow-sm`, `opacity-90`, `transition-colors`

2. **Use the project’s CSS variables** for colors and radius — do NOT use raw hex or oklch in class names. Prefer:
   - Backgrounds: `bg-[var(--color-primary)]`, `bg-[var(--color-background)]`, `bg-[var(--color-card)]`, `bg-[var(--color-muted)]`, `bg-[var(--color-accent)]`, `bg-[var(--color-destructive)]`
   - Text: `text-[var(--color-primary-foreground)]`, `text-[var(--color-foreground)]`, `text-[var(--color-muted-foreground)]`
   - Borders/inputs: `border-[var(--color-border)]`, `border-[var(--color-input)]`
   - Focus ring: `ring-[var(--color-ring)]`
   - Radius: `rounded-[var(--radius-sm)]`, `rounded-[var(--radius-md)]`, `rounded-[var(--radius-lg)]`

   Available variables: `--color-background`, `--color-foreground`, `--color-card`, `--color-primary`, `--color-primary-foreground`, `--color-secondary`, `--color-muted`, `--color-accent`, `--color-destructive`, `--color-border`, `--color-input`, `--color-ring`, and `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl`.

3. **In the CSS block** (PATH B) or **in class strings** (PATH A): when you need a color or radius, use `var(--color-*)` or `var(--radius-*)` instead of hardcoded values so the component respects the theme and dark mode.

4. **Do not** generate duplicate theme, router, or app shell code. The component will live in `src/components/` and be imported where needed; the app already has routing and theme setup.

5. **Conditional/merged classes**: Prefer building a single class string that includes Tailwind + CSS variable classes. If the target stack supports `cn()`, the compiled React output will typically use `className={cn('base', props.className)}`-style patterns; in Mitosis you build the class string (e.g. with `useStore` getter) using the same Tailwind and `var(--*)` tokens above.
