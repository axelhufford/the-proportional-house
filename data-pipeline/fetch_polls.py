"""Fetch Silver Bulletin's generic-ballot poll database and compute a weighted
average.

Source: https://www.natesilver.net/p/generic-ballot-average-2026-nate-silver-bulletin-congress-polls
        (Nate Silver's free landing page; the underlying database is a public
         Google Sheets CSV which is free even though the trained model is paywalled.)

The CSV ships columns including pollster, sample size, population (LV/RV/A),
poll dates, and Silver Bulletin's own house-effect-adjusted margins
(`adjusted_dem`, `adjusted_rep`, `adjusted_net`). We compute our own weighted
average so the methodology page can show exactly what's in it.

Weights: recency (exponential decay, 14-day half-life), sqrt(sample_size),
population (LV=1.0, RV=0.85, A=0.7).

Fallbacks for if the CSV breaks (described in PROJECT_PLAN section 4) are NOT
implemented here yet; this is the primary fetcher.
"""

from __future__ import annotations

import csv
import io
import math
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import requests

REPO_ROOT = Path(__file__).resolve().parent.parent

SILVER_BULLETIN_CSV_URL = (
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vRsvXNCZ0ubJr8D_yNcU5q6C0_HBa35K7oDK03KpO7Ca43UwdXaIdvVLWoXEmHHph0EREz5430Hm5yZ/pub?output=csv"
)
SILVER_BULLETIN_LANDING_URL = (
    "https://www.natesilver.net/p/generic-ballot-average-2026-nate-silver-bulletin-congress-polls"
)

RECENT_WINDOW_DAYS = 30
HALF_LIFE_DAYS = 14
POPULATION_WEIGHTS = {"LV": 1.0, "RV": 0.85, "A": 0.7}


@dataclass
class Poll:
    pollster: str
    sponsors: str
    start_date: datetime
    end_date: datetime
    sample_size: Optional[int]
    population: str
    dem: float
    rep: float
    adjusted_dem: Optional[float]
    adjusted_rep: Optional[float]
    url: str

    @property
    def midpoint(self) -> datetime:
        delta = (self.end_date - self.start_date) / 2
        return self.start_date + delta

    @property
    def raw_net(self) -> float:
        return self.dem - self.rep

    @property
    def adjusted_net(self) -> Optional[float]:
        if self.adjusted_dem is None or self.adjusted_rep is None:
            return None
        return self.adjusted_dem - self.adjusted_rep


def _parse_date(s: str) -> Optional[datetime]:
    if not s:
        return None
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y"):
        try:
            return datetime.strptime(s.strip(), fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _parse_float(s: str) -> Optional[float]:
    if s is None or s == "":
        return None
    try:
        return float(s.strip())
    except (ValueError, TypeError):
        return None


def _parse_int(s: str) -> Optional[int]:
    if s is None or s == "":
        return None
    try:
        return int(float(s.strip()))
    except (ValueError, TypeError):
        return None


def fetch_csv(url: str = SILVER_BULLETIN_CSV_URL, timeout: int = 30) -> str:
    r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=timeout)
    r.raise_for_status()
    return r.text


def parse_polls(csv_text: str) -> list[Poll]:
    rows = csv.DictReader(io.StringIO(csv_text))
    polls: list[Poll] = []
    for row in rows:
        # Filter to "All polls" subgroup (the Silver Bulletin CSV has subgroup rollups).
        if (row.get("subgroup") or "").strip() != "All polls":
            continue
        start = _parse_date(row.get("startdate", ""))
        end = _parse_date(row.get("enddate", ""))
        if start is None or end is None:
            continue
        dem = _parse_float(row.get("dem", ""))
        rep = _parse_float(row.get("rep", ""))
        if dem is None or rep is None:
            continue
        polls.append(
            Poll(
                pollster=(row.get("pollster") or "").strip(),
                sponsors=(row.get("sponsors") or "").strip(),
                start_date=start,
                end_date=end,
                sample_size=_parse_int(row.get("samplesize", "")),
                population=(row.get("population") or "").strip().upper(),
                dem=dem,
                rep=rep,
                adjusted_dem=_parse_float(row.get("adjusted_dem", "")),
                adjusted_rep=_parse_float(row.get("adjusted_rep", "")),
                url=(row.get("url") or "").strip(),
            )
        )
    return polls


def weighted_average(polls: list[Poll], as_of: datetime, use_adjusted: bool = True) -> dict:
    """Compute the weighted average margin (D - R) for polls within the recent
    window. Returns a dict with `margin`, `n_polls`, `total_weight`, and the
    list of included polls (with their per-poll weights, for display).
    """
    recent: list[tuple[Poll, float, float]] = []  # poll, weight, margin
    cutoff = as_of.timestamp() - RECENT_WINDOW_DAYS * 86400
    for p in polls:
        if p.midpoint.timestamp() < cutoff:
            continue
        margin = (p.adjusted_net if (use_adjusted and p.adjusted_net is not None) else p.raw_net)
        # Recency: exponential decay from poll midpoint.
        days_ago = (as_of - p.midpoint).total_seconds() / 86400
        recency_w = math.exp(-math.log(2) * days_ago / HALF_LIFE_DAYS)
        # Sample size: sqrt scaling.
        ss = p.sample_size or 1000
        size_w = math.sqrt(max(ss, 1))
        # Population.
        pop_w = POPULATION_WEIGHTS.get(p.population, POPULATION_WEIGHTS.get(p.population.strip(), 0.7))
        w = recency_w * size_w * pop_w
        recent.append((p, w, margin))

    if not recent:
        return {"margin": 0.0, "n_polls": 0, "total_weight": 0.0, "polls": []}

    total_w = sum(w for _, w, _ in recent)
    weighted_sum = sum(w * m for _, w, m in recent)
    margin = weighted_sum / total_w
    return {
        "margin": round(margin, 3),
        "n_polls": len(recent),
        "total_weight": round(total_w, 2),
        "as_of": as_of.isoformat(),
        "use_adjusted": use_adjusted,
        "window_days": RECENT_WINDOW_DAYS,
        "half_life_days": HALF_LIFE_DAYS,
        "polls": [
            {
                "pollster": p.pollster,
                "sponsors": p.sponsors,
                "start_date": p.start_date.date().isoformat(),
                "end_date": p.end_date.date().isoformat(),
                "sample_size": p.sample_size,
                "population": p.population,
                "margin_raw": round(p.raw_net, 2),
                "margin_adjusted": round(p.adjusted_net, 2) if p.adjusted_net is not None else None,
                "weight": round(w, 4),
                "url": p.url,
            }
            for p, w, _m in sorted(recent, key=lambda t: -t[0].midpoint.timestamp())
        ],
    }


def main() -> None:
    print(f"Fetching {SILVER_BULLETIN_CSV_URL}")
    csv_text = fetch_csv()
    polls = parse_polls(csv_text)
    print(f"Loaded {len(polls)} polls (subgroup='All polls').")
    avg = weighted_average(polls, as_of=datetime.now(timezone.utc))
    label = f"D+{avg['margin']:.1f}" if avg["margin"] >= 0 else f"R+{abs(avg['margin']):.1f}"
    print(
        f"Weighted average (last {RECENT_WINDOW_DAYS}d, half-life {HALF_LIFE_DAYS}d, "
        f"adjusted={avg['use_adjusted']}): {label} (n={avg['n_polls']})"
    )


if __name__ == "__main__":
    main()
