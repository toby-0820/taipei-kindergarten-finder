export type Reg = number | null;

export interface ProbabilityResult {
  probs: (number | null)[];
  remaining_after_all: number;
}

export function calcByPriority(capacity: number, regs: Reg[]): ProbabilityResult {
  let remaining = capacity;
  const probs: (number | null)[] = [];
  for (const reg of regs) {
    if (reg == null) { probs.push(null); continue; }
    if (reg === 0) { probs.push(null); continue; }
    if (remaining >= reg) { probs.push(1.0); remaining -= reg; }
    else if (remaining > 0) { probs.push(remaining / reg); remaining = 0; }
    else { probs.push(0.0); }
  }
  return { probs, remaining_after_all: remaining };
}

// "If I register at selfIdx, what's everyone's chance?"
// Adds +1 to regs[selfIdx] (treating null/0 as 0), extends the array if
// selfIdx is past the existing length, then re-runs the cascade so that
// higher-priority counts ripple into lower-priority remaining capacity.
export function calcByPriorityWithSelf(
  capacity: number,
  regs: Reg[],
  selfIdx: number,
): ProbabilityResult {
  const targetLen = Math.max(regs.length, selfIdx + 1);
  const extended: Reg[] = [];
  for (let i = 0; i < targetLen; i++) {
    const v = regs[i];
    extended.push(v == null ? 0 : v);
  }
  extended[selfIdx] = (extended[selfIdx] as number) + 1;
  return calcByPriority(capacity, extended);
}

// Twin bind: 我和雙胞胎一起報名、綁籤 → 一抽兩個位、一籤兩人共命運（同進同出）.
// We add 2 to regs[selfIdx] (both twins) but our bundle competes as 1 entry.
// At priorities ABOVE selfIdx, normal cascade. At selfIdx:
//   - If remaining < 2: P = 0 (can't fit a 2-seat bundle).
//   - If reg-at-selfIdx ≤ remaining: bundle wins (P = 1), consume reg seats.
//   - Else: assume other registrants are singletons, so effective entries =
//           (reg - 2) + 1 = reg - 1, and bundle needs (remaining - 1) of those
//           positions to come up before seats fill. P = (remaining-1)/(reg-1).
// (See README / commit message for derivation.)
export function calcByPriorityWithTwinBind(
  capacity: number,
  regs: Reg[],
  selfIdx: number,
): ProbabilityResult {
  const targetLen = Math.max(regs.length, selfIdx + 1);
  const extended: number[] = [];
  for (let i = 0; i < targetLen; i++) {
    const v = regs[i];
    extended.push(v == null ? 0 : v);
  }
  extended[selfIdx] = extended[selfIdx] + 2;

  let remaining = capacity;
  const probs: (number | null)[] = [];
  for (let i = 0; i < extended.length; i++) {
    const reg = extended[i];
    if (reg === 0) { probs.push(null); continue; }

    if (i === selfIdx) {
      if (remaining < 2) {
        probs.push(0);
      } else if (remaining >= reg) {
        probs.push(1);
        remaining -= reg;
      } else {
        const totalEntries = Math.max(1, reg - 1);
        const p = Math.max(0, remaining - 1) / totalEntries;
        probs.push(Math.min(1, p));
        remaining = 0;
      }
    } else {
      if (remaining >= reg) { probs.push(1); remaining -= reg; }
      else if (remaining > 0) { probs.push(remaining / reg); remaining = 0; }
      else { probs.push(0); }
    }
  }
  return { probs, remaining_after_all: remaining };
}
