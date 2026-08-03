"""Tests for the live House composition parser (data-pipeline/fetch_live_composition.py).

Run from repo root: pytest tests/test_live_composition.py

The fixture is a trimmed copy of the Clerk's MemberData.xml — every element the
parser reads, nothing else — so these run offline. Regenerate it from
https://clerk.house.gov/xml/lists/MemberData.xml when the chamber changes.

Two behaviors here are easy to get wrong and are the reason this file exists:

  * Vacant seats are still <member> entries. A parser that keys off "has a name"
    without counting them loses the 435-district structure.
  * <party> and <caucus> disagree for members sitting as independents. Chamber
    composition follows the caucus.
"""

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "data-pipeline"))

from fetch_live_composition import TOTAL_SEATS, parse_member_data  # noqa: E402

FIXTURE = REPO_ROOT / "tests" / "fixtures" / "clerk_memberdata.xml"


@pytest.fixture(scope="module")
def payload():
    return parse_member_data(FIXTURE.read_text())


def test_covers_all_fifty_states(payload):
    assert len(payload["states"]) == 50


def test_chamber_sums_to_435(payload):
    n = payload["national"]
    assert n["d_seats"] + n["r_seats"] + n["other_seats"] + n["vacant"] == TOTAL_SEATS
    assert n["total_seats"] == TOTAL_SEATS


def test_every_state_sums_to_its_apportionment(payload):
    for s in payload["states"]:
        total = s["d_seats"] + s["r_seats"] + s["other_seats"] + s["vacant"]
        assert total == s["seats"], s["code"]


def test_non_voting_delegates_are_excluded(payload):
    """DC, PR, GU, VI, AS ("AQ") and MP have delegates but no House seats."""
    codes = {s["code"] for s in payload["states"]}
    assert not (codes & {"DC", "PR", "GU", "VI", "AQ", "AS", "MP"})


def test_caucus_beats_party_for_independents(payload):
    """CA-03 (Kiley) is party="I", caucus="R".

    Counting <party> would put him in `other_seats` and understate the R total.
    California has no members who caucus outside the two parties, so its
    other_seats must be zero.
    """
    ca = next(s for s in payload["states"] if s["code"] == "CA")
    assert ca["other_seats"] == 0
    assert ca["r_seats"] == 9


def test_vacancies_are_counted_and_explained(payload):
    vac = payload["vacancies"]
    assert len(vac) == payload["national"]["vacant"]
    assert {v["code"] for v in vac} == {"CA", "FL", "GA", "TX"}
    for v in vac:
        # The Clerk always states a cause; publishing an unexplained empty seat
        # is exactly what this assertion prevents.
        assert v["reason"].strip(), f"{v['code']}-{v['district']}"
        assert "Vacancy due to" in v["reason"]


def test_vacant_seats_are_not_attributed_to_a_party(payload):
    """A vacancy must reduce neither party's count below its real total."""
    ca = next(s for s in payload["states"] if s["code"] == "CA")
    assert ca["vacant"] == 1
    # 42 D + 9 R + 1 vacant = 52; the vacant seat is its own bucket.
    assert ca["d_seats"] == 42


def test_carries_provenance(payload):
    meta = payload["meta"]
    assert meta["congress"] == 119
    assert meta["publish_date"]
    assert meta["source_url"].startswith("https://clerk.house.gov/")


def test_rejects_a_truncated_feed():
    """Refuse to publish a partial chamber rather than reporting fewer seats."""
    text = FIXTURE.read_text()
    cut = text[: text.index("<member><statedistrict>CA")] + "</members></MemberData>"
    with pytest.raises(RuntimeError, match="expected 435"):
        parse_member_data(cut)


def test_rejects_a_state_whose_district_count_disagrees_with_apportionment():
    """Drop one Wyoming seat: the per-state cross-check must fire."""
    text = FIXTURE.read_text()
    start = text.index("<member><statedistrict>WY")
    end = text.index("</member>", start) + len("</member>")
    with pytest.raises(RuntimeError, match="expected 435|apportionment"):
        parse_member_data(text[:start] + text[end:])


def test_rejects_a_vacancy_with_no_stated_reason():
    text = FIXTURE.read_text().replace(
        "Vacancy due to the resignation of Eric Swalwell, April 14, 2026.", "", 1
    )
    with pytest.raises(RuntimeError, match="no stated reason"):
        parse_member_data(text)
