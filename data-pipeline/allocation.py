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
