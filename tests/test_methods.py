"""Tests for data-pipeline/methods.py (MMD / MMP) + national_by_method.

Run from repo root: pytest tests/test_methods.py

The shared fixture tests/fixtures/method_cases.json is generated from this same
module; tests/methods.parity.test.ts asserts the TypeScript implementation
against it, so a Python↔TS divergence (e.g. the Math.round rounding hazard)
surfaces as a failing parity test on the TS side.
"""

import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "data-pipeline"))

from methods import MethodAllocationInput, allocate_by_method, national_by_method  # noqa: E402
from update import project_states  # noqa: E402

FIXTURE = REPO_ROOT / "tests" / "fixtures" / "method_cases.json"
BASELINE = REPO_ROOT / "data-pipeline" / "baseline" / "house_2024.json"
METHODS = ("PR", "MMD-3", "MMD-5", "MMP-50")


def _cases():
    return json.loads(FIXTURE.read_text())["cases"]


def _input(case) -> MethodAllocationInput:
    i = case["input"]
    return MethodAllocationInput(
        total_seats=i["total_seats"],
        vote_shares=i["vote_shares"],
        party_ids=i["party_ids"],
        actual_d_seats=i["actual_d_seats"],
        actual_r_seats=i["actual_r_seats"],
    )


@pytest.mark.parametrize("case", _cases(), ids=lambda c: c["name"])
@pytest.mark.parametrize("method", METHODS)
def test_method_matches_fixture(case, method):
    assert allocate_by_method(_input(case), method) == case["expected"][method]


@pytest.mark.parametrize("case", _cases(), ids=lambda c: c["name"])
@pytest.mark.parametrize("method", METHODS)
def test_seats_sum_to_total(case, method):
    # Every method (incl. MMP overhang) must allocate exactly the state's seats.
    out = allocate_by_method(_input(case), method)
    assert sum(out) == case["input"]["total_seats"]


def test_national_pr_matches_pipeline():
    """national_by_method(..., 'PR') must equal the pipeline's Pure-PR seats
    for any swing — the consistency check that anchors the history series."""
    baseline = json.loads(BASELINE.read_text())["states"]
    for swing in (-6.0, 0.0, 3.5, 9.45):
        projected = project_states(baseline, swing)
        got = national_by_method(projected, "PR")
        exp = (
            sum(s["projected"]["d_seats"] for s in projected),
            sum(s["projected"]["r_seats"] for s in projected),
        )
        assert got == exp, f"swing={swing}: {got} != {exp}"
        assert got[0] + got[1] == 435


def test_national_methods_total_435():
    baseline = json.loads(BASELINE.read_text())["states"]
    projected = project_states(baseline, 9.45)
    for method in METHODS:
        d, r = national_by_method(projected, method)
        assert d + r == 435, f"{method}: {d}+{r} != 435"
