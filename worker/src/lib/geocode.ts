export interface GeocodeResult {
  lat: number;
  lng: number;
  source: "cache" | "nominatim";
}

const USER_AGENT = "TaipeiKindergartenFinder/0.1 (https://github.com/xiaolongxia/taipei-kindergarten-finder)";

export async function geocodeAddress(
  address: string,
  kv: KVNamespace,
): Promise<GeocodeResult | null> {
  const key = await cacheKey(address);
  const cached = await kv.get(`geo:${key}`);
  if (cached) {
    const parsed = JSON.parse(cached);
    return { lat: parsed.lat, lng: parsed.lng, source: "cache" };
  }

  // OSM in Taiwan has sparse house-number coverage but good road coverage.
  // Try the full address first, then progressively strip house number / lane suffixes.
  const fallbacks = [
    address,
    address.replace(/\d+\s*號.*$/, "").trim(),
    address.replace(/[\d\-之]+\s*巷.*$/, "").trim(),
  ];

  let lat: number | null = null;
  let lng: number | null = null;

  for (const q of fallbacks) {
    if (!q) continue;
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", q);
    url.searchParams.set("format", "json");
    url.searchParams.set("countrycodes", "tw");
    url.searchParams.set("limit", "1");

    let resp: Response;
    try {
      resp = await fetch(url.toString(), {
        headers: { "User-Agent": USER_AGENT, "accept": "application/json" },
      });
    } catch { continue; }
    if (!resp.ok) continue;

    let data: Array<{ lat: string; lon: string }>;
    try { data = await resp.json(); } catch { continue; }
    if (!Array.isArray(data) || data.length === 0) continue;

    const parsedLat = parseFloat(data[0].lat);
    const parsedLng = parseFloat(data[0].lon);
    if (isNaN(parsedLat) || isNaN(parsedLng)) continue;

    lat = parsedLat;
    lng = parsedLng;
    break;
  }

  if (lat == null || lng == null) return null;

  const result: GeocodeResult = { lat, lng, source: "nominatim" };
  await kv.put(`geo:${key}`, JSON.stringify(result), { expirationTtl: 30 * 86400 });
  return result;
}

async function cacheKey(address: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
