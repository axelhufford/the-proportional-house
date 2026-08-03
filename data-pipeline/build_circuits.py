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
from io_utils import write_json_atomic

REPO_ROOT = Path(__file__).resolve().parent.parent
BASELINE = REPO_ROOT / "data-pipeline" / "baseline"
DEFS_PATH = BASELINE / "circuit_definitions.json"
POP_PATH = BASELINE / "state_populations.json"
OUT_PATH = REPO_ROOT / "public" / "data" / "circuits.json"


def _pop_lookup(defs: dict) -> dict[str, int]:
    pops = {s["code"]: s["population"] for s in json.loads(POP_PATH.read_text())["states"]}
    pops.update(defs["meta"]["extra_populations"])  # DC, PR
    return pops


def _circuit_rows(group: dict, pops: dict, active_by_id: dict[str, int], senior_by_id: dict[str, int]) -> list[dict]:
    rows = []
    for cid, c in group.items():
        rows.append({
            "id": cid,
            "label": c["label"],
            "states": c["states"],
            "population": sum(pops[code] for code in c["states"]),
            "active_judges": active_by_id.get(cid, 0),
            "senior_judges": senior_by_id.get(cid, 0),
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
    judgeships = defs["judgeships"]  # §44 authorized active judgeships
    senior = json.loads((BASELINE / "senior_judges.json").read_text())
    seniors = senior["senior_judges"]  # current senior judges per circuit (FJC)

    total_geo_active = sum(v for k, v in judgeships.items() if k != "DC")  # 156
    total_geo_seniors = sum(v for k, v in seniors.items() if k != "DC")    # 108 (DC seniors stay with DC)

    # --- Current: §44 active + FJC senior counts ---
    current = _circuit_rows(defs["current"], pops, judgeships, seniors)
    current_by_state = {code: cid for cid, c in defs["current"].items() for code in c["states"]}

    # --- Rebalanced: reallocate BOTH the 156 geographic active judges and the 108
    # geographic senior judges across the new circuits by population (Hamilton); the
    # D.C. Circuit keeps its real 11 active + 5 senior. ---
    reb_def = defs["rebalanced"]
    geo_ids = [cid for cid, c in reb_def.items() if not c.get("fixed")]
    geo_pops = [sum(pops[code] for code in reb_def[cid]["states"]) for cid in geo_ids]
    geo_active = allocate_n(AllocationInputN(seats=total_geo_active, votes=geo_pops), "hamilton")
    geo_senior = allocate_n(AllocationInputN(seats=total_geo_seniors, votes=geo_pops), "hamilton")
    reb_active = {"dc": judgeships["DC"], **dict(zip(geo_ids, geo_active))}
    reb_senior = {"dc": seniors["DC"], **dict(zip(geo_ids, geo_senior))}
    rebalanced = _circuit_rows(reb_def, pops, reb_active, reb_senior)
    rebalanced_by_state = {code: cid for cid, c in reb_def.items() for code in c["states"]}

    total_population = sum(r["population"] for r in current)  # all jurisdictions incl DC/PR

    payload = {
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "judgeships_source": defs["meta"]["judgeships_source"],
            "composition_source": defs["meta"]["composition_source"],
            "population_source": defs["meta"]["population_source"],
            "senior_judges_source": senior["meta"]["source"],
            "senior_judges_as_of": senior["meta"]["as_of"],
            "total_population": total_population,
            "total_active_judges": sum(judgeships.values()),
            "total_senior_judges": sum(seniors.values()),
            "note": (
                "Federal Circuit (non-geographic) excluded; territories other than Puerto Rico omitted. "
                "Senior judges hear cases with reduced caseloads, so a people-per-judge that counts them is "
                "an optimistic floor. The rebalanced map is one illustrative redraw, not a proposal; real "
                "circuit design weighs caseload, geography, and history, not just population."
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
    write_json_atomic(OUT_PATH, payload)

    print(f"Wrote {OUT_PATH.relative_to(REPO_ROOT)}")
    cd = payload["current"]["disparity"]
    print(f"  population gap: current {cd['ratio']}x | rebalanced {payload['rebalanced']['disparity']['ratio']}x")
    ninth = next(r for r in current if r["id"] == "9")
    ppj_a = ninth["population"] // ninth["active_judges"]
    ppj_s = ninth["population"] // (ninth["active_judges"] + ninth["senior_judges"])
    print(f"  9th Circuit: {ninth['active_judges']} active + {ninth['senior_judges']} senior → {ppj_a:,}/judge active, {ppj_s:,}/judge with seniors")


if __name__ == "__main__":
    main()
