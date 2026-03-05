-- TODO: Replace with your first migration (tables, RLS, triggers).
-- Example: create a simple projects table for Figma file links.

-- create table if not exists public.projects (
--   id uuid primary key default gen_random_uuid(),
--   name text not null,
--   figma_file_url text,
--   created_at timestamptz default now(),
--   updated_at timestamptz default now()
-- );

-- enable RLS
-- alter table public.projects enable row level security;

-- policy example (adjust to your auth)
-- create policy "Users can read own projects"
--   on public.projects for select
--   using (auth.uid() is not null);

select 1;
