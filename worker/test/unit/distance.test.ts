import { describe, it, expect } from "vitest";
import { haversineKm } from "../../src/lib/distance";

describe("haversineKm", () => {
  it("returns 0 for the same point", () => {
    expect(haversineKm(25.05, 121.55, 25.05, 121.55)).toBe(0);
  });

  it("computes Taipei 101 → 中正紀念堂 (~4.5 km)", () => {
    // Taipei 101: 25.0337, 121.5645
    // 中正紀念堂: 25.0359, 121.5198
    const d = haversineKm(25.0337, 121.5645, 25.0359, 121.5198);
    expect(d).toBeGreaterThan(4.4);
    expect(d).toBeLessThan(4.6);
  });

  it("computes 台北車站 → 信義區公所 (~5.1 km)", () => {
    // 台北車站: 25.0478, 121.5170
    // 信義區公所: 25.0331, 121.5654
    const d = haversineKm(25.0478, 121.5170, 25.0331, 121.5654);
    expect(d).toBeGreaterThan(5.0);
    expect(d).toBeLessThan(5.3);
  });

  it("is symmetric", () => {
    const a = haversineKm(25.05, 121.55, 25.10, 121.60);
    const b = haversineKm(25.10, 121.60, 25.05, 121.55);
    expect(a).toBeCloseTo(b, 6);
  });
});
