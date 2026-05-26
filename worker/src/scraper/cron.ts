import { buildTargets, fetchHtml } from "./fetch-pages";
import { parseBoardPage } from "./parse";
import { upsertParsedSchools } from "./upsert";
import { detectMode } from "./mode-detect";
import { setMode, logScrapeError } from "../lib/db";
import type { ParsedSchool } from "../types";

export interface CronEnv {
  DB: D1Database;
  GEOCODE_CACHE: KVNamespace;
  DISCORD_WEBHOOK_URL: string;
}

export async function runScrape(env: CronEnv): Promise<{ schools: number; snapshots: number; failures: number; mode: string }> {
  const targets = buildTargets();
  const fetchedAt = Date.now();
  const allParsed: ParsedSchool[] = [];
  let failures = 0;

  for (const t of targets) {
    const html = await fetchHtml(t);
    if (!html) {
      failures++;
      await logScrapeError(env.DB, `${t.url} (${t.age_band})`, "fetch failed");
      continue;
    }
    try {
      const parsed = parseBoardPage(html, { type: t.type, district: t.district, age_band: t.age_band });
      allParsed.push(...parsed);
    } catch (e: any) {
      failures++;
      await logScrapeError(env.DB, `${t.url} (${t.age_band})`, `parse: ${e?.message ?? String(e)}`);
    }
  }

  let schools = 0, snapshots = 0;
  if (allParsed.length > 0) {
    const result = await upsertParsedSchools(env, allParsed, fetchedAt);
    schools = result.schoolsWritten;
    snapshots = result.snapshotsWritten;
  }

  const mode = detectMode(allParsed, new Date(fetchedAt));
  await setMode(env.DB, mode);

  if (allParsed.length === 0) {
    await notifyDiscord(env, "⚠️ Cron run produced 0 parsed schools.");
  }

  return { schools, snapshots, failures, mode };
}

export async function notifyDiscord(env: CronEnv & { DISCORD_WEBHOOK_URL: string }, content: string): Promise<void> {
  if (!env.DISCORD_WEBHOOK_URL) return;
  try {
    await fetch(env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
  } catch {
    // swallow — best-effort
  }
}
