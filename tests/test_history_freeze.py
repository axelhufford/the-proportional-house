"""Tests for ending the projection-over-time series at the election freeze
(data-pipeline/build_history.py).

Run from repo root: pytest tests/test_history_freeze.py
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "data-pipeline"))

import build_history  # noqa: E402
import election  # noqa: E402


def pt(date: str, d: int = 230, **extra) -> dict:
    return {"date": date, "projected_d": d, "projected_r": 435 - d,
            "actual_d": 215, "actual_r": 220, "generic_ballot_margin": 7.0,
            "swing": 9.5, "reconstructed": False, **extra}


def test_freeze_series_ends_on_the_final_date():
    points = [pt("2026-11-01"), pt("2026-11-02"), pt("2026-11-03"), pt("2026-11-04"), pt("2026-11-09")]
    out = build_history.freeze_series(points, "2026-11-03")
    assert [p["date"] for p in out] == ["2026-11-01", "2026-11-02", "2026-11-03"]
    assert out[-1]["final"] is True
    assert not any(p.get("final") for p in out[:-1])


def test_freeze_series_clears_stray_final_flags():
    points = [pt("2026-11-01", final=True), pt("2026-11-02")]
    out = build_history.freeze_series(points, "2026-11-02")
    assert "final" not in out[0] and out[1]["final"] is True


def test_final_date_is_the_utc_publication_date():
    proj = {"meta": {"generated_at": "2026-11-03T06:12:00+00:00"}}
    assert build_history.final_date_of(proj) == "2026-11-03"
    # 11 PM ET on Nov 2 is already Nov 3 in UTC — the series is keyed by UTC day.
    proj = {"meta": {"generated_at": "2026-11-02T23:30:00-05:00"}}
    assert build_history.final_date_of(proj) == "2026-11-03"


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    monkeypatch.setattr(build_history, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(build_history, "PROJECTION_PATH", tmp_path / "projection.json")
    monkeypatch.setattr(build_history, "HISTORY_PATH", tmp_path / "history.json")
    monkeypatch.setattr(build_history, "BACKFILL_PATH", tmp_path / "history_backfill.json")
    for k in election.REHEARSAL_ENV:
        monkeypatch.delenv(k, raising=False)
    election.reset()
    yield tmp_path
    election.reset()


def _write_projection(path: Path, generated_at: str, d_seats: int) -> None:
    path.write_text(json.dumps({
        "meta": {"generated_at": generated_at, "generic_ballot_margin": 8.19, "swing": 10.7},
        "national": {"seats": 435, "projected": {"d_seats": d_seats, "r_seats": 435 - d_seats},
                     "actual": {"d_seats": 215, "r_seats": 220}},
        "states": [],
    }))


def test_main_after_freeze_adds_no_point_for_today(sandbox, monkeypatch):
    # Production carries a pre-freeze Nov 3 point plus one a broken run added
    # after the freeze; the frozen series must drop the latter and rebuild the
    # former from the frozen projection.
    monkeypatch.setattr(build_history, "_fetch_live_points",
                        lambda: [pt("2026-11-02", 233), pt("2026-11-03", 234), pt("2026-11-05", 240)])
    _write_projection(sandbox / "projection.json", "2026-11-03T06:05:00+00:00", 235)
    election.resolve(now=datetime(2026, 11, 6, 12, tzinfo=timezone.utc))

    build_history.main()

    h = json.loads((sandbox / "history.json").read_text())
    assert h["meta"]["final_date"] == "2026-11-03" and h["meta"]["cycle"] == 2026
    dates = [p["date"] for p in h["points"]]
    assert dates == ["2026-11-02", "2026-11-03"]
    last = h["points"][-1]
    assert last["final"] is True and last["projected_d"] == 235
    assert "methods" in last  # the alternative-method series still attaches


def test_main_before_freeze_is_unchanged(sandbox, monkeypatch):
    monkeypatch.setattr(build_history, "_fetch_live_points", lambda: [])
    today = datetime.now(timezone.utc)
    _write_projection(sandbox / "projection.json", today.isoformat(), 232)
    election.resolve(now=datetime(2026, 10, 1, tzinfo=timezone.utc))

    build_history.main()

    h = json.loads((sandbox / "history.json").read_text())
    assert "final_date" not in h["meta"]
    assert h["points"][-1]["date"] == today.date().isoformat()
    assert not any(p.get("final") for p in h["points"])
