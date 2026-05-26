// Minimal worker entrypoint for integration tests — excludes the scraper
// (which pulls in node-html-parser, a CJS module incompatible with Miniflare's Vite pipeline).
import { handleSearch } from "./routes/search";
import { handleSchool } from "./routes/school";

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
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/api/search") return handleSearch(request, env);

    const schoolMatch = url.pathname.match(/^\/api\/school\/([^/]+)$/);
    if (schoolMatch) return handleSchool(request, env, decodeURIComponent(schoolMatch[1]));

    return new Response("Not Found", { status: 404 });
  },
};
