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
      const result = await runScrape(env);
      return jsonResponse({ ok: true, ran_at: Date.now(), ...result });
    }

    if (url.pathname === "/api/search") return handleSearch(request, env);
    if (url.pathname === "/api/school-district") return handleSchoolDistrict(request, env);

    const schoolMatch = url.pathname.match(/^\/api\/school\/([^/]+)$/);
    if (schoolMatch) return handleSchool(request, env, decodeURIComponent(schoolMatch[1]));

    return new Response("Not Found", { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScrape(env));
  },
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}
