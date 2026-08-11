import { logBodyweight } from "../../lib/data/athleteData";
import { fmtKg } from "../../lib/calc/records";

/**
 * Log today's bodyweight from either the dashboard card or the 6e screen.
 * First log of the day just saves; a second log the same day asks to overwrite
 * the earlier entry. Returns true if anything was written.
 */
export function logWithConfirm(athleteId: string, value: string): boolean {
  const res = logBodyweight(athleteId, value);
  if (res.status === "invalid") {
    alert("Enter a bodyweight in kg between 30 and 300.");
    return false;
  }
  if (res.status === "exists") {
    const ok = window.confirm(
      `You already logged ${fmtKg(res.existingKg)} kg today. Overwrite it with ${value.replace(".", ",")} kg?`,
    );
    if (!ok) return false;
    logBodyweight(athleteId, value, { overwrite: true });
    return true;
  }
  return true;
}
