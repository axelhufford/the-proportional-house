"""Tests for the per-state House composition parser in fetch_clerk_house.py.

Run from repo root: pytest tests/test_house_composition.py

This parser had silently rotted: Wikipedia moved to Parsoid HTML, where every
element carries id="mw…" attributes, so regexes anchored on bare `<tr>` and
`<th>` tags matched nothing and the scrape returned zero states. Nothing caught
it because the scrape only ran behind `--refresh`, and no test covered it.

The fixture is the 'Per state' wikitext section, committed so these run offline.
"""

import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "data-pipeline"))

from fetch_clerk_house import parse_house_composition  # noqa: E402

FIXTURE = REPO_ROOT / "tests" / "fixtures" / "wikipedia_per_state_2024.wikitext"
BASELINE = REPO_ROOT / "data-pipeline" / "baseline" / "house_2024.json"

# The November 2024 general-election result — the same ground truth
# validate_data.KNOWN_ACTUAL uses for the 2024 cycle.
EXPECTED_NATIONAL = {"d": 215, "r": 220}


@pytest.fixture(scope="module")
def composition():
    return parse_house_composition(FIXTURE.read_text())


def test_covers_all_fifty_states(composition):
    assert len(composition) == 50


def test_seats_total_435(composition):
    assert sum(v["seats"] for v in composition.values()) == 435


def test_national_matches_known_2024_result(composition):
    d = sum(v["d_seats"] for v in composition.values())
    r = sum(v["r_seats"] for v in composition.values())
    assert {"d": d, "r": r} == EXPECTED_NATIONAL


def test_every_state_sums_to_its_seat_total(composition):
    for code, v in composition.items():
        assert v["d_seats"] + v["r_seats"] == v["seats"], code


@pytest.mark.parametrize(
    "code,seats,d_seats,r_seats",
    [
        ("CA", 52, 43, 9),   # shading template on the D column
        ("TX", 38, 13, 25),  # shading template on the R column
        ("CO", 8, 4, 4),     # even split — bold on both columns, no shading
        ("WY", 1, 0, 1),     # single-seat state
        ("AK", 1, 0, 1),
    ],
)
def test_representative_rows(composition, code, seats, d_seats, r_seats):
    """Covers each cell shape: `|7`, `| {{Party shading/X}} |'''5'''`, and
    `|'''4'''` (bold with no shading), plus 1-seat states."""
    assert composition[code] == {"seats": seats, "d_seats": d_seats, "r_seats": r_seats}


def test_matches_the_committed_baseline(composition):
    """The parser must reproduce what house_2024.json already ships.

    This is the check that would have caught the rot: if the parser starts
    returning something different from the committed baseline, either the
    source table changed or the parser broke — either way a human should look
    before `--refresh` overwrites the file.
    """
    baseline = json.loads(BASELINE.read_text())["states"]
    for s in baseline:
        got = composition[s["code"]]
        assert got["seats"] == s["seats"], s["code"]
        assert got["d_seats"] == s["actual_d_seats_119th"], s["code"]
        assert got["r_seats"] == s["actual_r_seats_119th"], s["code"]


def test_rejects_a_truncated_table():
    text = FIXTURE.read_text()
    truncated = "\n".join(text.split("\n")[:20]) + "\n|}"
    with pytest.raises(RuntimeError, match="Expected 50 states"):
        parse_house_composition(truncated)


def test_rejects_missing_section():
    with pytest.raises(RuntimeError, match="Per state"):
        parse_house_composition("== Something else ==\nno table here\n")
