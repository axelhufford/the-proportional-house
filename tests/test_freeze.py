"""Tests for the final-projection freeze (data-pipeline/freeze.py).

Run from repo root: pytest tests/test_freeze.py

The frozen projection is a record of what the site published on election eve.
These pin the selection rule (committed > production > working tree, inside
the window), the hash that makes tampering detectable, and the rehearsal
isolation that keeps synthetic runs out of the durable record.
"""

import copy
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "data-pipeline"))

import election  # noqa: E402
import freeze  # noqa: E402

FREEZE = datetime(2026, 11, 3, 10, 0, 0, tzinfo=timezone.utc)


def payloads(generated_at: datetime, d_seats: int = 235) -> tuple[dict, dict]:
    ts = generated_at.isoformat()
    projection = {
        "meta": {"generated_at": ts, "generic_ballot_margin": 8.1},
        "national": {"seats": 435, "projected": {"d_seats": d_seats, "r_seats": 435 - d_seats},
                     "actual": {"d_seats": 215, "r_seats": 220}},
        "states": [],
    }
    trend = {"meta": {"generated_at": ts, "n_polls": 3}, "polls": []}
    return projection, trend


def cand(source: str, generated_at: datetime, d_seats: int = 235) -> freeze.Candidate:
    p, t = payloads(generated_at, d_seats)
    return freeze.make_candidate(source, source, p, t)


def test_sha_ignores_the_election_block():
    p, _ = payloads(FREEZE - timedelta(hours=4))
    stamped = copy.deepcopy(p)
    stamped["meta"]["election"] = {"phase": "counting"}
    assert freeze.canonical_sha256(p) == freeze.canonical_sha256(stamped)
    changed = copy.deepcopy(p)
    changed["national"]["projected"]["d_seats"] += 1
    assert freeze.canonical_sha256(changed) != freeze.canonical_sha256(p)


def test_trend_must_come_from_the_same_run():
    p, t = payloads(FREEZE - timedelta(hours=4))
    t["meta"]["generated_at"] = (FREEZE - timedelta(hours=28)).isoformat()
    with pytest.raises(freeze.FreezeError, match="different runs"):
        freeze.make_candidate("production", "x", p, t)


def test_post_freeze_copy_round_trips_and_detects_tampering():
    p, t = payloads(FREEZE - timedelta(hours=4))
    sha = freeze.canonical_sha256(p)
    published = copy.deepcopy(p)
    published["meta"]["election"] = {"phase": "counting", "final_projection": {"sha256": sha}}
    c = freeze.make_candidate("production", "x", published, t)
    assert c.sha256 == sha
    assert "election" not in c.projection["meta"]

    published["national"]["projected"]["d_seats"] = 240
    with pytest.raises(freeze.FreezeError, match="hashes to"):
        freeze.make_candidate("production", "x", published, t)


def test_production_beats_a_newer_working_tree():
    # A local working tree can hold a run that was never deployed.
    prod = cand("production", FREEZE - timedelta(hours=4))
    local = cand("working-tree", FREEZE - timedelta(minutes=5), d_seats=240)
    assert freeze.select_final([prod, local], FREEZE) is prod
    assert freeze.select_final([local, prod], FREEZE) is prod


def test_working_tree_is_the_fallback():
    local = cand("working-tree", FREEZE - timedelta(hours=4))
    stale_prod = cand("production", FREEZE - timedelta(hours=40))
    assert freeze.select_final([stale_prod, local], FREEZE) is local


def test_committed_always_wins():
    committed = cand("committed", FREEZE - timedelta(hours=28))
    prod = cand("production", FREEZE - timedelta(hours=4))
    assert freeze.select_final([prod, committed], FREEZE) is committed


def test_committed_outside_window_is_an_error_not_a_fallback():
    committed = cand("committed", FREEZE - timedelta(hours=50))
    prod = cand("production", FREEZE - timedelta(hours=4))
    with pytest.raises(freeze.FreezeError, match="freeze_at changed"):
        freeze.select_final([committed, prod], FREEZE)


@pytest.mark.parametrize("age", [timedelta(0), timedelta(seconds=-1), timedelta(hours=30, seconds=1)])
def test_window_edges_rejected(age):
    # generated_at == freeze_at, after it, or older than 30h: none are final.
    c = cand("production", FREEZE - age)
    with pytest.raises(freeze.FreezeError, match="no projection published"):
        freeze.select_final([c], FREEZE)


def test_window_edges_accepted():
    assert freeze.in_window(cand("production", FREEZE - timedelta(seconds=1)), FREEZE)
    assert freeze.in_window(cand("production", FREEZE - timedelta(hours=30)), FREEZE)


def _el(rehearsal: bool) -> election.Election:
    return election.Election(
        cycle=2026, congress=120, election_date="2026-11-03", freeze_at=FREEZE,
        congress_convenes="2027-01-03", baseline_cycle=2024,
        results_csv=REPO_ROOT / "data-pipeline" / "results" / "house_2026.csv",
        phase="counting", now=FREEZE + timedelta(hours=1), rehearsal=rehearsal,
    )


@pytest.fixture
def roots(tmp_path, monkeypatch):
    monkeypatch.setattr(freeze, "FROZEN_ROOT", tmp_path / "frozen")
    monkeypatch.setattr(freeze, "REHEARSAL_ROOT", tmp_path / "rehearsal")
    return tmp_path


def test_capture_round_trip(roots):
    el = _el(rehearsal=False)
    c = cand("production", FREEZE - timedelta(hours=4))
    d = freeze.write_frozen_dir(el, c, el.now)
    assert d == roots / "frozen" / "2026"
    loaded = freeze.load_committed(el)
    assert loaded is not None and loaded.sha256 == c.sha256
    assert loaded.source == "committed"
    # The published block names the original capture, so it never changes.
    assert freeze.final_block(loaded) == freeze.final_block(c)


def test_rehearsal_capture_is_isolated(roots):
    c = cand("production", FREEZE - timedelta(hours=4))
    freeze.write_frozen_dir(_el(rehearsal=True), c, FREEZE)
    assert (roots / "rehearsal" / "2026" / "manifest.json").exists()
    # A real run never sees it.
    assert freeze.load_committed(_el(rehearsal=False)) is None


def test_rehearsal_manifest_in_the_real_dir_is_rejected(roots):
    c = cand("production", FREEZE - timedelta(hours=4))
    real = _el(rehearsal=False)
    freeze.write_frozen_dir(real, c, FREEZE)
    manifest = roots / "frozen" / "2026" / "manifest.json"
    manifest.write_text(manifest.read_text().replace('"rehearsal": false', '"rehearsal": true'))
    with pytest.raises(freeze.FreezeError, match="rehearsal"):
        freeze.load_committed(real)


def test_tampered_committed_projection_is_rejected(roots):
    el = _el(rehearsal=False)
    c = cand("production", FREEZE - timedelta(hours=4))
    freeze.write_frozen_dir(el, c, FREEZE)
    path = roots / "frozen" / "2026" / "projection.json"
    path.write_text(path.read_text().replace('"d_seats": 235', '"d_seats": 236'))
    with pytest.raises(freeze.FreezeError, match="manifest sha256"):
        freeze.load_committed(el)
