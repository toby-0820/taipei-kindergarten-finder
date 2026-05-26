# Taipei Kindergarten Finder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public website that takes a Taipei home address (or school name) and returns nearby public + non-profit kindergartens with distance, current registration counts, and priority-aware admission probabilities — refreshed every 3 minutes.

**Architecture:** Cloudflare full-stack — Astro static frontend (Pages) calls Workers API backed by D1 SQLite at the edge. A Workers Cron Trigger fetches `kid.tp.edu.tw` and `npkid.tp.edu.tw` every 3 minutes, parses their server-rendered ASP.NET pages, and upserts snapshots into D1. KV caches geocoding results for 24h.

**Tech Stack:** TypeScript, pnpm workspaces, Cloudflare Workers + D1 + KV + Pages, Astro 4, Leaflet + OpenStreetMap tiles, TGOS (Taiwan government geocoding), Vitest + Miniflare for testing, Playwright for E2E, GitHub Actions for CI/CD.

**Spec reference:** `docs/superpowers/specs/2026-05-26-taipei-kindergarten-finder-design.md`

---

## File Structure

```
taipei-kindergarten-finder/
├── package.json                       (root, pnpm workspace)
├── pnpm-workspace.yaml
├── .gitignore
├── README.md
├── wrangler.toml                      (worker config, D1/KV bindings, cron)
├── web/                               (Astro frontend)
│   ├── package.json
│   ├── astro.config.mjs
│   ├── src/
│   │   ├── pages/index.astro
│   │   ├── components/
│   │   │   ├── SearchBar.astro
│   │   │   ├── Banner.astro
│   │   │   ├── ResultList.astro
│   │   │   ├── ResultCard.astro
│   │   │   ├── PriorityDetail.astro
│   │   │   ├── MapView.astro
│   │   │   └── PrioritySelector.astro
│   │   ├── lib/
│   │   │   ├── api-client.ts          (typed fetch wrappers)
│   │   │   ├── probability.ts         (calcByPriority, mirrors worker)
│   │   │   └── format.ts              (km, %, time-ago)
│   │   └── styles/global.css
│   └── public/
├── worker/                            (Cloudflare Worker: API + Cron)
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts                   (entry: routes + scheduled handler)
│   │   ├── types.ts                   (shared types: School, Snapshot, ApiResponse)
│   │   ├── routes/
│   │   │   ├── search.ts              (GET /api/search)
│   │   │   ├── school.ts              (GET /api/school/:id)
│   │   │   └── geocode.ts             (GET /api/geocode)
│   │   ├── lib/
│   │   │   ├── db.ts                  (D1 query wrappers)
│   │   │   ├── geocode.ts             (TGOS client + KV cache)
│   │   │   ├── distance.ts            (haversineKm)
│   │   │   └── probability.ts         (calcByPriority)
│   │   └── scraper/
│   │       ├── cron.ts                (cron entry: fetch → parse → upsert)
│   │       ├── fetch-pages.ts         (fetch both sites, all districts)
│   │       ├── parse.ts               (HTML → snapshot rows)
│   │       ├── upsert.ts              (D1 writes for schools + snapshots)
│   │       └── mode-detect.ts         (open/closed/drawn detection)
│   └── test/
│       ├── unit/
│       │   ├── distance.test.ts
│       │   ├── probability.test.ts
│       │   ├── parse.test.ts
│       │   └── mode-detect.test.ts
│       ├── integration/
│       │   └── api.test.ts            (Miniflare end-to-end)
│       └── fixtures/
│           ├── kid-songshan-open.html
│           ├── kid-songshan-closed.html
│           └── npkid-zhongshan-open.html
├── migrations/
│   └── 0001_initial.sql
├── e2e/
│   ├── playwright.config.ts
│   └── specs/
│       ├── address-search.spec.ts
│       └── school-search.spec.ts
├── .github/workflows/
│   ├── ci.yml
│   └── deploy.yml
└── docs/superpowers/
    ├── specs/2026-05-26-taipei-kindergarten-finder-design.md
    └── plans/2026-05-26-taipei-kindergarten-finder.md
```

---

## Prerequisites (Human Setup — Required Before Task 1)

These need real-world account / key creation that the implementing agent cannot do:

- [ ] **Cloudflare account** — sign up at https://dash.cloudflare.com (free tier is enough).
- [ ] **Install wrangler CLI** locally: `npm install -g wrangler && wrangler login`
- [ ] **TGOS API key** — register at https://api.nlsc.gov.tw/ (內政部國土測繪中心，免費). Note the key for `.dev.vars`.
- [ ] **Discord webhook URL** — for failure alerts. Create one in any Discord channel under "Integrations → Webhooks".
- [ ] **Node 20+ and pnpm 8+** — `corepack enable && corepack prepare pnpm@latest --activate`

The implementing agent should pause and request these before starting Task 2 if not provided.

---

## Phase A — Project Bootstrap

### Task 1: Root workspace setup

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.gitignore`
- Create: `README.md`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "taipei-kindergarten-finder",
  "private": true,
  "version": "0.1.0",
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "dev:worker": "pnpm --filter worker dev",
    "dev:web": "pnpm --filter web dev",
    "build": "pnpm --filter web build && pnpm --filter worker build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint"
  }
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "web"
  - "worker"
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
.wrangler/
dist/
.dev.vars
.env
.env.local
*.log
.DS_Store
playwright-report/
test-results/
```

- [ ] **Step 4: Create `README.md`**

```markdown
# 台北幼兒園即時查

公開、免費的台北市公幼／非營利幼兒園即時招生查詢站。

- 輸入家裡地址或學校名稱，列出附近園所
- 顯示今年招生名額與即時報名數（每 3 分鐘更新）
- 依順位分別估算中籤機率

**資料來源：** 臺北市政府教育局 kid.tp.edu.tw, npkid.tp.edu.tw

## 開發

\`\`\`
pnpm install
pnpm dev:worker   # 本機跑 Worker (port 8787)
pnpm dev:web      # 本機跑 Astro (port 4321)
pnpm test
\`\`\`

詳細設計請見 `docs/superpowers/specs/`。
```

- [ ] **Step 5: Verify pnpm install runs**

Run: `pnpm install`
Expected: pnpm creates a lockfile without errors (workspace packages don't exist yet, that's fine; pnpm will just install root deps).

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml .gitignore README.md pnpm-lock.yaml
git commit -m "chore: initialize pnpm workspace"
```

---

### Task 2: Cloudflare resources + wrangler config

**Files:**
- Create: `wrangler.toml`
- Create: `worker/package.json`
- Create: `worker/tsconfig.json`
- Create: `worker/src/index.ts`
- Create: `.dev.vars.example`

- [ ] **Step 1: Create D1 database and KV namespace via wrangler**

Run (will print IDs to paste into `wrangler.toml`):
```bash
wrangler d1 create kindergarten_db
wrangler kv:namespace create geocode_cache
wrangler kv:namespace create geocode_cache --preview
```
Expected: three IDs returned. Save them.

- [ ] **Step 2: Create `wrangler.toml`** (replace `<...>` placeholders with the IDs from Step 1)

```toml
name = "kindergarten-api"
main = "worker/src/index.ts"
compatibility_date = "2026-01-01"

[[d1_databases]]
binding = "DB"
database_name = "kindergarten_db"
database_id = "<paste-d1-id>"

[[kv_namespaces]]
binding = "GEOCODE_CACHE"
id = "<paste-kv-id>"
preview_id = "<paste-kv-preview-id>"

[triggers]
crons = ["*/3 * * * *"]

[vars]
ENVIRONMENT = "production"
```

- [ ] **Step 3: Create `worker/package.json`**

```json
{
  "name": "worker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "build": "wrangler deploy --dry-run",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "node-html-parser": "^6.1.13"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.0",
    "@cloudflare/workers-types": "^4.20260101.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "wrangler": "^3.80.0"
  }
}
```

- [ ] **Step 4: Create `worker/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types", "vitest/globals"]
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 5: Create minimal `worker/src/index.ts`** (placeholder; routes added in later tasks)

```typescript
export interface Env {
  DB: D1Database;
  GEOCODE_CACHE: KVNamespace;
  TGOS_API_KEY: string;
  DISCORD_WEBHOOK_URL: string;
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
    // cron entry — filled in by Task 13
  },
};
```

- [ ] **Step 6: Create `.dev.vars.example`**

```
TGOS_API_KEY=replace-with-real-key
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

- [ ] **Step 7: Run local dev to verify Worker boots**

```bash
cd worker && cp .dev.vars.example .dev.vars && pnpm dev
```
In another shell:
```bash
curl http://localhost:8787/api/health
```
Expected: `{"ok":true}`. Then Ctrl-C the dev server.

- [ ] **Step 8: Commit**

```bash
git add wrangler.toml worker/ .dev.vars.example
git commit -m "feat(worker): scaffold cloudflare worker with health endpoint"
```

---

### Task 3: D1 migration — initial schema

**Files:**
- Create: `migrations/0001_initial.sql`

- [ ] **Step 1: Create `migrations/0001_initial.sql`**

```sql
CREATE TABLE IF NOT EXISTS schools (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('public','non_profit')),
  district      TEXT NOT NULL,
  address       TEXT NOT NULL,
  lat           REAL,
  lng           REAL,
  phone         TEXT,
  website       TEXT,
  classes_json  TEXT NOT NULL DEFAULT '[]',
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_schools_district ON schools(district);
CREATE INDEX IF NOT EXISTS idx_schools_type     ON schools(type);

CREATE TABLE IF NOT EXISTS snapshots (
  school_id   TEXT NOT NULL,
  age_band    TEXT NOT NULL,
  capacity    INTEGER NOT NULL,
  reg_p1      INTEGER,
  reg_p2      INTEGER,
  reg_p3      INTEGER,
  reg_p4      INTEGER,
  reg_p5      INTEGER,
  reg_total   INTEGER,
  fetched_at  INTEGER NOT NULL,
  is_latest   INTEGER NOT NULL CHECK (is_latest IN (0,1)),
  PRIMARY KEY (school_id, age_band, is_latest),
  FOREIGN KEY (school_id) REFERENCES schools(id)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_latest ON snapshots(is_latest, school_id);

CREATE TABLE IF NOT EXISTS registration_window (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  mode            TEXT NOT NULL CHECK (mode IN ('closed','open','drawn')),
  detected_at     INTEGER NOT NULL,
  priority_labels TEXT,
  notes           TEXT
);

INSERT OR IGNORE INTO registration_window (id, mode, detected_at, priority_labels, notes)
VALUES (1, 'closed', strftime('%s','now')*1000, NULL, 'initial state');

CREATE TABLE IF NOT EXISTS scrape_errors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT NOT NULL,
  message     TEXT NOT NULL,
  occurred_at INTEGER NOT NULL
);
```

- [ ] **Step 2: Apply migration to local D1**

```bash
wrangler d1 migrations apply kindergarten_db --local
```
Expected: "Migration 0001_initial.sql applied successfully."

- [ ] **Step 3: Verify schema with a query**

```bash
wrangler d1 execute kindergarten_db --local --command "SELECT name FROM sqlite_master WHERE type='table';"
```
Expected output includes: `schools`, `snapshots`, `registration_window`, `scrape_errors`.

- [ ] **Step 4: Commit**

```bash
git add migrations/
git commit -m "feat(db): initial D1 schema for schools, snapshots, registration_window"
```

---

## Phase B — Core Pure Libraries (TDD)

### Task 4: Distance library (haversine)

**Files:**
- Create: `worker/src/lib/distance.ts`
- Create: `worker/test/unit/distance.test.ts`
- Create: `worker/vitest.config.ts`

- [ ] **Step 1: Create `worker/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
```

- [ ] **Step 2: Write failing test in `worker/test/unit/distance.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { haversineKm } from "../../src/lib/distance";

describe("haversineKm", () => {
  it("returns 0 for the same point", () => {
    expect(haversineKm(25.05, 121.55, 25.05, 121.55)).toBe(0);
  });

  it("computes Taipei 101 → 中正紀念堂 (~3.5 km)", () => {
    // Taipei 101: 25.0337, 121.5645
    // 中正紀念堂: 25.0359, 121.5198
    const d = haversineKm(25.0337, 121.5645, 25.0359, 121.5198);
    expect(d).toBeGreaterThan(4.4);
    expect(d).toBeLessThan(4.6);
  });

  it("computes 台北車站 → 信義區公所 (~3.6 km)", () => {
    // 台北車站: 25.0478, 121.5170
    // 信義區公所: 25.0331, 121.5654
    const d = haversineKm(25.0478, 121.5170, 25.0331, 121.5654);
    expect(d).toBeGreaterThan(5.2);
    expect(d).toBeLessThan(5.6);
  });

  it("is symmetric", () => {
    const a = haversineKm(25.05, 121.55, 25.10, 121.60);
    const b = haversineKm(25.10, 121.60, 25.05, 121.55);
    expect(a).toBeCloseTo(b, 6);
  });
});
```

- [ ] **Step 3: Run test, expect failure**

```bash
cd worker && pnpm test
```
Expected: 4 failing tests, "Cannot find module '../../src/lib/distance'".

- [ ] **Step 4: Implement `worker/src/lib/distance.ts`**

```typescript
const R_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R_KM * c;
}
```

- [ ] **Step 5: Run test, expect pass**

```bash
pnpm test
```
Expected: 4 passing tests.

- [ ] **Step 6: Commit**

```bash
git add worker/src/lib/distance.ts worker/test/unit/distance.test.ts worker/vitest.config.ts
git commit -m "feat(worker): haversineKm utility with tests"
```

---

### Task 5: Probability library (priority-aware)

**Files:**
- Create: `worker/src/lib/probability.ts`
- Create: `worker/test/unit/probability.test.ts`

- [ ] **Step 1: Write failing tests in `worker/test/unit/probability.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { calcByPriority } from "../../src/lib/probability";

describe("calcByPriority", () => {
  it("returns 1.0 for all priorities when total registrations < capacity", () => {
    const { probs, remaining_after_all } = calcByPriority(60, [5, 8, 10, 12, 20]);
    expect(probs).toEqual([1.0, 1.0, 1.0, 1.0, 1.0]);
    expect(remaining_after_all).toBe(5);
  });

  it("returns 1.0 for all priorities when total exactly equals capacity", () => {
    const { probs, remaining_after_all } = calcByPriority(50, [10, 10, 10, 10, 10]);
    expect(probs).toEqual([1.0, 1.0, 1.0, 1.0, 1.0]);
    expect(remaining_after_all).toBe(0);
  });

  it("partial fill at the boundary priority", () => {
    // capacity 60, regs [5, 8, 22, 30, 80] → after p1..p3 remaining=25, p4 needs 30 → 25/30
    const { probs } = calcByPriority(60, [5, 8, 22, 30, 80]);
    expect(probs[0]).toBe(1.0);
    expect(probs[1]).toBe(1.0);
    expect(probs[2]).toBe(1.0);
    expect(probs[3]).toBeCloseTo(25 / 30, 6);
    expect(probs[4]).toBe(0.0);
  });

  it("higher priority oversubscribed — lower priorities get 0", () => {
    const { probs } = calcByPriority(30, [50, 20, 20, 20, 20]);
    expect(probs[0]).toBeCloseTo(30 / 50, 6);
    expect(probs[1]).toBe(0.0);
    expect(probs[2]).toBe(0.0);
    expect(probs[3]).toBe(0.0);
    expect(probs[4]).toBe(0.0);
  });

  it("returns null for a priority with zero registrations", () => {
    const { probs } = calcByPriority(60, [0, 5, 0, 30, 100]);
    expect(probs[0]).toBeNull();
    expect(probs[1]).toBe(1.0);
    expect(probs[2]).toBeNull();
    expect(probs[3]).toBe(1.0);
    expect(probs[4]).toBeCloseTo((60 - 35) / 100, 6);
  });

  it("returns null for a priority where registered is null", () => {
    const { probs } = calcByPriority(60, [null, 5, null, 30, 100]);
    expect(probs[0]).toBeNull();
    expect(probs[2]).toBeNull();
  });

  it("capacity 0 — every priority gets 0", () => {
    const { probs } = calcByPriority(0, [5, 10, 10, 10, 10]);
    expect(probs).toEqual([0.0, 0.0, 0.0, 0.0, 0.0]);
  });

  it("works with arbitrary priority count", () => {
    const { probs } = calcByPriority(20, [10, 15]);
    expect(probs[0]).toBe(1.0);
    expect(probs[1]).toBeCloseTo(10 / 15, 6);
  });

  it("computes remaining_after_all correctly", () => {
    const { remaining_after_all } = calcByPriority(60, [10, 10, 10]);
    expect(remaining_after_all).toBe(30);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm test
```
Expected: all 9 tests fail with "Cannot find module".

- [ ] **Step 3: Implement `worker/src/lib/probability.ts`**

```typescript
export type Reg = number | null;

export interface ProbabilityResult {
  probs: (number | null)[];
  remaining_after_all: number;
}

export function calcByPriority(capacity: number, regs: Reg[]): ProbabilityResult {
  let remaining = capacity;
  const probs: (number | null)[] = [];
  for (const reg of regs) {
    if (reg == null || reg === 0) {
      probs.push(reg == null ? null : 0.0);
      continue;
    }
    if (remaining >= reg) {
      probs.push(1.0);
      remaining -= reg;
    } else if (remaining > 0) {
      probs.push(remaining / reg);
      remaining = 0;
    } else {
      probs.push(0.0);
    }
  }
  return { probs, remaining_after_all: remaining };
}
```

Wait — the test "returns null for a priority with zero registrations" expects `probs[0]` to be `null` when `regs[0] === 0`. But "capacity 0 — every priority gets 0" expects all to be `0.0` even though regs are non-zero. The current implementation returns `0.0` for `reg === 0`, but the test expects `null`. Adjust:

```typescript
export type Reg = number | null;

export interface ProbabilityResult {
  probs: (number | null)[];
  remaining_after_all: number;
}

export function calcByPriority(capacity: number, regs: Reg[]): ProbabilityResult {
  let remaining = capacity;
  const probs: (number | null)[] = [];
  for (const reg of regs) {
    if (reg == null) {
      probs.push(null);
      continue;
    }
    if (reg === 0) {
      probs.push(null);
      continue;
    }
    if (remaining >= reg) {
      probs.push(1.0);
      remaining -= reg;
    } else if (remaining > 0) {
      probs.push(remaining / reg);
      remaining = 0;
    } else {
      probs.push(0.0);
    }
  }
  return { probs, remaining_after_all: remaining };
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm test
```
Expected: 9 + 4 (distance) = 13 passing tests.

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/probability.ts worker/test/unit/probability.test.ts
git commit -m "feat(worker): priority-aware admission probability calculator"
```

---

## Phase C — Scraper Parser (TDD with Real Fixtures)

### Task 6: Capture real HTML fixtures from kid.tp.edu.tw and npkid.tp.edu.tw

**Files:**
- Create: `worker/test/fixtures/kid-songshan.html`
- Create: `worker/test/fixtures/kid-zhongshan.html`
- Create: `worker/test/fixtures/npkid-zhongshan.html`
- Create: `worker/test/fixtures/dist-codes.json`

- [ ] **Step 1: Manually visit https://kid.tp.edu.tw/ in a browser**

Click each of the 12 district buttons. Record:
- The `dist=` query value for each district name.
- Note whether the page is currently showing data (registration period) or "查無資料" (off-season).

Save the mapping to `worker/test/fixtures/dist-codes.json`:

```json
{
  "松山區": "<actual-code-from-url>",
  "信義區": "<actual-code-from-url>",
  "大安區": "<actual-code-from-url>",
  "中山區": "<actual-code-from-url>",
  "中正區": "<actual-code-from-url>",
  "大同區": "<actual-code-from-url>",
  "萬華區": "<actual-code-from-url>",
  "文山區": "<actual-code-from-url>",
  "南港區": "<actual-code-from-url>",
  "內湖區": "<actual-code-from-url>",
  "士林區": "<actual-code-from-url>",
  "北投區": "<actual-code-from-url>"
}
```

- [ ] **Step 2: Save 3 real pages as fixtures**

```bash
curl -sL "https://kid.tp.edu.tw/Board.aspx?dist=<松山-code>" -o worker/test/fixtures/kid-songshan.html
curl -sL "https://kid.tp.edu.tw/Board.aspx?dist=<中山-code>" -o worker/test/fixtures/kid-zhongshan.html
curl -sL "https://npkid.tp.edu.tw/Board.aspx?dist=<中山-code>" -o worker/test/fixtures/npkid-zhongshan.html
```

- [ ] **Step 3: Manually inspect the HTML**

Open one fixture in an editor. Locate:
- The table / list element that contains schools.
- Each school's name, address, phone.
- Each `(age_band, capacity, reg_p1..p5)` row.

Write down the CSS selectors you'd use. This informs the parser in Task 7.

- [ ] **Step 4: Commit fixtures**

```bash
git add worker/test/fixtures/
git commit -m "test(worker): add real HTML fixtures from kid.tp.edu.tw and npkid.tp.edu.tw"
```

---

### Task 7: Parser for both ASP.NET sites (shared)

**Files:**
- Create: `worker/src/types.ts`
- Create: `worker/src/scraper/parse.ts`
- Create: `worker/test/unit/parse.test.ts`

- [ ] **Step 1: Create `worker/src/types.ts`**

```typescript
export type SchoolType = "public" | "non_profit";
export type AgeBand = "3-5歲班" | "2歲專班";

export interface ParsedClass {
  age_band: AgeBand;
  capacity: number;
  reg_p1: number | null;
  reg_p2: number | null;
  reg_p3: number | null;
  reg_p4: number | null;
  reg_p5: number | null;
  reg_total: number | null;
}

export interface ParsedSchool {
  id: string;          // school code as published on the page
  name: string;
  type: SchoolType;
  district: string;
  address: string;
  phone: string | null;
  classes: ParsedClass[];
}
```

- [ ] **Step 2: Write failing test in `worker/test/unit/parse.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBoardPage } from "../../src/scraper/parse";

const FIX = (name: string) =>
  readFileSync(join(__dirname, "../fixtures", name), "utf-8");

describe("parseBoardPage", () => {
  it("parses kid.tp.edu.tw 松山區 — extracts at least one school with valid fields", () => {
    const html = FIX("kid-songshan.html");
    const schools = parseBoardPage(html, { type: "public", district: "松山區" });

    expect(schools.length).toBeGreaterThan(0);
    const s = schools[0];
    expect(s.id).toMatch(/.+/);
    expect(s.name).toMatch(/.+/);
    expect(s.type).toBe("public");
    expect(s.district).toBe("松山區");
    expect(s.address).toMatch(/.+/);
    expect(s.classes.length).toBeGreaterThan(0);

    for (const c of s.classes) {
      expect(["3-5歲班", "2歲專班"]).toContain(c.age_band);
      expect(c.capacity).toBeGreaterThanOrEqual(0);
    }
  });

  it("parses npkid.tp.edu.tw 中山區 — type=non_profit", () => {
    const html = FIX("npkid-zhongshan.html");
    const schools = parseBoardPage(html, { type: "non_profit", district: "中山區" });

    expect(schools.length).toBeGreaterThan(0);
    for (const s of schools) {
      expect(s.type).toBe("non_profit");
    }
  });

  it("returns empty array when page shows 查無資料", () => {
    const html = `<html><body><div>查無資料!</div></body></html>`;
    const schools = parseBoardPage(html, { type: "public", district: "松山區" });
    expect(schools).toEqual([]);
  });

  it("skips a school row with missing required fields rather than crashing", () => {
    const html = `<html><body><table id="schools"><tr><td></td><td></td></tr></table></body></html>`;
    const schools = parseBoardPage(html, { type: "public", district: "松山區" });
    expect(schools).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test, expect failure**

```bash
pnpm test parse
```
Expected: "Cannot find module" failure.

- [ ] **Step 4: Implement `worker/src/scraper/parse.ts`**

The exact selectors depend on the real HTML structure inspected in Task 6 Step 3. Below is a defensive scaffold; **adjust selectors to match what you observed**. Use `node-html-parser` (already in deps).

```typescript
import { parse, HTMLElement } from "node-html-parser";
import type { ParsedSchool, ParsedClass, SchoolType, AgeBand } from "../types";

export interface ParseContext {
  type: SchoolType;
  district: string;
}

export function parseBoardPage(html: string, ctx: ParseContext): ParsedSchool[] {
  if (html.includes("查無資料")) return [];

  const root = parse(html);
  const schools: ParsedSchool[] = [];

  // ADJUST: actual selector depends on HTML structure inspected in Task 6
  const rows = root.querySelectorAll("table.school-list > tbody > tr, table tr.school-row");
  if (rows.length === 0) return [];

  let current: Partial<ParsedSchool> | null = null;

  for (const row of rows) {
    const nameCell = row.querySelector(".school-name");
    if (nameCell) {
      // start of a new school block
      if (current && isComplete(current)) schools.push(current as ParsedSchool);
      current = {
        id: row.getAttribute("data-school-id") ?? nameCell.text.trim(),
        name: nameCell.text.trim(),
        type: ctx.type,
        district: ctx.district,
        address: row.querySelector(".school-address")?.text.trim() ?? "",
        phone: row.querySelector(".school-phone")?.text.trim() || null,
        classes: [],
      };
      continue;
    }

    const ageBandText = row.querySelector(".age-band")?.text.trim();
    if (!current || !ageBandText) continue;

    const ageBand = normalizeAgeBand(ageBandText);
    if (!ageBand) continue;

    const cls: ParsedClass = {
      age_band: ageBand,
      capacity: parseIntCell(row.querySelector(".capacity")),
      reg_p1: parseIntOrNull(row.querySelector(".reg-p1")),
      reg_p2: parseIntOrNull(row.querySelector(".reg-p2")),
      reg_p3: parseIntOrNull(row.querySelector(".reg-p3")),
      reg_p4: parseIntOrNull(row.querySelector(".reg-p4")),
      reg_p5: parseIntOrNull(row.querySelector(".reg-p5")),
      reg_total: parseIntOrNull(row.querySelector(".reg-total")),
    };
    current.classes!.push(cls);
  }

  if (current && isComplete(current)) schools.push(current as ParsedSchool);
  return schools;
}

function normalizeAgeBand(text: string): AgeBand | null {
  if (text.includes("3-5") || text.includes("混齡")) return "3-5歲班";
  if (text.includes("2歲") || text.includes("2 歲")) return "2歲專班";
  return null;
}

function parseIntCell(el: HTMLElement | null): number {
  if (!el) return 0;
  const n = parseInt(el.text.replace(/[^\d-]/g, ""), 10);
  return isNaN(n) ? 0 : n;
}

function parseIntOrNull(el: HTMLElement | null): number | null {
  if (!el) return null;
  const text = el.text.trim();
  if (!text || text === "-" || text === "—") return null;
  const n = parseInt(text.replace(/[^\d-]/g, ""), 10);
  return isNaN(n) ? null : n;
}

function isComplete(s: Partial<ParsedSchool>): boolean {
  return !!(s.id && s.name && s.address && s.classes && s.classes.length > 0);
}
```

> **Note for the implementer:** The selectors `.school-name`, `.age-band`, `.reg-p1`, etc. are placeholders. After fetching the real fixture in Task 6, replace them with the actual class names, IDs, or structural patterns observed. If the page uses a single flat table where every row is a (school, age_band) pair, simplify accordingly.

- [ ] **Step 5: Run test, expect first two real-HTML tests to fail until selectors are right**

```bash
pnpm test parse
```
Iterate on selectors in `parse.ts` until all 4 tests pass. If the fixture is from off-season ("查無資料"), expect the first two tests to pass trivially with empty arrays — in that case, add a hand-crafted minimal HTML fixture demonstrating one school + one class for each test, and re-run.

- [ ] **Step 6: Commit**

```bash
git add worker/src/types.ts worker/src/scraper/parse.ts worker/test/unit/parse.test.ts
git commit -m "feat(worker): parse kid/npkid Board.aspx pages into structured snapshots"
```

---

### Task 8: Mode detection (open / closed / drawn)

**Files:**
- Create: `worker/src/scraper/mode-detect.ts`
- Create: `worker/test/unit/mode-detect.test.ts`

- [ ] **Step 1: Write failing test in `worker/test/unit/mode-detect.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { detectMode } from "../../src/scraper/mode-detect";
import type { ParsedSchool } from "../../src/types";

function school(regs: (number | null)[]): ParsedSchool {
  return {
    id: "X", name: "X", type: "public", district: "松山區", address: "X", phone: null,
    classes: [{
      age_band: "3-5歲班", capacity: 30,
      reg_p1: regs[0], reg_p2: regs[1], reg_p3: regs[2], reg_p4: regs[3], reg_p5: regs[4],
      reg_total: null,
    }],
  };
}

describe("detectMode", () => {
  it("returns 'open' when at least 3 schools have any reg_pN > 0", () => {
    const schools = [
      school([0, 0, 0, 0, 5]),
      school([0, 0, 0, 0, 8]),
      school([0, 0, 0, 0, 12]),
    ];
    expect(detectMode(schools, new Date("2026-05-15"))).toBe("open");
  });

  it("returns 'closed' when all registrations are null/zero", () => {
    const schools = [
      school([null, null, null, null, null]),
      school([0, 0, 0, 0, 0]),
    ];
    expect(detectMode(schools, new Date("2026-03-15"))).toBe("closed");
  });

  it("returns 'drawn' when current date is past the standard draw date AND data shows zero remaining", () => {
    const schools = [school([null, null, null, null, null])];
    expect(detectMode(schools, new Date("2026-07-15"))).toBe("drawn");
  });

  it("returns 'open' even past draw date if live registrations still visible (edge case: late round)", () => {
    const schools = [school([0, 0, 0, 0, 10]), school([0, 0, 0, 0, 5]), school([0, 0, 0, 0, 8])];
    expect(detectMode(schools, new Date("2026-07-15"))).toBe("open");
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm test mode-detect
```

- [ ] **Step 3: Implement `worker/src/scraper/mode-detect.ts`**

```typescript
import type { ParsedSchool } from "../types";

export type Mode = "closed" | "open" | "drawn";

const REG_PERIOD_START_MONTH = 4;  // April
const DRAW_PERIOD_END_MONTH  = 6;  // June

export function detectMode(schools: ParsedSchool[], now: Date = new Date()): Mode {
  let schoolsWithRegs = 0;
  for (const s of schools) {
    for (const c of s.classes) {
      const anyReg = [c.reg_p1, c.reg_p2, c.reg_p3, c.reg_p4, c.reg_p5]
        .some((r) => r != null && r > 0);
      if (anyReg) {
        schoolsWithRegs++;
        break;
      }
    }
  }

  if (schoolsWithRegs >= 3) return "open";

  const month = now.getMonth() + 1;
  if (month > DRAW_PERIOD_END_MONTH || (month === DRAW_PERIOD_END_MONTH && now.getDate() > 30)) {
    return "drawn";
  }
  return "closed";
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm test mode-detect
```

- [ ] **Step 5: Commit**

```bash
git add worker/src/scraper/mode-detect.ts worker/test/unit/mode-detect.test.ts
git commit -m "feat(worker): detect registration window mode from scraped data"
```

---

## Phase D — Scraper Pipeline + Cron Wiring

### Task 9: D1 query wrappers

**Files:**
- Create: `worker/src/lib/db.ts`

- [ ] **Step 1: Create `worker/src/lib/db.ts`**

```typescript
import type { ParsedSchool, ParsedClass, SchoolType } from "../types";

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
  reg_p1: number | null;
  reg_p2: number | null;
  reg_p3: number | null;
  reg_p4: number | null;
  reg_p5: number | null;
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

export async function rotateSnapshot(
  db: D1Database,
  rows: SnapshotRow[],
): Promise<void> {
  // demote existing is_latest=1 → 0 for affected (school, age_band) pairs
  for (const r of rows) {
    await db
      .prepare(`
        UPDATE snapshots SET is_latest = 0
        WHERE school_id = ? AND age_band = ? AND is_latest = 1
      `)
      .bind(r.school_id, r.age_band)
      .run();
    // delete any previous is_latest = 0 (we only keep latest + previous)
    await db
      .prepare(`
        DELETE FROM snapshots
        WHERE school_id = ? AND age_band = ? AND is_latest = 0
          AND fetched_at < (SELECT MIN(fetched_at) FROM snapshots WHERE school_id = ? AND age_band = ?)
      `)
      .bind(r.school_id, r.age_band, r.school_id, r.age_band)
      .run();
  }

  // insert new rows
  for (const r of rows) {
    await db
      .prepare(`
        INSERT INTO snapshots
          (school_id, age_band, capacity, reg_p1, reg_p2, reg_p3, reg_p4, reg_p5, reg_total, fetched_at, is_latest)
        VALUES (?,?,?,?,?,?,?,?,?,?,1)
      `)
      .bind(
        r.school_id, r.age_band, r.capacity,
        r.reg_p1, r.reg_p2, r.reg_p3, r.reg_p4, r.reg_p5, r.reg_total,
        r.fetched_at,
      )
      .run();
  }
}

export async function setMode(
  db: D1Database,
  mode: "closed" | "open" | "drawn",
  priorityLabels?: string[],
): Promise<void> {
  await db
    .prepare(`
      UPDATE registration_window
      SET mode = ?, detected_at = ?, priority_labels = ?
      WHERE id = 1
    `)
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

export async function logScrapeError(
  db: D1Database,
  source: string,
  message: string,
): Promise<void> {
  await db
    .prepare("INSERT INTO scrape_errors (source, message, occurred_at) VALUES (?,?,?)")
    .bind(source, message.slice(0, 1000), Date.now())
    .run();
}
```

- [ ] **Step 2: Commit (no tests yet — covered by integration test in Task 15)**

```bash
git add worker/src/lib/db.ts
git commit -m "feat(worker): D1 query wrappers for schools, snapshots, mode"
```

---

### Task 10: Geocoding client (TGOS + KV cache)

**Files:**
- Create: `worker/src/lib/geocode.ts`
- Create: `worker/test/unit/geocode.test.ts`

- [ ] **Step 1: Write failing test in `worker/test/unit/geocode.test.ts`**

```typescript
import { describe, it, expect, vi } from "vitest";
import { geocodeAddress } from "../../src/lib/geocode";

function makeKv() {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => { store.set(key, value); },
  } as unknown as KVNamespace;
}

describe("geocodeAddress", () => {
  it("returns cached result without calling TGOS", async () => {
    const kv = makeKv();
    const cacheKey = await sha256Hex("台北市中山區民生東路二段147號");
    await kv.put(`geo:${cacheKey}`, JSON.stringify({ lat: 25.06, lng: 121.54, source: "cache" }));

    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;

    const result = await geocodeAddress("台北市中山區民生東路二段147號", kv, "test-key");
    expect(result.lat).toBeCloseTo(25.06);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("calls TGOS on cache miss and writes back", async () => {
    const kv = makeKv();
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        SUCCESS: "true",
        FUZZY_TYPE: "1",
        X: "121.55",
        Y: "25.05",
      }), { headers: { "content-type": "application/json" } }),
    ) as any;

    const result = await geocodeAddress("台北市信義區市府路1號", kv, "test-key");
    expect(result.lat).toBeCloseTo(25.05);
    expect(result.lng).toBeCloseTo(121.55);

    const cached = await kv.get(`geo:${await sha256Hex("台北市信義區市府路1號")}`);
    expect(cached).not.toBeNull();
  });

  it("throws or returns null on TGOS failure", async () => {
    const kv = makeKv();
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("server error", { status: 500 })) as any;
    const result = await geocodeAddress("無效地址", kv, "test-key");
    expect(result).toBeNull();
  });
});

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm test geocode
```

- [ ] **Step 3: Implement `worker/src/lib/geocode.ts`**

```typescript
export interface GeocodeResult {
  lat: number;
  lng: number;
  source: "cache" | "tgos";
}

export async function geocodeAddress(
  address: string,
  kv: KVNamespace,
  apiKey: string,
): Promise<GeocodeResult | null> {
  const key = await cacheKey(address);
  const cached = await kv.get(`geo:${key}`);
  if (cached) {
    const parsed = JSON.parse(cached);
    return { lat: parsed.lat, lng: parsed.lng, source: "cache" };
  }

  const url = new URL("https://api.nlsc.gov.tw/other/Address2Coordinate");
  url.searchParams.set("Address", address);
  url.searchParams.set("apikey", apiKey);

  let resp: Response;
  try {
    resp = await fetch(url.toString(), { headers: { "accept": "application/json" } });
  } catch {
    return null;
  }
  if (!resp.ok) return null;

  let data: any;
  try {
    data = await resp.json();
  } catch {
    return null;
  }

  const x = parseFloat(data?.X);
  const y = parseFloat(data?.Y);
  if (isNaN(x) || isNaN(y)) return null;

  const result: GeocodeResult = { lat: y, lng: x, source: "tgos" };
  await kv.put(`geo:${key}`, JSON.stringify(result), { expirationTtl: 86400 });
  return result;
}

async function cacheKey(address: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
```

> **Note:** The actual TGOS endpoint and response format must be verified against https://api.nlsc.gov.tw documentation when the API key is obtained. If the response shape differs from `{X, Y}`, adjust parsing accordingly.

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm test geocode
```

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/geocode.ts worker/test/unit/geocode.test.ts
git commit -m "feat(worker): TGOS geocoding client with KV cache"
```

---

### Task 11: Fetch pages helper

**Files:**
- Create: `worker/src/scraper/fetch-pages.ts`

- [ ] **Step 1: Create `worker/src/scraper/fetch-pages.ts`**

```typescript
import type { SchoolType } from "../types";

export interface FetchTarget {
  url: string;
  type: SchoolType;
  district: string;
}

const DIST_CODES: Record<string, string> = {
  // Filled in from worker/test/fixtures/dist-codes.json (Task 6)
  // Example placeholder values — replace with real codes:
  "松山區": "A", "信義區": "B", "大安區": "C", "中山區": "D",
  "中正區": "E", "大同區": "F", "萬華區": "G", "文山區": "H",
  "南港區": "I", "內湖區": "J", "士林區": "K", "北投區": "L",
};

export function buildTargets(): FetchTarget[] {
  const targets: FetchTarget[] = [];
  for (const [district, code] of Object.entries(DIST_CODES)) {
    targets.push({
      url: `https://kid.tp.edu.tw/Board.aspx?dist=${code}`,
      type: "public",
      district,
    });
    targets.push({
      url: `https://npkid.tp.edu.tw/Board.aspx?dist=${code}`,
      type: "non_profit",
      district,
    });
  }
  return targets;
}

export async function fetchHtml(url: string, retries = 2): Promise<string | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: { "user-agent": "TaipeiKindergartenFinderBot/1.0" },
        cf: { cacheTtl: 0 },
      });
      if (resp.ok) return await resp.text();
      if (resp.status >= 500 && attempt < retries) {
        await sleep(2 ** attempt * 5000);
        continue;
      }
      return null;
    } catch {
      if (attempt < retries) await sleep(2 ** attempt * 5000);
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
```

> **CRITICAL:** Replace the placeholder `DIST_CODES` map values with the real codes recorded in `worker/test/fixtures/dist-codes.json` from Task 6.

- [ ] **Step 2: Commit**

```bash
git add worker/src/scraper/fetch-pages.ts
git commit -m "feat(worker): page fetcher with retry for kid/npkid Board.aspx"
```

---

### Task 12: Upsert orchestration

**Files:**
- Create: `worker/src/scraper/upsert.ts`

- [ ] **Step 1: Create `worker/src/scraper/upsert.ts`**

```typescript
import type { ParsedSchool } from "../types";
import { upsertSchool, rotateSnapshot, getSchoolById } from "../lib/db";
import { geocodeAddress } from "../lib/geocode";

export interface UpsertEnv {
  DB: D1Database;
  GEOCODE_CACHE: KVNamespace;
  TGOS_API_KEY: string;
}

export async function upsertParsedSchools(
  env: UpsertEnv,
  parsed: ParsedSchool[],
  fetchedAt: number,
): Promise<{ schoolsWritten: number; snapshotsWritten: number }> {
  let schoolsWritten = 0;
  let snapshotsWritten = 0;

  for (const s of parsed) {
    const existing = await getSchoolById(env.DB, s.id);

    let lat: number | null = existing?.lat ?? null;
    let lng: number | null = existing?.lng ?? null;
    const addressChanged = !existing || existing.address !== s.address;

    if (!existing || addressChanged || lat == null || lng == null) {
      const geo = await geocodeAddress(s.address, env.GEOCODE_CACHE, env.TGOS_API_KEY);
      if (geo) {
        lat = geo.lat;
        lng = geo.lng;
      }
    }

    await upsertSchool(env.DB, {
      id: s.id,
      name: s.name,
      type: s.type,
      district: s.district,
      address: s.address,
      lat, lng,
      phone: s.phone,
      website: null,
      classes_json: JSON.stringify(s.classes.map((c) => ({
        age_band: c.age_band, capacity: c.capacity,
      }))),
      updated_at: fetchedAt,
    });
    schoolsWritten++;

    const snapshots = s.classes.map((c) => ({
      school_id: s.id,
      age_band: c.age_band,
      capacity: c.capacity,
      reg_p1: c.reg_p1, reg_p2: c.reg_p2, reg_p3: c.reg_p3,
      reg_p4: c.reg_p4, reg_p5: c.reg_p5,
      reg_total: c.reg_total,
      fetched_at: fetchedAt,
      is_latest: 1,
    }));
    await rotateSnapshot(env.DB, snapshots);
    snapshotsWritten += snapshots.length;
  }

  return { schoolsWritten, snapshotsWritten };
}
```

- [ ] **Step 2: Commit**

```bash
git add worker/src/scraper/upsert.ts
git commit -m "feat(worker): upsert orchestration for schools + snapshots with geocoding"
```

---

### Task 13: Cron entry point

**Files:**
- Modify: `worker/src/index.ts`
- Create: `worker/src/scraper/cron.ts`

- [ ] **Step 1: Create `worker/src/scraper/cron.ts`**

```typescript
import { buildTargets, fetchHtml } from "./fetch-pages";
import { parseBoardPage } from "./parse";
import { upsertParsedSchools } from "./upsert";
import { detectMode } from "./mode-detect";
import { setMode, logScrapeError } from "../lib/db";
import type { Env } from "../index";
import type { ParsedSchool } from "../types";

export async function runScrape(env: Env): Promise<void> {
  const targets = buildTargets();
  const fetchedAt = Date.now();
  const allParsed: ParsedSchool[] = [];

  for (const t of targets) {
    const html = await fetchHtml(t.url);
    if (!html) {
      await logScrapeError(env.DB, t.url, "fetch failed after retries");
      continue;
    }
    try {
      const parsed = parseBoardPage(html, { type: t.type, district: t.district });
      allParsed.push(...parsed);
    } catch (e: any) {
      await logScrapeError(env.DB, t.url, `parse error: ${e?.message ?? String(e)}`);
    }
  }

  if (allParsed.length > 0) {
    await upsertParsedSchools(env, allParsed, fetchedAt);
  }

  const mode = detectMode(allParsed, new Date(fetchedAt));
  await setMode(env.DB, mode);

  // optional: notify on no data
  if (allParsed.length === 0) {
    await notifyDiscord(env, "⚠️ Cron run produced 0 parsed schools.");
  }
}

export async function notifyDiscord(env: Env, content: string): Promise<void> {
  if (!env.DISCORD_WEBHOOK_URL) return;
  try {
    await fetch(env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
  } catch {
    // swallow; webhook is best-effort
  }
}
```

- [ ] **Step 2: Update `worker/src/index.ts`** to wire scheduled handler

```typescript
import { runScrape } from "./scraper/cron";

export interface Env {
  DB: D1Database;
  GEOCODE_CACHE: KVNamespace;
  TGOS_API_KEY: string;
  DISCORD_WEBHOOK_URL: string;
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
    if (url.pathname === "/api/admin/run-cron" && request.method === "POST") {
      // manual trigger for bootstrap / testing — gated by header
      if (request.headers.get("x-admin-token") !== env.TGOS_API_KEY) {
        return new Response("Forbidden", { status: 403 });
      }
      await runScrape(env);
      return new Response(JSON.stringify({ ok: true, ran_at: Date.now() }), {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("Not Found", { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScrape(env));
  },
};
```

- [ ] **Step 3: Manual smoke test — trigger cron locally**

```bash
cd worker && pnpm dev &
sleep 3
curl -X POST -H "x-admin-token: $(grep TGOS_API_KEY .dev.vars | cut -d= -f2)" http://localhost:8787/api/admin/run-cron
```
Expected: `{"ok":true,"ran_at":...}` and the dev server logs show schools written. Kill the dev server.

- [ ] **Step 4: Verify D1 has data**

```bash
wrangler d1 execute kindergarten_db --local --command "SELECT COUNT(*) AS n FROM schools;"
wrangler d1 execute kindergarten_db --local --command "SELECT COUNT(*) AS n FROM snapshots WHERE is_latest=1;"
wrangler d1 execute kindergarten_db --local --command "SELECT mode FROM registration_window;"
```
Expected: schools count > 0 (likely 200-ish if registration period; if off-season, possibly 0 — that's also OK).

- [ ] **Step 5: Commit**

```bash
git add worker/src/scraper/cron.ts worker/src/index.ts
git commit -m "feat(worker): cron entry — fetch, parse, upsert, mode detect, alert"
```

---

## Phase E — Public API

### Task 14: GET /api/geocode

**Files:**
- Create: `worker/src/routes/geocode.ts`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Create `worker/src/routes/geocode.ts`**

```typescript
import { geocodeAddress } from "../lib/geocode";
import type { Env } from "../index";

export async function handleGeocode(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const addr = url.searchParams.get("addr")?.trim();
  if (!addr) {
    return json({ error: "addr required" }, 400);
  }
  const result = await geocodeAddress(addr, env.GEOCODE_CACHE, env.TGOS_API_KEY);
  if (!result) {
    return json({ geocode_status: "not_found", hint: "請輸入完整地址" }, 200);
  }
  if (!isInTaipei(result.lat, result.lng)) {
    return json({
      geocode_status: "out_of_scope",
      lat: result.lat, lng: result.lng,
      hint: "本站目前僅支援台北市",
    }, 200);
  }
  return json({ geocode_status: "ok", lat: result.lat, lng: result.lng });
}

function isInTaipei(lat: number, lng: number): boolean {
  return lat >= 24.95 && lat <= 25.21 && lng >= 121.45 && lng <= 121.67;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    },
  });
}
```

- [ ] **Step 2: Wire route in `worker/src/index.ts`** (add inside `fetch`, before the 404)

```typescript
import { handleGeocode } from "./routes/geocode";
// ...
if (url.pathname === "/api/geocode") return handleGeocode(request, env);
```

- [ ] **Step 3: Smoke test**

```bash
pnpm dev &
curl 'http://localhost:8787/api/geocode?addr=台北市中山區民生東路二段147號'
```
Expected: `{"geocode_status":"ok","lat":...,"lng":...}`

- [ ] **Step 4: Commit**

```bash
git add worker/src/routes/geocode.ts worker/src/index.ts
git commit -m "feat(worker): GET /api/geocode endpoint"
```

---

### Task 15: GET /api/search

**Files:**
- Create: `worker/src/routes/search.ts`
- Modify: `worker/src/index.ts`
- Create: `worker/test/integration/api.test.ts`

- [ ] **Step 1: Write failing integration test in `worker/test/integration/api.test.ts`**

```typescript
import { describe, it, expect, beforeAll, vi } from "vitest";
import { SELF, env } from "cloudflare:test";

describe("GET /api/search", () => {
  beforeAll(async () => {
    // seed minimal data into D1
    await env.DB.batch([
      env.DB.prepare(`INSERT OR REPLACE INTO schools (id,name,type,district,address,lat,lng,phone,website,classes_json,updated_at)
        VALUES ('S1','測試幼兒園','public','中山區','台北市中山區X路1號',25.06,121.54,NULL,NULL,'[]',1)`),
      env.DB.prepare(`INSERT OR REPLACE INTO snapshots (school_id,age_band,capacity,reg_p1,reg_p2,reg_p3,reg_p4,reg_p5,reg_total,fetched_at,is_latest)
        VALUES ('S1','3-5歲班',30,0,0,0,0,40,40,1000,1)`),
      env.DB.prepare(`UPDATE registration_window SET mode='open', detected_at=1000 WHERE id=1`),
    ]);
  });

  it("returns 400 when neither address nor school provided", async () => {
    const r = await SELF.fetch("https://example.com/api/search");
    expect(r.status).toBe(400);
  });

  it("returns school list when school name matches and probabilities are computed", async () => {
    const r = await SELF.fetch("https://example.com/api/search?school=測試");
    expect(r.status).toBe(200);
    const body = await r.json() as any;
    expect(body.window_mode).toBe("open");
    expect(body.results.length).toBe(1);
    expect(body.results[0].name).toBe("測試幼兒園");
    expect(body.results[0].classes[0].probabilities.p5).toBeCloseTo(30 / 40, 4);
  });

  it("returns school list with distance when address geocodes (TGOS stubbed)", async () => {
    // Stub fetch to short-circuit the TGOS call
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("nlsc.gov.tw")) {
        return new Response(JSON.stringify({ X: "121.54", Y: "25.06" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return originalFetch(url as any);
    }) as any;

    try {
      const r = await SELF.fetch("https://example.com/api/search?address=台北市中山區X路1號");
      expect(r.status).toBe(200);
      const body = await r.json() as any;
      expect(body.results.length).toBeGreaterThanOrEqual(1);
      expect(body.query_lat).toBeCloseTo(25.06, 2);
      expect(body.results[0].distance_km).not.toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
```

- [ ] **Step 2: Configure Miniflare in `worker/vitest.config.ts`**

Replace the file with:

```typescript
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    include: ["test/**/*.test.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "../wrangler.toml" },
        miniflare: {
          d1Databases: ["DB"],
          kvNamespaces: ["GEOCODE_CACHE"],
        },
      },
    },
  },
});
```

Add a setup file to apply migrations: `worker/test/setup.ts`:

```typescript
import { env, applyD1Migrations } from "cloudflare:test";
import { beforeAll } from "vitest";

beforeAll(async () => {
  await applyD1Migrations(env.DB, "../migrations");
});
```

Reference it in vitest config:
```typescript
test: {
  setupFiles: ["./test/setup.ts"],
  // ...
}
```

- [ ] **Step 3: Run test, expect failure**

```bash
pnpm test integration
```

- [ ] **Step 4: Implement `worker/src/routes/search.ts`**

```typescript
import { getAllSchools, getLatestSnapshots, getMode } from "../lib/db";
import { geocodeAddress } from "../lib/geocode";
import { haversineKm } from "../lib/distance";
import { calcByPriority } from "../lib/probability";
import type { Env } from "../index";

export async function handleSearch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const address = url.searchParams.get("address")?.trim() || null;
  const school = url.searchParams.get("school")?.trim() || null;
  const ageBand = url.searchParams.get("age_band")?.trim() || null;
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 50);

  if (!address && !school) {
    return json({ error: "address or school required" }, 400);
  }

  let queryLat: number | null = null;
  let queryLng: number | null = null;
  if (address) {
    const geo = await geocodeAddress(address, env.GEOCODE_CACHE, env.TGOS_API_KEY);
    if (!geo) {
      return json({ geocode_status: "not_found", hint: "請輸入完整地址", results: [] });
    }
    queryLat = geo.lat;
    queryLng = geo.lng;
  }

  const [schools, snapshots, modeInfo] = await Promise.all([
    getAllSchools(env.DB),
    getLatestSnapshots(env.DB),
    getMode(env.DB),
  ]);

  const snapshotsBySchool = new Map<string, typeof snapshots>();
  for (const s of snapshots) {
    const list = snapshotsBySchool.get(s.school_id) ?? [];
    list.push(s);
    snapshotsBySchool.set(s.school_id, list);
  }

  let filtered = schools;
  if (school) {
    const q = school.toLowerCase();
    filtered = filtered.filter((s) => s.name.toLowerCase().includes(q));
  }

  const enriched = filtered.map((s) => {
    const snaps = (snapshotsBySchool.get(s.id) ?? []).filter(
      (sn) => !ageBand || sn.age_band === ageBand,
    );
    const classes = snaps.map((sn) => {
      const regs = [sn.reg_p1, sn.reg_p2, sn.reg_p3, sn.reg_p4, sn.reg_p5];
      const { probs } = modeInfo.mode === "open"
        ? calcByPriority(sn.capacity, regs)
        : { probs: [null, null, null, null, null] };
      return {
        age_band: sn.age_band,
        capacity: sn.capacity,
        registrations: modeInfo.mode === "open" ? {
          p1: sn.reg_p1, p2: sn.reg_p2, p3: sn.reg_p3, p4: sn.reg_p4, p5: sn.reg_p5,
          total: sn.reg_total,
        } : null,
        probabilities: {
          p1: probs[0], p2: probs[1], p3: probs[2], p4: probs[3], p5: probs[4],
        },
        fetched_at: sn.fetched_at,
      };
    });

    const distance_km = (queryLat != null && queryLng != null && s.lat != null && s.lng != null)
      ? haversineKm(queryLat, queryLng, s.lat, s.lng)
      : null;

    return {
      school_id: s.id,
      name: s.name,
      type: s.type,
      district: s.district,
      address: s.address,
      lat: s.lat,
      lng: s.lng,
      phone: s.phone,
      distance_km,
      classes,
    };
  });

  if (queryLat != null) {
    enriched.sort((a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity));
  }

  return json({
    window_mode: modeInfo.mode,
    priority_labels: modeInfo.priority_labels,
    query_lat: queryLat,
    query_lng: queryLng,
    fetched_at: snapshots[0]?.fetched_at ?? null,
    results: enriched.slice(0, limit),
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    },
  });
}
```

- [ ] **Step 5: Wire route in `worker/src/index.ts`**

```typescript
import { handleSearch } from "./routes/search";
// inside fetch:
if (url.pathname === "/api/search") return handleSearch(request, env);
```

- [ ] **Step 6: Run integration test, expect pass**

```bash
pnpm test integration
```

- [ ] **Step 7: Commit**

```bash
git add worker/src/routes/search.ts worker/src/index.ts worker/test/integration/ worker/test/setup.ts worker/vitest.config.ts
git commit -m "feat(worker): GET /api/search with distance + priority probabilities"
```

---

### Task 16: GET /api/school/:id

**Files:**
- Create: `worker/src/routes/school.ts`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Create `worker/src/routes/school.ts`**

```typescript
import { getSchoolById, getLatestSnapshots, getMode } from "../lib/db";
import { calcByPriority } from "../lib/probability";
import type { Env } from "../index";

export async function handleSchool(request: Request, env: Env, id: string): Promise<Response> {
  const school = await getSchoolById(env.DB, id);
  if (!school) {
    return json({ error: "school not found" }, 404);
  }
  const [snapshots, modeInfo] = await Promise.all([
    getLatestSnapshots(env.DB, [id]),
    getMode(env.DB),
  ]);

  const classes = snapshots.map((sn) => {
    const regs = [sn.reg_p1, sn.reg_p2, sn.reg_p3, sn.reg_p4, sn.reg_p5];
    const { probs } = modeInfo.mode === "open"
      ? calcByPriority(sn.capacity, regs)
      : { probs: [null, null, null, null, null] };
    return {
      age_band: sn.age_band,
      capacity: sn.capacity,
      registrations: modeInfo.mode === "open" ? {
        p1: sn.reg_p1, p2: sn.reg_p2, p3: sn.reg_p3, p4: sn.reg_p4, p5: sn.reg_p5,
        total: sn.reg_total,
      } : null,
      probabilities: { p1: probs[0], p2: probs[1], p3: probs[2], p4: probs[3], p5: probs[4] },
      fetched_at: sn.fetched_at,
    };
  });

  return json({
    window_mode: modeInfo.mode,
    priority_labels: modeInfo.priority_labels,
    school: {
      school_id: school.id,
      name: school.name,
      type: school.type,
      district: school.district,
      address: school.address,
      lat: school.lat, lng: school.lng,
      phone: school.phone,
      classes,
    },
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}
```

- [ ] **Step 2: Wire route in `worker/src/index.ts`**

```typescript
import { handleSchool } from "./routes/school";
// inside fetch:
const schoolMatch = url.pathname.match(/^\/api\/school\/([^/]+)$/);
if (schoolMatch) return handleSchool(request, env, decodeURIComponent(schoolMatch[1]));
```

- [ ] **Step 3: Smoke test**

```bash
pnpm dev &
curl 'http://localhost:8787/api/school/<some-real-id>'
```

- [ ] **Step 4: Commit**

```bash
git add worker/src/routes/school.ts worker/src/index.ts
git commit -m "feat(worker): GET /api/school/:id endpoint"
```

---

## Phase F — Astro Frontend

### Task 17: Astro project scaffold

**Files:**
- Create: `web/package.json`
- Create: `web/astro.config.mjs`
- Create: `web/tsconfig.json`
- Create: `web/src/pages/index.astro`
- Create: `web/src/styles/global.css`

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "test": "echo no unit tests yet"
  },
  "dependencies": {
    "astro": "^4.16.0",
    "leaflet": "^1.9.4"
  },
  "devDependencies": {
    "@types/leaflet": "^1.9.12"
  }
}
```

- [ ] **Step 2: Create `web/astro.config.mjs`**

```javascript
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  build: { format: "directory" },
  server: { port: 4321 },
});
```

- [ ] **Step 3: Create `web/tsconfig.json`**

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Create `web/src/styles/global.css`**

```css
* { box-sizing: border-box; }
:root {
  --bg: #fafaf8;
  --text: #1a1a1a;
  --accent: #2563eb;
  --border: #e5e7eb;
  --muted: #6b7280;
  --warn-bg: #fef3c7;
  --warn-fg: #92400e;
  --good: #16a34a;
  --bad: #dc2626;
  font-family: -apple-system, "PingFang TC", "Noto Sans TC", sans-serif;
}
body { margin: 0; background: var(--bg); color: var(--text); }
a { color: var(--accent); }
.container { max-width: 1200px; margin: 0 auto; padding: 1rem; }
.banner-warn { background: var(--warn-bg); color: var(--warn-fg); padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem; }
```

- [ ] **Step 5: Create `web/src/pages/index.astro` (minimal placeholder)**

```astro
---
import "../styles/global.css";
---
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>台北幼兒園即時查 — 公幼 / 非營利</title>
    <meta name="description" content="輸入地址或學校名稱，查詢台北市公幼與非營利幼兒園的招生名額、即時報名數與分順位中籤機率。資料每 3 分鐘更新。" />
  </head>
  <body>
    <div class="container">
      <h1>台北幼兒園即時查</h1>
      <p>輸入地址或學校名稱，查詢公幼／非營利招生狀況。</p>
      <div id="app">Loading...</div>
    </div>
    <script type="module" src="/main.js"></script>
  </body>
</html>
```

- [ ] **Step 6: Install + boot dev server**

```bash
cd web && pnpm install
pnpm dev
```
Expected: page renders at http://localhost:4321 with the placeholder.

- [ ] **Step 7: Commit**

```bash
cd ..
git add web/ pnpm-lock.yaml
git commit -m "feat(web): scaffold Astro frontend"
```

---

### Task 18: API client + format helpers

**Files:**
- Create: `web/src/lib/api-client.ts`
- Create: `web/src/lib/format.ts`
- Create: `web/src/lib/probability.ts`

- [ ] **Step 1: Create `web/src/lib/api-client.ts`**

```typescript
const API_BASE = import.meta.env.PUBLIC_API_BASE ?? "http://localhost:8787";

export interface ClassData {
  age_band: "3-5歲班" | "2歲專班";
  capacity: number;
  registrations: {
    p1: number | null; p2: number | null; p3: number | null;
    p4: number | null; p5: number | null; total: number | null;
  } | null;
  probabilities: {
    p1: number | null; p2: number | null; p3: number | null;
    p4: number | null; p5: number | null;
  };
  fetched_at: number;
}

export interface SchoolResult {
  school_id: string;
  name: string;
  type: "public" | "non_profit";
  district: string;
  address: string;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  distance_km: number | null;
  classes: ClassData[];
}

export interface SearchResponse {
  window_mode: "closed" | "open" | "drawn";
  priority_labels: string[] | null;
  query_lat: number | null;
  query_lng: number | null;
  fetched_at: number | null;
  results: SchoolResult[];
  geocode_status?: "ok" | "not_found" | "out_of_scope";
  hint?: string;
}

export async function search(params: {
  address?: string;
  school?: string;
  age_band?: "3-5歲班" | "2歲專班";
  limit?: number;
}): Promise<SearchResponse> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null) qs.set(k, String(v));
  const r = await fetch(`${API_BASE}/api/search?${qs}`);
  if (!r.ok) throw new Error(`search failed: ${r.status}`);
  return r.json();
}
```

- [ ] **Step 2: Create `web/src/lib/format.ts`**

```typescript
export function fmtKm(km: number | null): string {
  if (km == null) return "—";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

export function fmtPct(p: number | null): string {
  if (p == null) return "—";
  return `${Math.round(p * 100)}%`;
}

export function fmtTimeAgo(unixMs: number | null): string {
  if (!unixMs) return "尚無資料";
  const diff = Date.now() - unixMs;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "剛剛更新";
  if (min < 60) return `${min} 分鐘前`;
  return `${Math.floor(min / 60)} 小時前`;
}
```

- [ ] **Step 3: Create `web/src/lib/probability.ts`** (client-side mirror, used when user toggles "my priority")

```typescript
// Identical to worker/src/lib/probability.ts — kept in sync intentionally
export type Reg = number | null;

export interface ProbabilityResult {
  probs: (number | null)[];
  remaining_after_all: number;
}

export function calcByPriority(capacity: number, regs: Reg[]): ProbabilityResult {
  let remaining = capacity;
  const probs: (number | null)[] = [];
  for (const reg of regs) {
    if (reg == null) { probs.push(null); continue; }
    if (reg === 0) { probs.push(null); continue; }
    if (remaining >= reg) { probs.push(1.0); remaining -= reg; }
    else if (remaining > 0) { probs.push(remaining / reg); remaining = 0; }
    else { probs.push(0.0); }
  }
  return { probs, remaining_after_all: remaining };
}
```

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/
git commit -m "feat(web): API client + format + probability helpers"
```

---

### Task 19: Search bar + Banner components

**Files:**
- Create: `web/src/components/SearchBar.astro`
- Create: `web/src/components/Banner.astro`

- [ ] **Step 1: Create `web/src/components/SearchBar.astro`**

```astro
---
---
<div class="searchbar">
  <div class="mode-toggle">
    <label><input type="radio" name="mode" value="address" checked> 用地址查附近</label>
    <label><input type="radio" name="mode" value="school"> 用學校名稱查</label>
  </div>
  <div class="row">
    <input id="query-input" type="text" placeholder="輸入地址，例：台北市中山區民生東路二段147號" autocomplete="off">
    <button id="query-btn">查詢</button>
  </div>
  <div class="filters">
    <label><input type="checkbox" id="f-public" checked> 公幼</label>
    <label><input type="checkbox" id="f-nonprofit" checked> 非營利</label>
    <select id="f-age">
      <option value="">全部班別</option>
      <option value="3-5歲班">3-5 歲班</option>
      <option value="2歲專班">2 歲專班</option>
    </select>
    <select id="f-priority">
      <option value="">我的順位（未指定）</option>
      <option value="1">第 1 順位</option>
      <option value="2">第 2 順位</option>
      <option value="3">第 3 順位</option>
      <option value="4">第 4 順位</option>
      <option value="5">第 5 順位</option>
    </select>
  </div>
</div>

<style>
  .searchbar { background: white; padding: 1rem; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 1rem; }
  .mode-toggle { display: flex; gap: 1rem; margin-bottom: 0.5rem; }
  .row { display: flex; gap: 0.5rem; }
  .row input { flex: 1; padding: 0.5rem; font-size: 1rem; border: 1px solid var(--border); border-radius: 4px; }
  .row button { padding: 0.5rem 1rem; background: var(--accent); color: white; border: none; border-radius: 4px; cursor: pointer; }
  .filters { display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 0.5rem; align-items: center; }
  .filters select { padding: 0.25rem 0.5rem; }
</style>
```

- [ ] **Step 2: Create `web/src/components/Banner.astro`**

```astro
---
---
<div id="banner" class="banner-warn" style="display:none">
  <span id="banner-text"></span>
  <span class="muted" id="data-age" style="margin-left: 1rem; font-size: 0.85em"></span>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/SearchBar.astro web/src/components/Banner.astro
git commit -m "feat(web): SearchBar + Banner components"
```

---

### Task 20: Result list + cards + priority detail

**Files:**
- Create: `web/src/components/ResultList.astro`
- Create: `web/src/components/ResultCard.astro`
- Create: `web/src/components/PriorityDetail.astro`

- [ ] **Step 1: Create `web/src/components/ResultList.astro`**

```astro
---
---
<div id="result-list" class="result-list"></div>
<style>
  .result-list { display: flex; flex-direction: column; gap: 0.75rem; max-height: calc(100vh - 250px); overflow-y: auto; padding-right: 0.5rem; }
  .empty { text-align: center; color: var(--muted); padding: 2rem; }
</style>
```

- [ ] **Step 2: Create `web/src/components/ResultCard.astro`** — defines a template, rendered by JS

```astro
---
---
<template id="result-card-template">
  <article class="card" data-school-id="">
    <header class="card-head">
      <h3 class="name"></h3>
      <span class="distance"></span>
    </header>
    <div class="meta">
      <span class="type"></span>
      <span class="district"></span>
      <span class="address"></span>
    </div>
    <div class="classes"></div>
    <button class="toggle-detail">展開順位明細 ▾</button>
    <div class="priority-detail" style="display:none"></div>
  </article>
</template>

<style>
  .card { background: white; border: 1px solid var(--border); border-radius: 6px; padding: 0.75rem; }
  .card.highlight { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(37,99,235,0.15); }
  .card-head { display: flex; justify-content: space-between; align-items: baseline; }
  .card-head h3 { margin: 0; font-size: 1.05rem; }
  .distance { color: var(--accent); font-weight: 600; }
  .meta { font-size: 0.85rem; color: var(--muted); margin: 0.25rem 0; display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .classes { display: flex; flex-direction: column; gap: 0.25rem; margin-top: 0.5rem; }
  .class-row { display: flex; justify-content: space-between; font-size: 0.9rem; padding: 0.25rem 0; border-top: 1px solid var(--border); }
  .toggle-detail { margin-top: 0.5rem; background: none; border: none; color: var(--accent); cursor: pointer; padding: 0; }
  .priority-detail { margin-top: 0.5rem; }
  .priority-row { display: grid; grid-template-columns: 1fr 80px 80px; gap: 0.5rem; padding: 0.25rem 0; font-size: 0.9rem; }
  .priority-row.highlight { background: rgba(37,99,235,0.08); font-weight: 600; }
  .prob-100 { color: var(--good); }
  .prob-0 { color: var(--bad); }
</style>
```

- [ ] **Step 3: Create `web/src/components/PriorityDetail.astro`** — header labels template

```astro
---
---
<template id="priority-detail-template">
  <div>
    <div class="priority-row" style="font-weight: 600; border-bottom: 1px solid var(--border)">
      <span>順位</span><span>報名數</span><span>機率</span>
    </div>
    <div class="rows"></div>
    <div class="muted" style="font-size: 0.8em; margin-top: 0.5rem">
      機率為依目前報名數推算，最終以官方抽籤結果為準。
    </div>
  </div>
</template>
```

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ResultList.astro web/src/components/ResultCard.astro web/src/components/PriorityDetail.astro
git commit -m "feat(web): result list + card + priority detail templates"
```

---

### Task 21: Map view (Leaflet + OSM)

**Files:**
- Create: `web/src/components/MapView.astro`

- [ ] **Step 1: Create `web/src/components/MapView.astro`**

```astro
---
---
<div id="map-view"></div>

<style>
  #map-view { height: calc(100vh - 250px); border-radius: 8px; border: 1px solid var(--border); background: #eee; }
  @media (max-width: 768px) {
    #map-view { height: 300px; }
  }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/MapView.astro
git commit -m "feat(web): MapView container"
```

---

### Task 22: Main page composition + interactive logic

**Files:**
- Modify: `web/src/pages/index.astro`

- [ ] **Step 1: Replace `web/src/pages/index.astro` contents**

```astro
---
import "../styles/global.css";
import SearchBar from "../components/SearchBar.astro";
import Banner from "../components/Banner.astro";
import ResultList from "../components/ResultList.astro";
import ResultCard from "../components/ResultCard.astro";
import PriorityDetail from "../components/PriorityDetail.astro";
import MapView from "../components/MapView.astro";
---
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>台北幼兒園即時查 — 公幼 / 非營利</title>
    <meta name="description" content="輸入地址或學校名稱，查詢台北市公幼與非營利幼兒園的招生名額、即時報名數與分順位中籤機率。資料每 3 分鐘更新。" />
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="" />
  </head>
  <body>
    <div class="container">
      <header class="site-header">
        <h1>台北幼兒園即時查</h1>
        <p class="muted">公幼 / 非營利 招生即時資訊 · 每 3 分鐘更新</p>
      </header>
      <Banner />
      <SearchBar />
      <div class="layout">
        <section class="left"><ResultList /></section>
        <section class="right"><MapView /></section>
      </div>
      <ResultCard />
      <PriorityDetail />
      <footer class="site-footer">
        <p>資料來源：臺北市政府教育局 <a href="https://kid.tp.edu.tw" target="_blank">kid.tp.edu.tw</a>、<a href="https://npkid.tp.edu.tw" target="_blank">npkid.tp.edu.tw</a></p>
        <p>本站為非官方資訊整理，最終以官方公告為準。機率為依目前報名/名額即時推算。</p>
      </footer>
    </div>

    <script>
      import { search } from "../lib/api-client";
      import type { SearchResponse, SchoolResult } from "../lib/api-client";
      import { fmtKm, fmtPct, fmtTimeAgo } from "../lib/format";
      import { calcByPriority } from "../lib/probability";

      const state: {
        results: SchoolResult[];
        windowMode: string;
        fetchedAt: number | null;
        userPriority: number | null;
        map: any;
        markers: any[];
        homeMarker: any;
      } = {
        results: [], windowMode: "closed", fetchedAt: null, userPriority: null,
        map: null, markers: [], homeMarker: null,
      };

      function initMap() {
        // @ts-ignore
        const L = window.L;
        state.map = L.map("map-view").setView([25.06, 121.55], 12);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "© OpenStreetMap",
          maxZoom: 19,
        }).addTo(state.map);
      }

      function clearMarkers() {
        // @ts-ignore
        const L = window.L;
        state.markers.forEach((m) => state.map.removeLayer(m));
        state.markers = [];
        if (state.homeMarker) { state.map.removeLayer(state.homeMarker); state.homeMarker = null; }
      }

      function renderResults() {
        const list = document.getElementById("result-list")!;
        list.innerHTML = "";
        if (state.results.length === 0) {
          list.innerHTML = '<div class="empty">無符合條件的園所</div>';
          return;
        }
        const tpl = document.getElementById("result-card-template") as HTMLTemplateElement;
        const detailTpl = document.getElementById("priority-detail-template") as HTMLTemplateElement;
        for (const s of state.results) {
          const node = tpl.content.cloneNode(true) as DocumentFragment;
          const card = node.querySelector(".card") as HTMLElement;
          card.dataset.schoolId = s.school_id;
          (node.querySelector(".name") as HTMLElement).textContent = s.name;
          (node.querySelector(".distance") as HTMLElement).textContent = fmtKm(s.distance_km);
          (node.querySelector(".type") as HTMLElement).textContent = s.type === "public" ? "公幼" : "非營利";
          (node.querySelector(".district") as HTMLElement).textContent = s.district;
          (node.querySelector(".address") as HTMLElement).textContent = s.address;

          const classesEl = node.querySelector(".classes") as HTMLElement;
          for (const c of s.classes) {
            const row = document.createElement("div");
            row.className = "class-row";
            const probIdx = state.userPriority ?? 5;
            const prob = c.probabilities[`p${probIdx}` as "p1" | "p2" | "p3" | "p4" | "p5"];
            row.innerHTML = `<span>${c.age_band}｜名額 ${c.capacity}</span><span>機率 ${fmtPct(prob)}</span>`;
            classesEl.appendChild(row);
          }

          const detailEl = node.querySelector(".priority-detail") as HTMLElement;
          const detailNode = detailTpl.content.cloneNode(true) as DocumentFragment;
          const rowsEl = detailNode.querySelector(".rows") as HTMLElement;
          for (const c of s.classes) {
            for (let i = 1; i <= 5; i++) {
              const prob = c.probabilities[`p${i}` as "p1" | "p2" | "p3" | "p4" | "p5"];
              const reg = c.registrations?.[`p${i}` as "p1" | "p2" | "p3" | "p4" | "p5"] ?? null;
              const row = document.createElement("div");
              row.className = "priority-row" + (state.userPriority === i ? " highlight" : "");
              const probClass = prob === 1 ? "prob-100" : (prob === 0 ? "prob-0" : "");
              row.innerHTML = `<span>第 ${i} 順位 (${c.age_band})</span><span>${reg ?? "—"}</span><span class="${probClass}">${fmtPct(prob)}</span>`;
              rowsEl.appendChild(row);
            }
          }
          detailEl.appendChild(detailNode);

          const toggle = node.querySelector(".toggle-detail") as HTMLButtonElement;
          toggle.addEventListener("click", () => {
            detailEl.style.display = detailEl.style.display === "none" ? "block" : "none";
            toggle.textContent = detailEl.style.display === "none" ? "展開順位明細 ▾" : "收起 ▴";
          });

          card.addEventListener("mouseenter", () => highlightOnMap(s.school_id));
          card.addEventListener("mouseleave", () => unhighlightOnMap(s.school_id));

          list.appendChild(node);
        }
      }

      function renderMap(queryLat: number | null, queryLng: number | null) {
        // @ts-ignore
        const L = window.L;
        clearMarkers();
        if (queryLat != null && queryLng != null) {
          state.homeMarker = L.marker([queryLat, queryLng], {
            icon: L.divIcon({ html: "★", className: "home-icon" }),
          }).addTo(state.map).bindPopup("家");
        }
        const bounds: [number, number][] = [];
        for (const s of state.results) {
          if (s.lat == null || s.lng == null) continue;
          const m = L.circleMarker([s.lat, s.lng], { radius: 6, color: "#2563eb", fillOpacity: 0.7 })
            .addTo(state.map)
            .bindPopup(`<strong>${s.name}</strong><br>${fmtKm(s.distance_km)}`);
          (m as any).schoolId = s.school_id;
          state.markers.push(m);
          bounds.push([s.lat, s.lng]);
        }
        if (queryLat != null) bounds.push([queryLat, queryLng!]);
        if (bounds.length > 1) state.map.fitBounds(bounds, { padding: [40, 40] });
      }

      function highlightOnMap(id: string) {
        for (const m of state.markers) {
          if ((m as any).schoolId === id) m.openPopup();
        }
      }
      function unhighlightOnMap(_id: string) { /* no-op for now */ }

      function updateBanner() {
        const banner = document.getElementById("banner")!;
        const text = document.getElementById("banner-text")!;
        const age = document.getElementById("data-age")!;
        if (state.windowMode === "closed") {
          banner.style.display = "block";
          text.textContent = "目前非報名期。以下為招生名額公告，報名數與機率將於開放後顯示。";
        } else if (state.windowMode === "drawn") {
          banner.style.display = "block";
          text.textContent = "今年抽籤已完成。以下顯示最終資料。";
        } else {
          banner.style.display = "none";
        }
        age.textContent = `資料更新於 ${fmtTimeAgo(state.fetchedAt)}`;
      }

      async function runSearch() {
        const mode = (document.querySelector('input[name="mode"]:checked') as HTMLInputElement).value;
        const q = (document.getElementById("query-input") as HTMLInputElement).value.trim();
        if (!q) return;
        const ageBand = (document.getElementById("f-age") as HTMLSelectElement).value as any;
        try {
          const resp: SearchResponse = await search({
            ...(mode === "address" ? { address: q } : { school: q }),
            ...(ageBand ? { age_band: ageBand } : {}),
          });
          if (resp.geocode_status === "not_found") {
            alert("找不到地址，請輸入更完整的地址");
            return;
          }
          if (resp.geocode_status === "out_of_scope") {
            alert("此地址不在台北市，本站目前僅支援台北市");
            return;
          }
          state.results = resp.results;
          state.windowMode = resp.window_mode;
          state.fetchedAt = resp.fetched_at;
          renderResults();
          renderMap(resp.query_lat, resp.query_lng);
          updateBanner();
        } catch (e) {
          console.error(e);
          alert("查詢失敗，請稍後再試");
        }
      }

      // wire up
      const leafletScript = document.createElement("script");
      leafletScript.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      leafletScript.integrity = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";
      leafletScript.crossOrigin = "";
      leafletScript.onload = () => initMap();
      document.head.appendChild(leafletScript);

      document.getElementById("query-btn")!.addEventListener("click", runSearch);
      document.getElementById("query-input")!.addEventListener("keydown", (e) => {
        if ((e as KeyboardEvent).key === "Enter") runSearch();
      });
      document.getElementById("f-priority")!.addEventListener("change", (e) => {
        const v = (e.target as HTMLSelectElement).value;
        state.userPriority = v ? parseInt(v, 10) : null;
        renderResults();
      });

      // auto-refresh every 3 minutes if user has results
      setInterval(() => { if (state.results.length > 0) runSearch(); }, 180_000);
    </script>

    <style>
      .site-header { margin-bottom: 1rem; }
      .site-header h1 { margin: 0; }
      .muted { color: var(--muted); }
      .layout { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
      @media (max-width: 768px) {
        .layout { grid-template-columns: 1fr; }
      }
      .site-footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border); color: var(--muted); font-size: 0.85rem; }
      .home-icon { font-size: 1.5rem; }
    </style>
  </body>
</html>
```

- [ ] **Step 2: Boot dev servers (worker + web) and smoke test**

In one shell:
```bash
cd worker && pnpm dev
```
In another:
```bash
cd web && PUBLIC_API_BASE=http://localhost:8787 pnpm dev
```
Visit http://localhost:4321, type an address, press Enter, verify results appear in list and on map.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/index.astro
git commit -m "feat(web): main page composition with search, results, map, priority detail"
```

---

## Phase G — E2E + Deployment

### Task 23: Playwright E2E specs

**Files:**
- Create: `e2e/package.json`
- Create: `e2e/playwright.config.ts`
- Create: `e2e/specs/address-search.spec.ts`
- Create: `e2e/specs/school-search.spec.ts`

- [ ] **Step 1: Create `e2e/package.json`**

```json
{
  "name": "e2e",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "test": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "^1.48.0"
  }
}
```

- [ ] **Step 2: Create `e2e/playwright.config.ts`**

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./specs",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE ?? "http://localhost:4321",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
});
```

- [ ] **Step 3: Create `e2e/specs/address-search.spec.ts`**

```typescript
import { test, expect } from "@playwright/test";

test("address search shows results and map markers", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("radio", { name: "用地址查附近" }).check();
  await page.locator("#query-input").fill("台北市中山區民生東路二段147號");
  await page.locator("#query-btn").click();
  await expect(page.locator(".card").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".card .name").first()).not.toBeEmpty();
});

test("priority toggle changes displayed probability", async ({ page }) => {
  await page.goto("/");
  await page.locator("#query-input").fill("台北市中山區民生東路二段147號");
  await page.locator("#query-btn").click();
  await expect(page.locator(".card").first()).toBeVisible({ timeout: 10_000 });
  const before = await page.locator(".card .class-row").first().textContent();
  await page.locator("#f-priority").selectOption("1");
  const after = await page.locator(".card .class-row").first().textContent();
  expect(after).not.toBe(before);
});
```

- [ ] **Step 4: Create `e2e/specs/school-search.spec.ts`**

```typescript
import { test, expect } from "@playwright/test";

test("school name search returns single match", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("radio", { name: "用學校名稱查" }).check();
  await page.locator("#query-input").fill("中山");
  await page.locator("#query-btn").click();
  await expect(page.locator(".card").first()).toBeVisible({ timeout: 10_000 });
});

test("priority detail expands", async ({ page }) => {
  await page.goto("/");
  await page.locator("#query-input").fill("台北市中山區民生東路二段147號");
  await page.locator("#query-btn").click();
  await expect(page.locator(".card").first()).toBeVisible({ timeout: 10_000 });
  const first = page.locator(".card").first();
  await first.locator(".toggle-detail").click();
  await expect(first.locator(".priority-detail")).toBeVisible();
  const rowCount = await first.locator(".priority-row").count();
  expect(rowCount).toBeGreaterThanOrEqual(5);
});
```

- [ ] **Step 5: Install + run locally**

```bash
cd e2e && pnpm install
pnpm exec playwright install chromium
pnpm test
```
Expected: 4 tests pass. (Requires worker dev + web dev running; if off-season and no scraped data, the address-search test may fail because no schools exist — in that case, seed the DB manually with the SQL from Task 15 Step 1 before re-running.)

- [ ] **Step 6: Commit**

```bash
cd ..
git add e2e/
git commit -m "test(e2e): playwright specs for address + school search"
```

---

### Task 24: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter worker test
      - run: pnpm --filter web build
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add unit-test + build workflow"
```

---

### Task 25: GitHub Actions deploy

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: Set Cloudflare secrets in GitHub repo settings**

In the GitHub repo: Settings → Secrets and variables → Actions → New repository secret. Add:
- `CLOUDFLARE_API_TOKEN` — generate at https://dash.cloudflare.com/profile/api-tokens with "Edit Cloudflare Workers" + Pages permissions
- `CLOUDFLARE_ACCOUNT_ID` — visible on the Cloudflare dashboard sidebar
- `TGOS_API_KEY` — your TGOS key
- `DISCORD_WEBHOOK_URL` — your alerts webhook

- [ ] **Step 2: Create `.github/workflows/deploy.yml`**

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy-worker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Apply D1 migrations
        run: pnpm --filter worker exec wrangler d1 migrations apply kindergarten_db --remote
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      - name: Put worker secrets
        run: |
          echo "${{ secrets.TGOS_API_KEY }}" | pnpm --filter worker exec wrangler secret put TGOS_API_KEY
          echo "${{ secrets.DISCORD_WEBHOOK_URL }}" | pnpm --filter worker exec wrangler secret put DISCORD_WEBHOOK_URL
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      - name: Deploy worker
        run: pnpm --filter worker exec wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

  deploy-web:
    runs-on: ubuntu-latest
    needs: deploy-worker
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Build
        run: pnpm --filter web build
        env:
          PUBLIC_API_BASE: https://kindergarten-api.<your-subdomain>.workers.dev
      - name: Deploy to Cloudflare Pages
        uses: cloudflare/pages-action@v1
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          projectName: kindergarten-finder
          directory: web/dist
```

> Replace `<your-subdomain>` in `PUBLIC_API_BASE` with your Cloudflare Workers subdomain (visible after first deploy in Cloudflare dashboard).

- [ ] **Step 3: Push to main and verify deploy**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: add deploy workflow for worker + pages"
git push -u origin main
```
Watch GitHub Actions. Expected: green build. Visit your Pages URL.

---

### Task 26: Health-check cron (daily)

**Files:**
- Modify: `wrangler.toml`
- Modify: `worker/src/scraper/cron.ts`

- [ ] **Step 1: Update `wrangler.toml` to add a second cron expression**

```toml
[triggers]
crons = [
  "*/3 * * * *",   # main scrape
  "0 19 * * *",     # daily 03:00 Taipei (UTC+8) = 19:00 UTC — health check
]
```

- [ ] **Step 2: Update `worker/src/scraper/cron.ts` to branch on cron type**

Modify the `scheduled` handler in `worker/src/index.ts`:

```typescript
async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
  if (event.cron === "0 19 * * *") {
    ctx.waitUntil(runHealthCheck(env));
  } else {
    ctx.waitUntil(runScrape(env));
  }
},
```

Add `runHealthCheck` to `worker/src/scraper/cron.ts`:

```typescript
export async function runHealthCheck(env: Env): Promise<void> {
  const targets = buildTargets().slice(0, 3); // sample 3 districts
  let failures = 0;
  for (const t of targets) {
    const html = await fetchHtml(t.url);
    if (!html) { failures++; continue; }
    const parsed = parseBoardPage(html, { type: t.type, district: t.district });
    if (parsed.length === 0 && !html.includes("查無資料")) failures++;
  }
  if (failures > 0) {
    await notifyDiscord(env, `🚨 Daily health check: ${failures}/${targets.length} samples failed`);
  }
}
```

`notifyDiscord` is already exported from `cron.ts` (Task 13).

- [ ] **Step 3: Commit**

```bash
git add wrangler.toml worker/src/index.ts worker/src/scraper/cron.ts
git commit -m "feat(worker): daily health-check cron with Discord alerts"
```

---

### Task 27: Polish — Lighthouse, PWA manifest, robots

**Files:**
- Create: `web/public/manifest.json`
- Create: `web/public/robots.txt`
- Modify: `web/src/pages/index.astro` (add `<link rel="manifest">`)

- [ ] **Step 1: Create `web/public/manifest.json`**

```json
{
  "name": "台北幼兒園即時查",
  "short_name": "幼兒園查",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#fafaf8",
  "theme_color": "#2563eb",
  "icons": []
}
```

- [ ] **Step 2: Create `web/public/robots.txt`**

```
User-agent: *
Allow: /
```

- [ ] **Step 3: In `web/src/pages/index.astro` `<head>`, add:**

```html
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#2563eb" />
```

- [ ] **Step 4: Run Lighthouse locally**

```bash
cd web && pnpm build && pnpm preview
```
In another shell:
```bash
npx lighthouse http://localhost:4321 --only-categories=performance,accessibility,best-practices,seo --view
```
Expected: mobile scores ≥ 90 in all four. If not, common fixes:
- Inline the leaflet CSS critical path
- Add `<link rel="preconnect" href="https://unpkg.com">` to head
- Lazy-load Leaflet only after user does a search

- [ ] **Step 5: Commit**

```bash
git add web/public/ web/src/pages/index.astro
git commit -m "feat(web): PWA manifest, robots, theme color"
```

---

### Task 28: Final verification + go-live checklist

- [ ] **Step 1: Bootstrap remote D1**

```bash
wrangler d1 migrations apply kindergarten_db --remote
```

- [ ] **Step 2: Trigger one manual cron on production**

```bash
curl -X POST -H "x-admin-token: <TGOS_API_KEY>" https://kindergarten-api.<subdomain>.workers.dev/api/admin/run-cron
```

- [ ] **Step 3: Verify D1 populated**

```bash
wrangler d1 execute kindergarten_db --remote --command "SELECT COUNT(*) FROM schools; SELECT mode FROM registration_window;"
```

- [ ] **Step 4: Manual smoke test**

Visit production Pages URL. Try:
- Address: `台北市中山區民生東路二段147號`
- School name: `中山`
- Toggle priority dropdown
- Open priority detail
- Resize to mobile viewport — layout stacks correctly

- [ ] **Step 5: Final commit + tag v0.1.0**

```bash
git tag v0.1.0
git push origin v0.1.0
```

Site is live.

---

## Coverage Map (Spec → Tasks)

| Spec section | Tasks |
|---|---|
| §1 目標 / §2 範圍 | All tasks |
| §3 資料源 (kid.tp + npkid.tp) | T6, T7, T11 |
| §4 整體架構 | T1, T2, T17 |
| §5 D1 Schema | T3 |
| §5 爬蟲流程 | T11, T12, T13 |
| §5 時鐘對齊 / hash 節流 | T13 (cron expression `*/3 * * * *`; hash check is `optional` future work, called out below) |
| §6 API /search //school //geocode | T14, T15, T16 |
| §7 順位機率算法 | T5 |
| §8 前端 UI | T17–T22 |
| §8 「我的順位」即時重算 | T22 (priority dropdown handler) |
| §9 錯誤處理 | T11 (fetch retry), T13 (logScrapeError + Discord), T14/T15 (HTTP codes) |
| §10 3 分鐘更新保證 | T2 (cron config), T13, T22 (auto-refresh) |
| §11 測試 | T4, T5, T7, T8, T10, T15, T23 |
| §12 部署 | T1, T2, T24, T25, T26 |
| §13 已知風險 | T26 (health check), T11 (retry) |

## Known Future Work (Explicitly Deferred — Not In MVP)

- **Priority-label extraction**: spec §5 says scrape the 招生公告 page for "順位說明" and write to `registration_window.priority_labels`. Schema supports it; cron currently writes `NULL`. Frontend falls back to static "第 N 順位" labels — fine for MVP. Add a follow-up task after first registration window to scrape the labels page.
- HTML hash-based no-op short-circuit when source hasn't changed (perf optimization)
- Levenshtein suggestions for unmatched school names (currently returns empty results)
- `previous snapshot` change-tracking display (schema supports it via `is_latest=0`; UI doesn't surface yet)
- Admin route for emergency hiding of bad data
- Nominatim geocoding fallback
