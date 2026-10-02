"""Election lifecycle: which phase of the cycle the site is in.

The site moves through three phases around an election, driven by the committed
config in data-pipeline/election.json:

  projection  now < freeze_at. The headline is the daily generic-ballot
              projection, exactly as before this module existed.
  counting    freeze_at <= now, until every state's result is certified. The
              projection is frozen at what the site actually published on
              election eve (see freeze.py); results arrive as provisional.
  results     every state certified (or phase_override). Same frozen
              projection, certified results.

`freeze_at` sits between the last scheduled pre-election run (06:00 UTC on
election day) and the polls opening, so the final projection is the one
visitors saw that morning.

The phase is resolved ONCE per process and memoized. update.py runs every
builder and validate_data in one process, so a run that straddles freeze_at
can't write a projection-phase projection.json and a counting-phase history.

Rehearsal overrides (never set in CI; any of them marks the output
`rehearsal: true`, which validate_data rejects under GitHub Actions):

  PH_FREEZE_AT    ISO timestamp replacing freeze_at, e.g. one minute ago.
  PH_PHASE        Force a phase. A frozen phase needs freeze_at in the past.
  PH_RESULTS_CSV  Results file to read instead of the committed one.
"""

from __future__ import annotations

import csv
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = REPO_ROOT / "data-pipeline" / "election.json"

PHASES = ("projection", "counting", "results")
REHEARSAL_ENV = ("PH_FREEZE_AT", "PH_PHASE", "PH_RESULTS_CSV")


@dataclass(frozen=True)
class Election:
    cycle: int
    congress: int
    election_date: str
    freeze_at: datetime
    congress_convenes: str
    baseline_cycle: int
    results_csv: Path
    phase: str
    now: datetime
    rehearsal: bool

    @property
    def frozen(self) -> bool:
        """True once the projection is frozen (counting or results)."""
        return self.phase != "projection"


def parse_ts(value: str) -> datetime:
    """Parse an ISO timestamp; a naive one is taken as UTC."""
    ts = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


def load_config(path: Path = CONFIG_PATH) -> dict:
    with path.open() as f:
        return json.load(f)


def all_certified(results_csv: Path) -> bool:
    """True when the results file has all 50 states and every one is certified.

    Deliberately shallow: it only reads the status column. The file's full
    validation happens where it is built into results_{cycle}.json, and a file
    that fails there fails the run regardless of what phase this returns.
    """
    if not results_csv.exists():
        return False
    with results_csv.open(newline="") as f:
        rows = [r for r in csv.DictReader(f) if (r.get("code") or "").strip()]
    return len(rows) == 50 and all((r.get("status") or "").strip() == "certified" for r in rows)


def phase_at(cfg: dict, now: datetime, certified: bool = False) -> str:
    """The phase at `now`.

    `phase_override` wins, but only `projection` may be forced before
    freeze_at: a frozen phase with nothing to freeze is a config error. Forcing
    `projection` after freeze_at is the emergency switch back to the
    pre-election behavior.
    """
    freeze_at = parse_ts(cfg["freeze_at"])
    override = cfg.get("phase_override")
    if override is not None:
        if override not in PHASES:
            raise ValueError(f"phase_override {override!r} is not one of {PHASES}")
        if override != "projection" and now < freeze_at:
            raise ValueError(
                f"phase_override {override!r} before freeze_at ({cfg['freeze_at']}) — "
                "there is no final projection to freeze yet"
            )
        return override
    if now < freeze_at:
        return "projection"
    return "results" if certified else "counting"


_RESOLVED: Election | None = None


def resolve(now: datetime | None = None) -> Election:
    """The run's Election, memoized for the life of the process."""
    global _RESOLVED
    if _RESOLVED is not None:
        return _RESOLVED

    cfg = dict(load_config())
    rehearsal = any(os.environ.get(k) for k in REHEARSAL_ENV)
    if os.environ.get("PH_FREEZE_AT"):
        cfg["freeze_at"] = os.environ["PH_FREEZE_AT"]
    if os.environ.get("PH_PHASE"):
        cfg["phase_override"] = os.environ["PH_PHASE"]
    results_csv = Path(os.environ.get("PH_RESULTS_CSV") or cfg["results_csv"])
    if not results_csv.is_absolute():
        results_csv = REPO_ROOT / results_csv

    now = now or datetime.now(timezone.utc)
    phase = phase_at(cfg, now, certified=all_certified(results_csv))
    _RESOLVED = Election(
        cycle=int(cfg["cycle"]),
        congress=int(cfg["congress"]),
        election_date=cfg["election_date"],
        freeze_at=parse_ts(cfg["freeze_at"]),
        congress_convenes=cfg["congress_convenes"],
        baseline_cycle=int(cfg["baseline_cycle"]),
        results_csv=results_csv,
        phase=phase,
        now=now,
        rehearsal=rehearsal,
    )
    return _RESOLVED


def reset() -> None:
    """Forget the memoized Election (tests only)."""
    global _RESOLVED
    _RESOLVED = None


def iso_z(ts: datetime) -> str:
    return ts.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def meta_block(el: Election, final: dict | None = None) -> dict:
    """The `election` block stamped into projection.json's meta and meta.json.

    Holds no results numbers: CI's failure path overlays production meta.json,
    which would then disagree with a results file built from a newer CSV.
    """
    block: dict = {
        "cycle": el.cycle,
        "election_date": el.election_date,
        "freeze_at": iso_z(el.freeze_at),
        "phase": el.phase,
        "baseline_cycle": el.baseline_cycle,
        "rehearsal": el.rehearsal,
    }
    if final is not None:
        block["final_projection"] = final
    return block
