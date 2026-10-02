"""Tests for the Wikipedia results-draft parser (data-pipeline/scrape_results_draft.py).

Run from repo root: pytest tests/test_scrape_results_draft.py

Offline: the fixture holds the infoboxes of three real 2024 per-state articles
(a multi-seat state, one whose parties are named for the state — Minnesota's
DFL — and an at-large state that lists nominees instead of seats).
"""

import csv
import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "data-pipeline"))

import scrape_results_draft as srd  # noqa: E402
from results_file import COLUMNS, load_results_csv, parse_rows, write_skeleton  # noqa: E402

FIXTURE = json.loads((REPO_ROOT / "tests" / "fixtures" / "wikipedia_infoboxes_2024.json").read_text())


def infobox(title_suffix: str) -> tuple[dict, dict]:
    title = next(t for t in FIXTURE if t.endswith(title_suffix))
    rev = FIXTURE[title]
    return srd.extract_infobox(rev["text"]), rev


def test_article_titles_use_the_singular_for_at_large_states():
    assert srd.article_title(2026, "Wyoming", 1) == "2026 United States House of Representatives election in Wyoming"
    assert srd.article_title(2026, "Texas", 38).endswith("elections in Texas")


@pytest.mark.parametrize("name,bucket", [
    ("Minnesota Democratic–Farmer–Labor Party", "D"),
    ("Republican Party of Minnesota", "R"),
    ("[[Democratic Party (United States)|Democratic]]", "D"),
    ("Libertarian Party (United States)", "O"),
    ("Independent politician", "O"),
])
def test_party_bucket(name, bucket):
    assert srd.party_bucket(name) == bucket


def test_multi_seat_state_reads_votes_and_seats_through_bold_markup():
    info, rev = infobox("in Pennsylvania")
    row = srd.draft_row("PA", info, rev)
    assert (row["d_votes"], row["r_votes"]) == ("3338371", "3481113")
    assert (row["d_seats"], row["r_seats"]) == ("7", "10")
    assert row["status"] == "provisional"
    assert row["source_url"] == f"https://en.wikipedia.org/w/index.php?oldid={rev['revid']}"
    assert row["as_of"] == rev["timestamp"]


def test_state_named_parties_map_to_d_and_r():
    info, rev = infobox("in Minnesota")
    row = srd.draft_row("MN", info, rev)
    assert (row["d_votes"], row["r_votes"], row["d_seats"], row["r_seats"]) == ("1579742", "1550499", "4", "4")


def test_at_large_winner_comes_from_after_party():
    info, rev = infobox("in Wyoming")
    row = srd.draft_row("WY", info, rev)
    assert (row["d_votes"], row["r_votes"]) == ("60778", "184680")
    assert (row["d_seats"], row["r_seats"]) == ("0", "1")


def test_at_large_winner_not_taken_while_ongoing():
    info, rev = infobox("in Wyoming")
    row = srd.draft_row("WY", {**info, "ongoing": "yes"}, rev)
    assert row["r_seats"] == "" and "votes only" in row["note"]
    assert row["r_votes"] == "184680"


def test_seats_never_taken_while_counting():
    # Mid-count, seatsN can still be last cycle's numbers.
    info, rev = infobox("in Pennsylvania")
    row = srd.draft_row("PA", {**info, "ongoing": "yes"}, rev)
    assert (row["d_seats"], row["r_seats"]) == ("", "")
    assert row["d_votes"] == "3338371"


def test_prefilled_seats_without_votes_are_ignored():
    # How 2026 articles look before the election: seatsN copied from 2024.
    pre = {"ongoing": "yes", "party1": "Republican Party (United States)", "last_election1": "25",
           "seats1": "'''25'''", "party2": "Democratic Party (United States)", "last_election2": "13",
           "seats2": "13"}
    row = srd.draft_row("TX", pre, {"revid": 1, "timestamp": "2026-09-30T00:00:00Z"})
    assert row["status"] == "pending"
    assert (row["d_seats"], row["r_seats"]) == ("", "")


def test_missing_article_is_pending():
    assert srd.draft_row("TX", None, None)["status"] == "pending"


def test_drafted_rows_validate_as_a_results_file():
    draft = []
    for code, suffix in (("PA", "in Pennsylvania"), ("MN", "in Minnesota"), ("WY", "in Wyoming")):
        info, rev = infobox(suffix)
        draft.append(srd.draft_row(code, info, rev))
    others = [{c: "" for c in COLUMNS} | {"code": c, "status": "pending"}
              for c in srd.APPORTIONMENT if c not in {"PA", "MN", "WY"}]
    parse_rows(draft + others)


def test_apply_never_certifies_and_skips_certified_rows(tmp_path):
    curated = tmp_path / "house.csv"
    write_skeleton(curated)
    rows = list(csv.DictReader(curated.open()))
    wy = next(r for r in rows if r["code"] == "WY")
    wy.update(status="certified", d_votes="1", r_votes="2", r_seats="1",
              source_url="https://sos.wyo.gov/x", as_of="2026-09-01T12:00:00-06:00")
    with curated.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS); w.writeheader(); w.writerows(rows)

    draft = []
    for code, suffix in (("PA", "in Pennsylvania"), ("WY", "in Wyoming")):
        info, rev = infobox(suffix)
        draft.append(srd.draft_row(code, info, rev))
    srd.apply(curated, draft, ["PA", "WY"])

    after = {r.code: r for r in load_results_csv(curated)}
    assert after["PA"].status == "provisional" and after["PA"].d_votes == 3_338_371
    assert after["WY"].status == "certified" and after["WY"].r_votes == 2  # untouched
