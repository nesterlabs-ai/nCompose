# NesterCompose — Web App Starter

A starter template for building web apps with Vite, React, TypeScript, shadcn/ui, and Tailwind CSS.

## Stack

- **Vite** — Build tool and dev server
- **React 19** + **TypeScript**
- **shadcn/ui** — Components (New York style, neutral theme)
- **Tailwind CSS v4** — Styling with dark mode (class-based)
- **React Router DOM** — Client-side routing
- **next-themes** — Dark mode support

## Getting Started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Run the app:

   ```bash
   npm run dev
   ```

3. Open [http://localhost:5173](http://localhost:5173).

## Scripts

| Command        | Description              |
|----------------|--------------------------|
| `npm run dev`  | Start dev server         |
| `npm run build`| Type-check and build     |
| `npm run preview` | Preview production build |
| `npm run lint` | Run ESLint               |

## Project structure

```
src/
  components/   # React components (ui/ for shadcn)
  pages/        # Route-level pages
  hooks/        # Custom React hooks
  lib/          # Utilities
  assets/       # Static assets
public/         # Public static files
```

## Customization

- Search for `// TODO:` in the codebase for placeholders.
- Add shadcn components: `npx shadcn@latest add <component>`.

## License

MIT
