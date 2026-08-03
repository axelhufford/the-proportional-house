"""Seat-allocation methods for The Proportional House.

Mirrors src/lib/allocation.ts. Tie-breaking rules and edge-case behavior must
stay in sync with the TS implementation; tests/test_allocation.py runs the
shared fixture in tests/fixtures/allocation_cases.json.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable, List, Literal

Party = Literal["D", "R"]
Method = Literal["sainte-lague", "dhondt", "hamilton"]


@dataclass(frozen=True)
class AllocationInput:
    seats: int
    d_votes: float
    r_votes: float


@dataclass(frozen=True)
class AllocationResult:
    d_seats: int
    r_seats: int


# --- N-party allocation -----------------------------------------------------
# Mirrors `allocateN` in src/lib/allocation.ts. Used by the Electoral College
# build (allocate a state's electors across all presidential candidates) and,
# via `allocate` below, by every two-party caller. Parity is guarded by the
# shared fixture tests/fixtures/allocation_cases.json, consumed by both
# tests/test_allocation.py and allocation.test.ts.


@dataclass(frozen=True)
class AllocationInputN:
    seats: int
    votes: List[float]  # vote totals per party; order preserved in the result


def _validate(inp: AllocationInputN) -> None:
    """Reject inputs that would produce meaningless seat counts.

    Without this, a NaN vote total silently poisons the sort comparator and a
    negative one can produce a *negative* seat count (floor(-2.5) = -3), which
    would render in the UI as "−3 seats" rather than failing loudly.
    """
    if not math.isfinite(inp.seats):
        raise ValueError(f"allocation: seats must be finite (got {inp.seats})")
    for i, v in enumerate(inp.votes):
        if not math.isfinite(v) or v < 0:
            raise ValueError(
                f"allocation: vote totals must be finite and non-negative "
                f"(party index {i} got {v})"
            )


def _divisor_method_n(
    inp: AllocationInputN,
    divisor_for: Callable[[int], int],
) -> List[int]:
    votes = list(inp.votes)
    n = len(votes)
    if inp.seats <= 0 or n == 0:
        return [0] * n
    # All-zero votes → no seats earned (avoid handing seats out purely on the
    # index tie-break). Matches the TS implementation.
    if sum(votes) <= 0:
        return [0] * n

    # (party_idx, value, votes)
    quotients: List[tuple[int, float, float]] = []
    for r in range(inp.seats):
        div = divisor_for(r)
        for p in range(n):
            quotients.append((p, votes[p] / div, votes[p]))

    # Higher quotient wins; ties → larger vote total; final ties → lower index.
    quotients.sort(key=lambda q: (-q[1], -q[2], q[0]))

    result = [0] * n
    for i in range(inp.seats):
        result[quotients[i][0]] += 1
    return result


def _hamilton_n(inp: AllocationInputN) -> List[int]:
    votes = list(inp.votes)
    n = len(votes)
    if inp.seats <= 0 or n == 0:
        return [0] * n
    total = sum(votes)
    if total <= 0:
        return [0] * n

    quotas = [(v / total) * inp.seats for v in votes]
    floors = [int(q) for q in quotas]  # floor for non-negative floats
    result = floors[:]
    remaining = inp.seats - sum(floors)

    # Largest fractional remainder first; ties → more votes; final ties → lower
    # index. Distribute leftover seats round-robin down that order.
    order = sorted(range(n), key=lambda i: (-(quotas[i] - floors[i]), -votes[i], i))
    cursor = 0
    while remaining > 0:
        result[order[cursor % n]] += 1
        cursor += 1
        remaining -= 1
    return result


def allocate_n(inp: AllocationInputN, method: Method = "sainte-lague") -> List[int]:
    """Allocate `inp.seats` among the parties in `inp.votes`, returning seats per
    party in input order. Mirrors src/lib/allocation.ts `allocateN`."""
    _validate(inp)
    if method == "sainte-lague":
        return _divisor_method_n(inp, lambda i: 2 * i + 1)
    if method == "dhondt":
        return _divisor_method_n(inp, lambda i: i + 1)
    if method == "hamilton":
        return _hamilton_n(inp)
    raise ValueError(f"Unknown allocation method: {method}")


def allocate(inp: AllocationInput, method: Method = "sainte-lague") -> AllocationResult:
    """Two-party allocator — the canonical API for the rest of the pipeline.

    Delegates to `allocate_n` with party order [D, R], mirroring the same
    delegation in src/lib/allocation.ts. Keeping a single implementation is
    what guarantees the two-party and N-party paths agree with each other and
    with TypeScript — a separate two-party implementation previously handed
    *every* seat to D when both parties had zero votes, because it lacked the
    all-zero guard that `_divisor_method_n` has.
    """
    d, r = allocate_n(
        AllocationInputN(seats=inp.seats, votes=[inp.d_votes, inp.r_votes]),
        method,
    )
    return AllocationResult(d, r)
