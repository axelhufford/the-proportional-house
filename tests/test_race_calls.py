"""Tests for race calls (data-pipeline/race_calls.py).

Run from repo root: pytest tests/test_race_calls.py

Calls are added unattended on election night from news decision desks, then
turned into each state's called seats. These pin what a call must carry to be
accepted, and that automation can only ever add calls.
"""

import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "data-pipeline"))

import race_calls as rc  # noqa: E402
from results_file import COLUMNS as RESULT_COLUMNS, parse_rows  # noqa: E402

NOW = datetime(2026, 11, 4, 6, 0, tzinfo=timezone.utc)
HEADER = ",".join(rc.COLUMNS)
SRC = "https://apnews.com/article/race-call-example"


def calls(*lines: str) -> str:
    return "\n".join([HEADER, *lines]) + "\n"


def line(district="PA-07", party="D", caller="AP", called_at="2026-11-04T02:14:00Z", url=SRC, winner="A. Person"):
    return f"{district},{party},{winner},{caller},{called_at},{url},"


def errors(text: str) -> str:
    with pytest.raises(rc.CallsError) as e:
        rc.parse(text, NOW)
    return str(e.value)


def test_committed_file_is_empty_before_the_election():
    assert rc.parse(rc.CALLS.read_text(), NOW) == []


def test_valid_calls_and_district_normalization():
    rows = rc.parse(calls(line("pa-7"), line("WY-AL", "R", "DDHQ")), NOW)
    assert [r["district"] for r in rows] == ["PA-07", "WY-AL"]


@pytest.mark.parametrize("bad,message", [
    (line("PA-18"), "doesn't exist"),             # PA has 17 seats
    (line("WY-01"), "doesn't exist"),             # at-large state
    (line("PA-AL"), "doesn't exist"),
    (line("XX-01"), "unknown state"),
    (line(party="G"), "party"),
    (line(caller="Twitter"), "caller"),
    (line(called_at="2026-11-03T20:00:00Z"), "before the first polls closed"),
    (line(called_at="2026-11-04T09:00:00Z"), "in the future"),
    (line(called_at="2026-11-04T02:14:00"), "no timezone"),
    (line(url="http://apnews.com/x"), "https"),
    (line(url="https://en.wikipedia.org/wiki/X"), "not Wikipedia"),
])
def test_rejected_calls(bad, message):
    assert message in errors(calls(bad))


def test_a_district_can_only_be_called_once():
    assert "called twice" in errors(calls(line("PA-07"), line("PA-7", "R")))


def test_append_only():
    old = rc.parse(calls(line("PA-07")), NOW)
    rc.check_append_only(old, rc.parse(calls(line("PA-07"), line("PA-01", "R")), NOW))  # adding is fine
    with pytest.raises(rc.CallsError, match="edited"):
        rc.check_append_only(old, rc.parse(calls(line("PA-07", "R")), NOW))
    with pytest.raises(rc.CallsError, match="removed"):
        rc.check_append_only(old, rc.parse(calls(), NOW))


def _results(**over) -> list[dict]:
    rows = []
    for code in sorted(rc.APPORTIONMENT):
        r = {c: "" for c in RESULT_COLUMNS} | {"code": code, "status": "pending"}
        r.update(over.get(code, {}))
        rows.append(r)
    return rows


def test_apply_sets_called_seats_from_calls():
    c = rc.parse(calls(line("PA-07"), line("PA-01", "R"), line("PA-02", "D", "DDHQ"), line("WY-AL", "R")), NOW)
    rows, changed = rc.apply_calls(_results(), c)
    pa = next(r for r in rows if r["code"] == "PA")
    assert (pa["d_seats"], pa["r_seats"], pa["other_seats"]) == ("2", "1", "")
    assert len(changed) == 2
    parse_rows(rows, NOW)  # a pending state with called seats is valid


def test_apply_leaves_certified_states_alone():
    cert = {"status": "certified", "d_votes": "10", "r_votes": "20", "r_seats": "1",
            "source_url": "https://sos.wyo.gov/x", "as_of": "2026-11-04T01:00:00Z"}
    rows, changed = rc.apply_calls(_results(WY=cert), rc.parse(calls(line("WY-AL", "D")), NOW))
    assert next(r for r in rows if r["code"] == "WY")["r_seats"] == "1" and changed == []
