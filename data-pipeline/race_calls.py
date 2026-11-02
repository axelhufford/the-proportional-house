"""Race calls: who won each House district, per a news organization's decision desk.

data-pipeline/results/race_calls_2026.csv holds one row per CALLED district.
The site calls a race as soon as any one desk on ALLOWED_CALLERS calls it, and
the per-state seat counts in house_2026.csv (`d_seats`/`r_seats`/`other_seats`)
are derived from this file with `--apply`. Columns:

  district    "PA-07", or "WY-AL" for an at-large seat (2026 district lines)
  party       D | R | O  (the winner's party; O = anyone else)
  winner      the winning candidate (optional)
  caller      the first desk to call it, one of ALLOWED_CALLERS
  called_at   ISO timestamp with timezone of the call
  source_url  a page showing that call: the desk's results page or a news report
              of the call (not Wikipedia)
  note        free text

Rows are append-only: once a call is committed it is never edited or removed
by automation. A retracted call is a human edit, made with --allow-edits.

    python data-pipeline/race_calls.py                  # validate + summary
    python data-pipeline/race_calls.py --apply          # set called seats in house_2026.csv
    python data-pipeline/race_calls.py --allow-edits    # validate without the append-only check
"""

from __future__ import annotations

import csv
import io
import re
import subprocess
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

from results_file import APPORTIONMENT, COLUMNS as RESULT_COLUMNS, ResultsFileError, parse_rows

REPO_ROOT = Path(__file__).resolve().parent.parent
CALLS = REPO_ROOT / "data-pipeline" / "results" / "race_calls_2026.csv"
RESULTS = REPO_ROOT / "data-pipeline" / "results" / "house_2026.csv"

COLUMNS = ("district", "party", "winner", "caller", "called_at", "source_url", "note")
PARTIES = ("D", "R", "O")
ALLOWED_CALLERS = ("AP", "DDHQ", "NBC", "CNN", "ABC", "CBS", "Fox")
# The first polls close at 6 PM ET on Nov 3; no 2026 race can be called earlier.
FIRST_POLL_CLOSE = datetime(2026, 11, 3, 23, 0, tzinfo=timezone.utc)
FUTURE_SLACK = timedelta(minutes=10)
_DISTRICT = re.compile(r"^([A-Z]{2})-(AL|\d{1,2})$")


class CallsError(ValueError):
    pass


def normalize_district(raw: str) -> str:
    m = _DISTRICT.match((raw or "").strip().upper())
    if not m:
        return (raw or "").strip()
    code, num = m.groups()
    return f"{code}-AL" if num == "AL" else f"{code}-{int(num):02d}"


def parse(text: str, now: datetime | None = None) -> list[dict]:
    """Validate the calls file's text; raise CallsError listing every problem."""
    now = now or datetime.now(timezone.utc)
    reader = csv.DictReader(io.StringIO(text))
    header = tuple(h.strip() for h in (reader.fieldnames or ()))
    if header and set(header) != set(COLUMNS):
        raise CallsError(f"header must be {','.join(COLUMNS)} (got {','.join(header)})")
    errors: list[str] = []
    rows: list[dict] = []
    seen: set[str] = set()
    for i, raw in enumerate(reader, start=2):
        r = {k.strip(): (v or "").strip() for k, v in raw.items() if k}
        if not any(r.values()):
            continue
        d = normalize_district(r.get("district", ""))
        m = _DISTRICT.match(d)
        if not m:
            errors.append(f"line {i}: district {r.get('district')!r} is not like PA-07 or WY-AL")
            continue
        code, num = m.groups()
        seats = APPORTIONMENT.get(code)
        if seats is None:
            errors.append(f"line {i}: unknown state {code}")
            continue
        if (num == "AL") != (seats == 1) or (num != "AL" and not 1 <= int(num) <= seats):
            errors.append(f"line {i}: {d} doesn't exist ({code} has {seats} seat{'s' if seats > 1 else ''})")
            continue
        if d in seen:
            errors.append(f"line {i}: {d} is called twice")
            continue
        seen.add(d)
        if r.get("party") not in PARTIES:
            errors.append(f"{d}: party {r.get('party')!r} is not one of {PARTIES}")
        if r.get("caller") not in ALLOWED_CALLERS:
            errors.append(f"{d}: caller {r.get('caller')!r} is not one of {ALLOWED_CALLERS}")
        try:
            ts = datetime.fromisoformat(r.get("called_at", "").replace("Z", "+00:00"))
            if ts.tzinfo is None:
                errors.append(f"{d}: called_at has no timezone")
            elif ts < FIRST_POLL_CLOSE:
                errors.append(f"{d}: called_at {r['called_at']} is before the first polls closed")
            elif ts > now + FUTURE_SLACK:
                errors.append(f"{d}: called_at {r['called_at']} is in the future")
        except ValueError:
            errors.append(f"{d}: called_at {r.get('called_at')!r} is not an ISO timestamp")
        url = r.get("source_url", "")
        if not url.startswith("https://"):
            errors.append(f"{d}: source_url must be an https link to the call")
        elif "wikipedia.org" in url:
            errors.append(f"{d}: source_url must show the desk's call, not Wikipedia")
        rows.append({**r, "district": d})

    per_state = Counter(r["district"][:2] for r in rows)
    for code, n in per_state.items():
        if n > APPORTIONMENT[code]:
            errors.append(f"{code}: {n} calls for {APPORTIONMENT[code]} seats")
    if errors:
        raise CallsError("\n".join(errors))
    return rows


def committed_text() -> str | None:
    rel = CALLS.relative_to(REPO_ROOT).as_posix()
    out = subprocess.run(["git", "show", f"HEAD:{rel}"], cwd=REPO_ROOT, capture_output=True, text=True)
    return out.stdout if out.returncode == 0 else None


def check_append_only(old_rows: list[dict], new_rows: list[dict]) -> None:
    """Every committed call must still be there, unchanged."""
    new_by = {r["district"]: r for r in new_rows}
    problems = []
    for old in old_rows:
        new = new_by.get(old["district"])
        if new is None:
            problems.append(f"{old['district']}: committed call was removed")
        elif any(old.get(k, "") != new.get(k, "") for k in COLUMNS):
            problems.append(f"{old['district']}: committed call was edited")
    if problems:
        raise CallsError("\n".join(problems) + "\n(a retraction is a human edit: rerun with --allow-edits)")


def seats_by_state(rows: list[dict]) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = {}
    for r in rows:
        s = out.setdefault(r["district"][:2], {"D": 0, "R": 0, "O": 0})
        s[r["party"]] += 1
    return out


def apply_calls(result_rows: list[dict], calls: list[dict]) -> tuple[list[dict], list[str]]:
    """Set called seats from the calls for every state with at least one call.

    Certified states are left alone (their seats are final). Returns the new
    rows and a line per state whose seats changed."""
    by_state = seats_by_state(calls)
    out, changed = [], []
    for row in result_rows:
        row = dict(row)
        counts = by_state.get(row["code"])
        if counts and row.get("status") != "certified":
            new = {"d_seats": str(counts["D"]), "r_seats": str(counts["R"]),
                   "other_seats": str(counts["O"]) if counts["O"] else ""}
            if any((row.get(k) or "") != v for k, v in new.items()):
                changed.append(
                    f"{row['code']}: called D {counts['D']} · R {counts['R']}"
                    + (f" · other {counts['O']}" if counts["O"] else "")
                    + f" of {APPORTIONMENT[row['code']]}"
                )
                row.update(new)
        out.append(row)
    return out, changed


def main(argv: list[str]) -> int:
    try:
        calls = parse(CALLS.read_text(encoding="utf-8"))
        if "--allow-edits" not in argv:
            committed = committed_text()
            if committed is not None:
                check_append_only(parse(committed), calls)
    except CallsError as e:
        print(f"✗ {CALLS.relative_to(REPO_ROOT)} is invalid:\n  " + str(e).replace("\n", "\n  "))
        return 1
    by_caller = Counter(r["caller"] for r in calls)
    by_party = Counter(r["party"] for r in calls)
    print(f"{len(calls)}/435 races called (D {by_party['D']}, R {by_party['R']}, other {by_party['O']})"
          + (" — by " + ", ".join(f"{c} {n}" for c, n in by_caller.most_common()) if calls else ""))

    if "--apply" not in argv:
        return 0
    with RESULTS.open(newline="", encoding="utf-8") as f:
        result_rows = list(csv.DictReader(f))
    new_rows, changed = apply_calls(result_rows, calls)
    try:
        parse_rows(new_rows)
    except ResultsFileError as e:
        print("✗ applying the calls would make the results file invalid:\n  " + str(e).replace("\n", "\n  "))
        return 1
    with RESULTS.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=RESULT_COLUMNS)
        w.writeheader()
        w.writerows(new_rows)
    print("\n".join(changed) if changed else "No seat changes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
