"""Count currently-serving senior U.S. Court of Appeals judges per circuit.

Senior judges are semi-retired but still hear cases, so they materially change a
circuit's real bench. They aren't in the statute (28 U.S.C. §44 sets only the
authorized *active* judgeships) — so we count them from the Federal Judicial
Center's Biographical Directory of Article III Judges (a nightly CSV).

A judge is a current senior judge if their Federal Judicial Service record has a
"Senior Status Date" set AND no "Termination Date" (still serving). The Federal
Circuit (non-geographic) is excluded. Cross-check: the count of *active* (no
senior date, no termination) court-of-appeals judges should equal the §44 total
(167), since there are no current circuit vacancies.

Writes data-pipeline/baseline/senior_judges.json (committed; a dated snapshot —
senior counts drift). Re-runnable:

    python data-pipeline/fetch_senior_judges.py
"""

from __future__ import annotations

import csv
import io
import json
import re
from collections import defaultdict
from datetime import date
from pathlib import Path

import requests
from io_utils import write_json_atomic

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "data-pipeline" / "baseline" / "senior_judges.json"

FJC_URL = "https://www.fjc.gov/sites/default/files/history/federal-judicial-service.csv"
SOURCE = "Federal Judicial Center, Biographical Directory of Article III Federal Judges"

# Ordinal circuit name (in the FJC "Court Name") → our circuit id.
ORDINAL = {
    "First": "1", "Second": "2", "Third": "3", "Fourth": "4", "Fifth": "5",
    "Sixth": "6", "Seventh": "7", "Eighth": "8", "Ninth": "9", "Tenth": "10",
    "Eleventh": "11", "District of Columbia": "DC",
}
EXPECTED_ACTIVE = {  # 28 U.S.C. §44 authorized judgeships (= filled, no vacancies)
    "DC": 11, "1": 6, "2": 13, "3": 14, "4": 15, "5": 17,
    "6": 16, "7": 11, "8": 11, "9": 29, "10": 12, "11": 12,
}


def _circuit_of(court_name: str) -> str | None:
    m = re.search(r"Court of Appeals for the (.+?) Circuit", court_name or "")
    if not m:
        return None
    return ORDINAL.get(m.group(1).strip())  # None for "Federal" / unmatched


def main() -> None:
    print(f"Fetching {FJC_URL}")
    r = requests.get(FJC_URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=60)
    r.raise_for_status()
    rows = list(csv.DictReader(io.StringIO(r.text)))

    seniors: dict[str, int] = defaultdict(int)
    active: dict[str, int] = defaultdict(int)
    for row in rows:
        cid = _circuit_of(row.get("Court Name", ""))
        if cid is None:
            continue
        if (row.get("Termination Date") or "").strip():
            continue  # no longer serving (retired/resigned/deceased)
        if (row.get("Senior Status Date") or "").strip():
            seniors[cid] += 1
        else:
            active[cid] += 1

    # Cross-check active complement against §44 (catches a stale/changed source).
    mismatches = {c: (active.get(c, 0), EXPECTED_ACTIVE[c]) for c in EXPECTED_ACTIVE if active.get(c, 0) != EXPECTED_ACTIVE[c]}
    if mismatches:
        print(f"  (note) active counts differ from §44 (vacancies?): {mismatches}")

    counts = {cid: seniors.get(cid, 0) for cid in EXPECTED_ACTIVE}
    payload = {
        "meta": {
            "source": SOURCE,
            "source_url": FJC_URL,
            "as_of": date.today().isoformat(),
            "total": sum(counts.values()),
            "note": "Current senior circuit judges (senior-status date set, no termination date). Federal Circuit excluded.",
        },
        "senior_judges": counts,
    }
    write_json_atomic(OUT_PATH, payload)
    print(f"Wrote {OUT_PATH.relative_to(REPO_ROOT)} — {payload['meta']['total']} senior judges")
    print("  by circuit:", {c: counts[c] for c in ["9", "6", "2", "10", "DC", "1"]}, "…")


if __name__ == "__main__":
    main()
