"""Tests for data-pipeline/methods.py (MMD / MMP) + national_by_method.

Run from repo root: pytest tests/test_methods.py

The shared fixture tests/fixtures/method_cases.json is generated from this same
module by data-pipeline/generate_parity_fixtures.py; tests/methods.parity.test.ts
asserts the TypeScript implementation against it, so a Python↔TS divergence
(e.g. the Math.round rounding hazard) surfaces as a failing parity test on the
TS side. test_fixture_is_up_to_date below fails if the committed fixture drifts
from what the generator produces, so the two can never silently disagree.
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

_FIXTURE_DATA = json.loads(FIXTURE.read_text())
# Driven by the fixture rather than a local list, so a method added to the
# generator is covered here automatically. PR-DH and PR-HAM were dispatchable
# and user-selectable for a long time while sitting outside this tuple.
METHODS = tuple(_FIXTURE_DATA["methods"])


def _cases():
    return _FIXTURE_DATA["cases"]


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
    got = allocate_by_method(_input(case), method, case.get("params"))
    assert got == case["expected"][method]


@pytest.mark.parametrize("case", _cases(), ids=lambda c: c["name"])
@pytest.mark.parametrize("method", METHODS)
def test_seats_sum_to_total(case, method):
    # Every method (incl. MMP overhang) must allocate exactly the state's seats.
    out = allocate_by_method(_input(case), method, case.get("params"))
    assert sum(out) == case["input"]["total_seats"]


def test_fixture_is_up_to_date():
    """The committed fixture must match what the generator produces.

    Without this, methods.py could change while the fixture kept its old
    expectations — the TS parity test would then be checking TypeScript against
    a stale snapshot of Python rather than against Python itself.
    """
    from generate_parity_fixtures import build

    assert build() == _FIXTURE_DATA, (
        "tests/fixtures/method_cases.json is stale — regenerate with:\n"
        "  .venv/bin/python data-pipeline/generate_parity_fixtures.py"
    )


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


def test_published_share_precision_reproduces_seats():
    """Re-allocating from the *published* (rounded) shares must reproduce the
    pipeline's own seat counts, at every position of the Sandbox ballot slider.

    The Sandbox recomputes allocations client-side from projection.json rather
    than reading the stored seat counts, so any rounding coarse enough to
    reorder two adjacent quotients makes the browser disagree with the pipeline
    about the same state. At 4 decimals this happened 6 times across the range
    (NY, NJ, CO, ID among them); SHARE_PRECISION = 6 drives it to zero.
    """
    from allocation import AllocationInput, allocate
    from update import SHARE_PRECISION

    baseline = json.loads(BASELINE.read_text())["states"]
    mismatches = []
    # The UI clamps the generic ballot to ±15 points; step by 0.5 to keep the
    # test quick while still covering every marginal crossing in the range.
    for step in range(-30, 31):
        swing = step * 0.5
        for s in project_states(baseline, swing):
            d = round(s["projected"]["d_share"], SHARE_PRECISION)
            r = round(s["projected"]["r_share"], SHARE_PRECISION)
            got = allocate(
                AllocationInput(seats=s["seats"], d_votes=d * 1_000_000, r_votes=r * 1_000_000)
            )
            want = (s["projected"]["d_seats"], s["projected"]["r_seats"])
            if (got.d_seats, got.r_seats) != want:
                mismatches.append(f"swing={swing} {s['code']}: {got} != {want}")
    assert not mismatches, "published precision loses seats:\n" + "\n".join(mismatches[:10])
