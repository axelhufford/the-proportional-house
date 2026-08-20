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
from io_utils import write_json_atomic
from fetch_clerk_house import (
    PDF_URL as CLERK_PDF_URL,
    OUT_PATH as BASELINE_JSON,
    main as fetch_clerk_main,
)
from fetch_polls import (
    SILVER_BULLETIN_CSV_URL,
    SILVER_BULLETIN_LANDING_URL,
    fetch_csv,
    format_margin,
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

# Age at which the site shows its "data may be stale" banner. Published in both
# meta.json and projection.json's meta so the UI never hardcodes its own copy.
STALE_AFTER_HOURS = 48

# Decimal places for published two-party vote shares.
#
# These are not just for display: the Sandbox recomputes seat allocations in
# the browser from the shares in projection.json, so the published precision
# has to be fine enough that re-running the allocator on the rounded value
# reproduces the pipeline's own seat counts. At 4 decimals it did not — a
# ~5e-5 rounding error is enough to reorder two adjacent Sainte-Laguë
# quotients in a large delegation. 6 decimals leaves the error ~500x below the
# smallest quotient gap observed across the ±15-point ballot range.
SHARE_PRECISION = 6


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
            # 6 decimals, not 4. The seat counts above are allocated from the
            # full-precision shares, but the Sandbox re-derives seats in the
            # browser from these *published* values. At 4 decimals the rounding
            # error was large enough to flip a marginal quotient, so the
            # browser and the pipeline could disagree about the same state
            # (e.g. CA 31-21 vs 32-20). See SHARE_PRECISION below.
            "baseline_2024": {
                "d_share": round(baseline_d, SHARE_PRECISION),
                "r_share": round(baseline_r, SHARE_PRECISION),
            },
            "projected": {
                "d_share": round(proj_d, SHARE_PRECISION),
                "r_share": round(proj_r, SHARE_PRECISION),
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


# Generic-ballot average variants, published so the site can offer a toggle.
#
# The default is every poll in the window. The likely-voter variant re-runs the
# SAME average — same window, half-life, sample-size term, house-effect-adjusted
# margins — restricted to polls of likely voters. The two therefore differ only
# in which polls they include.
#
# This is deliberately NOT a reproduction of Silver Bulletin's likely-voter
# adjustment. Theirs is estimated by comparing the LV and RV releases of the
# same survey; the public poll database is deduped to one row per survey with
# the LV version preferred, so those paired rows are exactly what it strips.
# Ours is a filter over the same public data, published as our own calculation.
#
# `min_polls` gates publication: below it the variant is omitted entirely rather
# than shipped as a noisy number, the same discipline as load_polling_error.
# The standard variant is ungated (0) to preserve its existing behavior.
BALLOT_VARIANTS: list[dict] = [
    {
        "id": "standard",
        "label": "Standard average",
        "short_label": "All polls",
        "populations": None,
        "min_polls": 0,
        "note": (
            "Every generic-ballot poll in the window — likely voters, registered "
            "voters and adults — weighted by recency, sample size and voter screen."
        ),
    },
    {
        "id": "lv",
        "label": "Likely-voter polls only",
        "short_label": "LV only",
        "populations": {"LV"},
        "min_polls": 3,
        "note": (
            "The same average restricted to polls of likely voters. This is our own "
            "calculation, not Silver Bulletin's likely-voter-adjusted average — that "
            "adjustment compares the likely-voter and registered-voter releases of a "
            "single survey, and the public poll database keeps only one row per survey."
        ),
    },
]


def build_ballot_variant(
    spec: dict, polls: list, as_of: datetime, baseline_states: list[dict],
    baseline_d_margin: float, polling_error: dict | None,
    method: str = "sainte-lague",
) -> tuple[dict | None, dict, list[dict] | None]:
    """Compute one ballot-average variant and everything derived from it.

    Returns `(variant, avg, projected_states)`. `variant` is None when the
    average has fewer than `spec["min_polls"]` polls in window — the caller
    omits it rather than publishing a number too thin to defend.

    The band, tipping point and closest-flips list are all evaluated at THIS
    variant's swing, because none of them are transferable between swings.
    That is why they ride along on the variant instead of living only at the
    top level: the browser can re-derive a variant's per-state seats from the
    published shares, but it cannot re-derive these.
    """
    avg = weighted_average(polls, as_of=as_of, populations=spec["populations"])
    if avg["n_polls"] < spec["min_polls"]:
        return None, avg, None

    margin = avg["margin"]
    swing = margin - baseline_d_margin
    projected = project_states(baseline_states, swing, method)

    variant: dict = {
        "id": spec["id"],
        "label": spec["label"],
        "short_label": spec["short_label"],
        "note": spec["note"],
        "margin": margin,
        "swing": round(swing, 2),
        "n_polls": avg["n_polls"],
        "populations": avg["populations"],
        "projected": {
            "d_seats": sum(s["projected"]["d_seats"] for s in projected),
            "r_seats": sum(s["projected"]["r_seats"] for s in projected),
        },
    }

    # Optional blocks: absent (not null) when ungated, matching the top-level
    # omission contract the TS types and API tests rely on.
    if polling_error:
        eps = float(polling_error["meta"]["epsilon_points"])
        variant["uncertainty"] = {
            "epsilon_points": eps,
            "basis": polling_error["meta"]["basis"],
            **compute_seat_band(baseline_states, swing, eps, method),
        }
    # The tipping point is a property of the baseline and the allocator, not of
    # the swing, so it comes out the same for every variant. Published per
    # variant anyway so the client has one uniform shape to read, and so the
    # validator can check it against each variant's own margin.
    tipping = compute_majority_tipping(baseline_states, baseline_d_margin, method)
    if tipping is not None:
        variant["majority"] = {"tipping_margin": tipping, "majority_seats": 218}
    flips = compute_closest_flips(baseline_states, swing, margin, method)
    if flips:
        variant["closest_flips"] = flips

    return variant, avg, projected


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
            "baseline_2024": {
                "d_share": round(d, SHARE_PRECISION),
                "r_share": round(r, SHARE_PRECISION),
            },
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
    # Pipeline-step failures collected across the run; a non-empty list makes
    # the process exit non-zero at the end (see the tail of main).
    failures: list[str] = []

    # 1. Baseline. The 2024 vote shares and the as-elected delegation are both
    # fixed history, so the committed house_2024.json is reused unless
    # --refresh is passed. See fetch_clerk_house.WIKIPEDIA_RAW_URL: the source
    # table is *not* a live composition feed, so re-fetching it every run would
    # add a network dependency without ever changing a number.
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

    # 3-4. Ballot-average variants. Each carries its own swing, projection,
    # sensitivity band, tipping point and closest-flips list, because none of
    # those transfer between swings. The standard variant also supplies every
    # top-level field the payloads below already published, so the shape the
    # public API and the sibling social engine consume is unchanged.
    polling_error = load_polling_error()
    variants: list[dict] = []
    standard: dict | None = None
    standard_avg: dict | None = None
    standard_states: list[dict] | None = None

    print(f"Baseline 2024 D margin: {baseline_d_margin:+.2f} points (R+{abs(baseline_d_margin):.2f}).")
    for spec in BALLOT_VARIANTS:
        variant, v_avg, v_states = build_ballot_variant(
            spec, polls, now, baseline_states, baseline_d_margin, polling_error,
        )
        if variant is None:
            print(
                f"  {spec['id']:<9} omitted — {v_avg['n_polls']} poll(s) in window, "
                f"minimum {spec['min_polls']}."
            )
            continue
        variants.append(variant)
        print(
            f"  {variant['id']:<9} {format_margin(variant['margin'], 2)} "
            f"(n={variant['n_polls']}), swing {variant['swing']:+.2f} → "
            f"D {variant['projected']['d_seats']} / R {variant['projected']['r_seats']}"
        )
        if spec["id"] == "standard":
            standard, standard_avg, standard_states = variant, v_avg, v_states

    if standard is None or standard_avg is None or standard_states is None:
        # Unreachable with min_polls=0, but the pipeline must never silently
        # publish a payload with no headline projection in it.
        raise RuntimeError("standard ballot variant missing — cannot build a projection")

    # The names below are the standard variant's, and stay the meaning of every
    # top-level field in projection.json / meta.json.
    avg = standard_avg
    generic_ballot = standard["margin"]  # positive = D advantage in margin points
    swing = generic_ballot - baseline_d_margin
    projected = standard_states
    uncertainty = standard.get("uncertainty")
    majority = standard.get("majority")
    closest_flips = standard.get("closest_flips")

    nat_proj_d = sum(s["projected"]["d_seats"] for s in projected)
    nat_proj_r = sum(s["projected"]["r_seats"] for s in projected)
    nat_actual_d = sum(s["actual"]["d_seats"] for s in projected)
    nat_actual_r = sum(s["actual"]["r_seats"] for s in projected)

    retrospective = retrospective_states(baseline_states)
    nat_retro_d = sum(s["projected_pr"]["d_seats"] for s in retrospective)
    nat_retro_r = sum(s["projected_pr"]["r_seats"] for s in retrospective)

    if uncertainty:
        print(
            f"Sensitivity band at ±{uncertainty['epsilon_points']:.1f} pts: "
            f"D {uncertainty['d_seats_low']}–{uncertainty['d_seats_high']} seats."
        )
    if majority:
        print(f"Majority tipping point: D reaches 218 at ballot margin {majority['tipping_margin']:+.1f}.")
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
            # Also published in meta.json. Repeated here because the stale-data
            # banner renders from projection.json's meta and would otherwise
            # need its own hardcoded copy of the threshold.
            "stale_after_hours": STALE_AFTER_HOURS,
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
    # Additive: the ballot-average toggle reads this. `standard` duplicates the
    # top-level fields above so the client has one uniform shape; the top-level
    # fields stay authoritative for consumers that predate the toggle.
    projection_payload["meta"]["ballot_variants"] = variants
    write_json_atomic(PROJECTION_PATH, projection_payload)

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
    write_json_atomic(BASELINE_OUT_PATH, baseline_payload)

    trend = build_polling_trend(polls, as_of=now)
    write_json_atomic(POLLING_TREND_PATH, {
        "meta": {
            "generated_at": now.isoformat(),
            "source": SILVER_BULLETIN_LANDING_URL,
            "csv_url": SILVER_BULLETIN_CSV_URL,
            "window_days": TREND_WINDOW_DAYS,
            "n_polls": len(trend),
            "uses_house_effect_adjustment": True,
        },
        "polls": trend,
    })

    meta_payload = {
        "generated_at": now.isoformat(),
        "stale_after_hours": STALE_AFTER_HOURS,
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
    meta_payload["ballot_variants"] = variants
    write_json_atomic(META_PATH, meta_payload)

    # Derived artifacts. Each is isolated so one failure can't abort the others
    # or discard the core files already written above — but every failure is
    # recorded and makes the run exit non-zero (see `failures` handling at the
    # end of main). Previously these only printed a warning, so a builder that
    # threw left yesterday's file in place while the run still reported success:
    # the homepage chart would silently stop advancing with nothing to notice it.
    def run_builder(label: str, module: str) -> None:
        try:
            mod = __import__(module)
            mod.main()
        # BaseException, not Exception: build_electoral_college historically
        # raised SystemExit, which is not an Exception subclass and so escaped
        # the old handlers and hard-killed the whole run.
        except BaseException as e:  # noqa: BLE001
            failures.append(f"{label}: {type(e).__name__}: {e}")
            print(f"  (warn) {label} failed: {type(e).__name__}: {e}")

    # Today's actual chamber (D/R/vacant) from the Clerk's official member list.
    # Display-only: nothing in the projection math reads it — the November 2024
    # election result stays the baseline, so a resignation can't move the
    # headline seat-gap. Runs first so llms.txt and the OG cards below can
    # reference it. This one IS a live feed, unlike the 2024 elections table.
    run_builder("live House composition", "fetch_live_composition")
    # Per-state OG cards + static HTML pages, so social-share previews always
    # reflect the freshest projection.
    run_builder("per-state OG generation", "generate_state_og")
    # sitemap.xml — fresh <lastmod> dates, discovery of all 50 state pages.
    run_builder("sitemap generation", "generate_sitemap")
    # llms.txt with the day's headline numbers, so AI crawlers quote live data.
    run_builder("llms.txt generation", "generate_llms")
    # Multi-cycle retrospectives (offline — reads committed house_{year}.json).
    # 2024 here matches baseline_2024.json above (same Sainte-Laguë, same data).
    run_builder("retrospectives build", "build_retrospectives")
    # Proportional Electoral College (1976-2024) — offline, committed baselines.
    run_builder("electoral-college build", "build_electoral_college")
    # Senate malapportionment — offline, committed state_populations.json.
    run_builder("senate build", "build_senate")
    # Federal circuits by population/judges — offline, committed definitions.
    run_builder("circuits build", "build_circuits")
    # Static long-form content pages (e.g. /retrospectives), from the
    # retrospectives.json written just above.
    run_builder("content-page generation", "generate_content_pages")
    # Append today's snapshot to the projection-over-time series.
    run_builder("history build", "build_history")

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
    # check_freshness=True: these files were written moments ago, so a stale
    # generated_at or a history series that didn't advance means a write or a
    # builder silently failed.
    validate_data(check_freshness=True)

    # A step that failed above means the site is serving a mix of today's core
    # data and yesterday's charts/maps/OG cards (or yesterday's delegation).
    # validate_data can't catch it — it happily validates the stale file — so
    # surface it here as a non-zero exit. The deploy still ships last-good data
    # (CI restores it), but the run no longer reports success.
    if failures:
        print()
        print(f"✗ {len(failures)} pipeline step(s) failed:")
        for f in failures:
            print(f"    - {f}")
        raise SystemExit(1)


if __name__ == "__main__":
    main(refresh_clerk="--refresh" in sys.argv)
