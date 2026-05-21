"""Generate per-state Open Graph cards (one PNG + one HTML page per state)
for social-share previews.

Reads:
  - public/data/projection.json (per-state projected + actual seats)

Writes:
  - public/og/state-{CODE}.png         — 1200×630 OG image, brand chrome.
  - public/state/{code}.html           — static HTML page with proper OG
                                          meta tags + meta-refresh to the
                                          SPA route /?state={CODE}.

Run from repo root:
    python data-pipeline/generate_state_og.py

Called from update.py after projection.json is written, so a normal
`npm run pipeline` regenerates all 50 pairs.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import resvg_py

REPO_ROOT = Path(__file__).resolve().parent.parent
PROJECTION_PATH = REPO_ROOT / "public" / "data" / "projection.json"
OG_DIR = REPO_ROOT / "public" / "og"
STATE_HTML_DIR = REPO_ROOT / "public" / "state"

SITE_URL = "https://proportionalhouse.org"

# Refined Capitol logomark, lifted from public/logomark.svg, anchored at
# translate(80, 130) scale(2) which fits 200x200 logical size within the
# 1200x630 card.
LOGOMARK_SVG = """<g transform="translate(60, 95) scale(1.8)">
  <path d="M 100,10 L 103.5,32 L 96.5,32 Z" fill="#1F2E4D"/>
  <rect x="91" y="32" width="18" height="5" fill="#1F2E4D"/>
  <rect x="86" y="37" width="28" height="11" fill="#1F2E4D"/>
  <path d="M 50,132 C 50,82 72,55 100,55 C 128,55 150,82 150,132 Z" fill="#1F2E4D"/>
  <rect x="35" y="132" width="130" height="6" fill="#1F2E4D"/>
  <rect x="25" y="138" width="150" height="8" fill="#1F2E4D"/>
  <rect x="31" y="184" width="8" height="10" fill="#A04848"/>
  <rect x="44" y="181" width="8" height="13" fill="#974856"/>
  <rect x="57" y="178" width="8" height="16" fill="#8E4763"/>
  <rect x="70" y="174" width="8" height="20" fill="#844871"/>
  <rect x="83" y="171" width="8" height="23" fill="#774A80"/>
  <rect x="96" y="168" width="8" height="26" fill="#6B4C8E"/>
  <rect x="109" y="165" width="8" height="29" fill="#5F4F93"/>
  <rect x="122" y="162" width="8" height="32" fill="#535298"/>
  <rect x="135" y="158" width="8" height="36" fill="#475597"/>
  <rect x="148" y="155" width="8" height="39" fill="#3B5892"/>
  <rect x="161" y="152" width="8" height="42" fill="#2F5B8C"/>
  <rect x="20" y="194" width="160" height="6" fill="#1F2E4D"/>
</g>"""


def build_card_svg(state: dict) -> str:
    """Return a 1200x630 SVG OG card for a single state."""
    name = state["name"]
    code = state["code"]
    actual = state["actual"]
    projected = state["projected"]
    d_gain = projected["d_seats"] - actual["d_seats"]
    if d_gain == 0:
        shift_label = "No shift under PR"
        shift_color = "#5C5C5A"
    elif d_gain > 0:
        shift_label = f"+{d_gain} D under PR"
        shift_color = "#1F2E4D"
    else:
        shift_label = f"+{abs(d_gain)} R under PR"
        shift_color = "#A04848"

    # Layout: logomark on left, content on right.
    # Right column starts at x ≈ 480, runs to ≈ 1140 (660px wide).
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#F4EDE0"/>
  {LOGOMARK_SVG}
  <text x="500" y="200" font-family="'Source Serif 4', 'Times New Roman', Georgia, serif" font-size="64" font-weight="500" fill="#1F2E4D" letter-spacing="-0.01em">{name}</text>
  <text x="500" y="240" font-family="'Source Serif 4', 'Times New Roman', Georgia, serif" font-size="22" font-style="italic" fill="#5C5C5A">{state['seats']} House {'seat' if state['seats'] == 1 else 'seats'} under proportional representation</text>

  <text x="500" y="320" font-family="'Inter', -apple-system, sans-serif" font-size="14" letter-spacing="2" fill="#888780">ACTUAL TODAY</text>
  <text x="500" y="370" font-family="'Inter', -apple-system, sans-serif" font-size="48" font-weight="600">
    <tspan fill="#2166ac">D {actual['d_seats']}</tspan>
    <tspan fill="#5C5C5A" font-weight="400">  ·  </tspan>
    <tspan fill="#B2182B">R {actual['r_seats']}</tspan>
  </text>

  <text x="820" y="320" font-family="'Inter', -apple-system, sans-serif" font-size="14" letter-spacing="2" fill="#888780">PROJECTED UNDER PR</text>
  <text x="820" y="370" font-family="'Inter', -apple-system, sans-serif" font-size="48" font-weight="600">
    <tspan fill="#2166ac">D {projected['d_seats']}</tspan>
    <tspan fill="#5C5C5A" font-weight="400">  ·  </tspan>
    <tspan fill="#B2182B">R {projected['r_seats']}</tspan>
  </text>

  <text x="500" y="450" font-family="'Source Serif 4', 'Times New Roman', Georgia, serif" font-size="28" font-style="italic" fill="{shift_color}">{shift_label}</text>

  <text x="500" y="555" font-family="'Source Serif 4', 'Times New Roman', Georgia, serif" font-size="20" fill="#1F2E4D">The Proportional House</text>
  <text x="500" y="585" font-family="'Inter', -apple-system, sans-serif" font-size="14" fill="#888780">proportionalhouse.org/state/{code.lower()}</text>
</svg>"""


def build_html_page(state: dict) -> str:
    """Return the static /state/{code}.html page content."""
    name = state["name"]
    code = state["code"]
    code_lower = code.lower()
    actual = state["actual"]
    projected = state["projected"]
    d_gain = projected["d_seats"] - actual["d_seats"]
    if d_gain > 0:
        change_desc = f"+{d_gain} Democratic seats"
    elif d_gain < 0:
        change_desc = f"+{abs(d_gain)} Republican seats"
    else:
        change_desc = "no net seat change"
    description = (
        f"{name} under proportional representation: actual D {actual['d_seats']}/R {actual['r_seats']}, "
        f"projected D {projected['d_seats']}/R {projected['r_seats']} ({change_desc})."
    )
    og_image = f"{SITE_URL}/og/state-{code}.png"
    spa_url = f"/?state={code}"
    # Canonical must match the URL the bot fetched (and og:url below). When
    # canonical pointed at the SPA-with-state URL, Google treated every
    # /state/{code} page as a duplicate of the homepage and refused to index
    # them individually. Self-canonical keeps each page as its own indexable
    # surface — the sitemap has them listed for that exact reason.
    canonical_url = f"{SITE_URL}/state/{code_lower}"
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>{name} under proportional representation · The Proportional House</title>
<meta name="description" content="{description}">
<link rel="canonical" href="{canonical_url}">

<meta property="og:type" content="website">
<meta property="og:title" content="{name} under proportional representation">
<meta property="og:description" content="{description}">
<meta property="og:url" content="{SITE_URL}/state/{code_lower}">
<meta property="og:image" content="{og_image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{name} under proportional representation">
<meta name="twitter:description" content="{description}">
<meta name="twitter:image" content="{og_image}">

<meta name="theme-color" content="#1F2E4D">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">

<meta http-equiv="refresh" content="0; url={spa_url}">

<style>
  body {{
    font-family: system-ui, -apple-system, sans-serif;
    background: #F4EDE0;
    color: #5C5C5A;
    padding: 4rem 2rem;
    text-align: center;
    margin: 0;
  }}
  h1 {{ font-family: 'Source Serif 4', Georgia, serif; color: #1F2E4D; font-weight: 500; font-size: 2rem; margin: 0 0 0.5rem; }}
  a {{ color: #1F2E4D; }}
</style>
</head>
<body>
<h1>{name}</h1>
<p>Loading the interactive map…</p>
<p>If you aren't redirected, <a href="{spa_url}">view {name} under PR &rarr;</a></p>
</body>
</html>
"""


def main() -> None:
    if not PROJECTION_PATH.exists():
        raise SystemExit(
            f"Missing {PROJECTION_PATH.relative_to(REPO_ROOT)} — run the pipeline first."
        )
    with PROJECTION_PATH.open() as f:
        payload = json.load(f)
    OG_DIR.mkdir(parents=True, exist_ok=True)
    STATE_HTML_DIR.mkdir(parents=True, exist_ok=True)

    n = 0
    for state in payload["states"]:
        svg = build_card_svg(state)
        png_bytes = resvg_py.svg_to_bytes(svg_string=svg, width=1200, height=630)
        png_path = OG_DIR / f"state-{state['code']}.png"
        png_path.write_bytes(png_bytes)

        html = build_html_page(state)
        html_path = STATE_HTML_DIR / f"{state['code'].lower()}.html"
        html_path.write_text(html)

        n += 1

    print(f"Wrote {n} per-state OG cards to {OG_DIR.relative_to(REPO_ROOT)}/")
    print(f"Wrote {n} per-state HTML pages to {STATE_HTML_DIR.relative_to(REPO_ROOT)}/")


if __name__ == "__main__":
    main()
