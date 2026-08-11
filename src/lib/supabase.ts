import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy .env.example to .env.local.",
  );
}

/**
 * Shared Supabase client.
 * - persistSession + autoRefreshToken keep everyone logged in across visits
 *   (the brief's "no re-entering credentials each time").
 * - Realtime is used by the coach dashboard to see athlete logs live.
 */
export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/**
 * Separate client for the coach console. It uses its OWN auth storage key so a
 * coach and an athlete can be signed in at the same time in one browser without
 * clobbering each other's session (and so athlete data never resolves against a
 * coach's identity). In production they're different devices; this makes testing
 * both roles on one machine — and switching accounts — work correctly.
 */
export const coachSupabase = createClient<Database>(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: "sb-coach-auth",
  },
});
