import { useMemo, useState } from "react";
import {
  loadProgram,
  saveProgram,
  loadExercises,
  saveExercises,
  toTemplate,
  progressWeek,
  deloadWeek,
  blankRow,
  dbToRow,
  uid,
  dayDate,
  weekOrder,
  startWeekday,
  weekForToday,
  mondayOf,
  shareProgram,
  getSharedPrograms,
  cloneShared,
  WEEK_ORDER,
  WEEKDAY_NAME,
  SCHEMES,
  type Program,
  type Week,
  type Day,
  type ExRow,
  type DbExercise,
  type ExGroup,
  type IntensityType,
} from "./coachProgram";
import { publishProgramWeek, setProgramLabels, getSessionFor, getDashboardModel } from "../../lib/data/athleteData";
import { notifyAthletePublished } from "../../lib/auth/coachAuth";
import { fmtKg } from "../../lib/calc/records";
import { weekState, WEEK_STATE_LABEL, weekLiftStats } from "./coachStats";
import { Avatar } from "./Avatar";

const LIFT_LABEL: Record<"squat" | "bench" | "deadlift", string> = { squat: "SQUAT", bench: "BENCH", deadlift: "DEADLIFT" };
const tons = (kg: number) => (kg >= 1000 ? `${(kg / 1000).toFixed(1)} t` : `${Math.round(kg)} kg`);
const REP_RANGES = ["2-4", "4-6", "6-8", "8-10", "8-12", "10-12", "12-15", "15-20"];
const RPE_OPTS = ["5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10"];

/**
 * Program builder (Program & Planner → 3 · Program). Three columns: mesocycles /
 * copy-week (left), the editable week (centre), the exercise database (right).
 * Edits persist per athlete. "Publish week to athlete" converts the built week to
 * the athlete WeekTemplate and, for the live athlete, writes it to their app —
 * only that athlete's data is written, so a published program is theirs alone.
 */

const DRAG = "application/x-ssc";
type DropTarget = { dayId: string; beforeExId: string | null };

// The exercise database is one shared store (all coaches see + add to it). New
// names typed straight into the program file themselves into the right column.
function groupFromName(name: string, mainLift: ExRow["mainLift"]): ExGroup {
  if (mainLift) return mainLift;
  const n = name.toLowerCase();
  if (/(squat|lunge|leg press|leg extension|hack)/.test(n)) return "squat";
  if (/(bench|press|dip|fly|tricep)/.test(n)) return "bench";
  if (/(deadlift|rdl|romanian|hinge|good ?morning|pull-through)/.test(n)) return "deadlift";
  if (/(row|pull|chin|lat|face pull)/.test(n)) return "pull";
  return "accessory";
}

export function ProgramBuilder({ athleteId, athleteName, avatar, live, coachName = "Coach", onBack }: { athleteId: string; athleteName: string; avatar?: string; live: boolean; coachName?: string; onBack?: () => void }) {
  const [program, setProgram] = useState<Program>(() => loadProgram(athleteId));
  const [exercises, setExercises] = useState<DbExercise[]>(() => loadExercises());
  const [mesoId, setMesoId] = useState<string>(() => program.mesocycles[0].id);
  const [weekId, setWeekId] = useState<string>(() => program.currentWeekId ?? program.mesocycles[0].weeks[0].id);
  const [rpeDelta, setRpeDelta] = useState(1);
  const [loadPct, setLoadPct] = useState(2);
  const [fixedDelta, setFixedDelta] = useState(0);
  const [compoundsOnly, setCompoundsOnly] = useState(false);
  const [copyN, setCopyN] = useState(4);
  const [dbFilter, setDbFilter] = useState<ExGroup | "all">("all");
  const [dbSearch, setDbSearch] = useState("");
  const [dragEx, setDragEx] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const [newExName, setNewExName] = useState("");
  const [newExVideo, setNewExVideo] = useState("");
  const [renaming, setRenaming] = useState<{ kind: "meso" | "week"; id: string } | null>(null);
  const [repRange, setRepRange] = useState(false);

  const meso = program.mesocycles.find((m) => m.id === mesoId) ?? program.mesocycles[0];
  const week = meso.weeks.find((w) => w.id === weekId) ?? meso.weeks[meso.weeks.length - 1];

  // Where the athlete is right now — the week that contains today, by date.
  const currentId = useMemo(() => weekForToday(program, localIso(new Date())), [program]);
  const current = useMemo(() => {
    for (const m of program.mesocycles) {
      const w = m.weeks.find((x) => x.id === currentId);
      if (w) return { meso: m, week: w };
    }
    return null;
  }, [program, currentId]);

  // ---- persistence-aware mutations ----
  const commit = (p: Program) => {
    setProgram(p);
    saveProgram(p);
  };
  const mutProgram = (fn: (p: Program) => Program) => commit(fn(program));
  const mutMeso = (fn: (m: typeof meso) => typeof meso) =>
    commit({ ...program, mesocycles: program.mesocycles.map((m) => (m.id === meso.id ? fn(m) : m)) });
  const mutWeek = (fn: (w: Week) => Week) =>
    mutMeso((m) => ({ ...m, weeks: m.weeks.map((w) => (w.id === week.id ? fn(w) : w)) }));
  const mutDay = (dayId: string, fn: (d: Day) => Day) =>
    mutWeek((w) => ({ ...w, days: w.days.map((d) => (d.id === dayId ? fn(d) : d)) }));
  const mutRow = (dayId: string, exId: string, patch: Partial<ExRow>) =>
    mutDay(dayId, (d) => ({ ...d, exercises: d.exercises.map((e) => (e.id === exId ? { ...e, ...patch } : e)) }));

  // Days display starting on the week's chosen start day (Wed-start → Wed…Tue).
  const orderedDays = useMemo(
    () => weekOrder(week).map((wd) => week.days.find((d) => d.weekday === wd)).filter(Boolean) as Day[],
    [week],
  );
  const trainingDays = orderedDays.filter((d) => !d.rest && d.exercises.length);
  const totalSets = trainingDays.reduce((s, d) => s + d.exercises.reduce((a, e) => a + e.sets, 0), 0);

  // Live volume / e1RM for the week being edited, from the athlete's logged loads.
  const stats = useMemo(() => weekLiftStats(athleteId, week, live), [athleteId, week, live]);

  // The athlete's 1RM per lift, for turning a %1RM prescription into kg.
  const oneRm = useMemo(() => {
    const prs = getDashboardModel(athleteId).prs;
    const get = (k: string) => { const p = prs.find((x) => x.key === k); return p ? parseFloat(p.value.replace(",", ".")) : 0; };
    return { squat: get("squat"), bench: get("bench"), deadlift: get("deadlift") } as Record<string, number>;
  }, [athleteId]);
  const pctToKg = (ex: ExRow): string => {
    const rm = ex.mainLift ? oneRm[ex.mainLift] : 0;
    const pct = parseFloat(String(ex.value).replace(",", "."));
    if (!rm || !isFinite(pct)) return "";
    return `${Math.round((pct / 100) * rm / 2.5) * 2.5} kg`;
  };

  // Loads the athlete actually logged on a given date, keyed by exercise name.
  const loggedForDate = (date: string | null): Record<string, string> => {
    if (!live || !date) return {};
    const s = getSessionFor(athleteId, date);
    const map: Record<string, string> = {};
    for (const ex of s.exercises) {
      // Only the athlete's real logs — not coach fixed-load prefills.
      const w = ex.sets.filter((st) => st.weightKg != null && !st.prefill).map((st) => st.weightKg as number);
      if (w.length) map[ex.name.toLowerCase()] = `logged ${w.map(fmtKg).join(" · ")} kg`;
    }
    return map;
  };
  const loggedByWeekday = useMemo(() => {
    const out: Record<number, Record<string, string>> = {};
    if (live) for (const d of week.days) out[d.weekday] = loggedForDate(dayDate(week, d.weekday));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week, live, athleteId]);

  // The week before this one (same block), for a last-week reference per exercise.
  const prevWeek = useMemo(() => {
    const idx = meso.weeks.findIndex((w) => w.id === week.id);
    return idx > 0 ? meso.weeks[idx - 1] : null;
  }, [meso, week]);
  const prescOf = (ex: ExRow): string =>
    ex.intensity === "fixed" ? `${ex.value || "?"} kg fixed`
    : ex.intensity === "load" ? `${ex.value || "?"} kg`
    : ex.intensity === "percent" ? `${ex.value || "?"}%`
    : ex.intensity === "failure" ? "to failure"
    : ex.intensity === "seconds" ? `${ex.value || "?"} s`
    : ex.value ? `RPE${ex.value}` : "—";
  const prevByWeekday = useMemo(() => {
    const out: Record<number, Record<string, string>> = {};
    if (!prevWeek) return out;
    for (const d of prevWeek.days) {
      if (d.rest) continue;
      const logged = loggedForDate(dayDate(prevWeek, d.weekday));
      const map: Record<string, string> = {};
      for (const ex of d.exercises) {
        const lg = logged[ex.name.toLowerCase()];
        map[ex.name.toLowerCase()] = `${prescOf(ex)}${lg ? ` · ${lg.replace("logged ", "")}` : ""}`;
      }
      out[d.weekday] = map;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevWeek, live, athleteId]);

  // ---- shared exercise DB (single store, every coach reads & writes it) ----
  // Add any of these {name, mainLift} to the DB that aren't already there, in a
  // single write (so publishing a whole week can file many at once).
  const ensureManyInDb = (items: { name: string; mainLift: ExRow["mainLift"] }[]) => {
    const have = new Set(exercises.map((x) => x.name.toLowerCase()));
    const additions: DbExercise[] = [];
    for (const it of items) {
      const clean = it.name.trim();
      const lc = clean.toLowerCase();
      if (!clean || lc === "new exercise" || have.has(lc)) continue;
      have.add(lc);
      additions.push({ id: uid("db"), name: clean, group: groupFromName(clean, it.mainLift) });
    }
    if (!additions.length) return;
    const list = [...additions, ...exercises];
    setExercises(list);
    saveExercises(list);
  };
  const ensureInDb = (name: string, mainLift: ExRow["mainLift"]) => ensureManyInDb([{ name, mainLift }]);

  // ---- row ops ----
  const insertInto = (list: ExRow[], row: ExRow, beforeExId?: string | null): ExRow[] => {
    const out = list.filter((e) => e.id !== row.id);
    const idx = beforeExId ? out.findIndex((e) => e.id === beforeExId) : -1;
    if (idx >= 0) out.splice(idx, 0, row);
    else out.push(row);
    return out;
  };
  const addRow = (dayId: string, row: ExRow, beforeExId?: string | null) =>
    mutDay(dayId, (d) => ({ ...d, rest: false, exercises: insertInto(d.exercises, row, beforeExId) }));
  const removeRow = (dayId: string, exId: string) =>
    mutDay(dayId, (d) => ({ ...d, exercises: d.exercises.filter((e) => e.id !== exId) }));
  const dupRow = (dayId: string, exId: string) =>
    mutDay(dayId, (d) => {
      const i = d.exercises.findIndex((e) => e.id === exId);
      if (i < 0) return d;
      const list = [...d.exercises];
      list.splice(i + 1, 0, { ...d.exercises[i], id: uid("ex") });
      return { ...d, exercises: list };
    });
  const nudge = (dayId: string, exId: string, dir: -1 | 1) =>
    mutDay(dayId, (d) => {
      const i = d.exercises.findIndex((e) => e.id === exId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.exercises.length) return d;
      const list = [...d.exercises];
      [list[i], list[j]] = [list[j], list[i]];
      return { ...d, exercises: list };
    });

  // ---- option B (alternate session) ops ----
  const setDayNote = (dayId: string, note: string) => mutDay(dayId, (d) => ({ ...d, note }));
  const addAlt = (dayId: string) => mutDay(dayId, (d) => ({ ...d, alt: [blankRow()] }));
  const removeAlt = (dayId: string) => mutDay(dayId, (d) => ({ ...d, alt: undefined }));
  const altMutRow = (dayId: string, exId: string, patch: Partial<ExRow>) =>
    mutDay(dayId, (d) => ({ ...d, alt: (d.alt ?? []).map((e) => (e.id === exId ? { ...e, ...patch } : e)) }));
  const altAddRow = (dayId: string) => mutDay(dayId, (d) => ({ ...d, alt: [...(d.alt ?? []), blankRow()] }));
  const altRemoveRow = (dayId: string, exId: string) =>
    mutDay(dayId, (d) => ({ ...d, alt: (d.alt ?? []).filter((e) => e.id !== exId) }));
  const altNudge = (dayId: string, exId: string, dir: -1 | 1) =>
    mutDay(dayId, (d) => {
      const list = [...(d.alt ?? [])];
      const i = list.findIndex((e) => e.id === exId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return d;
      [list[i], list[j]] = [list[j], list[i]];
      return { ...d, alt: list };
    });

  // ---- day ops ----
  const clearDay = (dayId: string) => mutDay(dayId, (d) => ({ ...d, rest: true, exercises: [] }));
  // Turning a day into a training day also DATES the week (to this week) if it
  // wasn't dated — otherwise it can't land on the calendar / weeks grid.
  const makeTraining = (dayId: string) =>
    mutWeek((w) => ({
      ...w,
      startDate: w.startDate ?? mondayOf(localIso(new Date())),
      days: w.days.map((d) => (d.id === dayId ? { ...d, rest: false, exercises: [blankRow()] } : d)),
    }));
  const moveDay = (dayId: string, newWeekday: number) =>
    mutWeek((w) => {
      const occupant = w.days.find((d) => d.weekday === newWeekday && d.id !== dayId);
      const mover = w.days.find((d) => d.id === dayId);
      if (!mover) return w;
      const from = mover.weekday;
      return {
        ...w,
        days: w.days.map((d) => {
          if (d.id === dayId) return { ...d, weekday: newWeekday };
          if (occupant && d.id === occupant.id) return { ...d, weekday: from };
          return d;
        }),
      };
    });
  const duplicateDay = (dayId: string) =>
    mutWeek((w) => {
      const src = w.days.find((d) => d.id === dayId);
      if (!src) return w;
      // fill the next rest day after this weekday (in the week's own order)
      const order = weekOrder(w);
      const start = order.indexOf(src.weekday);
      let target: Day | undefined;
      for (let k = 1; k <= order.length; k++) {
        const wd = order[(start + k) % order.length];
        const cand = w.days.find((d) => d.weekday === wd);
        if (cand && (cand.rest || cand.exercises.length === 0)) { target = cand; break; }
      }
      if (!target) { alert("No empty day to copy into — clear a day first."); return w; }
      const copyEx = src.exercises.map((e) => ({ ...e, id: uid("ex") }));
      return { ...w, days: w.days.map((d) => (d.id === target!.id ? { ...d, rest: false, exercises: copyEx } : d)) };
    });

  // ---- drag & drop with snap indicator ----
  const rowDragOver = (e: React.DragEvent, dayId: string, exId: string) => {
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = e.clientY - r.top > r.height / 2;
    const dayEx = week.days.find((d) => d.id === dayId)?.exercises ?? [];
    const idx = dayEx.findIndex((x) => x.id === exId);
    const beforeExId = after ? (dayEx[idx + 1]?.id ?? null) : exId;
    setDrop({ dayId, beforeExId });
  };
  const isDropBefore = (dayId: string, exId: string) => drop?.dayId === dayId && drop?.beforeExId === exId;
  const isDropEnd = (dayId: string) => drop?.dayId === dayId && drop?.beforeExId === null;

  const handleDrop = (e: React.DragEvent, dstDayId: string) => {
    e.preventDefault();
    const target = drop && drop.dayId === dstDayId ? drop.beforeExId : null;
    setDrop(null);
    setDragEx(null);
    const raw = e.dataTransfer.getData(DRAG);
    if (!raw) return;
    const p = JSON.parse(raw) as { kind: string; dayId?: string; exId?: string; dbId?: string };
    if (p.kind === "db") {
      const ex = exercises.find((x) => x.id === p.dbId);
      if (ex) addRow(dstDayId, dbToRow(ex), target);
      return;
    }
    if (p.kind !== "row" || !p.dayId || !p.exId) return;
    const src = week.days.find((d) => d.id === p.dayId)?.exercises.find((x) => x.id === p.exId);
    if (!src || (p.dayId === dstDayId && p.exId === target)) return;
    mutWeek((w) => ({
      ...w,
      days: w.days.map((d) => {
        if (d.id === p.dayId && d.id === dstDayId) return { ...d, exercises: insertInto(d.exercises, src, target) };
        if (d.id === p.dayId) return { ...d, exercises: d.exercises.filter((x) => x.id !== src.id) };
        if (d.id === dstDayId) return { ...d, rest: false, exercises: insertInto(d.exercises, src, target) };
        return d;
      }),
    }));
  };

  // ---- week ops ----
  const addWeek = () =>
    mutMeso((m) => {
      const w = progressWeek(m.weeks[m.weeks.length - 1], `WEEK ${m.weeks.length + 1}`);
      setWeekId(w.id);
      return { ...m, weeks: [...m.weeks, w] };
    });
  // Copy this week forward N times, each progressed from the one before it.
  const copyForwardMany = (n: number) =>
    mutMeso((m) => {
      const weeks = [...m.weeks];
      let src = week;
      let firstNew: string | null = null;
      for (let i = 0; i < n; i++) {
        const w = progressWeek(src, `WEEK ${weeks.length + 1}`, { rpeDelta, loadPct, fixedDelta, compoundsOnly });
        weeks.push(w);
        src = w;
        if (i === 0) firstNew = w.id;
      }
      if (firstNew) setWeekId(firstNew);
      return { ...m, weeks };
    });
  const addDeload = () =>
    mutMeso((m) => {
      const w = deloadWeek(week, "DELOAD");
      setWeekId(w.id);
      return { ...m, weeks: [...m.weeks, w] };
    });
  const addMeso = () =>
    commit({
      ...program,
      mesocycles: [
        ...program.mesocycles,
        { id: uid("meso"), name: `Block ${program.mesocycles.length + 1}`, color: "#2c455d", weeks: [{ ...progressWeek(week, "WEEK 1"), status: "draft" }] },
      ],
    });

  // Set the week's start date — the exact day chosen becomes the week's start
  // day (pick a Wednesday and the week runs Wed…Tue).
  const setWeekDate = (m: typeof meso, w: Week, dateStr: string) => {
    if (!dateStr) return;
    commit({
      ...program,
      mesocycles: program.mesocycles.map((mm) =>
        mm.id === m.id ? { ...mm, weeks: mm.weeks.map((x) => (x.id === w.id ? { ...x, startDate: dateStr } : x)) } : mm,
      ),
    });
  };

  // Removing a week or a block is double-verified so it can't happen by accident.
  const removeWeek = (m: typeof meso, w: Week) => {
    const lastWeek = m.weeks.length === 1;
    const lastMeso = program.mesocycles.length === 1;
    if (lastWeek && lastMeso) {
      alert("This is the only week of the only block — a program needs at least one week. Add another first.");
      return;
    }
    const q1 = lastWeek
      ? `Remove ${w.name}? It’s the only week in ${m.name}, so the whole block is removed.`
      : `Remove ${w.name} from ${m.name}?`;
    if (!confirm(q1)) return;
    if (!confirm(`Second check — this permanently deletes ${lastWeek ? m.name : w.name} and its sessions. This can’t be undone. Delete it?`)) return;

    if (lastWeek) {
      const rest = program.mesocycles.filter((x) => x.id !== m.id);
      commit({ ...program, currentWeekId: w.id === program.currentWeekId ? undefined : program.currentWeekId, mesocycles: rest });
      setMesoId(rest[0].id);
      setWeekId(rest[0].weeks[rest[0].weeks.length - 1].id);
      return;
    }
    const remaining = m.weeks.filter((x) => x.id !== w.id);
    commit({
      ...program,
      currentWeekId: w.id === program.currentWeekId ? undefined : program.currentWeekId,
      mesocycles: program.mesocycles.map((mm) => (mm.id === m.id ? { ...mm, weeks: remaining } : mm)),
    });
    if (weekId === w.id) setWeekId(remaining[remaining.length - 1].id);
  };

  // Rename a block / week. If it's the block or week the athlete is currently on,
  // push the new label straight to their dashboard too.
  const renameMeso = (m: typeof meso, name: string) => {
    const clean = name.trim();
    setRenaming(null);
    if (!clean || clean === m.name) return;
    commit({ ...program, mesocycles: program.mesocycles.map((mm) => (mm.id === m.id ? { ...mm, name: clean } : mm)) });
    if (live && m.weeks.some((w) => w.id === currentId)) setProgramLabels(athleteId, { blockName: clean });
  };
  const renameWeek = (w: Week, name: string) => {
    const clean = name.trim();
    setRenaming(null);
    if (!clean || clean === w.name) return;
    commit({ ...program, mesocycles: program.mesocycles.map((mm) => ({ ...mm, weeks: mm.weeks.map((x) => (x.id === w.id ? { ...x, name: clean } : x)) })) });
    if (live && w.id === currentId) setProgramLabels(athleteId, { weekName: clean });
  };

  const removeMeso = (m: typeof meso) => {
    if (program.mesocycles.length === 1) {
      alert("A program needs at least one block.");
      return;
    }
    if (!confirm(`Remove the whole ${m.name} block and its ${m.weeks.length} week(s)?`)) return;
    if (!confirm(`Second check — this permanently deletes ${m.name}. This can’t be undone. Delete it?`)) return;
    const rest = program.mesocycles.filter((x) => x.id !== m.id);
    commit({ ...program, currentWeekId: m.weeks.some((w) => w.id === program.currentWeekId) ? undefined : program.currentWeekId, mesocycles: rest });
    setMesoId(rest[0].id);
    setWeekId(rest[0].weeks[rest[0].weeks.length - 1].id);
  };

  const publish = () => {
    if (!confirm(`Publish ${meso.name} · ${week.name} to ${athleteName}?\n\nIt becomes their current block — visible only to them, replacing the week in their app.`)) return;
    if (live) publishProgramWeek(athleteId, toTemplate(week), { blockStart: week.startDate, weekStartsOn: startWeekday(week) ?? undefined, blockName: meso.name, weekName: week.name });
    // any exercises typed here should exist in the shared database (batched)
    ensureManyInDb(week.days.flatMap((d) => d.exercises.map((ex) => ({ name: ex.name, mainLift: ex.mainLift }))));
    mutProgram((p) => {
      const marked: Program = {
        ...p,
        mesocycles: p.mesocycles.map((m) =>
          m.id === meso.id ? { ...m, weeks: m.weeks.map((w) => (w.id === week.id ? { ...w, status: "published" as const } : w)) } : m,
        ),
      };
      // "ON NOW" tracks the week containing today — not whichever we just published.
      return { ...marked, currentWeekId: weekForToday(marked, localIso(new Date())) };
    });
    if (live) void notifyAthletePublished(athleteId, meso.name);
    alert(live ? `Published to ${athleteName} — it’s live in their app now, and only they can see it.` : `Marked published. ${athleteName} is a demo athlete, so nothing is sent.`);
  };

  // Publish every dated, training-bearing week of the block at once — each week
  // lands on its own start date so the whole block rolls out in one action.
  const publishBlock = () => {
    const weeks = meso.weeks.filter((w) => !w.hidden && w.startDate && w.days.some((d) => d.exercises.length));
    if (!weeks.length) {
      alert("No dated weeks with training in this block yet. Give each week a start date first.");
      return;
    }
    if (!confirm(`Publish all ${weeks.length} week(s) of ${meso.name} to ${athleteName}?\n\nEach week goes live on its own start date.`)) return;
    if (live) {
      for (const w of weeks) {
        publishProgramWeek(athleteId, toTemplate(w), { blockStart: w.startDate, weekStartsOn: startWeekday(w) ?? undefined, blockName: meso.name, weekName: w.name });
      }
    }
    ensureManyInDb(weeks.flatMap((w) => w.days.flatMap((d) => d.exercises.map((ex) => ({ name: ex.name, mainLift: ex.mainLift })))));
    mutProgram((p) => {
      const marked: Program = {
        ...p,
        mesocycles: p.mesocycles.map((m) =>
          m.id === meso.id
            ? { ...m, weeks: m.weeks.map((w) => (weeks.some((x) => x.id === w.id) ? { ...w, status: "published" as const } : w)) }
            : m,
        ),
      };
      return { ...marked, currentWeekId: weekForToday(marked, localIso(new Date())) };
    });
    if (live) void notifyAthletePublished(athleteId, meso.name);
    alert(live ? `Published ${weeks.length} week(s) of ${meso.name} to ${athleteName}.` : `Marked published. ${athleteName} is a demo athlete, so nothing is sent.`);
  };

  // Hide a week/block from the builder without deleting it — reversible, and
  // never touches what the athlete already has. Can't hide the last visible one.
  const toggleWeekHidden = (m: typeof meso, w: Week) => {
    const visible = m.weeks.filter((x) => !x.hidden);
    if (!w.hidden && visible.length === 1) {
      alert("This is the only visible week in the block — hide the block instead, or add another week first.");
      return;
    }
    commit({
      ...program,
      mesocycles: program.mesocycles.map((mm) =>
        mm.id === m.id ? { ...mm, weeks: mm.weeks.map((x) => (x.id === w.id ? { ...x, hidden: !x.hidden } : x)) } : mm,
      ),
    });
    if (!w.hidden && weekId === w.id) {
      const next = visible.find((x) => x.id !== w.id);
      if (next) setWeekId(next.id);
    }
  };
  const toggleMesoHidden = (m: typeof meso) => {
    const visible = program.mesocycles.filter((x) => !x.hidden);
    if (!m.hidden && visible.length === 1) {
      alert("This is the only visible block — you can't hide all of them.");
      return;
    }
    commit({ ...program, mesocycles: program.mesocycles.map((mm) => (mm.id === m.id ? { ...mm, hidden: !mm.hidden } : mm)) });
    if (!m.hidden && mesoId === m.id) {
      const next = visible.find((x) => x.id !== m.id);
      if (next) {
        setMesoId(next.id);
        setWeekId(next.weeks[next.weeks.length - 1].id);
      }
    }
  };

  const jumpToCurrent = () => {
    if (!current) return;
    setMesoId(current.meso.id);
    setWeekId(current.week.id);
  };

  // ---- exercise DB panel ----
  const shownDb = exercises.filter(
    (x) => (dbFilter === "all" || x.group === dbFilter) && x.name.toLowerCase().includes(dbSearch.toLowerCase()),
  );
  const addDbExercise = () => {
    const name = newExName.trim();
    if (!name) return;
    const ex: DbExercise = { id: uid("db"), name, group: dbFilter === "all" ? "accessory" : dbFilter, video: newExVideo.trim() || undefined };
    const list = [ex, ...exercises];
    setExercises(list);
    saveExercises(list);
    setNewExName("");
    setNewExVideo("");
  };

  return (
    <div className="cc-page">
      <div className="cc-builder">
        {/* ---------------- left: mesocycles + copy ---------------- */}
        <aside className="cc-side-panel">
          <div>
            <div className="cc-side-k">Mesocycles</div>
            {current && (
              <div className="cc-current-chip">
                <span className="cc-now-dot" />
                <span>On now · <strong>{current.meso.name}</strong> · {current.week.name}</span>
                <button onClick={jumpToCurrent}>Jump</button>
              </div>
            )}
            {program.mesocycles.map((m) => {
              const hasCurrent = m.weeks.some((w) => w.id === currentId);
              return (
                <div key={m.id} className="cc-meso" style={{ marginBottom: 10, marginTop: 10, opacity: m.hidden ? 0.5 : undefined, borderColor: hasCurrent ? "color-mix(in srgb, var(--good) 40%, transparent)" : undefined }}>
                  <div className="cc-meso-name">
                    <span className="cc-meso-swatch" style={{ background: m.color }} />
                    {renaming?.kind === "meso" && renaming.id === m.id ? (
                      <input
                        autoFocus
                        className="cc-rename-input"
                        defaultValue={m.name}
                        onBlur={(e) => renameMeso(m, e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRenaming(null); }}
                      />
                    ) : (
                      <button
                        title="Click to open · double-click to rename"
                        style={{ border: "none", background: "transparent", padding: 0, flex: 1, textAlign: "left", font: "inherit", color: "inherit", cursor: "pointer" }}
                        onClick={() => { setMesoId(m.id); setWeekId(m.weeks[m.weeks.length - 1].id); }}
                        onDoubleClick={(e) => { e.stopPropagation(); setRenaming({ kind: "meso", id: m.id }); }}
                      >
                        {m.name}
                      </button>
                    )}
                    <span style={{ font: "400 10px/1 var(--font-body)", color: "var(--muted)" }}>{m.weeks.filter((w) => !w.hidden).length} wk</span>
                    <button className="cc-wk-del" title={m.hidden ? "Un-hide this block" : "Hide this block (keeps it, just declutters)"} style={{ fontSize: 12 }} onClick={() => toggleMesoHidden(m)}>{m.hidden ? "◉" : "⊘"}</button>
                    <button className="cc-wk-del" title="Remove this block" onClick={() => removeMeso(m)}>×</button>
                  </div>
                  {m.id === meso.id &&
                    m.weeks.map((w) => (
                      <div key={w.id} className={`cc-week-item${w.id === currentId ? " cc-current" : ""}`} aria-current={w.id === week.id} style={w.hidden ? { opacity: 0.42 } : undefined} onClick={() => setWeekId(w.id)}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          {renaming?.kind === "week" && renaming.id === w.id ? (
                            <input
                              autoFocus
                              className="cc-rename-input"
                              defaultValue={w.name}
                              onClick={(e) => e.stopPropagation()}
                              onBlur={(e) => renameWeek(w, e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRenaming(null); }}
                            />
                          ) : (
                            <span className="cc-wk-name" title="Double-click to rename" style={{ cursor: "text" }} onDoubleClick={(e) => { e.stopPropagation(); setRenaming({ kind: "week", id: w.id }); }}>{w.name}</span>
                          )}
                          {w.startDate && <span style={{ font: "400 9px/1 var(--font-body)", color: "var(--muted)" }}>{fmtShort(w.startDate)}</span>}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {w.id === currentId && (
                            <span className="cc-now-badge"><span className="cc-now-dot" style={{ boxShadow: "none" }} />ON NOW</span>
                          )}
                          {(() => { const s = weekState(athleteId, w, live); return <span className={`cc-wk-status cc-st-${s}`}>{WEEK_STATE_LABEL[s]}</span>; })()}
                          <button className="cc-wk-del" title={w.hidden ? "Un-hide this week" : "Hide this week"} style={{ fontSize: 11 }} onClick={(e) => { e.stopPropagation(); toggleWeekHidden(m, w); }}>{w.hidden ? "◉" : "⊘"}</button>
                          <button className="cc-wk-del" title="Remove this week" onClick={(e) => { e.stopPropagation(); removeWeek(m, w); }}>×</button>
                        </div>
                      </div>
                    ))}
                  {m.id === meso.id && <button className="cc-dash-add" onClick={addWeek}>+ Week</button>}
                </div>
              );
            })}
            <button className="cc-dash-add" onClick={addMeso}>+ New mesocycle · same layout</button>

            {/* share this block with other coaches / import a shared one */}
            <div className="cc-meso" style={{ marginTop: 12 }}>
              <div className="cc-side-k">Share with coaches</div>
              <button
                className="cc-dash-add"
                onClick={() => { shareProgram(meso, coachName); alert(`Shared "${meso.name}" to the coach library.`); }}
              >
                ↗ Share “{meso.name}”
              </button>
              {getSharedPrograms().length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div className="cc-copy-lab">Shared library</div>
                  {getSharedPrograms().map((sp) => (
                    <div key={sp.id} className="cc-week-item" style={{ cursor: "default" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                        <span className="cc-wk-name" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sp.name}</span>
                        <span style={{ font: "400 9px/1 var(--font-body)", color: "var(--muted)" }}>{sp.weeks} wk · {sp.author}</span>
                      </div>
                      <button
                        className="cc-mini"
                        title="Add a copy to this athlete"
                        onClick={() => {
                          const clone = cloneShared(sp.mesocycle);
                          commit({ ...program, mesocycles: [...program.mesocycles, clone] });
                          setMesoId(clone.id);
                          setWeekId(clone.weeks[clone.weeks.length - 1].id);
                        }}
                      >
                        Import
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="cc-meso">
            <div className="cc-side-k">Copy week forward</div>
            <p style={{ font: "400 10.5px/1.4 var(--font-body)", color: "var(--muted)", margin: "0 0 8px" }}>
              Write one week, then roll it out several — each week progressed from the one before.
            </p>

            <div className="cc-copy-lab">RPE rows · +per week</div>
            <div className="cc-copy-seg">
              {[0, 0.5, 1].map((d) => (
                <button key={d} aria-current={rpeDelta === d} onClick={() => setRpeDelta(d)}>{d === 0 ? "hold" : `+${d}`}</button>
              ))}
            </div>

            <div className="cc-copy-lab">Load / %1RM rows · +per week</div>
            <div className="cc-copy-seg">
              {[0, 2, 3].map((p) => (
                <button key={p} aria-current={loadPct === p} onClick={() => setLoadPct(p)}>{p === 0 ? "hold" : `+${p}%`}</button>
              ))}
            </div>

            <div className="cc-copy-lab">Fixed-load rows · +kg per week</div>
            <div className="cc-copy-seg">
              {[0, 2.5, 5].map((k) => (
                <button key={k} aria-current={fixedDelta === k} onClick={() => setFixedDelta(k)}>{k === 0 ? "hold" : `+${k}`}</button>
              ))}
            </div>

            <div className="cc-copy-lab">Apply to</div>
            <div className="cc-copy-seg">
              <button aria-current={!compoundsOnly} onClick={() => setCompoundsOnly(false)}>All exercises</button>
              <button aria-current={compoundsOnly} onClick={() => setCompoundsOnly(true)}>Compounds only</button>
            </div>

            <div className="cc-copy-lab">How many weeks</div>
            <div className="cc-copy-seg">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <button key={n} aria-current={copyN === n} onClick={() => setCopyN(n)}>{n}</button>
              ))}
            </div>

            <button className="cc-fullbtn" style={{ marginTop: 14, background: "var(--navy)", color: "#fff", borderColor: "var(--navy)" }} onClick={() => copyForwardMany(copyN)}>
              Copy → {copyN} {copyN === 1 ? "week" : "weeks"}
            </button>
            <button className="cc-dash-add" style={{ marginTop: 8 }} onClick={addDeload}>+ Back-off deload week</button>
            <p style={{ font: "400 9.5px/1.4 var(--font-body)", color: "var(--muted)", margin: "8px 0 0" }}>
              Deload drops one set off every back-down (keeps the top lift) and takes 1 RPE off.
            </p>
          </div>
        </aside>

        {/* ---------------- centre: the week ---------------- */}
        <section>
          {/* autocomplete sources — exercise names from the shared DB, RPE steps */}
          <datalist id="ex-db">{exercises.map((x) => <option key={x.id} value={x.name} />)}</datalist>
          <datalist id="rpe-opts">{RPE_OPTS.map((r) => <option key={r} value={r} />)}</datalist>
          <div className="cc-build-head">
            <div>
              {onBack && (
                <button className="cc-mini" style={{ marginBottom: 10, padding: "9px 14px", fontSize: 11 }} onClick={onBack}>‹ Back to program viewer</button>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <Avatar src={avatar} name={athleteName} size={30} />
                <span style={{ font: "600 13px/1 var(--font-heading)", letterSpacing: ".04em", color: "var(--navy)" }}>{athleteName}</span>
              </div>
              <div className="cc-build-title">
                {meso.name} · {week.name}
                {week.id === currentId && <span className="cc-now-badge" style={{ marginLeft: 10, verticalAlign: "middle" }}><span className="cc-now-dot" style={{ boxShadow: "none" }} />ON NOW</span>}
              </div>
              <div className="cc-build-meta" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {(() => { const s = weekState(athleteId, week, live); return <span className={`cc-wk-status cc-st-${s}`}>{WEEK_STATE_LABEL[s]}</span>; })()}
                <span>{trainingDays.length} training days · {totalSets} sets programmed{live ? ` · ${stats.loggedSets} logged` : ""}</span>
                {week.startDate && <span>· {fmtRange(week.startDate)}</span>}
              </div>

              {/* Volume / variables for this week, from the athlete's logged loads. */}
              {live && (
                <div className="cc-wk-metrics" style={{ margin: "12px 0 4px" }}>
                  {(["squat", "bench", "deadlift"] as const).map((l) => (
                    <div key={l} className="cc-wk-metric">
                      <div className="cc-wk-metric-lift">{LIFT_LABEL[l]}</div>
                      <div className="cc-wk-metric-row">
                        <span>{stats.base[l].loggedSets}/{stats.base[l].planned} sets</span>
                        <span>{stats.base[l].vol ? tons(stats.base[l].vol) : "—"}</span>
                        <span>e1RM {stats.base[l].e1rm ? fmtKg(Math.round(stats.base[l].e1rm * 10) / 10) : "—"}</span>
                      </div>
                    </div>
                  ))}
                  <div className="cc-wk-metric cc-wk-metric-total">
                    <div className="cc-wk-metric-lift">TOTAL</div>
                    <div className="cc-wk-metric-row"><span>{tons(stats.totalVol)}</span><span>tonnage</span></div>
                  </div>
                </div>
              )}
              <div style={{ marginTop: 8 }}>
                <button className="cc-chip" aria-current={repRange} onClick={() => setRepRange((v) => !v)}>Rep ranges · {repRange ? "on" : "off"}</button>
              </div>
              <label className="cc-week-date">
                Week of
                <input type="date" value={week.startDate ?? ""} onChange={(e) => setWeekDate(meso, week, e.target.value)} />
                <span className="muted" style={{ font: "400 10px/1 var(--font-body)" }}>
                  {week.startDate ? `starts ${WEEKDAY_NAME[startWeekday(week)!].toLowerCase()} · the week runs from here` : "pick any day — the week starts there"}
                </span>
              </label>
            </div>
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              <MiniCalendar startDate={week.startDate} trainingWeekdays={trainingDays.map((d) => d.weekday)} onPick={(iso) => setWeekDate(meso, week, iso)} />
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button className="cc-mini cc-mini-solid" style={{ padding: "11px 16px", fontSize: 11 }} onClick={publish}>Publish week to athlete</button>
                <button className="cc-mini" style={{ padding: "9px 16px", fontSize: 11 }} onClick={publishBlock}>Publish full block →</button>
                <button className="cc-mini" style={{ padding: "9px 16px", fontSize: 11 }} onClick={() => copyForwardMany(copyN)}>Copy week forward (×{copyN})</button>
              </div>
            </div>
          </div>

          {orderedDays.map((d) =>
            d.rest || !d.exercises.length ? (
              <div key={d.id} className={`cc-day${week.status === "published" ? " cc-day-published" : ""}`}>
                <div className="cc-rest-day">
                  <span className="cc-day-name">{WEEKDAY_NAME[d.weekday]}</span>
                  <span className="cc-day-sub">rest day{dayDate(week, d.weekday) ? ` · ${fmtDay(dayDate(week, d.weekday)!)}` : ""}</span>
                  <div className="cc-day-actions">
                    <button className="cc-xbtn" onClick={() => makeTraining(d.id)}>+ Make training day</button>
                  </div>
                </div>
              </div>
            ) : (
              <div
                key={d.id}
                className={`cc-day${drop?.dayId === d.id ? " cc-drop-on" : ""}${week.status === "published" ? " cc-day-published" : ""}`}
                onDragOver={(e) => { e.preventDefault(); if (!drop || drop.dayId !== d.id) setDrop({ dayId: d.id, beforeExId: null }); }}
                onDragLeave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDrop((c) => (c?.dayId === d.id ? null : c)); }}
                onDrop={(e) => handleDrop(e, d.id)}
              >
                <div className="cc-day-head">
                  <span className="cc-day-name">{WEEKDAY_NAME[d.weekday]}{dayDate(week, d.weekday) ? ` · ${fmtDay(dayDate(week, d.weekday)!)}` : ""}</span>
                  <span className="cc-day-sub">training day · {d.exercises.length} exercises · {d.exercises.reduce((a, e) => a + e.sets, 0)} sets</span>
                  <div className="cc-day-actions">
                    <select className="cc-day-select" value={d.weekday} onChange={(e) => moveDay(d.id, Number(e.target.value))} title="Move to weekday">
                      {WEEK_ORDER.map((wd) => (
                        <option key={wd} value={wd}>{WEEKDAY_NAME[wd]}</option>
                      ))}
                    </select>
                    <button className="cc-xbtn" onClick={() => duplicateDay(d.id)}>Duplicate</button>
                    <button className="cc-xbtn" onClick={() => clearDay(d.id)}>Clear day</button>
                  </div>
                </div>

                <div className="cc-ex-cols cc-ex-colhead">
                  <span>Exercise · cue</span><span>Video</span><span>Sets</span><span>Reps</span><span>Intensity</span><span>Value</span><span>Suggest kg</span><span>Scheme</span><span style={{ textAlign: "right" }}>Move · copy · ×</span>
                </div>

                {d.exercises.map((ex) => (
                  <div
                    key={ex.id}
                    className={`cc-ex-row${dragEx === ex.id ? " cc-dragging" : ""}${isDropBefore(d.id, ex.id) ? " cc-drop-before cc-drop-before-dot" : ""}`}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData(DRAG, JSON.stringify({ kind: "row", dayId: d.id, exId: ex.id })); setDragEx(ex.id); }}
                    onDragEnd={() => { setDragEx(null); setDrop(null); }}
                    onDragOver={(e) => rowDragOver(e, d.id, ex.id)}
                    onDrop={(e) => { e.stopPropagation(); handleDrop(e, d.id); }}
                  >
                    <div className="cc-ex-cols">
                      <div className="cc-ex-grip">
                        <input className="cc-ex-name" list="ex-db" value={ex.name} onChange={(e) => mutRow(d.id, ex.id, { name: e.target.value })} onBlur={(e) => ensureInDb(e.target.value, ex.mainLift)} />
                        <input className="cc-ex-cue" placeholder="coach cue" value={ex.cue} onChange={(e) => mutRow(d.id, ex.id, { cue: e.target.value })} />
                        {loggedByWeekday[d.weekday]?.[ex.name.toLowerCase()] && (
                          <div className="cc-ex-logged">{loggedByWeekday[d.weekday][ex.name.toLowerCase()]}</div>
                        )}
                        {prevByWeekday[d.weekday]?.[ex.name.toLowerCase()] && (
                          <div className="cc-ex-prev">last wk · {prevByWeekday[d.weekday][ex.name.toLowerCase()]}</div>
                        )}
                      </div>
                      <input className="cc-in" placeholder="url" value={ex.video} onChange={(e) => mutRow(d.id, ex.id, { video: e.target.value })} />
                      <input className="cc-in" type="number" min={1} value={ex.sets} onChange={(e) => mutRow(d.id, ex.id, { sets: Math.max(1, Number(e.target.value)) })} />
                      {repRange || ex.scheme === "Accessory" ? (
                        <select className="cc-in" value={ex.reps} onChange={(e) => mutRow(d.id, ex.id, { reps: e.target.value })}>
                          {!REP_RANGES.includes(ex.reps) && <option value={ex.reps}>{ex.reps || "—"}</option>}
                          {REP_RANGES.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      ) : (
                        <input className="cc-in" value={ex.reps} onChange={(e) => mutRow(d.id, ex.id, { reps: e.target.value })} />
                      )}
                      <select
                        className="cc-in"
                        value={ex.intensity === "load" ? "fixed" : ex.intensity}
                        onChange={(e) => mutRow(d.id, ex.id, { intensity: e.target.value as IntensityType, ...(e.target.value === "failure" ? { value: "" } : {}) })}
                      >
                        <option value="rpe">RPE</option>
                        <option value="percent">%1RM</option>
                        <option value="fixed">Load</option>
                        <option value="failure">Failure</option>
                        <option value="seconds">Seconds</option>
                      </select>
                      {ex.intensity === "failure" ? (
                        <div className="cc-in" style={{ display: "grid", placeItems: "center", color: "var(--muted)", font: "500 10px/1 var(--font-body)", letterSpacing: ".05em" }} title="No target — the athlete pushes to failure.">TO FAILURE</div>
                      ) : ex.intensity === "seconds" ? (
                        <input className="cc-in" value={ex.value} placeholder="secs" title="Hold time in seconds (e.g. 40-60) — the athlete just marks it done" onChange={(e) => mutRow(d.id, ex.id, { value: e.target.value })} />
                      ) : ex.intensity === "rpe" ? (
                        <input className="cc-in" list="rpe-opts" value={ex.value} placeholder="RPE" title="Target RPE (5–10, or a range)" onChange={(e) => mutRow(d.id, ex.id, { value: e.target.value })} />
                      ) : ex.intensity === "percent" ? (
                        <input className="cc-in" value={ex.value} placeholder="%" title={pctToKg(ex) ? `${ex.value}% ≈ ${pctToKg(ex)} of their 1RM` : "% of 1RM (set their PR to compute kg)"} onChange={(e) => mutRow(d.id, ex.id, { value: e.target.value })} />
                      ) : (
                        <input className="cc-in" value={ex.value} placeholder="kg" title="Working load (kg) — the athlete can only go lighter" onChange={(e) => mutRow(d.id, ex.id, { value: e.target.value })} />
                      )}
                      {ex.intensity === "fixed" || ex.intensity === "load" || ex.intensity === "seconds" ? (
                        <div className="cc-in" style={{ display: "grid", placeItems: "center", color: "var(--muted)" }} title="This row already shows a concrete number — no separate suggestion needed.">—</div>
                      ) : (
                        <input className="cc-in" value={ex.suggest ?? ""} placeholder={ex.intensity === "percent" && pctToKg(ex) ? pctToKg(ex) : "kg"} title="Suggested working weight (kg) — shown to the athlete as a hint. It does NOT cap what they enter." onChange={(e) => mutRow(d.id, ex.id, { suggest: e.target.value })} />
                      )}
                      <select className="cc-in cc-in-scheme" value={ex.scheme} onChange={(e) => mutRow(d.id, ex.id, { scheme: e.target.value, ...(e.target.value === "Timed" ? { intensity: "seconds" as IntensityType, value: ex.intensity === "seconds" ? ex.value : "" } : {}) })}>
                        {!SCHEMES.includes(ex.scheme as (typeof SCHEMES)[number]) && <option value={ex.scheme}>{ex.scheme || "—"}</option>}
                        {SCHEMES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <div className="cc-row-ctl">
                        <button title="Up" onClick={() => nudge(d.id, ex.id, -1)}>↑</button>
                        <button title="Down" onClick={() => nudge(d.id, ex.id, 1)}>↓</button>
                        <button title="Duplicate" onClick={() => dupRow(d.id, ex.id)}>⧉</button>
                        <button title="Remove" onClick={() => removeRow(d.id, ex.id)}>×</button>
                      </div>
                    </div>
                  </div>
                ))}

                <button className={`cc-add-ex${isDropEnd(d.id) ? " cc-drop-before" : ""}`} onClick={() => addRow(d.id, blankRow())}>
                  + Add exercise · or drag one from the database
                </button>

                {/* ---- per-day note + Option B (alternate session) ---- */}
                <div className="cc-altwrap">
                  <textarea
                    className="cc-day-note"
                    placeholder="Note for the athlete (shown above the A / B choice) — e.g. “Pick B if your shoulder is still cranky.”"
                    value={d.note ?? ""}
                    onChange={(e) => setDayNote(d.id, e.target.value)}
                  />
                  {d.alt === undefined ? (
                    <button className="cc-xbtn cc-add-alt" onClick={() => addAlt(d.id)}>+ Add Option B session</button>
                  ) : (
                    <div className="cc-alt">
                      <div className="cc-alt-head">
                        <span className="cc-alt-badge">OPTION B</span>
                        <span className="cc-day-sub">the athlete can pick this instead of A · {d.alt.length} exercises</span>
                        <button className="cc-xbtn" onClick={() => removeAlt(d.id)}>Remove Option B</button>
                      </div>
                      <div className="cc-ex-cols cc-ex-colhead">
                        <span>Exercise · cue</span><span>Video</span><span>Sets</span><span>Reps</span><span>Intensity</span><span>Value</span><span>Suggest kg</span><span>Scheme</span><span style={{ textAlign: "right" }}>Move · ×</span>
                      </div>
                      {d.alt.map((ex) => (
                        <div key={ex.id} className="cc-ex-row">
                          <div className="cc-ex-cols">
                            <div className="cc-ex-grip">
                              <input className="cc-ex-name" list="ex-db" value={ex.name} onChange={(e) => altMutRow(d.id, ex.id, { name: e.target.value })} onBlur={(e) => ensureInDb(e.target.value, ex.mainLift)} />
                              <input className="cc-ex-cue" placeholder="coach cue" value={ex.cue} onChange={(e) => altMutRow(d.id, ex.id, { cue: e.target.value })} />
                            </div>
                            <input className="cc-in" placeholder="url" value={ex.video} onChange={(e) => altMutRow(d.id, ex.id, { video: e.target.value })} />
                            <input className="cc-in" type="number" min={1} value={ex.sets} onChange={(e) => altMutRow(d.id, ex.id, { sets: Math.max(1, Number(e.target.value)) })} />
                            {repRange || ex.scheme === "Accessory" ? (
                              <select className="cc-in" value={ex.reps} onChange={(e) => altMutRow(d.id, ex.id, { reps: e.target.value })}>
                                {!REP_RANGES.includes(ex.reps) && <option value={ex.reps}>{ex.reps || "—"}</option>}
                                {REP_RANGES.map((r) => <option key={r} value={r}>{r}</option>)}
                              </select>
                            ) : (
                              <input className="cc-in" value={ex.reps} onChange={(e) => altMutRow(d.id, ex.id, { reps: e.target.value })} />
                            )}
                            <select
                              className="cc-in"
                              value={ex.intensity === "load" ? "fixed" : ex.intensity}
                              onChange={(e) => altMutRow(d.id, ex.id, { intensity: e.target.value as IntensityType, ...(e.target.value === "failure" ? { value: "" } : {}) })}
                            >
                              <option value="rpe">RPE</option>
                              <option value="percent">%1RM</option>
                              <option value="fixed">Load</option>
                              <option value="failure">Failure</option>
                              <option value="seconds">Seconds</option>
                            </select>
                            {ex.intensity === "failure" ? (
                              <div className="cc-in" style={{ display: "grid", placeItems: "center", color: "var(--muted)", font: "500 10px/1 var(--font-body)", letterSpacing: ".05em" }}>TO FAILURE</div>
                            ) : ex.intensity === "seconds" ? (
                              <input className="cc-in" value={ex.value} placeholder="secs" onChange={(e) => altMutRow(d.id, ex.id, { value: e.target.value })} />
                            ) : ex.intensity === "rpe" ? (
                              <input className="cc-in" list="rpe-opts" value={ex.value} placeholder="RPE" onChange={(e) => altMutRow(d.id, ex.id, { value: e.target.value })} />
                            ) : ex.intensity === "percent" ? (
                              <input className="cc-in" value={ex.value} placeholder="%" onChange={(e) => altMutRow(d.id, ex.id, { value: e.target.value })} />
                            ) : (
                              <input className="cc-in" value={ex.value} placeholder="kg" onChange={(e) => altMutRow(d.id, ex.id, { value: e.target.value })} />
                            )}
                            {ex.intensity === "fixed" || ex.intensity === "load" || ex.intensity === "seconds" ? (
                              <div className="cc-in" style={{ display: "grid", placeItems: "center", color: "var(--muted)" }}>—</div>
                            ) : (
                              <input className="cc-in" value={ex.suggest ?? ""} placeholder="kg" title="Suggested working weight (kg) shown to the athlete as a hint (not a cap)." onChange={(e) => altMutRow(d.id, ex.id, { suggest: e.target.value })} />
                            )}
                            <select className="cc-in cc-in-scheme" value={ex.scheme} onChange={(e) => altMutRow(d.id, ex.id, { scheme: e.target.value, ...(e.target.value === "Timed" ? { intensity: "seconds" as IntensityType, value: ex.intensity === "seconds" ? ex.value : "" } : {}) })}>
                              {!SCHEMES.includes(ex.scheme as (typeof SCHEMES)[number]) && <option value={ex.scheme}>{ex.scheme || "—"}</option>}
                              {SCHEMES.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                            <div className="cc-row-ctl">
                              <button title="Up" onClick={() => altNudge(d.id, ex.id, -1)}>↑</button>
                              <button title="Down" onClick={() => altNudge(d.id, ex.id, 1)}>↓</button>
                              <button title="Remove" onClick={() => altRemoveRow(d.id, ex.id)}>×</button>
                            </div>
                          </div>
                        </div>
                      ))}
                      <button className="cc-add-ex" onClick={() => altAddRow(d.id)}>+ Add exercise to Option B</button>
                    </div>
                  )}
                </div>
              </div>
            ),
          )}
        </section>

        {/* ---------------- right: exercise database ---------------- */}
        <aside className="cc-side-panel">
          <div className="cc-meso">
            <div className="cc-side-k">Exercise database</div>
            <p style={{ font: "400 10px/1.4 var(--font-body)", color: "var(--muted)", margin: "0 0 10px" }}>
              Shared by every coach. Drag a name into a day, or click to add it to the last training day.
            </p>
            <input className="cc-db-search" placeholder="Search the database" value={dbSearch} onChange={(e) => setDbSearch(e.target.value)} />
            <div className="cc-db-filters">
              {(["all", "squat", "bench", "deadlift", "pull", "accessory"] as const).map((g) => (
                <button key={g} aria-current={dbFilter === g} onClick={() => setDbFilter(g)}>{g}</button>
              ))}
            </div>
            <div style={{ maxHeight: 360, overflowY: "auto" }}>
              {shownDb.map((ex) => (
                <div
                  key={ex.id}
                  className="cc-db-item"
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData(DRAG, JSON.stringify({ kind: "db", dbId: ex.id }))}
                  onClick={() => { const last = trainingDays[trainingDays.length - 1]; if (last) addRow(last.id, dbToRow(ex)); }}
                >
                  <div className="cc-db-name">{ex.name}</div>
                  <div className="cc-db-grp">{ex.group}</div>
                </div>
              ))}
              {!shownDb.length && <div className="cc-cell-s">No matches.</div>}
            </div>
            <div className="cc-side-k" style={{ marginTop: 14 }}>Add to the database</div>
            <input className="cc-db-search" style={{ marginBottom: 6 }} placeholder="Exercise name" value={newExName} onChange={(e) => setNewExName(e.target.value)} />
            <input className="cc-db-search" style={{ marginBottom: 8 }} placeholder="Video url (optional)" value={newExVideo} onChange={(e) => setNewExVideo(e.target.value)} />
            <button className="cc-fullbtn" style={{ background: "var(--navy)", color: "#fff", borderColor: "var(--navy)" }} onClick={addDbExercise}>Save exercise</button>
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ dates --- */
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function fmtDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getDate()} ${MON[d.getMonth()]}`;
}
function fmtShort(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return `wk of ${d.getDate()} ${MON[d.getMonth()]}`;
}
function fmtRange(startIso: string): string {
  const s = new Date(`${startIso}T00:00:00`);
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  return `${s.getDate()} ${MON[s.getMonth()]} – ${e.getDate()} ${MON[e.getMonth()]}`;
}

/**
 * Interactive month view: click any day to start the week there (the 7-day week
 * runs from the day you pick). Training days in the current week are filled;
 * arrows page through months so you can place a block weeks ahead.
 */
function MiniCalendar({ startDate, trainingWeekdays, onPick }: { startDate?: string; trainingWeekdays: number[]; onPick: (iso: string) => void }) {
  const today = localIso(new Date());
  const anchor = startDate ?? today;
  const [view, setView] = useState<{ y: number; m: number }>(() => {
    const d = new Date(`${anchor}T00:00:00`);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  // Follow the week when the coach changes its date elsewhere.
  const anchorKey = `${new Date(`${anchor}T00:00:00`).getFullYear()}-${new Date(`${anchor}T00:00:00`).getMonth()}`;
  const [lastAnchor, setLastAnchor] = useState(anchorKey);
  if (anchorKey !== lastAnchor) {
    const d = new Date(`${anchor}T00:00:00`);
    setView({ y: d.getFullYear(), m: d.getMonth() });
    setLastAnchor(anchorKey);
  }

  const inWeek = new Set<string>();
  if (startDate) {
    const start = new Date(`${startDate}T00:00:00`);
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      inWeek.add(localIso(d));
    }
  }
  const trainSet = new Set(trainingWeekdays);

  const { y: year, m: month } = view;
  const step = (delta: number) => setView(({ y, m }) => { const d = new Date(y, m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(localIso(new Date(year, month, day)));

  return (
    <div className="cc-minical">
      <div className="cc-minical-head">
        <button type="button" className="cc-minical-nav" onClick={() => step(-1)} aria-label="Previous month">‹</button>
        <div className="cc-minical-title">{["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"][month]} {year}</div>
        <button type="button" className="cc-minical-nav" onClick={() => step(1)} aria-label="Next month">›</button>
      </div>
      <div className="cc-minical-grid">
        {["M", "T", "W", "T", "F", "S", "S"].map((w, i) => (
          <span key={i} className="cc-minical-wd">{w}</span>
        ))}
        {cells.map((iso, i) => {
          if (!iso) return <span key={i} />;
          const wd = new Date(`${iso}T00:00:00`).getDay();
          const on = inWeek.has(iso);
          const train = on && trainSet.has(wd); // made = has a session
          const rest = on && !train; // in the week but no session
          const isToday = iso === today;
          const isStart = iso === startDate;
          return (
            <button
              type="button"
              key={i}
              title={`Start this week on ${fmtDay(iso)}`}
              onClick={() => onPick(iso)}
              className={`cc-minical-day cc-minical-day-btn${on ? " cc-mc-on" : ""}${train ? " cc-mc-train" : ""}${rest ? " cc-mc-rest" : ""}${isToday ? " cc-mc-today" : ""}${isStart ? " cc-mc-start" : ""}`}
            >
              {Number(iso.slice(-2))}
            </button>
          );
        })}
      </div>
      <div className="cc-minical-legend">
        <span><i className="cc-mc-swatch cc-mc-train" /> made</span>
        <span><i className="cc-mc-swatch cc-mc-rest" /> rest</span>
        <span><i className="cc-mc-swatch cc-mc-on" /> this week</span>
      </div>
      <p style={{ font: "400 9.5px/1.4 var(--font-body)", color: "var(--muted)", margin: "8px 0 0" }}>Click a day to start the week there.</p>
    </div>
  );
}
