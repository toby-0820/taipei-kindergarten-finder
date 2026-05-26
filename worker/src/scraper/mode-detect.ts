import type { ParsedSchool } from "../types";

export type Mode = "closed" | "open" | "drawn";

const REG_PERIOD_START_MONTH = 4;
const DRAW_PERIOD_END_MONTH = 6;

export function detectMode(schools: ParsedSchool[], now: Date = new Date()): Mode {
  // 'open' if ≥3 schools have any non-zero registration
  let schoolsWithRegs = 0;
  for (const s of schools) {
    for (const c of s.classes) {
      if (c.regs.some((r) => r != null && r > 0)) {
        schoolsWithRegs++;
        break;
      }
    }
  }
  if (schoolsWithRegs >= 3) return "open";

  const month = now.getMonth() + 1;
  if (month > DRAW_PERIOD_END_MONTH || (month === DRAW_PERIOD_END_MONTH && now.getDate() > 30)) {
    return "drawn";
  }
  return "closed";
}
