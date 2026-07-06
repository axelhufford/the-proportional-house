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
import math
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
POLLING_ERROR_PATH = REPO_ROOT / "data-pipeline" / "baseline" / "polling_error.json"

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
        elasticity = float(s.get("state_elasticity", 1.0))
        state_swing = swing_points * elasticity
        if s.get("baseline_distortion_warning"):
            # When a state has one party absent from the 2024 House baseline
            # (and we haven't imputed via pres-by-CD), the share is meaningless
            # for projecting 2026. Treat the projected share as the swing
            # applied to a neutral 50/50, NOT to the distorted baseline. The
            # flag stays on so the UI warns the user.
            proj_d, proj_r = apply_uniform_swing(0.5, 0.5, state_swing)
        else:
            proj_d, proj_r = apply_uniform_swing(baseline_d, baseline_r, state_swing)
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
            "state_elasticity": round(elasticity, 3),
            "state_swing_applied": round(state_swing, 3),
            "baseline_distortion_warning": s.get("baseline_distortion_warning", False),
            "imputed_district_count": s.get("imputed_district_count", 0),
            "imputed_district_ids": s.get("imputed_district_ids", []),
        })
    return out


def load_polling_error() -> dict | None:
    """Load the curated historical polling-error table, or None if unusable.

    The sensitivity band is emitted ONLY when every cycle row is verified
    against its named source and meta.epsilon_points is set. An unverified
    skeleton (nulls, verified:false) can therefore be committed without the
    pipeline shipping any band — the no-fabrication gate.
    """
    if not POLLING_ERROR_PATH.exists():
        return None
    with POLLING_ERROR_PATH.open() as f:
        table = json.load(f)
    eps = table.get("meta", {}).get("epsilon_points")
    if eps is None or not eps > 0:
        return None
    cycles = table.get("cycles", [])
    if not cycles or not all(c.get("verified") is True for c in cycles):
        return None
    return table


def compute_seat_band(
    baseline_states: list[dict], swing_points: float, epsilon: float,
    method: str = "sainte-lague",
) -> dict:
    """National seat range if the ballot margin missed by ±epsilon points.

    Re-runs the site's own model (elasticity, imputation, Sainte-Laguë — the
    same project_states the point projection uses) at swing ∓ ε. A pure
    sensitivity band: no probabilistic claim, just the model evaluated at the
    edges of the historical polling miss.
    """
    lo = project_states(baseline_states, swing_points - epsilon, method)
    hi = project_states(baseline_states, swing_points + epsilon, method)
    d_lo = sum(s["projected"]["d_seats"] for s in lo)
    d_hi = sum(s["projected"]["d_seats"] for s in hi)
    # More swing toward D should mean more D seats, but order defensively.
    d_low, d_high = min(d_lo, d_hi), max(d_lo, d_hi)
    total = sum(s["seats"] for s in baseline_states)
    return {
        "d_seats_low": d_low,
        "d_seats_high": d_high,
        "r_seats_low": total - d_high,
        "r_seats_high": total - d_low,
    }


def _national_d_seats(baseline_states: list[dict], swing_points: float, method: str = "sainte-lague") -> int:
    """Projected national D seats at a given swing — the bisection predicate."""
    return sum(s["projected"]["d_seats"] for s in project_states(baseline_states, swing_points, method))


def compute_majority_tipping(
    baseline_states: list[dict], baseline_d_margin: float,
    method: str = "sainte-lague", majority_seats: int = 218,
    margin_range: tuple[float, float] = (-20.0, 20.0), tol: float = 0.01,
) -> float | None:
    """Generic-ballot D-margin at which projected D seats first reach a majority.

    D seats are weakly nondecreasing in the margin (Sainte-Laguë quotients
    rise with share; the clamp saturates but never reverses; ties are
    deterministic), so bisect the predicate. Returns None if the crossing
    falls outside margin_range (defensive — the field is then omitted).
    """
    lo, hi = margin_range

    def has_majority(margin: float) -> bool:
        return _national_d_seats(baseline_states, margin - baseline_d_margin, method) >= majority_seats

    if has_majority(lo) or not has_majority(hi):
        return None
    while hi - lo > tol:
        mid = (lo + hi) / 2
        if has_majority(mid):
            hi = mid
        else:
            lo = mid
    return round(hi, 1)


def compute_closest_flips(
    baseline_states: list[dict], swing_points: float, current_margin: float,
    method: str = "sainte-lague", max_delta: float = 15.0,
    per_direction: int = 3, tol: float = 0.01,
) -> list[dict]:
    """The seats nearest to flipping as the national margin moves either way.

    Per state and direction, bisects the smallest national-margin movement
    that changes the state's projected D seats — one-state project_states
    calls, so elasticity, imputation, and the allocator are exactly the
    shipped model. margin_delta is ceil-rounded to 0.1 so the displayed
    "needs +0.4 pts" is always sufficient to flip the seat.
    """
    candidates: dict[str, list[dict]] = {"D": [], "R": []}
    for s in baseline_states:
        one = [s]
        today = project_states(one, swing_points, method)[0]["projected"]["d_seats"]
        for sign, direction in ((1.0, "D"), (-1.0, "R")):
            def flipped(delta: float) -> bool:
                d = project_states(one, swing_points + sign * delta, method)[0]["projected"]["d_seats"]
                return d != today

            if not flipped(max_delta):
                continue
            lo, hi = 0.0, max_delta
            while hi - lo > tol:
                mid = (lo + hi) / 2
                if flipped(mid):
                    hi = mid
                else:
                    lo = mid
            delta = math.ceil(hi * 10 - 1e-9) / 10
            candidates[direction].append({
                "fips": s["fips"],
                "code": s["code"],
                "name": s["name"],
                "direction": direction,
                "margin_delta": delta,
                "flips_at_margin": round(current_margin + sign * delta, 1),
            })
    merged: list[dict] = []
    for direction in ("D", "R"):
        candidates[direction].sort(key=lambda c: (c["margin_delta"], c["code"]))
        merged.extend(candidates[direction][:per_direction])
    merged.sort(key=lambda c: (c["margin_delta"], c["code"]))
    return merged


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
        # NOTE: no 50/50 imputation for baseline_distortion_warning states here.
        # This is a retrospective of the actual votes: if a major party fielded
        # no statewide candidate, PR of the real vote goes to the party that ran
        # (a 50/50 counterfactual would flip a single-seat state to the missing
        # party). The warning flag is still emitted for the per-state note.
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
            "state_elasticity": round(float(s.get("state_elasticity", 1.0)), 3),
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

    # 4b. Sensitivity band (only when the curated polling-error table is
    # fully verified — see load_polling_error).
    uncertainty = None
    polling_error = load_polling_error()
    if polling_error:
        eps = float(polling_error["meta"]["epsilon_points"])
        uncertainty = {
            "epsilon_points": eps,
            "basis": polling_error["meta"]["basis"],
            **compute_seat_band(baseline_states, swing, eps),
        }
        print(
            f"Sensitivity band at ±{eps:.1f} pts: "
            f"D {uncertainty['d_seats_low']}–{uncertainty['d_seats_high']} seats."
        )

    # 4c. Majority tipping point + closest seats to flip — same pure model,
    # bisected. Both optional (omitted if the crossing/flips fall outside the
    # defensive ranges).
    majority = None
    tipping = compute_majority_tipping(baseline_states, baseline_d_margin)
    if tipping is not None:
        majority = {"tipping_margin": tipping, "majority_seats": 218}
        print(f"Majority tipping point: D reaches 218 at ballot margin {tipping:+.1f}.")
    closest_flips = compute_closest_flips(baseline_states, swing, generic_ballot)
    if closest_flips:
        nearest = closest_flips[0]
        print(
            f"Closest seat to flip: {nearest['code']} toward {nearest['direction']} "
            f"at +{nearest['margin_delta']:.1f} pts ({len(closest_flips)} listed)."
        )

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
    # Keys absent (not null) when ungated — the optional TS types and the
    # API omission contract both rely on absence.
    if uncertainty:
        projection_payload["meta"]["uncertainty"] = uncertainty
    if majority:
        projection_payload["meta"]["majority"] = majority
    if closest_flips:
        projection_payload["meta"]["closest_flips"] = closest_flips
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
    if uncertainty:
        meta_payload["uncertainty"] = uncertainty
    if majority:
        meta_payload["majority"] = majority
    if closest_flips:
        meta_payload["closest_flips"] = closest_flips
    META_PATH.write_text(json.dumps(meta_payload, indent=2))

    # Regenerate per-state OG cards + static HTML pages so social-share
    # previews always reflect the freshest projection.
    try:
        from generate_state_og import main as generate_state_og
        generate_state_og()
    except Exception as e:
        print(f"  (warn) per-state OG generation failed: {e}")

    # Regenerate sitemap.xml so search engines see fresh <lastmod> dates and
    # can discover all 50 per-state pages.
    try:
        from generate_sitemap import main as generate_sitemap
        generate_sitemap()
    except Exception as e:
        print(f"  (warn) sitemap generation failed: {e}")

    # Regenerate llms.txt with the day's headline numbers so AI crawlers
    # quote live data rather than only the static descriptions.
    try:
        from generate_llms import main as generate_llms
        generate_llms()
    except Exception as e:
        print(f"  (warn) llms.txt generation failed: {e}")

    # Rebuild the multi-cycle retrospectives (offline — reads committed
    # house_{year}.json baselines, no network). 2024 here matches the
    # baseline_2024.json computed above (same Sainte-Laguë over the same data).
    try:
        from build_retrospectives import main as build_retrospectives
        build_retrospectives()
    except Exception as e:
        print(f"  (warn) retrospectives build failed: {e}")

    # Proportional Electoral College (1976-2024) — offline, reads committed
    # president_{year}.json baselines (distilled once by fetch_president.py).
    try:
        from build_electoral_college import main as build_electoral_college
        build_electoral_college()
    except Exception as e:
        print(f"  (warn) electoral-college build failed: {e}")

    # Senate malapportionment — offline, reads committed state_populations.json
    # (distilled once by fetch_senate_populations.py).
    try:
        from build_senate import main as build_senate
        build_senate()
    except Exception as e:
        print(f"  (warn) senate build failed: {e}")

    # Federal circuits by population/judges — offline, reads committed
    # circuit_definitions.json + state_populations.json.
    try:
        from build_circuits import main as build_circuits
        build_circuits()
    except Exception as e:
        print(f"  (warn) circuits build failed: {e}")

    # Static long-form content pages (e.g. /retrospectives) — reads
    # retrospectives.json (written just above); pure Python, no resvg.
    try:
        from generate_content_pages import main as generate_content_pages
        generate_content_pages()
    except Exception as e:
        print(f"  (warn) content-page generation failed: {e}")

    # Append today's snapshot to the projection-over-time series. Fetches the
    # live history.json (accumulates across deploys without committing data),
    # falls back to the committed file; never breaks the build.
    try:
        from build_history import main as build_history
        build_history()
    except Exception as e:
        print(f"  (warn) history build failed: {e}")

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

    # Hard data-integrity gate (NOT guarded): if the generated data violates an
    # invariant — wrong seat totals, wrong apportionment, a PR seat majority
    # going to the two-party loser (the ND-2022 bug), etc. — this raises and
    # fails the pipeline step, so the deploy ships the last-good data instead of
    # a regression.
    print()
    from validate_data import main as validate_data
    validate_data()


if __name__ == "__main__":
    main(refresh_clerk="--refresh" in sys.argv)
