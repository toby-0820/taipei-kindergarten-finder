const API_BASE = import.meta.env.PUBLIC_API_BASE ?? "http://localhost:8787";

export interface ClassData {
  age_band: "3-5歲班" | "2歲專班";
  capacity: number;
  registrations: { regs: number[]; total: number | null } | null;
  probabilities: { probs: (number | null)[] };
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
  location_status?: "ok" | "outside_taipei" | "out_of_scope";
  geocode_status?: "not_found";
  hint?: string;
}

export async function search(params: {
  lat?: number;
  lng?: number;
  address?: string;
  school?: string;
  age_band?: "3-5歲班" | "2歲專班";
  limit?: number;
}): Promise<SearchResponse> {
  const qs = new URLSearchParams();
  // Default to a large limit so client can sort across the full dataset.
  if (params.limit == null) qs.set("limit", "300");
  for (const [k, v] of Object.entries(params)) if (v != null) qs.set(k, String(v));
  const r = await fetch(`${API_BASE}/api/search?${qs}`);
  if (!r.ok) throw new Error(`search failed: ${r.status}`);
  return r.json();
}

export function getCurrentPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("瀏覽器不支援定位功能"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  });
}
