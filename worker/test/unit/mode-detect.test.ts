import { describe, it, expect } from "vitest";
import { detectMode } from "../../src/scraper/mode-detect";
import type { ParsedSchool } from "../../src/types";

function school(regs: number[]): ParsedSchool {
  return {
    id: "X", name: "X", type: "public", district: "松山區", address: null, phone: null,
    classes: [{ age_band: "3-5歲班", capacity: 30, regs, reg_total: null }],
  };
}

describe("detectMode", () => {
  it("returns 'open' when ≥3 schools have regs > 0", () => {
    const schools = [
      school([5, 3, 2]),
      school([0, 10, 0]),
      school([1, 0, 0]),
      school([0, 0, 0]),
    ];
    const result = detectMode(schools, new Date("2025-05-15"));
    expect(result).toBe("open");
  });

  it("returns 'closed' when all regs are 0/null in March", () => {
    const schools = [
      school([0, 0, 0]),
      school([0, 0, 0]),
      school([0, 0, 0]),
    ];
    const result = detectMode(schools, new Date("2025-03-10"));
    expect(result).toBe("closed");
  });

  it("returns 'drawn' when all regs are 0/null in July", () => {
    const schools = [
      school([0, 0, 0]),
      school([0, 0, 0]),
      school([0, 0, 0]),
    ];
    const result = detectMode(schools, new Date("2025-07-15"));
    expect(result).toBe("drawn");
  });

  it("returns 'open' when ≥3 schools have regs in July (late-round edge case)", () => {
    const schools = [
      school([5, 3, 2]),
      school([0, 10, 0]),
      school([1, 0, 0]),
    ];
    const result = detectMode(schools, new Date("2025-07-15"));
    expect(result).toBe("open");
  });
});
