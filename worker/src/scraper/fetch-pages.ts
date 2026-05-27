import type { SchoolType, AgeBand } from "../types";

const DIST_CODES: Record<string, string> = {
  "松山區": "63000010", "信義區": "63000020", "大安區": "63000030", "中山區": "63000040",
  "中正區": "63000050", "大同區": "63000060", "萬華區": "63000070", "文山區": "63000080",
  "南港區": "63000090", "內湖區": "63000100", "士林區": "63000110", "北投區": "63000120",
};

const SITES: Record<SchoolType, string> = {
  public: "https://kid.tp.edu.tw",
  non_profit: "https://npkid.tp.edu.tw",
};

export interface FetchTarget {
  url: string;
  type: SchoolType;
  district: string;
  age_band: AgeBand;
  // ASP.NET postback parameters. If postback=null, do a plain GET.
  // Otherwise POST with __EVENTTARGET = postback.eventTarget and
  // ctl00$MainContent$classType = postback.classTypeValue.
  postback: { eventTarget: string; classTypeValue: string } | null;
}

// Public site (kid.tp.edu.tw): default GET = 3-5歲班; postback to 2歲專班.
const PUBLIC_CLASSES: Array<{ age_band: AgeBand; postback: FetchTarget["postback"] }> = [
  { age_band: "3-5歲班", postback: null },
  { age_band: "2歲專班", postback: { eventTarget: "ctl00$MainContent$classType$1", classTypeValue: "1" } },
];

// Non-profit site (npkid.tp.edu.tw): default GET = 5歲班;
// postbacks to 4歲班, 3歲班, 2歲專班.
const NP_CLASSES: Array<{ age_band: AgeBand; postback: FetchTarget["postback"] }> = [
  { age_band: "5歲班", postback: null },
  { age_band: "4歲班", postback: { eventTarget: "ctl00$MainContent$classType$1", classTypeValue: "5" } },
  { age_band: "3歲班", postback: { eventTarget: "ctl00$MainContent$classType$2", classTypeValue: "4" } },
  { age_band: "2歲專班", postback: { eventTarget: "ctl00$MainContent$classType$3", classTypeValue: "1" } },
];

export function buildTargets(): FetchTarget[] {
  const targets: FetchTarget[] = [];
  for (const [district, code] of Object.entries(DIST_CODES)) {
    for (const type of Object.keys(SITES) as SchoolType[]) {
      const url = `${SITES[type]}/Board.aspx?dist=${code}`;
      const classes = type === "public" ? PUBLIC_CLASSES : NP_CLASSES;
      for (const c of classes) {
        targets.push({ url, type, district, age_band: c.age_band, postback: c.postback });
      }
    }
  }
  return targets;
}

/**
 * Fetch HTML for a target. If postback=null, plain GET. Otherwise GET first
 * to harvest cookies + viewstate, then POST with the target's __EVENTTARGET
 * and classType value to switch the page.
 */
// Per-fetch timeout: kindergarten sites occasionally hang for 60s+, which
// drags Promise.all's wallTime well past the 30s scheduled-handler budget.
// Cap each fetch at 8s so a single slow upstream can't kill the whole batch.
const FETCH_TIMEOUT_MS = 8000;

function timeoutSignal(): AbortSignal {
  return AbortSignal.timeout(FETCH_TIMEOUT_MS);
}

export async function fetchHtml(target: FetchTarget): Promise<string | null> {
  let firstResp: Response;
  try {
    firstResp = await fetch(target.url, {
      headers: { "user-agent": "TaipeiKindergartenFinderBot/1.0" },
      redirect: "follow",
      cf: { cacheTtl: 0 },
      signal: timeoutSignal(),
    });
  } catch {
    return null;
  }
  if (!firstResp.ok) return null;
  const firstHtml = await firstResp.text();

  if (!target.postback) return firstHtml;

  const setCookies: string[] = typeof firstResp.headers.getSetCookie === "function"
    ? firstResp.headers.getSetCookie()
    : ((firstResp.headers.get("set-cookie") ?? "").split(/,(?=\s*[^;,= ]+=)/));
  const cookieHeader = setCookies
    .map((c) => c.split(";")[0].trim())
    .filter((c) => c.length > 0)
    .join("; ");

  const vs = extract(firstHtml, /name="__VIEWSTATE"[^>]*\bvalue="([^"]*)"/);
  const ev = extract(firstHtml, /name="__EVENTVALIDATION"[^>]*\bvalue="([^"]*)"/);
  const vg = extract(firstHtml, /name="__VIEWSTATEGENERATOR"[^>]*\bvalue="([^"]*)"/);
  if (!vs || !ev) return null;

  const body = new URLSearchParams({
    "__EVENTTARGET": target.postback.eventTarget,
    "__EVENTARGUMENT": "",
    "__VIEWSTATE": vs,
    "__EVENTVALIDATION": ev,
    "__VIEWSTATEGENERATOR": vg ?? "",
    "ctl00$MainContent$classType": target.postback.classTypeValue,
  });

  let postResp: Response;
  try {
    postResp = await fetch(target.url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "TaipeiKindergartenFinderBot/1.0",
        "cookie": cookieHeader,
      },
      body: body.toString(),
      cf: { cacheTtl: 0 },
      signal: timeoutSignal(),
    });
  } catch {
    return null;
  }
  if (!postResp.ok) return null;
  return postResp.text();
}

function extract(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? m[1] : null;
}
