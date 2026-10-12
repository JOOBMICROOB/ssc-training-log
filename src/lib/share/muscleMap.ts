import type { Session } from "../program/program";

/**
 * Derives the muscles a session trained and draws them on a simple front/back
 * body map for the share card. Keyword-based (primary movers only) — it's a
 * visual cue, not an anatomy lesson, so unknown exercises just add nothing.
 */

export type Region =
  // front
  | "delts" | "chest" | "biceps" | "forearms" | "abs" | "quads"
  // back — the lats span the whole back (no separate lower-back region); lower-back
  // work lights the lats + glutes, since those almost always fire together.
  | "traps" | "lats" | "triceps" | "glutes" | "hams" | "calves";

const FRONT: Region[] = ["delts", "chest", "biceps", "forearms", "abs", "quads"];

// Primary movers per main lift (used first, before name keywords refine).
const LIFT_MUSCLES: Record<"squat" | "bench" | "deadlift", Region[]> = {
  squat: ["quads", "glutes", "abs"],
  bench: ["chest", "triceps", "delts"],
  deadlift: ["hams", "glutes", "traps", "lats"],
};

// Name keyword → regions, for accessories (and to enrich the main lifts).
const NAME_RULES: [RegExp, Region[]][] = [
  [/\bdead|block pull|rack pull|rdl|romanian|good ?morning|stiff|back ?ext|hyperext|reverse hyper|45.?degree/i, ["hams", "glutes", "lats"]],
  [/\bleg curl|ham|nordic/i, ["hams"]],
  [/\bleg ext|\bquad/i, ["quads"]],
  [/\bsquat|lunge|split squat|leg press|hack|belt squat|step.?up|pistol|sissy/i, ["quads", "glutes"]],
  [/\bbench|larsen|spoto|floor press|chest|fly|flies|pec|pressaround/i, ["chest", "triceps", "delts"]],
  [/\bdip|push.?up/i, ["chest", "triceps"]],
  [/\bohp|overhead|shoulder press|arnold|military|db press|dumbell press|dumbbell press/i, ["delts", "triceps"]],
  [/\blateral|side raise|upright row|rear delt|reverse (fly|pec)|face pull/i, ["delts", "traps"]],
  [/\btricep|pushdown|skull|jm press|kickback/i, ["triceps"]],
  [/\brow|pulldown|pull.?up|chin|lat pull/i, ["lats", "traps", "biceps"]],
  [/\bcurl/i, ["biceps", "forearms"]],
  [/\bcalf|calve/i, ["calves"]],
  [/\bab |abs|crunch|plank|rollout|copenhagen|hanging|leg raise|woodchop/i, ["abs"]],
  [/\bforearm|grip|wrist/i, ["forearms"]],
  [/\badduct/i, ["quads"]],
  [/\babduct/i, ["glutes"]],
];

export function musclesForSession(session: Session): Set<Region> {
  const out = new Set<Region>();
  for (const ex of session.exercises) {
    // Only count exercises the athlete actually logged a load on.
    const worked = ex.sets.some((s) => s.weightKg != null && !s.failed && !s.prefill) || ex.sets.some((s) => s.done);
    if (!worked) continue;
    if (ex.mainLift) LIFT_MUSCLES[ex.mainLift].forEach((m) => out.add(m));
    const n = ` ${ex.name.toLowerCase()} `;
    for (const [re, regions] of NAME_RULES) if (re.test(n)) regions.forEach((m) => out.add(m));
  }
  return out;
}

// --- body map SVG ------------------------------------------------------------
// One schematic mannequin per view; only trained muscles are painted (accent),
// over a faint base silhouette, so a highlighted group reads as "trained".

const BASE = `fill="#2e4f73"`; // the body — dark blue
// Muscle overlays, positioned on a 0 0 200 440 body. Front and back share the
// same mannequin outline; each region lists the shapes to paint when active.
const SHAPES: Record<Region, string> = {
  delts: `<ellipse cx="52" cy="92" rx="15" ry="13"/><ellipse cx="148" cy="92" rx="15" ry="13"/>`,
  chest: `<rect x="74" y="98" width="23" height="30" rx="9"/><rect x="103" y="98" width="23" height="30" rx="9"/>`,
  biceps: `<ellipse cx="50" cy="124" rx="11" ry="20"/><ellipse cx="150" cy="124" rx="11" ry="20"/>`,
  forearms: `<ellipse cx="49" cy="178" rx="10" ry="22"/><ellipse cx="151" cy="178" rx="10" ry="22"/>`,
  abs: `<rect x="86" y="134" width="28" height="74" rx="9"/>`,
  quads: `<rect x="76" y="238" width="21" height="86" rx="10"/><rect x="103" y="238" width="21" height="86" rx="10"/>`,
  traps: `<path d="M80 80 L120 80 L112 116 L88 116 Z"/>`,
  // Lats span the full back — shoulder blades down to the waist — so lower-back
  // work reads here (there's no separate lower-back region).
  lats: `<path d="M74 116 L98 124 L92 208 L76 190 Z"/><path d="M126 116 L102 124 L108 208 L124 190 Z"/>`,
  triceps: `<ellipse cx="50" cy="124" rx="11" ry="20"/><ellipse cx="150" cy="124" rx="11" ry="20"/>`,
  // A wide, flat glute block — deliberately wider than tall so the back view
  // reads as hips, not a narrow bar over two bulbs.
  glutes: `<rect x="72" y="214" width="56" height="30" rx="15"/>`,
  hams: `<rect x="76" y="252" width="21" height="80" rx="10"/><rect x="103" y="252" width="21" height="80" rx="10"/>`,
  calves: `<ellipse cx="86" cy="372" rx="12" ry="26"/><ellipse cx="114" cy="372" rx="12" ry="26"/>`,
};

// A faint blocky mannequin: head, torso, arms, legs.
const MANNEQUIN = `
  <circle cx="100" cy="36" r="24" ${BASE}/>
  <rect x="66" y="72" width="68" height="150" rx="26" ${BASE}/>
  <rect x="40" y="82" width="22" height="118" rx="11" ${BASE}/>
  <rect x="138" y="82" width="22" height="118" rx="11" ${BASE}/>
  <rect x="74" y="224" width="22" height="178" rx="11" ${BASE}/>
  <rect x="104" y="224" width="22" height="178" rx="11" ${BASE}/>`;

const ACCENT = "#e5484d"; // trained muscles — red

function body(active: Set<Region>, view: "front" | "back"): string {
  const regions = (Object.keys(SHAPES) as Region[]).filter((r) =>
    (view === "front" ? FRONT.includes(r) : !FRONT.includes(r)) && active.has(r),
  );
  const overlays = regions.map((r) => `<g fill="${ACCENT}">${SHAPES[r]}</g>`).join("");
  return `<g>${MANNEQUIN}${overlays}</g>`;
}

/** An SVG string of two mannequins (front + back) with trained muscles lit. */
export function muscleMapSvg(active: Set<Region>): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 440" width="520" height="440">
    <g transform="translate(0,10)">${body(active, "front")}</g>
    <g transform="translate(320,10)">${body(active, "back")}</g>
  </svg>`;
}
