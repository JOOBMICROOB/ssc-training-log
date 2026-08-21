import { useMemo, useState } from "react";
import { loadProgram, weekOrder, dayDate, weekForToday, WEEKDAY_NAME, diffDay, rowPresc, type Week, type ExRow, type DayDiff } from "./coachProgram";
import { DiffLine } from "./DiffLine";
import { weekState, WEEK_STATE_LABEL } from "./coachStats";
import { getSessionFor } from "../../lib/data/athleteData";
import { epleyE1rm } from "../../lib/calc/epley";
import { fmtKg } from "../../lib/calc/records";
import { Avatar } from "./Avatar";
import type { MainLift } from "../../lib/program/program";

/**
 * Program viewer (Program & Planner → 3 · Program, the review page). Shows a
 * whole BLOCK: every week stacked vertically, each with its per-lift metrics
 * (planned sets · logged tonnage · best e1RM) on top so you can read the block's
 * progression at a glance, then expand any week to the session detail with the
 * athlete's logged loads. Live athlete = real logs; demo = prescribed plan only.
 */

type Layout = "rows" | "cols"; // rows = weeks stacked / days across · cols = weeks across / days stacked
const LAYOUT_KEY = "ssc.coach.viewLayout";

type ViewSet = { reps: string; target: string; loggedKg: number | null; rpe: number | null; note: string };
type ViewEx = { name: string; mainLift: MainLift | null; scheme: string; sets: ViewSet[] };
type ViewDay = { weekday: number; date: string | null; rest: boolean; exercises: ViewEx[]; sessionRpe: number | null; pain: number | null; diff: DayDiff };

const LIFTS: MainLift[] = ["squat", "bench", "deadlift"];
const LIFT_LABEL: Record<MainLift, string> = { squat: "SQUAT", bench: "BENCH", deadlift: "DEADLIFT" };
const parseReps = (s: string) => parseInt(s, 10) || 1;
const nf = (n: number) => Math.round(n).toLocaleString("nl-BE");
const tons = (kg: number) => (kg >= 1000 ? `${(kg / 1000).toFixed(1)} t` : `${nf(kg)} kg`);
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const fmtDay = (iso: string) => { const d = new Date(`${iso}T00:00:00`); return `${d.getDate()} ${MON[d.getMonth()]}`; };
const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function fmtRange(startDate?: string) {
  if (!startDate) return "not dated";
  const s = new Date(`${startDate}T00:00:00`); const e = new Date(s); e.setDate(e.getDate() + 6);
  return `${s.getDate()} ${MON[s.getMonth()]} – ${e.getDate()} ${MON[e.getMonth()]}`;
}
function rowTarget(r: ExRow): string {
  if (r.intensity === "seconds") return `${r.value || "?"} s`;
  if (r.intensity === "backoff") return `−${r.value || "?"}% off top set`;
  if (r.intensity === "load" || r.intensity === "fixed") return `${r.value} kg`;
  // Advisory suggested kg (RPE / % / to-failure rows) shown alongside the target.
  const sug = r.suggest?.trim() ? ` · ~${r.suggest.trim()} kg` : "";
  if (r.intensity === "failure") return `to failure${sug}`;
  if (r.intensity === "percent") return `${r.value}%${sug}`;
  return (r.value ? `RPE${r.value}` : "") + sug;
}

function buildDays(week: Week, live: boolean, athleteId: string, prevWeek: Week | null): ViewDay[] {
  return weekOrder(week).map((wd) => {
    const d = week.days.find((x) => x.weekday === wd)!;
    const date = dayDate(week, wd);
    const rest = d.rest || !d.exercises.length;
    // The prescription always comes from what the coach BUILT (so drafts show);
    // the athlete's logged loads (if any) are overlaid on top, by position.
    const session = live && date && !rest ? getSessionFor(athleteId, date) : null;
    // Diff vs the same weekday last week (null prevWeek ⇒ block's first week).
    const prevRows = prevWeek ? (() => { const pd = prevWeek.days.find((p) => p.weekday === wd); return pd && !pd.rest ? pd.exercises : []; })() : null;
    return {
      weekday: wd,
      date,
      rest,
      diff: diffDay(d.exercises, prevRows),
      sessionRpe: session?.sessionRpe ?? null,
      pain: session?.pain ?? null,
      exercises: d.exercises.map((r, ei) => {
        const sEx = session?.exercises[ei];
        return {
          name: r.name,
          mainLift: r.mainLift,
          scheme: r.scheme,
          sets: Array.from({ length: r.sets }, (_, si) => {
            const st = sEx?.sets[si];
            const real = st && !st.prefill;
            return { reps: r.reps, target: rowTarget(r), loggedKg: real ? st!.weightKg : null, rpe: real ? st!.rpe : null, note: st?.note ?? "" };
          }),
        };
      }),
    };
  });
}

type LiftStat = { planned: number; loggedSets: number; vol: number; e1rm: number };
function computeStats(days: ViewDay[]) {
  const base: Record<MainLift, LiftStat> = {
    squat: { planned: 0, loggedSets: 0, vol: 0, e1rm: 0 },
    bench: { planned: 0, loggedSets: 0, vol: 0, e1rm: 0 },
    deadlift: { planned: 0, loggedSets: 0, vol: 0, e1rm: 0 },
  };
  for (const dv of days)
    for (const ex of dv.exercises) {
      if (!ex.mainLift) continue;
      const b = base[ex.mainLift];
      for (const s of ex.sets) {
        b.planned += 1;
        if (s.loggedKg == null) continue;
        const reps = parseReps(s.reps);
        b.loggedSets += 1;
        b.vol += s.loggedKg * reps;
        b.e1rm = Math.max(b.e1rm, epleyE1rm(s.loggedKg, reps));
      }
    }
  const totalVol = LIFTS.reduce((s, l) => s + base[l].vol, 0);
  return { base, totalVol, anyLogged: totalVol > 0 };
}

export function ProgramViewer({ athleteId, athleteName, avatar, live, onOpenBuilder }: { athleteId: string; athleteName: string; avatar?: string; live: boolean; onOpenBuilder: () => void }) {
  const program = useMemo(() => loadProgram(athleteId), [athleteId]);
  // "Current" is the week that contains today, not a stored pointer.
  const currentId = useMemo(() => weekForToday(program, localIso(new Date())), [program]);
  const [mesoId, setMesoId] = useState(() => {
    const cur = program.mesocycles.find((m) => m.weeks.some((w) => w.id === currentId));
    return (cur ?? program.mesocycles[program.mesocycles.length - 1]).id;
  });
  const meso = program.mesocycles.find((m) => m.id === mesoId) ?? program.mesocycles[0];

  // Expanded weeks live here (not inside each WeekBlock) so they stay open
  // across data-sync re-renders.
  const [openWeeks, setOpenWeeks] = useState<Set<string>>(() => new Set(currentId ? [currentId] : []));
  const toggleWeek = (id: string) =>
    setOpenWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Layout preference is saved per coach profile and applies to every program.
  const [layout, setLayout] = useState<Layout>(() => (localStorage.getItem(LAYOUT_KEY) as Layout) || "rows");
  const chooseLayout = (l: Layout) => { setLayout(l); try { localStorage.setItem(LAYOUT_KEY, l); } catch { /* ignore */ } };

  return (
    <div className="cc-page">
      <div className="cc-head-row">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}><Avatar src={avatar} name={athleteName} size={40} />Program · {athleteName}</h1>
          <p className="cc-sub">The whole block, week by week — planned sets, logged tonnage and best e1RM on top of each week. Expand a week for the session detail.</p>
          <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
            <label className="cc-week-date">
              Block
              <select className="cc-day-select" value={mesoId} onChange={(e) => setMesoId(e.target.value)}>
                {program.mesocycles.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} · {m.weeks.length} wk</option>
                ))}
              </select>
            </label>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span className="cc-side-k" style={{ marginBottom: 0 }}>Layout</span>
              <button className="cc-chip" aria-current={layout === "rows"} onClick={() => chooseLayout("rows")}>Weeks stacked</button>
              <button className="cc-chip" aria-current={layout === "cols"} onClick={() => chooseLayout("cols")}>Weeks across</button>
            </div>
          </div>
        </div>
        <button className="cc-mini cc-mini-solid" style={{ padding: "11px 16px", fontSize: 11 }} onClick={onOpenBuilder}>Open program builder →</button>
      </div>

      <div className={layout === "cols" ? "cc-wk-cols" : "cc-wk-stack"}>
        {meso.weeks.map((w, wi) => (
          <WeekBlock key={w.id} week={w} prevWeek={wi > 0 ? meso.weeks[wi - 1] : null} live={live} athleteId={athleteId} current={w.id === currentId} athleteName={athleteName} layout={layout} open={layout === "cols" || openWeeks.has(w.id)} onToggle={() => toggleWeek(w.id)} />
        ))}
      </div>
    </div>
  );
}

function WeekBlock({ week, prevWeek, live, athleteId, current, athleteName, layout, open, onToggle }: { week: Week; prevWeek: Week | null; live: boolean; athleteId: string; current: boolean; athleteName: string; layout: Layout; open: boolean; onToggle: () => void }) {
  const cols = layout === "cols";
  const days = useMemo(() => buildDays(week, live, athleteId, prevWeek), [week, live, athleteId, prevWeek]);
  const { base, totalVol, anyLogged } = useMemo(() => computeStats(days), [days]);
  const state = weekState(athleteId, week, live);
  const totalChanges = days.reduce((s, dv) => s + dv.diff.count, 0);

  return (
    <div className={`cc-wk-block${current ? " cc-wk-current" : ""}${cols ? " cc-wk-block-col" : ""}`}>
      <div className="cc-wk-head">
        <div className="cc-wk-id">
          <div className="cc-wk-title">{week.name}
            {current && <span className="cc-now-badge" style={{ marginLeft: 8 }}><span className="cc-now-dot" style={{ boxShadow: "none" }} />ON NOW</span>}
          </div>
          <div className="cc-wk-dates">{fmtRange(week.startDate)} · <span className={`cc-wk-status cc-st-${state}`}>{WEEK_STATE_LABEL[state]}</span>
            {prevWeek && <span className={`cc-diff-count${totalChanges ? "" : " cc-diff-count-zero"}`} style={{ marginLeft: 8 }}>{totalChanges ? `${totalChanges} change${totalChanges === 1 ? "" : "s"} vs ${prevWeek.name}` : `no changes vs ${prevWeek.name}`}</span>}
          </div>
        </div>

        <div className="cc-wk-metrics">
          {LIFTS.map((l) => (
            <div key={l} className="cc-wk-metric">
              <div className="cc-wk-metric-lift">{LIFT_LABEL[l]}</div>
              <div className="cc-wk-metric-row"><span>{base[l].planned} sets</span><span>{base[l].vol ? tons(base[l].vol) : "—"}</span><span>e1RM {base[l].e1rm ? fmtKg(Math.round(base[l].e1rm * 10) / 10) : "—"}</span></div>
            </div>
          ))}
          <div className="cc-wk-metric cc-wk-metric-total">
            <div className="cc-wk-metric-lift">TOTAL</div>
            <div className="cc-wk-metric-row"><span>{tons(totalVol)}</span><span>tonnage</span></div>
          </div>
        </div>

        {!cols && <button className="cc-wk-toggle" onClick={onToggle}>{open ? "▴ Hide" : "▾ Sessions"}</button>}
      </div>

      {open && (
        <>
          {!anyLogged && live && <div className="cc-cell-s" style={{ padding: "0 16px 8px" }}>No sets logged in this week yet.</div>}
          {!live && <div className="cc-cell-s" style={{ padding: "0 16px 8px" }}>{athleteName} is a demo athlete — prescribed plan, no logged loads.</div>}
          <div className="cc-wk-days">
          {days.map((dv) =>
            dv.rest || !dv.exercises.length ? (
              <div key={dv.weekday} className="cc-view-day cc-view-rest">
                <span className="cc-day-name">{WEEKDAY_NAME[dv.weekday]}</span>
                <span className="cc-day-sub">rest{dv.date ? ` · ${fmtDay(dv.date)}` : ""}</span>
              </div>
            ) : (
              <div key={dv.weekday} className="cc-view-day">
                <div className="cc-view-day-head">
                  <span className="cc-day-name">{WEEKDAY_NAME[dv.weekday]}{dv.date ? ` · ${fmtDay(dv.date)}` : ""}</span>
                  {(dv.sessionRpe != null || dv.pain != null) && (
                    <span className="cc-view-day-meta">
                      {dv.sessionRpe != null && <>session RPE {dv.sessionRpe}</>}
                      {dv.sessionRpe != null && dv.pain != null && " · "}
                      {dv.pain != null && <>pain {dv.pain}/10</>}
                    </span>
                  )}
                </div>
                {dv.exercises.map((ex, i) => {
                  const rdiff = prevWeek ? dv.diff.diffs[i] : undefined;
                  return (
                  <div key={i} className={`cc-view-ex${rdiff?.isNew ? " cc-diff-new" : rdiff?.changed ? " cc-diff-changed" : ""}`}>
                    <div className="cc-view-ex-head">
                      <span className="cc-view-ex-name">{ex.name}</span>
                      <span className="cc-view-ex-scheme">{ex.scheme}</span>
                    </div>
                    {rdiff && <DiffLine d={rdiff} prevName={prevWeek?.name} />}
                    <div className="cc-view-sets">
                      {ex.sets.map((s, si) => (
                        <div key={si}>
                          <div className="cc-view-set">
                            <span className="cc-vs-n">S{si + 1}</span>
                            <span className="cc-vs-target">{s.reps}{s.target ? ` @ ${s.target}` : ""}</span>
                            <span className={`cc-vs-logged${s.loggedKg != null ? " cc-vs-hit" : ""}`}>{s.loggedKg != null ? `${fmtKg(s.loggedKg)} kg${s.rpe != null ? ` @${s.rpe}` : ""}` : "—"}</span>
                          </div>
                          {s.note && <div className="cc-vs-note">“{s.note}”</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                  );
                })}
                {prevWeek && dv.diff.removed.map((r) => (
                  <div key={`rm_${r.id}`} className="cc-view-ex cc-ex-removed">
                    <span className="cc-removed-chip">removed</span>
                    <span className="cc-removed-name">{r.name}</span>
                    <span className="cc-removed-meta">was {r.sets}×{r.reps} · {rowPresc(r)}</span>
                  </div>
                ))}
              </div>
            ),
          )}
          </div>
        </>
      )}
    </div>
  );
}
