/**
 * Gyms — where an athlete trains. Machine / cable / dumbbell work isn't comparable
 * between gyms (a "lat pulldown 60 kg" differs per stack), so those accessories are
 * tracked per gym; barbell work (the comp lifts and barbell accessories) is the same
 * everywhere and stays shared.
 *
 * The athlete owns this list (dashboard → My gym). Each session is stamped with the
 * gym it was trained at (DayLog.gymId); unstamped (older) sessions count as the main
 * gym.
 */
import type { MainLift } from "./program";

export type GymType = "commercial" | "plbb" | "plminimal" | "crossfit" | "home" | "other";
export const GYM_TYPES: { id: GymType; label: string }[] = [
  { id: "commercial", label: "Commercial gym" },
  { id: "plbb", label: "Powerlifting / bodybuilding gym" },
  { id: "plminimal", label: "Powerlifting gym (minimal / garage)" },
  { id: "crossfit", label: "CrossFit box" },
  { id: "home", label: "Home gym" },
  { id: "other", label: "Other" },
];
export const GYM_TYPE_SHORT: Record<GymType, string> = {
  commercial: "Commercial",
  plbb: "PL/BB",
  plminimal: "PL minimal",
  crossfit: "CrossFit",
  home: "Home",
  other: "Other",
};

export type Gym = { id: string; name: string; city: string; type: GymType; updatedAt: number; deleted?: boolean };
/** Stored on the athlete's dashboard. `main.at` lets the newest choice win on sync. */
export type GymState = { list: Record<string, Gym>; main?: { id: string; at: number } };

/** Union by gym id (newest wins, tombstones included); the newest main choice wins. */
export function mergeGyms(a: GymState | undefined, b: GymState | undefined): GymState | undefined {
  if (!a && !b) return undefined;
  const list: Record<string, Gym> = { ...(a?.list ?? {}) };
  for (const [id, g] of Object.entries(b?.list ?? {})) {
    if (!g) continue;
    if (!list[id] || (g.updatedAt ?? 0) >= (list[id].updatedAt ?? 0)) list[id] = g;
  }
  const main = !a?.main ? b?.main : !b?.main ? a.main : b.main.at >= a.main.at ? b.main : a.main;
  return { list, main };
}

/** Gyms that still exist, main first, then by name. */
export function liveGyms(s: GymState | undefined): Gym[] {
  const main = mainGymId(s);
  return Object.values(s?.list ?? {})
    .filter((g) => g && !g.deleted)
    .sort((x, y) => (x.id === main ? -1 : y.id === main ? 1 : x.name.localeCompare(y.name)));
}

/** The main gym's id: the chosen one if it still exists, else the oldest gym. */
export function mainGymId(s: GymState | undefined): string | undefined {
  const live = Object.values(s?.list ?? {}).filter((g) => g && !g.deleted);
  if (s?.main && live.some((g) => g.id === s.main!.id)) return s.main.id;
  return live.sort((x, y) => x.updatedAt - y.updatedAt)[0]?.id;
}

export const gymLabel = (g: Gym | undefined) => (g ? `${g.name}${g.city ? ` · ${g.city}` : ""}` : "");

// Barbell work is the same in every gym → never split per gym.
const BARBELL = /\b(barbell|bb|ez[- ]?bar|olympic|ohp|overhead ?press|military ?press|push ?press|rdls?|romanian|good ?mornings?|pendlay|front ?squats?|zercher|landmine|trap ?bar|hex ?bar|jm ?press|skull ?crushers?|floor ?press)\b/i;
// Clearly machine / cable / free-weight-but-not-barbell work → per gym, even if the
// coach tagged it to a main lift (e.g. a leg press filed under squat).
const KIT = /\b(machine|leg ?press|hack ?squat|smith|cables?|pulley|lat ?pull\w*|pulldowns?|pec ?deck|dumbbells?|db|kettlebells?|kb|belt ?squat|pendulum|seated ?row|chest ?press|leg ?(curl|ext\w*)|hammer ?strength|preacher)\b/i;

/** True when an exercise's numbers only make sense within one gym. */
export function isGymSpecific(ex: { name: string; mainLift: MainLift | null }): boolean {
  if (BARBELL.test(ex.name)) return false;
  return ex.mainLift == null || KIT.test(ex.name);
}
