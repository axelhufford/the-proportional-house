/**
 * 2020 census apportionment populations by state.
 *
 * Source: U.S. Census Bureau, 2020 Census Apportionment Results (published
 * April 26, 2021). These are the official populations used for the
 * 2023–2033 House apportionment — they include overseas federal-employee
 * counts attributed to each employee's home state of record, which
 * differs slightly from "resident population" figures.
 *
 *   https://www.census.gov/data/tables/2020/dec/2020-apportionment-data.html
 *
 * DC has no voting House seats today and is omitted from this map. The
 * Sandbox House-expansion feature does not grant DC representation
 * (matches current US law).
 *
 * Wyoming is the smallest state and anchors the "Wyoming Rule" computation:
 * cap district population at Wyoming's and the House grows to ~573 seats.
 *
 * Numbers re-checked against the 2023 Statistical Abstract; small
 * discrepancies vs other published tables are typically the
 * resident-vs-apportionment distinction.
 */

export const STATE_POPULATIONS_2020: Record<string, number> = {
  AL: 5030053,
  AK: 736081,
  AZ: 7158923,
  AR: 3013756,
  CA: 39576757,
  CO: 5782171,
  CT: 3608298,
  DE: 990837,
  FL: 21570527,
  GA: 10725274,
  HI: 1460137,
  ID: 1841377,
  IL: 12822739,
  IN: 6790280,
  IA: 3192406,
  KS: 2940865,
  KY: 4509342,
  LA: 4661468,
  ME: 1363582,
  MD: 6185278,
  MA: 7033469,
  MI: 10084442,
  MN: 5709752,
  MS: 2963914,
  MO: 6160281,
  MT: 1085407,
  NE: 1963333,
  NV: 3108462,
  NH: 1379089,
  NJ: 9294493,
  NM: 2120220,
  NY: 20215751,
  NC: 10453948,
  ND: 779702,
  OH: 11808848,
  OK: 3963516,
  OR: 4241500,
  PA: 13011844,
  RI: 1098163,
  SC: 5124712,
  SD: 887127,
  TN: 6916897,
  TX: 29183290,
  UT: 3275252,
  VT: 643503,
  VA: 8654542,
  WA: 7715946,
  WV: 1795045,
  WI: 5897473,
  WY: 577719,
};

/** Sum of all entries in STATE_POPULATIONS_2020. Precomputed for convenience. */
export const TOTAL_APPORTIONMENT_POPULATION_2020 = Object.values(
  STATE_POPULATIONS_2020,
).reduce((a, b) => a + b, 0);

/** Wyoming's 2020 apportionment population — anchors the Wyoming Rule. */
export const WYOMING_POPULATION_2020 = STATE_POPULATIONS_2020.WY;
