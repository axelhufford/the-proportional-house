"""Append today's Current-projection snapshot to public/data/history.json.

The site has no server or database. To track how the projection moves over time
*without* committing live snapshots back to the repo, this unions every source
of points by UTC date and writes the result into public/data so the deploy
ships the accumulated series.

Sources, lowest priority to highest:
  1. history_backfill.json   — the committed *reconstructed* (hindcast) series
                               (see backfill_history.py). Durable: this script
                               only ever reads it, never overwrites it.
  2. committed history.json  — whatever forward points were last shipped.
  3. live production history.json (best-effort fetch) — forward points that
                               have accumulated across deploys in prod.
  4. today's freshly-computed point.

Merge rule: for each date, a real forward point always beats a reconstructed
one; ties broken by source priority. So the backfill fills only dates with no
forward snapshot, real snapshots are never clobbered by the hindcast, and the
backfill is re-applied every run so it can never be lost. A bad network day
just means the live source is empty — it never breaks the build. Called from
update.py after projection.json/meta.json are written.

Run standalone: python data-pipeline/build_history.py
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import requests

from fetch_clerk_house import OUT_PATH as BASELINE_JSON
from methods import national_by_method
from update import project_states
from io_utils import write_json_atomic

REPO_ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DATA = REPO_ROOT / "public" / "data"
PROJECTION_PATH = PUBLIC_DATA / "projection.json"
HISTORY_PATH = PUBLIC_DATA / "history.json"
BACKFILL_PATH = PUBLIC_DATA / "history_backfill.json"

LIVE_HISTORY_URL = "https://proportionalhouse.org/data/history.json"
MAX_POINTS = 730  # ~2 years of daily points

# Alternative methods charted alongside the Pure-PR line. Pure PR stays the
# top-level projected_d/projected_r; these are precomputed per point from the
# stored swing (see attach_methods). Two-party only — minors / thresholds /
# House-size reapportionment stay Sandbox-only (client-side).
HISTORY_METHODS = ("MMD-3", "MMD-5", "MMP-50")


def _is_reconstructed(pt: dict) -> bool:
    return pt.get("reconstructed") is True


def _read_points(path: Path) -> list[dict]:
    try:
        with path.open() as f:
            pts = json.load(f).get("points")
        if isinstance(pts, list):
            return pts
    except (FileNotFoundError, ValueError):
        pass
    return []


def _forward_only(pts: list[dict]) -> list[dict]:
    """Reconstructed points are owned by history_backfill.json (regenerated
    fresh each backfill). Drop any reconstructed points carried in a published
    history.json so a stale hindcast can never outrank the current backfill."""
    return [p for p in pts if not _is_reconstructed(p)]


def _fetch_live_points() -> list[dict]:
    try:
        r = requests.get(LIVE_HISTORY_URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=20)
        if r.ok:
            pts = r.json().get("points")
            if isinstance(pts, list):
                return pts
    except Exception as e:  # network / JSON / anything — degrade gracefully
        print(f"  (info) live history fetch failed ({e}); skipping live source.")
    return []


def attach_methods(points: list[dict], baseline_states: list[dict]) -> int:
    """Precompute, for each point, national seats under the alternative methods
    (HISTORY_METHODS) from that point's stored `swing`. Pure-PR stays the
    top-level projected_d/projected_r. Mutates points in place; a point without
    a `swing` is left as-is (so the Pure-PR line still renders). Recomputed every
    build so all sources (backfill + forward + legacy) stay consistent.

    Returns the number of points that received a `methods` block."""
    attached = 0
    for pt in points:
        swing = pt.get("swing")
        if swing is None:
            continue
        projected = project_states(baseline_states, float(swing))
        pt["methods"] = {
            m: dict(zip(("d", "r"), national_by_method(projected, m)))
            for m in HISTORY_METHODS
        }
        attached += 1
    return attached


def merge_sources(sources: list[tuple[int, list[dict]]]) -> list[dict]:
    """Union points by date. `sources` is (priority, points) pairs. For each
    date keep the highest-ranked point, where rank = (is_forward, priority):
    a forward (non-reconstructed) point always outranks a reconstructed one,
    and ties break on the higher source priority. Returns sorted, capped."""
    best: dict[str, tuple[tuple[int, int], dict]] = {}
    for priority, pts in sources:
        for pt in pts:
            d = pt.get("date")
            if not d:
                continue
            rank = (0 if _is_reconstructed(pt) else 1, priority)
            if d not in best or rank > best[d][0]:
                best[d] = (rank, pt)
    merged = [v[1] for v in best.values()]
    merged.sort(key=lambda p: p.get("date", ""))
    return merged[-MAX_POINTS:]


def main() -> None:
    with PROJECTION_PATH.open() as f:
        proj = json.load(f)

    nat = proj["national"]
    pmeta = proj.get("meta", {})
    today = datetime.now(timezone.utc).date().isoformat()
    point = {
        "date": today,
        "projected_d": nat["projected"]["d_seats"],
        "projected_r": nat["projected"]["r_seats"],
        "actual_d": nat["actual"]["d_seats"],
        "actual_r": nat["actual"]["r_seats"],
        "generic_ballot_margin": round(float(pmeta.get("generic_ballot_margin", 0.0)), 2),
        "swing": round(float(pmeta.get("swing", 0.0)), 2),
        "reconstructed": False,  # a real forward snapshot, not a hindcast
    }

    points = merge_sources([
        (0, _read_points(BACKFILL_PATH)),                  # reconstructed hindcast (committed)
        (1, _forward_only(_read_points(HISTORY_PATH))),    # last-shipped forward points
        (2, _forward_only(_fetch_live_points())),          # forward points accumulated in prod
        (3, [point]),                                      # today's fresh point
    ])

    # Precompute the alternative-method series (MMD-3 / MMD-5 / MMP-50) for the
    # chart's method selector — from each point's stored swing, so backfill +
    # forward + legacy points all stay consistent. Never breaks the build.
    try:
        with BASELINE_JSON.open() as f:
            baseline_states = json.load(f)["states"]
        n_methods = attach_methods(points, baseline_states)
        print(f"Attached method series ({', '.join(HISTORY_METHODS)}) to {n_methods} point(s).")
    except (FileNotFoundError, ValueError, KeyError) as e:
        print(f"  (warn) could not attach method series to history: {e}")

    payload = {
        "meta": {"generated_at": datetime.now(timezone.utc).isoformat()},
        "points": points,
    }
    write_json_atomic(HISTORY_PATH, payload)
    n_recon = sum(1 for p in points if _is_reconstructed(p))
    print(
        f"Wrote history with {len(points)} point(s) "
        f"({n_recon} reconstructed, {len(points) - n_recon} forward) "
        f"to {HISTORY_PATH.relative_to(REPO_ROOT)}"
    )


if __name__ == "__main__":
    main()
