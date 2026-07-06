"""Tests for the polling-error sensitivity band (data-pipeline/update.py).

Run from repo root: pytest tests/test_uncertainty.py

Band invariants run against the real committed 2024 baseline. The curated
polling_error.json cross-checks only activate once the table is verified
(load_polling_error() returns non-None); until then they skip, so the
unverified skeleton commit stays green while the pipeline ships no band.
"""

import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "data-pipeline"))

from update import compute_seat_band, load_polling_error, project_states  # noqa: E402

BASELINE = REPO_ROOT / "data-pipeline" / "baseline" / "house_2024.json"
POLLING_ERROR = REPO_ROOT / "data-pipeline" / "baseline" / "polling_error.json"

with BASELINE.open() as f:
    BASELINE_STATES = json.load(f)["states"]

TOTAL_SEATS = 435


@pytest.mark.parametrize("swing", [-9.0, -3.0, 0.0, 3.0, 9.45])
@pytest.mark.parametrize("eps", [0.5, 3.0, 6.0])
def test_band_invariants(swing: float, eps: float) -> None:
    band = compute_seat_band(BASELINE_STATES, swing, eps)
    point = project_states(BASELINE_STATES, swing)
    point_d = sum(s["projected"]["d_seats"] for s in point)

    assert band["d_seats_low"] <= band["d_seats_high"]
    assert band["d_seats_low"] <= point_d <= band["d_seats_high"]
    assert band["d_seats_low"] + band["r_seats_high"] == TOTAL_SEATS
    assert band["d_seats_high"] + band["r_seats_low"] == TOTAL_SEATS


@pytest.mark.parametrize("swing", [-3.0, 0.0, 9.45])
def test_band_nests_as_epsilon_grows(swing: float) -> None:
    b1 = compute_seat_band(BASELINE_STATES, swing, 1.0)
    b3 = compute_seat_band(BASELINE_STATES, swing, 3.0)
    b6 = compute_seat_band(BASELINE_STATES, swing, 6.0)
    assert b3["d_seats_low"] <= b1["d_seats_low"] and b1["d_seats_high"] <= b3["d_seats_high"]
    assert b6["d_seats_low"] <= b3["d_seats_low"] and b3["d_seats_high"] <= b6["d_seats_high"]


def test_zero_epsilon_degenerates_to_point() -> None:
    band = compute_seat_band(BASELINE_STATES, 5.0, 0.0)
    point = project_states(BASELINE_STATES, 5.0)
    point_d = sum(s["projected"]["d_seats"] for s in point)
    assert band["d_seats_low"] == band["d_seats_high"] == point_d


# --- Curated-table cross-checks (activate once the table is verified) -------

TABLE = load_polling_error()


@pytest.mark.skipif(TABLE is None, reason="polling_error.json not yet verified — band gated off")
def test_table_actual_margins_match_committed_baselines() -> None:
    for c in TABLE["cycles"]:
        hp = REPO_ROOT / "data-pipeline" / "baseline" / f"house_{c['year']}.json"
        with hp.open() as f:
            nhpv = json.load(f)["meta"]["national_house_popular_vote"]
        actual = nhpv.get("d_margin_points")
        if actual is None:
            actual = -nhpv["r_margin_points"]
        assert abs(c["actual_d_margin"] - actual) <= 0.001, f"{c['year']}: table vs baseline"


@pytest.mark.skipif(TABLE is None, reason="polling_error.json not yet verified — band gated off")
def test_table_arithmetic_and_sources() -> None:
    misses = []
    for c in TABLE["cycles"]:
        assert c["verified"] is True
        assert c["final_average_source_url"], f"{c['year']}: missing source URL"
        expected = c["final_average_d_margin"] - c["actual_d_margin"]
        assert abs(c["error_points"] - expected) <= 0.001, f"{c['year']}: error arithmetic"
        misses.append(c["error_points"])
    rms = (sum(m * m for m in misses) / len(misses)) ** 0.5
    assert abs(TABLE["meta"]["epsilon_points"] - round(rms, 1)) <= 0.05


@pytest.mark.skipif(TABLE is None, reason="polling_error.json not yet verified — band gated off")
def test_gate_requires_all_rows_verified(tmp_path: Path) -> None:
    # Flipping any row to unverified must close the gate.
    import update

    broken = json.loads(POLLING_ERROR.read_text())
    broken["cycles"][0]["verified"] = False
    p = tmp_path / "polling_error.json"
    p.write_text(json.dumps(broken))
    orig = update.POLLING_ERROR_PATH
    try:
        update.POLLING_ERROR_PATH = p
        assert update.load_polling_error() is None
    finally:
        update.POLLING_ERROR_PATH = orig
