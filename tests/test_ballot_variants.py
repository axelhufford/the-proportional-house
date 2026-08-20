"""Tests for the generic-ballot average variants (fetch_polls + update.py).

Run from repo root: pytest tests/test_ballot_variants.py

Covers the two properties the toggle depends on: the likely-voter variant is a
pure *filter* over the same average (never a shift), and a variant too thin to
defend is omitted rather than published. Polls are synthesized here so the
tests don't depend on what Silver Bulletin's live CSV happens to contain today.
"""

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "data-pipeline"))

from fetch_polls import Poll, weighted_average  # noqa: E402
from update import BALLOT_VARIANTS, build_ballot_variant  # noqa: E402

BASELINE = REPO_ROOT / "data-pipeline" / "baseline" / "house_2024.json"
with BASELINE.open() as f:
    BASELINE_STATES = json.load(f)["states"]

BASELINE_D_MARGIN = -2.511
NOW = datetime(2026, 8, 20, tzinfo=timezone.utc)
TOTAL_SEATS = 435


def make_poll(days_ago: float, population: str, margin: float, sample_size: int = 1000) -> Poll:
    """A poll `days_ago` old with the given D−R margin, on both raw and adjusted."""
    mid = NOW - timedelta(days=days_ago)
    dem = 50.0 + margin / 2
    rep = 50.0 - margin / 2
    return Poll(
        pollster="Test Pollster",
        sponsors="",
        start_date=mid,
        end_date=mid,
        sample_size=sample_size,
        population=population,
        dem=dem,
        rep=rep,
        adjusted_dem=dem,
        adjusted_rep=rep,
        url="",
    )


# LV polls run 4 points more D than the RV polls, so a filter and a mishandled
# weighting are easy to tell apart in the assertions below.
MIXED_POLLS = (
    [make_poll(d, "LV", 10.0) for d in (1, 3, 5, 7)]
    + [make_poll(d, "RV", 6.0) for d in (2, 4, 6, 8)]
    + [make_poll(d, "A", 2.0) for d in (2, 6)]
)


def variant_spec(variant_id: str) -> dict:
    return next(v for v in BALLOT_VARIANTS if v["id"] == variant_id)


class TestPopulationFilter:
    def test_lv_filter_includes_only_lv_polls(self) -> None:
        avg = weighted_average(MIXED_POLLS, as_of=NOW, populations={"LV"})
        assert avg["n_polls"] == 4
        assert {p["population"] for p in avg["polls"]} == {"LV"}
        assert avg["populations"] == ["LV"]

    def test_lv_filter_is_a_filter_not_a_shift(self) -> None:
        """Every LV poll here is D+10, so the LV-only average must be exactly
        D+10 — a variant that added an adjustment on top would miss it."""
        avg = weighted_average(MIXED_POLLS, as_of=NOW, populations={"LV"})
        assert avg["margin"] == pytest.approx(10.0, abs=1e-6)

    def test_unfiltered_average_still_sees_every_poll(self) -> None:
        avg = weighted_average(MIXED_POLLS, as_of=NOW)
        assert avg["n_polls"] == len(MIXED_POLLS)
        assert avg["populations"] is None
        # Between the RV floor and the LV ceiling, and pulled below the plain
        # mean of the two by the A polls and the RV/A population weights.
        assert 6.0 < avg["margin"] < 10.0

    def test_filter_composes_with_the_recency_window(self) -> None:
        """An LV poll outside the 30-day window is dropped by the window, not
        rescued by the population filter."""
        polls = [make_poll(2, "LV", 10.0), make_poll(45, "LV", -20.0)]
        avg = weighted_average(polls, as_of=NOW, populations={"LV"})
        assert avg["n_polls"] == 1
        assert avg["margin"] == pytest.approx(10.0, abs=1e-6)

    def test_empty_result_still_reports_its_shape(self) -> None:
        avg = weighted_average(MIXED_POLLS, as_of=NOW, populations={"NOPE"})
        assert avg["n_polls"] == 0
        assert avg["polls"] == []
        assert avg["window_days"] > 0 and avg["half_life_days"] > 0


class TestBuildBallotVariant:
    def build(self, spec: dict, polls: list[Poll]):
        return build_ballot_variant(
            spec, polls, NOW, BASELINE_STATES, BASELINE_D_MARGIN, polling_error=None,
        )

    def test_thin_variant_is_omitted_entirely(self) -> None:
        """Below min_polls the variant is None — not a null-filled placeholder,
        and not a number computed from two polls."""
        spec = variant_spec("lv")
        assert spec["min_polls"] >= 3
        thin = [make_poll(1, "LV", 10.0), make_poll(3, "LV", 10.0)]
        variant, avg, states = self.build(spec, thin)
        assert variant is None
        assert states is None
        assert avg["n_polls"] == 2  # the average was computed, just not published

    def test_variant_at_the_floor_is_published(self) -> None:
        spec = variant_spec("lv")
        at_floor = [make_poll(d, "LV", 10.0) for d in range(spec["min_polls"])]
        variant, _avg, states = self.build(spec, at_floor)
        assert variant is not None and states is not None
        assert variant["n_polls"] == spec["min_polls"]

    def test_standard_variant_is_ungated(self) -> None:
        """The standard average keeps its pre-toggle behavior: always published,
        so the site never loses its headline projection to a new gate."""
        assert variant_spec("standard")["min_polls"] == 0

    def test_variant_carries_its_own_swing_and_projection(self) -> None:
        variant, _avg, states = self.build(variant_spec("lv"), MIXED_POLLS)
        assert variant is not None
        assert variant["margin"] == pytest.approx(10.0, abs=1e-6)
        assert variant["swing"] == pytest.approx(10.0 - BASELINE_D_MARGIN, abs=0.011)
        d, r = variant["projected"]["d_seats"], variant["projected"]["r_seats"]
        assert d + r == TOTAL_SEATS
        assert d == sum(s["projected"]["d_seats"] for s in states)

    def test_variants_at_different_margins_get_different_analytics(self) -> None:
        """The whole reason analytics ride on the variant: a more D-friendly
        ballot must move the seat count and the closest-flip thresholds."""
        lv, _, _ = self.build(variant_spec("lv"), MIXED_POLLS)
        std, _, _ = self.build(variant_spec("standard"), MIXED_POLLS)
        assert lv is not None and std is not None
        assert lv["margin"] > std["margin"]
        assert lv["projected"]["d_seats"] >= std["projected"]["d_seats"]
        assert lv["closest_flips"] != std["closest_flips"]
        for flip in lv["closest_flips"]:
            sign = 1.0 if flip["direction"] == "D" else -1.0
            expected = round(lv["margin"] + sign * flip["margin_delta"], 1)
            assert flip["flips_at_margin"] == pytest.approx(expected, abs=0.051)

    def test_optional_blocks_are_absent_not_null(self) -> None:
        """Matches the top-level omission contract the TS types rely on."""
        variant, _avg, _states = self.build(variant_spec("lv"), MIXED_POLLS)
        assert variant is not None
        assert "uncertainty" not in variant  # polling_error=None above
        for key, value in variant.items():
            assert value is not None or key == "populations"


class TestPublishedVariants:
    """Invariants on what the pipeline actually wrote to public/data."""

    payload = json.loads((REPO_ROOT / "public" / "data" / "projection.json").read_text())
    variants = payload["meta"].get("ballot_variants")

    def test_variants_are_published(self) -> None:
        assert self.variants, "pipeline published no ballot_variants"

    def test_standard_leads_and_mirrors_the_top_level(self) -> None:
        meta = self.payload["meta"]
        std = self.variants[0]
        assert std["id"] == "standard"
        assert std["margin"] == meta["generic_ballot_margin"]
        assert std["n_polls"] == meta["n_polls_in_average"]
        assert std["projected"] == {
            "d_seats": self.payload["national"]["projected"]["d_seats"],
            "r_seats": self.payload["national"]["projected"]["r_seats"],
        }

    def test_every_variant_is_self_consistent(self) -> None:
        baseline_d_margin = self.payload["meta"]["baseline_2024_margin"]
        for v in self.variants:
            assert v["n_polls"] >= 1, f"{v['id']} published with no polls"
            assert v["label"] and v["note"], f"{v['id']} missing user-facing copy"
            assert v["swing"] == pytest.approx(v["margin"] - baseline_d_margin, abs=0.011)
            assert v["projected"]["d_seats"] + v["projected"]["r_seats"] == TOTAL_SEATS

    def test_ids_are_unique(self) -> None:
        ids = [v["id"] for v in self.variants]
        assert len(set(ids)) == len(ids)
