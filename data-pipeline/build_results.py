"""Build public/data/results_<cycle>.json from the curated results file.

Input: the committed CSV named in election.json (see results_file.py for its
format and rules). Output, per state and nationally:

  as_elected   the seats CALLED so far by party, plus how many are uncalled
  under_pr     Sainte-Laguë of the two-party vote counted so far — the same
               allocation the retrospectives apply to past cycles — or null
               while a state has no votes in
  final_projection / vs_final_projection
               the frozen pre-election projection alongside (after the freeze)

Nothing is imputed: a state with no votes counted is `pending`, and
uncontested districts are counted and flagged, as in the 2016–2022
retrospectives. Every provisional number carries the file's source_url and
as_of, so the site can say where it came from and how old it is.

    python data-pipeline/build_results.py           # write the JSON
    python data-pipeline/build_results.py --check   # validate + summarize, write nothing
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import election
from allocation import AllocationInput, allocate
from fetch_clerk_house import STATE_CODES, STATES_TO_FIPS
from io_utils import write_json_atomic
from results_file import ResultsFileError, StateResult, load_results_csv, summarize

REPO_ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DATA = REPO_ROOT / "public" / "data"
PROJECTION_PATH = PUBLIC_DATA / "projection.json"

_CODE_TO_NAME = {code: name for name, code in STATE_CODES.items()}


def out_path(cycle: int) -> Path:
    return PUBLIC_DATA / f"results_{cycle}.json"


def _share(d: int, r: int) -> dict | None:
    total = d + r
    if total <= 0:
        return None
    return {"d_share": round(d / total, 6), "r_share": round(r / total, 6)}


def state_block(s: StateResult, final_state: dict | None) -> dict:
    name = _CODE_TO_NAME[s.code]
    under_pr = None
    share = None
    if s.has_votes:
        d, r = s.d_votes or 0, s.r_votes or 0
        res = allocate(AllocationInput(seats=s.seats, d_votes=d, r_votes=r), method="sainte-lague")
        under_pr = {"d_seats": res.d_seats, "r_seats": res.r_seats}
        share = _share(d, r)
    block = {
        "fips": STATES_TO_FIPS[name],
        "code": s.code,
        "name": name,
        "seats": s.seats,
        "status": s.status,
        "as_elected": {
            "d_seats": s.d_seats,
            "r_seats": s.r_seats,
            "other_seats": s.other_seats,
            "uncalled_seats": s.uncalled_seats,
        },
        "votes": {"d": s.d_votes, "r": s.r_votes, "other": s.other_votes},
        "two_party_share": share,
        "under_pr": under_pr,
        "reporting_pct": s.reporting_pct,
        "reporting_source": s.reporting_source or None,
        "source_url": s.source_url or None,
        "as_of": s.as_of or None,
        "note": s.note or None,
        # One party had no votes at all statewide: PR of the real vote gives it
        # nothing, which says more about who ran than about the electorate.
        "baseline_distortion_warning": bool(s.has_votes and (not s.d_votes or not s.r_votes)),
        "uncontested_district_count": s.uncontested_districts,
    }
    if final_state is not None:
        p = final_state["projected"]
        block["final_projection"] = {
            "d_share": p["d_share"], "r_share": p["r_share"],
            "d_seats": p["d_seats"], "r_seats": p["r_seats"],
        }
    return block


def _margin_points(d: int, r: int, total: int) -> float | None:
    return round((d - r) / total * 100, 3) if total > 0 else None


def build(results: list[StateResult], el: election.Election, projection: dict | None,
          source_file: str, now: datetime) -> dict:
    frozen = bool(projection) and (projection.get("meta", {}).get("election") or {}).get(
        "phase", "projection") != "projection"
    final_by_code = {s["code"]: s for s in projection["states"]} if frozen else {}
    states = [state_block(s, final_by_code.get(s.code)) for s in results]

    reporting = [s for s in states if s["under_pr"] is not None]
    d_votes = sum(s["votes"]["d"] or 0 for s in reporting)
    r_votes = sum(s["votes"]["r"] or 0 for s in reporting)
    other_known = bool(reporting) and all(s["votes"]["other"] is not None for s in reporting)
    other_votes = sum(s["votes"]["other"] or 0 for s in reporting) if other_known else None
    uncalled = sum(s["as_elected"]["uncalled_seats"] for s in states)
    counts = {st: sum(1 for s in states if s["status"] == st) for st in ("pending", "provisional", "certified")}
    as_ofs = [s["as_of"] for s in states if s["as_of"]]

    national = {
        "seats": sum(s["seats"] for s in states),
        "as_elected": {
            "d_seats": sum(s["as_elected"]["d_seats"] for s in states),
            "r_seats": sum(s["as_elected"]["r_seats"] for s in states),
            "other_seats": sum(s["as_elected"]["other_seats"] for s in states),
            "uncalled_seats": uncalled,
        },
        "under_pr": {
            "d_seats": sum(s["under_pr"]["d_seats"] for s in reporting),
            "r_seats": sum(s["under_pr"]["r_seats"] for s in reporting),
            # Seats in states with no votes counted yet.
            "pending_seats": sum(s["seats"] for s in states if s["under_pr"] is None),
        },
        "votes": {"d": d_votes, "r": r_votes, "other": other_votes},
        "two_party_d_margin_points": _margin_points(d_votes, r_votes, d_votes + r_votes),
        "all_votes_d_margin_points": (
            _margin_points(d_votes, r_votes, d_votes + r_votes + other_votes)
            if other_votes is not None else None
        ),
    }

    payload: dict = {
        "meta": {
            "generated_at": now.isoformat(),
            "cycle": el.cycle,
            "election_date": el.election_date,
            "source_file": source_file,
            "method": "sainte-lague",
            # Latest as_of of any state: how fresh the freshest numbers are.
            # Each state's own as_of is what its figures mean.
            "as_of": max(as_ofs, key=lambda t: election.parse_ts(t)) if as_ofs else None,
            "rehearsal": el.rehearsal,
            "status_counts": counts,
            "seats_called": national["seats"] - uncalled,
            "all_called": uncalled == 0,
            "all_certified": counts["certified"] == len(states),
        },
        "national": national,
        "states": states,
    }
    if frozen:
        pm = projection["meta"]
        payload["vs_final_projection"] = {
            "final_generated_at": pm["generated_at"],
            "final_generic_ballot_margin": pm["generic_ballot_margin"],
            "final_projected_pr": {
                "d_seats": projection["national"]["projected"]["d_seats"],
                "r_seats": projection["national"]["projected"]["r_seats"],
            },
            # PR of the votes counted so far, in states reporting.
            "pr_on_counted_votes": national["under_pr"],
            "counted_two_party_d_margin_points": national["two_party_d_margin_points"],
            "provisional": not payload["meta"]["all_certified"],
        }
    return payload


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    el = election.resolve()
    now = datetime.now(timezone.utc)
    try:
        results = load_results_csv(el.results_csv, now)
    except (ResultsFileError, FileNotFoundError) as e:
        print(f"✗ {el.results_csv} is invalid:\n  " + str(e).replace("\n", "\n  "))
        if "--check" in argv:
            return 1
        raise
    if not el.frozen and any(r.status != "pending" for r in results):
        msg = (f"{el.results_csv.name} has non-pending states but the election hasn't happened "
               f"(phase {el.phase}) — results before freeze_at can't be real")
        print(f"✗ {msg}")
        if "--check" in argv:
            return 1
        raise ResultsFileError(msg)

    print(summarize(results))
    if "--check" in argv:
        return 0

    projection = json.loads(PROJECTION_PATH.read_text()) if PROJECTION_PATH.exists() else None
    try:
        source_file = str(el.results_csv.relative_to(REPO_ROOT))
    except ValueError:
        source_file = el.results_csv.name
    payload = build(results, el, projection, source_file, now)
    path = out_path(el.cycle)
    write_json_atomic(path, payload)
    print(f"Wrote {path.relative_to(REPO_ROOT)}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
