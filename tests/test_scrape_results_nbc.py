"""Tests for the NBC News (AP count) vote-total scraper (data-pipeline/scrape_results_nbc.py).

Run from repo root: pytest tests/test_scrape_results_nbc.py

The inputs are small hand-built pageProps in the shape NBC embeds — synthetic,
never published.
"""

import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "data-pipeline"))

import scrape_results_nbc as nbc  # noqa: E402
from results_file import APPORTIONMENT, COLUMNS, parse_rows  # noqa: E402
from scrape_results_draft import apply, read_curated  # noqa: E402

FIPS = nbc.fips_to_code()
CODE_FIPS = {code: f for f, code in FIPS.items()}


def race(code, n, cands, remaining=0):
    """One mapData entry: cands = [(party, votes), …]."""
    return f"{CODE_FIPS[code]}{n:02d}", {"tooltip": {
        "officeCode": "H", "electionTypeCode": "G", "raceName": f"{code} District {n}",
        "totalVote": sum(v for _, v in cands), "remainingVote": remaining,
        "candidates": [{"party": p, "votes": v} for p, v in cands],
    }}


def props(*entries, current="2026-11-04T14:01:49.193Z"):
    return {
        "currentTime": current,
        "mapData": dict(entries),
        "tableData": {"states": [{"stateAbbr": "NH", "href": "/politics/2026-elections/new-hampshire-house-results"}]},
    }


def rows_by_code(p):
    rows, warnings = nbc.draft_rows(p, FIPS)
    return {r["code"]: r for r in rows}, warnings


def test_sums_districts_by_party_with_reporting_and_uncontested():
    p = props(
        race("NH", 1, [("Dem", 200), ("Rep", 150), ("Lib", 10)], remaining=40),
        race("NH", 2, [("Dem", 120), ("Dem", 80)], remaining=0),  # same-party top-two style race
    )
    rows, warnings = rows_by_code(p)
    nh = rows["NH"]
    assert not [w for w in warnings if w.startswith("NH")]  # the other 49 states aren't in this page
    assert (nh["d_votes"], nh["r_votes"], nh["other_votes"]) == ("400", "150", "10")
    assert nh["reporting_pct"] == "93.3"            # 560 of 600 expected
    assert nh["reporting_source"] == nbc.REPORTING_SOURCE
    assert nh["uncontested_districts"] == "1"       # NH-02 has no Republican
    assert nh["as_of"] == "2026-11-04T14:01:49Z"
    assert nh["source_url"] == "https://www.nbcnews.com/politics/2026-elections/new-hampshire-house-results"
    assert nh["status"] == "provisional"
    assert all(nh[k] == "" for k in ("d_seats", "r_seats", "other_seats"))  # seats come from race calls


def test_states_without_votes_or_with_missing_districts_stay_pending():
    p = props(
        race("NH", 1, [("Dem", 0), ("Rep", 0)], remaining=1000),
        race("NH", 2, [("Dem", 0), ("Rep", 0)], remaining=1000),
        race("PA", 1, [("Dem", 100), ("Rep", 90)]),  # 1 of PA's 17 districts
    )
    rows, warnings = rows_by_code(p)
    assert rows["NH"]["status"] == "pending" and rows["NH"]["d_votes"] == ""
    assert rows["PA"]["status"] == "pending"
    assert any(w.startswith("PA: NBC lists 1 House races") for w in warnings)
    assert len(rows) == 50
    parse_rows(list(rows.values()))  # the draft validates


def test_at_large_state_key_and_non_house_entries():
    p = props(
        race("WY", 1, [("Rep", 900), ("Dem", 600)]),
        ("5699", {"tooltip": {"officeCode": "S", "electionTypeCode": "G", "candidates": [{"party": "Dem", "votes": 5}]}}),
    )
    rows, _ = rows_by_code(p)
    assert (rows["WY"]["d_votes"], rows["WY"]["r_votes"]) == ("600", "900")
    assert rows["WY"]["reporting_pct"] == "100"


def test_page_without_embedded_data_is_an_error():
    with pytest.raises(nbc.NbcFormatError):
        nbc.page_props("<html>no data</html>")
    html = '<script id="__NEXT_DATA__" type="application/json">' + json.dumps({"props": {"pageProps": {"x": 1}}}) + "</script>"
    assert nbc.page_props(html) == {"x": 1}


def test_apply_copies_votes_and_reporting_but_never_seats(tmp_path):
    curated = tmp_path / "house.csv"
    base = [{c: "" for c in COLUMNS} | {"code": code, "status": "pending"} for code in sorted(APPORTIONMENT)]
    for r in base:
        if r["code"] == "NH":
            r.update({"d_seats": "1", "r_seats": "1"})
    import csv
    with curated.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(base)
    draft, _ = nbc.draft_rows(props(
        race("NH", 1, [("Dem", 200), ("Rep", 150)], remaining=50),
        race("NH", 2, [("Dem", 180), ("Rep", 170)], remaining=50),
    ), FIPS)
    apply(curated, draft, ["NH"], nbc.NBC_FIELDS)
    nh = read_curated(curated)["NH"]
    assert (nh["status"], nh["d_votes"], nh["r_votes"], nh["reporting_pct"]) == ("provisional", "380", "320", "87.5")
    assert (nh["d_seats"], nh["r_seats"]) == ("1", "1")
