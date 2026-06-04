"""Automated data-integrity checks for the generated public/data JSON.

Run as the final step of the pipeline (and standalone in CI / locally). Asserts
the invariants that must always hold; a failure exits non-zero so the deploy
ships the last-good data instead of a regression. This is the guardrail that
would have caught the North Dakota 2022 "phantom Democratic seat" bug before it
shipped.

    python data-pipeline/validate_data.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DATA = REPO_ROOT / "public" / "data"

TOTAL_SEATS = 435

# Known U.S. House composition (D, R) after each cycle's election — ground truth.
KNOWN_ACTUAL = {
    "2016": (194, 241),
    "2018": (235, 200),
    "2020": (222, 213),
    "2022": (213, 222),
    "2024": (215, 220),
}

# Official apportionment by census. 2016–2020 elections used the 2010 census;
# 2022+ used the 2020 census. Seat counts must match exactly per cycle.
APP_2010 = {
    "CA": 53, "TX": 36, "FL": 27, "NY": 27, "PA": 18, "IL": 18, "OH": 16, "MI": 14,
    "GA": 14, "NC": 13, "NJ": 12, "VA": 11, "WA": 10, "AZ": 9, "MA": 9, "TN": 9,
    "IN": 9, "MO": 8, "MD": 8, "WI": 8, "MN": 8, "CO": 7, "AL": 7, "SC": 7, "LA": 6,
    "KY": 6, "OR": 5, "OK": 5, "CT": 5, "IA": 4, "MS": 4, "AR": 4, "KS": 4, "UT": 4,
    "NV": 4, "NM": 3, "NE": 3, "WV": 3, "ID": 2, "HI": 2, "ME": 2, "NH": 2, "RI": 2,
    "MT": 1, "DE": 1, "SD": 1, "ND": 1, "AK": 1, "VT": 1, "WY": 1,
}
APP_2020 = {
    "CA": 52, "TX": 38, "FL": 28, "NY": 26, "PA": 17, "IL": 17, "OH": 15, "MI": 13,
    "GA": 14, "NC": 14, "NJ": 12, "VA": 11, "WA": 10, "AZ": 9, "MA": 9, "TN": 9,
    "IN": 9, "MO": 8, "MD": 8, "WI": 8, "MN": 8, "CO": 8, "AL": 7, "SC": 7, "LA": 6,
    "KY": 6, "OR": 6, "OK": 5, "CT": 5, "IA": 4, "MS": 4, "AR": 4, "KS": 4, "UT": 4,
    "NV": 4, "NM": 3, "NE": 3, "WV": 2, "ID": 2, "HI": 2, "ME": 2, "NH": 2, "RI": 2,
    "MT": 2, "DE": 1, "SD": 1, "ND": 1, "AK": 1, "VT": 1, "WY": 1,
}


def _load(name: str) -> dict:
    with (PUBLIC_DATA / name).open() as f:
        return json.load(f)


def check_projection(errors: list[str]) -> None:
    p = _load("projection.json")
    states = p["states"]
    if len(states) != 50:
        errors.append(f"projection: {len(states)} states (expected 50)")
    seat_sum = sum(s["seats"] for s in states)
    if seat_sum != TOTAL_SEATS:
        errors.append(f"projection: seats sum {seat_sum} != {TOTAL_SEATS}")
    pd = pr = ad = ar = 0
    for s in states:
        c = s["code"]
        if s["actual"]["d_seats"] + s["actual"]["r_seats"] != s["seats"]:
            errors.append(f"projection {c}: actual seats != {s['seats']}")
        if s["projected"]["d_seats"] + s["projected"]["r_seats"] != s["seats"]:
            errors.append(f"projection {c}: projected seats != {s['seats']}")
        ds, rs = s["baseline_2024"]["d_share"], s["baseline_2024"]["r_share"]
        if not (0 <= ds <= 1) or abs(ds + rs - 1) > 0.02:
            errors.append(f"projection {c}: share off d={ds} r={rs}")
        pd += s["projected"]["d_seats"]; pr += s["projected"]["r_seats"]
        ad += s["actual"]["d_seats"]; ar += s["actual"]["r_seats"]
    nat = p["national"]
    if (pd, pr) != (nat["projected"]["d_seats"], nat["projected"]["r_seats"]):
        errors.append("projection: national.projected != sum of states")
    if (ad, ar) != (nat["actual"]["d_seats"], nat["actual"]["r_seats"]):
        errors.append("projection: national.actual != sum of states")
    if ad + ar != TOTAL_SEATS or pd + pr != TOTAL_SEATS:
        errors.append("projection: national totals don't sum to 435")


def check_retrospectives(errors: list[str]) -> None:
    r = _load("retrospectives.json")
    for year, cyc in r["cycles"].items():
        states = cyc["states"]
        if len(states) != 50:
            errors.append(f"{year}: {len(states)} states (expected 50)")
        app = APP_2010 if int(year) <= 2020 else APP_2020
        ad = ar = pd = pr = 0
        for s in states:
            c = s["code"]
            seats = s["seats"]
            if s["actual"]["d_seats"] + s["actual"]["r_seats"] != seats:
                errors.append(f"{year} {c}: actual seats != {seats}")
            if s["projected_pr"]["d_seats"] + s["projected_pr"]["r_seats"] != seats:
                errors.append(f"{year} {c}: PR seats != {seats}")
            if app.get(c) != seats:
                errors.append(f"{year} {c}: apportionment {seats} != expected {app.get(c)}")
            # The ND-bug guard: PR's seat allocation must not favor the party
            # that lost the two-party vote.
            dshare = s["two_party_share"]["d_share"]
            prd, prr = s["projected_pr"]["d_seats"], s["projected_pr"]["r_seats"]
            if seats == 1:
                # A lone seat must go to the two-party plurality — no rounding slack.
                if prd == 1 and dshare <= 0.5:
                    errors.append(f"{year} {c}: PR gave D the only seat but D share is {dshare}")
                if prr == 1 and dshare >= 0.5:
                    errors.append(f"{year} {c}: PR gave R the only seat but D share is {dshare}")
            else:
                # Multi-seat: allow a small tolerance for legitimate near-tie rounding.
                if prd > prr and dshare < 0.49:
                    errors.append(f"{year} {c}: PR majority D ({prd}/{prr}) but D share {dshare}")
                if prr > prd and dshare > 0.51:
                    errors.append(f"{year} {c}: PR majority R ({prd}/{prr}) but D share {dshare}")
            # An *exactly* 50/50 share never occurs in real returns — it's the
            # signature of a 50/50 imputation slipping into the data (the ND bug).
            if abs(dshare - 0.5) < 1e-9:
                errors.append(f"{year} {c}: two-party share is exactly 50/50 (imputation artifact?)")
            ad += s["actual"]["d_seats"]; ar += s["actual"]["r_seats"]
            pd += s["projected_pr"]["d_seats"]; pr += s["projected_pr"]["r_seats"]
        if ad + ar != TOTAL_SEATS or pd + pr != TOTAL_SEATS:
            errors.append(f"{year}: cycle totals don't sum to 435 (actual {ad+ar}, PR {pd+pr})")
        known = KNOWN_ACTUAL.get(year)
        if known and (ad, ar) != known:
            errors.append(f"{year}: actual composition {ad}/{ar} != known {known[0]}/{known[1]}")
    # series consistency
    for pt in r.get("series", []):
        if pt["d_gain"] != pt["projected_pr"]["d_seats"] - pt["actual"]["d_seats"]:
            errors.append(f"series {pt['year']}: d_gain inconsistent")


def check_history(errors: list[str]) -> None:
    path = PUBLIC_DATA / "history.json"
    if not path.exists():
        return  # optional / accumulates over time
    h = _load("history.json")
    seen = set()
    last = ""
    for pt in h.get("points", []):
        for k in ("date", "projected_d", "projected_r", "actual_d", "actual_r"):
            if k not in pt:
                errors.append(f"history: point missing {k}")
        d = pt.get("date", "")
        if d in seen:
            errors.append(f"history: duplicate date {d}")
        if d < last:
            errors.append(f"history: dates out of order at {d}")
        seen.add(d); last = d


def check_electoral_college(errors: list[str]) -> None:
    path = PUBLIC_DATA / "electoral_college.json"
    if not path.exists():
        return  # optional / built offline from committed baselines
    ec = _load("electoral_college.json")
    for year, c in ec.get("cycles", {}).items():
        total = c["total_ev"]
        # Per-state PR electors sum to the state's EV.
        for s in c["states"]:
            if sum(cand["electors"] for cand in s["candidates"]) != s["ev"]:
                errors.append(f"EC {year} {s['code']}: PR electors != ev {s['ev']}")
        # National actual + proportional both sum to the cycle total.
        if sum(c["actual"]["by_party"].values()) != total:
            errors.append(f"EC {year}: actual EV sum != {total}")
        if sum(c["proportional"]["by_party"].values()) != total:
            errors.append(f"EC {year}: PR EV sum != {total}")
        # No candidate can be flagged a majority winner unless they clear it.
        prop = c["proportional"]
        if prop["no_majority"] and prop["leader"]["electors"] >= c["majority"]:
            errors.append(f"EC {year}: no_majority set but leader has a majority")


def check_senate(errors: list[str]) -> None:
    path = PUBLIC_DATA / "senate.json"
    if not path.exists():
        return  # optional / built offline from committed baseline
    sen = _load("senate.json")
    states = sen.get("states", [])
    if len(states) != 50:
        errors.append(f"senate: {len(states)} states (expected 50)")
    if sum(s["senators"] for s in states) != sen["meta"]["total_senators"]:
        errors.append("senate: senators don't sum to total_senators")
    if sum(s["population"] for s in states) != sen["meta"]["total_population"]:
        errors.append("senate: state populations don't sum to total_population")
    for s in states:
        if s["population"] <= 0 or "representation_index" not in s:
            errors.append(f"senate {s.get('code')}: bad population / missing index")
    maj = sen.get("majority", {})
    if maj.get("senators", 0) < 51:
        errors.append("senate: majority block has < 51 senators")


def check_circuits(errors: list[str]) -> None:
    path = PUBLIC_DATA / "circuits.json"
    if not path.exists():
        return  # optional / built offline from committed baseline
    c = _load("circuits.json")
    total_pop = c["meta"]["total_population"]
    total_judges = c["meta"]["total_judges"]
    for grp in ("current", "rebalanced"):
        g = c[grp]
        if sum(r["population"] for r in g["circuits"]) != total_pop:
            errors.append(f"circuits {grp}: populations don't sum to total_population")
        if sum(r["judges"] for r in g["circuits"]) != total_judges:
            errors.append(f"circuits {grp}: judges don't sum to {total_judges}")
        states = [code for code in g["by_state"] if code not in ("DC", "PR")]
        if len(set(states)) != 50:
            errors.append(f"circuits {grp}: {len(set(states))} states assigned (expected 50)")
        for r in g["circuits"]:
            for code in r["states"]:
                if g["by_state"].get(code) != r["id"]:
                    errors.append(f"circuits {grp}: {code} not mapped to {r['id']}")


def main() -> None:
    errors: list[str] = []
    check_projection(errors)
    check_retrospectives(errors)
    check_history(errors)
    check_electoral_college(errors)
    check_senate(errors)
    check_circuits(errors)
    if errors:
        print(f"DATA VALIDATION FAILED ({len(errors)} issue(s)):")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    print("Data validation passed: projection + retrospectives + history + EC + Senate + circuits invariants hold.")


if __name__ == "__main__":
    main()
