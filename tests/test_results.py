"""Tests for election results ingestion: the curated CSV (results_file.py), the
built results JSON (build_results.py), and its validation (check_results).

Run from repo root: pytest tests/test_results.py

The CSV is hand-edited on election night, so these pin the rules that stop a
tired typo from reaching the site: a seat count that doesn't fit the state,
votes on a state still marked pending, a "certified" state with races uncalled,
a number with no source or timestamp.
"""

import copy
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "data-pipeline"))

import build_results  # noqa: E402
import election  # noqa: E402
import validate_data  # noqa: E402
from results_file import (  # noqa: E402
    APPORTIONMENT, COLUMNS, ResultsFileError, load_results_csv, parse_rows,
)

NOW = datetime(2026, 11, 5, 12, tzinfo=timezone.utc)
AS_OF = "2026-11-05T01:30:00-05:00"
SRC = "https://www.sos.example.gov/results"
FIXTURES = REPO_ROOT / "tests" / "fixtures"
SKELETON = REPO_ROOT / "data-pipeline" / "results" / "house_2026.csv"


def rows(**overrides: dict) -> list[dict]:
    """All 50 states pending, with per-state overrides: rows(TX={...})."""
    out = []
    for code in sorted(APPORTIONMENT):
        r = {c: "" for c in COLUMNS} | {"code": code, "status": "pending"}
        r.update(overrides.get(code, {}))
        out.append(r)
    return out


def provisional(d: int, r: int, **extra) -> dict:
    return {"status": "provisional", "d_votes": str(d), "r_votes": str(r),
            "source_url": SRC, "as_of": AS_OF, **extra}


def errors_for(**overrides) -> str:
    with pytest.raises(ResultsFileError) as e:
        parse_rows(rows(**overrides), NOW)
    return str(e.value)


# --- the committed file ------------------------------------------------------

def test_committed_file_is_the_all_pending_skeleton():
    # Nothing is counted before election night. A committed non-pending row
    # before then would be data from nowhere.
    results = load_results_csv(SKELETON, NOW)
    assert len(results) == 50
    assert {r.status for r in results} == {"pending"}
    assert sum(r.d_seats + r.r_seats + r.other_seats for r in results) == 0


def test_synthetic_fixtures_are_valid_and_say_so():
    for name in ("results_2026_synthetic_election_night.csv", "results_2026_synthetic_certified.csv"):
        results = load_results_csv(FIXTURES / name, NOW)
        assert all("SYNTHETIC" in r.note for r in results)
        assert all(".invalid/" in r.source_url for r in results if r.source_url)


# --- row rules -----------------------------------------------------------------

def test_valid_provisional_row():
    out = parse_rows(rows(TX=provisional(1_234_567, 2_000_000, d_seats="10", r_seats="20")), NOW)
    tx = next(r for r in out if r.code == "TX")
    assert tx.uncalled_seats == 38 - 30
    assert tx.has_votes


def test_commas_in_numbers_are_fine():
    out = parse_rows(rows(CA=provisional(0, 0) | {"d_votes": "5,123,456", "r_votes": "3,000,001"}), NOW)
    assert next(r for r in out if r.code == "CA").d_votes == 5_123_456


def test_too_many_called_seats():
    assert "seats called but the state has 1" in errors_for(WY={"d_seats": "1", "r_seats": "1"})


def test_pending_with_votes():
    assert "mark it provisional" in errors_for(OH={"d_votes": "10"})


def test_pending_may_have_called_seats():
    # Uncontested races are called at poll close, before any vote is counted.
    parse_rows(rows(MA={"d_seats": "2"}), NOW)


def test_provisional_needs_source_and_timestamp():
    msg = errors_for(PA={"status": "provisional", "d_votes": "10", "r_votes": "12"})
    assert "needs a source_url" in msg and "needs an as_of" in msg


def test_as_of_needs_timezone_and_cannot_be_future():
    assert "has no timezone" in errors_for(PA=provisional(10, 12, as_of="2026-11-05T01:30:00"))
    future = (NOW + timedelta(hours=2)).isoformat()
    assert "in the future" in errors_for(PA=provisional(10, 12, as_of=future))


def test_certified_needs_every_seat_called():
    msg = errors_for(NV=provisional(10, 12, status="certified", d_seats="2", r_seats="1"))
    assert "1 seat(s) uncalled" in msg


def test_reporting_pct_needs_a_source():
    assert "without reporting_source" in errors_for(NV=provisional(10, 12, reporting_pct="80"))
    assert "outside (0, 100]" in errors_for(NV=provisional(10, 12, reporting_pct="120", reporting_source="AP"))


def test_missing_and_duplicate_states():
    r = rows()
    assert "missing states: WY" in str(pytest.raises(ResultsFileError, parse_rows, r[:-1], NOW).value)
    assert "more than once" in str(pytest.raises(ResultsFileError, parse_rows, r + [r[0]], NOW).value)


def test_header_must_match(tmp_path):
    p = tmp_path / "bad.csv"
    p.write_text("code,status,votes\nAK,pending,\n")
    with pytest.raises(ResultsFileError, match="header mismatch"):
        load_results_csv(p, NOW)


# --- the built JSON -------------------------------------------------------------

def _el(phase: str = "counting") -> election.Election:
    return election.Election(
        cycle=2026, congress=120, election_date="2026-11-03",
        freeze_at=datetime(2026, 11, 3, 10, tzinfo=timezone.utc), congress_convenes="2027-01-03",
        baseline_cycle=2024, results_csv=SKELETON, phase=phase, now=NOW, rehearsal=False,
    )


@pytest.fixture(scope="module")
def frozen_projection() -> dict:
    p = json.loads((REPO_ROOT / "public" / "data" / "projection.json").read_text())
    p["meta"]["election"] = {"cycle": 2026, "phase": "counting", "freeze_at": "2026-11-03T10:00:00Z"}
    return p


def test_build_all_pending_is_all_pending(frozen_projection):
    payload = build_results.build(parse_rows(rows(), NOW), _el(), frozen_projection, "x.csv", NOW)
    nat = payload["national"]
    assert nat["under_pr"] == {"d_seats": 0, "r_seats": 0, "pending_seats": 435}
    assert nat["as_elected"]["uncalled_seats"] == 435
    assert payload["meta"]["status_counts"] == {"pending": 50, "provisional": 0, "certified": 0}
    assert payload["meta"]["as_of"] is None
    assert nat["two_party_d_margin_points"] is None


def test_build_allocates_counted_votes_by_sainte_lague(frozen_projection):
    # 60/40 over 10 seats → 6/4.
    res = parse_rows(rows(NJ=provisional(600, 400, d_seats="5", r_seats="2")), NOW)
    payload = build_results.build(res, _el(), frozen_projection, "x.csv", NOW)
    nj = next(s for s in payload["states"] if s["code"] == "NJ")
    assert nj["seats"] == 12
    assert nj["under_pr"]["d_seats"] + nj["under_pr"]["r_seats"] == 12
    assert nj["under_pr"]["d_seats"] == 7  # 60% of 12 = 7.2
    assert nj["as_elected"] == {"d_seats": 5, "r_seats": 2, "other_seats": 0, "uncalled_seats": 5}
    assert nj["two_party_share"] == {"d_share": 0.6, "r_share": 0.4}
    assert "final_projection" in nj
    assert payload["national"]["under_pr"]["pending_seats"] == 435 - 12
    assert payload["vs_final_projection"]["provisional"] is True


def test_build_before_the_freeze_has_no_projection_comparison():
    payload = build_results.build(parse_rows(rows(), NOW), _el("projection"), None, "x.csv", NOW)
    assert "vs_final_projection" not in payload
    assert all("final_projection" not in s for s in payload["states"])


def test_one_party_absent_is_flagged_not_guarded(frozen_projection):
    res = parse_rows(rows(VT=provisional(200, 0, d_seats="1")), NOW)
    vt = next(s for s in build_results.build(res, _el(), frozen_projection, "x.csv", NOW)["states"]
              if s["code"] == "VT")
    assert vt["baseline_distortion_warning"] is True
    assert vt["under_pr"] == {"d_seats": 1, "r_seats": 0}


# --- check_results ----------------------------------------------------------

@pytest.fixture
def published(tmp_path, monkeypatch, frozen_projection):
    """Write projection.json + results_2026.json into a temp public/data."""
    monkeypatch.setattr(validate_data, "PUBLIC_DATA", tmp_path)
    monkeypatch.delenv("GITHUB_ACTIONS", raising=False)
    (tmp_path / "projection.json").write_text(json.dumps(frozen_projection))
    res = parse_rows(rows(
        NJ=provisional(600, 400, d_seats="5", r_seats="2"),
        WY=provisional(90, 210, status="certified", r_seats="1"),
    ), NOW)
    payload = build_results.build(res, _el(), frozen_projection, "x.csv", NOW)

    def write(p: dict) -> list[str]:
        (tmp_path / "results_2026.json").write_text(json.dumps(p))
        errors: list[str] = []
        validate_data.check_results(errors)
        return errors

    return payload, write


def test_check_results_accepts_a_consistent_file(published):
    payload, write = published
    assert write(payload) == []


def test_check_results_catches_a_wrong_pr_winner(published):
    payload, write = published
    bad = copy.deepcopy(payload)
    wy = next(s for s in bad["states"] if s["code"] == "WY")
    wy["under_pr"] = {"d_seats": 1, "r_seats": 0}
    bad["national"]["under_pr"]["d_seats"] += 1
    bad["national"]["under_pr"]["r_seats"] -= 1
    assert any("PR gave D the only seat" in e for e in write(bad))


def test_check_results_catches_a_broken_partition(published):
    payload, write = published
    bad = copy.deepcopy(payload)
    next(s for s in bad["states"] if s["code"] == "NJ")["as_elected"]["uncalled_seats"] = 4
    assert any("doesn't partition" in e for e in write(bad))


def test_check_results_requires_the_file_after_the_freeze(tmp_path, monkeypatch, frozen_projection):
    monkeypatch.setattr(validate_data, "PUBLIC_DATA", tmp_path)
    (tmp_path / "projection.json").write_text(json.dumps(frozen_projection))
    errors: list[str] = []
    validate_data.check_results(errors)
    assert any("missing after the freeze" in e for e in errors)


def test_check_results_rejects_results_before_the_freeze(published, frozen_projection, tmp_path):
    payload, write = published
    p = copy.deepcopy(frozen_projection)
    p["meta"]["election"]["phase"] = "projection"
    (tmp_path / "projection.json").write_text(json.dumps(p))
    assert any("before the election freeze" in e for e in write(payload))
