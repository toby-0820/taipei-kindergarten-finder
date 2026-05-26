import type { SchoolType } from "../types";

export interface SchoolRow {
  id: string;
  name: string;
  type: SchoolType;
  district: string;
  address: string;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  website: string | null;
  classes_json: string;
  updated_at: number;
}

export interface SnapshotRow {
  school_id: string;
  age_band: string;
  capacity: number;
  regs_json: string;       // JSON array, e.g. "[5,8,22,30,80]"
  reg_total: number | null;
  fetched_at: number;
  is_latest: number;
}

export async function getAllSchools(db: D1Database): Promise<SchoolRow[]> {
  const { results } = await db.prepare("SELECT * FROM schools").all<SchoolRow>();
  return results ?? [];
}

export async function getSchoolById(db: D1Database, id: string): Promise<SchoolRow | null> {
  return await db.prepare("SELECT * FROM schools WHERE id = ?").bind(id).first<SchoolRow>();
}

export async function getSchoolsWithoutCoords(db: D1Database, limit: number): Promise<SchoolRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM schools WHERE lat IS NULL OR lng IS NULL LIMIT ?")
    .bind(limit)
    .all<SchoolRow>();
  return results ?? [];
}

export async function getLatestSnapshots(
  db: D1Database,
  schoolIds?: string[],
): Promise<SnapshotRow[]> {
  if (schoolIds && schoolIds.length > 0) {
    const placeholders = schoolIds.map(() => "?").join(",");
    const stmt = db
      .prepare(`SELECT * FROM snapshots WHERE is_latest = 1 AND school_id IN (${placeholders})`)
      .bind(...schoolIds);
    const { results } = await stmt.all<SnapshotRow>();
    return results ?? [];
  }
  const { results } = await db.prepare("SELECT * FROM snapshots WHERE is_latest = 1").all<SnapshotRow>();
  return results ?? [];
}

export async function upsertSchool(db: D1Database, school: SchoolRow): Promise<void> {
  await db
    .prepare(`
      INSERT INTO schools (id, name, type, district, address, lat, lng, phone, website, classes_json, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        type=excluded.type,
        district=excluded.district,
        address=excluded.address,
        lat=COALESCE(excluded.lat, schools.lat),
        lng=COALESCE(excluded.lng, schools.lng),
        phone=excluded.phone,
        website=excluded.website,
        classes_json=excluded.classes_json,
        updated_at=excluded.updated_at
    `)
    .bind(
      school.id, school.name, school.type, school.district, school.address,
      school.lat, school.lng, school.phone, school.website,
      school.classes_json, school.updated_at,
    )
    .run();
}

export async function updateSchoolCoords(
  db: D1Database, id: string, lat: number, lng: number,
): Promise<void> {
  await db.prepare("UPDATE schools SET lat=?, lng=? WHERE id=?").bind(lat, lng, id).run();
}

export async function rotateSnapshot(db: D1Database, rows: SnapshotRow[]): Promise<void> {
  for (const r of rows) {
    // demote existing is_latest=1 → 0 for this (school, age_band)
    await db
      .prepare(`UPDATE snapshots SET is_latest = 0 WHERE school_id = ? AND age_band = ? AND is_latest = 1`)
      .bind(r.school_id, r.age_band)
      .run();
    // delete any old is_latest=0 (keep only most recent prior)
    await db
      .prepare(`
        DELETE FROM snapshots
        WHERE school_id = ? AND age_band = ? AND is_latest = 0
          AND fetched_at < (SELECT COALESCE(MAX(fetched_at),0) FROM snapshots WHERE school_id = ? AND age_band = ? AND is_latest = 0)
      `)
      .bind(r.school_id, r.age_band, r.school_id, r.age_band)
      .run();
  }
  for (const r of rows) {
    await db
      .prepare(`
        INSERT INTO snapshots (school_id, age_band, capacity, regs_json, reg_total, fetched_at, is_latest)
        VALUES (?,?,?,?,?,?,1)
      `)
      .bind(r.school_id, r.age_band, r.capacity, r.regs_json, r.reg_total, r.fetched_at)
      .run();
  }
}

export async function setMode(
  db: D1Database,
  mode: "closed" | "open" | "drawn",
  priorityLabels?: string[],
): Promise<void> {
  await db
    .prepare(`UPDATE registration_window SET mode = ?, detected_at = ?, priority_labels = ? WHERE id = 1`)
    .bind(mode, Date.now(), priorityLabels ? JSON.stringify(priorityLabels) : null)
    .run();
}

export async function getMode(db: D1Database): Promise<{
  mode: "closed" | "open" | "drawn";
  detected_at: number;
  priority_labels: string[] | null;
}> {
  const row = await db
    .prepare("SELECT mode, detected_at, priority_labels FROM registration_window WHERE id = 1")
    .first<{ mode: "closed" | "open" | "drawn"; detected_at: number; priority_labels: string | null }>();
  return {
    mode: row?.mode ?? "closed",
    detected_at: row?.detected_at ?? 0,
    priority_labels: row?.priority_labels ? JSON.parse(row.priority_labels) : null,
  };
}

export async function logScrapeError(db: D1Database, source: string, message: string): Promise<void> {
  await db
    .prepare("INSERT INTO scrape_errors (source, message, occurred_at) VALUES (?,?,?)")
    .bind(source, message.slice(0, 1000), Date.now())
    .run();
}
