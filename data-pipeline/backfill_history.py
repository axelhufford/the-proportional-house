"""Generate a reconstructed (hindcast) projection-over-time series.

The Current projection is a pure deterministic function of one time-varying
input: the 30-day weighted generic-ballot average. `weighted_average()` already
takes an `as_of` date, so we can run the *current* model backwards over Silver
Bulletin's poll archive — for each past day, compute the average as of that day
(adjusted margins, exactly as the live pipeline does), derive the swing,
allocate seats, and record what the site would have shown.

This is a HINDCAST, not archived live snapshots. Two honest caveats (disclosed
on the Methodology page's limitations section):
  * House-effect leakage: Silver recomputes his house-effect adjustments over
    his whole dataset, so a past poll's `adjusted_*` value carries a sliver of
    hindsight it wouldn't have had on the day.
  * Database revisions: today's CSV may contain polls added after the fact; we
    filter by poll midpoint, the best available proxy for "what was known then."

Every point is flagged `reconstructed: true` and written to
public/data/history_backfill.json — a durable committed artifact that the daily
build_history.py unions in (and never overwrites). build_history.main() is then
called to regenerate the published history.json locally.

Re-runnable. Network: fetches the same CSV as the live pipeline.

    python data-pipeline/backfill_history.py
    python data-pipeline/backfill_history.py --start 2026-01-01 --min-polls 10
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import build_history
from fetch_clerk_house import OUT_PATH as BASELINE_JSON
from fetch_polls import fetch_csv, parse_polls, weighted_average
from update import project_states
from io_utils import write_json_atomic

REPO_ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DATA = REPO_ROOT / "public" / "data"
BACKFILL_PATH = PUBLIC_DATA / "history_backfill.json"

# Minimum polls in the 30-day window before a day is worth reconstructing — keeps
# the early-December tail (when only a handful of polls existed) from drawing a
# noisy line off 1-2 polls.
DEFAULT_MIN_POLLS = 8


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--start", help="YYYY-MM-DD; default = earliest poll midpoint")
    ap.add_argument("--min-polls", type=int, default=DEFAULT_MIN_POLLS,
                    help=f"skip days with fewer polls in the window (default {DEFAULT_MIN_POLLS})")
    args = ap.parse_args()

    with BASELINE_JSON.open() as f:
        baseline = json.load(f)
    baseline_states = baseline["states"]
    # D's national margin in 2024 (negative when R-leaning), mirroring update.py.
    baseline_d_margin = -baseline["meta"]["national_house_popular_vote"]["r_margin_points"]
    actual_d = sum(s["actual_d_seats_119th"] for s in baseline_states)
    actual_r = sum(s["actual_r_seats_119th"] for s in baseline_states)

    print(f"Fetching poll archive …")
    polls = parse_polls(fetch_csv())
    if not polls:
        raise SystemExit("No polls parsed — aborting (would produce an empty backfill).")
    print(f"Loaded {len(polls)} polls.")

    earliest = min(p.midpoint.date() for p in polls)
    today = datetime.now(timezone.utc).date()
    start = (
        datetime.strptime(args.start, "%Y-%m-%d").date() if args.start else earliest
    )

    points: list[dict] = []
    day = start
    while day <= today:
        # As of end-of-day: include every poll whose midpoint falls on or before
        # this calendar date, mirroring how a poll released that day would count.
        as_of = datetime(day.year, day.month, day.day, 23, 59, 59, tzinfo=timezone.utc)
        avg = weighted_average(polls, as_of=as_of, use_adjusted=True)
        if avg["n_polls"] >= args.min_polls:
            margin = avg["margin"]
            swing = margin - baseline_d_margin
            projected = project_states(baseline_states, swing)
            points.append({
                "date": day.isoformat(),
                "projected_d": sum(s["projected"]["d_seats"] for s in projected),
                "projected_r": sum(s["projected"]["r_seats"] for s in projected),
                "actual_d": actual_d,
                "actual_r": actual_r,
                "generic_ballot_margin": round(float(margin), 2),
                "swing": round(float(swing), 2),
                "reconstructed": True,
            })
        day += timedelta(days=1)

    payload = {
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "reconstructed": True,
            "source": "Silver Bulletin generic-ballot poll archive (house-effect-adjusted margins)",
            "method": "current Sainte-Laguë projection model run as-of each date",
            "window_days": 30,
            "half_life_days": 14,
            "min_polls": args.min_polls,
            "note": (
                "Hindcast: the current model applied to the poll archive as of each "
                "date, not archived live snapshots. See /methodology#limitations for "
                "the house-effect-leakage and database-revision caveats."
            ),
        },
        "points": points,
    }
    write_json_atomic(BACKFILL_PATH, payload)
    print(f"Wrote {len(points)} reconstructed point(s) to {BACKFILL_PATH.relative_to(REPO_ROOT)}")
    if points:
        first, last = points[0], points[-1]
        print(f"  range: {first['date']} → {last['date']}")
        print(
            f"  latest reconstructed: generic ballot D{last['generic_ballot_margin']:+.2f}, "
            f"seats D {last['projected_d']} / R {last['projected_r']}"
        )

    # Regenerate the published history.json (unions backfill + forward + today).
    print()
    build_history.main()


if __name__ == "__main__":
    main()
