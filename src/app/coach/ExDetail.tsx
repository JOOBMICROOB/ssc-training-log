import { fmtKg } from "../../lib/calc/records";
import type { ExBest } from "../../lib/data/athleteData";

/**
 * Per-exercise history panel, shared by the builder and the viewer. Click an
 * exercise to toggle it open and see — for that specific movement — the athlete's
 * rep-maxes (1RM … 8RM, their heaviest ever at each rep count), an Epley e1RM,
 * and the most recent session they logged. Gives the coach real numbers to base
 * the next prescription on, instead of guessing.
 */
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (iso: string) => { const d = new Date(`${iso}T00:00:00`); return `${d.getDate()} ${MON[d.getMonth()]}`; };

export function ExDetail({ name, bests }: { name: string; bests: Map<string, ExBest> }) {
  const b = bests.get(name.trim().toLowerCase());
  const reps = b ? Object.keys(b.byReps).map(Number).filter((r) => r >= 1 && r <= 8).sort((a, z) => a - z) : [];
  const hasRms = reps.length > 0 || (b?.e1rm ?? 0) > 0;
  const hasLast = !!b?.last?.sets.length;

  if (!b || (!hasRms && !hasLast)) {
    return <div className="cc-exd"><div className="cc-exd-empty">No logged history yet for this exercise.</div></div>;
  }
  return (
    <div className="cc-exd">
      {hasRms && (
        <div className="cc-exd-row">
          <span className="cc-exd-k">Rep maxes</span>
          <div className="cc-exd-rms">
            {reps.map((r) => (
              <span key={r} className="cc-exd-rm"><b>{r}RM</b> {fmtKg(b.byReps[r])}</span>
            ))}
            {b.e1rm > 0 && <span className="cc-exd-rm cc-exd-e1"><b>e1RM</b> {fmtKg(Math.round(b.e1rm))}</span>}
          </div>
        </div>
      )}
      {hasLast && (
        <div className="cc-exd-row">
          <span className="cc-exd-k">Last done</span>
          <div className="cc-exd-last">
            <span className="cc-exd-date">{fmtDate(b.last!.date)}</span>
            {b.last!.sets.map((s, i) => (
              <span key={i} className="cc-exd-set">{fmtKg(s.kg)}{s.reps != null ? `×${s.reps}` : ""}{s.rpe != null ? ` @${s.rpe}` : ""}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
