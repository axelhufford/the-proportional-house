"""Gate automatic results updates before they are published.

The election-night scheduled task applies Wikipedia vote totals with
`scrape_results_draft.py --apply` and publishes them without a human looking
first. This compares the curated CSV in the working tree with the last
committed version and reverts, row by row, any state whose change looks wrong.
A reverted state keeps its previous (already published) numbers and is listed
for a human to look at.

    python data-pipeline/results_guard.py            # revert offending rows, report
    python data-pipeline/results_guard.py --dry-run  # report only

A changed state is reverted when:
  - its committed row is certified (only a human touches a certified state), or
    the new row claims certification (only a human certifies);
  - D or R votes fell (a correction or vandalism — needs a human);
  - its vote totals changed but its as_of isn't later than the committed one;
  - a party's called seats went down;
  - the two-party total exceeds MAX_TURNOUT_RATIO × the state's 2024 two-party
    House vote (implausible for a midterm);
  - the two-party share moved more than SHARE_MOVE_PTS points while the vote
    total grew by less than QUIET_GROWTH (a big swing on few new votes).
Exit status is 0 unless the files can't be read.
"""

from __future__ import annotations

import csv
import io
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from results_file import COLUMNS

REPO_ROOT = Path(__file__).resolve().parent.parent
CURATED = REPO_ROOT / "data-pipeline" / "results" / "house_2026.csv"
BASELINE = REPO_ROOT / "data-pipeline" / "baseline" / "house_2024.json"

MAX_TURNOUT_RATIO = 1.25
SHARE_MOVE_PTS = 5.0
QUIET_GROWTH = 0.25


def _n(v: str | None) -> int:
    v = (v or "").strip().replace(",", "")
    return int(v) if v.isdigit() else 0


def _ts(v: str | None) -> datetime | None:
    try:
        return datetime.fromisoformat((v or "").strip().replace("Z", "+00:00"))
    except ValueError:
        return None


def baseline_two_party() -> dict[str, int]:
    states = json.loads(BASELINE.read_text())["states"]
    return {s["code"]: s["votes_2024"]["democratic"] + s["votes_2024"]["republican"] for s in states}


def problems(old: dict, new: dict, base_2p: int) -> list[str]:
    """Why a changed row must not be published automatically ([] = fine)."""
    out = []
    if old.get("status") == "certified":
        out.append("already certified")
    if new.get("status") == "certified":
        out.append("only a human certifies a state")
    od, orr, nd, nr = _n(old.get("d_votes")), _n(old.get("r_votes")), _n(new.get("d_votes")), _n(new.get("r_votes"))
    if nd < od or nr < orr:
        out.append(f"votes fell (D {od:,}→{nd:,}, R {orr:,}→{nr:,})")
    # A new timestamp is only expected when the vote totals changed: a race
    # call adds a seat without touching the votes or their as_of.
    votes_changed = any((old.get(k) or "") != (new.get(k) or "") for k in ("d_votes", "r_votes", "other_votes"))
    old_ts, new_ts = _ts(old.get("as_of")), _ts(new.get("as_of"))
    if votes_changed and old_ts and (new_ts is None or new_ts <= old_ts):
        out.append(f"as_of not newer ({old.get('as_of')} → {new.get('as_of')})")
    for party in ("d", "r", "other"):
        if _n(new.get(f"{party}_seats")) < _n(old.get(f"{party}_seats")):
            out.append(f"{party.upper()} called seats went down")
    if base_2p and nd + nr > MAX_TURNOUT_RATIO * base_2p:
        out.append(f"{nd + nr:,} two-party votes > {MAX_TURNOUT_RATIO}× 2024's {base_2p:,}")
    if od + orr and nd + nr:
        move = abs(nd / (nd + nr) - od / (od + orr)) * 100
        growth = (nd + nr) / (od + orr) - 1
        if move > SHARE_MOVE_PTS and growth < QUIET_GROWTH:
            out.append(f"D share moved {move:.1f} pts on only {growth:+.0%} more votes")
    return out


def read_rows(text: str) -> dict[str, dict]:
    return {r["code"]: r for r in csv.DictReader(io.StringIO(text))}


def committed_text() -> str:
    rel = CURATED.relative_to(REPO_ROOT).as_posix()
    return subprocess.run(
        ["git", "show", f"HEAD:{rel}"], cwd=REPO_ROOT, check=True, capture_output=True, text=True,
    ).stdout


def guard(old_rows: dict[str, dict], new_rows: dict[str, dict], base: dict[str, int]) -> tuple[dict, list[str], list[str]]:
    """Returns (rows to write, applied lines, reverted lines)."""
    final, applied, reverted = {}, [], []
    for code in sorted(new_rows):
        old, new = old_rows.get(code, {}), new_rows[code]
        if {k: (old.get(k) or "") for k in COLUMNS} == {k: (new.get(k) or "") for k in COLUMNS}:
            final[code] = new
            continue
        why = problems(old, new, base.get(code, 0))
        if why:
            final[code] = old
            reverted.append(f"REVERT {code}: {'; '.join(why)}")
        else:
            final[code] = new
            nd, nr = _n(new.get("d_votes")), _n(new.get("r_votes"))
            share = f"{nd / (nd + nr) * 100:.1f}% D" if nd + nr else "no votes"
            applied.append(f"APPLY  {code}: D {nd:,} · R {nr:,} ({share}) as of {new.get('as_of')}")
    return final, applied, reverted


def main(argv: list[str]) -> int:
    old_rows = read_rows(committed_text())
    new_rows = read_rows(CURATED.read_text(encoding="utf-8"))
    final, applied, reverted = guard(old_rows, new_rows, baseline_two_party())
    for line in applied + reverted:
        print(line)
    print(f"{len(applied)} state(s) pass, {len(reverted)} reverted.")
    if reverted and "--dry-run" not in argv:
        with CURATED.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=COLUMNS)
            w.writeheader()
            w.writerows(final[c] for c in sorted(final))
        print(f"Reverted rows restored to their committed values in {CURATED.relative_to(REPO_ROOT)}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
