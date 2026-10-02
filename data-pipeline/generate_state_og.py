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
META_PATH = REPO_ROOT / "public" / "data" / "meta.json"


def frozen_on(meta: dict) -> str | None:
    """Publication date (YYYY-MM-DD) of the frozen final projection, or None
    before the election freeze (see data-pipeline/freeze.py)."""
    election = meta.get("election") or {}
    if election.get("phase", "projection") == "projection":
        return None
    return str(meta.get("generated_at", ""))[:10] or None
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


def build_card_svg(
    state: dict, *, left_label: str = "AS ELECTED 2024", right_label: str = "PROJECTED UNDER PR",
    shift_override: tuple[str, str] | None = None,
) -> str:
    """Return a 1200x630 SVG OG card for a single state.

    The keyword arguments relabel it for election results (see
    build_results_card_svg); the defaults are the projection card."""
    name = state["name"]
    code = state["code"]
    actual = state["actual"]
    projected = state["projected"]
    d_gain = projected["d_seats"] - actual["d_seats"]
    if shift_override is not None:
        shift_label, shift_color = shift_override
    elif d_gain == 0:
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

  <text x="500" y="320" font-family="'Inter', -apple-system, sans-serif" font-size="14" letter-spacing="2" fill="#888780">{left_label}</text>
  <text x="500" y="370" font-family="'Inter', -apple-system, sans-serif" font-size="48" font-weight="600">
    <tspan fill="#2166ac">D {actual['d_seats']}</tspan>
    <tspan fill="#5C5C5A" font-weight="400">  ·  </tspan>
    <tspan fill="#B2182B">R {actual['r_seats']}</tspan>
  </text>

  <text x="820" y="320" font-family="'Inter', -apple-system, sans-serif" font-size="14" letter-spacing="2" fill="#888780">{right_label}</text>
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
    the seat shift under PR, plus the as-elected-2024 and Projected-under-PR
    splits and the current polling margin.

    The card's numbers stay on the 2024 election result — the same basis the
    projection is compared against — so the card can't disagree with the
    headline. Today's live chamber (with vacancies) is a site/API figure, not
    something a static social card should carry.
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
    under = "under the final pre-election polling" if frozen_on(meta) else "under today's polling"
    return _home_card(
        headline, headline_color, f"{under} ({polling})",
        "AS ELECTED 2024", actual, "PROJECTED UNDER PR", projected,
    )


def _home_card(headline: str, headline_color: str, subline: str,
               left_label: str, left: dict, right_label: str, right: dict) -> str:
    """The home card's frame: headline, italic subline, two labeled D/R splits."""
    actual, projected = left, right
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#F4EDE0"/>
  {LOGOMARK_SVG}
  <text x="500" y="150" font-family="'Inter', -apple-system, sans-serif" font-size="16" letter-spacing="3" fill="#888780">THE PROPORTIONAL HOUSE</text>
  <text x="500" y="218" font-family="'Source Serif 4', 'Times New Roman', Georgia, serif" font-size="46" font-weight="600" fill="{headline_color}" letter-spacing="-0.01em">{headline}</text>
  <text x="500" y="258" font-family="'Source Serif 4', 'Times New Roman', Georgia, serif" font-size="22" font-style="italic" fill="#5C5C5A">{subline}</text>

  <text x="500" y="345" font-family="'Inter', -apple-system, sans-serif" font-size="14" letter-spacing="2" fill="#888780">{left_label}</text>
  <text x="500" y="395" font-family="'Inter', -apple-system, sans-serif" font-size="48" font-weight="600">
    <tspan fill="#2166ac">D {actual['d_seats']}</tspan>
    <tspan fill="#5C5C5A" font-weight="400">  ·  </tspan>
    <tspan fill="#B2182B">R {actual['r_seats']}</tspan>
  </text>

  <text x="820" y="345" font-family="'Inter', -apple-system, sans-serif" font-size="14" letter-spacing="2" fill="#888780">{right_label}</text>
  <text x="820" y="395" font-family="'Inter', -apple-system, sans-serif" font-size="48" font-weight="600">
    <tspan fill="#2166ac">D {projected['d_seats']}</tspan>
    <tspan fill="#5C5C5A" font-weight="400">  ·  </tspan>
    <tspan fill="#B2182B">R {projected['r_seats']}</tspan>
  </text>

  <text x="500" y="555" font-family="'Source Serif 4', 'Times New Roman', Georgia, serif" font-size="20" fill="#1F2E4D">The Proportional House</text>
  <text x="500" y="585" font-family="'Inter', -apple-system, sans-serif" font-size="14" fill="#888780">proportionalhouse.org</text>
</svg>"""


def _uncalled_phrase(n: int) -> str:
    return f"{n} {'race' if n == 1 else 'races'} not yet called"


def build_results_card_svg(state: dict, result: dict, cycle: int) -> str:
    """A state's OG card once it has votes counted: races called vs. PR of the
    vote counted. No shift is claimed while a race is uncalled."""
    ae, pr = result["as_elected"], result["under_pr"]
    certified = result["status"] == "certified"
    uncalled = ae["uncalled_seats"]
    return build_card_svg(
        {**state, "actual": {"d_seats": ae["d_seats"], "r_seats": ae["r_seats"]}, "projected": pr},
        left_label=f"AS ELECTED {cycle}" if uncalled == 0 else "CALLED SO FAR",
        right_label=f"UNDER PR · {cycle} VOTE" if certified else "UNDER PR · VOTES COUNTED",
        shift_override=(_uncalled_phrase(uncalled), "#5C5C5A") if uncalled else None,
    )


def build_results_home_card_svg(results: dict) -> str:
    """The home OG card once votes are counted. The headline seat shift appears
    only when every race is called and every state is reporting."""
    meta, nat = results["meta"], results["national"]
    cycle = meta["cycle"]
    ae, pr = nat["as_elected"], nat["under_pr"]
    complete = meta["all_called"] and pr["pending_seats"] == 0
    status = "certified" if meta["all_certified"] else "provisional"
    reporting = sum(1 for s in results["states"] if s.get("under_pr"))
    if complete:
        d_gain = pr["d_seats"] - ae["d_seats"]
        if d_gain == 0:
            headline, color = "No shift under PR", "#5C5C5A"
        elif d_gain > 0:
            headline, color = f"+{d_gain} seats toward Democrats", "#2166ac"
        else:
            headline, color = f"+{abs(d_gain)} seats toward Republicans", "#B2182B"
        sub = f"{cycle} House results under PR ({status})"
    else:
        headline, color = f"{cycle} results: counting", "#1F2E4D"
        sub = f"{meta['seats_called']} of 435 races called · {reporting} of 50 states reporting"
    return _home_card(
        headline, color, sub,
        f"AS ELECTED {cycle}" if meta["all_called"] else "CALLED SO FAR", ae,
        f"UNDER PR · {cycle} VOTE" if meta["all_certified"] else "UNDER PR · VOTES COUNTED", pr,
    )


def build_html_page(
    state: dict, og_version: str = "", frozen_date: str | None = None,
    result: dict | None = None, cycle: int | None = None,
) -> str:
    """Return the static /state/{code}.html page — a real, indexable content
    page (no redirect) that search + AI crawlers can read, with a link into the
    interactive SPA map.

    og_version, when set, is appended to the og:image URL (?v=...) so social
    platforms re-fetch the regenerated card instead of a stale cached copy.

    frozen_date, when set, is the date the final pre-election projection was
    frozen; the page then says so instead of "updated daily".

    result, when set, is this state's entry in results_<cycle>.json: once it
    has votes counted, the page leads with the results; while pending it notes
    that nothing is reported yet."""
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
        change_desc = f"+{d_gain} Democratic {'seat' if n == 1 else 'seats'}"
    elif d_gain < 0:
        n = abs(d_gain)
        shift = f"a shift of {n} {'seat' if n == 1 else 'seats'} toward Republicans"
        change_desc = f"+{n} Republican {'seat' if n == 1 else 'seats'}"
    else:
        shift = "no net change in the partisan split"
        change_desc = "no net seat change"
    description = (
        f"{name} under proportional representation: its {seats}-seat U.S. House delegation was "
        f"elected D {ad}/R {ar} in 2024; allocated proportionally to the projected statewide vote "
        f"it would be D {pd}/R {pr} ({change_desc})."
    )
    cadence = (
        f"frozen at the final pre-election polling on {frozen_date}"
        if frozen_date
        else "updated daily from current polling"
    )
    def split(d: int, r: int) -> str:
        return f'<span class="d">D&nbsp;{d}</span> &middot; <span class="r">R&nbsp;{r}</span>'

    def stat(label: str, d: int, r: int) -> str:
        return (f'    <div class="stat"><div class="lab">{label}</div>\n'
                f'      <div class="val">{split(d, r)}</div></div>')

    lede_html = (
        f"{name}&rsquo;s {seats}-seat U.S. House delegation was elected\n    {split(ad, ar)} in 2024.\n"
        f"    Allocated in proportion to its projected statewide House vote, it would be\n"
        f"    {split(pd, pr)} &mdash; {shift}."
    )
    stats_html = stat("As elected (2024)", ad, ar) + "\n" + stat("Under proportional representation", pd, pr)
    if result and result.get("under_pr"):
        ae, upr = result["as_elected"], result["under_pr"]
        certified = result["status"] == "certified"
        uncalled = ae["uncalled_seats"]
        word = "certified" if certified else "provisional"
        other = f" &middot; {ae['other_seats']}&nbsp;other" if ae["other_seats"] else ""
        not_called = f", with {_uncalled_phrase(uncalled)}" if uncalled else ""
        lede_html = (
            f"{name}&rsquo;s {cycle} U.S. House results ({word}): {split(ae['d_seats'], ae['r_seats'])}{other} "
            f"called{not_called}. Allocated in proportion to the "
            f"{'certified vote' if certified else 'votes counted so far'}, the {seats}-seat delegation would be "
            f"{split(upr['d_seats'], upr['r_seats'])}. The final pre-election projection was "
            f"D&nbsp;{pd} &middot; R&nbsp;{pr}."
        )
        stats_html = (
            stat(f"As elected ({cycle})" if uncalled == 0 else f"Called so far ({cycle})", ae["d_seats"], ae["r_seats"])
            + "\n"
            + stat(f"Under PR ({cycle} vote)" if certified else "Under PR (votes counted)", upr["d_seats"], upr["r_seats"])
        )
        description = (
            f"{name} under proportional representation: {cycle} U.S. House results ({word}), "
            f"D {ae['d_seats']}/R {ae['r_seats']} called{not_called.replace('&nbsp;', ' ')}; allocated proportionally "
            f"to the votes counted it would be D {upr['d_seats']}/R {upr['r_seats']}."
        )
    elif result:
        lede_html += f" No {cycle} votes have been reported for {name} yet."

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
  <p class="lede">{lede_html}</p>
  <div class="stats">
{stats_html}
  </div>
  <p><a class="cta" href="{spa_url}">Explore {name} on the interactive map &rarr;</a></p>
  <p class="note">{name} is one of 50 states in an interactive map of the U.S. House under
    proportional representation, {cadence}. See the
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
    #
    # meta.json's date, not projection.json's: after the election freeze the
    # projection's timestamp stops moving, but the cards' wording changed.
    try:
        og_version = str(json.loads(META_PATH.read_text())["generated_at"])[:10]
    except (FileNotFoundError, ValueError, KeyError):
        og_version = str(payload.get("meta", {}).get("generated_at", ""))[:10]
    frozen_date = frozen_on(payload.get("meta", {}))

    # Election results (after the freeze): build_results runs before this
    # builder, so results_<cycle>.json is this run's.
    results = None
    cycle = (payload.get("meta", {}).get("election") or {}).get("cycle")
    results_path = REPO_ROOT / "public" / "data" / f"results_{cycle}.json"
    if frozen_date and cycle and results_path.exists():
        results = json.loads(results_path.read_text())
    result_by_code = {r["code"]: r for r in results["states"]} if results else {}
    any_reporting = any(r.get("under_pr") for r in result_by_code.values())

    # Home share card (live national headline) → public/og-card.png.
    national = payload.get("national")
    if resvg_py and national:
        home_svg = (
            build_results_home_card_svg(results) if any_reporting
            else build_home_card_svg(national, payload.get("meta", {}))
        )
        HOME_OG_PATH.write_bytes(resvg_py.svg_to_bytes(svg_string=home_svg, **render_kw))
        print(f"Wrote home OG card to {HOME_OG_PATH.relative_to(REPO_ROOT)}")

    n_html = 0
    n_png = 0
    for state in payload["states"]:
        # HTML content page — always written (pure Python, no resvg).
        result = result_by_code.get(state["code"])
        (STATE_HTML_DIR / f"{state['code'].lower()}.html").write_text(
            build_html_page(state, og_version, frozen_date, result, cycle)
        )
        n_html += 1
        # PNG share-card — only when resvg is available.
        if resvg_py:
            svg = (
                build_results_card_svg(state, result, cycle) if result and result.get("under_pr")
                else build_card_svg(state)
            )
            png = resvg_py.svg_to_bytes(svg_string=svg, **render_kw)
            (OG_DIR / f"state-{state['code']}.png").write_bytes(png)
            n_png += 1

    print(f"Wrote {n_html} per-state HTML pages to {STATE_HTML_DIR.relative_to(REPO_ROOT)}/")
    if n_png:
        print(f"Wrote {n_png} per-state OG cards to {OG_DIR.relative_to(REPO_ROOT)}/")


if __name__ == "__main__":
    main()
