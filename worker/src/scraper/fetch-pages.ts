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
}

export function buildTargets(): FetchTarget[] {
  const targets: FetchTarget[] = [];
  for (const [district, code] of Object.entries(DIST_CODES)) {
    for (const type of Object.keys(SITES) as SchoolType[]) {
      targets.push({
        url: `${SITES[type]}/Board.aspx?dist=${code}`,
        type, district,
        age_band: "3-5歲班",
      });
      // 2歲專班 uses the same URL but requires postback (handled in fetchHtml)
      targets.push({
        url: `${SITES[type]}/Board.aspx?dist=${code}`,
        type, district,
        age_band: "2歲專班",
      });
    }
  }
  return targets;
}

/**
 * Fetch HTML for a target. For 3-5歲班, a simple GET. For 2歲專班, performs
 * ASP.NET postback to switch radio to value=1.
 */
export async function fetchHtml(target: FetchTarget): Promise<string | null> {
  // First GET to capture cookies + viewstate
  let firstResp: Response;
  try {
    firstResp = await fetch(target.url, {
      headers: { "user-agent": "TaipeiKindergartenFinderBot/1.0" },
      redirect: "follow",
      cf: { cacheTtl: 0 },
    });
  } catch {
    return null;
  }
  if (!firstResp.ok) return null;
  const firstHtml = await firstResp.text();

  if (target.age_band === "3-5歲班") {
    return firstHtml;
  }

  // 2歲專班 — extract hidden form fields and postback
  const cookies = firstResp.headers.get("set-cookie") ?? "";
  const cookieHeader = cookies.split(",").map((c) => c.split(";")[0].trim()).join("; ");

  const vs = extract(firstHtml, /name="__VIEWSTATE"\s+value="([^"]*)"/);
  const ev = extract(firstHtml, /name="__EVENTVALIDATION"\s+value="([^"]*)"/);
  const vg = extract(firstHtml, /name="__VIEWSTATEGENERATOR"\s+value="([^"]*)"/);
  if (!vs || !ev) return null;

  const body = new URLSearchParams({
    "__EVENTTARGET": "ctl00$MainContent$classType$1",
    "__EVENTARGUMENT": "",
    "__VIEWSTATE": vs,
    "__EVENTVALIDATION": ev,
    "__VIEWSTATEGENERATOR": vg ?? "",
    "ctl00$MainContent$classType": "1",
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
