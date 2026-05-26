import { runScrape } from "./scraper/cron";
import { handleSearch } from "./routes/search";
import { handleSchool } from "./routes/school";
import { handleSchoolDistrict } from "./routes/district";

export interface Env {
  DB: D1Database;
  GEOCODE_CACHE: KVNamespace;
  DISCORD_WEBHOOK_URL: string;
  ADMIN_TOKEN: string;
  ENVIRONMENT: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return jsonResponse({ ok: true });
    }

    if (url.pathname === "/api/admin/run-cron" && request.method === "POST") {
      if (request.headers.get("x-admin-token") !== env.ADMIN_TOKEN) {
        return new Response("Forbidden", { status: 403 });
      }
      // Manual trigger: optionally accept ?batch=N&total=M to run a single
      // batch (same partitioning as scheduled), default to single full run.
      const batch = url.searchParams.get("batch");
      const total = url.searchParams.get("total");
      if (batch != null && total != null) {
        const result = await runScrape(env, parseInt(batch, 10), parseInt(total, 10));
        return jsonResponse({ ok: true, ran_at: Date.now(), batch: parseInt(batch, 10), of: parseInt(total, 10), ...result });
      }
      const result = await runScrape(env);
      return jsonResponse({ ok: true, ran_at: Date.now(), ...result });
    }

    if (url.pathname === "/api/search") return handleSearch(request, env);
    if (url.pathname === "/api/school-district") return handleSchoolDistrict(request, env);

    const schoolMatch = url.pathname.match(/^\/api\/school\/([^/]+)$/);
    if (schoolMatch) return handleSchool(request, env, decodeURIComponent(schoolMatch[1]));

    return new Response("Not Found", { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Workers Free has 50 subrequests per invocation. The full scrape needs
    // ~120 (72 targets × up to 2 HTTP calls each). Split into 3 batches that
    // rotate every 3-minute tick, so the full set refreshes every 9 minutes.
    const TICKS_PER_CYCLE = 3;
    const tickIdx = Math.floor(event.scheduledTime / 180_000) % TICKS_PER_CYCLE;
    ctx.waitUntil(runScrape(env, tickIdx, TICKS_PER_CYCLE));
  },
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}
