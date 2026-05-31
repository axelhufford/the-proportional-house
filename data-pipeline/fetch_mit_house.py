"""Distill the MIT Election Lab "U.S. House 1976–2024" returns into per-cycle
baselines for the prior-year retrospectives (2016, 2018, 2020, 2022).

Source (guestbook-gated, downloaded once by hand):
  MIT Election Data and Science Lab, "U.S. House 1976–2024",
  doi:10.7910/DVN/IG0UN2 — file 1976-2024-house.tab (actually comma-delimited).
  Place it at data-pipeline/baseline/1976-2024-house.tab.

For each (cycle, state) we compute the same fields house_2024.json carries
(minus elasticity, which only the *current* projection uses):
  - seats                 : that cycle's apportionment (district count)
  - actual_d_seats / _r   : seats won, by winner-of-district
  - two_party_share       : statewide D/(D+R) and R/(D+R) of reported votes
  - votes                 : raw D/R/other/total
  - uncontested_district_count + baseline_distortion_warning

Methodology note: prior cycles use the *reported* statewide two-party vote
(uncontested districts included), NOT the pres-by-CD imputation the 2024 Clerk
pipeline applies. Uncontested districts are counted + a per-state warning is set
so the UI/Methodology can be honest about it.

2024 stays sourced from the Clerk (house_2024.json) — it must match the
Current view's structural baseline (recomputeWithSwing(payload, 0)).

Run from repo root:
    python data-pipeline/fetch_mit_house.py
"""

from __future__ import annotations

import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BASELINE_DIR = REPO_ROOT / "data-pipeline" / "baseline"
MIT_CSV = BASELINE_DIR / "1976-2024-house.tab"  # comma-delimited despite .tab

# Cycles we source from MIT. 2024 comes from the Clerk (house_2024.json).
CYCLES = [2016, 2018, 2020, 2022]

SOURCE = "MIT Election Data and Science Lab, U.S. House 1976–2024"
SOURCE_URL = "https://doi.org/10.7910/DVN/IG0UN2"

# Known actual House composition (D / R seats won) for validation.
EXPECTED = {
    2016: {"d": 194, "r": 241},
    2018: {"d": 235, "r": 199},  # NC-09 voided; a 2019 special (R) filled it
    2020: {"d": 222, "r": 213},
    2022: {"d": 213, "r": 222},
}

# Restrict to the 50 states (exclude DC delegate / territories) — match the
# 2024 baseline's universe so the frontend's 50-state map lines up.
STATE_FIPS = {
    "AL": "01", "AK": "02", "AZ": "04", "AR": "05", "CA": "06", "CO": "08",
    "CT": "09", "DE": "10", "FL": "12", "GA": "13", "HI": "15", "ID": "16",
    "IL": "17", "IN": "18", "IA": "19", "KS": "20", "KY": "21", "LA": "22",
    "ME": "23", "MD": "24", "MA": "25", "MI": "26", "MN": "27", "MS": "28",
    "MO": "29", "MT": "30", "NE": "31", "NV": "32", "NH": "33", "NJ": "34",
    "NM": "35", "NY": "36", "NC": "37", "ND": "38", "OH": "39", "OK": "40",
    "OR": "41", "PA": "42", "RI": "44", "SC": "45", "SD": "46", "TN": "47",
    "TX": "48", "UT": "49", "VT": "50", "VA": "51", "WA": "53", "WV": "54",
    "WI": "55", "WY": "56",
}
STATE_NAME = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
    "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska",
    "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey",
    "NM": "New Mexico", "NY": "New York", "NC": "North Carolina",
    "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon",
    "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}


def major_party(party: str) -> str | None:
    """Map a party label to 'D', 'R', or None (third party / writein)."""
    p = party.upper()
    if p.startswith("REPUBLIC"):
        return "R"
    # MN = Democratic-Farmer-Labor; ND = Democratic-NPL / Democratic-Nonpartisan
    if p.startswith("DEMOCRAT") or "FARMER-LABOR" in p or "NPL" in p or "NONPARTISAN LEAGUE" in p:
        return "D"
    return None


def load_rows() -> list[dict]:
    if not MIT_CSV.exists():
        raise SystemExit(
            f"Missing {MIT_CSV.relative_to(REPO_ROOT)} — download the MIT "
            "'U.S. House 1976–2024' file (doi:10.7910/DVN/IG0UN2) and place it there."
        )
    with MIT_CSV.open(encoding="utf-8", errors="replace") as f:
        return list(csv.DictReader(f))


def build_cycle(rows: list[dict], year: int) -> dict:
    # rows for this cycle's general election, voting districts only.
    cyc = [
        r for r in rows
        if r["year"] == str(year)
        and r["stage"] == "GEN"
        and r["state_po"] in STATE_FIPS
    ]

    # Group by (state, district) → candidate name → summed votes + party set.
    # MIT lists fusion candidates as one row per party line, same candidate name;
    # sum a candidate's lines and classify by their major party.
    by_district: dict[tuple[str, str], dict[str, dict]] = defaultdict(lambda: defaultdict(lambda: {"votes": 0, "parties": set()}))
    for r in cyc:
        if r.get("writein", "FALSE") == "TRUE":
            continue  # write-ins aren't candidates for seats/two-party share
        if (r.get("party") or "").strip().upper() in ("", "NA"):
            # Administrative pseudo-rows carry party NA: write-ins, and the RCV
            # bookkeeping entries EXHAUSTED BALLOT / UNDERVOTES / OVERVOTES
            # (Maine's ranked-choice House races). Real candidates always have a
            # party label, so this is safe to drop.
            continue
        try:
            v = int(r["candidatevotes"]) if r["candidatevotes"] not in ("", "NA") else 0
        except ValueError:
            v = 0
        cand = (r["candidate"] or "").strip().upper()
        if not cand or cand in ("WRITEIN", "WRITE-IN", "BLANK VOTE/SCATTERING", "SCATTERING"):
            continue
        cell = by_district[(r["state_po"], r["district"])][cand]
        cell["votes"] += v
        cell["parties"].add(r["party"])

    # Aggregate to states.
    states_acc: dict[str, dict] = {}
    for (po, district), cands in by_district.items():
        st = states_acc.setdefault(po, {
            "seats": 0, "d_seats": 0, "r_seats": 0,
            "d_votes": 0, "r_votes": 0, "other_votes": 0,
            "uncontested": 0,
        })
        st["seats"] += 1

        # Per-candidate classified totals.
        classified = []  # (party 'D'/'R'/None, votes)
        d_present = r_present = False
        for cand, cell in cands.items():
            mp = None
            for p in cell["parties"]:
                m = major_party(p)
                if m == "D":
                    mp = "D"; break
                if m == "R":
                    mp = "R"  # keep, but D takes precedence if also present
            # A candidate could carry both? extremely rare; D-precedence above.
            classified.append((mp, cell["votes"]))
            if mp == "D":
                d_present = True; st["d_votes"] += cell["votes"]
            elif mp == "R":
                r_present = True; st["r_votes"] += cell["votes"]
            else:
                st["other_votes"] += cell["votes"]

        # Winner of the district → seat.
        winner = max(classified, key=lambda c: c[1], default=(None, 0))
        if winner[0] == "D":
            st["d_seats"] += 1
        elif winner[0] == "R":
            st["r_seats"] += 1
        # else: third-party / independent winner (none 2016–2024); leaves D+R<seats

        if not (d_present and r_present):
            st["uncontested"] += 1  # one major party fielded no candidate here

    # Emit state records (same shape as house_2024.json minus elasticity).
    states_out = []
    for po in sorted(states_acc, key=lambda p: STATE_FIPS[p]):
        st = states_acc[po]
        dv, rv = st["d_votes"], st["r_votes"]
        two = dv + rv
        d_share = dv / two if two else 0.5
        r_share = rv / two if two else 0.5
        states_out.append({
            "fips": STATE_FIPS[po],
            "code": po,
            "name": STATE_NAME[po],
            "seats": st["seats"],
            "actual_d_seats": st["d_seats"],
            "actual_r_seats": st["r_seats"],
            "uncontested_district_count": st["uncontested"],
            "votes": {
                "republican": rv,
                "democratic": dv,
                "other": st["other_votes"],
                "total": dv + rv + st["other_votes"],
            },
            "two_party_share": {
                "d_share": round(d_share, 6),
                "r_share": round(r_share, 6),
            },
            # Degenerate only if a major party got ~no statewide votes (rare).
            "baseline_distortion_warning": two == 0 or dv == 0 or rv == 0,
        })

    nat_d = sum(s["actual_d_seats"] for s in states_out)
    nat_r = sum(s["actual_r_seats"] for s in states_out)
    nat_seats = sum(s["seats"] for s in states_out)
    nat_dv = sum(s["votes"]["democratic"] for s in states_out)
    nat_rv = sum(s["votes"]["republican"] for s in states_out)
    nat_margin_d = (nat_dv - nat_rv) / (nat_dv + nat_rv) * 100 if (nat_dv + nat_rv) else 0.0

    return {
        "meta": {
            "year": year,
            "source": SOURCE,
            "source_url": SOURCE_URL,
            "national_house_popular_vote": {
                "republican": nat_rv,
                "democratic": nat_dv,
                "total": nat_dv + nat_rv,
                "d_margin_points": round(nat_margin_d, 3),
            },
            "national_composition": {"d_seats": nat_d, "r_seats": nat_r, "total": nat_d + nat_r},
        },
        "states": states_out,
    }


def main() -> None:
    rows = load_rows()
    print(f"Loaded {len(rows)} MIT House rows.\n")
    all_ok = True
    for year in CYCLES:
        payload = build_cycle(rows, year)
        out = BASELINE_DIR / f"house_{year}.json"
        out.write_text(json.dumps(payload, indent=2))
        comp = payload["meta"]["national_composition"]
        exp = EXPECTED[year]
        d, r, tot = comp["d_seats"], comp["r_seats"], comp["total"]
        n_states = len(payload["states"])
        unc = sum(s["uncontested_district_count"] for s in payload["states"])
        ok = (tot == 435 and abs(d - exp["d"]) <= 2 and abs(r - exp["r"]) <= 2)
        all_ok = all_ok and ok
        flag = "✓" if ok else "⚠"
        print(
            f"{flag} {year}: D {d} / R {r} (total {tot}); states={n_states}; "
            f"uncontested districts={unc}; expected D{exp['d']}/R{exp['r']} "
            f"→ wrote {out.relative_to(REPO_ROOT)}"
        )
    if not all_ok:
        print("\n⚠ One or more cycles failed the seat-total check — inspect before trusting.")
        sys.exit(1)
    print("\nAll cycles within tolerance of the historical record.")


if __name__ == "__main__":
    main()
