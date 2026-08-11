import { useState } from "react";
import { getDashboardModel } from "../../lib/data/athleteData";
import { ipfGlPoints, type Sex } from "../../lib/calc/scores";
import { fmtKg } from "../../lib/calc/records";
import { getPlan, savePlan, type AttemptPlan, type LiftKey } from "./coachAttempts";
import { Avatar } from "./Avatar";

/**
 * Competing → Attempts. An attempt-selection card per meet the athlete is opted
 * into, seeded from their training: current 1RMs (from their logged records),
 * openers/seconds/thirds as % of 1RM, running totals, projected total and IPF GL.
 * Comp bests + total come from their profile. Edit any number; it saves per meet.
 */

const LIFTS: LiftKey[] = ["squat", "bench", "deadlift"];
const LABEL: Record<LiftKey, string> = { squat: "SQUAT", bench: "BENCH", deadlift: "DEADLIFT" };
const num = (s: string) => parseFloat((s || "").replace(",", ".")) || 0;
const STEP = 2.5; // one plate jump for the low / high end around the planned attempt

export function AttemptsView({ athleteId, athleteName, avatar }: { athleteId: string; athleteName: string; avatar?: string }) {
  const model = getDashboardModel(athleteId);
  const sex: Sex = model.athlete.sex === "male" ? "male" : "female";
  const bw = num(model.bodyweightAvg4w) || num(model.athlete.bodyweightTile);
  const rmOf = (prefix: string) => num(model.prs.find((p) => p.lift.startsWith(prefix))?.value ?? "");
  const rm = { squat: rmOf("SQUAT"), bench: rmOf("BENCH"), deadlift: rmOf("DEAD") };

  const meets = model.competitions
    .filter((c) => model.optedInComps.includes(c.id))
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="cc-page">
      <div className="cc-head-row">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}><Avatar src={avatar} name={athleteName} size={40} />Attempts · {athleteName}</h1>
          <p className="cc-sub">One card per meet they’re entered in — openers, seconds and thirds seeded from their 1RMs. Edit any number; totals + IPF GL update live.</p>
        </div>
        <div className="cc-stats">
          <Stat k="Bodyweight" v={bw ? `${fmtKg(bw)} kg` : "—"} />
          <Stat k="Comp total" v={model.totals.comp === "—" ? "—" : `${model.totals.comp} kg`} />
          <Stat k="Best GL" v={model.gl.best} />
        </div>
      </div>

      {meets.length === 0 ? (
        <div className="cc-placeholder">Opt {athleteName} into a meet (Competing → Calendar) to plan attempts.</div>
      ) : (
        meets.map((c) => <AttemptCard key={c.id} athleteId={athleteId} compId={c.id} title={c.name} date={c.date} level={c.level} rm={rm} bw={bw} sex={sex} />)
      )}
    </div>
  );
}

function AttemptCard({ athleteId, compId, title, date, level, rm, bw, sex }: {
  athleteId: string; compId: string; title: string; date: string; level: "national" | "international"; rm: Record<LiftKey, number>; bw: number; sex: Sex;
}) {
  const [plan, setPlan] = useState<AttemptPlan>(() => getPlan(athleteId, compId, rm));
  const set = (next: AttemptPlan) => { setPlan(next); savePlan(athleteId, compId, next); };
  const setAttempt = (lift: LiftKey, which: "opener" | "second" | "third", v: number) =>
    set({ ...plan, attempts: { ...plan.attempts, [lift]: { ...plan.attempts[lift], [which]: v } } });
  const setRm = (lift: LiftKey, v: number) => set({ ...plan, rm: { ...plan.rm, [lift]: v } });

  const total = (which: "opener" | "second" | "third") => LIFTS.reduce((s, l) => s + plan.attempts[l][which], 0);
  const pct = (lift: LiftKey, v: number) => (plan.rm[lift] > 0 ? Math.round((v / plan.rm[lift]) * 100) : 0);
  const projected = total("third");
  const openersTotal = total("opener");
  const gl = ipfGlPoints(sex, bw, projected, level === "international" ? "equipped_full" : "raw_full");
  const warmups = (lift: LiftKey): string => {
    const op = plan.attempts[lift].opener;
    if (!op) return "";
    return [0.4, 0.6, 0.75, 0.85, 0.93].map((f) => Math.round((op * f) / 2.5) * 2.5).join(" · ") + " · " + op;
  };
  const d = new Date(date + "T00:00:00");

  return (
    <div className="cc-panel cc-corner" style={{ position: "relative", marginTop: 16 }}>
      <i />
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <div style={{ font: "600 18px/1 var(--font-heading)", letterSpacing: ".02em", color: "var(--navy)" }}>{title}
          <span className={`cc-level ${level === "international" ? "cc-level-int" : "cc-level-nat"}`} style={{ marginLeft: 10 }}>{level === "international" ? "INTERNATIONAL" : "NATIONAL"}</span>
        </div>
        <div className="cc-cell-s">{d.getDate()}/{d.getMonth() + 1}/{d.getFullYear()}</div>
      </div>

      <div className="cc-attempt-grid" style={{ marginTop: 14 }}>
        {/* header row */}
        <div className="cc-att-row cc-att-head">
          <span />
          {LIFTS.map((l) => <span key={l} style={{ textAlign: "center" }}>{LABEL[l]}</span>)}
          <span style={{ textAlign: "center" }}>TOTAL</span>
        </div>
        {/* 1RM row */}
        <div className="cc-att-row">
          <span className="cc-att-lab">Current 1RM</span>
          {LIFTS.map((l) => (
            <span key={l}><input className="cc-in" value={plan.rm[l] || ""} onChange={(e) => setRm(l, num(e.target.value))} /></span>
          ))}
          <span style={{ textAlign: "center", font: "600 13px/1 var(--font-heading)", color: "var(--muted)" }}>{fmtKg(LIFTS.reduce((s, l) => s + plan.rm[l], 0))}</span>
        </div>
        {(["opener", "second", "third"] as const).map((which) => {
          const label = which === "opener" ? "Opener" : which === "second" ? "Second" : "Third";
          const lowV = (l: LiftKey) => Math.max(0, plan.attempts[l][which] - STEP);
          const highV = (l: LiftKey) => plan.attempts[l][which] + STEP;
          const lowTotal = LIFTS.reduce((s, l) => s + lowV(l), 0);
          const highTotal = LIFTS.reduce((s, l) => s + highV(l), 0);
          return (
            <div key={which} className="cc-att-group">
              {/* low end */}
              <div className="cc-att-row cc-att-sub">
                <span className="cc-att-lab-sub">low</span>
                {LIFTS.map((l) => <span key={l} className="cc-att-ro">{fmtKg(lowV(l))}<em>{pct(l, lowV(l))}%</em></span>)}
                <span className="cc-att-ro cc-att-ro-total">{fmtKg(lowTotal)}</span>
              </div>
              {/* planned (editable) */}
              <div className="cc-att-row cc-att-main">
                <span className="cc-att-lab">{label}</span>
                {LIFTS.map((l) => (
                  <span key={l} style={{ position: "relative" }}>
                    <input className="cc-in" value={plan.attempts[l][which] || ""} onChange={(e) => setAttempt(l, which, num(e.target.value))} />
                    <em className="cc-att-pct">{pct(l, plan.attempts[l][which])}%</em>
                  </span>
                ))}
                <span style={{ textAlign: "center", font: "600 14px/1 var(--font-heading)", color: "var(--navy)" }}>{fmtKg(total(which))}</span>
              </div>
              {/* high end */}
              <div className="cc-att-row cc-att-sub">
                <span className="cc-att-lab-sub">high</span>
                {LIFTS.map((l) => <span key={l} className="cc-att-ro">{fmtKg(highV(l))}<em>{pct(l, highV(l))}%</em></span>)}
                <span className="cc-att-ro cc-att-ro-total">{fmtKg(highTotal)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="cc-att-summary">
        <div><span className="cc-vlk">If openers land</span><span className="cc-vlv">{fmtKg(openersTotal)}<em> kg</em></span></div>
        <div><span className="cc-vlk">If thirds land</span><span className="cc-vlv">{fmtKg(projected)}<em> kg</em></span></div>
        <div><span className="cc-vlk">IPF GL (projected)</span><span className="cc-vlv">{gl ? gl.toFixed(1) : "—"}</span></div>
      </div>

      <div className="cc-side-k" style={{ marginTop: 14 }}>Warm-ups to the opener</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 6 }}>
        {LIFTS.map((l) => <div key={l} className="cc-cell-s"><strong style={{ color: "var(--navy)" }}>{LABEL[l]}</strong> · {warmups(l) || "—"}</div>)}
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="cc-stat cc-corner" style={{ position: "relative" }}>
      <i />
      <div className="cc-stat-k">{k}</div>
      <div className="cc-stat-v" style={{ fontSize: 18 }}>{v}</div>
    </div>
  );
}
