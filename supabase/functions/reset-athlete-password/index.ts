// Supabase Edge Function: reset-athlete-password
//
// Lets a signed-in COACH set a new password for one of THEIR athletes. The
// service_role admin key lives only here on the server — never in the browser
// app — so this is the one safe place a password change can happen.
//
// Flow:
//   1. Read the caller's JWT (sent automatically by supabase.functions.invoke).
//   2. Confirm that caller is a coach (app_profiles.role = 'coach').
//   3. Look up the athlete by code and confirm this coach owns them
//      (app_profiles.coach_user_id = caller).
//   4. Use the admin API to update that athlete's password.
//
// Deploy + secrets: see README.md in this folder.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Who is calling? Resolve the JWT to a user with an anon-key client.
  const authHeader = req.headers.get("Authorization") ?? "";
  const asCaller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userRes, error: userErr } = await asCaller.auth.getUser();
  const caller = userRes?.user;
  if (userErr || !caller) return json({ ok: false, error: "Not signed in." }, 401);

  // Body
  let code = "";
  let password = "";
  try {
    const b = await req.json();
    code = String(b.code ?? "").trim().toUpperCase();
    password = String(b.password ?? "");
  } catch {
    return json({ ok: false, error: "Bad request body." }, 400);
  }
  if (code.length < 3) return json({ ok: false, error: "Missing athlete code." }, 400);
  if (password.length < 6) return json({ ok: false, error: "Password must be at least 6 characters." }, 400);

  // Admin client (service_role) for the privileged reads + the password update.
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Caller must be a coach.
  const { data: coachProfile } = await admin.from("app_profiles").select("role").eq("user_id", caller.id).maybeSingle();
  if (!coachProfile || coachProfile.role !== "coach") return json({ ok: false, error: "Only a coach can reset passwords." }, 403);

  // The athlete must exist and be owned by this coach.
  const { data: athlete } = await admin
    .from("app_profiles")
    .select("user_id, coach_user_id, role")
    .eq("code", code)
    .maybeSingle();
  if (!athlete) return json({ ok: false, error: `No athlete with code ${code}.` }, 404);
  if (athlete.role !== "athlete") return json({ ok: false, error: "That code isn't an athlete account." }, 400);
  if (athlete.coach_user_id !== caller.id) return json({ ok: false, error: "That athlete isn't on your roster." }, 403);

  // Do the reset.
  const { error: updErr } = await admin.auth.admin.updateUserById(athlete.user_id, { password });
  if (updErr) return json({ ok: false, error: updErr.message }, 500);

  return json({ ok: true });
});
