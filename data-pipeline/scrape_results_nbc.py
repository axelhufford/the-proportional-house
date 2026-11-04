"""Vote totals from the AP count as published by NBC News. LOCAL ONLY.

NBC News' national House results page embeds, for all 435 districts, the
Associated Press vote count per candidate with party, plus AP's estimate of the
votes still to be counted. One request gives every state. This sums each
state's districts into a DRAFT row in the curated-results format, writes it to
data-pipeline/results/drafts/ (gitignored), and prints a diff against the
curated file — the same draft/diff/apply flow as scrape_results_draft.py,
which reads Wikipedia and lags hours behind the count on election night.

    python data-pipeline/scrape_results_nbc.py                  # draft + diff
    python data-pipeline/scrape_results_nbc.py --apply CA,TX    # copy those states
    python data-pipeline/scrape_results_nbc.py --apply ALL      # every state that changed
    python data-pipeline/scrape_results_nbc.py --add-calls      # append NBC's new race calls

Race calls: every district the NBC News Decision Desk has projected ("Projected
winner") that isn't in race_calls_2026.csv yet is listed, and --add-calls
appends it (caller NBC; called_at = when the page was read, noted as "time
observed", since the page carries no per-race call time). A district where NBC
projects a different party than the recorded call is only reported — the file
is append-only, and retractions are for a human. Then run race_calls.py --apply.

--apply copies votes, the reporting estimate, uncontested-race count, source
and as_of, and marks the state provisional. It never touches seats (those come
from race_calls.py) and never a certified row. Unattended runs then go through
results_guard.py before anything is committed.

Per state:
  d_votes / r_votes      sum over districts of Democratic / Republican
                         candidates (two candidates of one party in a top-two
                         race both count for that party)
  other_votes            everyone else
  reporting_pct          votes counted ÷ (counted + AP's remaining estimate)
  uncontested_districts  races without both a Democrat and a Republican
  as_of                  the time NBC's page was rendered (its `currentTime`)
  source_url             NBC's results page for the state
"""

from __future__ import annotations

import csv
import io
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

import election
import race_calls as rc
from results_file import APPORTIONMENT, COLUMNS, ResultsFileError, parse_rows
from scrape_results_draft import DRAFTS_DIR, REPO_ROOT, VOTE_FIELDS, apply, diff, read_curated

PAGE = "https://www.nbcnews.com/politics/{cycle}-elections/house-results"
SITE = "https://www.nbcnews.com"
USER_AGENT = "ProportionalHouse/1.0 (https://proportionalhouse.org; election results)"
REPORTING_SOURCE = "AP"  # shown as "(AP estimate)"
BASELINE = REPO_ROOT / "data-pipeline" / "baseline" / "house_2024.json"
NBC_FIELDS = VOTE_FIELDS + ("reporting_pct", "reporting_source", "uncontested_districts")

_NEXT_DATA = re.compile(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S)


class NbcFormatError(RuntimeError):
    """The page no longer looks the way this parser expects."""


def fips_to_code() -> dict[str, str]:
    return {s["fips"]: s["code"] for s in json.loads(BASELINE.read_text())["states"]}


def page_props(html: str) -> dict:
    m = _NEXT_DATA.search(html)
    if not m:
        raise NbcFormatError("no __NEXT_DATA__ block on the page")
    try:
        return json.loads(m.group(1))["props"]["pageProps"]
    except (ValueError, KeyError) as e:
        raise NbcFormatError(f"__NEXT_DATA__ isn't the expected shape: {e}") from e


def party_bucket(party: str | None) -> str:
    return {"Dem": "D", "Rep": "R"}.get(party or "", "O")


def _iso_z(ts: str) -> str:
    dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        raise NbcFormatError(f"currentTime {ts!r} has no timezone")
    return dt.astimezone(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def draft_rows(props: dict, fips: dict[str, str]) -> tuple[list[dict], list[str]]:
    """Curated-format rows for all 50 states, and warnings for states left pending."""
    try:
        map_data = props["mapData"]
        as_of = _iso_z(props["currentTime"])
    except KeyError as e:
        raise NbcFormatError(f"missing {e} in pageProps") from e
    hrefs = {s.get("stateAbbr"): s.get("href") for s in (props.get("tableData") or {}).get("states", [])}

    by_state: dict[str, list[dict]] = defaultdict(list)
    for key, entry in map_data.items():
        code = fips.get(key[:-2].zfill(2))
        tip = (entry or {}).get("tooltip") or {}
        if code is None or tip.get("officeCode") != "H" or tip.get("electionTypeCode") != "G":
            continue
        by_state[code].append(tip)

    rows, warnings = [], []
    for code in sorted(APPORTIONMENT):
        row = {c: "" for c in COLUMNS} | {"code": code, "status": "pending"}
        races = by_state.get(code, [])
        if len(races) != APPORTIONMENT[code]:
            warnings.append(f"{code}: NBC lists {len(races)} House races, apportionment is {APPORTIONMENT[code]} — left pending")
            rows.append(row)
            continue
        votes = {"D": 0, "R": 0, "O": 0}
        counted = remaining = uncontested = 0
        for tip in races:
            cands = tip.get("candidates") or []
            per = sum(int(c.get("votes") or 0) for c in cands)
            if int(tip.get("totalVote") or 0) != per:
                warnings.append(f"{code}: {tip.get('raceName')} candidate votes {per:,} ≠ total {tip.get('totalVote')}")
            for c in cands:
                votes[party_bucket(c.get("party"))] += int(c.get("votes") or 0)
            counted += per
            remaining += int(tip.get("remainingVote") or 0)
            if not {"D", "R"} <= {party_bucket(c.get("party")) for c in cands}:
                uncontested += 1
        if not votes["D"] + votes["R"]:
            rows.append(row)
            continue
        pct = min(100.0, round(100 * counted / (counted + remaining), 1)) if counted + remaining else None
        href = hrefs.get(code)
        row.update({
            "status": "provisional",
            "d_votes": str(votes["D"]), "r_votes": str(votes["R"]),
            "other_votes": str(votes["O"]) if votes["O"] else "",
            "reporting_pct": f"{pct:g}" if pct else "",
            "reporting_source": REPORTING_SOURCE if pct else "",
            "uncontested_districts": str(uncontested) if uncontested else "",
            "source_url": SITE + href if href and href.startswith("/") else PAGE.format(cycle=election.resolve().cycle),
            "as_of": as_of,
        })
        rows.append(row)
    return rows, warnings


def district_id(key: str, fips: dict[str, str]) -> str | None:
    """NBC's mapData key ('4207' = PA district 7) → 'PA-07' / 'WY-AL'."""
    code = fips.get(key[:-2].zfill(2))
    if code is None or not key[-2:].isdigit():
        return None
    return f"{code}-AL" if APPORTIONMENT[code] == 1 else f"{code}-{int(key[-2:]):02d}"


def nbc_calls(props: dict, fips: dict[str, str], existing: dict[str, dict], page_url: str) -> tuple[list[dict], list[str]]:
    """Race-call rows for districts NBC's Decision Desk has projected and the
    calls file doesn't have yet, plus warnings: a district where NBC projects a
    different party than the recorded call (a possible retraction — for a
    human), or a projected race without exactly one winner.

    NBC's page gives no per-race call time, so called_at is the time the page
    was rendered and the note says so, as for calls recorded by hand from it."""
    observed = datetime.fromisoformat(_iso_z(props["currentTime"]).replace("Z", "+00:00"))
    called_at = observed.astimezone(ZoneInfo("America/New_York")).isoformat(timespec="seconds")
    rows, warnings = [], []
    for key, entry in sorted(props["mapData"].items()):
        tip = (entry or {}).get("tooltip") or {}
        district = district_id(key, fips)
        if district is None or tip.get("officeCode") != "H" or tip.get("electionTypeCode") != "G":
            continue
        if tip.get("callStatusCode") != "P":
            continue
        winners = [c for c in tip.get("candidates") or [] if c.get("isWinner")]
        if len(winners) != 1:
            warnings.append(f"{district}: NBC marks it projected but lists {len(winners)} winners — skipped")
            continue
        w = winners[0]
        party = party_bucket(w.get("party"))
        if district in existing:
            had = existing[district]
            if had["party"] != party:
                warnings.append(
                    f"{district}: calls file has {had['party']} ({had['winner']}, {had['caller']}); "
                    f"NBC now projects {party} ({w.get('name')}) — possible retraction, for the owner"
                )
            continue
        rows.append({
            "district": district, "party": party, "winner": (w.get("name") or "").strip(),
            "caller": "NBC", "called_at": called_at, "source_url": page_url,
            "note": "time observed (NBC 'Projected winner')",
        })
    return rows, warnings


def add_calls(rows: list[dict]) -> None:
    """Append rows to the calls file, refusing to write one that won't validate."""
    text = rc.CALLS.read_text(encoding="utf-8")
    if text and not text.endswith("\n"):
        text += "\n"
    buf = io.StringIO()
    csv.DictWriter(buf, fieldnames=rc.COLUMNS, lineterminator="\n").writerows(rows)
    new_text = text + buf.getvalue()
    rc.parse(new_text)  # raises CallsError listing every problem
    rc.CALLS.write_text(new_text, encoding="utf-8")


def fetch(url: str) -> str:
    r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=60)
    r.raise_for_status()
    return r.text


def main(argv: list[str]) -> int:
    el = election.resolve()
    url = PAGE.format(cycle=el.cycle)
    print(f"Fetching {url} …")
    props, fips = page_props(fetch(url)), fips_to_code()

    try:
        existing = {r["district"]: r for r in rc.parse(rc.CALLS.read_text(encoding="utf-8"))}
    except rc.CallsError as e:
        print(f"  ⚠ the calls file doesn't validate, so no NBC calls this run:\n    {e}")
        existing = None
    if existing is not None:
        calls, call_warnings = nbc_calls(props, fips, existing, url)
        for w in call_warnings:
            print(f"  ⚠ {w}")
        print(f"NBC projections not yet in the calls file: {len(calls)}")
        for c in calls:
            print(f"  + {c['district']} {c['party']} {c['winner']}")
        if calls and "--add-calls" in argv:
            add_calls(calls)
            print(f"Appended {len(calls)} NBC call(s) to {rc.CALLS.relative_to(REPO_ROOT)} — next: race_calls.py --apply.")

    draft, warnings = draft_rows(props, fips)
    for w in warnings:
        print(f"  ⚠ {w}")
    try:
        parse_rows(draft)
    except ResultsFileError as e:
        print("⚠ the draft itself has problems (fix by hand before applying):\n  " + str(e).replace("\n", "\n  "))
        return 1

    DRAFTS_DIR.mkdir(parents=True, exist_ok=True)
    out = DRAFTS_DIR / f"house_{el.cycle}_nbc_draft_{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.csv"
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(draft)
    n_prov = sum(1 for d in draft if d["status"] == "provisional")
    print(f"Wrote {out.relative_to(REPO_ROOT)} ({n_prov} states with votes).")

    curated = read_curated(el.results_csv)
    changes = diff(curated, draft, None)
    print("Draft vs. curated:" if changes else "Draft matches the curated file.")
    print("\n".join(changes))

    if "--apply" in argv:
        i = argv.index("--apply")
        arg = argv[i + 1].upper() if len(argv) > i + 1 else ""
        if arg == "ALL":
            codes = [d["code"] for d in draft
                     if d["status"] == "provisional"
                     and any((curated[d["code"]].get(k) or "") != d[k] for k in NBC_FIELDS if k != "as_of")]
        else:
            codes = [c.strip() for c in arg.split(",") if c.strip()]
        apply(el.results_csv, draft, codes, NBC_FIELDS)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
