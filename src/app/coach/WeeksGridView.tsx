import { useMemo, useState } from "react";
import { getClients, COACHES, type ClientRow } from "./coachData";
import { plannedWeeks, yearMondays, monthOf, type Coverage } from "./coachPlanning";
import { mondayOf } from "./coachProgram";
import { Avatar } from "./Avatar";

/** Square style for a planned week: solid, or a half square for a part-week. */
function cellFill(state: "filled" | "avail" | "draft", coverage: Coverage): import("react").CSSProperties {
  const fill = state === "filled" ? "var(--good)" : state === "avail" ? "var(--navy)" : "color-mix(in srgb, var(--accent) 32%, transparent)";
  const border = state === "draft" ? "1.5px dashed var(--accent-700)" : `1px solid ${fill}`;
  const bg =
    coverage === "full"
      ? fill
      : coverage === "start"
        ? `linear-gradient(90deg, transparent 0 50%, ${fill} 50% 100%)` // week starts mid-week → right half
        : `linear-gradient(90deg, ${fill} 0 50%, transparent 50% 100%)`; // week ends mid-week → left half
  return { width: 14, height: 14, borderRadius: 4, background: bg, border, display: "inline-block", boxSizing: "border-box" };
}

/**
 * Year-at-a-glance planner: every athlete stacked as a row, every Monday of the
 * year as a column. A cell is ticked when that athlete has a week written whose
 * start lands on that Monday — solid for published, outline for a draft — so the
 * coach can see in one look who is programmed how far ahead, and where the gaps
 * are. Reads the same written weeks as the Block Plan and the Client Board.
 */
export function WeeksGridView({
  coachId,
  onOpenProgram,
  onSelect,
}: {
  coachId: string;
  onOpenProgram: (athleteId: string) => void;
  onSelect: (athleteId: string) => void;
}) {
  const [scope, setScope] = useState<string>(coachId);
  const [year, setYear] = useState<number>(new Date().getFullYear());

  const rows: ClientRow[] = getClients(scope === "all" ? undefined : scope);
  const mondays = useMemo(() => yearMondays(year), [year]);
  const thisMonday = mondayOf(
    (() => {
      const n = new Date();
      return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
    })(),
  );

  // Per-athlete planned-week map, computed once.
  const plans = useMemo(() => {
    const m = new Map<string, ReturnType<typeof plannedWeeks>>();
    rows.forEach((r) => m.set(r.athleteId, plannedWeeks(r.athleteId)));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, year, rows.length]);

  const totalPlanned = rows.reduce((s, r) => s + (plans.get(r.athleteId)?.size ?? 0), 0);
  const covered = rows.filter((r) => (plans.get(r.athleteId)?.size ?? 0) > 0).length;

  const NAME_W = 190;
  const COL_W = 24;
  const template = `${NAME_W}px repeat(${mondays.length}, ${COL_W}px)`;

  return (
    <div className="cc-page">
      <div className="cc-head-row">
        <div>
          <h1>Weeks</h1>
          <p className="cc-sub">Every athlete against every week of the year (Monday start). A tick means that week is written — solid is published, outline is a draft still to send.</p>
        </div>
        <div className="cc-stats">
          <Stat k="Athletes covered" v={`${covered}/${rows.length}`} />
          <Stat k="Weeks written" v={totalPlanned} />
        </div>
      </div>

      <div className="cc-chips">
        <button className="cc-chip" aria-current={scope === "all"} onClick={() => setScope("all")}>All coaches</button>
        {COACHES.map((c) => (
          <button key={c.id} className="cc-chip" aria-current={scope === c.id} onClick={() => setScope(c.id)}>{c.name}</button>
        ))}
        <span style={{ width: 1, background: "var(--divider)", margin: "0 4px" }} />
        <button className="cc-chip" onClick={() => setYear((y) => y - 1)}>◂</button>
        <button className="cc-chip" aria-current>{year}</button>
        <button className="cc-chip" onClick={() => setYear((y) => y + 1)}>▸</button>
        <span style={{ flex: 1 }} />
        <span className="cc-yg-legend"><i className="cc-yg-filled" /> filled in</span>
        <span className="cc-yg-legend"><i className="cc-yg-avail" /> available</span>
        <span className="cc-yg-legend"><i className="cc-yg-draft" /> draft</span>
        <span className="cc-yg-legend"><i className="cc-yg-now" /> this week</span>
      </div>

      <div className="cc-grid-scroll" style={{ marginTop: 18 }}>
        <div className="cc-yggrid" style={{ gridTemplateColumns: template }}>
          {/* header: month + day */}
          <div className="cc-yg-corner">Athlete</div>
          {mondays.map((mon, i) => {
            const prev = i > 0 ? monthOf(mondays[i - 1]) : "";
            const mo = monthOf(mon);
            const day = new Date(`${mon}T00:00:00`).getDate();
            const isNow = mon === thisMonday;
            return (
              <div key={mon} className={`cc-yg-head${isNow ? " cc-yg-head-now" : ""}`}>
                <span className="cc-yg-mo">{mo !== prev ? mo : ""}</span>
                <span className="cc-yg-day">{day}</span>
              </div>
            );
          })}

          {/* athlete rows */}
          {rows.map((r) => {
            const plan = plans.get(r.athleteId);
            return (
              <div key={r.athleteId} className="cc-yg-rowline" style={{ display: "contents" }}>
                <button
                  className="cc-yg-name"
                  title="Open programme"
                  onClick={() => { onSelect(r.athleteId); onOpenProgram(r.athleteId); }}
                >
                  <Avatar src={r.avatar} name={r.name} size={26} />
                  <span className="cc-yg-nametxt">{r.name}</span>
                </button>
                {mondays.map((mon) => {
                  const w = plan?.get(mon);
                  const isNow = mon === thisMonday;
                  const state = w ? (!w.published ? "draft" : w.filled ? "filled" : "avail") : null;
                  return (
                    <div key={mon} className={`cc-yg-cell${isNow ? " cc-yg-cell-now" : ""}`}>
                      {w && state && (
                        <span
                          style={cellFill(state, w.coverage)}
                          title={`${r.name} · ${w.mesoName} · ${w.weekName} · ${state === "filled" ? "filled in" : state === "avail" ? "available" : "draft"}${w.coverage !== "full" ? " · part-week" : ""}`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {rows.length === 0 && <p className="cc-sub" style={{ marginTop: 18 }}>No athletes on this list yet.</p>}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string | number }) {
  return (
    <div className="cc-stat cc-corner" style={{ position: "relative" }}>
      <i />
      <div className="cc-stat-k">{k}</div>
      <div className="cc-stat-v">{v}</div>
    </div>
  );
}
