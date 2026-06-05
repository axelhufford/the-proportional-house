"""Generate public/sitemap.xml for search-engine discovery.

Lists every URL the site exposes:
  - /                       (home)
  - /rankings               (rankings leaderboards)
  - /retrospective          (interactive retrospective view)
  - /sandbox                (interactive build-your-own view)
  - /retrospectives         (static long-form write-up)
  - /methodology            (methodology page)
  - /about                  (about + FAQ)
  - /electoral-college      (companion experiment)
  - /senate                 (companion experiment)
  - /circuits               (companion experiment)
  - /state/{code_lower}     (one per state, 50 total — matches the static
                             HTML pages emitted by generate_state_og.py)

Keep the fixed-route list here in sync with ROUTE_META in src/lib/routeMeta.ts
(the per-route prerender source) so crawlers can discover every page.

`<lastmod>` for every URL uses the pipeline's `generated_at` timestamp from
public/data/meta.json. That way Google sees a fresh date whenever the
projection refreshes, which nudges re-crawling.

The sitemap is regenerated automatically as part of `npm run pipeline`
(update.py calls main() here right after generate_state_og).

Run standalone:
    python data-pipeline/generate_sitemap.py
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PROJECTION_PATH = REPO_ROOT / "public" / "data" / "projection.json"
META_PATH = REPO_ROOT / "public" / "data" / "meta.json"
SITEMAP_PATH = REPO_ROOT / "public" / "sitemap.xml"

# Update this when the custom domain is wired up. The sitemap MUST advertise
# the canonical hostname or Google will see two competing copies. See
# generate_state_og.SITE_URL — keep these in sync.
SITE_URL = "https://proportionalhouse.org"

# Fixed (non-state) routes as (path, priority, changefreq). Keep in sync with
# ROUTE_META in src/lib/routeMeta.ts (the prerender source) plus the static
# /retrospectives write-up. Listing every page here is what lets search engines
# and AI crawlers discover the companion experiments, which aren't in the nav.
FIXED_ROUTES: list[tuple[str, str, str]] = [
    ("/", "1.0", "daily"),                # homepage — refreshes each pipeline run
    ("/rankings", "0.9", "daily"),        # leaderboards re-sort each run
    ("/retrospective", "0.8", "monthly"),  # interactive: PR over 2016–2024 actuals
    ("/sandbox", "0.7", "monthly"),       # build-your-own scenario tool
    ("/retrospectives", "0.8", "monthly"),  # static long-form write-up
    ("/methodology", "0.7", "monthly"),   # stable
    ("/about", "0.5", "monthly"),         # very stable
    ("/electoral-college", "0.6", "monthly"),  # companion experiment
    ("/senate", "0.6", "monthly"),        # companion experiment
    ("/circuits", "0.6", "monthly"),      # companion experiment
]


def _lastmod() -> str:
    """Return the ISO-8601 lastmod string for every URL.

    Sitemap protocol allows date-only or full RFC-3339; we use date-only so
    Google's cache check is simpler and we don't trip "too-frequent updates"
    heuristics from minute-granular changes.
    """
    try:
        with META_PATH.open() as f:
            meta = json.load(f)
        ts = meta.get("generated_at")
        if ts:
            # Parse and re-emit as YYYY-MM-DD; tolerate trailing 'Z'.
            return datetime.fromisoformat(ts.replace("Z", "+00:00")).date().isoformat()
    except (FileNotFoundError, ValueError, KeyError):
        pass
    return datetime.utcnow().date().isoformat()


def _url_entry(loc: str, lastmod: str, priority: str, changefreq: str) -> str:
    return (
        "  <url>\n"
        f"    <loc>{loc}</loc>\n"
        f"    <lastmod>{lastmod}</lastmod>\n"
        f"    <changefreq>{changefreq}</changefreq>\n"
        f"    <priority>{priority}</priority>\n"
        "  </url>\n"
    )


def build_sitemap(state_codes: list[str]) -> str:
    lastmod = _lastmod()
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>\n',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n',
    ]
    # Fixed (non-state) routes.
    for path, priority, changefreq in FIXED_ROUTES:
        loc = f"{SITE_URL}/" if path == "/" else f"{SITE_URL}{path}"
        parts.append(_url_entry(loc, lastmod, priority, changefreq))
    # Per-state pages — these mirror the static HTML pages in /state/.
    for code in state_codes:
        parts.append(
            _url_entry(f"{SITE_URL}/state/{code.lower()}", lastmod, "0.8", "daily")
        )
    parts.append("</urlset>\n")
    return "".join(parts)


def main() -> None:
    if not PROJECTION_PATH.exists():
        raise SystemExit(
            f"Missing {PROJECTION_PATH.relative_to(REPO_ROOT)} — run the pipeline first."
        )
    with PROJECTION_PATH.open() as f:
        payload = json.load(f)
    state_codes = sorted(s["code"] for s in payload["states"])
    sitemap = build_sitemap(state_codes)
    SITEMAP_PATH.write_text(sitemap)
    # len(FIXED_ROUTES) fixed routes + one per state.
    print(
        f"Wrote sitemap with {len(state_codes) + len(FIXED_ROUTES)} URLs to "
        f"{SITEMAP_PATH.relative_to(REPO_ROOT)}"
    )


if __name__ == "__main__":
    main()
