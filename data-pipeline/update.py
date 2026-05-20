"""End-to-end pipeline.

Reads (or refreshes) the 2024 House baseline, fetches live generic-ballot polls,
computes swing, applies it to each state under the methodology in PROJECT_PLAN
section 2, allocates seats via Sainte-Laguë, and writes the JSON files the
frontend consumes.

Outputs:
- public/data/projection.json   (current projection)
- public/data/baseline_2024.json (frozen 2024 retrospective input)
- public/data/polling_trend.json (last 180 days of polls for the trend chart)
- public/data/meta.json          (timestamp, generic ballot, polls included)

Run:
    python data-pipeline/update.py             # uses cached baseline + polls
    python data-pipeline/update.py --refresh   # re-downloads Clerk PDF
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

from allocation import AllocationInput, allocate
from fetch_clerk_house import (
    PDF_URL as CLERK_PDF_URL,
    OUT_PATH as BASELINE_JSON,
    main as fetch_clerk_main,
)
from fetch_polls import (
    SILVER_BULLETIN_CSV_URL,
    SILVER_BULLETIN_LANDING_URL,
    fetch_csv,
    parse_polls,
    weighted_average,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DATA = REPO_ROOT / "public" / "data"
PROJECTION_PATH = PUBLIC_DATA / "projection.json"
BASELINE_OUT_PATH = PUBLIC_DATA / "baseline_2024.json"
POLLING_TREND_PATH = PUBLIC_DATA / "polling_trend.json"
META_PATH = PUBLIC_DATA / "meta.json"

# How far back to include polls in the trend chart (the on-page sparkline).
TREND_WINDOW_DAYS = 180


def clamp(x: float, lo: float = 0.001, hi: float = 0.999) -> float:
    return max(lo, min(hi, x))


def apply_uniform_swing(d_share: float, r_share: float, swing_points: float) -> tuple[float, float]:
    """Uniform swing in margin points. Shifts each party's share by swing/2 points
    (since a margin shift of N points = N/2 points shift per party's share).
    """
    d = clamp(d_share + (swing_points / 2 / 100))
    r = clamp(r_share - (swing_points / 2 / 100))
    # Renormalize so D+R sums to 1 (the clamp can introduce tiny drift at extremes).
    s = d + r
    return d / s, r / s


def project_states(baseline_states: list[dict], swing_points: float, method: str = "sainte-lague") -> list[dict]:
    out = []
    for s in baseline_states:
        seats = s["seats"]
        baseline_d = s["two_party_share_2024"]["d_share"]
        baseline_r = s["two_party_share_2024"]["r_share"]
        if s.get("baseline_distortion_warning"):
            # When a state has one party absent from the 2024 House baseline (e.g.,
            # Vermont with no R candidate), the share is meaningless for projecting
            # 2026. Treat the projected share as the swing applied to a neutral
            # 50/50, NOT to the distorted baseline. The flag stays on so the UI
            # warns the user.
            proj_d, proj_r = apply_uniform_swing(0.5, 0.5, swing_points)
        else:
            proj_d, proj_r = apply_uniform_swing(baseline_d, baseline_r, swing_points)
        result = allocate(
            AllocationInput(
                seats=seats,
                d_votes=proj_d * 1_000_000,
                r_votes=proj_r * 1_000_000,
            ),
            method=method,
        )
        out.append({
            "fips": s["fips"],
            "code": s["code"],
            "name": s["name"],
            "seats": seats,
            "actual": {
                "d_seats": s["actual_d_seats_119th"],
                "r_seats": s["actual_r_seats_119th"],
            },
            "baseline_2024": {
                "d_share": round(baseline_d, 4),
                "r_share": round(baseline_r, 4),
            },
            "projected": {
                "d_share": round(proj_d, 4),
                "r_share": round(proj_r, 4),
                "d_seats": result.d_seats,
                "r_seats": result.r_seats,
            },
            "baseline_distortion_warning": s.get("baseline_distortion_warning", False),
            "imputed_district_count": s.get("imputed_district_count", 0),
            "imputed_district_ids": s.get("imputed_district_ids", []),
        })
    return out


def retrospective_states(baseline_states: list[dict], method: str = "sainte-lague") -> list[dict]:
    """The 2024 Retrospective: apply Sainte-Laguë directly to the 2024 baseline,
    no swing. Shows the pure distortion of the current system.
    """
    out = []
    for s in baseline_states:
        seats = s["seats"]
        d = s["two_party_share_2024"]["d_share"]
        r = s["two_party_share_2024"]["r_share"]
        d = clamp(d); r = clamp(r)
        norm = d + r
        d /= norm; r /= norm
        if s.get("baseline_distortion_warning"):
            # Same caveat: if no R candidate existed statewide in 2024, the share
            # isn't meaningful. Treat as 50/50 for the retrospective so the seat
            # split reflects "what if there had been a contested race."
            d = r = 0.5
        result = allocate(
            AllocationInput(seats=seats, d_votes=d * 1_000_000, r_votes=r * 1_000_000),
            method=method,
        )
        out.append({
            "fips": s["fips"],
            "code": s["code"],
            "name": s["name"],
            "seats": seats,
            "actual": {
                "d_seats": s["actual_d_seats_119th"],
                "r_seats": s["actual_r_seats_119th"],
            },
            "baseline_2024": {"d_share": round(d, 4), "r_share": round(r, 4)},
            "projected_pr": {"d_seats": result.d_seats, "r_seats": result.r_seats},
            "baseline_distortion_warning": s.get("baseline_distortion_warning", False),
            "imputed_district_count": s.get("imputed_district_count", 0),
            "imputed_district_ids": s.get("imputed_district_ids", []),
        })
    return out


def build_polling_trend(polls: list, as_of: datetime) -> list[dict]:
    cutoff = as_of - timedelta(days=TREND_WINDOW_DAYS)
    out = []
    for p in polls:
        if p.midpoint < cutoff:
            continue
        net = p.adjusted_net if p.adjusted_net is not None else p.raw_net
        out.append({
            "date": p.midpoint.date().isoformat(),
            "pollster": p.pollster,
            "margin": round(net, 2),
            "sample_size": p.sample_size,
            "population": p.population,
            "url": p.url,
        })
    out.sort(key=lambda r: r["date"])
    return out


def main(refresh_clerk: bool = False) -> None:
    # 1. Baseline.
    if refresh_clerk or not BASELINE_JSON.exists():
        fetch_clerk_main(force_download=refresh_clerk)
    with BASELINE_JSON.open() as f:
        baseline = json.load(f)
    baseline_states = baseline["states"]
    baseline_margin = baseline["meta"]["national_house_popular_vote"]["r_margin_points"]
    baseline_d_margin = -baseline_margin  # D's margin (negative if R-leaning)

    # 2. Polls.
    csv_text = fetch_csv()
    polls = parse_polls(csv_text)
    now = datetime.now(timezone.utc)
    avg = weighted_average(polls, as_of=now)
    generic_ballot = avg["margin"]  # positive = D advantage in margin points

    # 3. Swing.
    swing = generic_ballot - baseline_d_margin
    print(
        f"Baseline 2024 D margin: {baseline_d_margin:+.2f} points "
        f"(R+{abs(baseline_d_margin):.2f}). "
        f"Generic ballot: {'D+' if generic_ballot >= 0 else 'R+'}{abs(generic_ballot):.2f}. "
        f"Swing: {'+' if swing >= 0 else ''}{swing:.2f} points toward D."
    )

    # 4. Project.
    projected = project_states(baseline_states, swing)
    nat_proj_d = sum(s["projected"]["d_seats"] for s in projected)
    nat_proj_r = sum(s["projected"]["r_seats"] for s in projected)
    nat_actual_d = sum(s["actual"]["d_seats"] for s in projected)
    nat_actual_r = sum(s["actual"]["r_seats"] for s in projected)

    retrospective = retrospective_states(baseline_states)
    nat_retro_d = sum(s["projected_pr"]["d_seats"] for s in retrospective)
    nat_retro_r = sum(s["projected_pr"]["r_seats"] for s in retrospective)

    # 5. Write outputs.
    PUBLIC_DATA.mkdir(parents=True, exist_ok=True)

    projection_payload = {
        "meta": {
            "generated_at": now.isoformat(),
            "data_source": "U.S. House Clerk 2024 statistics (state totals) + Silver Bulletin generic-ballot polls",
            "method": "sainte-lague",
            "generic_ballot_margin": generic_ballot,
            "baseline_2024_margin": -baseline_margin,  # D's margin
            "baseline_2024_r_margin": baseline_margin,  # R's margin (positive)
            "swing": round(swing, 2),
            "n_polls_in_average": avg["n_polls"],
            "poll_window_days": avg["window_days"],
            "poll_half_life_days": avg["half_life_days"],
        },
        "national": {
            "seats": sum(s["seats"] for s in projected),
            "projected": {"d_seats": nat_proj_d, "r_seats": nat_proj_r},
            "actual": {"d_seats": nat_actual_d, "r_seats": nat_actual_r},
        },
        "states": projected,
    }
    PROJECTION_PATH.write_text(json.dumps(projection_payload, indent=2))

    baseline_payload = {
        "meta": {
            "generated_at": now.isoformat(),
            "baseline_source": baseline["meta"]["source"],
            "baseline_source_url": baseline["meta"]["source_url"],
            "method": "sainte-lague",
        },
        "national": {
            "seats": sum(s["seats"] for s in retrospective),
            "projected_pr": {"d_seats": nat_retro_d, "r_seats": nat_retro_r},
            "actual": {"d_seats": nat_actual_d, "r_seats": nat_actual_r},
        },
        "states": retrospective,
    }
    BASELINE_OUT_PATH.write_text(json.dumps(baseline_payload, indent=2))

    trend = build_polling_trend(polls, as_of=now)
    POLLING_TREND_PATH.write_text(json.dumps({
        "meta": {
            "generated_at": now.isoformat(),
            "source": SILVER_BULLETIN_LANDING_URL,
            "csv_url": SILVER_BULLETIN_CSV_URL,
            "window_days": TREND_WINDOW_DAYS,
            "n_polls": len(trend),
            "uses_house_effect_adjustment": True,
        },
        "polls": trend,
    }, indent=2))

    meta_payload = {
        "generated_at": now.isoformat(),
        "stale_after_hours": 48,
        "sources": {
            "baseline": baseline["meta"]["source_url"],
            "polls": SILVER_BULLETIN_LANDING_URL,
        },
        "generic_ballot": {
            "margin": generic_ballot,
            "n_polls": avg["n_polls"],
            "window_days": avg["window_days"],
            "half_life_days": avg["half_life_days"],
            "uses_house_effect_adjustment": True,
        },
        "baseline_2024_r_margin": baseline_margin,
        "swing": round(swing, 2),
        "national": projection_payload["national"],
        "retrospective_national": baseline_payload["national"],
    }
    META_PATH.write_text(json.dumps(meta_payload, indent=2))

    # Sanity-check: print the plan's Phase 2 "done when" criteria.
    proj_gain_d = nat_proj_d - nat_actual_d
    retro_gain_d = nat_retro_d - nat_actual_d
    print()
    print(f"Projection:    D {nat_proj_d:>3} / R {nat_proj_r:>3}  (vs actual {nat_actual_d}/{nat_actual_r}, D gain {proj_gain_d:+d})")
    print(f"Retrospective: D {nat_retro_d:>3} / R {nat_retro_r:>3}  (D gain {retro_gain_d:+d})")
    print()
    print("Phase 2 'done when' check:")
    # Plan updated after first real-data run: expect +10 to +15 D under D+~6
    # generic ballot. Anything outside ±5 of that warrants a look.
    if 5 <= proj_gain_d <= 20:
        print(f"  ✓ Projected D gain {proj_gain_d:+d} is in plan's expected +10 to +15 range (or close).")
    else:
        print(f"  ⚠ Projected D gain {proj_gain_d:+d} is outside the plan's expected +10 to +15 range. Check inputs.")
    if abs(retro_gain_d) <= 15:
        print(f"  ✓ Retrospective net swing {retro_gain_d:+d} is small (single/low double digits).")
    else:
        print(f"  ⚠ Retrospective net swing {retro_gain_d:+d} is larger than expected (>15). Math may be off.")


if __name__ == "__main__":
    main(refresh_clerk="--refresh" in sys.argv)
