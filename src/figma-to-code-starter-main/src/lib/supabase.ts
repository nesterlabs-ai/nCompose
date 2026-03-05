import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// TODO: Replace with your Supabase project URL and anon key from .env.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Supabase env vars missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env"
  );
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);
