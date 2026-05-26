import { getAllSchools, getLatestSnapshots, getMode } from "../lib/db";
import { haversineKm } from "../lib/distance";
import { calcByPriority } from "../lib/probability";
import type { Env } from "../index";

const TAIPEI_BOUNDS = { latMin: 24.95, latMax: 25.21, lngMin: 121.45, lngMax: 121.67 };

export async function handleSearch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const latParam = url.searchParams.get("lat");
  const lngParam = url.searchParams.get("lng");
  const school = url.searchParams.get("school")?.trim() || null;
  const ageBand = url.searchParams.get("age_band")?.trim() || null;
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 50);

  let queryLat: number | null = latParam != null ? parseFloat(latParam) : null;
  let queryLng: number | null = lngParam != null ? parseFloat(lngParam) : null;
  if (queryLat != null && isNaN(queryLat)) queryLat = null;
  if (queryLng != null && isNaN(queryLng)) queryLng = null;

  if ((queryLat == null || queryLng == null) && !school) {
    return json({ error: "lat+lng (from browser geolocation) or school required" }, 400);
  }

  if (queryLat != null && queryLng != null) {
    if (
      queryLat < TAIPEI_BOUNDS.latMin || queryLat > TAIPEI_BOUNDS.latMax ||
      queryLng < TAIPEI_BOUNDS.lngMin || queryLng > TAIPEI_BOUNDS.lngMax
    ) {
      return json({
        location_status: "out_of_scope",
        hint: "您的位置不在台北市，本站目前僅支援台北市",
        results: [],
      });
    }
  }

  const [schools, snapshots, modeInfo] = await Promise.all([
    getAllSchools(env.DB),
    getLatestSnapshots(env.DB),
    getMode(env.DB),
  ]);

  const snapshotsBySchool = new Map<string, typeof snapshots>();
  for (const sn of snapshots) {
    const list = snapshotsBySchool.get(sn.school_id) ?? [];
    list.push(sn);
    snapshotsBySchool.set(sn.school_id, list);
  }

  let filtered = schools;
  if (school) {
    const q = school.toLowerCase();
    filtered = filtered.filter((s) => s.name.toLowerCase().includes(q));
  }

  const enriched = filtered.map((s) => {
    const snaps = (snapshotsBySchool.get(s.id) ?? []).filter(
      (sn) => !ageBand || sn.age_band === ageBand,
    );
    const classes = snaps.map((sn) => {
      let regs: number[] = [];
      try { regs = JSON.parse(sn.regs_json); } catch { regs = []; }
      const probsResult = modeInfo.mode === "open"
        ? calcByPriority(sn.capacity, regs)
        : { probs: regs.map(() => null) };
      return {
        age_band: sn.age_band,
        capacity: sn.capacity,
        registrations: modeInfo.mode === "open" ? {
          regs,
          total: sn.reg_total,
        } : null,
        probabilities: { probs: probsResult.probs },
        fetched_at: sn.fetched_at,
      };
    });

    const distance_km = (queryLat != null && queryLng != null && s.lat != null && s.lng != null)
      ? haversineKm(queryLat, queryLng, s.lat, s.lng)
      : null;

    return {
      school_id: s.id,
      name: s.name,
      type: s.type,
      district: s.district,
      address: s.address,
      lat: s.lat,
      lng: s.lng,
      phone: s.phone,
      distance_km,
      classes,
    };
  });

  if (queryLat != null) {
    enriched.sort((a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity));
  }

  return json({
    window_mode: modeInfo.mode,
    priority_labels: modeInfo.priority_labels,
    query_lat: queryLat,
    query_lng: queryLng,
    fetched_at: snapshots[0]?.fetched_at ?? null,
    results: enriched.slice(0, limit),
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    },
  });
}
