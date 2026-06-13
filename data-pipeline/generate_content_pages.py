"""Generate static long-form content pages that search + AI crawlers can read
without running JS (the SPA route bodies are JS-only; only their <head> meta is
prerendered). Currently: the Retrospectives article.

Reads:  public/data/retrospectives.json
Writes: public/retrospectives.html  (Cloudflare serves it at /retrospectives)

Pure Python (no resvg), so it regenerates on every deploy. Called from
update.py after retrospectives.json is built.

Run from repo root:
    python data-pipeline/generate_content_pages.py
"""

from __future__ import annotations

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
RETRO_PATH = REPO_ROOT / "public" / "data" / "retrospectives.json"
META_PATH = REPO_ROOT / "public" / "data" / "meta.json"
OUT_PATH = REPO_ROOT / "public" / "retrospectives.html"
SITE_URL = "https://proportionalhouse.org"


def _og_version() -> str:
    """Date stamp (YYYY-MM-DD) appended to the og:image URL so social platforms
    re-fetch the regenerated home card instead of a stale cached copy. Empty if
    meta.json is unreadable — then the URL is just unversioned."""
    try:
        return str(json.loads(META_PATH.read_text())["generated_at"])[:10]
    except Exception:  # noqa: BLE001 — missing/garbled meta → no version, not a crash
        return ""

TITLE = "U.S. House retrospectives: proportional representation vs. the actual result, 2016–2024 · The Proportional House"
DESCRIPTION = (
    "For each U.S. House election from 2016 to 2024, how the seats would have split under proportional "
    "representation of the actual statewide vote — versus what each party actually won. The 2016 map cost "
    "Democrats about 20 seats; other cycles are within about two."
)
CANONICAL = f"{SITE_URL}/retrospectives"
_v = _og_version()
OG_IMAGE = f"{SITE_URL}/og-card.png" + (f"?v={_v}" if _v else "")


def _shift(d_gain: int) -> tuple[str, str]:
    if d_gain > 0:
        return f"+{d_gain} toward Democrats", "d"
    if d_gain < 0:
        return f"+{abs(d_gain)} toward Republicans", "r"
    return "even", ""


def build_html(retro: dict) -> str:
    series = sorted(retro.get("series", []), key=lambda r: r["year"])

    rows = ""
    for r in series:
        ad, ar = r["actual"]["d_seats"], r["actual"]["r_seats"]
        pd, pr = r["projected_pr"]["d_seats"], r["projected_pr"]["r_seats"]
        label, cls = _shift(r["d_gain"])
        rows += (
            f'    <tr><th scope="row"><a href="/retrospective?year={r["year"]}">{r["year"]}</a></th>'
            f'<td><span class="d">D {ad}</span> / <span class="r">R {ar}</span></td>'
            f'<td><span class="d">D {pd}</span> / <span class="r">R {pr}</span></td>'
            f'<td class="{cls}">{label}</td></tr>\n'
        )

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{TITLE}</title>
<meta name="description" content="{DESCRIPTION}">
<link rel="canonical" href="{CANONICAL}">

<meta property="og:type" content="article">
<meta property="og:site_name" content="The Proportional House">
<meta property="og:title" content="U.S. House retrospectives: proportional representation vs. the actual result (2016–2024)">
<meta property="og:description" content="{DESCRIPTION}">
<meta property="og:url" content="{CANONICAL}">
<meta property="og:image" content="{OG_IMAGE}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="U.S. House retrospectives: PR vs. the actual result (2016–2024)">
<meta name="twitter:description" content="{DESCRIPTION}">
<meta name="twitter:image" content="{OG_IMAGE}">

<meta name="theme-color" content="#1F2E4D">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">

<style>
  :root {{ --navy:#1F2E4D; --cream:#F4EDE0; --d:#2166ac; --r:#b2182b; --ink:#3f3f46; --mut:#71717a; }}
  body {{ font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
          background: var(--cream); color: var(--ink); margin: 0; line-height: 1.65; }}
  main {{ max-width: 680px; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }}
  .kicker {{ font-size: .8rem; letter-spacing: .04em; text-transform: uppercase; color: var(--mut); margin: 0 0 .75rem; }}
  .kicker a {{ color: var(--mut); text-decoration: none; }}
  h1 {{ font-family: Georgia, "Times New Roman", serif; color: var(--navy); font-weight: 600;
        font-size: 2rem; line-height: 1.15; margin: 0 0 1rem; }}
  h2 {{ font-family: Georgia, "Times New Roman", serif; color: var(--navy); font-weight: 600;
        font-size: 1.3rem; margin: 2rem 0 .5rem; }}
  p {{ margin: 0 0 1rem; }}
  .d {{ color: var(--d); font-weight: 700; }} .r {{ color: var(--r); font-weight: 700; }}
  table {{ width: 100%; border-collapse: collapse; margin: 1rem 0 1.5rem; background: #fff;
           border: 1px solid #e7e5e4; border-radius: .5rem; overflow: hidden; }}
  th, td {{ text-align: left; padding: .6rem .8rem; border-bottom: 1px solid #f0efed; font-size: .95rem; }}
  thead th {{ font-size: .72rem; letter-spacing: .05em; text-transform: uppercase; color: var(--mut); font-weight: 600; }}
  tbody th a {{ color: var(--navy); font-weight: 700; }}
  tr:last-child td, tr:last-child th {{ border-bottom: 0; }}
  .cta {{ display: inline-block; background: var(--navy); color: #fff; text-decoration: none;
          padding: .6rem 1.1rem; border-radius: 999px; font-weight: 600; }}
  .note {{ font-size: .9rem; color: var(--mut); margin-top: 2rem; }}
  a {{ color: var(--navy); }}
</style>
</head>
<body>
<main>
  <p class="kicker"><a href="/">The Proportional House</a></p>
  <h1>How proportional representation would have changed the U.S. House, 2016&ndash;2024</h1>

  <p>For each recent U.S. House election, this takes the <strong>actual statewide vote</strong> and asks
    what the seat split would have been if every state allocated its seats <strong>proportionally</strong>
    (using the Sainte-Lagu&euml; method), with no polling or projection involved. Comparing that to the
    seats each party actually won isolates the distortion built into the winner-take-all district map.</p>

  <table>
    <thead><tr><th scope="col">Cycle</th><th scope="col">Actual result</th><th scope="col">Under PR</th><th scope="col">Shift under PR</th></tr></thead>
    <tbody>
{rows}    </tbody>
  </table>

  <p>Across the last five cycles the gap between the proportional result and the actual one is usually
    small &mdash; about two seats &mdash; with one striking exception: <strong>2016</strong>.</p>

  <h2>Why 2016 is the outlier</h2>
  <p>In 2016, Democrats won about 49% of the House vote nationwide but only 45% of the seats.
    Proportional representation would have closed almost all of that gap, adding roughly 20 Democratic
    seats. And it wasn&rsquo;t one rogue state. A dozen states with Republican-drawn maps (Texas,
    Pennsylvania, Ohio, North Carolina, Michigan, Georgia, and more) each turned a near-even statewide
    vote into a lopsided delegation. Those were the most aggressive maps of the decade, drawn after the
    2010 census and not yet thrown out by courts.</p>
  <p>It also reflects something the map keeps showing: Democratic voters cluster in cities, so the party
    piles up big margins in a few districts and &ldquo;wastes&rdquo; a lot of votes. By 2018 Pennsylvania&rsquo;s
    map had been struck down and redrawn, and a strong Democratic year turned votes into seats more
    efficiently. The maps behind 2022 and 2024 are close to nationally balanced: independent-commission
    and court-ordered redraws (Michigan, North Carolina) landed alongside offsetting new gerrymanders
    &mdash; Democratic in Illinois, Republican in Florida and Texas &mdash; so they roughly cancel out.
    That&rsquo;s why proportional representation changes far fewer seats now &mdash; the small gaps you
    see in the other cycles.</p>

  <p><a class="cta" href="/retrospective">Explore the retrospectives on the interactive map &rarr;</a></p>

  <p class="note">Prior-cycle vote totals come from the MIT Election Lab (U.S. House 1976&ndash;2024);
    2024 from the U.S. House Clerk. See the <a href="/methodology#retrospectives">methodology</a>, the
    <a href="/rankings">most distorted delegations</a>, or the <a href="/">national map</a>. Data is
    CC&nbsp;BY&nbsp;4.0; cite as &ldquo;The Proportional House (proportionalhouse.org), accessed [date].&rdquo;</p>
</main>
</body>
</html>
"""


def main() -> None:
    if not RETRO_PATH.exists():
        print(f"  (skip) {RETRO_PATH.relative_to(REPO_ROOT)} not found — retrospectives page not written.")
        return
    retro = json.loads(RETRO_PATH.read_text())
    OUT_PATH.write_text(build_html(retro))
    print(f"Wrote {OUT_PATH.relative_to(REPO_ROOT)} ({len(retro.get('series', []))} cycles).")


if __name__ == "__main__":
    main()
