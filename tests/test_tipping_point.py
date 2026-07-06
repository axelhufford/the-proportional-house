"""Tests for the majority tipping point + closest-flips math (update.py).

Run from repo root: pytest tests/test_tipping_point.py

All tests run against the real committed 2024 baseline, mirroring
tests/test_uncertainty.py.
"""

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "data-pipeline"))

from update import (  # noqa: E402
    _national_d_seats,
    compute_closest_flips,
    compute_majority_tipping,
    project_states,
)

BASELINE = REPO_ROOT / "data-pipeline" / "baseline" / "house_2024.json"

with BASELINE.open() as f:
    _BASELINE = json.load(f)
BASELINE_STATES = _BASELINE["states"]
BASELINE_D_MARGIN = -_BASELINE["meta"]["national_house_popular_vote"]["r_margin_points"]


def test_tipping_exists_and_crosses() -> None:
    tip = compute_majority_tipping(BASELINE_STATES, BASELINE_D_MARGIN)
    assert tip is not None
    assert -20 <= tip <= 20
    assert _national_d_seats(BASELINE_STATES, (tip + 0.1) - BASELINE_D_MARGIN) >= 218
    assert _national_d_seats(BASELINE_STATES, (tip - 0.1) - BASELINE_D_MARGIN) <= 217


def test_national_seats_monotone() -> None:
    margins = [m / 2 for m in range(-20, 21)]  # −10 … +10 in 0.5 steps
    seats = [_national_d_seats(BASELINE_STATES, m - BASELINE_D_MARGIN) for m in margins]
    assert all(a <= b for a, b in zip(seats, seats[1:]))


def test_tipping_omitted_when_range_excludes_crossing() -> None:
    # P(lo) already True: majority everywhere in range.
    assert compute_majority_tipping(BASELINE_STATES, BASELINE_D_MARGIN, margin_range=(19.0, 20.0)) is None
    # P(hi) still False: no majority anywhere in range.
    assert compute_majority_tipping(BASELINE_STATES, BASELINE_D_MARGIN, margin_range=(-20.0, -19.0)) is None


# A plausible mid-campaign margin for flip tests (D+6, swing vs baseline).
MARGIN = 6.0
SWING = MARGIN - BASELINE_D_MARGIN
FLIPS = compute_closest_flips(BASELINE_STATES, SWING, MARGIN)


def test_closest_flips_invariants() -> None:
    assert 0 < len(FLIPS) <= 6
    for direction in ("D", "R"):
        assert sum(1 for c in FLIPS if c["direction"] == direction) <= 3
    deltas = [c["margin_delta"] for c in FLIPS]
    assert deltas == sorted(deltas)
    assert len({(c["code"], c["direction"]) for c in FLIPS}) == len(FLIPS)
    for c in FLIPS:
        assert 0 < c["margin_delta"] <= 15
        # ceil-rounded to 0.1
        assert abs(c["margin_delta"] * 10 - round(c["margin_delta"] * 10)) < 1e-9
        sign = 1.0 if c["direction"] == "D" else -1.0
        assert abs(c["flips_at_margin"] - round(MARGIN + sign * c["margin_delta"], 1)) <= 0.051


def test_closest_flips_actually_flip() -> None:
    by_fips = {s["fips"]: s for s in BASELINE_STATES}
    for c in FLIPS:
        state = by_fips[c["fips"]]
        sign = 1.0 if c["direction"] == "D" else -1.0
        today = project_states([state], SWING)[0]["projected"]["d_seats"]
        at_delta = project_states([state], SWING + sign * (c["margin_delta"] + 0.05))[0]["projected"]["d_seats"]
        assert at_delta != today, f"{c['code']}: no flip at margin_delta+0.05"
        assert (at_delta > today) == (c["direction"] == "D"), f"{c['code']}: direction mismatch"
        early = c["margin_delta"] - 0.2
        if early > 0.05:
            at_early = project_states([state], SWING + sign * early)[0]["projected"]["d_seats"]
            assert at_early == today, f"{c['code']}: flips earlier than margin_delta-0.2"
