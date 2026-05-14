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

# 119th Congress current delegation composition (as of January 2025 swearing-in).
# Used as the "actual delegation today" comparison. Source: Clerk's office /
# Wikipedia summary table. If special elections change the count, update here.
ACTUAL_D_SEATS_2024 = {
    "AL": 2, "AK": 0, "AZ": 3, "AR": 0, "CA": 43, "CO": 5, "CT": 5, "DE": 1,
    "FL": 8, "GA": 5, "HI": 2, "ID": 0, "IL": 14, "IN": 2, "IA": 0, "KS": 1,
    "KY": 1, "LA": 2, "ME": 1, "MD": 7, "MA": 9, "MI": 7, "MN": 4, "MS": 1,
    "MO": 2, "MT": 0, "NE": 0, "NV": 3, "NH": 2, "NJ": 9, "NM": 3, "NY": 19,
    "NC": 4, "ND": 0, "OH": 5, "OK": 0, "OR": 5, "PA": 9, "RI": 2, "SC": 1,
    "SD": 0, "TN": 2, "TX": 13, "UT": 0, "VT": 1, "VA": 6, "WA": 8, "WV": 0,
    "WI": 2, "WY": 0,
}


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

    states_out = []
    nat_r = nat_d = nat_total = 0
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
        states_out.append({
            "fips": fips,
            "code": code,
            "name": state,
            "seats": SEATS_2024[code],
            "actual_d_seats_119th": ACTUAL_D_SEATS_2024[code],
            "actual_r_seats_119th": SEATS_2024[code] - ACTUAL_D_SEATS_2024[code],
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

    states_out.sort(key=lambda s: s["code"])

    national_margin = (nat_r - nat_d) / nat_total * 100  # positive = R lead in points
    payload = {
        "meta": {
            "source": "U.S. House Clerk, Statistics of the Presidential and Congressional Election of November 5, 2024 (published March 10, 2025).",
            "source_url": PDF_URL,
            "pdf_local_path": str(PDF_PATH.relative_to(REPO_ROOT)),
            "extracted_from_page": RECAP_PAGE_INDEX + 1,
            "national_house_popular_vote": {
                "republican": nat_r,
                "democratic": nat_d,
                "total": nat_total,
                "r_margin_points": round(national_margin, 3),
            },
            "notes": [
                "State-level totals include uncontested districts. States with one major party absent from the recap are flagged baseline_distortion_warning=True.",
                "Per-district uncontested-race imputation requires CD-level presidential vote share (deferred; would let us recover a counterfactual two-party share for unopposed districts).",
                "Two-party share is computed as R / (R + D); third parties and write-ins are excluded from the share.",
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
        f"national R+{national_margin:.2f} "
        f"(R {nat_r:,} / D {nat_d:,} of {nat_total:,}). "
        f"Flagged states: {', '.join(flagged) or 'none'}"
    )


if __name__ == "__main__":
    main(force_download="--refresh" in sys.argv)
