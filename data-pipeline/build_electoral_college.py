"""Assemble public/data/electoral_college.json — the proportional-Electoral-College
counterfactual for every presidential cycle 1976-2024.

For each cycle, for each state, we allocate the state's electoral votes across ALL
candidates in proportion to the state popular vote (canonical method: Sainte-Laguë,
the same as the House model), then aggregate nationally and check whether anyone
reaches a 270 majority — the headline finding is how often a proportional EC would
have produced *no majority* (a contingent House election).

The "actual" comparison is the real winner-take-all result, with Maine/Nebraska's
congressional-district splits applied for the cycles they split. The build is
self-validating: winner-take-all over our state data must reproduce the known
actual EC tally for every cycle (e.g. 2000 = Bush 271 / Gore 267 by state),
which in turn validates the electoral_votes.json table.

Reads:  data-pipeline/baseline/president_{year}.json
Writes: public/data/electoral_college.json

Run:    python data-pipeline/build_electoral_college.py
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from allocation import AllocationInputN, allocate_n

REPO_ROOT = Path(__file__).resolve().parent.parent
BASELINE_DIR = REPO_ROOT / "data-pipeline" / "baseline"
OUT_PATH = REPO_ROOT / "public" / "data" / "electoral_college.json"

CYCLES = [1976, 1980, 1984, 1988, 1992, 1996, 2000, 2004, 2008, 2012, 2016, 2020, 2024]
METHOD = "sainte-lague"

# Maine (since 2016) and Nebraska (2008, 2020, 2024) split their EVs by
# congressional district. The actual EC result reflects these; the proportional
# counterfactual instead allocates them statewide like every other state. EVs by
# party for the split cycles (statewide-winner gets the 2 at-large + their CDs).
ME_NE_SPLITS: dict[tuple[int, str], dict[str, int]] = {
    (2008, "NE"): {"R": 4, "D": 1},  # McCain 4, Obama NE-02
    (2016, "ME"): {"D": 3, "R": 1},  # Clinton 3, Trump ME-02
    (2020, "ME"): {"D": 3, "R": 1},  # Biden 3, Trump ME-02
    (2020, "NE"): {"R": 4, "D": 1},  # Trump 4, Biden NE-02
    (2024, "ME"): {"D": 3, "R": 1},  # Harris 3, Trump ME-02
    (2024, "NE"): {"R": 4, "D": 1},  # Trump 4, Harris NE-02
}

# Known actual Electoral College result by state (winner-take-all + ME/NE
# splits), BEFORE faithless electors. The build asserts it reproduces these.
EXPECTED_ACTUAL: dict[int, dict[str, int]] = {
    1976: {"D": 297, "R": 241},
    1980: {"R": 489, "D": 49},
    1984: {"R": 525, "D": 13},
    1988: {"R": 426, "D": 112},
    1992: {"D": 370, "R": 168},
    1996: {"D": 379, "R": 159},
    2000: {"R": 271, "D": 267},
    2004: {"R": 286, "D": 252},
    2008: {"D": 365, "R": 173},
    2012: {"D": 332, "R": 206},
    2016: {"R": 306, "D": 232},
    2020: {"D": 306, "R": 232},
    2024: {"R": 312, "D": 226},
}


def _empty_party_tally() -> dict[str, int]:
    return {"D": 0, "R": 0, "O": 0}


def build_cycle(year: int, errors: list[str]) -> dict:
    payload = json.loads((BASELINE_DIR / f"president_{year}.json").read_text())
    states = payload["states"]
    total_ev = sum(s["ev"] for s in states)
    majority = total_ev // 2 + 1

    actual_by_party = _empty_party_tally()
    pr_by_party = _empty_party_tally()
    pr_by_candidate: dict[str, dict] = {}  # name -> {party, electors}
    states_out = []

    for s in states:
        code = s["code"]
        ev = s["ev"]
        cands = s["candidates"]  # sorted desc by votes

        # --- Actual (winner-take-all, with ME/NE district splits) ---
        split = ME_NE_SPLITS.get((year, code))
        if split:
            for party, n in split.items():
                actual_by_party[party] += n
            actual_winner_party = max(split, key=split.get)
        else:
            actual_winner_party = cands[0]["party"]
            actual_by_party[actual_winner_party] += ev

        # --- Proportional allocation across all candidates ---
        electors = allocate_n(AllocationInputN(seats=ev, votes=[c["votes"] for c in cands]), METHOD)
        if sum(electors) != ev:
            errors.append(f"{year} {code}: PR electors {sum(electors)} != ev {ev}")
        state_cands = []
        for c, e in zip(cands, electors):
            state_cands.append({"name": c["name"], "party": c["party"], "votes": c["votes"], "electors": e})
            pr_by_party[c["party"]] += e
            if e > 0 or c["party"] in ("D", "R"):
                rec = pr_by_candidate.setdefault(c["name"], {"party": c["party"], "electors": 0})
                rec["electors"] += e

        states_out.append({
            "code": code,
            "name": s["name"],
            "ev": ev,
            "actual_winner_party": actual_winner_party,
            "actual_split": split or None,
            "candidates": state_cands,
        })

    # Validate actual reproduces the known tally.
    exp = EXPECTED_ACTUAL[year]
    for party in ("D", "R"):
        if actual_by_party[party] != exp.get(party, 0):
            errors.append(
                f"{year}: actual {party}={actual_by_party[party]} != known {exp.get(party, 0)} "
                f"(EV table or data error)"
            )
    if sum(actual_by_party.values()) != total_ev:
        errors.append(f"{year}: actual EV sum {sum(actual_by_party.values())} != {total_ev}")
    if sum(pr_by_party.values()) != total_ev:
        errors.append(f"{year}: PR EV sum {sum(pr_by_party.values())} != {total_ev}")

    # National proportional candidate list (electors-winning first).
    by_candidate = sorted(
        ({"name": n, "party": d["party"], "electors": d["electors"]} for n, d in pr_by_candidate.items()),
        key=lambda c: -c["electors"],
    )
    winners = [c for c in by_candidate if c["electors"] > 0]
    leader = winners[0] if winners else by_candidate[0]
    no_majority = leader["electors"] < majority
    actual_winner_party = "D" if exp.get("D", 0) > exp.get("R", 0) else "R"

    return {
        "year": year,
        "total_ev": total_ev,
        "majority": majority,
        "actual": {
            "by_party": actual_by_party,
            "winner_party": actual_winner_party,
        },
        "proportional": {
            "by_party": pr_by_party,
            "by_candidate": winners,
            "leader": {"name": leader["name"], "party": leader["party"], "electors": leader["electors"]},
            "no_majority": no_majority,
            "majority_gap": (majority - leader["electors"]) if no_majority else 0,
        },
        "states": states_out,
    }


def main() -> None:
    errors: list[str] = []
    cycles = {}
    series = []
    for year in CYCLES:
        c = build_cycle(year, errors)
        cycles[str(year)] = c
        series.append({
            "year": year,
            "no_majority": c["proportional"]["no_majority"],
            "pr_d": c["proportional"]["by_party"]["D"],
            "pr_r": c["proportional"]["by_party"]["R"],
            "pr_other": c["proportional"]["by_party"]["O"],
            "actual_d": c["actual"]["by_party"]["D"],
            "actual_r": c["actual"]["by_party"]["R"],
            "leader_party": c["proportional"]["leader"]["party"],
            "leader_electors": c["proportional"]["leader"]["electors"],
        })

    if errors:
        print("VALIDATION ERRORS:")
        for e in errors:
            print("  ✗", e)
        raise SystemExit(1)

    payload = {
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "canonical_method": METHOD,
            "majority": 270,
            "cycles": CYCLES,
            "sources": {
                "1976-2016": "MIT Election Data and Science Lab, U.S. President 1976-2020 (doi:10.7910/DVN/42MVDX)",
                "2020-2024": "FiveThirtyEight election-results (certified state totals)",
                "electoral_votes": "U.S. National Archives; apportionment by decennial census",
            },
            "note": (
                "Proportional allocation of each state's electoral votes across all candidates "
                "(Sainte-Laguë), vs. the actual winner-take-all result. Maine/Nebraska are split "
                "by district in the actual column and allocated statewide in the proportional one."
            ),
        },
        "cycles": cycles,
        "series": series,
    }
    OUT_PATH.write_text(json.dumps(payload, indent=2))

    print(f"Wrote {OUT_PATH.relative_to(REPO_ROOT)} ({len(CYCLES)} cycles)\n")
    print(f"{'year':>4}  {'actual (D/R)':>14}  {'proportional (D/R/oth)':>24}  result")
    for s in series:
        nm = "  ← NO MAJORITY (→ House)" if s["no_majority"] else ""
        print(
            f"{s['year']:>4}  {s['actual_d']:>5}/{s['actual_r']:<5}      "
            f"{s['pr_d']:>4}/{s['pr_r']:<4}/{s['pr_other']:<3}            "
            f"{s['leader_party']} {s['leader_electors']}{nm}"
        )


if __name__ == "__main__":
    main()
