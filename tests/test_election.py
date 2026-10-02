"""Tests for the election-lifecycle phase logic (data-pipeline/election.py).

Run from repo root: pytest tests/test_election.py

The freeze boundary is the one moment the whole site changes behavior, and it
happens once, unattended, at 5 AM on election day. These pin it to the second.
"""

import csv
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "data-pipeline"))

import election  # noqa: E402
from validate_data import APP_2020  # noqa: E402

FREEZE = datetime(2026, 11, 3, 10, 0, 0, tzinfo=timezone.utc)
CFG = {"freeze_at": "2026-11-03T10:00:00Z", "phase_override": None}


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    for k in election.REHEARSAL_ENV:
        monkeypatch.delenv(k, raising=False)
    election.reset()
    yield
    election.reset()


def test_committed_config_is_the_2026_cycle():
    # A committed phase_override or a moved freeze_at would change what the
    # live site does on election day; make either a deliberate test edit.
    cfg = election.load_config()
    assert cfg["cycle"] == 2026
    assert cfg["election_date"] == "2026-11-03"
    assert election.parse_ts(cfg["freeze_at"]) == FREEZE
    assert cfg["phase_override"] is None


@pytest.mark.parametrize("offset,expected", [
    (-1, "projection"),
    (0, "counting"),
    (1, "counting"),
    (86400 * 40, "counting"),
])
def test_phase_boundary(offset, expected):
    assert election.phase_at(CFG, FREEZE + timedelta(seconds=offset)) == expected


def test_all_certified_moves_to_results_only_after_the_freeze():
    assert election.phase_at(CFG, FREEZE - timedelta(seconds=1), certified=True) == "projection"
    assert election.phase_at(CFG, FREEZE, certified=True) == "results"


def test_override_projection_is_the_emergency_unfreeze():
    cfg = {**CFG, "phase_override": "projection"}
    assert election.phase_at(cfg, FREEZE + timedelta(days=3)) == "projection"


def test_frozen_override_before_freeze_is_an_error():
    with pytest.raises(ValueError, match="before freeze_at"):
        election.phase_at({**CFG, "phase_override": "results"}, FREEZE - timedelta(hours=1))


def test_unknown_override_is_an_error():
    with pytest.raises(ValueError, match="not one of"):
        election.phase_at({**CFG, "phase_override": "final"}, FREEZE)


def _write_results(path: Path, statuses: list[str]) -> Path:
    codes = sorted(APP_2020)
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["code", "status"])
        for code, st in zip(codes, statuses):
            w.writerow([code, st])
    return path


def test_all_certified(tmp_path):
    assert election.all_certified(tmp_path / "missing.csv") is False
    assert election.all_certified(_write_results(tmp_path / "a.csv", ["certified"] * 50)) is True
    assert election.all_certified(_write_results(tmp_path / "b.csv", ["certified"] * 49)) is False
    mixed = ["certified"] * 49 + ["provisional"]
    assert election.all_certified(_write_results(tmp_path / "c.csv", mixed)) is False


def test_resolve_is_memoized_and_env_marks_rehearsal(monkeypatch):
    monkeypatch.setenv("PH_FREEZE_AT", "2020-01-01T00:00:00Z")
    el = election.resolve(now=datetime(2026, 9, 29, tzinfo=timezone.utc))
    assert el.rehearsal is True
    assert el.phase == "counting" and el.frozen
    # Memoized: a later env change within the same process has no effect.
    monkeypatch.delenv("PH_FREEZE_AT")
    assert election.resolve() is el
    election.reset()
    el2 = election.resolve(now=datetime(2026, 9, 29, tzinfo=timezone.utc))
    assert el2.rehearsal is False and el2.phase == "projection"


def test_meta_block():
    el = election.resolve(now=datetime(2026, 9, 29, tzinfo=timezone.utc))
    block = election.meta_block(el)
    assert block == {
        "cycle": 2026,
        "election_date": "2026-11-03",
        "freeze_at": "2026-11-03T10:00:00Z",
        "phase": "projection",
        "baseline_cycle": 2024,
        "rehearsal": False,
    }
    final = {"generated_at": "x", "sha256": "y", "captured_from": "production"}
    assert election.meta_block(el, final)["final_projection"] == final
    # JSON-serializable as written into projection.json.
    json.dumps(election.meta_block(el, final))
