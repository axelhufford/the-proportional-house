"""Allocation-method dispatchers (MMD / MMP) for the projection-over-time series.

Mirrors src/lib/methods.ts. Used by build_history.py to precompute, for each
historical date, what the national delegation would have been under MMD-3,
MMD-5, and MMP-50 (in addition to the Pure-PR line). Two-party only here —
minors / per-state thresholds / House-size reapportionment stay Sandbox-only.

PORTING NOTE — rounding parity: TypeScript `Math.round()` rounds halves UP
(toward +inf), but Python's built-in `round()` uses banker's rounding
(half-to-even). Where methods.ts calls `Math.round` (MMP's SMD count and the
D/R SMD split) we use `_round_half_up` so odd-seat MMP states match the TS
implementation exactly. Parity is guarded by tests/fixtures/method_cases.json
(consumed by tests/test_methods.py and tests/methods.parity.test.ts).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Optional

from allocation import AllocationInputN, allocate_n

# "PR" | "PR-DH" | "PR-HAM" | "MMD-3" | "MMD-5" | "MMP-50"
MethodKind = str


def _round_half_up(x: float) -> int:
    """JS Math.round parity: round half toward +infinity."""
    return math.floor(x + 0.5)


@dataclass(frozen=True)
class MethodAllocationInput:
    total_seats: int
    vote_shares: List[float]      # per party, in [0,1], summing to 1; order preserved
    party_ids: List[str]          # parallel to vote_shares; MMP locates 'D'/'R'
    actual_d_seats: int           # today's actual delegation — MMP's SMD seed
    actual_r_seats: int


def _alloc_sl(seats: int, shares: List[float]) -> List[int]:
    """Sainte-Laguë over party shares (scaled to vote-like magnitudes)."""
    return allocate_n(
        AllocationInputN(seats=seats, votes=[s * 1_000_000 for s in shares]),
        "sainte-lague",
    )


def allocate_pr(inp: MethodAllocationInput, formula: str = "sainte-lague") -> List[int]:
    """Statewide PR — thin wrapper over allocate_n, parameterized by divisor formula."""
    return allocate_n(
        AllocationInputN(seats=inp.total_seats, votes=[s * 1_000_000 for s in inp.vote_shares]),
        formula,
    )


def allocate_mmd(inp: MethodAllocationInput, size: int) -> List[int]:
    """Chop the state's seats into districts of `size`, PR within each, sum.
    floor(N/size) full districts + one remainder district when N mod size > 0.
    N <= size → a single district of N (so 1-seat states go to the plurality)."""
    total_seats = inp.total_seats
    shares = inp.vote_shares
    if total_seats <= 0:
        return [0] * len(shares)

    districts: List[int] = []
    if total_seats <= size:
        districts.append(total_seats)
    else:
        full = total_seats // size
        remainder = total_seats - full * size
        districts.extend([size] * full)
        if remainder > 0:
            districts.append(remainder)

    totals = [0] * len(shares)
    for d in districts:
        partial = _alloc_sl(d, shares)
        for i in range(len(totals)):
            totals[i] += partial[i]
    return totals


def allocate_mmp(inp: MethodAllocationInput, smd_fraction: float) -> List[int]:
    """50/50-style mixed-member: SMD seats from today's actual delegation scaled
    to the SMD count; list seats top each party toward its proportional target,
    with overhang handled by proportional-to-demand allocation."""
    total_seats = inp.total_seats
    shares = inp.vote_shares
    n = len(shares)
    if total_seats <= 0:
        return [0] * n

    smd_count = _round_half_up(total_seats * smd_fraction)
    list_count = total_seats - smd_count
    actual_total = inp.actual_d_seats + inp.actual_r_seats

    # Step 1: SMD seats — D and R only, scaled from today's actual delegation.
    smd = [0] * n
    if smd_count > 0 and actual_total > 0:
        d_idx = inp.party_ids.index("D") if "D" in inp.party_ids else -1
        r_idx = inp.party_ids.index("R") if "R" in inp.party_ids else -1
        d_exact = (inp.actual_d_seats / actual_total) * smd_count
        r_exact = (inp.actual_r_seats / actual_total) * smd_count
        d_smd = math.floor(d_exact)
        r_smd = math.floor(r_exact)
        leftover = smd_count - d_smd - r_smd
        # Distribute leftover by larger fractional remainder; ties → D.
        while leftover > 0:
            if (d_exact - d_smd) >= (r_exact - r_smd):
                d_smd += 1
            else:
                r_smd += 1
            leftover -= 1
        if d_idx >= 0:
            smd[d_idx] = d_smd
        if r_idx >= 0:
            smd[r_idx] = r_smd

    # Step 2: proportional targets via Sainte-Laguë over the full total.
    target = _alloc_sl(total_seats, shares)

    # Step 3: list demand per party = max(0, target - smd).
    demand = [max(0, target[i] - smd[i]) for i in range(n)]
    total_demand = sum(demand)
    lst = [0] * n
    if total_demand <= list_count:
        for i in range(n):
            lst[i] = demand[i]
        spare = list_count - total_demand
        if spare > 0:
            spare_alloc = _alloc_sl(spare, shares)
            for i in range(n):
                lst[i] += spare_alloc[i]
    else:
        # Overhang: allocate the list seats proportionally to demand.
        list_alloc = allocate_n(
            AllocationInputN(seats=list_count, votes=[float(x) for x in demand]),
            "sainte-lague",
        )
        for i in range(n):
            lst[i] = list_alloc[i]

    return [smd[i] + lst[i] for i in range(n)]


def allocate_by_method(
    inp: MethodAllocationInput,
    method: MethodKind,
    params: Optional[dict] = None,
) -> List[int]:
    """Dispatch by method id. `params` may carry mmd_magnitude / mmp_smd_share."""
    params = params or {}
    if method == "PR":
        return allocate_pr(inp, "sainte-lague")
    if method == "PR-DH":
        return allocate_pr(inp, "dhondt")
    if method == "PR-HAM":
        return allocate_pr(inp, "hamilton")
    if method == "MMD-3":
        return allocate_mmd(inp, params.get("mmd_magnitude", 3))
    if method == "MMD-5":
        return allocate_mmd(inp, params.get("mmd_magnitude", 5))
    if method == "MMP-50":
        return allocate_mmp(inp, params.get("mmp_smd_share", 0.5))
    raise ValueError(f"Unknown allocation method: {method}")


def national_by_method(projected_states: list[dict], method: MethodKind) -> tuple[int, int]:
    """National (D, R) totals under `method`, from project_states() output. Each
    state is allocated two-party from its swung projected shares. For method 'PR'
    this equals the pipeline's stored projected seats (Sainte-Laguë parity)."""
    d = 0
    r = 0
    for s in projected_states:
        seats = allocate_by_method(
            MethodAllocationInput(
                total_seats=s["seats"],
                vote_shares=[s["projected"]["d_share"], s["projected"]["r_share"]],
                party_ids=["D", "R"],
                actual_d_seats=s["actual"]["d_seats"],
                actual_r_seats=s["actual"]["r_seats"],
            ),
            method,
        )
        d += seats[0]
        r += seats[1]
    return d, r
