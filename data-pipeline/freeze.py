"""Freeze the final pre-election projection.

After freeze_at (see election.py) the pipeline stops computing a projection and
republishes the last one the site actually published before freeze_at. It never
recomputes one: Silver Bulletin revises rows and re-estimates house effects, so
re-running the average later could produce a "final projection" no visitor
ever saw — a number with no honest provenance.

Candidates, in priority order:

  committed      data-pipeline/frozen/<cycle>/ — the durable record once
                 captured. Always wins when present; if it is present but
                 invalid, that is an error, never a silent fallback.
  production     the live /data/{projection,polling_trend}.json.
  working-tree   public/data as it stood before this run wrote anything.

A candidate is valid when its generated_at is before freeze_at and no more than
MAX_AGE_HOURS older (the 06:00 UTC run on election day, or the day before's if
that run failed); its polling_trend.json came from the same run; and, when it
is itself a post-freeze copy, it still hashes to the sha256 recorded in it.

The first valid candidate in priority order wins — deliberately not the newest.
Production is by definition what visitors saw; a local working tree can hold a
run that was never deployed, so it is only a fallback for when production
can't be fetched (in CI the working tree is the committed, once-deployed
snapshot).

    python data-pipeline/freeze.py --check              # what would be frozen
    python data-pipeline/freeze.py --capture            # write data-pipeline/frozen/<cycle>/
    python data-pipeline/freeze.py --capture --force    # ...even before freeze_at
"""

from __future__ import annotations

import copy
import dataclasses
import hashlib
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

import election
from io_utils import looks_like_json, write_json_atomic

REPO_ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DATA = REPO_ROOT / "public" / "data"
FROZEN_ROOT = REPO_ROOT / "data-pipeline" / "frozen"
REHEARSAL_ROOT = REPO_ROOT / ".rehearsal" / "frozen"
LIVE_BASE = "https://proportionalhouse.org/data/"

MAX_AGE_HOURS = 30
SOURCE_ORDER = ("committed", "production", "working-tree")


class FreezeError(RuntimeError):
    pass


@dataclasses.dataclass(frozen=True)
class Candidate:
    source: str            # one of SOURCE_ORDER
    detail: str            # path or URL, for the log
    projection: dict       # meta.election stripped
    polling_trend: dict
    generated_at: datetime
    sha256: str
    origin: str = ""       # where it was first captured from (committed: from its manifest)


def strip_election(projection: dict) -> dict:
    out = copy.deepcopy(projection)
    out.get("meta", {}).pop("election", None)
    return out


def canonical_sha256(projection: dict) -> str:
    """sha256 of the projection's canonical JSON, ignoring meta.election.

    The election block is the only thing the pipeline adds to a frozen
    projection, so the hash identifies the published numbers themselves.
    """
    text = json.dumps(
        strip_election(projection), sort_keys=True, separators=(",", ":"), ensure_ascii=False,
    )
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def make_candidate(source: str, detail: str, projection: dict, polling_trend: dict) -> Candidate:
    """Build a Candidate, raising FreezeError on anything structurally wrong."""
    try:
        gen_raw = projection["meta"]["generated_at"]
        generated_at = election.parse_ts(gen_raw)
    except (KeyError, TypeError, ValueError) as e:
        raise FreezeError(f"{source}: projection has no usable meta.generated_at ({e})") from e
    try:
        trend_gen = election.parse_ts(polling_trend["meta"]["generated_at"])
    except (KeyError, TypeError, ValueError) as e:
        raise FreezeError(f"{source}: polling_trend has no usable meta.generated_at ({e})") from e
    if trend_gen != generated_at:
        raise FreezeError(
            f"{source}: polling_trend ({polling_trend['meta']['generated_at']}) and projection "
            f"({gen_raw}) come from different runs"
        )

    sha = canonical_sha256(projection)
    recorded = (projection.get("meta", {}).get("election") or {}).get("final_projection")
    if recorded is not None and recorded.get("sha256") != sha:
        raise FreezeError(
            f"{source}: post-freeze copy hashes to {sha[:12]}…, but records {str(recorded.get('sha256'))[:12]}…"
        )
    return Candidate(source, detail, strip_election(projection), polling_trend, generated_at, sha, origin=source)


def frozen_dir(el: election.Election) -> Path:
    """Rehearsals write to a gitignored path so they can't be committed by accident."""
    return (REHEARSAL_ROOT if el.rehearsal else FROZEN_ROOT) / str(el.cycle)


def _read_json(path: Path) -> dict:
    with path.open() as f:
        return json.load(f)


def load_committed(el: election.Election) -> Candidate | None:
    d = frozen_dir(el)
    if not (d / "projection.json").exists():
        return None
    manifest = _read_json(d / "manifest.json")
    if bool(manifest.get("rehearsal")) != el.rehearsal:
        raise FreezeError(
            f"committed: {d} manifest has rehearsal={manifest.get('rehearsal')!r} "
            f"but this run has rehearsal={el.rehearsal}"
        )
    c = make_candidate("committed", str(d), _read_json(d / "projection.json"), _read_json(d / "polling_trend.json"))
    if manifest.get("sha256") != c.sha256:
        raise FreezeError(f"committed: {d}/projection.json does not match its manifest sha256")
    return dataclasses.replace(c, origin=manifest.get("captured_from") or "committed")


def load_working_tree() -> Candidate:
    return make_candidate(
        "working-tree", str(PUBLIC_DATA),
        _read_json(PUBLIC_DATA / "projection.json"), _read_json(PUBLIC_DATA / "polling_trend.json"),
    )


def _fetch_json(url: str) -> dict:
    r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=20)
    r.raise_for_status()
    if not looks_like_json(r.text):
        raise FreezeError(f"{url} did not return JSON")
    return r.json()


def load_production() -> Candidate:
    return make_candidate(
        "production", LIVE_BASE,
        _fetch_json(LIVE_BASE + "projection.json"), _fetch_json(LIVE_BASE + "polling_trend.json"),
    )


def collect(el: election.Election, include_production: bool = True) -> tuple[list[Candidate], list[str]]:
    """Every loadable candidate, plus a note per source that couldn't load.

    Must run before the pipeline writes anything to public/data, or the
    working-tree candidate is this run's own output.
    """
    found: list[Candidate] = []
    notes: list[str] = []
    committed = load_committed(el)  # an invalid committed record raises — see module doc
    if committed is not None:
        found.append(committed)
    loaders = [("working-tree", load_working_tree)]
    if include_production:
        loaders.insert(0, ("production", load_production))
    for name, loader in loaders:
        try:
            found.append(loader())
        except Exception as e:  # noqa: BLE001 — network, missing file, bad JSON, FreezeError
            notes.append(f"{name}: {type(e).__name__}: {e}")
    return found, notes


def in_window(c: Candidate, freeze_at: datetime, max_age_hours: float = MAX_AGE_HOURS) -> bool:
    return freeze_at - timedelta(hours=max_age_hours) <= c.generated_at < freeze_at


def select_final(
    cands: list[Candidate], freeze_at: datetime, max_age_hours: float = MAX_AGE_HOURS,
) -> Candidate:
    committed = [c for c in cands if c.source == "committed"]
    if committed:
        c = committed[0]
        if not in_window(c, freeze_at, max_age_hours):
            raise FreezeError(
                f"committed frozen projection was generated {c.generated_at.isoformat()}, outside "
                f"[freeze_at − {max_age_hours}h, freeze_at) for freeze_at {freeze_at.isoformat()} — "
                "was freeze_at changed after capture?"
            )
        return c
    valid = [c for c in cands if in_window(c, freeze_at, max_age_hours)]
    if not valid:
        seen = ", ".join(f"{c.source} @ {c.generated_at.isoformat()}" for c in cands) or "none"
        raise FreezeError(
            f"no projection published in [freeze_at − {max_age_hours}h, freeze_at) "
            f"(freeze_at {freeze_at.isoformat()}; candidates: {seen})"
        )
    return min(valid, key=lambda c: SOURCE_ORDER.index(c.source))


def final_block(c: Candidate) -> dict:
    """meta.election.final_projection for a frozen payload.

    `captured_from` is where the record was first captured, not where this run
    read it, so the published block stays byte-stable for the whole cycle.
    """
    return {
        "generated_at": c.projection["meta"]["generated_at"],
        "sha256": c.sha256,
        "captured_from": c.origin,
    }


def write_frozen_dir(el: election.Election, c: Candidate, now: datetime) -> Path:
    d = frozen_dir(el)
    write_json_atomic(d / "projection.json", c.projection)
    write_json_atomic(d / "polling_trend.json", c.polling_trend)
    write_json_atomic(d / "manifest.json", {
        "cycle": el.cycle,
        "freeze_at": election.iso_z(el.freeze_at),
        "generated_at": c.projection["meta"]["generated_at"],
        "sha256": c.sha256,
        "captured_from": c.origin,
        "captured_from_detail": c.detail,
        "captured_at": now.isoformat(),
        "rehearsal": el.rehearsal,
        "note": (
            "The final pre-election projection exactly as the site published it. "
            "Never regenerate: the pipeline republishes this file for the rest of the cycle."
        ),
    })
    return d


def _print_candidates(cands: list[Candidate], notes: list[str], freeze_at: datetime) -> None:
    for c in cands:
        verdict = "in window" if in_window(c, freeze_at) else "outside window"
        nat = c.projection["national"]["projected"]
        print(
            f"  {c.source:<13} generated {c.generated_at.isoformat()}  "
            f"D {nat['d_seats']} / R {nat['r_seats']}  sha {c.sha256[:12]}…  ({verdict})"
        )
    for n in notes:
        print(f"  (unavailable) {n}")


def main(argv: list[str]) -> int:
    el = election.resolve()
    print(f"Cycle {el.cycle}: freeze_at {election.iso_z(el.freeze_at)}, phase {el.phase}"
          + (" [REHEARSAL]" if el.rehearsal else ""))
    cands, notes = collect(el)
    _print_candidates(cands, notes, el.freeze_at)
    try:
        chosen = select_final(cands, el.freeze_at)
    except FreezeError as e:
        print(f"✗ {e}")
        return 1
    print(f"→ final projection: {chosen.source}, generated {chosen.generated_at.isoformat()}")

    if "--capture" not in argv:
        return 0
    if chosen.source == "committed":
        print(f"Already captured at {frozen_dir(el)} — nothing to do.")
        return 0
    if el.now < el.freeze_at and "--force" not in argv:
        print("✗ freeze_at has not passed; a later pre-election run could still supersede this. "
              "Pass --force to capture anyway.")
        return 1
    d = write_frozen_dir(el, chosen, el.now)
    print(f"✓ wrote {d.relative_to(REPO_ROOT)} — commit it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
