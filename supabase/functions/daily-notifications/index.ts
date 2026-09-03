// Supabase Edge Function: daily-notifications
//
// Runs on a schedule (pg_cron) and sends athletes push notifications:
//   morning  → weekly check-in reminder (last day of their training week) +
//              meet countdowns (3 / 2 / 1 weeks + 1 day out)
//   evening  → missed-session nudge (training day with nothing logged yet)
//
// Protected by a shared CRON_SECRET header (no user auth — it's a system call).
// Times are evaluated in Europe/Brussels. See README.md for setup.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VAPID_PUBLIC = "BCCh2N1DPGs3l19tgml7PFSRFL4xocaJwRBPYgNuY__ShSs5Ov4O2U8nw-Q6ha9Irzt9QR8oiNykc5mCX7XyC9c";
const TZ = "Europe/Brussels";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-cron-secret" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

type SetLog = { weightKg?: number | null; prefill?: boolean; failed?: boolean; done?: boolean };
type Day = { rest: boolean; exercises: { name: string }[] };
type AState = {
  weekStartsOn?: number;
  checkin?: { submitted?: boolean; weekStart?: string | null };
  pushSub?: unknown;
  publishedWeeks?: Record<string, { week: Day[] }>;
  programWeek?: Day[];
  programLogs?: Record<string, { sets?: Record<string, SetLog>; remindAt?: number }>;
  optedInComps?: string[];
  competitions?: { id: string; name: string; date: string }[];
};

/** YYYY-MM-DD + weekday (0=Sun..6=Sat) for "now" in Brussels. */
function brusselsToday(): { iso: string; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const wd = new Date(`${parts}T12:00:00Z`).getUTCDay(); // date-only → weekday
  return { iso: parts, weekday: wd };
}
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** Monday-of-week style: most recent day whose weekday === weekStartsOn. */
function weekStartOf(iso: string, weekday: number, weekStartsOn: number): string {
  return addDays(iso, -(((weekday - weekStartsOn) % 7 + 7) % 7));
}
/** The week template active on a date (latest publishedWeek starting on/before it). */
function templateFor(s: AState, iso: string): Day[] | null {
  const pw = s.publishedWeeks ?? {};
  const starts = Object.keys(pw).filter((k) => k <= iso).sort();
  if (starts.length) return pw[starts[starts.length - 1]].week;
  return s.programWeek ?? null;
}
const isLogged = (st: SetLog) => (st.weightKg != null && !st.prefill) || st.failed === true || st.done === true;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return json({ ok: false, error: "bad secret" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!vapidPrivate) return json({ ok: false, error: "VAPID_PRIVATE_KEY not set" }, 500);
  webpush.setVapidDetails("mailto:coach@ssc.app", VAPID_PUBLIC, vapidPrivate);
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const slot = new URL(req.url).searchParams.get("slot") ?? "morning";
  const { iso: today, weekday } = brusselsToday();

  const { data: rows } = await admin.from("app_state").select("data");
  let sent = 0;
  const send = async (sub: unknown, title: string, body: string) => {
    try { await webpush.sendNotification(sub as webpush.PushSubscription, JSON.stringify({ title, body, url: "/" })); sent++; }
    catch { /* dead sub / transient — ignore */ }
  };

  for (const row of rows ?? []) {
    const s = (row as { data: AState }).data;
    if (!s?.pushSub) continue;

    // "Not everything's logged" nudge — 1h after the athlete started a session
    // (their 2nd logged set) if it's still incomplete. The app stamps `remindAt`
    // per session and clears it when the session is completed/confirmed. Stateless
    // + read-only: fire once in the window after it's due, never write app_state.
    if (slot === "session-reminder") {
      const nowMs = Date.now();
      const WINDOW = 15 * 60 * 1000; // one cron interval — fires once, no dedupe state
      for (const dl of Object.values(s.programLogs ?? {})) {
        const r = dl?.remindAt;
        if (typeof r === "number" && r <= nowMs && nowMs - r < WINDOW) {
          await send(s.pushSub, "Session not fully logged", "You started a session but haven't logged everything yet — finish it so your coach sees the full picture.");
          break; // at most one nudge per athlete per run
        }
      }
      continue;
    }

    const wso = s.weekStartsOn ?? 1;

    if (slot === "morning") {
      // Weekly check-in reminder on the LAST day of the training week.
      const lastDay = (wso + 6) % 7;
      if (weekday === lastDay) {
        const wk = weekStartOf(today, weekday, wso);
        if (!(s.checkin?.submitted && s.checkin?.weekStart === wk)) {
          await send(s.pushSub, "Weekly check-in due", "Last day of your week — log your check-in before it resets.");
        }
      }
      // Meet countdowns.
      for (const cid of s.optedInComps ?? []) {
        const c = (s.competitions ?? []).find((x) => x.id === cid);
        if (!c) continue;
        const dleft = dayDiff(today, c.date);
        if (dleft === 21 || dleft === 14 || dleft === 7) await send(s.pushSub, `${dleft / 7} weeks out`, `${c.name} is ${dleft / 7} week${dleft === 7 ? "" : "s"} away.`);
        else if (dleft === 1) await send(s.pushSub, "Tomorrow's the day", `${c.name} is tomorrow — go get it. 💪`);
      }
    } else {
      // Missed-session nudge: a training day with nothing logged yet.
      const tpl = templateFor(s, today);
      const day = tpl?.[weekday];
      if (day && !day.rest && day.exercises.length) {
        const sets = s.programLogs?.[today]?.sets ?? {};
        const anyLogged = Object.values(sets).some(isLogged);
        if (!anyLogged) await send(s.pushSub, "Don't forget to log", "You've got a session today — log it so your coach can see it.");
      }
    }
  }
  return json({ ok: true, slot, sent });
});
