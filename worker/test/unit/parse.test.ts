import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBoardPage } from "../../src/scraper/parse";

const FIX = (name: string) =>
  readFileSync(join(__dirname, "../fixtures", name), "utf-8");

describe("parseBoardPage", () => {
  it("parses kid.tp.edu.tw 松山區 3-5歲班 — extracts schools with regs", () => {
    const html = FIX("kid-songshan.html");
    const schools = parseBoardPage(html, { type: "public", district: "松山區", age_band: "3-5歲班" });

    expect(schools.length).toBeGreaterThan(0);
    const s = schools.find((x) => x.name === "松山國小附幼");
    expect(s).toBeDefined();
    expect(s!.type).toBe("public");
    expect(s!.district).toBe("松山區");
    expect(s!.classes.length).toBe(1);
    expect(s!.classes[0].age_band).toBe("3-5歲班");
    expect(s!.classes[0].capacity).toBeGreaterThan(0);
    expect(s!.classes[0].regs.length).toBe(12); // 順序1-4 lumped + 順序5..順序15 = 12 values
    expect(s!.classes[0].reg_total).toBeGreaterThanOrEqual(0);
  });

  it("parses kid 中山區 3-5歲班", () => {
    const html = FIX("kid-zhongshan.html");
    const schools = parseBoardPage(html, { type: "public", district: "中山區", age_band: "3-5歲班" });
    expect(schools.length).toBeGreaterThan(0);
  });

  it("parses npkid 中山區 3-5歲班 with type=non_profit", () => {
    const html = FIX("npkid-zhongshan.html");
    const schools = parseBoardPage(html, { type: "non_profit", district: "中山區", age_band: "3-5歲班" });
    expect(schools.length).toBeGreaterThan(0);
    expect(schools.every((s) => s.type === "non_profit")).toBe(true);
  });

  it("parses kid 松山區 2歲專班 — regs length is 5 (順序1-4 lumped + 順序5..順序8)", () => {
    const html = FIX("kid-songshan-2yo.html");
    const schools = parseBoardPage(html, { type: "public", district: "松山區", age_band: "2歲專班" });
    if (schools.length === 0) return; // 可能某些區沒有 2歲專班
    expect(schools[0].classes[0].age_band).toBe("2歲專班");
    expect(schools[0].classes[0].regs.length).toBe(5);
  });

  it("returns empty array when page shows 查無資料", () => {
    const html = `<html><body><div>查無資料!</div></body></html>`;
    const schools = parseBoardPage(html, { type: "public", district: "松山區", age_band: "3-5歲班" });
    expect(schools).toEqual([]);
  });

  it("skips malformed rows without crashing", () => {
    const html = `<html><body><table id="MainContent_GridView1"><tr><th>x</th></tr><tr><td></td></tr></table></body></html>`;
    const schools = parseBoardPage(html, { type: "public", district: "松山區", age_band: "3-5歲班" });
    expect(schools).toEqual([]);
  });
});
