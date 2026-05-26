#!/usr/bin/env node
/**
 * One-shot: download 教育部「幼兒園名錄」CSV, filter Taipei 114 學年度,
 * normalize school names, match against D1 schools by name, and update
 * `schools.address` via wrangler d1.
 *
 * Run: node scripts/import-moe-addresses.mjs
 *
 * Requires: wrangler installed and authenticated. Operates on local D1.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const CSV_URL = "https://stats.moe.gov.tw/files/opendata/k1_new.csv";
const TARGET_YEAR = "114";
const CITY = "臺北市";

function normalizeName(name) {
  let s = name;
  s = s.replace(/^臺北市/, "");
  s = s.replace(/[（(](委託|由|附設於)[^）)]*[）)]$/, "");
  s = s.replace(/^市立/, "");
  s = s.replace(/國民小學附設幼兒園$/, "國小附幼");
  s = s.replace(/國民小學附設$/, "國小附");
  return s.trim();
}

function parseCsvLine(line) {
  const fields = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuote = false; }
      else { cur += c; }
    } else {
      if (c === '"') { inQuote = true; }
      else if (c === ",") { fields.push(cur); cur = ""; }
      else { cur += c; }
    }
  }
  fields.push(cur);
  return fields;
}

async function downloadCsv() {
  console.log(`下載 CSV: ${CSV_URL}`);
  const r = await fetch(CSV_URL);
  if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
  return await r.text();
}

function d1Query(sql) {
  const out = execFileSync(
    "wrangler",
    ["d1", "execute", "kindergarten_db", "--local", "--json", "--command", sql],
    { encoding: "utf-8" },
  );
  return JSON.parse(out)[0]?.results ?? [];
}

function d1Exec(sql) {
  execFileSync(
    "wrangler",
    ["d1", "execute", "kindergarten_db", "--local", "--command", sql],
    { encoding: "utf-8", stdio: "pipe" },
  );
}

(async () => {
  const csv = await downloadCsv();
  const lines = csv.split(/\r?\n/);
  const moeMap = new Map();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cols = parseCsvLine(lines[i]);
    if (cols.length < 7) continue;
    const [year, _code, name, _kind, cityRaw, _districtRaw, address] = cols;
    if (year !== TARGET_YEAR) continue;
    const city = cityRaw.replace(/\[\d+\]/, "");
    if (city !== CITY) continue;
    const cleanAddress = address.replace(/^\[\d+\]/, "").trim();
    if (!cleanAddress) continue;
    const norm = normalizeName(name);
    moeMap.set(norm, cleanAddress);
    // also keep the original-named version for fallback matching
    moeMap.set(name, cleanAddress);
  }

  console.log(`MOE 已索引：${moeMap.size} 筆 (normalized + raw)`);

  const schools = d1Query("SELECT id, name, district, address FROM schools");
  console.log(`D1 schools: ${schools.length}`);

  let matched = 0;
  const unmatched = [];
  for (const s of schools) {
    const candidates = [
      s.name,
      s.name.replace(/^市立/, ""),
      s.name.replace(/國小附幼$/, "國民小學附設幼兒園"),
      `市立${s.name}`,
    ];
    let addr = null;
    for (const c of candidates) {
      if (moeMap.has(c)) { addr = moeMap.get(c); break; }
    }
    if (!addr) {
      // substring search: find the MOE entry whose normalized name contains our name
      for (const [key, value] of moeMap.entries()) {
        if (key.includes(s.name) || s.name.includes(key)) {
          addr = value;
          break;
        }
      }
    }
    if (addr) {
      matched++;
      const safe = addr.replace(/'/g, "''");
      const idSafe = s.id.replace(/'/g, "''");
      d1Exec(`UPDATE schools SET address='${safe}', lat=NULL, lng=NULL WHERE id='${idSafe}'`);
    } else {
      unmatched.push(s);
    }
  }

  // Also wipe KV geocode cache so re-geocoding uses fresh data
  try {
    execFileSync("wrangler", ["kv", "key", "list", "--binding=GEOCODE_CACHE", "--local"], { stdio: "pipe" });
    // wrangler kv key list does not support direct filter; skip wipe for now (cron will refresh entries differently keyed)
  } catch {
    // ignore
  }

  console.log(`已配對：${matched} / ${schools.length}`);
  console.log(`未配對：${unmatched.length}`);
  if (unmatched.length > 0) {
    console.log("未配對的學校（前 20）：");
    for (const s of unmatched.slice(0, 20)) {
      console.log(`  ${s.id} (${s.district}) ${s.name}`);
    }
  }
})();
