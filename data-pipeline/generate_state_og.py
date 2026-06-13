"""Generate per-state Open Graph cards (one PNG + one HTML page per state)
for social-share previews.

Reads:
  - public/data/projection.json (per-state projected + actual seats)

Writes:
  - public/og-card.png                 — 1200×630 home OG image with the live
                                          national headline (seat shift + splits).
  - public/og/state-{CODE}.png         — 1200×630 OG image, brand chrome.
  - public/state/{code}.html           — a real, indexable static content page:
                                          the state's actual vs. proportional
                                          delegation in readable HTML, with a
                                          link into the interactive map. No
                                          redirect, so search + AI crawlers can
                                          read it.

Run from repo root:
    python data-pipeline/generate_state_og.py

Called from update.py after projection.json is written, so a normal
`npm run pipeline` regenerates all 50 pairs.
"""

from __future__ import annotations

import json
from pathlib import Path

# NOTE: resvg_py (a binary wheel for SVG→PNG) is imported lazily inside main(),
# not here. It's in requirements.txt so CI re-renders the cards on every deploy,
# but importing it lazily means a missing/broken wheel only skips the PNGs — the
# (pure-Python) per-state HTML content pages still regenerate.

REPO_ROOT = Path(__file__).resolve().parent.parent
PROJECTION_PATH = REPO_ROOT / "public" / "data" / "projection.json"
OG_DIR = REPO_ROOT / "public" / "og"
STATE_HTML_DIR = REPO_ROOT / "public" / "state"
# Home share card. index.html points og:image at /og-card.png, so we overwrite
# that committed file with a freshly-rendered one carrying the live headline.
HOME_OG_PATH = REPO_ROOT / "public" / "og-card.png"
# Brand fonts (Source Serif 4 + Inter) shipped with the repo so the cards render
# identically everywhere — matched by family name, independent of the runner's
# installed fonts. See fonts/README.md.
FONTS_DIR = REPO_ROOT / "data-pipeline" / "fonts"

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


def build_home_card_svg(national: dict, meta: dict) -> str:
    """Return the 1200x630 home OG card carrying the live national headline.

    Mirrors build_card_svg's frame/colors but shows the national finding:
    the seat shift under PR, plus the Actual-today and Projected-under-PR
    splits and the current polling margin.
    """
    actual = national["actual"]
    projected = national["projected"]
    d_gain = projected["d_seats"] - actual["d_seats"]
    if d_gain == 0:
        headline = "No shift under PR"
        headline_color = "#5C5C5A"
    elif d_gain > 0:
        headline = f"+{d_gain} seats toward Democrats"
        headline_color = "#2166ac"
    else:
        headline = f"+{abs(d_gain)} seats toward Republicans"
        headline_color = "#B2182B"

    margin = meta.get("generic_ballot_margin", 0.0)
    polling = f"D+{margin:.1f}" if margin >= 0 else f"R+{abs(margin):.1f}"

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#F4EDE0"/>
  {LOGOMARK_SVG}
  <text x="500" y="150" font-family="'Inter', -apple-system, sans-serif" font-size="16" letter-spacing="3" fill="#888780">THE PROPORTIONAL HOUSE</text>
  <text x="500" y="218" font-family="'Source Serif 4', 'Times New Roman', Georgia, serif" font-size="46" font-weight="600" fill="{headline_color}" letter-spacing="-0.01em">{headline}</text>
  <text x="500" y="258" font-family="'Source Serif 4', 'Times New Roman', Georgia, serif" font-size="22" font-style="italic" fill="#5C5C5A">under today's polling ({polling})</text>

  <text x="500" y="345" font-family="'Inter', -apple-system, sans-serif" font-size="14" letter-spacing="2" fill="#888780">ACTUAL TODAY</text>
  <text x="500" y="395" font-family="'Inter', -apple-system, sans-serif" font-size="48" font-weight="600">
    <tspan fill="#2166ac">D {actual['d_seats']}</tspan>
    <tspan fill="#5C5C5A" font-weight="400">  ·  </tspan>
    <tspan fill="#B2182B">R {actual['r_seats']}</tspan>
  </text>

  <text x="820" y="345" font-family="'Inter', -apple-system, sans-serif" font-size="14" letter-spacing="2" fill="#888780">PROJECTED UNDER PR</text>
  <text x="820" y="395" font-family="'Inter', -apple-system, sans-serif" font-size="48" font-weight="600">
    <tspan fill="#2166ac">D {projected['d_seats']}</tspan>
    <tspan fill="#5C5C5A" font-weight="400">  ·  </tspan>
    <tspan fill="#B2182B">R {projected['r_seats']}</tspan>
  </text>

  <text x="500" y="555" font-family="'Source Serif 4', 'Times New Roman', Georgia, serif" font-size="20" fill="#1F2E4D">The Proportional House</text>
  <text x="500" y="585" font-family="'Inter', -apple-system, sans-serif" font-size="14" fill="#888780">proportionalhouse.org</text>
</svg>"""


def build_html_page(state: dict, og_version: str = "") -> str:
    """Return the static /state/{code}.html page — a real, indexable content
    page (no redirect) that search + AI crawlers can read, with a link into the
    interactive SPA map.

    og_version, when set, is appended to the og:image URL (?v=...) so social
    platforms re-fetch the regenerated card instead of a stale cached copy."""
    name = state["name"]
    code = state["code"]
    code_lower = code.lower()
    seats = state["seats"]
    actual = state["actual"]
    projected = state["projected"]
    ad, ar = actual["d_seats"], actual["r_seats"]
    pd, pr = projected["d_seats"], projected["r_seats"]
    d_gain = pd - ad
    if d_gain > 0:
        n = d_gain
        shift = f"a shift of {n} {'seat' if n == 1 else 'seats'} toward Democrats"
        change_desc = f"+{d_gain} Democratic seats"
    elif d_gain < 0:
        n = abs(d_gain)
        shift = f"a shift of {n} {'seat' if n == 1 else 'seats'} toward Republicans"
        change_desc = f"+{n} Republican seats"
    else:
        shift = "no net change in the partisan split"
        change_desc = "no net seat change"
    description = (
        f"{name} under proportional representation: its {seats}-seat U.S. House delegation is "
        f"actually D {ad}/R {ar}; allocated proportionally to the statewide vote it would be "
        f"D {pd}/R {pr} ({change_desc})."
    )
    og_image = f"{SITE_URL}/og/state-{code}.png"
    if og_version:
        og_image += f"?v={og_version}"
    spa_url = f"/?state={code}"
    # Self-canonical keeps each /state/{code} page indexable in its own right
    # (the sitemap lists them for exactly this reason).
    canonical_url = f"{SITE_URL}/state/{code_lower}"
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{name} under proportional representation · The Proportional House</title>
<meta name="description" content="{description}">
<link rel="canonical" href="{canonical_url}">

<meta property="og:type" content="website">
<meta property="og:title" content="{name} under proportional representation">
<meta property="og:description" content="{description}">
<meta property="og:url" content="{canonical_url}">
<meta property="og:image" content="{og_image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{name} under proportional representation">
<meta name="twitter:description" content="{description}">
<meta name="twitter:image" content="{og_image}">

<meta name="theme-color" content="#1F2E4D">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">

<style>
  :root {{ --navy:#1F2E4D; --cream:#F4EDE0; --d:#2166ac; --r:#b2182b; --ink:#3f3f46; --mut:#71717a; }}
  body {{ font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
          background: var(--cream); color: var(--ink); margin: 0; line-height: 1.6; }}
  main {{ max-width: 640px; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }}
  .kicker {{ font-size: .8rem; letter-spacing: .04em; text-transform: uppercase; color: var(--mut); margin: 0 0 .75rem; }}
  .kicker a {{ color: var(--mut); text-decoration: none; }}
  h1 {{ font-family: Georgia, "Times New Roman", serif; color: var(--navy);
        font-weight: 600; font-size: 2rem; line-height: 1.15; margin: 0 0 1rem; }}
  .lede {{ font-size: 1.1rem; color: var(--navy); margin: 0 0 1.5rem; }}
  .d {{ color: var(--d); font-weight: 700; }} .r {{ color: var(--r); font-weight: 700; }}
  .stats {{ display: flex; flex-wrap: wrap; gap: .75rem; margin: 0 0 1.5rem; }}
  .stat {{ flex: 1 1 200px; background: #fff; border: 1px solid #e7e5e4; border-radius: .5rem; padding: .85rem 1rem; }}
  .stat .lab {{ font-size: .7rem; letter-spacing: .06em; text-transform: uppercase; color: var(--mut); }}
  .stat .val {{ font-size: 1.5rem; font-weight: 700; margin-top: .15rem; }}
  .cta {{ display: inline-block; background: var(--navy); color: #fff; text-decoration: none;
          padding: .6rem 1.1rem; border-radius: 999px; font-weight: 600; }}
  .note {{ font-size: .9rem; color: var(--mut); margin-top: 2rem; }}
  a {{ color: var(--navy); }}
</style>
</head>
<body>
<main>
  <p class="kicker"><a href="/">The Proportional House</a></p>
  <h1>{name} under proportional representation</h1>
  <p class="lede">{name}&rsquo;s {seats}-seat U.S. House delegation is currently
    <span class="d">D&nbsp;{ad}</span> &middot; <span class="r">R&nbsp;{ar}</span>.
    Allocated in proportion to its statewide House vote, it would be
    <span class="d">D&nbsp;{pd}</span> &middot; <span class="r">R&nbsp;{pr}</span> &mdash; {shift}.</p>
  <div class="stats">
    <div class="stat"><div class="lab">Actual today</div>
      <div class="val"><span class="d">D&nbsp;{ad}</span> &middot; <span class="r">R&nbsp;{ar}</span></div></div>
    <div class="stat"><div class="lab">Under proportional representation</div>
      <div class="val"><span class="d">D&nbsp;{pd}</span> &middot; <span class="r">R&nbsp;{pr}</span></div></div>
  </div>
  <p><a class="cta" href="{spa_url}">Explore {name} on the interactive map &rarr;</a></p>
  <p class="note">{name} is one of 50 states in an interactive map of the U.S. House under
    proportional representation, updated daily from current polling. See the
    <a href="/rankings">most distorted delegations</a>, the
    <a href="/methodology">methodology and data sources</a>, or the
    <a href="/">national map</a>.</p>
</main>
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

    # PNG cards need resvg_py (a binary wheel, in requirements.txt). Render them
    # only when it imports so a missing/broken wheel degrades to HTML-only rather
    # than failing the whole deploy; the (pure-Python) HTML pages always write.
    try:
        import resvg_py
    except Exception as e:  # noqa: BLE001 — any import failure → skip PNGs
        resvg_py = None
        print(f"  (note) resvg_py unavailable ({e}); writing HTML pages only, skipping PNG cards.")

    # Render with the repo's bundled brand fonts (matched by family name, so the
    # output is identical on every machine — local + CI). System fonts stay as a
    # last-resort fallback only, so a font-load failure degrades to a readable
    # serif rather than blank text. See fonts/README.md.
    render_kw = {"width": 1200, "height": 630, "font_dirs": [str(FONTS_DIR)]}

    # Cache-buster: the cards are overwritten in place on every deploy, so stamp
    # the og:image URLs with the data date and social platforms re-fetch instead
    # of showing a stale cached image. (index.html's home-card URL is stamped at
    # build time by the og-cache-bust Vite plugin — same date, same effect.)
    og_version = str(payload.get("meta", {}).get("generated_at", ""))[:10]

    # Home share card (live national headline) → public/og-card.png.
    national = payload.get("national")
    if resvg_py and national:
        home_svg = build_home_card_svg(national, payload.get("meta", {}))
        HOME_OG_PATH.write_bytes(resvg_py.svg_to_bytes(svg_string=home_svg, **render_kw))
        print(f"Wrote home OG card to {HOME_OG_PATH.relative_to(REPO_ROOT)}")

    n_html = 0
    n_png = 0
    for state in payload["states"]:
        # HTML content page — always written (pure Python, no resvg).
        (STATE_HTML_DIR / f"{state['code'].lower()}.html").write_text(build_html_page(state, og_version))
        n_html += 1
        # PNG share-card — only when resvg is available.
        if resvg_py:
            png = resvg_py.svg_to_bytes(svg_string=build_card_svg(state), **render_kw)
            (OG_DIR / f"state-{state['code']}.png").write_bytes(png)
            n_png += 1

    print(f"Wrote {n_html} per-state HTML pages to {STATE_HTML_DIR.relative_to(REPO_ROOT)}/")
    if n_png:
        print(f"Wrote {n_png} per-state OG cards to {OG_DIR.relative_to(REPO_ROOT)}/")


if __name__ == "__main__":
    main()
