#!/usr/bin/env node
/**
 * One-shot fix: clear all coords, re-geocode against Nominatim with:
 *   1. viewbox bias bound to Taipei City rectangle
 *   2. district-match validation (reject if display_name doesn't contain
 *      the school's expected district)
 *   3. district centroid as final fallback
 *
 * Run: REMOTE=1 node scripts/regeocode-with-validation.mjs
 *      (omit REMOTE for local)
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const REMOTE = process.env.REMOTE === "1";
const USER_AGENT = "TaipeiKindergartenFinder/0.1 (https://github.com/xiaolongxia/taipei-kindergarten-finder)";

// Approximate centroids of each Taipei district (lat, lng).
const DISTRICT_CENTROIDS = {
  "松山區": [25.0578, 121.5775],
  "信義區": [25.0331, 121.5654],
  "大安區": [25.0260, 121.5436],
  "中山區": [25.0640, 121.5359],
  "中正區": [25.0320, 121.5198],
  "大同區": [25.0631, 121.5132],
  "萬華區": [25.0359, 121.4955],
  "文山區": [24.9889, 121.5701],
  "南港區": [25.0531, 121.6068],
  "內湖區": [25.0826, 121.5760],
  "士林區": [25.0926, 121.5246],
  "北投區": [25.1322, 121.5012],
};

const TAIPEI_VIEWBOX = "121.45,25.21,121.67,24.95";

function flag() { return REMOTE ? "--remote" : "--local"; }

function d1Query(sql) {
  const out = execFileSync(
    "wrangler",
    ["d1", "execute", "kindergarten_db", flag(), "--json", "--command", sql],
    { encoding: "utf-8" },
  );
  return JSON.parse(out)[0]?.results ?? [];
}

function d1ExecFile(sqlFilePath) {
  execFileSync(
    "wrangler",
    ["d1", "execute", "kindergarten_db", flag(), "--file", sqlFilePath],
    { encoding: "utf-8", stdio: "inherit" },
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function progressiveFallbacks(address) {
  const variants = [address];
  const noFloor = address.replace(/[\d之\-]+\s*(樓|室|F).*$/i, "").trim();
  if (noFloor && noFloor !== address) variants.push(noFloor);
  const noHouse = noFloor.replace(/\d+\s*號.*$/, "").trim();
  if (noHouse && noHouse !== noFloor) variants.push(noHouse);
  const noLin = noHouse.replace(/\d+\s*鄰/, "").trim();
  if (noLin && noLin !== noHouse) variants.push(noLin);
  const noLi = noLin.replace(/[^\s,，]+里(?=[\d一-龥])/, "").trim();
  if (noLi && noLi !== noLin) variants.push(noLi);
  return variants;
}

async function geocodeValidated(address, expectedDistrict) {
  for (const q of progressiveFallbacks(address)) {
    if (!q) continue;
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", q);
    url.searchParams.set("format", "json");
    url.searchParams.set("countrycodes", "tw");
    url.searchParams.set("limit", "3");
    url.searchParams.set("viewbox", TAIPEI_VIEWBOX);
    url.searchParams.set("bounded", "1");
    url.searchParams.set("addressdetails", "1");

    let data;
    try {
      const r = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (!r.ok) { await sleep(1100); continue; }
      data = await r.json();
    } catch { await sleep(1100); continue; }

    if (Array.isArray(data) && data.length > 0) {
      // Take the first result whose display_name contains the expected district.
      const match = data.find((d) => (d.display_name ?? "").includes(expectedDistrict));
      const pick = match ?? data[0];
      const lat = parseFloat(pick.lat);
      const lng = parseFloat(pick.lon);
      if (!isNaN(lat) && !isNaN(lng)) {
        const matched = !!match;
        await sleep(1100);
        return { lat, lng, matched, used: q };
      }
    }
    await sleep(1100);
  }
  return null;
}

(async () => {
  console.log(`Target: ${REMOTE ? "REMOTE" : "LOCAL"} D1`);
  console.log("Clearing all coords...");
  if (REMOTE) {
    execFileSync("wrangler", ["d1", "execute", "kindergarten_db", "--remote", "--command", "UPDATE schools SET lat=NULL, lng=NULL;"], { stdio: "inherit" });
  } else {
    execFileSync("wrangler", ["d1", "execute", "kindergarten_db", "--local", "--command", "UPDATE schools SET lat=NULL, lng=NULL;"], { stdio: "inherit" });
  }

  const schools = d1Query("SELECT id, name, district, address FROM schools ORDER BY district, name");
  console.log(`Total schools: ${schools.length}`);

  const updates = [];
  let exact = 0, fallback = 0, centroid = 0;

  for (let i = 0; i < schools.length; i++) {
    const s = schools[i];
    const query = s.address && s.address.length > 0
      ? `${s.address}, 台北市${s.district}, 台灣`
      : `${s.name}, 台北市${s.district}, 台灣`;
    const result = await geocodeValidated(query, s.district);

    let lat, lng, tag;
    if (result && result.matched) {
      lat = result.lat; lng = result.lng; tag = "✓"; exact++;
    } else if (result) {
      lat = result.lat; lng = result.lng; tag = "≈"; fallback++;
    } else {
      const c = DISTRICT_CENTROIDS[s.district];
      if (c) { lat = c[0]; lng = c[1]; tag = "○"; centroid++; }
      else { process.stdout.write(`✗ [${i + 1}/${schools.length}] ${s.name} (${s.district}) → 無 fallback\n`); continue; }
    }

    const safeId = s.id.replace(/'/g, "''");
    updates.push(`UPDATE schools SET lat=${lat}, lng=${lng} WHERE id='${safeId}';`);
    process.stdout.write(`${tag} [${i + 1}/${schools.length}] ${s.name} (${s.district}) → ${lat.toFixed(4)},${lng.toFixed(4)}\n`);
  }

  if (updates.length > 0) {
    const sqlFile = "/tmp/regeocode-updates.sql";
    writeFileSync(sqlFile, updates.join("\n"));
    console.log(`\n寫入 ${updates.length} 筆 UPDATE…`);
    d1ExecFile(sqlFile);
  }

  console.log(`\n完成：✓${exact} 精準匹配 / ≈${fallback} 區內推估 / ○${centroid} 用區中心點`);
})();
