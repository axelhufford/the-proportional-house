"""Parity tests for data-pipeline/allocation.py against the shared fixture.

Run from repo root: pytest tests/test_allocation.py
"""

import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "data-pipeline"))

from allocation import AllocationInput, allocate  # noqa: E402

FIXTURE_PATH = REPO_ROOT / "tests" / "fixtures" / "allocation_cases.json"
METHODS = ("sainte-lague", "dhondt", "hamilton")


def _load_cases():
    with FIXTURE_PATH.open() as f:
        data = json.load(f)
    return data["cases"]


@pytest.mark.parametrize("case", _load_cases(), ids=lambda c: c["name"])
@pytest.mark.parametrize("method", METHODS)
def test_allocation_parity(case, method):
    inp = AllocationInput(
        seats=case["input"]["seats"],
        d_votes=case["input"]["d_votes"],
        r_votes=case["input"]["r_votes"],
    )
    expected = case["expected"][method]
    result = allocate(inp, method)
    assert result.d_seats == expected["d_seats"], (
        f"{case['name']} [{method}]: expected D={expected['d_seats']}, got D={result.d_seats}"
    )
    assert result.r_seats == expected["r_seats"], (
        f"{case['name']} [{method}]: expected R={expected['r_seats']}, got R={result.r_seats}"
    )
