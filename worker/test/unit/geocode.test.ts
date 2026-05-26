import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { geocodeAddress } from "../../src/lib/geocode";

// In-memory KV mock
function makeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    list: vi.fn(async () => ({ keys: [], list_complete: true, cursor: "" })),
    getWithMetadata: vi.fn(async (key: string) => ({ value: store.get(key) ?? null, metadata: null })),
  } as unknown as KVNamespace;
}

const NOMINATIM_RESPONSE = [{ lat: "25.0336", lon: "121.5645" }];

describe("geocodeAddress", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns cached result without calling Nominatim", async () => {
    const kv = makeKv();
    // Pre-populate cache
    const key = await computeKey("台北市信義區基隆路一段");
    await kv.put(`geo:${key}`, JSON.stringify({ lat: 25.033, lng: 121.564 }));

    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    const result = await geocodeAddress("台北市信義區基隆路一段", kv);

    expect(result).not.toBeNull();
    expect(result!.source).toBe("cache");
    expect(result!.lat).toBeCloseTo(25.033);
    expect(result!.lng).toBeCloseTo(121.564);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("calls Nominatim on cache miss and writes back to cache", async () => {
    const kv = makeKv();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => NOMINATIM_RESPONSE,
    } as Response);

    const result = await geocodeAddress("信義區幸福國小附幼", kv);

    expect(result).not.toBeNull();
    expect(result!.source).toBe("nominatim");
    expect(result!.lat).toBeCloseTo(25.0336);
    expect(result!.lng).toBeCloseTo(121.5645);

    // Should have written to KV cache
    expect((kv.put as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("sends User-Agent header to Nominatim", async () => {
    const kv = makeKv();
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedHeaders = (init?.headers as Record<string, string>) ?? {};
      return {
        ok: true,
        json: async () => NOMINATIM_RESPONSE,
      } as Response;
    });

    await geocodeAddress("松山區某幼兒園", kv);

    expect(capturedHeaders["User-Agent"]).toContain("TaipeiKindergartenFinder");
  });

  it("returns null on empty Nominatim result array", async () => {
    const kv = makeKv();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response);

    const result = await geocodeAddress("不存在的地址xyz", kv);
    expect(result).toBeNull();
  });

  it("returns null on Nominatim HTTP error", async () => {
    const kv = makeKv();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
    } as Response);

    const result = await geocodeAddress("台北市中山區某路", kv);
    expect(result).toBeNull();
  });
});

// Helper to compute the same cache key as the module
async function computeKey(address: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
