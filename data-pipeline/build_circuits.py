"""Assemble public/data/circuits.json — the federal Courts of Appeals by population
and authorized judgeships, plus one illustrative population-balanced redraw.

The geographic circuits are wildly unequal: the 9th serves ~67M people, the 1st
~14M. This computes, for both today's circuits and a hand-drawn rebalanced map,
each circuit's population, judges, and people-per-judge. In the rebalanced map
the geographic judgeships (156 = the statutory total minus the D.C. Circuit's 11)
are reallocated proportional to population via Hamilton (allocate_n), so the
workload-per-judge evens out. The D.C. Circuit is kept fixed — its docket is
federal-government cases, not population.

Reads:  data-pipeline/baseline/circuit_definitions.json, state_populations.json
Writes: public/data/circuits.json   (offline — no network)
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from allocation import AllocationInputN, allocate_n

REPO_ROOT = Path(__file__).resolve().parent.parent
BASELINE = REPO_ROOT / "data-pipeline" / "baseline"
DEFS_PATH = BASELINE / "circuit_definitions.json"
POP_PATH = BASELINE / "state_populations.json"
OUT_PATH = REPO_ROOT / "public" / "data" / "circuits.json"


def _pop_lookup(defs: dict) -> dict[str, int]:
    pops = {s["code"]: s["population"] for s in json.loads(POP_PATH.read_text())["states"]}
    pops.update(defs["meta"]["extra_populations"])  # DC, PR
    return pops


def _circuit_rows(group: dict, pops: dict, judges_by_id: dict[str, int]) -> list[dict]:
    rows = []
    for cid, c in group.items():
        population = sum(pops[code] for code in c["states"])
        judges = judges_by_id.get(cid, 0)
        rows.append({
            "id": cid,
            "label": c["label"],
            "states": c["states"],
            "population": population,
            "judges": judges,
            "people_per_judge": round(population / judges) if judges else None,
        })
    return rows


def _disparity(rows: list[dict], exclude_ids: set[str]) -> dict:
    geo = [r for r in rows if r["id"] not in exclude_ids]
    pops = [r["population"] for r in geo]
    hi = max(geo, key=lambda r: r["population"])
    lo = min(geo, key=lambda r: r["population"])
    return {
        "max": {"label": hi["label"], "population": hi["population"]},
        "min": {"label": lo["label"], "population": lo["population"]},
        "ratio": round(hi["population"] / lo["population"], 1),
    }


def main() -> None:
    defs = json.loads(DEFS_PATH.read_text())
    pops = _pop_lookup(defs)
    judgeships = defs["judgeships"]
    total_geo_judges = sum(v for k, v in judgeships.items() if k != "DC")  # 156

    # --- Current ---
    current = _circuit_rows(defs["current"], pops, judgeships)
    current_by_state = {code: cid for cid, c in defs["current"].items() for code in c["states"]}

    # --- Rebalanced: reallocate the 156 geographic judges by population (Hamilton);
    # the D.C. Circuit keeps its 11. ---
    reb_def = defs["rebalanced"]
    geo_ids = [cid for cid, c in reb_def.items() if not c.get("fixed")]
    geo_pops = [sum(pops[code] for code in reb_def[cid]["states"]) for cid in geo_ids]
    geo_judges = allocate_n(AllocationInputN(seats=total_geo_judges, votes=geo_pops), "hamilton")
    reb_judges_by_id = {"dc": judgeships["DC"], **{cid: j for cid, j in zip(geo_ids, geo_judges)}}
    rebalanced = _circuit_rows(reb_def, pops, reb_judges_by_id)
    rebalanced_by_state = {code: cid for cid, c in reb_def.items() for code in c["states"]}

    total_population = sum(r["population"] for r in current)  # all jurisdictions incl DC/PR

    payload = {
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "judgeships_source": defs["meta"]["judgeships_source"],
            "composition_source": defs["meta"]["composition_source"],
            "population_source": defs["meta"]["population_source"],
            "total_population": total_population,
            "total_judges": sum(judgeships.values()),
            "note": (
                "Federal Circuit (non-geographic) excluded; territories other than Puerto Rico omitted. "
                "The rebalanced map is one illustrative redraw, not a proposal; real circuit design weighs "
                "caseload, geography, and history, not just population."
            ),
        },
        "current": {
            "circuits": current,
            "by_state": current_by_state,
            "disparity": _disparity(current, exclude_ids={"DC"}),
        },
        "rebalanced": {
            "circuits": rebalanced,
            "by_state": rebalanced_by_state,
            "disparity": _disparity(rebalanced, exclude_ids={"dc"}),
        },
    }
    OUT_PATH.write_text(json.dumps(payload, indent=2))

    print(f"Wrote {OUT_PATH.relative_to(REPO_ROOT)}")
    cd = payload["current"]["disparity"]
    rd = payload["rebalanced"]["disparity"]
    print(f"  current:    {cd['max']['label']} {cd['max']['population']:,} vs {cd['min']['label']} {cd['min']['population']:,}  ({cd['ratio']}x)")
    print(f"  rebalanced: {rd['max']['label']} {rd['max']['population']:,} vs {rd['min']['label']} {rd['min']['population']:,}  ({rd['ratio']}x)")


if __name__ == "__main__":
    main()
