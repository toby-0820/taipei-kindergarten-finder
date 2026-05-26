import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";
import path from "node:path";

const migrations = await readD1Migrations(
  path.resolve(import.meta.dirname, "../migrations"),
);

export default defineWorkersConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
    provide: {
      migrations,
    },
    poolOptions: {
      workers: {
        // Use the test-specific entrypoint that excludes the CJS scraper dependency
        main: "./src/index.test-entry.ts",
        miniflare: {
          d1Databases: ["DB"],
          kvNamespaces: ["GEOCODE_CACHE"],
          compatibilityDate: "2024-12-30",
          compatibilityFlags: ["nodejs_compat"],
        },
      },
    },
  },
});
