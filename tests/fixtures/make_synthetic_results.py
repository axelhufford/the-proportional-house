"""Generate the SYNTHETIC results fixtures used to rehearse election night.

    python tests/fixtures/make_synthetic_results.py

Writes two CSVs in the curated-results format (data-pipeline/results_file.py):

  results_2026_synthetic_election_night.csv  ~half the states partly counted,
                                              some seats called, the rest pending
  results_2026_synthetic_certified.csv        every state certified

The numbers are NOT 2026 results. They are the real 2024 House vote per state
(data-pipeline/baseline/house_2024.json), scaled for "partly counted", with the
2024 delegations standing in for called seats. Every row says so in `note`,
and `source_url` points at a reserved .invalid domain. They exist only to drive
the results UI end to end before real results exist: load them with
PH_RESULTS_CSV (which marks the build `rehearsal`, which CI refuses to deploy).
Deterministic — rerunning produces identical files.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BASELINE = REPO_ROOT / "data-pipeline" / "baseline" / "house_2024.json"
OUT_DIR = Path(__file__).resolve().parent

COLUMNS = (
    "code", "status", "d_votes", "r_votes", "other_votes", "d_seats", "r_seats",
    "other_seats", "reporting_pct", "reporting_source", "uncontested_districts",
    "source_url", "as_of", "note",
)
NOTE = "SYNTHETIC rehearsal data derived from 2024 votes; not a 2026 result"
SOURCE = "https://rehearsal.example.invalid/synthetic"
AS_OF_NIGHT = "2026-09-01T23:30:00-04:00"
AS_OF_FINAL = "2026-09-02T12:00:00-04:00"


def main() -> None:
    states = sorted(json.loads(BASELINE.read_text())["states"], key=lambda s: s["code"])
    night, final = [], []
    for i, s in enumerate(states):
        v = s["votes_2024"]
        d, r, o = v["democratic"], v["republican"], v["other"]
        ad, ar = s["actual_d_seats_119th"], s["actual_r_seats_119th"]
        blank = {c: "" for c in COLUMNS}
        final.append(blank | {
            "code": s["code"], "status": "certified",
            "d_votes": d, "r_votes": r, "other_votes": o,
            "d_seats": ad, "r_seats": ar, "other_seats": 0,
            "source_url": SOURCE, "as_of": AS_OF_FINAL, "note": NOTE,
        })
        if i % 2 == 0:
            # Partly counted: a deterministic 40–90% of the vote, with only the
            # safe seats called (all but one of the larger party's).
            pct = 40 + (i * 7) % 51
            called_d = max(ad - 1, 0) if ad >= ar else ad
            called_r = max(ar - 1, 0) if ar > ad else ar
            night.append(blank | {
                "code": s["code"], "status": "provisional",
                "d_votes": d * pct // 100, "r_votes": r * pct // 100, "other_votes": o * pct // 100,
                "d_seats": called_d, "r_seats": called_r, "other_seats": 0,
                "reporting_pct": pct, "reporting_source": "synthetic",
                "source_url": SOURCE, "as_of": AS_OF_NIGHT, "note": NOTE,
            })
        else:
            night.append(blank | {"code": s["code"], "status": "pending", "note": NOTE})

    for name, rows in (
        ("results_2026_synthetic_election_night.csv", night),
        ("results_2026_synthetic_certified.csv", final),
    ):
        with (OUT_DIR / name).open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=COLUMNS)
            w.writeheader()
            w.writerows(rows)
        print(f"Wrote tests/fixtures/{name} ({len(rows)} states).")


if __name__ == "__main__":
    main()
