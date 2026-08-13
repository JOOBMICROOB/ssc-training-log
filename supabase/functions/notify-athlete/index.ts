// Supabase Edge Function: notify-athlete
//
// Sends a Web Push notification to one athlete (e.g. when the coach publishes a
// program). The VAPID PRIVATE key lives only here as a secret; the public key is
// safe in the app. A signed-in coach calls this; the function verifies they own
// the athlete, then pushes to that athlete's stored subscription.
//
// Deploy + secret: see README.md in this folder.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VAPID_PUBLIC = "BCCh2N1DPGs3l19tgml7PFSRFL4xocaJwRBPYgNuY__ShSs5Ov4O2U8nw-Q6ha9Irzt9QR8oiNykc5mCX7XyC9c";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!vapidPrivate) return json({ ok: false, error: "VAPID_PRIVATE_KEY secret not set." }, 500);

  // Who is calling?
  const asCaller = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: userRes } = await asCaller.auth.getUser();
  const caller = userRes?.user;
  if (!caller) return json({ ok: false, error: "Not signed in." }, 401);

  let code = "", title = "", body = "", link = "/";
  try {
    const b = await req.json();
    code = String(b.code ?? "").trim().toUpperCase();
    title = String(b.title ?? "SSC Training");
    body = String(b.body ?? "");
    link = String(b.url ?? "/");
  } catch {
    return json({ ok: false, error: "Bad body." }, 400);
  }
  if (!code) return json({ ok: false, error: "Missing athlete code." }, 400);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Caller must be a coach who owns this athlete.
  const { data: coach } = await admin.from("app_profiles").select("role").eq("user_id", caller.id).maybeSingle();
  if (!coach || coach.role !== "coach") return json({ ok: false, error: "Only a coach can notify." }, 403);
  const { data: athlete } = await admin.from("app_profiles").select("user_id, coach_user_id").eq("code", code).maybeSingle();
  if (!athlete) return json({ ok: false, error: `No athlete ${code}.` }, 404);
  if (athlete.coach_user_id !== caller.id) return json({ ok: false, error: "Not your athlete." }, 403);

  // Their stored push subscription.
  const { data: row } = await admin.from("app_state").select("data").eq("user_id", athlete.user_id).maybeSingle();
  const sub = (row?.data as { pushSub?: unknown } | null)?.pushSub;
  if (!sub) return json({ ok: true, sent: false, reason: "Athlete hasn't enabled notifications." });

  webpush.setVapidDetails("mailto:coach@ssc.app", VAPID_PUBLIC, vapidPrivate);
  try {
    await webpush.sendNotification(sub as webpush.PushSubscription, JSON.stringify({ title, body, url: link, tag: "ssc-program" }));
    return json({ ok: true, sent: true });
  } catch (e) {
    // 404/410 → the subscription is dead; report so it can be cleared.
    const status = (e as { statusCode?: number }).statusCode;
    return json({ ok: false, sent: false, error: `Push failed (${status ?? "?"})`, stale: status === 404 || status === 410 });
  }
});
