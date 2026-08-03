"""Distill 2020 Census resident population per state into a committed baseline
for the Senate malapportionment feature.

Source: U.S. Census Bureau, 2020 Census apportionment release, "Table 2.
Resident Population for the 50 States, DC, and Puerto Rico" — a directly
downloadable .xlsx (no API key, unlike the data.census.gov API). Parsed with
the stdlib (an .xlsx is a zip of XML), so no new dependency. DC and Puerto Rico
are dropped — they have no senators (the Senate is 50 states x 2 = 100).

Writes data-pipeline/baseline/state_populations.json (committed; the offline
build_senate.py reads it). Re-runnable:

    python data-pipeline/fetch_senate_populations.py
"""

from __future__ import annotations

import html
import io
import json
import re
import zipfile
from pathlib import Path

import requests
from io_utils import write_json_atomic

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "data-pipeline" / "baseline" / "state_populations.json"

CENSUS_URL = (
    "https://www2.census.gov/programs-surveys/decennial/2020/data/apportionment/"
    "apportionment-2020-table02.xlsx"
)
SOURCE = "U.S. Census Bureau, 2020 Census resident population (apportionment release, Table 2)"
EXPECTED_50_STATE_TOTAL = 330_759_736  # 50 states (excludes DC + PR)

# 50 states only (no DC, no territories — they have no senators).
STATE_FIPS = {
    "Alabama": ("AL", "01"), "Alaska": ("AK", "02"), "Arizona": ("AZ", "04"),
    "Arkansas": ("AR", "05"), "California": ("CA", "06"), "Colorado": ("CO", "08"),
    "Connecticut": ("CT", "09"), "Delaware": ("DE", "10"), "Florida": ("FL", "12"),
    "Georgia": ("GA", "13"), "Hawaii": ("HI", "15"), "Idaho": ("ID", "16"),
    "Illinois": ("IL", "17"), "Indiana": ("IN", "18"), "Iowa": ("IA", "19"),
    "Kansas": ("KS", "20"), "Kentucky": ("KY", "21"), "Louisiana": ("LA", "22"),
    "Maine": ("ME", "23"), "Maryland": ("MD", "24"), "Massachusetts": ("MA", "25"),
    "Michigan": ("MI", "26"), "Minnesota": ("MN", "27"), "Mississippi": ("MS", "28"),
    "Missouri": ("MO", "29"), "Montana": ("MT", "30"), "Nebraska": ("NE", "31"),
    "Nevada": ("NV", "32"), "New Hampshire": ("NH", "33"), "New Jersey": ("NJ", "34"),
    "New Mexico": ("NM", "35"), "New York": ("NY", "36"), "North Carolina": ("NC", "37"),
    "North Dakota": ("ND", "38"), "Ohio": ("OH", "39"), "Oklahoma": ("OK", "40"),
    "Oregon": ("OR", "41"), "Pennsylvania": ("PA", "42"), "Rhode Island": ("RI", "44"),
    "South Carolina": ("SC", "45"), "South Dakota": ("SD", "46"), "Tennessee": ("TN", "47"),
    "Texas": ("TX", "48"), "Utah": ("UT", "49"), "Vermont": ("VT", "50"),
    "Virginia": ("VA", "51"), "Washington": ("WA", "53"), "West Virginia": ("WV", "54"),
    "Wisconsin": ("WI", "55"), "Wyoming": ("WY", "56"),
}

_SKIP_STRINGS = {"AREA", "RESIDENT POPULATION (APRIL 1, 2020)", "This cell is intentionally blank."}


def parse_census_xlsx(data: bytes) -> dict[str, int]:
    """Return {state_name: population} from the Census apportionment Table 2 xlsx."""
    z = zipfile.ZipFile(io.BytesIO(data))
    shared = [html.unescape(s) for s in re.findall(r"<t[^>]*>(.*?)</t>", z.read("xl/sharedStrings.xml").decode("utf-8"), re.S)]
    sheet = z.read("xl/worksheets/sheet1.xml").decode("utf-8")
    out: dict[str, int] = {}
    for row in re.findall(r"<row[^>]*>(.*?)</row>", sheet, re.S):
        name = None
        pop = None
        for cell in re.findall(r"<c\b[^>]*?(?:/>|>.*?</c>)", row):
            t = re.search(r'\bt="(\w+)"', cell)
            v = re.search(r"<v>([^<]*)</v>", cell)
            if not v:
                continue
            val = v.group(1)
            if t and t.group(1) == "s":  # shared-string cell → area name
                s = shared[int(val)]
                if s not in _SKIP_STRINGS and not s.startswith(("U.S.", "Table")):
                    name = s
            else:  # numeric cell → population
                try:
                    pop = int(float(val))
                except ValueError:
                    pass
        if name and pop and name not in out:  # first (population) column only
            out[name] = pop
    return out


def main() -> None:
    print(f"Fetching {CENSUS_URL}")
    r = requests.get(CENSUS_URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=60)
    r.raise_for_status()
    populations = parse_census_xlsx(r.content)

    states = []
    for name, (code, fips) in STATE_FIPS.items():
        if name not in populations:
            raise SystemExit(f"Census table missing {name!r}")
        states.append({"fips": fips, "code": code, "name": name, "population": populations[name]})
    states.sort(key=lambda s: s["code"])

    total = sum(s["population"] for s in states)
    if total != EXPECTED_50_STATE_TOTAL:
        raise SystemExit(f"50-state total {total:,} != expected {EXPECTED_50_STATE_TOTAL:,} — source changed?")

    payload = {
        "meta": {
            "source": SOURCE,
            "source_url": CENSUS_URL,
            "census_year": 2020,
            "n_states": len(states),
            "total_population": total,
        },
        "states": states,
    }
    write_json_atomic(OUT_PATH, payload)
    sm = min(states, key=lambda s: s["population"])
    lg = max(states, key=lambda s: s["population"])
    print(f"Wrote {len(states)} states to {OUT_PATH.relative_to(REPO_ROOT)} (total {total:,})")
    print(f"  smallest: {sm['name']} {sm['population']:,} | largest: {lg['name']} {lg['population']:,}")


if __name__ == "__main__":
    main()
