import { defineConfig } from "vitest/config";

// Unit tests use the standard Node pool (no Miniflare).
// Integration tests use the workers pool (see vitest.integration.config.ts).
// Run both with: pnpm test (unit) and pnpm test:integration (integration).
export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
  },
});
