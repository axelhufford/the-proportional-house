"""Fetch and parse the U.S. House Clerk's official 2024 election statistics PDF
to produce baseline/house_2024.json.

Source: https://history.house.gov/Institution/Election-Statistics/2024election/
        (Statistics of the Presidential and Congressional Election of November 5,
         2024 — compiled by the Office of the Clerk, U.S. House of Representatives,
         published March 10, 2025.)

This is the canonical source FEC and most aggregators cite. The recapitulation
table on page 86 of the PDF gives per-state Republican/Democratic/third-party
totals for U.S. Representatives.

Note: state-level totals INCLUDE uncontested districts, which distorts the
two-party share in states where one party ran unopposed in some seats. We flag
those states with `baseline_distortion_warning=True`. Per-district imputation
is deferred until CD-level presidential data is wired in.
"""

from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict

import pdfplumber
import requests

from io_utils import write_bytes_atomic, write_json_atomic

REPO_ROOT = Path(__file__).resolve().parent.parent
PDF_URL = "https://history.house.gov/Institution/Election-Statistics/2024election/"
PDF_PATH = REPO_ROOT / "data-pipeline" / "baseline" / "clerk_2024_statistics.pdf"
OUT_PATH = REPO_ROOT / "data-pipeline" / "baseline" / "house_2024.json"

# Per-state seat counts from the 2024 House election. Sourced from Wikipedia's
# "Per state" summary table because the Clerk PDF only gives per-district
# winners (parsing each state's page would work but is fragile).
#
# SCOPE: this table reports the delegation *as elected in November 2024*. It is
# not a live composition feed — it does not move when a seat changes hands in a
# special election. An earlier comment here claimed it did; it does not, and
# nothing downstream should be documented as if it does.
#
# We read `action=raw` wikitext rather than the rendered page. The rendered HTML
# is now Parsoid output, where every element carries id="mw…" attributes and
# `data-mw` payloads containing escaped markup — the previous regexes over bare
# `<tr>`/`<th>` tags silently matched nothing, so this scrape had been returning
# zero states and failing.
WIKIPEDIA_RESULTS_URL = "https://en.wikipedia.org/wiki/2024_United_States_House_of_Representatives_elections"
WIKIPEDIA_RAW_URL = (
    "https://en.wikipedia.org/w/index.php"
    "?title=2024_United_States_House_of_Representatives_elections&action=raw"
)

# Static data files for uncontested-race imputation. Stage 1 covers just
# state-level cases (only Vermont currently); within-state uncontested
# districts in FL/NY/TX/etc. are tracked as a deferred v2 item — they need
# per-CD presidential data with no clean fetchable source yet.
UNCONTESTED_PATH = REPO_ROOT / "data-pipeline" / "baseline" / "uncontested_2024.json"
PRES_BY_CD_PATH = REPO_ROOT / "data-pipeline" / "baseline" / "pres_by_cd_2024.json"

# Recapitulation table layout on page 86 of the Clerk PDF. Y-ranges identified
# by reading the rotated column-header chars; (col, y_max, y_min) means a char
# belongs to `col` if y_min < top <= y_max.
RECAP_PAGE_INDEX = 85  # zero-indexed; page 86 in human terms
COLS = [
    ("State",        770, 660),
    ("Republican",   660, 560),
    ("Democratic",   560, 505),
    ("Independent",  505, 440),
    ("Libertarian",  440, 370),
    ("Green",        370, 320),
    ("Constitution", 320, 250),
    ("Other",        250, 175),
    ("Write-in",     175, 115),
    ("Total",        115,   0),
]
VALUE_COLS = [c[0] for c in COLS[1:]]

STATES_TO_FIPS = {
    "Alabama": "01", "Alaska": "02", "Arizona": "04", "Arkansas": "05",
    "California": "06", "Colorado": "08", "Connecticut": "09", "Delaware": "10",
    "Florida": "12", "Georgia": "13", "Hawaii": "15", "Idaho": "16",
    "Illinois": "17", "Indiana": "18", "Iowa": "19", "Kansas": "20",
    "Kentucky": "21", "Louisiana": "22", "Maine": "23", "Maryland": "24",
    "Massachusetts": "25", "Michigan": "26", "Minnesota": "27", "Mississippi": "28",
    "Missouri": "29", "Montana": "30", "Nebraska": "31", "Nevada": "32",
    "New Hampshire": "33", "New Jersey": "34", "New Mexico": "35", "New York": "36",
    "North Carolina": "37", "North Dakota": "38", "Ohio": "39", "Oklahoma": "40",
    "Oregon": "41", "Pennsylvania": "42", "Rhode Island": "44", "South Carolina": "45",
    "South Dakota": "46", "Tennessee": "47", "Texas": "48", "Utah": "49",
    "Vermont": "50", "Virginia": "51", "Washington": "53", "West Virginia": "54",
    "Wisconsin": "55", "Wyoming": "56",
}
STATE_CODES = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR",
    "California": "CA", "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE",
    "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID",
    "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS",
    "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD",
    "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS",
    "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
    "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
    "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK",
    "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC",
    "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT",
    "Vermont": "VT", "Virginia": "VA", "Washington": "WA", "West Virginia": "WV",
    "Wisconsin": "WI", "Wyoming": "WY",
}

# 119th Congress apportionment (effective for 2024 election).
SEATS_2024 = {
    "AL": 7, "AK": 1, "AZ": 9, "AR": 4, "CA": 52, "CO": 8, "CT": 5, "DE": 1,
    "FL": 28, "GA": 14, "HI": 2, "ID": 2, "IL": 17, "IN": 9, "IA": 4, "KS": 4,
    "KY": 6, "LA": 6, "ME": 2, "MD": 8, "MA": 9, "MI": 13, "MN": 8, "MS": 4,
    "MO": 8, "MT": 2, "NE": 3, "NV": 4, "NH": 2, "NJ": 12, "NM": 3, "NY": 26,
    "NC": 14, "ND": 1, "OH": 15, "OK": 5, "OR": 6, "PA": 17, "RI": 2, "SC": 7,
    "SD": 1, "TN": 9, "TX": 38, "UT": 4, "VT": 1, "VA": 11, "WA": 10, "WV": 2,
    "WI": 8, "WY": 1,
}

def _wikitext_cell_int(line: str) -> int | None:
    """Extract the integer from one wikitext table cell.

    Cells come in several shapes:
        |7                                      -> 7
        | {{Party shading/Republican}} |'''5'''  -> 5
        |{{decrease}} 1                          -> 1  (a change column)
    Take the text after the last pipe, drop any templates and bold markers,
    and parse what's left. Returns None when the cell isn't a plain number.
    """
    part = line.split("|")[-1]
    part = re.sub(r"\{\{[^}]*\}\}", "", part)  # {{decrease}}, {{Party shading/...}}
    part = part.replace("'''", "").strip()
    return int(part) if re.fullmatch(r"-?\d+", part) else None


def parse_house_composition(wikitext: str) -> Dict[str, Dict[str, int]]:
    """Parse the 'Per state' table out of the article wikitext.

    Returns a dict keyed by state code (e.g. 'CA') with {seats, d_seats, r_seats}.
    Validates that R + D == seats for every state and that the table covers all
    50 states totalling 435; raises if anything is off.

    Split out from the fetch so it can be tested against a fixture without
    hitting the network.
    """
    idx = wikitext.find("== Per state ==")
    if idx < 0:
        idx = wikitext.find("==Per state==")
    if idx < 0:
        raise RuntimeError("Could not find the 'Per state' section (article structure changed?)")
    tab_start = wikitext.find("{|", idx)
    tab_end = wikitext.find("|}", tab_start)
    if tab_start < 0 or tab_end < 0:
        raise RuntimeError("Could not locate the 'Per state' wikitable delimiters")
    table = wikitext[tab_start:tab_end]

    out: Dict[str, Dict[str, int]] = {}
    for block in table.split("\n|-"):
        # Row header is the state link: ![[#Alabama|Alabama]]
        m_state = re.search(r"^!\s*\[\[#[^|\]]+\|([^\]]+)\]\]", block.strip(), re.M)
        if not m_state:
            continue
        state = m_state.group(1).strip()
        if state not in STATE_CODES:
            continue
        cells = [ln for ln in block.strip().split("\n") if ln.startswith("|")]
        values = [_wikitext_cell_int(c) for c in cells]
        # Columns: Total | R seats | R change | D seats | D change
        if len(values) < 5 or any(v is None for v in (values[0], values[1], values[3])):
            raise RuntimeError(f"{state}: could not parse seat columns from {cells!r}")
        total, r_seats, d_seats = values[0], values[1], values[3]
        if r_seats + d_seats != total:
            raise RuntimeError(f"{state}: R({r_seats}) + D({d_seats}) != total ({total})")
        out[STATE_CODES[state]] = {"seats": total, "r_seats": r_seats, "d_seats": d_seats}

    if len(out) != 50:
        missing = sorted(set(STATE_CODES.values()) - set(out))
        raise RuntimeError(f"Expected 50 states, got {len(out)} (missing: {', '.join(missing)})")
    total_seats = sum(v["seats"] for v in out.values())
    if total_seats != 435:
        raise RuntimeError(f"Total seats = {total_seats}, expected 435")
    nat_r = sum(v["r_seats"] for v in out.values())
    nat_d = sum(v["d_seats"] for v in out.values())
    print(f"  parsed 50 states: D {nat_d} / R {nat_r} (total {total_seats})")
    return out


def fetch_house_composition() -> Dict[str, Dict[str, int]]:
    """Fetch and parse the per-state 2024 House election results table.

    This is the delegation *as elected in November 2024* — see the note on
    WIKIPEDIA_RAW_URL. It is not adjusted for subsequent special elections.
    """
    print(f"Fetching {WIKIPEDIA_RAW_URL}")
    r = requests.get(
        WIKIPEDIA_RAW_URL,
        headers={"User-Agent": "the-proportional-house/1.0 (+https://proportionalhouse.org)"},
        timeout=30,
    )
    r.raise_for_status()
    return parse_house_composition(r.text)


def download_pdf(force: bool = False) -> Path:
    """Fetch the Clerk statistics PDF, replacing the committed copy only if the
    response really is a PDF.

    PDF_URL is a landing page that 302s and can serve HTML; `raise_for_status`
    is happy with that, so an unguarded write would clobber the committed 600 KB
    baseline with a redirect body and leave the corrupted file staged for
    commit. Check the magic bytes before touching the existing file, and write
    atomically so an interrupted download can't truncate it either.
    """
    if PDF_PATH.exists() and not force:
        return PDF_PATH
    PDF_PATH.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {PDF_URL}")
    r = requests.get(PDF_URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=60)
    r.raise_for_status()
    if not r.content.startswith(b"%PDF"):
        ctype = r.headers.get("Content-Type", "unknown")
        raise ValueError(
            f"{PDF_URL} returned {ctype} ({len(r.content)} bytes), not a PDF — "
            f"refusing to overwrite {PDF_PATH.name}. The Clerk site may have "
            f"moved the file; update PDF_URL to the direct .pdf link."
        )
    write_bytes_atomic(PDF_PATH, r.content)
    return PDF_PATH


def _column_for(top: float):
    for name, ymax, ymin in COLS:
        if ymin < top <= ymax:
            return name
    return None


def _extract_row(chars):
    cols: Dict[str, list] = defaultdict(list)
    for c in chars:
        col = _column_for(c["top"])
        if col is None:
            continue
        cols[col].append(c)
    state_chars = sorted(cols.get("State", []), key=lambda c: -c["top"])
    state_text = "".join(c["text"] for c in state_chars).strip().rstrip(".")
    state = None
    for s in sorted(STATES_TO_FIPS, key=len, reverse=True):
        if state_text.startswith(s):
            state = s
            break
    values: Dict[str, int] = {}
    for name in VALUE_COLS:
        cs = sorted(cols.get(name, []), key=lambda c: -c["top"])
        txt = "".join(c["text"] for c in cs).strip().replace(".", "").replace("\xa0", "").strip()
        if not txt:
            values[name] = 0
        else:
            try:
                values[name] = int(txt.replace(",", ""))
            except ValueError:
                values[name] = 0
    return state, values


def parse_recap(pdf_path: Path) -> Dict[str, Dict[str, int]]:
    with pdfplumber.open(str(pdf_path)) as pdf:
        page = pdf.pages[RECAP_PAGE_INDEX]
        by_x = defaultdict(list)
        for c in page.chars:
            by_x[round(c["x0"])].append(c)
        xs = sorted(by_x.keys())

        rows = [(x, *_extract_row(by_x[x])) for x in xs]
        merged: Dict[str, Dict[str, int]] = {}
        for i, (x, state, vals) in enumerate(rows):
            if state is None:
                continue
            all_zero = all(v == 0 for v in vals.values())
            if all_zero and i > 0:
                # Wyoming-style split: numbers row precedes the state-name row.
                x_prev, st_prev, v_prev = rows[i - 1]
                if st_prev is None and any(v != 0 for v in v_prev.values()):
                    vals = v_prev
            merged[state] = vals

    # Validate: parts sum to Total for every state.
    for state, v in merged.items():
        parts = sum(v[k] for k in VALUE_COLS[:-1])
        if parts != v["Total"]:
            raise ValueError(f"{state}: parts {parts} != Total {v['Total']}")
    return merged


def _compute_state_elasticities() -> dict:
    """Compute per-state pres swing 2020→2024 and elasticity coefficients
    from The Downballot's pres-by-CD percentages.

    Aggregation: unweighted mean of CD-level D-margin within each state.
    Congressional districts are roughly equipopulated (~760k each), so the
    unweighted mean is within ~1 point of the true population-weighted state
    margin. The clamp [0.3, 2.0] handles three classes of outliers:
      - States whose 2020→2024 swing was tiny relative to the national 5.9-
        point shift (near-zero numerator → unstable elasticity).
      - States that swung opposite to the national tide (a handful — would
        otherwise yield negative elasticity, which is well-defined math but
        produces backward projections).
      - Big outliers (e.g., NY moved >10 pts; FL moved similarly) which can
        produce elasticities >2 and over-amplify in extreme sandbox values.

    Returns a dict with:
      - `national_swing` (float): aggregate national D-margin shift 2020→2024.
      - `states` (dict): keyed by state CODE; each value has
          { "state_dmargin_2020", "state_dmargin_2024",
            "state_swing", "elasticity_raw", "elasticity" }.
    """
    if not PRES_BY_CD_PATH.exists():
        return {"national_swing": 0.0, "states": {}}
    with PRES_BY_CD_PATH.open() as f:
        pres = json.load(f)
    districts = pres.get("districts", {})

    by_state: Dict[str, list] = {}
    all_d_2020: list[float] = []
    all_d_2024: list[float] = []
    for cd, p in districts.items():
        state = cd.split("-", 1)[0]
        d2020 = float(p["biden_pct_2020"]) - float(p["trump_pct_2020"])
        d2024 = float(p["harris_pct"]) - float(p["trump_pct"])
        by_state.setdefault(state, []).append((d2020, d2024))
        all_d_2020.append(d2020)
        all_d_2024.append(d2024)

    nat_d_2020 = sum(all_d_2020) / len(all_d_2020)
    nat_d_2024 = sum(all_d_2024) / len(all_d_2024)
    national_swing = nat_d_2024 - nat_d_2020  # negative = R-ward

    states_out: Dict[str, dict] = {}
    for state, pairs in by_state.items():
        d2020 = sum(p[0] for p in pairs) / len(pairs)
        d2024 = sum(p[1] for p in pairs) / len(pairs)
        swing = d2024 - d2020
        if abs(national_swing) < 0.5:
            raw = 1.0
        else:
            raw = swing / national_swing
        elasticity = max(0.3, min(2.0, raw))
        states_out[state] = {
            "state_dmargin_2020": round(d2020, 3),
            "state_dmargin_2024": round(d2024, 3),
            "state_swing": round(swing, 3),
            "elasticity_raw": round(raw, 3),
            "elasticity": round(elasticity, 3),
        }
    return {"national_swing": round(national_swing, 3), "states": states_out}


def _apply_uncontested_imputation(state_totals: Dict[str, Dict[str, int]]) -> Dict[str, dict]:
    """For each uncontested district, replace the district's two-party House
    contribution to its state total with the district's 2024 presidential
    two-party totals. This isolates each state's partisan lean from accidents
    of candidate recruitment (e.g. Vermont's 100/0 House baseline becomes
    ~64/32 once we substitute the presidential split).

    Stage 1 only covers districts listed in baseline/uncontested_2024.json
    (currently just VT-AL). Within-state uncontested cases are a deferred v2.

    Mutates state_totals in place AND returns metadata about what was done,
    keyed by state name (matching the keys in state_totals). Each metadata
    entry has {imputed_district_count, imputed_district_ids}.
    """
    if not UNCONTESTED_PATH.exists() or not PRES_BY_CD_PATH.exists():
        return {}

    with UNCONTESTED_PATH.open() as f:
        uncontested = json.load(f)
    with PRES_BY_CD_PATH.open() as f:
        pres_by_cd = json.load(f)

    pres_districts = pres_by_cd.get("districts", {})

    code_to_state_name = {code: name for name, code in STATE_CODES.items()}
    metadata: Dict[str, dict] = {}

    for district in uncontested.get("districts", []):
        cd = district["cd"]
        state_code = district["state"]
        missing_party = district["missing_party"]
        unopposed_party = district["unopposed_party"]
        unopposed_votes = district["unopposed_votes"]

        pres = pres_districts.get(cd)
        if not pres:
            print(f"  Skipping {cd}: no presidential data in pres_by_cd_2024.json")
            continue

        state_name = code_to_state_name.get(state_code)
        if state_name is None or state_name not in state_totals:
            print(f"  Skipping {cd}: state code {state_code} not in recap")
            continue

        totals = state_totals[state_name]
        harris_pct = pres["harris_pct"]
        trump_pct = pres["trump_pct"]

        # The Downballot CSV gives percentages of total district pres votes.
        # Convert to a counterfactual two-party split of the district's House
        # turnout (using `unopposed_votes` as a proxy for district turnout).
        # Renormalize to two-party so the totals sum exactly to the district
        # turnout we're replacing.
        two_party_pct = harris_pct + trump_pct
        if two_party_pct <= 0:
            print(f"  Skipping {cd}: degenerate pres data ({pres!r})")
            continue
        d_share = harris_pct / two_party_pct
        r_share = trump_pct / two_party_pct
        counterfactual_d = int(round(d_share * unopposed_votes))
        counterfactual_r = int(round(r_share * unopposed_votes))

        # Subtract the unopposed candidate's actual House votes from the
        # winning party's state total, then add the counterfactual D and R
        # for the district.
        if unopposed_party == "R":
            totals["Republican"] -= unopposed_votes
        elif unopposed_party == "D":
            totals["Democratic"] -= unopposed_votes
        totals["Republican"] += counterfactual_r
        totals["Democratic"] += counterfactual_d

        # Other / Total adjustments: keep "Other" the same (we don't touch
        # third-party votes in the district); recompute Total as R+D+others.
        others = sum(
            totals[k]
            for k in ["Independent", "Libertarian", "Green", "Constitution", "Other", "Write-in"]
        )
        totals["Total"] = totals["Republican"] + totals["Democratic"] + others

        meta = metadata.setdefault(
            state_name, {"imputed_district_count": 0, "imputed_district_ids": []}
        )
        meta["imputed_district_count"] += 1
        meta["imputed_district_ids"].append(cd)
        print(
            f"  Imputed {cd}: missing {missing_party} | pres D {harris_pct:.1f}% / R {trump_pct:.1f}% "
            f"→ counterfactual D {counterfactual_d:,} / R {counterfactual_r:,} "
            f"(replaces unopposed-{unopposed_party} {unopposed_votes:,})"
        )

    return metadata


def main(force_download: bool = False) -> None:
    pdf_path = download_pdf(force=force_download)
    raw = parse_recap(pdf_path)
    composition = fetch_house_composition()

    print("Applying uncontested-district imputation...")
    imputation_meta = _apply_uncontested_imputation(raw)
    n_imputed = sum(m["imputed_district_count"] for m in imputation_meta.values())
    print(f"  Imputed {n_imputed} district(s) across {len(imputation_meta)} state(s)")

    print("Computing state elasticities (pres swing 2020→2024)...")
    elasticity_data = _compute_state_elasticities()
    nat_swing = elasticity_data.get("national_swing", 0.0)
    print(f"  National D-margin swing 2020→2024: {nat_swing:+.2f} pts")
    print(f"  Elasticity range across {len(elasticity_data.get('states', {}))} states: "
          f"{min((s['elasticity'] for s in elasticity_data['states'].values()), default=0):.2f} – "
          f"{max((s['elasticity'] for s in elasticity_data['states'].values()), default=0):.2f}")

    states_out = []
    nat_r = nat_d = nat_total = 0
    nat_actual_d = nat_actual_r = 0
    for state, v in raw.items():
        code = STATE_CODES[state]
        fips = STATES_TO_FIPS[state]
        r, d, total = v["Republican"], v["Democratic"], v["Total"]
        two_party = r + d
        if two_party == 0:
            d_share = r_share = 0.5
        else:
            d_share = d / two_party
            r_share = r / two_party
        # Baseline distortion now only flags the rare case where, even AFTER
        # uncontested imputation, one party has zero recorded votes — which
        # would happen only if a state-level uncontested case wasn't covered
        # in uncontested_2024.json. In Stage 1 only VT has a state-level
        # case and it IS covered, so this should never fire for v1 data.
        baseline_distortion = (r == 0) or (d == 0)
        imputed = imputation_meta.get(state, {})
        comp = composition[code]
        if comp["seats"] != SEATS_2024[code]:
            raise RuntimeError(
                f"{code}: Wikipedia seats {comp['seats']} != apportionment {SEATS_2024[code]}"
            )
        elasticity_entry = elasticity_data.get("states", {}).get(code, {})
        states_out.append({
            "fips": fips,
            "code": code,
            "name": state,
            "seats": SEATS_2024[code],
            "actual_d_seats_119th": comp["d_seats"],
            "actual_r_seats_119th": comp["r_seats"],
            "imputed_district_count": imputed.get("imputed_district_count", 0),
            "imputed_district_ids": imputed.get("imputed_district_ids", []),
            "state_elasticity": elasticity_entry.get("elasticity", 1.0),
            "state_elasticity_detail": elasticity_entry,
            "votes_2024": {
                "republican": r,
                "democratic": d,
                "other": total - r - d,
                "total": total,
            },
            "two_party_share_2024": {
                "d_share": round(d_share, 6),
                "r_share": round(r_share, 6),
            },
            "baseline_distortion_warning": baseline_distortion,
        })
        nat_r += r
        nat_d += d
        nat_total += total
        nat_actual_d += comp["d_seats"]
        nat_actual_r += comp["r_seats"]

    states_out.sort(key=lambda s: s["code"])

    national_margin = (nat_r - nat_d) / nat_total * 100  # positive = R lead in points
    payload = {
        "meta": {
            "source": "U.S. House Clerk, Statistics of the Presidential and Congressional Election of November 5, 2024 (published March 10, 2025).",
            "source_url": PDF_URL,
            "pdf_local_path": str(PDF_PATH.relative_to(REPO_ROOT)),
            "extracted_from_page": RECAP_PAGE_INDEX + 1,
            "composition_source": "Wikipedia, 2024 United States House of Representatives elections — 'Per state' summary table.",
            "composition_source_url": WIKIPEDIA_RESULTS_URL,
            "national_house_popular_vote": {
                "republican": nat_r,
                "democratic": nat_d,
                "total": nat_total,
                "r_margin_points": round(national_margin, 3),
            },
            "national_composition": {
                "d_seats": nat_actual_d,
                "r_seats": nat_actual_r,
                "total": nat_actual_d + nat_actual_r,
            },
            "uncontested_imputation": {
                "districts_imputed": n_imputed,
                "states_affected": sorted([STATE_CODES[s] for s in imputation_meta]),
                "method": "Replaced each uncontested district's House two-party total with that district's 2024 presidential two-party total (no down-ballot dropoff adjustment in v1).",
                "stage": "Stage 2 — all districts with both R or D missing from the Clerk PDF recap (VT, LA-4, WA-4, WA-9). FL-20 deferred (no recorded vote total).",
            },
            "state_elasticity": {
                "national_pres_swing_2020_2024_points": elasticity_data.get("national_swing"),
                "source": "Unweighted mean of CD-level 2020 Biden/Trump and 2024 Harris/Trump margins from The Downballot's pres-by-CD CSV. Per-state elasticity = state_swing / national_swing.",
                "clamp_range": [0.3, 2.0],
                "notes": "Negative or near-zero raw elasticities (states that swung opposite to national or barely moved) are clamped to 0.3. Extreme high values are clamped to 2.0. State-level elasticity-detail is exposed on each state record.",
            },
            "notes": [
                "State-level vote totals reflect uncontested-district imputation where applied (see uncontested_imputation).",
                "Two-party share is computed as R / (R + D); third parties and write-ins are excluded from the share.",
                "Actual delegation seat counts are the results of the November 2024 general election, parsed from Wikipedia's per-state summary table. They are NOT adjusted for subsequent special elections; both these counts and the two-party vote shares are fixed 2024 history, re-derived only when this script is re-run with --refresh.",
            ],
        },
        "states": states_out,
    }
    write_json_atomic(OUT_PATH, payload)
    flagged = [s["code"] for s in states_out if s["baseline_distortion_warning"]]
    print(
        f"Wrote {OUT_PATH.relative_to(REPO_ROOT)}: "
        f"national popular-vote R+{national_margin:.2f} "
        f"(R {nat_r:,} / D {nat_d:,} of {nat_total:,}). "
        f"Actual delegation: D {nat_actual_d} / R {nat_actual_r}. "
        f"Imputed: {n_imputed} district(s). "
        f"Flagged states (post-imputation): {', '.join(flagged) or 'none'}"
    )


if __name__ == "__main__":
    main(force_download="--refresh" in sys.argv)
