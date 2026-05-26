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

export async function runScrape(env: CronEnv, tickIdx = 0, ticksPerCycle = 1): Promise<{ schools: number; snapshots: number; failures: number; mode: string }> {
  // Optional batching: when ticksPerCycle > 1, only scrape 1/N of the
  // targets per call (used by the scheduled handler to fit within
  // Workers Free's 50-subrequest-per-invocation cap). targets are
  // partitioned deterministically by index so the rotation covers
  // every target across ticksPerCycle calls.
  const allTargets = buildTargets();
  const targets = ticksPerCycle <= 1
    ? allTargets
    : allTargets.filter((_, i) => i % ticksPerCycle === tickIdx);
  const fetchedAt = Date.now();
  const allParsed: ParsedSchool[] = [];
  let failures = 0;

  // Fan out all fetches in parallel. 72 targets × ~500ms each = ~36s sequential,
  // but ~2-3s wall time in parallel — fits well within the scheduled handler's
  // 30s budget. Each fetch is self-contained (its own GET + optional postback).
  const fetchResults = await Promise.all(
    targets.map((t) =>
      fetchHtml(t).then((html) => ({ t, html })).catch(() => ({ t, html: null })),
    ),
  );

  const errors: Array<{ source: string; message: string }> = [];
  for (const { t, html } of fetchResults) {
    if (!html) {
      failures++;
      errors.push({ source: `${t.url} (${t.age_band})`, message: "fetch failed" });
      continue;
    }
    try {
      const parsed = parseBoardPage(html, { type: t.type, district: t.district, age_band: t.age_band });
      allParsed.push(...parsed);
    } catch (e: any) {
      failures++;
      errors.push({ source: `${t.url} (${t.age_band})`, message: `parse: ${e?.message ?? String(e)}` });
    }
  }
  // Log errors after all fetches done (don't block the hot path).
  for (const err of errors) {
    await logScrapeError(env.DB, err.source, err.message);
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
