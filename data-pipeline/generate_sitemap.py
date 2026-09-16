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

`<lastmod>` is per-route, not one date for the whole file.

Routes whose content really is regenerated every run (the map, the rankings,
the retrospective view, the per-state pages) get the pipeline's `generated_at`
date from public/data/meta.json. The rest — /about, /methodology and the
companion experiments — get the commit date of the sources that produce them.

Stamping today's date on all 60 URLs daily, which is what this used to do, is
the textbook way to get lastmod ignored altogether: Google treats the signal as
unreliable when a whole sitemap claims to change every day, and then the dates
on the pages that genuinely DO change stop being believed either.

The sitemap is regenerated automatically as part of `npm run pipeline`
(update.py calls main() here right after generate_state_og).

Run standalone:
    python data-pipeline/generate_sitemap.py
"""

from __future__ import annotations

import json
import subprocess
from datetime import datetime
from pathlib import Path
from io_utils import write_text_atomic

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

# Routes the pipeline genuinely rewrites on every run: their numbers come from
# the day's projection, so `generated_at` is their honest lastmod.
DAILY_ROUTES = {"/", "/rankings", "/retrospective"}

# For everything else, the sources whose last commit is that page's real
# lastmod. A page is its component plus the dataset it renders; when either
# changes, the page changed.
ROUTE_SOURCES: dict[str, tuple[str, ...]] = {
    "/sandbox": ("src/pages/Home.tsx", "src/components/MinorPartyControls.tsx",
                 "src/lib/allocation.ts"),
    "/retrospectives": ("data-pipeline/generate_retrospectives_page.py",
                        "public/data/retrospectives.json"),
    "/methodology": ("src/pages/Methodology.tsx",),
    "/about": ("src/pages/About.tsx",),
    "/electoral-college": ("src/pages/ElectoralCollege.tsx",
                           "public/data/electoral_college.json"),
    "/senate": ("src/pages/Senate.tsx", "public/data/senate.json"),
    "/circuits": ("src/pages/Circuits.tsx", "public/data/circuits.json"),
}



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


def _git_lastmod(paths: tuple[str, ...]) -> str | None:
    """Commit date (YYYY-MM-DD) of the newest commit touching any of `paths`.

    Returns None when git can't answer — no repo, git missing, or a shallow
    clone deep enough only for HEAD. Callers fall back to the pipeline date,
    which is what this module did for every URL before.
    """
    existing = [p for p in paths if (REPO_ROOT / p).exists()]
    if not existing:
        return None
    try:
        out = subprocess.run(
            ["git", "log", "-1", "--format=%cs", "--", *existing],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    date = out.stdout.strip()
    # Sanity-check the shape rather than trusting whatever git printed.
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        return None
    return date


def _route_lastmod(path: str, pipeline_date: str) -> str:
    """The honest lastmod for one fixed route."""
    if path in DAILY_ROUTES:
        return pipeline_date
    sources = ROUTE_SOURCES.get(path)
    if not sources:
        return pipeline_date
    # Never claim a page changed later than the data build it ships with.
    return min(_git_lastmod(sources) or pipeline_date, pipeline_date)


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
        parts.append(_url_entry(loc, _route_lastmod(path, lastmod), priority, changefreq))
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
    write_text_atomic(SITEMAP_PATH, sitemap)
    # len(FIXED_ROUTES) fixed routes + one per state.
    print(
        f"Wrote sitemap with {len(state_codes) + len(FIXED_ROUTES)} URLs to "
        f"{SITEMAP_PATH.relative_to(REPO_ROOT)}"
    )


if __name__ == "__main__":
    main()
