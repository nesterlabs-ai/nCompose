# Figma to Code — Web App Starter

A **GitHub template repository** for building Figma-to-code web apps with Vite, React, TypeScript, shadcn/ui, Tailwind CSS, and Supabase.

## Stack

- **Vite** — Build tool and dev server
- **React 19** + **TypeScript**
- **shadcn/ui** — Components (New York style, neutral theme)
- **Tailwind CSS v4** — Styling with dark mode (class-based)
- **Supabase** — Auth, database, storage
- **React Router DOM** — Client-side routing
- **next-themes** — Dark mode support
- **Bun** — Package manager

## Use this template

1. Click **Use this template** on GitHub (or clone the repo).
2. Clone your new repo and open it locally.
3. Copy env vars and install (requires [Bun](https://bun.sh); this will create `bun.lockb`):

   ```bash
   cp .env.example .env
   # Edit .env and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
   bun install
   ```

4. Run the app:

   ```bash
   bun run dev
   ```

5. Open [http://localhost:5173](http://localhost:5173).

## Scripts

| Command        | Description              |
|----------------|--------------------------|
| `bun run dev`  | Start dev server         |
| `bun run build`| Type-check and build     |
| `bun run preview` | Preview production build |
| `bun run lint` | Run ESLint               |

## Project structure

```
src/
  components/   # React components (ui/ for shadcn)
  pages/       # Route-level pages (landing, dashboard)
  hooks/       # Custom React hooks
  lib/         # Utils, Supabase client
  types/       # TypeScript types (e.g. database)
  assets/      # Static assets
supabase/
  migrations/  # SQL migrations
public/        # Public static files
```

## Environment variables

See `.env.example`. Required for Supabase:

- `VITE_SUPABASE_URL` — Project URL from Supabase Dashboard → Settings → API
- `VITE_SUPABASE_ANON_KEY` — Anon (public) key from the same page

## Mark as a GitHub template

To let others create new repos from this one:

1. Open your repo on GitHub.
2. **Settings** → **General**.
3. Under **Template repository**, check **Template repository**.

After that, users will see a **Use this template** button on your repo.

## Customization

- Search for `// TODO:` in the codebase for placeholders (env, theme, Supabase types, copy, routes).
- Add shadcn components: `bunx shadcn@latest add <component>`.
- Backend setup: see [BACKEND.md](./BACKEND.md).

## License

MIT
