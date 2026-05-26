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

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", address);
  url.searchParams.set("format", "json");
  url.searchParams.set("countrycodes", "tw");
  url.searchParams.set("limit", "1");

  let resp: Response;
  try {
    resp = await fetch(url.toString(), {
      headers: { "User-Agent": USER_AGENT, "accept": "application/json" },
    });
  } catch {
    return null;
  }
  if (!resp.ok) return null;

  let data: Array<{ lat: string; lon: string }>;
  try {
    data = await resp.json();
  } catch {
    return null;
  }
  if (!Array.isArray(data) || data.length === 0) return null;

  const lat = parseFloat(data[0].lat);
  const lng = parseFloat(data[0].lon);
  if (isNaN(lat) || isNaN(lng)) return null;

  const result: GeocodeResult = { lat, lng, source: "nominatim" };
  await kv.put(`geo:${key}`, JSON.stringify(result), { expirationTtl: 30 * 86400 });
  return result;
}

async function cacheKey(address: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
