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
    return new Response("Not Found", { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // cron entry — filled in by later task
  },
};
