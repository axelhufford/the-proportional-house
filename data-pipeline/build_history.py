"""Append today's Current-projection snapshot to public/data/history.json.

The site has no server or database. To track how the projection moves over time
*without* committing data back to the repo, this fetches the **live**
history.json from production, appends today's point (deduped by UTC date), and
writes it back into public/data so the deploy ships the accumulated series.

Fallback chain (best-effort): live production file → committed history.json →
empty series. So a bad network day just means the series doesn't advance — it
never breaks the build. Called from update.py after projection.json/meta.json
are written.

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

LIVE_HISTORY_URL = "https://proportionalhouse.org/data/history.json"
MAX_POINTS = 730  # ~2 years of daily points


def _existing_points() -> list[dict]:
    """Prior series: prefer live production (accumulates across deploys with no
    repo commits), then the committed file, then empty."""
    try:
        r = requests.get(LIVE_HISTORY_URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=20)
        if r.ok:
            pts = r.json().get("points")
            if isinstance(pts, list):
                return pts
    except Exception as e:  # network / JSON / anything — degrade gracefully
        print(f"  (info) live history fetch failed ({e}); using committed file.")
    try:
        with HISTORY_PATH.open() as f:
            pts = json.load(f).get("points")
        if isinstance(pts, list):
            return pts
    except (FileNotFoundError, ValueError):
        pass
    return []


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
    }

    # Replace any existing entry for today (re-runs / multiple deploys per day),
    # then sort + cap.
    points = [p for p in _existing_points() if p.get("date") != today]
    points.append(point)
    points.sort(key=lambda p: p.get("date", ""))
    points = points[-MAX_POINTS:]

    payload = {
        "meta": {"generated_at": datetime.now(timezone.utc).isoformat()},
        "points": points,
    }
    HISTORY_PATH.write_text(json.dumps(payload, indent=2))
    print(f"Wrote history with {len(points)} point(s) to {HISTORY_PATH.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
