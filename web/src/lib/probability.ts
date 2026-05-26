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
