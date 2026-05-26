import type { ParsedSchool } from "../types";
import {
  upsertSchool, rotateSnapshot, getSchoolById, getSchoolsWithoutCoords, updateSchoolCoords,
} from "../lib/db";
import { geocodeAddress } from "../lib/geocode";

const MAX_GEOCODES_PER_RUN = 10;

export interface UpsertEnv {
  DB: D1Database;
  GEOCODE_CACHE: KVNamespace;
}

export async function upsertParsedSchools(
  env: UpsertEnv,
  parsed: ParsedSchool[],
  fetchedAt: number,
): Promise<{ schoolsWritten: number; snapshotsWritten: number }> {
  // Merge classes by school id (same school may appear twice — once per age_band)
  const merged = new Map<string, ParsedSchool>();
  for (const s of parsed) {
    const existing = merged.get(s.id);
    if (existing) {
      existing.classes.push(...s.classes);
    } else {
      merged.set(s.id, { ...s, classes: [...s.classes] });
    }
  }

  let schoolsWritten = 0;
  let snapshotsWritten = 0;

  for (const s of merged.values()) {
    const existing = await getSchoolById(env.DB, s.id);
    await upsertSchool(env.DB, {
      id: s.id,
      name: s.name,
      type: s.type,
      district: s.district,
      address: s.address ?? existing?.address ?? "",
      lat: existing?.lat ?? null,
      lng: existing?.lng ?? null,
      phone: s.phone ?? existing?.phone ?? null,
      website: existing?.website ?? null,
      classes_json: JSON.stringify(s.classes.map((c) => ({
        age_band: c.age_band, capacity: c.capacity,
      }))),
      updated_at: fetchedAt,
    });
    schoolsWritten++;

    const snapshotRows = s.classes.map((c) => ({
      school_id: s.id,
      age_band: c.age_band,
      capacity: c.capacity,
      regs_json: JSON.stringify(c.regs),
      reg_total: c.reg_total,
      fetched_at: fetchedAt,
      is_latest: 1,
    }));
    await rotateSnapshot(env.DB, snapshotRows);
    snapshotsWritten += snapshotRows.length;
  }

  // Lazy geocoding: pick up to 10 schools without coords and resolve via Nominatim.
  // Each Nominatim call takes ~1 sec including server processing; we serialize them
  // and add a 1.1s delay between calls to be polite.
  const needCoords = await getSchoolsWithoutCoords(env.DB, MAX_GEOCODES_PER_RUN);
  for (const sc of needCoords) {
    const query = sc.address && sc.address.trim().length > 0
      ? `${sc.address}, 台北市${sc.district}, 台灣`
      : `${sc.name}, 台北市${sc.district}, 台灣`;
    const geo = await geocodeAddress(query, env.GEOCODE_CACHE);
    if (geo) {
      await updateSchoolCoords(env.DB, sc.id, geo.lat, geo.lng);
    }
    await sleep(1100);
  }

  return { schoolsWritten, snapshotsWritten };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
