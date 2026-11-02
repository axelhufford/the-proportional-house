"""Tests for the automatic-publishing gate (data-pipeline/results_guard.py).

Run from repo root: pytest tests/test_results_guard.py

Election-night vote totals are published without a human looking first; these
pin the rules that hold a suspicious change back instead.
"""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "data-pipeline"))

from results_file import COLUMNS  # noqa: E402
from results_guard import guard, problems  # noqa: E402

BASE = 1_000_000  # the state's 2024 two-party House vote


def row(code="PA", status="provisional", d="", r="", d_seats="", r_seats="", as_of="2026-11-04T03:00:00Z"):
    return {c: "" for c in COLUMNS} | {
        "code": code, "status": status, "d_votes": d, "r_votes": r,
        "d_seats": d_seats, "r_seats": r_seats, "as_of": as_of if d or r else "",
        "source_url": "https://en.wikipedia.org/w/index.php?oldid=1" if d or r else "",
    }


PENDING = row(status="pending")


def test_first_votes_for_a_state_pass():
    assert problems(PENDING, row(d="300000", r="250000"), BASE) == []


def test_normal_count_progress_passes():
    old = row(d="300000", r="250000")
    new = row(d="420000", r="390000", as_of="2026-11-04T05:00:00Z")  # share moves 4.7 pts on +47% votes
    assert problems(old, new, BASE) == []


def test_big_swing_on_many_new_votes_passes():
    old = row(d="100000", r="100000")
    new = row(d="400000", r="250000", as_of="2026-11-04T05:00:00Z")  # +11.5 pts on +225% votes
    assert problems(old, new, BASE) == []


def test_votes_falling_is_held_back():
    old = row(d="300000", r="250000")
    new = row(d="299000", r="260000", as_of="2026-11-04T05:00:00Z")
    assert any("votes fell" in p for p in problems(old, new, BASE))


def test_big_swing_on_few_new_votes_is_held_back():
    old = row(d="300000", r="300000")
    new = row(d="380000", r="300000", as_of="2026-11-04T05:00:00Z")  # +5.9 pts on +13% votes
    assert any("moved" in p for p in problems(old, new, BASE))


def test_implausible_turnout_is_held_back():
    assert any("2024" in p for p in problems(PENDING, row(d="700000", r="600000"), BASE))


def test_stale_or_missing_timestamp_is_held_back():
    old = row(d="300000", r="250000")
    assert any("as_of" in p for p in problems(old, row(d="310000", r="260000"), BASE))  # same as_of


def test_certified_rows_are_never_touched_and_never_set():
    cert = row(status="certified", d="500000", r="400000", d_seats="5", r_seats="4")
    assert "already certified" in problems(cert, row(d="510000", r="400000", as_of="2026-12-01T00:00:00Z"), BASE)
    assert "only a human certifies a state" in problems(PENDING, row(status="certified", d="1", r="1"), BASE)


def test_called_seats_going_down_is_held_back():
    old = row(d="300000", r="250000", d_seats="3", r_seats="2")
    new = row(d="320000", r="260000", d_seats="2", r_seats="2", as_of="2026-11-04T05:00:00Z")
    assert any("D called seats went down" in p for p in problems(old, new, BASE))


def test_guard_reverts_only_the_bad_row():
    old = {"PA": row(d="300000", r="250000"), "OH": row("OH", status="pending")}
    new = {
        "PA": row(d="290000", r="250000", as_of="2026-11-04T05:00:00Z"),  # votes fell → revert
        "OH": row("OH", d="200000", r="260000"),                          # first votes → apply
    }
    final, applied, reverted = guard(old, new, {"PA": BASE, "OH": BASE})
    assert final["PA"] == old["PA"]
    assert final["OH"] == new["OH"]
    assert [a.split(":")[0] for a in applied] == ["APPLY  OH"]
    assert [r.split(":")[0] for r in reverted] == ["REVERT PA"]


def test_unchanged_rows_are_left_alone():
    same = {"PA": row(d="300000", r="250000")}
    final, applied, reverted = guard(same, dict(same), {"PA": BASE})
    assert final == same and applied == [] and reverted == []
