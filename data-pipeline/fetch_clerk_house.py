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

REPO_ROOT = Path(__file__).resolve().parent.parent
PDF_URL = "https://history.house.gov/Institution/Election-Statistics/2024election/"
PDF_PATH = REPO_ROOT / "data-pipeline" / "baseline" / "clerk_2024_statistics.pdf"
OUT_PATH = REPO_ROOT / "data-pipeline" / "baseline" / "house_2024.json"

# Per-state seat counts from the 2024 House election. Sourced from Wikipedia's
# "Per state" summary table because the Clerk PDF only gives per-district
# winners (parsing each state's page would work but is fragile). Wikipedia's
# table updates if special elections shift the count, which is what we want
# for "actual delegation today".
WIKIPEDIA_RESULTS_URL = "https://en.wikipedia.org/wiki/2024_United_States_House_of_Representatives_elections"

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

def fetch_house_composition() -> Dict[str, Dict[str, int]]:
    """Scrape Wikipedia's per-state 2024 House election results table.

    Returns a dict keyed by state code (e.g. 'CA') with {seats, d_seats, r_seats}.

    Wikipedia maintains this table and updates it if special elections shift
    the count, so this gives us the real current delegation rather than a
    hardcoded snapshot. Validates that R + D == seats for every state and
    totals to 435; raises if anything's off.
    """
    print(f"Fetching {WIKIPEDIA_RESULTS_URL}")
    r = requests.get(WIKIPEDIA_RESULTS_URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
    r.raise_for_status()
    html = r.text

    anchor_idx = html.find('id="Per_state"')
    if anchor_idx < 0:
        raise RuntimeError("Could not find 'Per_state' anchor in Wikipedia page (page structure may have changed)")
    slice_ = html[anchor_idx:anchor_idx + 200000]
    tab_start = slice_.find('<table class="wikitable sortable"')
    tab_end = slice_.find("</table>", tab_start) + len("</table>")
    table_html = slice_[tab_start:tab_end]

    def strip_html(s: str) -> str:
        return re.sub(r"<[^>]+>", "", s).strip()

    out: Dict[str, Dict[str, int]] = {}
    for tr in re.findall(r"<tr>\s*(.*?)\s*</tr>", table_html, re.DOTALL):
        m_state = re.search(r'<th><a href="#[^"]+"[^>]*>([A-Z][a-zA-Z ]+)</a>', tr)
        if not m_state:
            continue
        state = m_state.group(1)
        if state not in STATE_CODES:
            continue
        tds = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.DOTALL)
        if len(tds) < 5:
            continue
        try:
            total = int(strip_html(tds[0]))
            r_seats = int(strip_html(tds[1]).split()[0])
            d_seats = int(strip_html(tds[3]).split()[0])
        except (ValueError, IndexError):
            continue
        if r_seats + d_seats != total:
            raise RuntimeError(f"{state}: R({r_seats}) + D({d_seats}) != total ({total})")
        out[STATE_CODES[state]] = {"seats": total, "r_seats": r_seats, "d_seats": d_seats}

    if len(out) != 50:
        raise RuntimeError(f"Expected 50 states, got {len(out)}")
    total_seats = sum(v["seats"] for v in out.values())
    if total_seats != 435:
        raise RuntimeError(f"Total seats = {total_seats}, expected 435")
    nat_r = sum(v["r_seats"] for v in out.values())
    nat_d = sum(v["d_seats"] for v in out.values())
    print(f"  parsed 50 states: D {nat_d} / R {nat_r} (total {total_seats})")
    return out


def download_pdf(force: bool = False) -> Path:
    if PDF_PATH.exists() and not force:
        return PDF_PATH
    PDF_PATH.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {PDF_URL}")
    r = requests.get(PDF_URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=60)
    r.raise_for_status()
    PDF_PATH.write_bytes(r.content)
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


def main(force_download: bool = False) -> None:
    pdf_path = download_pdf(force=force_download)
    raw = parse_recap(pdf_path)
    composition = fetch_house_composition()

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
        # Flag states where one major party ran no candidate at the state level —
        # the only way to know that purely from the recap. Per-district uncontested
        # imputation needs CD-level presidential data and is deferred.
        baseline_distortion = (r == 0) or (d == 0)
        comp = composition[code]
        if comp["seats"] != SEATS_2024[code]:
            raise RuntimeError(
                f"{code}: Wikipedia seats {comp['seats']} != apportionment {SEATS_2024[code]}"
            )
        states_out.append({
            "fips": fips,
            "code": code,
            "name": state,
            "seats": SEATS_2024[code],
            "actual_d_seats_119th": comp["d_seats"],
            "actual_r_seats_119th": comp["r_seats"],
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
            "notes": [
                "State-level vote totals include uncontested districts. States with one major party absent from the recap are flagged baseline_distortion_warning=True.",
                "Per-district uncontested-race imputation requires CD-level presidential vote share (deferred; would let us recover a counterfactual two-party share for unopposed districts).",
                "Two-party share is computed as R / (R + D); third parties and write-ins are excluded from the share.",
                "Actual delegation seat counts are scraped from Wikipedia's per-state results table on every pipeline run, so special-election shifts propagate automatically.",
            ],
        },
        "states": states_out,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w") as f:
        json.dump(payload, f, indent=2)
    flagged = [s["code"] for s in states_out if s["baseline_distortion_warning"]]
    print(
        f"Wrote {OUT_PATH.relative_to(REPO_ROOT)}: "
        f"national popular-vote R+{national_margin:.2f} "
        f"(R {nat_r:,} / D {nat_d:,} of {nat_total:,}). "
        f"Actual delegation: D {nat_actual_d} / R {nat_actual_r}. "
        f"Flagged states: {', '.join(flagged) or 'none'}"
    )


if __name__ == "__main__":
    main(force_download="--refresh" in sys.argv)
