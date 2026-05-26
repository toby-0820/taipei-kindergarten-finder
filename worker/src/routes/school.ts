import { getSchoolById, getLatestSnapshots, getMode } from "../lib/db";
import { calcByPriority } from "../lib/probability";
import type { Env } from "../index";

export async function handleSchool(_request: Request, env: Env, id: string): Promise<Response> {
  const school = await getSchoolById(env.DB, id);
  if (!school) {
    return json({ error: "school not found" }, 404);
  }
  const [snapshots, modeInfo] = await Promise.all([
    getLatestSnapshots(env.DB, [id]),
    getMode(env.DB),
  ]);

  const classes = snapshots.map((sn) => {
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

  return json({
    window_mode: modeInfo.mode,
    priority_labels: modeInfo.priority_labels,
    school: {
      school_id: school.id,
      name: school.name,
      type: school.type,
      district: school.district,
      address: school.address,
      lat: school.lat,
      lng: school.lng,
      phone: school.phone,
      classes,
    },
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}
