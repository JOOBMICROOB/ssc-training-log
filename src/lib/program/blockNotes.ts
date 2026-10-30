/**
 * Block notes — the coach's notes for a whole block (typically a summary of the
 * Loom they recorded for it), split into General / Squat / Bench / Deadlift /
 * Accessories so the athlete reads only what's relevant per lift.
 *
 * Stored on the athlete's dashboard (`blockNotes`, keyed by the coach's block id)
 * so it syncs to their phone like a published week.
 */

export const NOTE_SECTIONS = ["general", "squat", "bench", "deadlift", "accessories"] as const;
export type NoteSection = (typeof NOTE_SECTIONS)[number];
export const SECTION_LABEL: Record<NoteSection, string> = {
  general: "General",
  squat: "Squat",
  bench: "Bench",
  deadlift: "Deadlift",
  accessories: "Accessories",
};

export type BlockNote = {
  id: string; // the coach's block (mesocycle) id
  blockName: string;
  start?: string; // first week's start date (ISO)
  end?: string; // last day of the last week (ISO)
  loomUrl?: string;
  sections: Record<NoteSection, string>;
  updatedAt: number; // ms — newer wins on sync
  deleted?: boolean; // tombstone so a stale device can't bring a removed note back
};

export const emptySections = (): Record<NoteSection, string> => ({ general: "", squat: "", bench: "", deadlift: "", accessories: "" });

// --- auto-split ----------------------------------------------------------------

// Accessory phrases are matched (and blanked out) FIRST, so "split squat", "leg
// press" or "RDL" never count as the competition lift they contain.
const ACCESSORY =
  /\b(accessor\w*|accessoir\w*|assistance|hulpoefening\w*|split ?squats?|bulgarian\w*|leg ?press\w*|lunges?|step-?ups?|rdls?|romanian\w*|stiff ?leg\w*|good ?mornings?|ghr|glute ?ham\w*|hip ?thrust\w*|back ?ext\w*|hyper\w*|rows?|rowing|roei\w*|pull-?ups?|chin-?ups?|lat ?pull\w*|pulldowns?|curls?|biceps?|triceps?|pushdowns?|extensions?|dips?|fl(?:y|ies|yes)|lateral ?raises?|face ?pulls?|rear ?delts?|shoulder ?press\w*|ohp|overhead ?press\w*|military ?press\w*|core|abs|buikspier\w*|planks?|hamstrings?|quads?|calf|calves|kuit\w*|leg ?curls?|leg ?ext\w*|upper ?back|bovenrug)\b/gi;
const LIFTS: [NoteSection, RegExp][] = [
  ["squat", /\b(squat\w*|sq|hurk\w*|low ?bar|high ?bar|ssb|safety ?bar|front ?squat\w*|box ?squat\w*|pin ?squat\w*)\b/gi],
  ["bench", /\b(bench\w*|bankdruk\w*|bp|larsens?|spotos?|cgbp|close ?grip\w*|touch ?and ?go|tng|pin ?press\w*|board ?press\w*|feet ?up)\b/gi],
  ["deadlift", /\b(deadlift\w*|dead ?lifts?|dls?|sumo|conventional|conv|deficit\w*|block ?pulls?|rack ?pulls?|trap ?bar|hex ?bar|paused ?pulls?)\b/gi],
];
const HEADING_WORDS: [NoteSection, RegExp][] = [
  ["general", /^(general|algemeen|overall|globaal|intro|samenvatting|summary|overzicht|focus|doelen?|goals?)$/i],
  ["accessories", /^(accessor\w*|accessoir\w*|assistance|hulpoefeningen)$/i],
  ["squat", /^(squats?|sq)$/i],
  ["bench", /^(bench(?: ?press)?|bankdrukken|bp)$/i],
  ["deadlift", /^(deadlifts?|dl)$/i],
];

const countMatches = (re: RegExp, s: string) => (s.match(re) ?? []).length;

/** Which section a piece of text is about, or null when it names no lift. */
export function classify(text: string): NoteSection | null {
  const acc = countMatches(ACCESSORY, text);
  const rest = text.replace(ACCESSORY, " ");
  let best: NoteSection | null = null;
  let bestN = 0;
  for (const [sec, re] of LIFTS) {
    const n = countMatches(re, rest);
    if (n > bestN) { best = sec; bestN = n; }
  }
  if (best) return best;
  return acc > 0 ? "accessories" : null;
}

/** A line that is a section title ("Squat:", "## Bench", "DEADLIFT", "Squat – cue…"). */
function headingOf(line: string): { section: NoteSection; rest: string } | null {
  const m = line.match(/^\s*(?:#{1,6}\s*)?(?:\*\*|__)?([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ ]{1,29})(?:\*\*|__)?\s*([:\-–—])?\s*(.*)$/);
  if (!m) return null;
  const word = m[1].trim();
  const sep = m[2];
  const rest = (m[3] ?? "").trim();
  if (rest && !sep) return null; // "Squat depth was good" is a sentence, not a title
  for (const [sec, re] of HEADING_WORDS) if (re.test(word)) return { section: sec, rest };
  return null;
}

const splitSentences = (s: string) => s.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý0-9"“(])/).map((x) => x.trim()).filter(Boolean);
const stripBullet = (s: string) => s.replace(/^\s*(?:[-*•·–]|\d+[.)])\s+/, "").trim();

/**
 * Split a free-text summary into the five sections.
 * - Explicit headings ("Squat:", "## Bench", "Accessoires") start a section.
 * - Otherwise each sentence goes to the lift it names; a sentence that names none
 *   follows the sentence before it in the same paragraph (it's usually the same
 *   point continued), else the current heading, else General.
 */
export function splitBlockNotes(text: string): Record<NoteSection, string> {
  const out: Record<NoteSection, string[]> = { general: [], squat: [], bench: [], deadlift: [], accessories: [] };
  let heading: NoteSection | null = null;
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^(?:[-*•·]\s*)?<?https?:\/\/\S+>?$/i.test(line)) continue; // a bare link (the Loom) has its own field
    const h = headingOf(stripBullet(line));
    if (h) {
      heading = h.section;
      if (h.rest) out[h.section].push(h.rest);
      continue;
    }
    const body = stripBullet(line);
    let lastInPara: NoteSection | null = null;
    const parts: { sec: NoteSection; text: string }[] = [];
    for (const sentence of splitSentences(body)) {
      const c = classify(sentence);
      const namesLift = c === "squat" || c === "bench" || c === "deadlift";
      let sec: NoteSection;
      if (heading && heading !== "general") sec = namesLift && c !== heading ? c! : heading; // stays under its title unless it names another lift
      else sec = c ?? lastInPara ?? heading ?? "general";
      lastInPara = sec;
      const prev = parts[parts.length - 1];
      if (prev && prev.sec === sec) prev.text += ` ${sentence}`;
      else parts.push({ sec, text: sentence });
    }
    for (const p of parts) out[p.sec].push(p.text);
  }
  const join = (xs: string[]) => xs.map((x) => (xs.length > 1 ? `• ${x}` : x)).join("\n");
  return { general: join(out.general), squat: join(out.squat), bench: join(out.bench), deadlift: join(out.deadlift), accessories: join(out.accessories) };
}

/** First Loom share link in a text, if any. */
export function findLoomUrl(text: string): string | undefined {
  return text.match(/https?:\/\/(?:www\.)?loom\.com\/(?:share|embed)\/[A-Za-z0-9]+[^\s)]*/i)?.[0];
}

// --- sync ----------------------------------------------------------------------

/** Union by block id; the newer `updatedAt` wins (tombstones included). */
export function mergeBlockNotes(a: Record<string, BlockNote> | undefined, b: Record<string, BlockNote> | undefined): Record<string, BlockNote> {
  const out: Record<string, BlockNote> = { ...(a ?? {}) };
  for (const [id, n] of Object.entries(b ?? {})) {
    if (!n) continue;
    const cur = out[id];
    if (!cur || (n.updatedAt ?? 0) >= (cur.updatedAt ?? 0)) out[id] = n;
  }
  return out;
}

// --- athlete view --------------------------------------------------------------

export type AthleteBlock = { key: string; name: string; start: string; end: string; weeks: number; note?: BlockNote };

/**
 * The athlete's blocks, newest first: consecutive published weeks with the same
 * block name form one block; each gets the coach's note whose dates overlap it (or,
 * failing that, whose name matches). Notes for a block not published yet are listed
 * on their own so the athlete can already read them.
 */
export function athleteBlocks(
  published: Record<string, { blockName?: string }> | undefined,
  notes: Record<string, BlockNote> | undefined,
  addDays: (iso: string, n: number) => string,
): AthleteBlock[] {
  const blocks: AthleteBlock[] = [];
  for (const start of Object.keys(published ?? {}).sort()) {
    const name = (published![start].blockName || "Block").trim();
    const last = blocks[blocks.length - 1];
    if (last && last.name === name && start <= addDays(last.end, 8)) {
      last.end = addDays(start, 6);
      last.weeks++;
    } else blocks.push({ key: start, name, start, end: addDays(start, 6), weeks: 1 });
  }
  const live = Object.values(notes ?? {}).filter((n) => n && !n.deleted);
  const used = new Set<string>();
  for (const b of blocks) {
    const overlap = live.filter((n) => !used.has(n.id) && n.start && n.end && n.start <= b.end && n.end >= b.start);
    const byName = live.filter((n) => !used.has(n.id) && n.blockName.trim().toLowerCase() === b.name.toLowerCase());
    const pick = (overlap.length ? overlap : byName).sort((x, y) => y.updatedAt - x.updatedAt)[0];
    if (pick) { b.note = pick; used.add(pick.id); }
  }
  for (const n of live) {
    if (used.has(n.id)) continue;
    blocks.push({ key: `note:${n.id}`, name: n.blockName, start: n.start ?? "", end: n.end ?? "", weeks: 0, note: n });
  }
  return blocks.sort((x, y) => (y.start || "9999").localeCompare(x.start || "9999"));
}

/** True when a note has anything to read. */
export const noteHasContent = (n: BlockNote | undefined) =>
  !!n && !n.deleted && (!!n.loomUrl || NOTE_SECTIONS.some((s) => n.sections[s]?.trim()));
