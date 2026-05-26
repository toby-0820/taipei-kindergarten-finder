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
