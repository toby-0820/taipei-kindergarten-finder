export type SchoolType = "public" | "non_profit";
// 公幼 has mixed-age "3-5歲班" + "2歲專班".
// 非營利 has one class per age: "5歲班" / "4歲班" / "3歲班" / "2歲專班".
export type AgeBand = "3-5歲班" | "5歲班" | "4歲班" | "3歲班" | "2歲專班";

export interface ParsedClass {
  age_band: AgeBand;
  capacity: number;
  regs: number[];          // variable length; index 0 corresponds to 順序1-4 lumped, then 順序5, 順序6, ...
  reg_total: number | null;
}

export interface ParsedSchool {
  id: string;              // school name acts as id (e.g., "松山國小附幼")
                            // — the page doesn't expose a stable code, so name is the key
  name: string;
  type: SchoolType;
  district: string;
  address: string | null;  // may be null if the page doesn't expose it
  phone: string | null;
  classes: ParsedClass[];
}
