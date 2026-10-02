"""The curated election-results file: loading and strict validation.

data-pipeline/results/house_<cycle>.csv is the ONLY results input the pipeline
trusts. It is edited by hand during the count (optionally starting from a draft
written by scrape_results_draft.py), reviewed with `git diff`, and committed —
every row naming where its numbers came from and when.

One row per state:

  code                   postal code
  status                 pending | provisional | certified
  d_votes, r_votes,      votes counted so far (integers; commas allowed).
  other_votes            Empty while pending. other_votes may stay empty.
  d_seats, r_seats,      races CALLED so far, by party. Seats not yet called
  other_seats            are derived: apportionment − called.
  reporting_pct          optional share of the expected vote counted (0–100]
  reporting_source       who estimated reporting_pct (required with it)
  uncontested_districts  optional count of races with no major-party opponent
  source_url             where the vote totals came from (required once votes are in)
  as_of                  ISO timestamp with timezone of those totals
  note                   free text

Statuses:
  pending      nothing counted yet. Called seats are allowed (uncontested races
               are called at poll close); votes are not.
  provisional  counting. Votes > 0 and a source + as_of are required.
  certified    the state certified its results: every seat called, and
               source_url points at the certification.

A skeleton with all 50 states `pending` is true data — nothing counted yet — not
a placeholder for numbers.

    python data-pipeline/results_file.py path/to.csv   # validate and summarize
"""

from __future__ import annotations

import csv
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

COLUMNS = (
    "code", "status", "d_votes", "r_votes", "other_votes", "d_seats", "r_seats",
    "other_seats", "reporting_pct", "reporting_source", "uncontested_districts",
    "source_url", "as_of", "note",
)
STATUSES = ("pending", "provisional", "certified")

# 2020-census apportionment, used for the 2022–2030 elections. Kept here (not
# read from the CSV) so a typo in the file can't change a state's seat count.
APPORTIONMENT = {
    "AL": 7, "AK": 1, "AZ": 9, "AR": 4, "CA": 52, "CO": 8, "CT": 5, "DE": 1, "FL": 28,
    "GA": 14, "HI": 2, "ID": 2, "IL": 17, "IN": 9, "IA": 4, "KS": 4, "KY": 6, "LA": 6,
    "ME": 2, "MD": 8, "MA": 9, "MI": 13, "MN": 8, "MS": 4, "MO": 8, "MT": 2, "NE": 3,
    "NV": 4, "NH": 2, "NJ": 12, "NM": 3, "NY": 26, "NC": 14, "ND": 1, "OH": 15, "OK": 5,
    "OR": 6, "PA": 17, "RI": 2, "SC": 7, "SD": 1, "TN": 9, "TX": 38, "UT": 4, "VT": 1,
    "VA": 11, "WA": 10, "WV": 2, "WI": 8, "WY": 1,
}

# Clock skew tolerated when checking that as_of isn't in the future.
FUTURE_SLACK = timedelta(minutes=10)


@dataclass(frozen=True)
class StateResult:
    code: str
    status: str
    seats: int
    d_votes: int | None
    r_votes: int | None
    other_votes: int | None
    d_seats: int
    r_seats: int
    other_seats: int
    reporting_pct: float | None
    reporting_source: str
    uncontested_districts: int | None
    source_url: str
    as_of: str
    note: str

    @property
    def uncalled_seats(self) -> int:
        return self.seats - self.d_seats - self.r_seats - self.other_seats

    @property
    def has_votes(self) -> bool:
        return (self.d_votes or 0) + (self.r_votes or 0) > 0


class ResultsFileError(ValueError):
    """Raised with every problem found, one per line."""


def _int(raw: str | int | None, field: str, code: str, errors: list[str]) -> int | None:
    raw = ("" if raw is None else str(raw)).strip().replace(",", "").replace("_", "")
    if raw == "":
        return None
    try:
        v = int(raw)
    except ValueError:
        errors.append(f"{code}: {field} {raw!r} is not a whole number")
        return None
    if v < 0:
        errors.append(f"{code}: {field} is negative ({v})")
        return None
    return v


def _pct(raw: str, code: str, errors: list[str]) -> float | None:
    raw = (raw or "").strip().rstrip("%")
    if raw == "":
        return None
    try:
        v = float(raw)
    except ValueError:
        errors.append(f"{code}: reporting_pct {raw!r} is not a number")
        return None
    if not 0 < v <= 100:
        errors.append(f"{code}: reporting_pct {v} outside (0, 100]")
        return None
    return v


def _as_of(raw: str, code: str, now: datetime, errors: list[str]) -> str:
    raw = (raw or "").strip()
    if raw == "":
        return ""
    try:
        ts = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        errors.append(f"{code}: as_of {raw!r} is not an ISO timestamp")
        return raw
    if ts.tzinfo is None:
        errors.append(f"{code}: as_of {raw!r} has no timezone (write e.g. 2026-11-04T01:30:00-05:00)")
    elif ts > now + FUTURE_SLACK:
        errors.append(f"{code}: as_of {raw!r} is in the future")
    return raw


def parse_rows(rows: list[dict], now: datetime | None = None) -> list[StateResult]:
    """Validate parsed CSV rows; raise ResultsFileError listing every problem."""
    now = now or datetime.now(timezone.utc)
    errors: list[str] = []
    out: list[StateResult] = []
    seen: set[str] = set()

    for i, row in enumerate(rows, start=2):  # line 1 is the header
        code = (row.get("code") or "").strip().upper()
        if not code:
            errors.append(f"line {i}: missing code")
            continue
        if code not in APPORTIONMENT:
            errors.append(f"line {i}: unknown state code {code!r}")
            continue
        if code in seen:
            errors.append(f"{code}: appears more than once")
            continue
        seen.add(code)
        seats = APPORTIONMENT[code]

        status = (row.get("status") or "").strip().lower()
        if status not in STATUSES:
            errors.append(f"{code}: status {status!r} is not one of {STATUSES}")
            continue

        d_votes = _int(row.get("d_votes", ""), "d_votes", code, errors)
        r_votes = _int(row.get("r_votes", ""), "r_votes", code, errors)
        other_votes = _int(row.get("other_votes", ""), "other_votes", code, errors)
        d_seats = _int(row.get("d_seats", ""), "d_seats", code, errors) or 0
        r_seats = _int(row.get("r_seats", ""), "r_seats", code, errors) or 0
        other_seats = _int(row.get("other_seats", ""), "other_seats", code, errors) or 0
        uncontested = _int(row.get("uncontested_districts", ""), "uncontested_districts", code, errors)
        pct = _pct(row.get("reporting_pct", ""), code, errors)
        reporting_source = (row.get("reporting_source") or "").strip()
        source_url = (row.get("source_url") or "").strip()
        as_of = _as_of(row.get("as_of", ""), code, now, errors)

        called = d_seats + r_seats + other_seats
        if called > seats:
            errors.append(f"{code}: {called} seats called but the state has {seats}")
        if uncontested is not None and uncontested > seats:
            errors.append(f"{code}: uncontested_districts {uncontested} > {seats} seats")
        if pct is not None and not reporting_source:
            errors.append(f"{code}: reporting_pct given without reporting_source")
        if source_url and not source_url.startswith(("https://", "http://")):
            errors.append(f"{code}: source_url {source_url!r} is not a URL")

        has_votes = (d_votes or 0) + (r_votes or 0) > 0
        if status == "pending":
            if any(v is not None for v in (d_votes, r_votes, other_votes)):
                errors.append(f"{code}: pending but has vote totals — mark it provisional")
            if pct is not None:
                errors.append(f"{code}: pending but has reporting_pct")
        else:
            if not has_votes:
                errors.append(f"{code}: {status} but no D/R votes")
            if d_votes is None or r_votes is None:
                errors.append(f"{code}: {status} needs both d_votes and r_votes (0 if a party had none)")
            if not source_url:
                errors.append(f"{code}: {status} needs a source_url")
            if not as_of:
                errors.append(f"{code}: {status} needs an as_of timestamp")
        if status == "certified":
            if called != seats:
                errors.append(f"{code}: certified but {seats - called} seat(s) uncalled")
            if pct is not None and pct != 100:
                errors.append(f"{code}: certified but reporting_pct is {pct}")

        out.append(StateResult(
            code=code, status=status, seats=seats,
            d_votes=d_votes, r_votes=r_votes, other_votes=other_votes,
            d_seats=d_seats, r_seats=r_seats, other_seats=other_seats,
            reporting_pct=pct, reporting_source=reporting_source,
            uncontested_districts=uncontested, source_url=source_url,
            as_of=as_of, note=(row.get("note") or "").strip(),
        ))

    missing = sorted(set(APPORTIONMENT) - seen)
    if missing:
        errors.append(f"missing states: {', '.join(missing)}")
    if errors:
        raise ResultsFileError("\n".join(errors))
    return sorted(out, key=lambda s: s.code)


def load_results_csv(path: Path, now: datetime | None = None) -> list[StateResult]:
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        header = tuple(h.strip() for h in (reader.fieldnames or ()))
        if set(header) != set(COLUMNS):
            missing = [c for c in COLUMNS if c not in header]
            extra = [c for c in header if c not in COLUMNS]
            raise ResultsFileError(
                f"{path}: header mismatch — missing {missing or 'none'}, unexpected {extra or 'none'}"
            )
        rows = [{k.strip(): v for k, v in r.items() if k} for r in reader]
    rows = [r for r in rows if any((v or "").strip() for v in r.values())]  # skip blank lines
    return parse_rows(rows, now)


def write_skeleton(path: Path) -> None:
    """All 50 states pending — what the file holds before any vote is counted."""
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        for code in sorted(APPORTIONMENT):
            w.writerow({c: "" for c in COLUMNS} | {"code": code, "status": "pending"})


def summarize(results: list[StateResult]) -> str:
    counts = {s: sum(1 for r in results if r.status == s) for s in STATUSES}
    called = sum(r.d_seats + r.r_seats + r.other_seats for r in results)
    d = sum(r.d_seats for r in results)
    rr = sum(r.r_seats for r in results)
    o = sum(r.other_seats for r in results)
    return (
        f"{counts['pending']} pending · {counts['provisional']} provisional · "
        f"{counts['certified']} certified — {called}/435 seats called (D {d}, R {rr}"
        + (f", other {o}" if o else "") + ")"
    )


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO_ROOT / "data-pipeline" / "results" / "house_2026.csv"
    try:
        print(summarize(load_results_csv(target)))
    except ResultsFileError as e:
        print(f"✗ {target} is invalid:\n  " + str(e).replace("\n", "\n  "))
        raise SystemExit(1)
