#!/usr/bin/env node
/**
 * Full re-scrape: hit kid.tp.edu.tw (3-5歲班 + 2歲專班) and npkid.tp.edu.tw
 * (5歲班 + 4歲班 + 3歲班 + 2歲專班) for all 12 districts, parse, write
 * batch UPDATE to D1.
 *
 * Run: REMOTE=1 node scripts/full-rescrape.mjs
 *
 * Why local: 6 classes × 12 districts × 2 sites = many requests; safer to
 * orchestrate locally than to run in a single Worker invocation.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { parse: parseHTML } = require("../worker/node_modules/node-html-parser");

const REMOTE = process.env.REMOTE === "1";
const UA = "TaipeiKindergartenFinder/0.1 (https://github.com/xiaolongxia/taipei-kindergarten-finder)";

const DIST_CODES = {
  "松山區": "63000010", "信義區": "63000020", "大安區": "63000030", "中山區": "63000040",
  "中正區": "63000050", "大同區": "63000060", "萬華區": "63000070", "文山區": "63000080",
  "南港區": "63000090", "內湖區": "63000100", "士林區": "63000110", "北投區": "63000120",
};

const PUBLIC_CLASSES = [
  { age_band: "3-5歲班", postback: null },
  { age_band: "2歲專班", postback: { target: "ctl00$MainContent$classType$1", value: "1" } },
];

const NP_CLASSES = [
  { age_band: "5歲班", postback: null },
  { age_band: "4歲班", postback: { target: "ctl00$MainContent$classType$1", value: "5" } },
  { age_band: "3歲班", postback: { target: "ctl00$MainContent$classType$2", value: "4" } },
  { age_band: "2歲專班", postback: { target: "ctl00$MainContent$classType$3", value: "1" } },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function flag() { return REMOTE ? "--remote" : "--local"; }
function d1ExecFile(file) {
  execFileSync("wrangler", ["d1", "execute", "kindergarten_db", flag(), "--file", file], { stdio: "inherit" });
}

function extractField(html, name) {
  const m = html.match(new RegExp(`name="${name}"[^>]*\\bvalue="([^"]*)"`));
  return m ? m[1] : null;
}

async function fetchTarget(url, postback) {
  const r1 = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r1.ok) return null;
  const html = await r1.text();
  if (!postback) return html;

  const cookies = r1.headers.getSetCookie?.() ??
    ((r1.headers.get("set-cookie") ?? "").split(/,(?=\s*[^;,= ]+=)/));
  const cookieHeader = cookies.map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");

  const vs = extractField(html, "__VIEWSTATE");
  const ev = extractField(html, "__EVENTVALIDATION");
  const vg = extractField(html, "__VIEWSTATEGENERATOR");
  if (!vs || !ev) return null;

  const body = new URLSearchParams({
    "__EVENTTARGET": postback.target,
    "__EVENTARGUMENT": "",
    "__VIEWSTATE": vs,
    "__EVENTVALIDATION": ev,
    "__VIEWSTATEGENERATOR": vg ?? "",
    "ctl00$MainContent$classType": postback.value,
  });
  const r2 = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "User-Agent": UA, "cookie": cookieHeader },
    body: body.toString(),
  });
  return r2.ok ? r2.text() : null;
}

function parseBoard(html, ctx) {
  if (html.includes("查無資料")) return [];
  const root = parseHTML(html);
  const table = root.querySelector("#MainContent_GridView1");
  if (!table) return [];
  const rows = table.querySelectorAll("tr");
  const schools = [];
  for (const row of rows) {
    const cells = row.querySelectorAll("td");
    if (cells.length < 5) continue;
    const name = cells[1]?.text?.trim();
    if (!name) continue;
    const capacity = parseInt(cells[2].text.replace(/[^\d]/g, ""), 10);
    if (isNaN(capacity)) continue;
    const lastIdx = cells.length - 1;
    const total = parseInt(cells[lastIdx].text.replace(/[^\d]/g, ""), 10);
    const regs = [];
    for (let i = 3; i < lastIdx; i++) {
      const t = cells[i].text.trim();
      regs.push(t === "" || t === "-" ? null : parseInt(t.replace(/[^\d]/g, ""), 10));
    }
    schools.push({
      id: name, name, type: ctx.type, district: ctx.district,
      age_band: ctx.age_band, capacity, regs, reg_total: isNaN(total) ? null : total,
    });
  }
  return schools;
}

function sqlEscape(s) { return s.replace(/'/g, "''"); }

(async () => {
  console.log(`Target: ${REMOTE ? "REMOTE" : "LOCAL"} D1`);
  const allSchools = new Map(); // id → { ...school, classes: [] }
  const fetchedAt = Date.now();
  let count = 0, total = 12 * (PUBLIC_CLASSES.length + NP_CLASSES.length);

  for (const [district, code] of Object.entries(DIST_CODES)) {
    for (const [type, classes, baseUrl] of [
      ["public", PUBLIC_CLASSES, "https://kid.tp.edu.tw"],
      ["non_profit", NP_CLASSES, "https://npkid.tp.edu.tw"],
    ]) {
      for (const c of classes) {
        count++;
        const url = `${baseUrl}/Board.aspx?dist=${code}`;
        const html = await fetchTarget(url, c.postback);
        if (!html) {
          process.stdout.write(`✗ [${count}/${total}] ${type} ${district} ${c.age_band} fetch fail\n`);
          continue;
        }
        const parsed = parseBoard(html, { type, district, age_band: c.age_band });
        process.stdout.write(`✓ [${count}/${total}] ${type} ${district} ${c.age_band} → ${parsed.length} schools\n`);
        for (const s of parsed) {
          if (!allSchools.has(s.id)) {
            allSchools.set(s.id, {
              id: s.id, name: s.name, type: s.type, district: s.district, classes: [],
            });
          }
          const entry = allSchools.get(s.id);
          entry.classes.push({
            age_band: s.age_band, capacity: s.capacity, regs: s.regs, reg_total: s.reg_total,
          });
        }
        await sleep(300); // be polite to the site
      }
    }
  }

  console.log(`\nTotal unique schools: ${allSchools.size}`);

  const lines = [];
  // One-shot bootstrap: clear ALL existing snapshots (we'll rebuild
  // history later as cron runs). This avoids PK violations on the
  // (school_id, age_band, is_latest) primary key.
  lines.push("DELETE FROM snapshots;");
  // Insert fresh is_latest=1 rows for every (school, age_band) we just scraped.
  for (const s of allSchools.values()) {
    for (const c of s.classes) {
      const sid = sqlEscape(s.id);
      const ab = sqlEscape(c.age_band);
      const regsJson = sqlEscape(JSON.stringify(c.regs));
      const total = c.reg_total == null ? "NULL" : c.reg_total;
      lines.push(`INSERT INTO snapshots (school_id, age_band, capacity, regs_json, reg_total, fetched_at, is_latest) VALUES ('${sid}', '${ab}', ${c.capacity}, '${regsJson}', ${total}, ${fetchedAt}, 1);`);
    }
  }

  const sqlFile = "/tmp/full-rescrape.sql";
  writeFileSync(sqlFile, lines.join("\n"));
  console.log(`\n寫入 ${lines.length} 條 SQL → ${sqlFile}`);
  d1ExecFile(sqlFile);

  console.log("\n完成");
})();
