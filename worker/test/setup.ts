import { env, applyD1Migrations } from "cloudflare:test";
import { beforeAll, inject } from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    migrations: import("cloudflare:test").D1Migration[];
  }
}

beforeAll(async () => {
  const migrations = inject("migrations");
  await applyD1Migrations(env.DB, migrations);
});
