// OpenIPF / OpenPowerlifting best-total lookup.
//
// FEASIBILITY: OpenPowerlifting (which powers openipf.org) exposes no
// CORS-enabled public JSON API, so the athlete's browser cannot fetch it
// directly, and "refresh every month" needs a scheduler. Both require a
// server-side worker — a Supabase Edge Function on a monthly cron that looks the
// lifter up by full name, parses their best IPF total, and writes it onto the
// athlete row. That lands with the coach dashboard/Supabase.
//
// Until then, the comp total is entered by the coach (see totals.comp in the
// dashboard data) and shows here immediately. This module is the seam the cron
// job will implement so nothing else has to change.

export type IpfBestTotal = {
  total: number; // kg
  meet: string; // meet name
  date: string; // ISO date
  source: "openipf";
};

/**
 * Look up an athlete's best IPF competition total by full name.
 * Intentionally not wired to a client fetch (see FEASIBILITY above); the
 * server-side monthly job implements this and calls setCompTotal().
 */
export async function lookupBestIpfTotal(_fullName: string): Promise<IpfBestTotal | null> {
  throw new Error(
    "OpenIPF lookup runs server-side (monthly cron), not from the client. Use the coach-entered comp total for now.",
  );
}
