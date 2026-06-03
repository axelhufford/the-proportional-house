"""Seat-allocation methods for The Proportional House.

Mirrors src/lib/allocation.ts. Tie-breaking rules and edge-case behavior must
stay in sync with the TS implementation; tests/test_allocation.py runs the
shared fixture in tests/fixtures/allocation_cases.json.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, List, Literal

EPSILON = 1e-9

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


def _divisor_method(
    inp: AllocationInput,
    divisor_for: Callable[[int], int],
) -> AllocationResult:
    if inp.seats <= 0:
        return AllocationResult(0, 0)

    # (party, value, votes)
    quotients: List[tuple[Party, float, float]] = []
    for i in range(inp.seats):
        div = divisor_for(i)
        quotients.append(("D", inp.d_votes / div, inp.d_votes))
        quotients.append(("R", inp.r_votes / div, inp.r_votes))

    # Sort descending by value. Ties broken by larger vote total, then 'D' < 'R'.
    def sort_key(q: tuple[Party, float, float]) -> tuple[float, float, int]:
        party, value, votes = q
        return (-value, -votes, 0 if party == "D" else 1)

    quotients.sort(key=sort_key)

    d = 0
    r = 0
    for i in range(inp.seats):
        if quotients[i][0] == "D":
            d += 1
        else:
            r += 1
    return AllocationResult(d, r)


def _sainte_lague(inp: AllocationInput) -> AllocationResult:
    return _divisor_method(inp, lambda i: 2 * i + 1)


def _dhondt(inp: AllocationInput) -> AllocationResult:
    return _divisor_method(inp, lambda i: i + 1)


def _hamilton(inp: AllocationInput) -> AllocationResult:
    if inp.seats <= 0:
        return AllocationResult(0, 0)
    total = inp.d_votes + inp.r_votes
    if total <= 0:
        return AllocationResult(0, 0)

    d_quota = (inp.d_votes / total) * inp.seats
    r_quota = (inp.r_votes / total) * inp.seats
    d = int(d_quota)  # floor for non-negative floats
    r = int(r_quota)
    remaining = inp.seats - d - r

    d_rem = d_quota - d
    r_rem = r_quota - r
    while remaining > 0:
        if d_rem > r_rem + EPSILON:
            d += 1
        elif r_rem > d_rem + EPSILON:
            r += 1
        elif inp.d_votes >= inp.r_votes:
            d += 1
        else:
            r += 1
        remaining -= 1
    return AllocationResult(d, r)


def allocate(inp: AllocationInput, method: Method = "sainte-lague") -> AllocationResult:
    if method == "sainte-lague":
        return _sainte_lague(inp)
    if method == "dhondt":
        return _dhondt(inp)
    if method == "hamilton":
        return _hamilton(inp)
    raise ValueError(f"Unknown allocation method: {method}")


# --- N-party allocation -----------------------------------------------------
# Mirrors `allocateN` in src/lib/allocation.ts. Used by the Electoral College
# build (allocate a state's electors across all presidential candidates).
# Parity is guarded by the shared fixture tests/fixtures/allocation_cases.json
# ("cases_n"), consumed by both tests/test_allocation.py and allocation.test.ts.


@dataclass(frozen=True)
class AllocationInputN:
    seats: int
    votes: List[float]  # vote totals per party; order preserved in the result


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
    if method == "sainte-lague":
        return _divisor_method_n(inp, lambda i: 2 * i + 1)
    if method == "dhondt":
        return _divisor_method_n(inp, lambda i: i + 1)
    if method == "hamilton":
        return _hamilton_n(inp)
    raise ValueError(f"Unknown allocation method: {method}")
