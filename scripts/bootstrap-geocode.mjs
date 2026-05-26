#!/usr/bin/env node
/**
 * One-shot: geocode all schools missing lat/lng via Nominatim, then BATCH
 * UPDATE D1 in a single wrangler call at the end (much faster than
 * one UPDATE per school).
 *
 * Run: node scripts/bootstrap-geocode.mjs
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const USER_AGENT = "TaipeiKindergartenFinder/0.1 (https://github.com/xiaolongxia/taipei-kindergarten-finder)";

function d1Query(sql) {
  const out = execFileSync(
    "wrangler",
    ["d1", "execute", "kindergarten_db", "--local", "--json", "--command", sql],
    { encoding: "utf-8" },
  );
  return JSON.parse(out)[0]?.results ?? [];
}

function d1ExecFile(sqlFilePath) {
  execFileSync(
    "wrangler",
    ["d1", "execute", "kindergarten_db", "--local", "--file", sqlFilePath],
    { encoding: "utf-8", stdio: "inherit" },
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function progressiveFallbacks(query) {
  const variants = [query];
  const noFloor = query.replace(/[\d之\-]+\s*(樓|室|F).*$/i, "").trim();
  if (noFloor && noFloor !== query) variants.push(noFloor);
  const noHouse = noFloor.replace(/\d+\s*號.*$/, "").trim();
  if (noHouse && noHouse !== noFloor) variants.push(noHouse);
  const noLin = noHouse.replace(/\d+\s*鄰/, "").trim();
  if (noLin && noLin !== noHouse) variants.push(noLin);
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
    try {
      const r = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data) && data.length > 0) {
          const lat = parseFloat(data[0].lat);
          const lng = parseFloat(data[0].lon);
          if (!isNaN(lat) && !isNaN(lng)) {
            await sleep(1100); // be polite even on success
            return { lat, lng };
          }
        }
      }
    } catch {
      // ignore network errors, try next fallback
    }
    await sleep(1100);
  }
  return null;
}

(async () => {
  const schools = d1Query("SELECT id, name, district, address FROM schools WHERE lat IS NULL OR lng IS NULL");
  console.log(`待補座標：${schools.length} 間`);

  const updates = [];
  let ok = 0, fail = 0;
  for (let i = 0; i < schools.length; i++) {
    const s = schools[i];
    const query = s.address && s.address.length > 0
      ? `${s.address}, 台北市${s.district}, 台灣`
      : `${s.name}, 台北市${s.district}, 台灣`;
    const result = await geocode(query);
    if (result) {
      const safeId = s.id.replace(/'/g, "''");
      updates.push(`UPDATE schools SET lat=${result.lat}, lng=${result.lng} WHERE id='${safeId}';`);
      ok++;
      process.stdout.write(`✓ [${i + 1}/${schools.length}] ${s.name} → ${result.lat.toFixed(4)},${result.lng.toFixed(4)}\n`);
    } else {
      fail++;
      process.stdout.write(`✗ [${i + 1}/${schools.length}] ${s.name} (${s.district}) → 找不到\n`);
    }
  }

  if (updates.length > 0) {
    const sqlFile = "/tmp/bootstrap-geocode-updates.sql";
    writeFileSync(sqlFile, updates.join("\n"));
    console.log(`\n寫入 ${updates.length} 筆 UPDATE 到 ${sqlFile}…`);
    d1ExecFile(sqlFile);
  }

  console.log(`\n完成：✓${ok}  ✗${fail}`);
})();
