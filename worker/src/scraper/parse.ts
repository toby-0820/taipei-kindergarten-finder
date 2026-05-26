import { parse } from "node-html-parser";
import type { ParsedSchool, SchoolType, AgeBand } from "../types";

export interface ParseContext {
  type: SchoolType;
  district: string;
  age_band: AgeBand;  // tells the parser which class the HTML represents
}

/** Parse a kid.tp.edu.tw or npkid.tp.edu.tw Board.aspx page into structured school records. */
export function parseBoardPage(html: string, ctx: ParseContext): ParsedSchool[] {
  // Early exit: page says no data
  if (html.includes("查無資料")) {
    return [];
  }

  const root = parse(html);
  const table = root.querySelector("#MainContent_GridView1");
  if (!table) {
    return [];
  }

  const rows = table.querySelectorAll("tr");
  const schools: ParsedSchool[] = [];

  for (const row of rows) {
    // Skip header rows (rows that contain <th> cells)
    if (row.querySelector("th")) {
      continue;
    }

    const cells = row.querySelectorAll("td");

    // Minimum: sn + name + capacity + at least 1 reg + total = 5 cells
    if (cells.length < 5) {
      continue;
    }

    // td[0] = 項次 (row number / sn) — skip
    // td[1] = school name
    const name = cells[1].text.trim();
    if (!name) {
      continue;
    }

    // td[2] = 公告缺額 (capacity)
    const capacity = parseInt(cells[2].text.trim(), 10);
    if (isNaN(capacity)) {
      continue;
    }

    // td[3..N-2] = priority registration counts (variable length)
    // td[N-1] = 總登記人數 (total)
    const N = cells.length;
    const regs: number[] = [];
    for (let i = 3; i <= N - 2; i++) {
      const val = parseInt(cells[i].text.trim(), 10);
      regs.push(isNaN(val) ? 0 : val);
    }

    // last cell = total
    const totalText = cells[N - 1].text.trim();
    const reg_total = totalText !== "" ? parseInt(totalText, 10) : null;

    schools.push({
      id: name,
      name,
      type: ctx.type,
      district: ctx.district,
      address: null,
      phone: null,
      classes: [
        {
          age_band: ctx.age_band,
          capacity,
          regs,
          reg_total: reg_total !== null && isNaN(reg_total) ? null : reg_total,
        },
      ],
    });
  }

  return schools;
}
