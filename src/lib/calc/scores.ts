/**
 * Strength-level scoring: Wilks (classic), DOTS, and IPF GL points.
 *
 * All three normalise a powerlifting total against bodyweight so athletes of
 * different sizes can be compared. Inputs are metric (kg). `sex` selects the
 * coefficient set. These are mirrored 1:1 in the SQL migration
 * (ssc_wilks / ssc_dots / ssc_ipf_gl) — if you change a coefficient here,
 * change it there too.
 *
 * Reference values used in the tests are computed by hand in scores.test.ts,
 * so a transcription error in any coefficient below is caught by CI.
 */

export type Sex = "male" | "female";

/** Horner-evaluate a polynomial given ascending-power coefficients [c0, c1, ...]. */
function poly(coeffs: number[], x: number): number {
  let result = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) {
    result = result * x + coeffs[i];
  }
  return result;
}

// ---- Wilks (classic / "Wilks 1") ----------------------------------------
// coeff = 500 / P(bw); score = coeff * total
const WILKS: Record<Sex, number[]> = {
  // ascending powers c0..c5
  male: [-216.0475144, 16.2606339, -0.002388645, -0.00113732, 7.01863e-6, -1.291e-8],
  female: [594.31747775582, -27.23842536447, 0.82112226871, -0.00930733913, 4.731582e-5, -9.054e-8],
};

export function wilks(sex: Sex, bodyweightKg: number, totalKg: number): number {
  if (bodyweightKg <= 0 || totalKg <= 0) return 0;
  const denom = poly(WILKS[sex], bodyweightKg);
  if (denom === 0) return 0;
  return (500 / denom) * totalKg;
}

// ---- DOTS ---------------------------------------------------------------
// score = 500 * total / P(bw); bodyweight is clamped to the valid fit range.
const DOTS: Record<Sex, number[]> = {
  male: [-307.75076, 24.0900756, -0.1918759221, 0.0007391293, -0.000001093705],
  female: [-57.96288, 13.6175032, -0.1126655495, 0.0005158568, -0.0000010706],
};
const DOTS_CLAMP: Record<Sex, [number, number]> = {
  male: [40, 210],
  female: [40, 150],
};

export function dots(sex: Sex, bodyweightKg: number, totalKg: number): number {
  if (bodyweightKg <= 0 || totalKg <= 0) return 0;
  const [lo, hi] = DOTS_CLAMP[sex];
  const bw = Math.min(Math.max(bodyweightKg, lo), hi);
  const denom = poly(DOTS[sex], bw);
  if (denom === 0) return 0;
  return (500 * totalKg) / denom;
}

// ---- IPF GL points ------------------------------------------------------
// GL = 100 * total / (A - B * e^(-C * bw)).
// Defaults are Raw ("Classic") full powerlifting (SBD). Bench-only / equipped
// use different parameter sets; expose `event` for the common cases.
export type IpfEvent = "raw_full" | "raw_bench" | "equipped_full" | "equipped_bench";

const IPF_GL: Record<IpfEvent, Record<Sex, [number, number, number]>> = {
  // [A, B, C]
  raw_full: { male: [1199.72839, 1025.18162, 0.00921], female: [610.32796, 1045.59282, 0.03048] },
  raw_bench: { male: [320.98041, 281.40258, 0.01008], female: [142.40398, 442.52671, 0.04724] },
  equipped_full: { male: [1236.25115, 1449.21864, 0.01644], female: [758.63878, 949.31382, 0.02435] },
  equipped_bench: { male: [381.22073, 733.79378, 0.02398], female: [221.82209, 357.00377, 0.02937] },
};

export function ipfGlPoints(
  sex: Sex,
  bodyweightKg: number,
  totalKg: number,
  event: IpfEvent = "raw_full",
): number {
  if (bodyweightKg <= 0 || totalKg <= 0) return 0;
  const [a, b, c] = IPF_GL[event][sex];
  const denom = a - b * Math.exp(-c * bodyweightKg);
  if (denom <= 0) return 0;
  return (100 * totalKg) / denom;
}
