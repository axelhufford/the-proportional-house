"""Assemble public/data/senate.json — the Senate malapportionment view.

The Senate gives every state 2 senators regardless of population, so its
distortion is malapportionment (not winner-take-all). For each state we compute
people-per-senator and a representation index (how many times the national
average a voter's Senate representation is worth), plus the headline finding:
how few people, packed into the smallest states, can elect a 51-seat majority.

Reads:  data-pipeline/baseline/state_populations.json (2020 Census, committed)
Writes: public/data/senate.json

Offline (no network). Run:  python data-pipeline/build_senate.py
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from io_utils import write_json_atomic

REPO_ROOT = Path(__file__).resolve().parent.parent
POP_PATH = REPO_ROOT / "data-pipeline" / "baseline" / "state_populations.json"
OUT_PATH = REPO_ROOT / "public" / "data" / "senate.json"

SENATORS_PER_STATE = 2
TOTAL_SENATORS = 100
MAJORITY = 51


def main() -> None:
    pop = json.loads(POP_PATH.read_text())
    in_states = pop["states"]
    total_pop = sum(s["population"] for s in in_states)
    # National average: one senator per this many people.
    national_people_per_senator = total_pop / TOTAL_SENATORS

    states = []
    for s in in_states:
        p = s["population"]
        people_per_senator = p / SENATORS_PER_STATE
        # >1 = a voter here has more than the national-average Senate weight.
        representation_index = national_people_per_senator / people_per_senator
        states.append({
            "fips": s["fips"],
            "code": s["code"],
            "name": s["name"],
            "population": p,
            "senators": SENATORS_PER_STATE,
            "people_per_senator": round(people_per_senator),
            "representation_index": round(representation_index, 3),
        })

    # Smallest-states-to-a-majority: add states cheapest-first until the
    # cumulative senators reach 51 (lands on 26 states / 52 senators).
    by_pop = sorted(states, key=lambda s: s["population"])
    cum_senators = 0
    cum_pop = 0
    majority_states = []
    for s in by_pop:
        cum_senators += s["senators"]
        cum_pop += s["population"]
        majority_states.append(s["code"])
        if cum_senators >= MAJORITY:
            break
    majority = {
        "states_needed": len(majority_states),
        "senators": cum_senators,
        "population": cum_pop,
        "population_share": round(cum_pop / total_pop, 4),
        "state_codes": majority_states,
    }

    sm = min(states, key=lambda s: s["population"])
    lg = max(states, key=lambda s: s["population"])

    payload = {
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "source": pop["meta"]["source"],
            "source_url": pop["meta"].get("source_url"),
            "census_year": pop["meta"].get("census_year", 2020),
            "total_population": total_pop,
            "total_senators": TOTAL_SENATORS,
            "national_people_per_senator": round(national_people_per_senator),
            "most_overrepresented": sm["code"],
            "most_underrepresented": lg["code"],
            "ratio_extremes": round(lg["population"] / sm["population"], 1),
        },
        "states": states,
        "majority": majority,
    }
    write_json_atomic(OUT_PATH, payload)

    print(f"Wrote {OUT_PATH.relative_to(REPO_ROOT)} ({len(states)} states)")
    print(
        f"  national avg: 1 senator per {round(national_people_per_senator):,} people | "
        f"{sm['name']} {sm['representation_index']}x  vs  {lg['name']} {lg['representation_index']}x"
    )
    print(
        f"  Senate majority from the {majority['states_needed']} smallest states "
        f"({majority['senators']} senators) = {majority['population_share']*100:.1f}% of the population"
    )


if __name__ == "__main__":
    main()
