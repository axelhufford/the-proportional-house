"""Regenerate tests/fixtures/method_cases.json from data-pipeline/methods.py.

Run from the repo root:

    .venv/bin/python data-pipeline/generate_parity_fixtures.py

The MMD/MMP fixture is the Python↔TypeScript parity guard: expected values are
produced here, and tests/methods.parity.test.ts asserts that src/lib/methods.ts
reproduces them exactly. Generating rather than hand-maintaining is what keeps
the fixture honest — a hand-edited expectation can be quietly nudged to match
whichever side changed.

CI runs this and fails if the output differs from the committed file, so a
change to methods.py that shifts any expected value must be committed together
with the regenerated fixture, which in turn makes the TS parity test fail until
src/lib/methods.ts is updated to match.

NOT generated: tests/fixtures/allocation_cases.json. Those expected values are
hand-computed on purpose (see the comment at the top of that file) — the base
allocator is where an independent check has the most value, so freezing
auto-generated numbers there would weaken the guarantee rather than strengthen
it. Add cases to that file by hand.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "data-pipeline"))

from methods import MethodAllocationInput, allocate_by_method  # noqa: E402

FIXTURE = REPO_ROOT / "tests" / "fixtures" / "method_cases.json"

# Every method the Sandbox can dispatch. PR-DH and PR-HAM were previously
# absent from the fixture even though both are selectable in the UI, so the
# two implementations could drift on them unobserved.
METHODS = ["PR", "PR-DH", "PR-HAM", "MMD-3", "MMD-5", "MMP-50"]


def case(
    name: str,
    total_seats: int,
    vote_shares: list[float],
    actual_d_seats: int,
    actual_r_seats: int,
    party_ids: list[str] | None = None,
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "name": name,
        "input": {
            "total_seats": total_seats,
            "vote_shares": vote_shares,
            "party_ids": party_ids or ["D", "R"],
            "actual_d_seats": actual_d_seats,
            "actual_r_seats": actual_r_seats,
        },
    }
    if params:
        entry["params"] = params
    return entry


# Real-state shapes, carried over from the original hand-written fixture.
CASES: list[dict[str, Any]] = [
    case("ca-d55", 52, [0.55, 0.45], 26, 26),
    case("tx-r58", 38, [0.42, 0.58], 12, 26),
    case("nc-tossup", 14, [0.49, 0.51], 6, 8),
    case("odd9-mmp-round", 9, [0.52, 0.48], 5, 4),
    case("single-seat-d", 1, [0.45, 0.55], 0, 1),
    case("single-seat-r", 1, [0.6, 0.4], 1, 0),
    case("mmp-overhang", 10, [0.3, 0.7], 8, 2),
    case("tie8", 8, [0.5, 0.5], 4, 4),
    case("ca-r-wave", 52, [0.4, 0.6], 20, 32),
    case("md-d-dom", 8, [0.66, 0.34], 7, 1),
    # --- edge cases the original fixture did not reach -----------------------
    # MMP with no actual delegation to seed the single-member tier. This
    # previously stranded the SMD seats: sum(seats) came out below total_seats.
    case("mmp-no-actual-delegation", 10, [0.3, 0.7], 0, 0),
    case("mmp-no-actual-delegation-odd", 7, [0.55, 0.45], 0, 0),
    # Non-default slider positions — the Sandbox emits these, but no fixture
    # case exercised a magnitude or SMD share away from the preset.
    case("mmp-smd-30", 20, [0.52, 0.48], 11, 9, params={"mmp_smd_share": 0.3}),
    case("mmp-smd-70", 20, [0.52, 0.48], 11, 9, params={"mmp_smd_share": 0.7}),
    case("mmp-smd-0", 12, [0.58, 0.42], 7, 5, params={"mmp_smd_share": 0.0}),
    case("mmp-smd-100", 12, [0.58, 0.42], 7, 5, params={"mmp_smd_share": 1.0}),
    case("mmd-magnitude-2", 15, [0.53, 0.47], 8, 7, params={"mmd_magnitude": 2}),
    case("mmd-magnitude-4", 15, [0.53, 0.47], 8, 7, params={"mmd_magnitude": 4}),
    case("mmd-magnitude-10", 15, [0.53, 0.47], 8, 7, params={"mmd_magnitude": 10}),
    # Near-tied quotients. These land inside the 1e-9 window where an epsilon
    # comparator and an exact comparator rank differently; both sides must now
    # compare exactly. The odd-looking share literals are deliberate — they are
    # the exact doubles that produce the divergence.
    case("epsilon-sl-50", 50, [0.57, 0.43000000000000005], 25, 25),
    case("epsilon-sl-20", 20, [0.575, 0.42500000000000004], 10, 10),
    case("epsilon-dh-24", 24, [0.32, 0.6799999999999999], 10, 14),
    # Degenerate totals.
    case("zero-seats", 0, [0.5, 0.5], 0, 0),
    case("one-seat-exact-tie", 1, [0.5, 0.5], 1, 0),
    # Three-party shapes. MMP has to locate D and R by id, not by position.
    case("three-party", 10, [0.45, 0.4, 0.15], 5, 5, party_ids=["D", "R", "G"]),
    case(
        "three-party-epsilon",
        2,
        [0.01, 0.33, 0.6599999999999999],
        1,
        1,
        party_ids=["D", "R", "G"],
    ),
    case(
        "three-party-r-first",
        12,
        [0.35, 0.5, 0.15],
        4,
        8,
        party_ids=["R", "D", "G"],
    ),
]


def build() -> dict[str, Any]:
    cases = []
    for c in CASES:
        i = c["input"]
        inp = MethodAllocationInput(
            total_seats=i["total_seats"],
            vote_shares=i["vote_shares"],
            party_ids=i["party_ids"],
            actual_d_seats=i["actual_d_seats"],
            actual_r_seats=i["actual_r_seats"],
        )
        params = c.get("params")
        expected = {m: allocate_by_method(inp, m, params) for m in METHODS}
        # Guard the generator itself: never freeze an expectation that violates
        # the core invariant. A method that loses or invents seats is a bug in
        # methods.py, not a fixture to be committed.
        for m, seats in expected.items():
            if sum(seats) != i["total_seats"]:
                raise SystemExit(
                    f"{c['name']} / {m}: seats sum to {sum(seats)}, "
                    f"expected {i['total_seats']} — refusing to write fixture"
                )
        out = {"name": c["name"], "input": i}
        if params:
            out["params"] = params
        out["expected"] = expected
        cases.append(out)
    return {
        "_comment": (
            "Shared MMD/MMP parity fixture. GENERATED — do not hand-edit. "
            "Regenerate with: .venv/bin/python data-pipeline/generate_parity_fixtures.py. "
            "tests/test_methods.py (Python) and tests/methods.parity.test.ts (TS) both "
            "assert against it. expected[method] = seats per party, in vote_shares order. "
            "`params` (when present) carries mmd_magnitude / mmp_smd_share overrides."
        ),
        "methods": METHODS,
        "cases": cases,
    }


def main() -> None:
    payload = build()
    text = json.dumps(payload, indent=2) + "\n"
    if "--check" in sys.argv:
        current = FIXTURE.read_text() if FIXTURE.exists() else ""
        if current != text:
            raise SystemExit(
                f"{FIXTURE.relative_to(REPO_ROOT)} is out of date.\n"
                "Run: .venv/bin/python data-pipeline/generate_parity_fixtures.py"
            )
        print(f"{FIXTURE.relative_to(REPO_ROOT)} is up to date.")
        return
    FIXTURE.write_text(text)
    print(f"Wrote {len(payload['cases'])} cases × {len(METHODS)} methods to {FIXTURE.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
