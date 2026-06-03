"""Distill state-by-candidate presidential returns (1976-2024) into per-cycle
baselines for the proportional Electoral College feature.

Sources (both per-candidate, openly fetchable, faithful — validated downstream
by build_electoral_college.py reproducing the known actual EC tally each cycle):

  1976-2016: MIT Election Data and Science Lab, official GitHub mirror
             github.com/MEDSL/constituency-returns (1976-2016-president.csv),
             the published form of doi:10.7910/DVN/42MVDX. Per-candidate, with
             reliable `party` labels and "Last, First" names.
  2020,2024: FiveThirtyEight election-results (election_results_presidential.csv).
             Per-candidate incl. third parties; `party` column is blank, so the
             two majors are classified by name. Fusion rows (a candidate on
             multiple ballot lines) and Maine's 2020 RCV round-1 rows are summed.

For each cycle we write data-pipeline/baseline/president_{year}.json:
  { meta, states: [ { code, name, ev, total_votes,
                      candidates: [ {name, party, votes}, ... ] } ] }
where party is "D" | "R" | "O" and `ev` is resolved from electoral_votes.json.

Re-runnable (downloads the two CSVs each run):
    python data-pipeline/fetch_president.py
"""

from __future__ import annotations

import csv
import io
import json
import re
from collections import defaultdict
from pathlib import Path

import requests

REPO_ROOT = Path(__file__).resolve().parent.parent
BASELINE_DIR = REPO_ROOT / "data-pipeline" / "baseline"
EV_PATH = BASELINE_DIR / "electoral_votes.json"

MEDSL_URL = "https://raw.githubusercontent.com/MEDSL/constituency-returns/master/1976-2016-president.csv"
MEDSL_SOURCE = "MIT Election Data and Science Lab, U.S. President 1976-2020 (doi:10.7910/DVN/42MVDX)"
FTE_URL = "https://raw.githubusercontent.com/fivethirtyeight/election-results/main/election_results_presidential.csv"
FTE_SOURCE = "FiveThirtyEight election-results; certified state totals (FEC/states)"

# All of 2000-2024 comes from FiveThirtyEight, not MEDSL. MEDSL's older returns
# sometimes record minor-candidate / spoiled-ballot votes under generic labels
# ("Not Designated", "Other", "Blank Vote/Scattering", empty names) rather than
# naming candidates — which leaked a phantom elector (Ohio 2000). 538 itemizes
# every candidate for 2000-2024, matches MEDSL on the majors, and is more complete
# on third parties. MEDSL is still the only source for 1976-1996.
MEDSL_YEARS = [1976, 1980, 1984, 1988, 1992, 1996]
FTE_YEARS = [2000, 2004, 2008, 2012, 2016, 2020, 2024]

# Identify the two major-party nominees each cycle by SURNAME, not party label.
# This is robust to: state party-label quirks (MN labels its Democrats
# "Democratic-Farmer-Labor"), name-order data errors ("Mitt, Romney"), and
# fusion (a nominee appearing on extra ballot lines) — all of which are merged
# into one canonical candidate. Everyone else is a third party ("O"). The
# surname must be unique to that nominee within the cycle (it is, 1976-2024).
CANONICAL_MAJORS: dict[int, dict[str, tuple[str, str]]] = {
    1976: {"D": ("Jimmy Carter", "carter"), "R": ("Gerald Ford", "ford")},
    1980: {"D": ("Jimmy Carter", "carter"), "R": ("Ronald Reagan", "reagan")},
    1984: {"D": ("Walter Mondale", "mondale"), "R": ("Ronald Reagan", "reagan")},
    1988: {"D": ("Michael Dukakis", "dukakis"), "R": ("George H. W. Bush", "bush")},
    1992: {"D": ("Bill Clinton", "clinton"), "R": ("George H. W. Bush", "bush")},
    1996: {"D": ("Bill Clinton", "clinton"), "R": ("Bob Dole", "dole")},
    2000: {"D": ("Al Gore", "gore"), "R": ("George W. Bush", "bush")},
    2004: {"D": ("John Kerry", "kerry"), "R": ("George W. Bush", "bush")},
    2008: {"D": ("Barack Obama", "obama"), "R": ("John McCain", "mccain")},
    2012: {"D": ("Barack Obama", "obama"), "R": ("Mitt Romney", "romney")},
    2016: {"D": ("Hillary Clinton", "clinton"), "R": ("Donald Trump", "trump")},
    2020: {"D": ("Joe Biden", "biden"), "R": ("Donald Trump", "trump")},
    2024: {"D": ("Kamala Harris", "harris"), "R": ("Donald Trump", "trump")},
}


def classify(year: int, raw_name: str) -> tuple[str, str]:
    """Return (party_class, display_name). D/R use the cycle's canonical name so
    every ballot line / spelling of a nominee merges; third parties keep their
    own (flipped) name."""
    low = raw_name.lower()
    for pc in ("D", "R"):
        disp, surname = CANONICAL_MAJORS[year][pc]
        if surname in low:
            return pc, disp
    return "O", _flip_name(raw_name)

STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois",
    "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
    "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
    "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon",
    "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia",
    "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}
JURISDICTIONS = set(STATE_NAMES)  # 50 states + DC


def _ev_by_cycle() -> dict[int, dict[str, int]]:
    eras = json.loads(EV_PATH.read_text())["eras"]
    out: dict[int, dict[str, int]] = {}
    for era in eras:
        for cyc in era["cycles"]:
            out[cyc] = era["ev"]
    return out


def _fetch_csv(url: str) -> list[dict]:
    r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=60)
    r.raise_for_status()
    return list(csv.DictReader(io.StringIO(r.text)))


def _flip_name(medsl_name: str) -> str:
    """'Reagan, Ronald' -> 'Ronald Reagan'. Drops a quoted nickname token entirely
    ('Clark, Edward ""Ed""' -> 'Edward Clark') rather than inlining it."""
    # Remove ""Nick"" / "Nick" tokens (MEDSL quotes nicknames), then leftover quotes.
    name = re.sub(r'"{1,2}[^"]*"{1,2}', "", medsl_name).replace('"', "")
    name = re.sub(r"\s+", " ", name).strip()
    if "," in name:
        last, first = name.split(",", 1)
        return f"{first.strip()} {last.strip()}".strip()
    return name


_NON_CANDIDATE_PREFIXES = (
    "other", "not designated", "blank", "scatter", "void", "over vote", "under vote",
    "write", "none", "miscell", "unknown", "all other", "no candidate", "n/a", "undervote",
    "overvote",
)


def is_non_candidate(name: str) -> bool:
    """True for source rows that aren't an actual named candidate — empty, or a
    generic/spoiled-ballot bucket ('Other', 'Not Designated', 'Blank Vote/Scattering',
    'Void Vote', 'None of These Candidates', write-in aggregates). Such rows are
    excluded so electoral votes are allocated only among real, named candidates."""
    n = (name or "").strip().lower()
    return (not n) or n.startswith(_NON_CANDIDATE_PREFIXES)


def _to_int(s: str) -> int:
    try:
        return int(float((s or "").strip()))
    except (ValueError, TypeError):
        return 0


# (year, state_po) -> { candidate_name -> {"votes": int, "party": "D"|"R"|"O"} }
def _accumulate(agg: dict, year: int, state: str, cand: str, votes: int, party_class: str) -> None:
    key = (year, state)
    bucket = agg.setdefault(key, {})
    entry = bucket.setdefault(cand, {"votes": 0, "party": "O"})
    entry["votes"] += votes
    # A D/R ballot line fixes the candidate's class; minor lines don't override.
    if party_class in ("D", "R"):
        entry["party"] = party_class


def parse_medsl(rows: list[dict], agg: dict) -> None:
    for row in rows:
        year = _to_int(row.get("year"))
        if year not in MEDSL_YEARS:
            continue
        state = (row.get("state_po") or "").strip().upper()
        if state not in JURISDICTIONS:
            continue
        cand = (row.get("candidate") or "").strip()
        if is_non_candidate(cand):
            continue
        votes = _to_int(row.get("candidatevotes"))
        if votes <= 0:
            continue
        pc, display = classify(year, cand)
        _accumulate(agg, year, state, display, votes, pc)


def parse_fte(rows: list[dict], agg: dict) -> None:
    # 538 occasionally carries exact-duplicate records — e.g. every Alabama 2000
    # candidate appears twice, doubling the state. Drop rows identical on
    # (state, candidate, ballot line, votes). Fusion rows (a candidate on multiple
    # ballot lines, e.g. NY) differ by ballot_party/votes, so they're NOT deduped
    # and still sum correctly.
    seen: set = set()
    for row in rows:
        if row.get("office_name") != "U.S. President" or row.get("stage") != "general":
            continue
        year = _to_int(row.get("cycle"))
        if year not in FTE_YEARS:
            continue
        state = (row.get("state_abbrev") or "").strip().upper()
        if state not in JURISDICTIONS:
            continue
        # Include normal rows and RCV round-1 rows (Maine 2020); skip later rounds.
        rnd = (row.get("ranked_choice_round") or "").strip()
        if rnd not in ("", "1"):
            continue
        cand = (row.get("candidate_name") or "").strip()
        if is_non_candidate(cand):
            continue
        votes = _to_int(row.get("votes"))
        if votes <= 0:
            continue
        key = (year, state, row.get("candidate_id"), (row.get("ballot_party") or ""), row.get("votes"))
        if key in seen:
            continue
        seen.add(key)
        pc, display = classify(year, cand)
        _accumulate(agg, year, state, display, votes, pc)


def main() -> None:
    ev_by_cycle = _ev_by_cycle()
    agg: dict = {}

    print(f"Fetching MEDSL 1976-1996 …")
    parse_medsl(_fetch_csv(MEDSL_URL), agg)
    print(f"Fetching FiveThirtyEight 2020/2024 …")
    parse_fte(_fetch_csv(FTE_URL), agg)

    years = MEDSL_YEARS + FTE_YEARS
    for year in years:
        ev_map = ev_by_cycle[year]
        states_out = []
        for code in sorted(JURISDICTIONS):
            cands = agg.get((year, code), {})
            if not cands:
                raise SystemExit(f"No candidates parsed for {year} {code} — source gap.")
            candidates = [
                {"name": name, "party": d["party"], "votes": d["votes"]}
                for name, d in sorted(cands.items(), key=lambda kv: -kv[1]["votes"])
            ]
            states_out.append({
                "code": code,
                "name": STATE_NAMES[code],
                "ev": ev_map[code],
                "total_votes": sum(c["votes"] for c in candidates),
                "candidates": candidates,
            })
        source = MEDSL_SOURCE if year in MEDSL_YEARS else FTE_SOURCE
        payload = {
            "meta": {
                "year": year,
                "source": source,
                "total_ev": sum(s["ev"] for s in states_out),
                "n_states": len(states_out),
            },
            "states": states_out,
        }
        out_path = BASELINE_DIR / f"president_{year}.json"
        out_path.write_text(json.dumps(payload, indent=2))
        # Quick eyeball: national top-3 by votes.
        natl: dict[str, int] = defaultdict(int)
        for s in states_out:
            for c in s["candidates"]:
                natl[c["name"]] += c["votes"]
        top = sorted(natl.items(), key=lambda kv: -kv[1])[:3]
        top_str = ", ".join(f"{n} {v:,}" for n, v in top)
        print(f"  {year}: {len(states_out)} states, {sum(natl.values()):,} votes | {top_str}")


if __name__ == "__main__":
    main()
