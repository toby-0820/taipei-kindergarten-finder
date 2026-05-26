import { describe, it, expect, beforeAll } from "vitest";
import { SELF, env } from "cloudflare:test";

describe("GET /api/search", () => {
  beforeAll(async () => {
    await env.DB.batch([
      env.DB.prepare(`INSERT OR REPLACE INTO schools (id,name,type,district,address,lat,lng,phone,website,classes_json,updated_at)
        VALUES ('S1','測試幼兒園','public','中山區','台北市中山區X路1號',25.06,121.54,NULL,NULL,'[]',1)`),
      env.DB.prepare(`INSERT OR REPLACE INTO snapshots (school_id,age_band,capacity,regs_json,reg_total,fetched_at,is_latest)
        VALUES ('S1','3-5歲班',30,'[0,0,0,0,40]',40,1000,1)`),
      env.DB.prepare(`UPDATE registration_window SET mode='open', detected_at=1000 WHERE id=1`),
    ]);
  });

  it("returns 400 when neither lat/lng nor school provided", async () => {
    const r = await SELF.fetch("https://example.com/api/search");
    expect(r.status).toBe(400);
  });

  it("returns school list when school name matches and probabilities are computed", async () => {
    const r = await SELF.fetch("https://example.com/api/search?school=測試");
    expect(r.status).toBe(200);
    const body = await r.json() as any;
    expect(body.window_mode).toBe("open");
    expect(body.results.length).toBe(1);
    expect(body.results[0].name).toBe("測試幼兒園");
    // capacity 30, regs [0,0,0,0,40]: first 4 priorities have 0 regs → null
    // 5th priority: capacity=30, regs[4]=40 → 30/40 = 0.75
    expect(body.results[0].classes[0].probabilities.probs[4]).toBeCloseTo(30 / 40, 4);
  });

  it("returns school list with distance when lat/lng provided (within Taipei)", async () => {
    const r = await SELF.fetch("https://example.com/api/search?lat=25.06&lng=121.54");
    expect(r.status).toBe(200);
    const body = await r.json() as any;
    expect(body.results.length).toBeGreaterThanOrEqual(1);
    expect(body.query_lat).toBeCloseTo(25.06, 2);
    expect(body.results[0].distance_km).not.toBeNull();
  });

  it("rejects lat/lng outside Taipei bounds", async () => {
    const r = await SELF.fetch("https://example.com/api/search?lat=24.10&lng=120.65");
    expect(r.status).toBe(200);
    const body = await r.json() as any;
    expect(body.location_status).toBe("out_of_scope");
  });
});
