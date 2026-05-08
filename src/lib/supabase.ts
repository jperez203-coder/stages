"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error(
    "Supabase env vars missing. Copy .env.example to .env.local and fill in your project's URL and publishable key.",
  );
}

export const supabase: SupabaseClient = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// Dev-only escape hatch for browser-console testing. Stripped from production.
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __supabase: SupabaseClient }).__supabase = supabase;
}
