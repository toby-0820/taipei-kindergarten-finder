import { describe, it, expect } from "vitest";
import { calcByPriority } from "../../src/lib/probability";

describe("calcByPriority", () => {
  it("returns 1.0 for all priorities when total registrations < capacity", () => {
    const { probs, remaining_after_all } = calcByPriority(60, [5, 8, 10, 12, 20]);
    expect(probs).toEqual([1.0, 1.0, 1.0, 1.0, 1.0]);
    expect(remaining_after_all).toBe(5);
  });

  it("returns 1.0 for all priorities when total exactly equals capacity", () => {
    const { probs, remaining_after_all } = calcByPriority(50, [10, 10, 10, 10, 10]);
    expect(probs).toEqual([1.0, 1.0, 1.0, 1.0, 1.0]);
    expect(remaining_after_all).toBe(0);
  });

  it("partial fill at the boundary priority", () => {
    const { probs } = calcByPriority(60, [5, 8, 22, 30, 80]);
    expect(probs[0]).toBe(1.0);
    expect(probs[1]).toBe(1.0);
    expect(probs[2]).toBe(1.0);
    expect(probs[3]).toBeCloseTo(25 / 30, 6);
    expect(probs[4]).toBe(0.0);
  });

  it("higher priority oversubscribed — lower priorities get 0", () => {
    const { probs } = calcByPriority(30, [50, 20, 20, 20, 20]);
    expect(probs[0]).toBeCloseTo(30 / 50, 6);
    expect(probs[1]).toBe(0.0);
    expect(probs[2]).toBe(0.0);
    expect(probs[3]).toBe(0.0);
    expect(probs[4]).toBe(0.0);
  });

  it("returns null for a priority with zero registrations", () => {
    const { probs } = calcByPriority(60, [0, 5, 0, 30, 100]);
    expect(probs[0]).toBeNull();
    expect(probs[1]).toBe(1.0);
    expect(probs[2]).toBeNull();
    expect(probs[3]).toBe(1.0);
    expect(probs[4]).toBeCloseTo((60 - 35) / 100, 6);
  });

  it("returns null for a priority where registered is null", () => {
    const { probs } = calcByPriority(60, [null, 5, null, 30, 100]);
    expect(probs[0]).toBeNull();
    expect(probs[2]).toBeNull();
  });

  it("capacity 0 — every priority gets 0", () => {
    const { probs } = calcByPriority(0, [5, 10, 10, 10, 10]);
    expect(probs).toEqual([0.0, 0.0, 0.0, 0.0, 0.0]);
  });

  it("works with arbitrary priority count", () => {
    const { probs } = calcByPriority(20, [10, 15]);
    expect(probs[0]).toBe(1.0);
    expect(probs[1]).toBeCloseTo(10 / 15, 6);
  });

  it("computes remaining_after_all correctly", () => {
    const { remaining_after_all } = calcByPriority(60, [10, 10, 10]);
    expect(remaining_after_all).toBe(30);
  });
});
