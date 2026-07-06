"""Regenerate public/llms.txt with the day's projection numbers.

Runs at the end of update.py (generate_state_og pattern), so AI crawlers
reading llms.txt see live numbers instead of only static descriptions. The
static sections below are the file's single source of truth — public/llms.txt
is generated; edit the template here, not the output.

    python data-pipeline/generate_llms.py
"""

from __future__ import annotations

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PROJECTION_PATH = REPO_ROOT / "public" / "data" / "projection.json"
OUT_PATH = REPO_ROOT / "public" / "llms.txt"


def _fmt_margin(m: float) -> str:
    if abs(m) < 0.05:
        return "Tie"
    return f"D+{m:.1f}" if m >= 0 else f"R+{abs(m):.1f}"


def build_current_section(p: dict) -> str:
    meta = p["meta"]
    nat = p["national"]
    date = str(meta["generated_at"])[:10]
    lines = [
        f"## Current projection (updated {date})",
        f"- Projected House under PR: Democrats {nat['projected']['d_seats']}, "
        f"Republicans {nat['projected']['r_seats']} "
        f"(actual House today: D {nat['actual']['d_seats']}, R {nat['actual']['r_seats']}).",
        f"- Generic-ballot average: {_fmt_margin(meta['generic_ballot_margin'])} "
        f"(swing {meta['swing']:+.1f} pts vs. the 2024 House vote).",
    ]
    unc = meta.get("uncertainty")
    if unc:
        lines.append(
            f"- If polls miss by the historical ±{unc['epsilon_points']} points: "
            f"D {unc['d_seats_low']}–{unc['d_seats_high']} seats."
        )
    majority = meta.get("majority")
    if majority:
        lines.append(
            f"- Control of the House would flip at {_fmt_margin(majority['tipping_margin'])} "
            f"on the generic ballot."
        )
    flips = meta.get("closest_flips")
    if flips:
        nearest = flips[0]
        toward = "Democrats" if nearest["direction"] == "D" else "Republicans"
        lines.append(
            f"- Closest seat to flip: {nearest['name']}, toward {toward} if the margin "
            f"moves {nearest['margin_delta']:.1f} more points that way."
        )
    lines.append(
        "- Machine-readable: https://proportionalhouse.org/api/v1/projection.json"
    )
    return "\n".join(lines)


TEMPLATE = """# The Proportional House

> The Proportional House (proportionalhouse.org) is a non-partisan, daily-updated
> visualization of how the U.S. House of Representatives would look under proportional
> representation (PR) instead of today's winner-take-all districts. It projects, state by
> state, how seats would be allocated if each state's delegation matched its statewide vote:
> using current generic-ballot polling for the live projection, and actual results for
> historical retrospectives covering the last five cycles (2016, 2018, 2020, 2022, 2024).
> Built by Axel Hufford; open source under the MIT license.

{current_section}

## Key pages
- [Home / interactive map](https://proportionalhouse.org/): the national projection plus a clickable 50-state map. Three views: Current Projection (today's House vs. PR of the projected statewide vote), Retrospective (PR of the actual vote in 2016–2024), and an interactive Sandbox.
- [Rankings](https://proportionalhouse.org/rankings): leaderboards of the most distorted state delegations — biggest Democratic shifts, biggest Republican shifts, and the most one-sided delegations under PR.
- [Methodology](https://proportionalhouse.org/methodology): data sources, Sainte-Laguë allocation, state elasticity, the polling-error sensitivity band, the Sandbox's allocation methods (Pure PR, multi-member districts, mixed-member proportional), House-size expansion, uncontested-race handling, and limitations.
- [About / FAQ](https://proportionalhouse.org/about): what the project is, why the House (not the Senate), whether it's partisan, and a detailed FAQ.

## Companion experiments
- [The Proportional Electoral College](https://proportionalhouse.org/electoral-college): every presidential election since 1976 recomputed as if each state split its electoral votes in proportion to its popular vote instead of winner-take-all — including how often no candidate reaches 270 (which would send the choice to the U.S. House).
- [The Senate's malapportionment](https://proportionalhouse.org/senate): how lopsided equal-per-state Senate representation is by population — the per-person representation gap between the smallest and largest states, and how few people the smallest states need to command a Senate majority.
- [The federal circuit map](https://proportionalhouse.org/circuits): the U.S. Courts of Appeals carved into circuits of wildly unequal population (the 9th covers ~1 in 5 Americans), with an illustrative redraw into far more equal circuits — a structural curiosity, not a reform proposal.

## Per-state pages
- `https://proportionalhouse.org/state/{{code}}` — one page per state (e.g. /state/tx, /state/ca, /state/pa) showing that state's actual delegation vs. its proportional allocation.

## Data + sitemap
- [Projection data (JSON)](https://proportionalhouse.org/data/projection.json)
- [Versioned API](https://proportionalhouse.org/api/v1/projection.json)
- [Retrospectives data (JSON)](https://proportionalhouse.org/data/retrospectives.json)
- [Sitemap](https://proportionalhouse.org/sitemap.xml)

## Sources
- 2024 House baseline: U.S. House Clerk, official election statistics.
- Prior cycles (2016–2022): MIT Election Data and Science Lab, U.S. House 1976–2024 (doi:10.7910/DVN/IG0UN2).
- Generic-ballot polling: Silver Bulletin (Nate Silver).

*(This file is regenerated daily by the data pipeline; the numbers above are as of the date shown.)*
"""


def main() -> None:
    with PROJECTION_PATH.open() as f:
        projection = json.load(f)
    OUT_PATH.write_text(TEMPLATE.format(current_section=build_current_section(projection)))
    print(f"Wrote {OUT_PATH.relative_to(REPO_ROOT)}.")


if __name__ == "__main__":
    main()
