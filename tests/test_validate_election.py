"""Tests for the election-lifecycle data checks (validate_data.check_election).

Run from repo root: pytest tests/test_validate_election.py
"""

import copy
import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "data-pipeline"))

import election  # noqa: E402
import validate_data  # noqa: E402
from freeze import canonical_sha256  # noqa: E402

GEN = "2026-11-03T06:05:00+00:00"


def block(phase: str, projection: dict | None = None, **extra) -> dict:
    b = {"cycle": 2026, "election_date": "2026-11-03", "freeze_at": "2026-11-03T10:00:00Z",
         "phase": phase, "baseline_cycle": 2024, "rehearsal": False, **extra}
    if projection is not None:
        b["final_projection"] = {"generated_at": GEN, "sha256": canonical_sha256(projection),
                                 "captured_from": "production"}
    return b


def base_projection() -> dict:
    return {
        "meta": {"generated_at": GEN},
        "national": {"seats": 435, "projected": {"d_seats": 235, "r_seats": 200},
                     "actual": {"d_seats": 215, "r_seats": 220}},
        "states": [],
    }


@pytest.fixture
def data(tmp_path, monkeypatch):
    monkeypatch.setattr(validate_data, "PUBLIC_DATA", tmp_path)
    monkeypatch.delenv("GITHUB_ACTIONS", raising=False)

    def write(projection: dict, eblock: dict | None, history: dict | None = None) -> None:
        p = copy.deepcopy(projection)
        if eblock is not None:
            p["meta"]["election"] = eblock
        (tmp_path / "projection.json").write_text(json.dumps(p))
        meta = {"generated_at": "2026-11-06T06:00:00+00:00"}
        if eblock is not None:
            meta["election"] = eblock
        (tmp_path / "meta.json").write_text(json.dumps(meta))
        if history is not None:
            (tmp_path / "history.json").write_text(json.dumps(history))

    return write


def frozen_history(d: int = 235) -> dict:
    return {"meta": {"final_date": "2026-11-03"},
            "points": [{"date": "2026-11-02", "projected_d": 233, "projected_r": 202},
                       {"date": "2026-11-03", "projected_d": d, "projected_r": 435 - d, "final": True}]}


def run(check_freshness: bool = False) -> list[str]:
    errors: list[str] = []
    validate_data.check_election(errors, check_freshness)
    return errors


def test_valid_frozen_data_passes(data):
    p = base_projection()
    data(p, block("counting", p), frozen_history())
    assert run() == []


def test_altered_frozen_projection_fails(data):
    p = base_projection()
    eb = block("counting", p)
    p["national"]["projected"]["d_seats"] = 236
    p["national"]["projected"]["r_seats"] = 199
    data(p, eb, frozen_history(236))
    assert any("altered" in e for e in run())


def test_history_must_end_on_the_final_point(data):
    p = base_projection()
    h = frozen_history()
    h["points"].append({"date": "2026-11-04", "projected_d": 235, "projected_r": 200})
    data(p, block("counting", p), h)
    assert any("must end on the final point" in e for e in run())


def test_history_final_point_must_match_the_projection(data):
    p = base_projection()
    data(p, block("counting", p), frozen_history(230))
    assert any("final point !=" in e for e in run())


def test_frozen_projection_must_predate_freeze_at(data):
    p = base_projection()
    p["meta"]["generated_at"] = "2026-11-03T11:00:00+00:00"
    eb = block("counting", p)
    eb["final_projection"]["generated_at"] = p["meta"]["generated_at"]
    data(p, eb, None)
    assert any("not before freeze_at" in e for e in run())


def test_final_projection_forbidden_before_the_freeze(data):
    p = base_projection()
    data(p, block("projection", p))
    assert any("present before the freeze" in e for e in run())


def test_meta_and_projection_blocks_must_agree(data, tmp_path):
    p = base_projection()
    data(p, block("projection"))
    meta = json.loads((tmp_path / "meta.json").read_text())
    meta["election"]["phase"] = "counting"
    (tmp_path / "meta.json").write_text(json.dumps(meta))
    assert any("meta.json election block" in e for e in run())


def test_rehearsal_data_rejected_in_ci(data, monkeypatch):
    p = base_projection()
    data(p, block("projection", rehearsal=True))
    assert run() == []
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    assert any("rehearsal" in e for e in run())


def test_missing_block_only_fails_a_fresh_run(data):
    data(base_projection(), None)
    assert run(check_freshness=False) == []
    assert any("missing" in e for e in run(check_freshness=True))


def test_fresh_run_phase_must_match_the_clock(data, monkeypatch):
    for k in election.REHEARSAL_ENV:
        monkeypatch.delenv(k, raising=False)
    election.reset()
    from datetime import datetime, timezone
    election.resolve(now=datetime(2026, 10, 1, tzinfo=timezone.utc))
    try:
        p = base_projection()
        data(p, block("counting", p), frozen_history())
        assert any("resolved 'projection'" in e for e in run(check_freshness=True))
    finally:
        election.reset()
