#!/usr/bin/env node
/**
 * One-shot: geocode all schools missing lat/lng via Nominatim and UPDATE D1.
 *
 * Run after import-moe-addresses.mjs so schools have proper addresses.
 * Rate-limited to 1.2 req/sec to be polite to OSM.
 *
 * Run: node scripts/bootstrap-geocode.mjs
 */
import { execFileSync } from "node:child_process";

const USER_AGENT = "TaipeiKindergartenFinder/0.1 (https://github.com/xiaolongxia/taipei-kindergarten-finder)";

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function progressiveFallbacks(query) {
  // Strip Taiwan-specific address suffixes that OSM/Nominatim doesn't understand.
  // Strategy: progressively strip from most-specific to least-specific so we try
  // the full address first, then fall back to road-level granularity.
  const variants = [];
  variants.push(query);

  // Strip 樓/室/之 suffix (floor / room)
  const noFloor = query.replace(/[\d之\-]+\s*(樓|室|F).*$/i, "").trim();
  if (noFloor && noFloor !== query) variants.push(noFloor);

  // Strip 號 + everything after
  const noHouse = noFloor.replace(/\d+\s*號.*$/, "").trim();
  if (noHouse && noHouse !== noFloor) variants.push(noHouse);

  // Strip 鄰 (e.g. "20鄰" — not present in OSM)
  const noLin = noHouse.replace(/\d+\s*鄰/, "").trim();
  if (noLin && noLin !== noHouse) variants.push(noLin);

  // Strip 里 (e.g. "慈祐里" — not present in OSM)
  const noLi = noLin.replace(/[^\s,，]+里(?=[\d一-龥])/, "").trim();
  if (noLi && noLi !== noLin) variants.push(noLi);

  return variants;
}

async function geocode(query) {
  for (const q of progressiveFallbacks(query)) {
    if (!q) continue;
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", q);
    url.searchParams.set("format", "json");
    url.searchParams.set("countrycodes", "tw");
    url.searchParams.set("limit", "1");
    const r = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data) && data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);
        if (!isNaN(lat) && !isNaN(lng)) return { lat, lng, matchedQuery: q };
      }
    }
    await sleep(1200);
  }
  return null;
}

(async () => {
  const schools = d1Query("SELECT id, name, district, address FROM schools WHERE lat IS NULL OR lng IS NULL");
  console.log(`待補座標：${schools.length} 間`);

  let ok = 0, fail = 0;
  for (let i = 0; i < schools.length; i++) {
    const s = schools[i];
    const query = s.address && s.address.length > 0
      ? `${s.address}, 台北市${s.district}, 台灣`
      : `${s.name}, 台北市${s.district}, 台灣`;
    const result = await geocode(query);
    if (result) {
      const safeId = s.id.replace(/'/g, "''");
      d1Exec(`UPDATE schools SET lat=${result.lat}, lng=${result.lng} WHERE id='${safeId}'`);
      ok++;
      process.stdout.write(`✓ [${i + 1}/${schools.length}] ${s.name} → ${result.lat.toFixed(4)},${result.lng.toFixed(4)}\n`);
    } else {
      fail++;
      process.stdout.write(`✗ [${i + 1}/${schools.length}] ${s.name} (${s.district}) → 找不到\n`);
    }
    await sleep(1200);
  }
  console.log(`\n完成：✓${ok}  ✗${fail}`);
})();
