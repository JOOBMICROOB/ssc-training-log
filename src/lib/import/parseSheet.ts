/**
 * Google Sheet -> program parser.
 *
 * Accepts pasted spreadsheet text (TSV from a Google Sheets copy, or CSV) and
 * turns it into the app's program structure: sessions grouped by day, each with
 * exercise rows (name, sets, reps, intensity as RPE/%/relative, coach note).
 *
 * It never auto-commits — it returns a structured, editable result (with
 * per-cell warnings for anything it wasn't sure about) for the coach's review
 * step before the program is saved. Tolerant by design: unknown columns are
 * ignored, ambiguous intensities are flagged rather than dropped.
 */
import type { SscIntensityType } from "../../types/database";

export interface ParsedExerciseRow {
  exercise_name: string;
  target_sets: number | null;
  target_reps: number | null;
  intensity_type: SscIntensityType | null;
  intensity_value: number | null;
  coach_note: string | null;
  /** Raw intensity text as written, kept so the review UI can show the source. */
  intensity_raw: string | null;
}

export interface ParsedSession {
  name: string;
  day: string | null;
  rows: ParsedExerciseRow[];
}

export interface ParseWarning {
  session: string;
  row: number;
  message: string;
}

export interface ParseResult {
  sessions: ParsedSession[];
  warnings: ParseWarning[];
}

const HEADER_ALIASES: Record<string, string> = {
  day: "day", session: "day", block: "day",
  exercise: "exercise", movement: "exercise", lift: "exercise", name: "exercise",
  sets: "sets", set: "sets",
  reps: "reps", rep: "reps", repetitions: "reps",
  intensity: "intensity", rpe: "intensity", load: "intensity",
  percent: "intensity", "%": "intensity", "%1rm": "intensity",
  note: "note", notes: "note", cue: "note", comment: "note",
};

function splitCells(line: string): string[] {
  // Tab-separated (Sheets copy) wins; fall back to comma with simple quote handling.
  if (line.includes("\t")) return line.split("\t").map((c) => c.trim());
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function looksLikeHeader(cells: string[]): boolean {
  const norm = cells.map((c) => c.toLowerCase().replace(/\s+/g, ""));
  return norm.some((c) => c === "exercise" || c === "movement" || c === "lift") &&
    norm.some((c) => c === "sets" || c === "reps" || c === "rep");
}

function mapColumns(header: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  header.forEach((h, i) => {
    const key = HEADER_ALIASES[h.toLowerCase().replace(/\s+/g, "")];
    if (key && !(key in map)) map[key] = i;
  });
  return map;
}

function parseIntCell(v: string | undefined): number | null {
  if (!v) return null;
  const m = v.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/**
 * Interpret an intensity cell:
 *   "@8", "RPE 8", "8"        -> rpe 8
 *   "80%", "80 %", "%80"      -> percent 80
 *   "+5", "-10", "+5kg"       -> relative (kg offset)
 * Returns [type, value] or [null, null] when it can't tell.
 */
export function parseIntensity(raw: string): [SscIntensityType | null, number | null] {
  const s = raw.trim().toLowerCase();
  if (!s) return [null, null];
  if (s.includes("%")) {
    const n = parseIntCell(s);
    return n === null ? [null, null] : ["percent", n];
  }
  if (/^[+-]/.test(s)) {
    const n = parseIntCell(s);
    return n === null ? [null, null] : ["relative", n];
  }
  if (s.startsWith("@") || s.startsWith("rpe")) {
    const n = parseIntCell(s);
    return n === null ? [null, null] : ["rpe", n];
  }
  // A bare number in 1..10 is almost certainly an RPE in this context.
  const n = parseIntCell(s);
  if (n !== null && n >= 1 && n <= 10) return ["rpe", n];
  if (n !== null && n > 10) return ["percent", n];
  return [null, null];
}

export function parseSheet(text: string): ParseResult {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const warnings: ParseWarning[] = [];
  const sessions: ParsedSession[] = [];

  let cols: Record<string, number> | null = null;
  let current: ParsedSession | null = null;
  let sessionCounter = 0;
  let rowNum = 0;

  const startSession = (day: string | null): ParsedSession => {
    sessionCounter += 1;
    const s: ParsedSession = { name: day || `Session ${String.fromCharCode(64 + sessionCounter)}`, day, rows: [] };
    sessions.push(s);
    return s;
  };

  for (const line of lines) {
    if (line.trim() === "") {
      // Blank line separates sessions when there's no explicit Day column.
      if (cols && !("day" in cols)) current = null;
      continue;
    }
    const cells = splitCells(line);

    if (looksLikeHeader(cells)) {
      cols = mapColumns(cells);
      continue;
    }
    if (!cols) {
      // No header yet — assume a canonical order: Day, Exercise, Sets, Reps, Intensity, Note.
      cols = { day: 0, exercise: 1, sets: 2, reps: 3, intensity: 4, note: 5 };
    }

    const get = (k: string) => (cols![k] !== undefined ? cells[cols![k]] : undefined);
    const exercise = (get("exercise") || "").trim();
    if (!exercise) continue; // skip spacer/label rows without an exercise

    const dayCell = (get("day") || "").trim();
    if ("day" in cols && dayCell) {
      if (!current || current.day !== dayCell) current = startSession(dayCell);
    } else if (!current) {
      current = startSession(dayCell || null);
    }

    rowNum += 1;
    const intensityRaw = (get("intensity") || "").trim();
    const [itype, ivalue] = parseIntensity(intensityRaw);
    if (intensityRaw && itype === null) {
      warnings.push({
        session: current!.name,
        row: current!.rows.length + 1,
        message: `Couldn't read intensity "${intensityRaw}" — set it manually.`,
      });
    }

    current!.rows.push({
      exercise_name: exercise,
      target_sets: parseIntCell(get("sets")),
      target_reps: parseIntCell(get("reps")),
      intensity_type: itype,
      intensity_value: ivalue,
      coach_note: (get("note") || "").trim() || null,
      intensity_raw: intensityRaw || null,
    });
  }

  return { sessions: sessions.filter((s) => s.rows.length > 0), warnings };
}
