import type { RowDiff, DiffChange } from "./coachProgram";

const ARROW = { up: "↑", down: "↓", flat: "→" } as const;

/**
 * Inline "was → now" line under an exercise, flagging what changed vs last week.
 * Deliberately low-key: one muted ink for the whole line, direction shown by a
 * small ↑/↓ glyph (not a full colour), so a week where every RPE ticks up doesn't
 * turn into a wall of green. Only a genuinely NEW exercise gets a coloured chip.
 */
export function DiffLine({ d, prevName }: { d: RowDiff; prevName?: string }) {
  if (d.isNew) return <div className="cc-diffline"><span className="cc-diff-newchip">NEW</span></div>;
  if (!d.changed) return null;
  const seg = (label: string, c: DiffChange) => (
    <span className={`cc-diff-seg cc-diff-${c.dir}`}>
      {label && <span className="cc-diff-lbl">{label}</span>}
      <span className="cc-diff-from">{c.from}</span>
      <span className="cc-diff-arrow">{ARROW[c.dir]}</span>
      <span className="cc-diff-to">{c.to}</span>
    </span>
  );
  return (
    <div className="cc-diffline" title={prevName ? `changed vs ${prevName}` : "changed vs last week"}>
      {d.presc && seg("", d.presc)}
      {d.suggest && seg("sug", d.suggest)}
      {d.reps && seg("reps", d.reps)}
      {d.sets && seg("sets", d.sets)}
    </div>
  );
}
