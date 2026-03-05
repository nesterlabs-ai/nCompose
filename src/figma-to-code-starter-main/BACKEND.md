# Supabase backend setup

This doc walks through Supabase setup for the Figma-to-code starter.

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign in.
2. **New project** → choose organization, name, database password, region.
3. Wait for the project to be ready.

## 2. Get API keys and URL

1. In the Supabase Dashboard, open **Project Settings** (gear) → **API**.
2. Copy:
   - **Project URL** → use as `VITE_SUPABASE_URL` in `.env`.
   - **anon public** key → use as `VITE_SUPABASE_ANON_KEY` in `.env`.

Never commit `.env` or expose the **service_role** key in frontend code.

## 3. Run migrations (optional)

If you use the Supabase CLI and have migrations in `supabase/migrations/`:

```bash
# Install Supabase CLI if needed: https://supabase.com/docs/guides/cli
supabase link --project-ref your-project-ref
supabase db push
```

Or run SQL manually in the Dashboard: **SQL Editor** → New query → paste and run.

## 4. Generate TypeScript types (optional)

To keep `src/types/database.ts` in sync with your schema:

```bash
supabase gen types typescript --project-id your-project-ref > src/types/database.ts
```

Then fix the export (e.g. `export type Database = { ... }`) if the CLI output format differs.

## 5. Auth (optional)

- **Authentication** → **Providers**: enable Email, OAuth, etc.
- **URL Configuration**: set **Site URL** (e.g. `http://localhost:5173` for dev) and **Redirect URLs** for OAuth.

Use Supabase Auth helpers in your app (e.g. `supabase.auth.signInWithPassword`, `onAuthStateChange`). TODO: Add auth flow in `src/lib/supabase.ts` or a dedicated auth module when you need it.

## 6. Storage and Realtime

- **Storage**: create buckets in Dashboard → Storage; use `supabase.storage` in code.
- **Realtime**: enable per table in Database → Replication; use `supabase.channel()` in code.

## References

- [Supabase Docs](https://supabase.com/docs)
- [Supabase JavaScript client](https://supabase.com/docs/reference/javascript/introduction)
