"""Assemble public/data/retrospectives.json — the PR-vs-actual retrospective for
each of the most recent completed House cycles (rolling window).

For each cycle we run the same Sainte-Laguë allocation the 2024 retrospective
uses (apply PR to the reported statewide two-party share, per state, vs the
actual seats won). 2024 reads the Clerk baseline (house_2024.json, legacy keys);
2016–2022 read the MIT-derived house_{year}.json. Only cycles whose baseline
file exists are included, so this is safe to run before/after the one-time MIT
distillation (fetch_mit_house.py).

Reads:  data-pipeline/baseline/house_{year}.json
Writes: public/data/retrospectives.json

Called from update.py (offline — no network), and runnable standalone:
    python data-pipeline/build_retrospectives.py
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from allocation import AllocationInput, allocate

REPO_ROOT = Path(__file__).resolve().parent.parent
BASELINE_DIR = REPO_ROOT / "data-pipeline" / "baseline"
OUT_PATH = REPO_ROOT / "public" / "data" / "retrospectives.json"

# The rolling window: the 5 most recent completed cycles. Adding 2026 later =
# append it here (2016 falls off the front) and re-run.
RETRO_CYCLES = [2016, 2018, 2020, 2022, 2024]

SOURCES = {
    "2024": "U.S. House Clerk, Statistics of the Congressional Election of 2024",
    "prior": "MIT Election Data and Science Lab, U.S. House 1976–2024 (doi:10.7910/DVN/IG0UN2)",
}


def _share(s: dict) -> tuple[float, float]:
    sh = s.get("two_party_share") or s.get("two_party_share_2024")
    return float(sh["d_share"]), float(sh["r_share"])


def _actual(s: dict) -> tuple[int, int]:
    d = s.get("actual_d_seats", s.get("actual_d_seats_119th"))
    r = s.get("actual_r_seats", s.get("actual_r_seats_119th"))
    return int(d), int(r)


def _national_d_margin(meta: dict) -> float | None:
    pv = meta.get("national_house_popular_vote")
    if not pv:
        return None
    if "d_margin_points" in pv:
        return round(float(pv["d_margin_points"]), 2)
    if "r_margin_points" in pv:
        return round(-float(pv["r_margin_points"]), 2)
    return None


def build_cycle(baseline: dict) -> dict:
    states_out = []
    for s in baseline["states"]:
        seats = int(s["seats"])
        d_share, r_share = _share(s)
        # NOTE: we deliberately do NOT impute a 50/50 share for states flagged
        # baseline_distortion_warning (one major party fielded no statewide
        # candidate). This is a *retrospective* of the actual votes — if no
        # Democrat ran, proportional allocation of the real vote keeps the seat
        # Republican (no distortion to show). A 50/50 counterfactual would, on a
        # single-seat state, hand the lone seat to the missing party (e.g. it
        # gave North Dakota 2022 a phantom Democratic seat). The warning flag is
        # still emitted for the per-state note.
        norm = d_share + r_share
        if norm:
            d_share, r_share = d_share / norm, r_share / norm
        res = allocate(
            AllocationInput(seats=seats, d_votes=d_share * 1_000_000, r_votes=r_share * 1_000_000),
            method="sainte-lague",
        )
        ad, ar = _actual(s)
        states_out.append({
            "fips": s["fips"],
            "code": s["code"],
            "name": s["name"],
            "seats": seats,
            "actual": {"d_seats": ad, "r_seats": ar},
            "projected_pr": {"d_seats": res.d_seats, "r_seats": res.r_seats},
            "two_party_share": {"d_share": round(d_share, 4), "r_share": round(r_share, 4)},
            "baseline_distortion_warning": bool(s.get("baseline_distortion_warning", False)),
            "uncontested_district_count": int(
                s.get("uncontested_district_count", s.get("imputed_district_count", 0))
            ),
        })

    nat = {
        "seats": sum(s["seats"] for s in states_out),
        "projected_pr": {
            "d_seats": sum(s["projected_pr"]["d_seats"] for s in states_out),
            "r_seats": sum(s["projected_pr"]["r_seats"] for s in states_out),
        },
        "actual": {
            "d_seats": sum(s["actual"]["d_seats"] for s in states_out),
            "r_seats": sum(s["actual"]["r_seats"] for s in states_out),
        },
        "popular_vote_d_margin": _national_d_margin(baseline.get("meta", {})),
    }
    return {"national": nat, "states": states_out}


def main() -> None:
    now = datetime.now(timezone.utc)
    cycles: dict[str, dict] = {}
    series: list[dict] = []
    available: list[int] = []

    for year in RETRO_CYCLES:
        path = BASELINE_DIR / f"house_{year}.json"
        if not path.exists():
            print(f"  (skip) {path.relative_to(REPO_ROOT)} not found — cycle {year} omitted")
            continue
        baseline = json.loads(path.read_text())
        cyc = build_cycle(baseline)
        cycles[str(year)] = cyc
        available.append(year)
        n = cyc["national"]
        series.append({
            "year": year,
            "seats": n["seats"],
            "actual": n["actual"],
            "projected_pr": n["projected_pr"],
            "d_gain": n["projected_pr"]["d_seats"] - n["actual"]["d_seats"],
        })

    series.sort(key=lambda r: r["year"])
    payload = {
        "meta": {
            "generated_at": now.isoformat(),
            "cycles": available,
            "method": "sainte-lague",
            "sources": SOURCES,
        },
        "cycles": cycles,
        "series": series,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, indent=2))

    print(f"Wrote {OUT_PATH.relative_to(REPO_ROOT)} ({len(available)} cycles).")
    for r in series:
        d_gain = r["d_gain"]
        toward = "toward D" if d_gain > 0 else ("toward R" if d_gain < 0 else "even")
        print(
            f"  {r['year']}: PR D {r['projected_pr']['d_seats']}/R {r['projected_pr']['r_seats']}"
            f"  vs actual D {r['actual']['d_seats']}/R {r['actual']['r_seats']}"
            f"  → {d_gain:+d} {toward}"
        )


if __name__ == "__main__":
    main()
