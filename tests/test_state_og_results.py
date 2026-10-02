"""Tests for the election-results variants of the share cards and per-state pages
(data-pipeline/generate_state_og.py).

Run from repo root: pytest tests/test_state_og_results.py

The rule they pin is the site's: no PR "shift" is claimed while a race is
uncalled — a gap between two partial counts isn't a finding.
"""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "data-pipeline"))

import generate_state_og as og  # noqa: E402

STATE = {
    "name": "New Jersey", "code": "NJ", "seats": 12,
    "actual": {"d_seats": 9, "r_seats": 3},
    "projected": {"d_share": 0.58, "r_share": 0.42, "d_seats": 7, "r_seats": 5},
}


def result(status: str = "provisional", uncalled: int = 5, pr=(7, 5)) -> dict:
    called_d, called_r = (5, 2) if uncalled == 5 else (8, 4)
    return {
        "code": "NJ", "status": status,
        "as_elected": {"d_seats": called_d, "r_seats": called_r, "other_seats": 0, "uncalled_seats": uncalled},
        "under_pr": None if status == "pending" else {"d_seats": pr[0], "r_seats": pr[1]},
    }


def test_state_card_mid_count_claims_no_shift():
    svg = og.build_results_card_svg(STATE, result(), 2026)
    assert "CALLED SO FAR" in svg and "UNDER PR · VOTES COUNTED" in svg
    assert "5 races not yet called" in svg
    assert "under PR</text>" not in svg  # no "+N D under PR" shift label


def test_state_card_certified():
    svg = og.build_results_card_svg(STATE, result("certified", 0, (7, 5)), 2026)
    assert "AS ELECTED 2026" in svg and "UNDER PR · 2026 VOTE" in svg
    assert "+1 D under PR" not in svg and "+1 R under PR" in svg  # called 8/4 vs PR 7/5


def _results(all_called: bool, pending_seats: int) -> dict:
    return {
        "meta": {"cycle": 2026, "all_called": all_called, "all_certified": all_called and not pending_seats,
                 "seats_called": 435 if all_called else 300},
        "national": {
            "as_elected": {"d_seats": 215 if all_called else 150, "r_seats": 220 if all_called else 150,
                           "other_seats": 0, "uncalled_seats": 0 if all_called else 135},
            "under_pr": {"d_seats": 213, "r_seats": 222 - pending_seats, "pending_seats": pending_seats},
        },
        "states": [{"under_pr": {"d_seats": 1, "r_seats": 0}}] * (50 if not pending_seats else 30),
    }


def test_home_card_counting():
    svg = og.build_results_home_card_svg(_results(False, 40))
    assert "2026 results: counting" in svg
    assert "300 of 435 races called · 30 of 50 states reporting" in svg
    assert "seats toward" not in svg


def test_home_card_complete():
    svg = og.build_results_home_card_svg(_results(True, 0))
    assert "+2 seats toward Republicans" in svg
    assert "AS ELECTED 2026" in svg and "UNDER PR · 2026 VOTE" in svg


def test_state_page_with_results():
    html = og.build_html_page(STATE, "2026-11-05", "2026-11-03", result(), 2026)
    assert "2026 U.S. House results (provisional)" in html
    assert "5 races not yet called" in html
    assert "The final pre-election projection was" in html
    assert "Called so far (2026)" in html and "Under PR (votes counted)" in html


def test_state_page_pending():
    html = og.build_html_page(STATE, "2026-11-05", "2026-11-03", result("pending"), 2026)
    assert "No 2026 votes have been reported for New Jersey yet." in html
    assert "was elected" in html  # still the projection lede
