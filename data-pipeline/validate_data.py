"""Automated data-integrity checks for the generated public/data JSON.

Run as the final step of the pipeline (and standalone in CI / locally). Asserts
the invariants that must always hold; a failure exits non-zero so the deploy
ships the last-good data instead of a regression. This is the guardrail that
would have caught the North Dakota 2022 "phantom Democratic seat" bug before it
shipped.

    python data-pipeline/validate_data.py
"""

from __future__ import annotations

import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DATA = REPO_ROOT / "public" / "data"

TOTAL_SEATS = 435

# Minimum polls that may back a published generic-ballot average. backfill
#_history.py has always enforced 8 for reconstructed points; the live pipeline
# enforced nothing, so a source schema change that left two matching rows would
# have published a 2-poll average as *the* generic ballot for the whole model.
MIN_POLLS_IN_AVERAGE = 8

# Known U.S. House composition (D, R) after each cycle's election — ground truth.
KNOWN_ACTUAL = {
    "2016": (194, 241),
    "2018": (235, 200),
    "2020": (222, 213),
    "2022": (213, 222),
    "2024": (215, 220),
}

# Official apportionment by census. 2016–2020 elections used the 2010 census;
# 2022+ used the 2020 census. Seat counts must match exactly per cycle.
APP_2010 = {
    "CA": 53, "TX": 36, "FL": 27, "NY": 27, "PA": 18, "IL": 18, "OH": 16, "MI": 14,
    "GA": 14, "NC": 13, "NJ": 12, "VA": 11, "WA": 10, "AZ": 9, "MA": 9, "TN": 9,
    "IN": 9, "MO": 8, "MD": 8, "WI": 8, "MN": 8, "CO": 7, "AL": 7, "SC": 7, "LA": 6,
    "KY": 6, "OR": 5, "OK": 5, "CT": 5, "IA": 4, "MS": 4, "AR": 4, "KS": 4, "UT": 4,
    "NV": 4, "NM": 3, "NE": 3, "WV": 3, "ID": 2, "HI": 2, "ME": 2, "NH": 2, "RI": 2,
    "MT": 1, "DE": 1, "SD": 1, "ND": 1, "AK": 1, "VT": 1, "WY": 1,
}
APP_2020 = {
    "CA": 52, "TX": 38, "FL": 28, "NY": 26, "PA": 17, "IL": 17, "OH": 15, "MI": 13,
    "GA": 14, "NC": 14, "NJ": 12, "VA": 11, "WA": 10, "AZ": 9, "MA": 9, "TN": 9,
    "IN": 9, "MO": 8, "MD": 8, "WI": 8, "MN": 8, "CO": 8, "AL": 7, "SC": 7, "LA": 6,
    "KY": 6, "OR": 6, "OK": 5, "CT": 5, "IA": 4, "MS": 4, "AR": 4, "KS": 4, "UT": 4,
    "NV": 4, "NM": 3, "NE": 3, "WV": 2, "ID": 2, "HI": 2, "ME": 2, "NH": 2, "RI": 2,
    "MT": 2, "DE": 1, "SD": 1, "ND": 1, "AK": 1, "VT": 1, "WY": 1,
}


def _load(name: str) -> dict:
    with (PUBLIC_DATA / name).open() as f:
        return json.load(f)


def _is_num(x: object) -> bool:
    """True for a real, finite number. Rejects None, strings, NaN and Infinity.

    json.load happily produces float('nan') from the non-standard `NaN` literal,
    and NaN compares false against every bound — so a range check alone lets it
    straight through.
    """
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def _parse_ts(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        ts = datetime.fromisoformat(value)
    except ValueError:
        return None
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


def check_projection(errors: list[str]) -> None:
    p = _load("projection.json")
    states = p["states"]
    if len(states) != 50:
        errors.append(f"projection: {len(states)} states (expected 50)")
    seat_sum = sum(s["seats"] for s in states)
    if seat_sum != TOTAL_SEATS:
        errors.append(f"projection: seats sum {seat_sum} != {TOTAL_SEATS}")
    pd = pr = ad = ar = 0
    for s in states:
        c = s["code"]
        if s["actual"]["d_seats"] + s["actual"]["r_seats"] != s["seats"]:
            errors.append(f"projection {c}: actual seats != {s['seats']}")
        if s["projected"]["d_seats"] + s["projected"]["r_seats"] != s["seats"]:
            errors.append(f"projection {c}: projected seats != {s['seats']}")
        ds, rs = s["baseline_2024"]["d_share"], s["baseline_2024"]["r_share"]
        if not _is_num(ds) or not _is_num(rs) or not (0 <= ds <= 1) or abs(ds + rs - 1) > 0.02:
            errors.append(f"projection {c}: share off d={ds} r={rs}")
        elif abs(ds - 0.5) < 1e-9 and not s.get("baseline_distortion_warning"):
            # Same imputation-artifact guard retrospectives.json has had all
            # along. Applies to the 2024 baseline share (real returns, never
            # exactly 50%), not the projected share — a flagged state at exactly
            # zero swing legitimately projects 50/50 off the neutral fallback.
            errors.append(f"projection {c}: 2024 share is exactly 50/50 (imputation artifact?)")
        pjd, pjr = s["projected"]["d_share"], s["projected"]["r_share"]
        if not _is_num(pjd) or not _is_num(pjr) or not (0 <= pjd <= 1):
            errors.append(f"projection {c}: projected share off d={pjd} r={pjr}")
        pd += s["projected"]["d_seats"]; pr += s["projected"]["r_seats"]
        ad += s["actual"]["d_seats"]; ar += s["actual"]["r_seats"]
    nat = p["national"]
    if (pd, pr) != (nat["projected"]["d_seats"], nat["projected"]["r_seats"]):
        errors.append("projection: national.projected != sum of states")
    if (ad, ar) != (nat["actual"]["d_seats"], nat["actual"]["r_seats"]):
        errors.append("projection: national.actual != sum of states")
    if ad + ar != TOTAL_SEATS or pd + pr != TOTAL_SEATS:
        errors.append("projection: national totals don't sum to 435")
    unc = p["meta"].get("uncertainty")
    if unc is not None:
        if not unc["epsilon_points"] > 0:
            errors.append("projection: uncertainty epsilon <= 0")
        if unc["d_seats_low"] > unc["d_seats_high"]:
            errors.append("projection: uncertainty band inverted")
        if not (unc["d_seats_low"] <= nat["projected"]["d_seats"] <= unc["d_seats_high"]):
            errors.append("projection: projected d_seats outside uncertainty band")
        if (unc["d_seats_low"] + unc["r_seats_high"] != TOTAL_SEATS
                or unc["d_seats_high"] + unc["r_seats_low"] != TOTAL_SEATS):
            errors.append("projection: uncertainty band complements don't sum to 435")

    majority = p["meta"].get("majority")
    flips = p["meta"].get("closest_flips")
    if majority is not None or flips is not None:
        # Strong checks re-run the shipped model, so they need the baseline.
        from update import project_states  # function-level: avoids import-order surprises

        baseline_path = REPO_ROOT / "data-pipeline" / "baseline" / "house_2024.json"
        with baseline_path.open() as f:
            baseline_states = json.load(f)["states"]
        margin = p["meta"]["generic_ballot_margin"]
        baseline_d_margin = p["meta"]["baseline_2024_margin"]

        def national_d(at_margin: float) -> int:
            proj = project_states(baseline_states, at_margin - baseline_d_margin)
            return sum(s["projected"]["d_seats"] for s in proj)

    if majority is not None:
        tip = majority["tipping_margin"]
        if majority["majority_seats"] != 218:
            errors.append(f"projection: majority_seats {majority['majority_seats']} != 218")
        if not (-20 <= tip <= 20):
            errors.append(f"projection: tipping_margin {tip} outside ±20")
        # Sign consistency: D holds a projected majority iff today's margin
        # sits at/above the tipping point (0.05 covers the 0.1 rounding).
        has_majority_now = nat["projected"]["d_seats"] >= 218
        if has_majority_now != (tip <= margin + 0.05):
            errors.append("projection: tipping_margin sign inconsistent with projected majority")
        # Strong check: the crossing actually happens at the shipped value.
        if national_d(tip + 0.1) < 218:
            errors.append(f"projection: D < 218 at tipping_margin+0.1 ({tip + 0.1})")
        if national_d(tip - 0.1) > 217:
            errors.append(f"projection: D > 217 at tipping_margin-0.1 ({tip - 0.1})")

    if flips is not None:
        if len(flips) > 6:
            errors.append(f"projection: closest_flips has {len(flips)} entries (max 6)")
        for direction in ("D", "R"):
            if sum(1 for c in flips if c["direction"] == direction) > 3:
                errors.append(f"projection: closest_flips has > 3 {direction} entries")
        deltas = [c["margin_delta"] for c in flips]
        if deltas != sorted(deltas):
            errors.append("projection: closest_flips not sorted by margin_delta")
        seen = set()
        by_fips = {s["fips"]: s for s in baseline_states}
        for c in flips:
            key = (c["code"], c["direction"])
            if key in seen:
                errors.append(f"projection: closest_flips duplicate {key}")
            seen.add(key)
            if not (0 < c["margin_delta"] <= 15):
                errors.append(f"projection {c['code']}: margin_delta {c['margin_delta']} outside (0, 15]")
            sign = 1.0 if c["direction"] == "D" else -1.0
            if abs(c["flips_at_margin"] - round(margin + sign * c["margin_delta"], 1)) > 0.051:
                errors.append(f"projection {c['code']}: flips_at_margin arithmetic off")
            # Strong check: the seat really flips at delta (+0.05 slack) and
            # not well before it (0.2 covers bisection tol + ceil rounding).
            state = by_fips.get(c["fips"])
            if state is None:
                errors.append(f"projection {c['code']}: fips not in baseline")
                continue
            swing_today = margin - baseline_d_margin
            today_d = project_states([state], swing_today)[0]["projected"]["d_seats"]
            at_delta = project_states([state], swing_today + sign * (c["margin_delta"] + 0.05))[0]["projected"]["d_seats"]
            if at_delta == today_d:
                errors.append(f"projection {c['code']}: no flip at margin_delta+0.05")
            elif (at_delta > today_d) != (c["direction"] == "D"):
                errors.append(f"projection {c['code']}: flip direction mismatch")
            early = c["margin_delta"] - 0.2
            if early > 0:
                at_early = project_states([state], swing_today + sign * early)[0]["projected"]["d_seats"]
                if at_early != today_d:
                    errors.append(f"projection {c['code']}: flips earlier than margin_delta-0.2")


def check_polling_error(errors: list[str]) -> None:
    """No-fabrication guard for the curated polling-error table.

    Runs nightly with the pipeline: every verified row's actual margin must
    match the committed house_{year}.json baseline exactly, the miss
    arithmetic must hold, every row must carry a source URL, and the shipped
    epsilon must equal the RMS of the misses. Skips silently while the table
    is an unverified skeleton (the pipeline emits no band in that state).
    """
    path = REPO_ROOT / "data-pipeline" / "baseline" / "polling_error.json"
    if not path.exists():
        return
    with path.open() as f:
        table = json.load(f)
    cycles = table.get("cycles", [])
    verified = [c for c in cycles if c.get("verified") is True]
    eps = table.get("meta", {}).get("epsilon_points")
    if not verified or eps is None:
        return  # skeleton — band is gated off; nothing to check
    misses: list[float] = []
    for c in verified:
        year = c["year"]
        hp = REPO_ROOT / "data-pipeline" / "baseline" / f"house_{year}.json"
        with hp.open() as f:
            nhpv = json.load(f)["meta"]["national_house_popular_vote"]
        actual = nhpv.get("d_margin_points")
        if actual is None:
            actual = -nhpv["r_margin_points"]
        if abs(c["actual_d_margin"] - actual) > 0.001:
            errors.append(f"polling_error {year}: actual_d_margin {c['actual_d_margin']} != baseline {actual}")
        if c["final_average_d_margin"] is None:
            errors.append(f"polling_error {year}: verified row missing final_average_d_margin")
            continue
        expected_err = c["final_average_d_margin"] - c["actual_d_margin"]
        if abs(c["error_points"] - expected_err) > 0.001:
            errors.append(f"polling_error {year}: error_points {c['error_points']} != {expected_err:.3f}")
        if not c.get("final_average_source_url"):
            errors.append(f"polling_error {year}: verified row missing final_average_source_url")
        misses.append(c["error_points"])
    if misses:
        rms = (sum(m * m for m in misses) / len(misses)) ** 0.5
        if abs(eps - round(rms, 1)) > 0.05:
            errors.append(f"polling_error: epsilon_points {eps} != RMS of misses {round(rms, 1)}")


def check_retrospectives(errors: list[str]) -> None:
    r = _load("retrospectives.json")
    for year, cyc in r["cycles"].items():
        states = cyc["states"]
        if len(states) != 50:
            errors.append(f"{year}: {len(states)} states (expected 50)")
        app = APP_2010 if int(year) <= 2020 else APP_2020
        ad = ar = pd = pr = 0
        for s in states:
            c = s["code"]
            seats = s["seats"]
            if s["actual"]["d_seats"] + s["actual"]["r_seats"] != seats:
                errors.append(f"{year} {c}: actual seats != {seats}")
            if s["projected_pr"]["d_seats"] + s["projected_pr"]["r_seats"] != seats:
                errors.append(f"{year} {c}: PR seats != {seats}")
            if app.get(c) != seats:
                errors.append(f"{year} {c}: apportionment {seats} != expected {app.get(c)}")
            # The ND-bug guard: PR's seat allocation must not favor the party
            # that lost the two-party vote.
            dshare = s["two_party_share"]["d_share"]
            prd, prr = s["projected_pr"]["d_seats"], s["projected_pr"]["r_seats"]
            if seats == 1:
                # A lone seat must go to the two-party plurality — no rounding slack.
                if prd == 1 and dshare <= 0.5:
                    errors.append(f"{year} {c}: PR gave D the only seat but D share is {dshare}")
                if prr == 1 and dshare >= 0.5:
                    errors.append(f"{year} {c}: PR gave R the only seat but D share is {dshare}")
            else:
                # Multi-seat: allow a small tolerance for legitimate near-tie rounding.
                if prd > prr and dshare < 0.49:
                    errors.append(f"{year} {c}: PR majority D ({prd}/{prr}) but D share {dshare}")
                if prr > prd and dshare > 0.51:
                    errors.append(f"{year} {c}: PR majority R ({prd}/{prr}) but D share {dshare}")
            # An *exactly* 50/50 share never occurs in real returns — it's the
            # signature of a 50/50 imputation slipping into the data (the ND bug).
            if abs(dshare - 0.5) < 1e-9:
                errors.append(f"{year} {c}: two-party share is exactly 50/50 (imputation artifact?)")
            ad += s["actual"]["d_seats"]; ar += s["actual"]["r_seats"]
            pd += s["projected_pr"]["d_seats"]; pr += s["projected_pr"]["r_seats"]
        if ad + ar != TOTAL_SEATS or pd + pr != TOTAL_SEATS:
            errors.append(f"{year}: cycle totals don't sum to 435 (actual {ad+ar}, PR {pd+pr})")
        known = KNOWN_ACTUAL.get(year)
        if known and (ad, ar) != known:
            errors.append(f"{year}: actual composition {ad}/{ar} != known {known[0]}/{known[1]}")
    # series consistency
    for pt in r.get("series", []):
        if pt["d_gain"] != pt["projected_pr"]["d_seats"] - pt["actual"]["d_seats"]:
            errors.append(f"series {pt['year']}: d_gain inconsistent")


def check_meta(errors: list[str], check_freshness: bool = False) -> None:
    """meta.json backs the homepage headline, the stale banner, the build-time
    SEO prerender, the OG cache-buster and the sitemap's <lastmod> — and was
    previously never validated at all.

    The important invariant is agreement with projection.json: the two are
    written separately, so a failure between the writes would leave the
    prerendered <title> and og:description quoting different seat counts than
    the interactive map.
    """
    path = PUBLIC_DATA / "meta.json"
    if not path.exists():
        errors.append("meta.json: missing")
        return
    m = _load("meta.json")

    ts = _parse_ts(m.get("generated_at"))
    if ts is None:
        errors.append(f"meta: generated_at missing or unparseable ({m.get('generated_at')!r})")
    elif check_freshness:
        # Only meaningful right after a pipeline run: the data was just written,
        # so an old timestamp means a write silently didn't happen. Skipped for
        # standalone runs and for CI's last-good restore path, which ships
        # deliberately older data.
        age_h = (datetime.now(timezone.utc) - ts).total_seconds() / 3600
        limit = m.get("stale_after_hours", 48)
        if age_h > limit:
            errors.append(f"meta: generated_at is {age_h:.1f}h old (stale_after_hours={limit})")
        if age_h < -1:
            errors.append(f"meta: generated_at is {-age_h:.1f}h in the future")

    if not _is_num(m.get("stale_after_hours")) or m["stale_after_hours"] <= 0:
        errors.append(f"meta: stale_after_hours invalid ({m.get('stale_after_hours')!r})")

    gb = m.get("generic_ballot") or {}
    if not _is_num(gb.get("margin")):
        errors.append(f"meta: generic_ballot.margin invalid ({gb.get('margin')!r})")
    elif abs(gb["margin"]) > 30:
        errors.append(f"meta: generic_ballot.margin {gb['margin']} is implausible (>30 pts)")
    n_polls = gb.get("n_polls")
    if not isinstance(n_polls, int) or n_polls < MIN_POLLS_IN_AVERAGE:
        errors.append(
            f"meta: generic_ballot.n_polls={n_polls!r} below the {MIN_POLLS_IN_AVERAGE}-poll "
            f"minimum — the average is too thin to publish"
        )

    # Must agree with projection.json, which is written separately.
    if (PUBLIC_DATA / "projection.json").exists():
        p = _load("projection.json")
        if m.get("national") != p.get("national"):
            errors.append("meta: national block != projection.json national block")
        if _is_num(gb.get("margin")) and _is_num(p["meta"].get("generic_ballot_margin")):
            if abs(gb["margin"] - p["meta"]["generic_ballot_margin"]) > 1e-9:
                errors.append("meta: generic_ballot.margin != projection meta.generic_ballot_margin")


def check_baseline_2024(errors: list[str]) -> None:
    """baseline_2024.json backs the entire Retrospective view and had no checks.

    In particular it never got the exact-50/50 imputation guard that
    retrospectives.json has — and three separate code paths substitute a
    fabricated 50/50 share when a two-party total comes out zero.
    """
    path = PUBLIC_DATA / "baseline_2024.json"
    if not path.exists():
        errors.append("baseline_2024.json: missing")
        return
    b = _load("baseline_2024.json")
    states = b.get("states", [])
    if len(states) != 50:
        errors.append(f"baseline_2024: {len(states)} states (expected 50)")
    seat_sum = sum(s["seats"] for s in states)
    if seat_sum != TOTAL_SEATS:
        errors.append(f"baseline_2024: seats sum {seat_sum} != {TOTAL_SEATS}")

    pd = pr = ad = ar = 0
    for s in states:
        c = s["code"]
        if s["actual"]["d_seats"] + s["actual"]["r_seats"] != s["seats"]:
            errors.append(f"baseline_2024 {c}: actual seats != {s['seats']}")
        if s["projected_pr"]["d_seats"] + s["projected_pr"]["r_seats"] != s["seats"]:
            errors.append(f"baseline_2024 {c}: PR seats != {s['seats']}")
        ds, rs = s["baseline_2024"]["d_share"], s["baseline_2024"]["r_share"]
        if not _is_num(ds) or not _is_num(rs) or not (0 <= ds <= 1) or abs(ds + rs - 1) > 0.02:
            errors.append(f"baseline_2024 {c}: share off d={ds} r={rs}")
        elif abs(ds - 0.5) < 1e-9 and not s.get("baseline_distortion_warning"):
            # A real two-party return is never exactly 50.0000000% — this is the
            # signature of a 50/50 imputation reaching the published data, which
            # then hands a 1-seat state to D on the tie-break (the ND-2022 bug).
            errors.append(f"baseline_2024 {c}: share is exactly 50/50 (imputation artifact?)")
        pd += s["projected_pr"]["d_seats"]; pr += s["projected_pr"]["r_seats"]
        ad += s["actual"]["d_seats"]; ar += s["actual"]["r_seats"]

    nat = b.get("national", {})
    if (pd, pr) != (nat.get("projected_pr", {}).get("d_seats"), nat.get("projected_pr", {}).get("r_seats")):
        errors.append("baseline_2024: national.projected_pr != sum of states")
    if (ad, ar) != (nat.get("actual", {}).get("d_seats"), nat.get("actual", {}).get("r_seats")):
        errors.append("baseline_2024: national.actual != sum of states")


def check_house_composition(errors: list[str]) -> None:
    """Validate the live chamber composition (house_composition.json).

    This file is display-only — it never feeds the allocation math — but it is
    the site's answer to "who holds the House right now", so it has to be a
    whole chamber or nothing. Note the invariant is d + r + other + vacant ==
    seats, NOT d + r == seats: vacancies are real and are counted separately.
    """
    path = PUBLIC_DATA / "house_composition.json"
    if not path.exists():
        # Optional: the site degrades to showing only the election result.
        return
    hc = _load("house_composition.json")

    states = hc.get("states", [])
    if len(states) != 50:
        errors.append(f"house_composition: {len(states)} states (expected 50)")

    nat = hc.get("national", {})
    d = r = other = vacant = 0
    for s in states:
        code = s.get("code")
        parts = (s.get("d_seats"), s.get("r_seats"), s.get("other_seats"), s.get("vacant"))
        if not all(isinstance(v, int) and v >= 0 for v in parts):
            errors.append(f"house_composition {code}: non-integer or negative seat counts {parts}")
            continue
        if sum(parts) != s.get("seats"):
            errors.append(
                f"house_composition {code}: d+r+other+vacant={sum(parts)} != seats {s.get('seats')}"
            )
        d += parts[0]; r += parts[1]; other += parts[2]; vacant += parts[3]

    if (d, r, other, vacant) != (
        nat.get("d_seats"), nat.get("r_seats"), nat.get("other_seats"), nat.get("vacant")
    ):
        errors.append("house_composition: national block != sum of states")
    if d + r + other + vacant != TOTAL_SEATS:
        errors.append(
            f"house_composition: chamber sums to {d + r + other + vacant}, expected {TOTAL_SEATS}"
        )

    # Every vacancy must carry a citable cause — an unexplained empty seat is
    # exactly the kind of number this project refuses to publish.
    vacancies = hc.get("vacancies", [])
    if len(vacancies) != vacant:
        errors.append(f"house_composition: {len(vacancies)} vacancy entries but {vacant} vacant seats")
    for v in vacancies:
        if not (v.get("reason") or "").strip():
            errors.append(f"house_composition: vacancy {v.get('code')}-{v.get('district')} has no reason")

    if not (hc.get("meta", {}).get("publish_date") or "").strip():
        errors.append("house_composition: meta.publish_date missing")

    # Apportionment must agree with the projection — both describe the same 435.
    if (PUBLIC_DATA / "projection.json").exists():
        proj_seats = {s["code"]: s["seats"] for s in _load("projection.json")["states"]}
        for s in states:
            if proj_seats.get(s.get("code")) != s.get("seats"):
                errors.append(
                    f"house_composition {s.get('code')}: seats {s.get('seats')} != "
                    f"projection.json {proj_seats.get(s.get('code'))}"
                )


def check_polling_trend(errors: list[str]) -> None:
    path = PUBLIC_DATA / "polling_trend.json"
    if not path.exists():
        errors.append("polling_trend.json: missing")
        return
    t = _load("polling_trend.json")
    polls = t.get("polls", [])
    if not polls:
        errors.append("polling_trend: no polls in the trend window")
    last = ""
    for p in polls:
        if not _is_num(p.get("margin")):
            errors.append(f"polling_trend: non-numeric margin {p.get('margin')!r} ({p.get('pollster')})")
        elif abs(p["margin"]) > 50:
            errors.append(f"polling_trend: implausible margin {p['margin']} ({p.get('pollster')})")
        d = p.get("date", "")
        if not isinstance(d, str) or not d:
            errors.append("polling_trend: point missing date")
        elif d < last:
            errors.append(f"polling_trend: dates out of order at {d}")
        else:
            last = d
    if t.get("meta", {}).get("n_polls") != len(polls):
        errors.append("polling_trend: meta.n_polls != len(polls)")


def check_history(errors: list[str], check_freshness: bool = False) -> None:
    path = PUBLIC_DATA / "history.json"
    if not path.exists():
        return  # optional / accumulates over time
    h = _load("history.json")
    seen = set()
    last = ""
    points = h.get("points", [])
    if not points:
        errors.append("history: no points")
    for pt in points:
        d = pt.get("date", "")
        # Previously this checked key *presence* only, so a null or a pair that
        # summed to 400 merged in cleanly and rendered as a hole or a cliff in
        # the homepage chart.
        for k in ("projected_d", "projected_r", "actual_d", "actual_r"):
            v = pt.get(k)
            if not isinstance(v, int) or isinstance(v, bool) or v < 0:
                errors.append(f"history {d or '?'}: {k}={v!r} is not a non-negative integer")
        if all(isinstance(pt.get(k), int) for k in ("projected_d", "projected_r")):
            if pt["projected_d"] + pt["projected_r"] != TOTAL_SEATS:
                errors.append(
                    f"history {d or '?'}: projected {pt['projected_d']}+{pt['projected_r']} != {TOTAL_SEATS}"
                )
        if all(isinstance(pt.get(k), int) for k in ("actual_d", "actual_r")):
            if pt["actual_d"] + pt["actual_r"] != TOTAL_SEATS:
                errors.append(
                    f"history {d or '?'}: actual {pt['actual_d']}+{pt['actual_r']} != {TOTAL_SEATS}"
                )
        for method, seats in (pt.get("methods") or {}).items():
            dv, rv = seats.get("d"), seats.get("r")
            if not isinstance(dv, int) or not isinstance(rv, int) or dv + rv != TOTAL_SEATS:
                errors.append(f"history {d or '?'}: methods.{method} = {dv}/{rv} != {TOTAL_SEATS}")
        if not d:
            errors.append("history: point missing date")
            continue
        if d in seen:
            errors.append(f"history: duplicate date {d}")
        if d < last:
            errors.append(f"history: dates out of order at {d}")
        seen.add(d); last = d

    # The newest point should be today's. A builder that threw leaves the whole
    # file untouched, which every other check here would happily accept.
    if check_freshness and last:
        newest = _parse_ts(last + "T00:00:00+00:00")
        if newest is not None:
            age_days = (datetime.now(timezone.utc) - newest).days
            if age_days > 2:
                errors.append(f"history: newest point {last} is {age_days} days old (build failed?)")


def check_electoral_college(errors: list[str]) -> None:
    path = PUBLIC_DATA / "electoral_college.json"
    if not path.exists():
        return  # optional / built offline from committed baselines
    ec = _load("electoral_college.json")
    for year, c in ec.get("cycles", {}).items():
        total = c["total_ev"]
        # Per-state PR electors sum to the state's EV.
        for s in c["states"]:
            if sum(cand["electors"] for cand in s["candidates"]) != s["ev"]:
                errors.append(f"EC {year} {s['code']}: PR electors != ev {s['ev']}")
        # National actual + proportional both sum to the cycle total.
        if sum(c["actual"]["by_party"].values()) != total:
            errors.append(f"EC {year}: actual EV sum != {total}")
        if sum(c["proportional"]["by_party"].values()) != total:
            errors.append(f"EC {year}: PR EV sum != {total}")
        # No candidate can be flagged a majority winner unless they clear it.
        prop = c["proportional"]
        if prop["no_majority"] and prop["leader"]["electors"] >= c["majority"]:
            errors.append(f"EC {year}: no_majority set but leader has a majority")


def check_senate(errors: list[str]) -> None:
    path = PUBLIC_DATA / "senate.json"
    if not path.exists():
        return  # optional / built offline from committed baseline
    sen = _load("senate.json")
    states = sen.get("states", [])
    if len(states) != 50:
        errors.append(f"senate: {len(states)} states (expected 50)")
    if sum(s["senators"] for s in states) != sen["meta"]["total_senators"]:
        errors.append("senate: senators don't sum to total_senators")
    if sum(s["population"] for s in states) != sen["meta"]["total_population"]:
        errors.append("senate: state populations don't sum to total_population")
    for s in states:
        if s["population"] <= 0 or "representation_index" not in s:
            errors.append(f"senate {s.get('code')}: bad population / missing index")
    maj = sen.get("majority", {})
    if maj.get("senators", 0) < 51:
        errors.append("senate: majority block has < 51 senators")


def check_circuits(errors: list[str]) -> None:
    path = PUBLIC_DATA / "circuits.json"
    if not path.exists():
        return  # optional / built offline from committed baseline
    c = _load("circuits.json")
    total_pop = c["meta"]["total_population"]
    total_active = c["meta"]["total_active_judges"]
    total_senior = c["meta"]["total_senior_judges"]
    for grp in ("current", "rebalanced"):
        g = c[grp]
        if sum(r["population"] for r in g["circuits"]) != total_pop:
            errors.append(f"circuits {grp}: populations don't sum to total_population")
        if sum(r["active_judges"] for r in g["circuits"]) != total_active:
            errors.append(f"circuits {grp}: active judges don't sum to {total_active}")
        if sum(r["senior_judges"] for r in g["circuits"]) != total_senior:
            errors.append(f"circuits {grp}: senior judges don't sum to {total_senior}")
        states = [code for code in g["by_state"] if code not in ("DC", "PR")]
        if len(set(states)) != 50:
            errors.append(f"circuits {grp}: {len(set(states))} states assigned (expected 50)")
        for r in g["circuits"]:
            for code in r["states"]:
                if g["by_state"].get(code) != r["id"]:
                    errors.append(f"circuits {grp}: {code} not mapped to {r['id']}")


def main(check_freshness: bool = False) -> None:
    """Validate everything in public/data.

    `check_freshness` additionally asserts the data was generated just now. The
    pipeline passes it (it just wrote these files, so an old timestamp means a
    write silently didn't land); standalone runs and CI's last-good restore path
    do not, since those legitimately inspect older data.
    """
    errors: list[str] = []
    check_projection(errors)
    check_meta(errors, check_freshness)
    check_baseline_2024(errors)
    check_house_composition(errors)
    check_polling_trend(errors)
    check_polling_error(errors)
    check_retrospectives(errors)
    check_history(errors, check_freshness)
    check_electoral_college(errors)
    check_senate(errors)
    check_circuits(errors)
    if errors:
        print(f"DATA VALIDATION FAILED ({len(errors)} issue(s)):")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    print(
        "Data validation passed: projection + meta + baseline + composition + polling trend + "
        "retrospectives + history + EC + Senate + circuits invariants hold."
    )


if __name__ == "__main__":
    main(check_freshness="--check-freshness" in sys.argv)
