// Weekly adherence score for the athlete dashboard.
//
// Rule (from the coach):
//  • Training load = how complete the week's logging is. When every prescribed
//    set has a weight AND every required RPE is entered, training = 90%.
//  • The final 10% is two "extras": logging bodyweight at least 3× in the week,
//    and entering the weekly check-in scores. Each extra is worth 5%.
//  • So a fully-logged week with both extras = 100%.
//
// The score is measured over the CURRENT training week, which resets on the
// athlete's own week-start day (see currentWeekWindow). Once logging is wired,
// setsDone/rpeDone/bwLogsThisWeek are counts of entries inside that window.

export type AdherenceInput = {
  setsDone: number;
  setsTotal: number;
  rpeDone: number;
  rpeTotal: number;
  bwLogsThisWeek: number;
  weeklyScoresEntered: boolean;
};

export type AdherenceView = {
  percent: string; // "61%"
  percentValue: number; // 61
  tag: string; // "GAPS TO FILL" | "ALL DONE"
  sets: string; // "44 / 65"
  rpe: string; // "29 / 42"
  extras: string; // "0 / 2"
  setsDash: string; // svg stroke-dasharray for the outer ring
  rpeDash: string;
  extrasDash: string;
  detailLine1: string;
  detailLine2: string;
};

// Ring radii in the design (viewBox 100): sets=40, rpe=28, extras=16.
const CIRC = { sets: 2 * Math.PI * 40, rpe: 2 * Math.PI * 28, extras: 2 * Math.PI * 16 };
const TRAINING_WEIGHT = 90; // % that full set+RPE logging is worth
const EXTRAS_WEIGHT = 10; // % the two extras carry
const BW_TARGET = 3; // "3 bodyweight logs a week clears the extra"

const frac = (done: number, total: number) => (total > 0 ? done / total : 0);
const dash = (done: number, total: number, circ: number) =>
  `${(frac(done, total) * circ).toFixed(1)} ${circ.toFixed(1)}`;

export function computeAdherence(i: AdherenceInput): AdherenceView {
  const extrasDone = (i.bwLogsThisWeek >= BW_TARGET ? 1 : 0) + (i.weeklyScoresEntered ? 1 : 0);

  // Pool sets and RPE so full logging lands exactly on the training weight.
  const logged = i.setsDone + i.rpeDone;
  const required = i.setsTotal + i.rpeTotal;
  const trainingPct = required > 0 ? (logged / required) * TRAINING_WEIGHT : 0;
  const extrasPct = (extrasDone / 2) * EXTRAS_WEIGHT;
  const percentValue = Math.round(trainingPct + extrasPct);

  const setsMissing = Math.max(0, i.setsTotal - i.setsDone);
  const rpeMissing = Math.max(0, i.rpeTotal - i.rpeDone);

  return {
    percent: `${percentValue}%`,
    percentValue,
    tag: percentValue >= 100 ? "ALL DONE" : "GAPS TO FILL",
    sets: `${i.setsDone} / ${i.setsTotal}`,
    rpe: `${i.rpeDone} / ${i.rpeTotal}`,
    extras: `${extrasDone} / 2`,
    setsDash: dash(i.setsDone, i.setsTotal, CIRC.sets),
    rpeDash: dash(i.rpeDone, i.rpeTotal, CIRC.rpe),
    extrasDash: dash(extrasDone, 2, CIRC.extras),
    detailLine1: setsMissing > 0 ? `${setsMissing} sets still without a weight` : "All sets logged",
    detailLine2: rpeMissing > 0 ? `${rpeMissing} RPE ratings missing` : "All RPE ratings in",
  };
}

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday

/**
 * The current training-week window [start, end). The week starts on the
 * athlete's own start day and resets a week later — e.g. a Tuesday start means
 * Tue 00:00 up to (not including) the next Tue. Log-counting for adherence
 * filters entries to this window.
 */
export function currentWeekWindow(weekStartsOn: Weekday, today: Date = new Date()) {
  const d = new Date(today);
  d.setHours(0, 0, 0, 0);
  const back = (d.getDay() - weekStartsOn + 7) % 7;
  const start = new Date(d);
  start.setDate(d.getDate() - back);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { start, end };
}
