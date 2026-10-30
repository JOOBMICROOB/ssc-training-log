import { createClient } from "@supabase/supabase-js";
import { coachSupabase } from "../supabase";
import { hydrateAthletes, hydrateAthletesReadonly, hydrateShared, stopSync, enableCoachSync } from "../data/athleteData";

/**
 * Coach-side auth + roster sync for the console.
 *
 * The coach signs into Supabase; we confirm their profile role is 'coach', then
 * connect every athlete assigned to them (RLS lets a coach read + write their
 * athletes' rows). After that the console's data services read the athletes'
 * live cloud data, and publishing a program writes straight to the athlete.
 */

// The generated Database type predates app_profiles; use an untyped view.
const q = coachSupabase as unknown as { from: (t: string) => { select: (c: string) => { eq: (col: string, v: string) => { maybeSingle: () => Promise<{ data: Record<string, string> | null; error: unknown }> } & Promise<{ data: Record<string, string>[] | null; error: unknown }> } } };

export type StaffRole = "coach" | "nutritionist";
export type CoachSession = { userId: string; name: string; code: string; role: StaffRole };

/** The current coach session, or null if nobody's signed in as a coach. */
export async function getCoachSession(): Promise<CoachSession | null> {
  const s = await getStaffSession();
  return s && s.role === "coach" ? s : null;
}

/**
 * The current staff session — a coach OR the nutritionist. The console branches
 * on `role`: a coach gets the full console, a nutritionist a read-only board.
 */
export async function getStaffSession(): Promise<CoachSession | null> {
  const { data: userRes } = await coachSupabase.auth.getUser();
  const user = userRes.user;
  if (!user) return null;
  const { data, error } = await q.from("app_profiles").select("role,name,code").eq("user_id", user.id).maybeSingle();
  if (error || !data || (data.role !== "coach" && data.role !== "nutritionist")) return null;
  const role = data.role as StaffRole;
  return { userId: user.id, name: data.name ?? (role === "coach" ? "Coach" : "Nutritionist"), code: data.code ?? "", role };
}

/** Sign in with email + password; rejects accounts that aren't coaches. */
export async function signInCoach(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const res = await signInStaff(email, password);
  return res.ok ? { ok: true } : res;
}

/** Sign in a coach OR the nutritionist; returns the role so the console can route. */
export async function signInStaff(email: string, password: string): Promise<{ ok: boolean; error?: string; role?: StaffRole }> {
  const { error } = await coachSupabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) return { ok: false, error: "Wrong email or password." };
  const session = await getStaffSession();
  if (!session) {
    await coachSupabase.auth.signOut().catch(() => {});
    return { ok: false, error: "This account isn't set up as a coach or nutritionist." };
  }
  return { ok: true, role: session.role };
}

export type CoachAthlete = { athleteId: string; userId: string; name: string; shared: boolean; owned: boolean; ownerId: string | null; nutrition: boolean };

// Broad, untyped view of coachSupabase for the tables the generated types predate.
const cs = coachSupabase as unknown as {
  from: (t: string) => {
    select: (c: string) => {
      eq: (col: string, v: string) => Promise<{ data: Record<string, string>[] | null; error: unknown }>;
      in: (col: string, v: string[]) => Promise<{ data: Record<string, string>[] | null; error: unknown }>;
    };
    upsert: (v: unknown, o?: unknown) => Promise<{ error: { message?: string } | null }>;
    delete: () => { eq: (c: string, v: string) => { eq: (c2: string, v2: string) => Promise<{ error: { message?: string } | null }> } };
  };
};

/**
 * Connect the coach's athletes to the cloud and return their roster: the athletes
 * they OWN (app_profiles.coach_user_id) plus any SHARED to them by another coach
 * (app_shared_athletes) — the shared ones flagged so the console can badge them.
 */
/**
 * Load every athlete profile, tolerating a stale PostgREST schema cache that
 * doesn't know the `nutrition` column yet (right after the 0018 migration). If
 * the column isn't in the API schema yet, fall back to the roster WITHOUT it so
 * the board never goes blank — the nutrition flag just defaults off until the
 * cache catches up.
 */
async function fetchAthleteProfiles(): Promise<Record<string, string>[]> {
  const withNutri = await cs.from("app_profiles").select("code,name,user_id,coach_user_id,nutrition").eq("role", "athlete");
  if (!withNutri.error && withNutri.data) return withNutri.data;
  const base = await cs.from("app_profiles").select("code,name,user_id,coach_user_id").eq("role", "athlete");
  return !base.error && base.data ? base.data : [];
}

export async function startCoachSync(coachUserId: string): Promise<CoachAthlete[]> {
  enableCoachSync();
  // Every athlete (coaches can read all profiles — 0016). Each is tagged with its
  // owner so the Team/Clients board can show everyone while program tabs stay
  // scoped to own + shared.
  const profs = await fetchAthleteProfiles();
  // Which of them are shared TO me (defensive — table exists only after 0016).
  let sharedIds = new Set<string>();
  try {
    const { data: shares } = await cs.from("app_shared_athletes").select("athlete_user_id").eq("coach_user_id", coachUserId);
    sharedIds = new Set((shares ?? []).map((s) => s.athlete_user_id).filter(Boolean));
  } catch {
    /* sharing not deployed yet */
  }
  const list: CoachAthlete[] = profs.map((r) => ({
    athleteId: r.code,
    userId: r.user_id,
    name: r.name,
    ownerId: r.coach_user_id ?? null,
    owned: r.coach_user_id === coachUserId,
    shared: sharedIds.has(r.user_id),
    nutrition: !!(r as Record<string, unknown>).nutrition,
  }));
  // Own + shared connect live (editable); everyone else is a one-shot read for the
  // board/summary only.
  const editable = list.filter((a) => a.owned || a.shared);
  const others = list.filter((a) => !a.owned && !a.shared);
  await hydrateAthletes(editable);
  await hydrateAthletesReadonly(others);
  await hydrateShared(true); // coach seeds the shared competition list if empty
  return list;
}

/**
 * Nutritionist-side roster: every athlete flagged `nutrition` (RLS returns only
 * those to a nutritionist). Connected READ-ONLY — the nutritionist follows the
 * published programs + logs but can't write anything (no write policy either).
 */
export async function startNutritionistSync(): Promise<CoachAthlete[]> {
  enableCoachSync();
  const profs = await fetchAthleteProfiles();
  const list: CoachAthlete[] = profs.map((r) => ({
    athleteId: r.code,
    userId: r.user_id,
    name: r.name,
    ownerId: r.coach_user_id ?? null,
    owned: false,
    shared: false,
    nutrition: true,
  }));
  await hydrateAthletesReadonly(list);
  return list;
}

/** Coach ticks/unticks whether an athlete also does nutrition (routed through RLS). */
export async function setAthleteNutrition(athleteUserId: string, val: boolean): Promise<{ ok: boolean; error?: string }> {
  const sb = coachSupabase as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message?: string } | null }> };
  const { error } = await sb.rpc("app_set_nutrition", { athlete: athleteUserId, val });
  return error ? { ok: false, error: error.message ?? "Could not update." } : { ok: true };
}

// --- nutritionist profile photo ---------------------------------------------
// Jess's photo lives in her own app_state (she can write her own row), and is
// pushed onto her athletes' dashboards via app_stamp_nutritionist().
const stateSb = () =>
  coachSupabase as unknown as {
    from: (t: string) => {
      select: (c: string) => { eq: (col: string, v: string) => { maybeSingle: () => Promise<{ data: { data?: Record<string, unknown> } | null }> } };
      upsert: (v: unknown, o?: unknown) => Promise<{ error: { message?: string } | null }>;
    };
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message?: string } | null }>;
  };

/** Jess's saved profile photo (data URL), or null. */
export async function getNutritionistPhoto(): Promise<string | null> {
  const { data: u } = await coachSupabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return null;
  const { data } = await stateSb().from("app_state").select("data").eq("user_id", uid).maybeSingle();
  const photo = data?.data?.nutritionistPhoto;
  return typeof photo === "string" ? photo : null;
}

/** Push Jess's current name + photo onto every athlete she follows. */
export async function stampNutritionist(photo: string | null): Promise<void> {
  try {
    await stateSb().rpc("app_stamp_nutritionist", { photo });
  } catch {
    /* RPC not deployed yet — card just stays "Coming soon" until 0019 is run */
  }
}

/** Save Jess's photo (to her own state) and propagate it to her athletes. */
export async function setNutritionistPhoto(photo: string): Promise<{ ok: boolean; error?: string }> {
  const { data: u } = await coachSupabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return { ok: false, error: "not signed in" };
  const cur = await stateSb().from("app_state").select("data").eq("user_id", uid).maybeSingle();
  const merged = { ...(cur.data?.data ?? {}), nutritionistPhoto: photo };
  const { error } = await stateSb().from("app_state").upsert({ user_id: uid, data: merged }, { onConflict: "user_id" });
  if (error) return { ok: false, error: error.message ?? "Could not save photo." };
  await stampNutritionist(photo);
  return { ok: true };
}

/** Every coach (for the Team tab, the coach switcher, and the share picker). */
export async function listCoaches(): Promise<{ userId: string; name: string; code: string }[]> {
  const { data, error } = await q.from("app_profiles").select("user_id,name,code").eq("role", "coach");
  return !error && data ? data.map((r) => ({ userId: r.user_id, name: r.name ?? "Coach", code: r.code ?? "" })) : [];
}

/** Share an athlete with another coach (they get full edit access, marked shared). */
export async function shareAthlete(athleteUserId: string, coachUserId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await cs.from("app_shared_athletes").upsert(
    { athlete_user_id: athleteUserId, coach_user_id: coachUserId },
    { onConflict: "athlete_user_id,coach_user_id" },
  );
  return error ? { ok: false, error: error.message ?? "Share failed." } : { ok: true };
}

/** Remove a share (either the owning coach or the shared coach can do this). */
export async function unshareAthlete(athleteUserId: string, coachUserId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await cs.from("app_shared_athletes").delete().eq("athlete_user_id", athleteUserId).eq("coach_user_id", coachUserId);
  return error ? { ok: false, error: error.message ?? "Un-share failed." } : { ok: true };
}

/** Which coaches an athlete is currently shared with (their user_ids). */
export async function sharesForAthlete(athleteUserId: string): Promise<string[]> {
  try {
    const { data } = await cs.from("app_shared_athletes").select("coach_user_id").eq("athlete_user_id", athleteUserId);
    return (data ?? []).map((r) => r.coach_user_id).filter(Boolean);
  } catch {
    return [];
  }
}

export async function signOutCoach(): Promise<void> {
  stopSync();
  await coachSupabase.auth.signOut().catch(() => {});
}

/** The email an athlete logs in with — derived from their ID/code. */
export function athleteLoginEmail(athleteId: string): string {
  return `${athleteId.trim().toLowerCase()}@ssc.app`;
}

/**
 * Fire a push notification to an athlete that their program was published, via
 * the 'notify-athlete' Edge Function. Best-effort — if the function isn't
 * deployed or the athlete never opted in, publishing still succeeds silently.
 */
export async function notifyAthlete(athleteCode: string, title: string, body: string): Promise<void> {
  try {
    const fns = coachSupabase as unknown as {
      functions: { invoke: (name: string, opts: { body: unknown }) => Promise<unknown> };
    };
    await fns.functions.invoke("notify-athlete", { body: { code: athleteCode.trim().toUpperCase(), title, body, url: "/" } });
  } catch {
    /* notifications are a bonus, never block a publish */
  }
}
/**
 * One-off broadcasts: each is pushed ONCE per coach account to every athlete this
 * coach OWNS (notify-athlete only allows the owner, so shared athletes get it from
 * their own coach). The "sent" flags live in the coach's own app_state row, so a
 * second device doesn't send again. Only athletes with notifications on receive it;
 * everyone still sees the matching in-app popup (wireDashboard NOTICES).
 */
const BROADCASTS: { id: string; until: string; title: string; body: string }[] = [
  {
    id: "profileReset-2026-10",
    until: "2026-11-30",
    title: "Even je gegevens nakijken",
    body: "Door een klein probleem zijn sommige persoonlijke gegevens veranderd. Open de app en dubbeltik om ze recht te zetten.",
  },
  {
    id: "updates-2026-10-30",
    until: "2026-12-15",
    title: "Nieuw in de app 💪",
    body: "Hou je vinger op een oefening om je rep-maxes (1RM–12RM) te zien. Open de app voor alle updates.",
  },
];
let broadcastsRunning = false;
export async function sendBroadcastsOnce(coachUserId: string, ownedCodes: string[]): Promise<void> {
  if (broadcastsRunning || !ownedCodes.length) return;
  broadcastsRunning = true; // roster re-syncs (focus etc.) must not race a second send
  const today = new Date().toISOString().slice(0, 10);
  const st = coachSupabase as unknown as {
    from: (t: string) => {
      select: (c: string) => { eq: (col: string, v: string) => { maybeSingle: () => Promise<{ data: { data?: Record<string, unknown> } | null; error: unknown }> } };
      upsert: (v: unknown, o?: unknown) => Promise<{ error: unknown }>;
    };
  };
  try {
    const { data, error } = await st.from("app_state").select("data").eq("user_id", coachUserId).maybeSingle();
    if (error) return;
    const base = data?.data ?? {};
    const sent = (base.noticesSent as string[] | undefined) ?? [];
    const due = BROADCASTS.filter((b) => today <= b.until && !sent.includes(b.id));
    if (!due.length) return;
    // Claim the flags BEFORE sending so a second open can't double-send.
    const { error: wErr } = await st.from("app_state").upsert(
      { user_id: coachUserId, data: { ...base, noticesSent: [...sent, ...due.map((b) => b.id)] } },
      { onConflict: "user_id" },
    );
    if (wErr) return;
    for (const b of due) for (const code of ownedCodes) await notifyAthlete(code, b.title, b.body);
  } catch {
    /* best-effort */
  }
}

export const notifyAthletePublished = (athleteCode: string, blockName: string) =>
  notifyAthlete(athleteCode, "Your coach added a new program", blockName);

/**
 * Reset an athlete's password. Changing another user's Supabase password needs
 * the service_role admin key, which must NEVER live in the browser — so this
 * calls a server-side Edge Function ('reset-athlete-password') that holds the
 * key and verifies the caller is the coach who owns this athlete. If the
 * function isn't deployed yet, it fails with a clear message (see
 * supabase/functions/reset-athlete-password/README.md to deploy it).
 */
export async function resetAthletePassword(athleteCode: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  if (newPassword.length < 6) return { ok: false, error: "Password must be at least 6 characters." };
  try {
    const fns = coachSupabase as unknown as {
      functions: { invoke: (name: string, opts: { body: unknown }) => Promise<{ data: unknown; error: { message?: string } | null }> };
    };
    const { data, error } = await fns.functions.invoke("reset-athlete-password", {
      body: { code: athleteCode.trim().toUpperCase(), password: newPassword },
    });
    if (error) {
      const msg = /not found|failed to fetch|404/i.test(error.message ?? "")
        ? "The reset function isn't deployed yet — see supabase/functions/reset-athlete-password/README.md."
        : error.message ?? "Reset failed.";
      return { ok: false, error: msg };
    }
    const res = data as { ok?: boolean; error?: string } | null;
    if (res && res.ok === false) return { ok: false, error: res.error ?? "Reset was refused." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't reach the reset function — is it deployed?" };
  }
}

/**
 * Provision a new athlete: create their Supabase login (id → email, password),
 * which the 0015 trigger turns into a profile owned by this coach, then seed
 * their dashboard data. Uses a throwaway client so the coach stays signed in.
 * Requires "Confirm email" disabled in the project.
 */
export async function createAthlete(p: {
  id: string;
  password: string;
  name: string;
  coachUserId: string;
  state: Record<string, unknown>;
}): Promise<{ ok: boolean; error?: string }> {
  const url = import.meta.env.VITE_SUPABASE_URL as string;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const email = `${p.id.trim().toLowerCase()}@ssc.app`;

  const tmp = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false, storageKey: "ssc-signup-tmp" } });
  const { data, error } = await tmp.auth.signUp({
    email,
    password: p.password,
    options: { data: { role: "athlete", code: p.id.trim().toUpperCase(), name: p.name, coach_user_id: p.coachUserId } },
  });
  if (error) return { ok: false, error: error.message };
  const uid = data.user?.id;
  if (!uid) return { ok: false, error: "No account was created — check that 'Confirm email' is disabled in Supabase." };

  // Seed their dashboard data as the coach (RLS lets a coach write their athletes').
  const anySb = coachSupabase as unknown as { from: (t: string) => { upsert: (v: unknown, o?: unknown) => Promise<{ error: unknown }> } };
  const { error: seedErr } = await anySb.from("app_state").upsert({ user_id: uid, data: p.state }, { onConflict: "user_id" });
  if (seedErr) return { ok: false, error: "Account made, but seeding their data failed — try re-saving their profile." };
  return { ok: true };
}
