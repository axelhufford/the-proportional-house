"""Fetch 2024 (and 2020) presidential election results by congressional district
from The Downballot.

Source: The Downballot (formerly Daily Kos Elections), "The Downballot's
        calculations of presidential election results by congressional
        district." Published as a Google Sheet linked from
        https://www.the-downballot.com/p/the-downballots-calculations-of-presidential

The sheet contains all 435 CDs plus AK-AL labeled with their 2024 and 2020
Harris/Biden vs Trump two-party percentages and margin. Aggregated from
official secretary-of-state precinct results onto the post-2022-redistricting
district lines.

We use this to impute the two-party split for House districts that ran
uncontested in 2024 (per the uncontested_2024.json list). The Downballot
publishes only PERCENTAGES, not raw vote counts — that's fine for our
imputation, which only cares about the two-party share. See
fetch_clerk_house.py:_apply_uncontested_imputation() for the math.

Run:
    python data-pipeline/fetch_pres_by_cd.py
"""

from __future__ import annotations

import csv
import io
import json
import sys
from pathlib import Path

import requests

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "data-pipeline" / "baseline" / "pres_by_cd_2024.json"

DOWNBALLOT_CSV_URL = (
    "https://docs.google.com/spreadsheets/d/"
    "1ng1i_Dm_RMDnEvauH44pgE6JCUsapcuu8F2pCfeLWFo/export?format=csv"
)
DOWNBALLOT_PAGE_URL = (
    "https://www.the-downballot.com/p/the-downballots-calculations-of-presidential"
)


def fetch_csv() -> str:
    r = requests.get(DOWNBALLOT_CSV_URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
    r.raise_for_status()
    return r.text


def normalize_district_code(d: str) -> str:
    """Normalize district codes to match the convention used elsewhere in the
    repo: 'AK-AL' for at-large; 'AL-1' (not 'AL-01') for numbered districts so
    the keys match the uncontested_2024.json list and the StateProjection
    code-and-number pattern.
    """
    d = d.strip().upper()
    if "-" not in d:
        return d
    state, num = d.split("-", 1)
    if num == "AL":
        return f"{state}-AL"
    try:
        return f"{state}-{int(num)}"
    except ValueError:
        return d


def parse(csv_text: str) -> dict[str, dict]:
    """The Downballot sheet has THREE header rows: a banner row, a 2024/2020
    section row, and a Harris/Trump/Margin column row. Skip the first two,
    then read each data row.
    """
    reader = csv.reader(io.StringIO(csv_text))
    rows = list(reader)
    if len(rows) < 4:
        raise RuntimeError("Downballot CSV had fewer than 4 rows; structure may have changed")

    # Validate the column header row (row index 2) so we fail loudly if the
    # sheet layout changes.
    header = [c.strip() for c in rows[2]]
    expected = ["", "", "", "Harris", "Trump", "Margin", "Biden", "Trump", "Margin"]
    if header[: len(expected)] != expected:
        raise RuntimeError(
            f"Downballot header changed. Got {header!r}, expected prefix {expected!r}"
        )

    districts: dict[str, dict] = {}
    for row in rows[3:]:
        if not row or not row[0].strip():
            continue
        cd_raw = row[0].strip()
        incumbent = row[1].strip() if len(row) > 1 else ""
        party = row[2].strip() if len(row) > 2 else ""
        try:
            harris_pct = float(row[3])
            trump_2024_pct = float(row[4])
            margin_2024 = float(row[5])
            biden_pct = float(row[6])
            trump_2020_pct = float(row[7])
            margin_2020 = float(row[8])
        except (ValueError, IndexError):
            print(f"  skipping unparseable row: {row[:5]}")
            continue
        districts[normalize_district_code(cd_raw)] = {
            "incumbent_2024": incumbent,
            "incumbent_party_2024": party.strip("()"),
            "harris_pct": harris_pct,
            "trump_pct": trump_2024_pct,
            "margin_2024": margin_2024,
            "biden_pct_2020": biden_pct,
            "trump_pct_2020": trump_2020_pct,
            "margin_2020": margin_2020,
        }
    if len(districts) < 435:
        raise RuntimeError(f"Expected 435+ districts, got {len(districts)}")
    return districts


def main() -> None:
    print(f"Fetching {DOWNBALLOT_CSV_URL}")
    csv_text = fetch_csv()
    districts = parse(csv_text)
    payload = {
        "$comment": (
            "2024 (and 2020) presidential vote shares per congressional district. "
            "Used for imputing the two-party split in uncontested 2024 House races. "
            "Percentages are of total votes cast in that district; sums to slightly "
            "less than 100 because third-party + write-ins are excluded."
        ),
        "source": "The Downballot — 'The Downballot's calculations of presidential election results by congressional district.'",
        "source_page": DOWNBALLOT_PAGE_URL,
        "source_csv_url": DOWNBALLOT_CSV_URL,
        "districts": districts,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w") as f:
        json.dump(payload, f, indent=2)
    print(f"Wrote {OUT_PATH.relative_to(REPO_ROOT)}: {len(districts)} districts.")


if __name__ == "__main__":
    main()
