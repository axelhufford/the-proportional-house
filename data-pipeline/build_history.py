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

REPO_ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DATA = REPO_ROOT / "public" / "data"
PROJECTION_PATH = PUBLIC_DATA / "projection.json"
HISTORY_PATH = PUBLIC_DATA / "history.json"
BACKFILL_PATH = PUBLIC_DATA / "history_backfill.json"

LIVE_HISTORY_URL = "https://proportionalhouse.org/data/history.json"
MAX_POINTS = 730  # ~2 years of daily points


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

    payload = {
        "meta": {"generated_at": datetime.now(timezone.utc).isoformat()},
        "points": points,
    }
    HISTORY_PATH.write_text(json.dumps(payload, indent=2))
    n_recon = sum(1 for p in points if _is_reconstructed(p))
    print(
        f"Wrote history with {len(points)} point(s) "
        f"({n_recon} reconstructed, {len(points) - n_recon} forward) "
        f"to {HISTORY_PATH.relative_to(REPO_ROOT)}"
    )


if __name__ == "__main__":
    main()
