/**
 * GET /api/school-district?address=...
 *
 * Resolves a Taipei address to (1) its 行政區/里/鄰 via TPGOS GIS, and
 * (2) the elementary schools whose 學區 covers that 里/鄰.
 *
 * Public 公幼 attached to those 國小 (e.g. 長春國小附幼 ⊂ 長春國小) put
 * the user in the "學區內順位" tier — used as a hint badge in the UI.
 */
import type { Env } from "../index";

// API key from the public school-district website's source JS (not secret).
const TPGOS_KEY = "918A7CB57AE38AD226859ECFEE7811F0CF9BFC00B197C8D0780CF8C3C9BEE820BDAB728ECD6775DA2DF39DCAF26DBB68";

interface VillageInfo {
  sect: string;      // 行政區, e.g. "中山區"
  lie: string;       // 里, e.g. "松江里"
  lin: string;       // 鄰, e.g. "11鄰"
  formalAddress: string;
}

interface DistrictSchool {
  name: string;
  grade: string;     // "3"=國小, "5"=中學, etc.
  addr: string;
  tel: string;
}

async function lookupVillage(address: string): Promise<VillageInfo | null> {
  const url = new URL("https://map.tpgos.gov.taipei/embed/webapi.cfm");
  url.searchParams.set("SERVICE", "ADDRESS");
  url.searchParams.set("ADDRESS", address);
  url.searchParams.set("APIKEY", TPGOS_KEY);
  url.searchParams.set("ITEM_LIST", "TPGOS_CA_ADDR:30,TPGOS_PWLMK_ADDR:30,TPGOS_XY_ADDR:30,TGOS_V2_ADDR:30");
  url.searchParams.set("format", "JSONP");
  url.searchParams.set("DETAIL", "true");

  let body: string;
  try {
    const r = await fetch(url, {
      headers: { "Referer": "https://schooldistrict.tp.edu.tw/html/search.jsp" },
    });
    if (!r.ok) return null;
    body = await r.text();
  } catch { return null; }

  // Response is JSONP-wrapped JSON; extract the JSON object.
  const m = body.match(/\{"WEBSERVICE":[\s\S]*\}\s*$/);
  if (!m) return null;
  let parsed: any;
  try { parsed = JSON.parse(m[0]); } catch { return null; }
  const r = parsed?.WEBSERVICE?.QUERYRESULT;
  const d = r?.DETAIL;
  if (!d?.ZONE || !d?.LIE) return null;
  return {
    sect: d.ZONE,
    lie: d.LIE,
    lin: d.LIN ?? "",
    formalAddress: r.ADDRESS ?? address,
  };
}

async function lookupSchoolsByVillage(v: VillageInfo): Promise<DistrictSchool[]> {
  const body = new URLSearchParams({
    sectName: v.sect,
    lieName: v.lie,
    sdfName: v.lin,
  });
  let resp: Response;
  try {
    resp = await fetch("https://schooldistrict.tp.edu.tw/gis/checkSchoolByVillage.jsp", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch { return []; }
  if (!resp.ok) return [];
  let data: any;
  try { data = await resp.json(); } catch { return []; }
  if (!Array.isArray(data)) return [];
  return data.map((row) => ({
    name: row.schoolName ?? "",
    grade: row.schoolGrade ?? "",
    addr: row.ADDR ?? "",
    tel: row.TEL ?? "",
  })).filter((s) => s.name);
}

export async function handleSchoolDistrict(request: Request, _env: Env): Promise<Response> {
  const url = new URL(request.url);
  const address = url.searchParams.get("address")?.trim();
  if (!address) return json({ error: "address required" }, 400);

  const village = await lookupVillage(address);
  if (!village) return json({ ok: false, hint: "找不到此地址的學區資料（可能不在台北市）" });

  const schools = await lookupSchoolsByVillage(village);
  // For our use case (kindergarten), keep only 國小 (schoolGrade=3) since 公幼
  // 附幼 is governed by the parent 國小's 學區.
  const elementarySchools = schools.filter((s) => s.grade === "3");

  return json({
    ok: true,
    address: village.formalAddress,
    sect: village.sect,
    lie: village.lie,
    lin: village.lin,
    elementarySchools,
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}
