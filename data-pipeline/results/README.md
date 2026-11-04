# Election results and the election-week runbook

The site moves through three phases around an election (`data-pipeline/election.json`):

| Phase | When | What `/` shows |
|---|---|---|
| `projection` | until `freeze_at` (2026-11-03 10:00 UTC = 5 AM ET) | the daily projection, as always |
| `counting` | from `freeze_at` until all 50 states are certified | the final projection (frozen), then provisional results once any state has votes |
| `results` | all 50 certified, or `phase_override` | certified results + "How the final projection compares" |

The flip at `freeze_at` needs no deploy: the page and `/api/v1` check the clock.
After it, the pipeline fetches no polls; it republishes the projection published
just before the freeze, byte for byte (`freeze.py`; its sha256 is in
`meta.election.final_projection`).

## The results file

`house_2026.csv` here is the only results input the pipeline trusts. One row per
state; the rules are in `data-pipeline/results_file.py`. In short:

- `pending`: nothing counted. Called seats are allowed (uncontested races), votes aren't.
- `provisional`: votes counted so far + `source_url` + `as_of` with a timezone.
  `d_seats`/`r_seats`/`other_seats` are races **called**; the rest are uncalled.
- `certified`: every seat called, `source_url` = the state's certification.
- `reporting_pct` is optional, and needs `reporting_source` (whose estimate).

Committed as all-pending until election night. Never put numbers in it that
didn't come from a source you can link.

## Tools

```bash
# Vote totals: AP's count as published by NBC News (all 435 districts, one
# request), summed by state → data-pipeline/results/drafts/ (gitignored) + diff
.venv/bin/python data-pipeline/scrape_results_nbc.py
# Copy every state whose totals changed (votes, AP reporting estimate,
# uncontested-race count, source, as_of; never seats, never certified rows)
.venv/bin/python data-pipeline/scrape_results_nbc.py --apply ALL
# Fallback/cross-check: draft from Wikipedia infoboxes (lags hours behind the count)
.venv/bin/python data-pipeline/scrape_results_draft.py
# Copy vote totals for named states into the curated file (never certifies; seats
# only from finished articles; certified rows are left alone)
.venv/bin/python data-pipeline/scrape_results_draft.py --apply CA,TX
# Validate before committing
.venv/bin/python data-pipeline/build_results.py --check
# What would be frozen / capture the frozen projection
.venv/bin/python data-pipeline/freeze.py --check
.venv/bin/python data-pipeline/freeze.py --capture
```

Wikipedia seat numbers are **not** used mid-count (articles pre-fill last cycle's
seats); race calls come from news desks via `race_calls_2026.csv` (below). Fill vote gaps for big
states from state election offices (put that URL in `source_url`).

## Automatic election-night updates (2026)

Scheduled tasks in the Claude desktop app (on the owner's Mac) run this loop
unattended — hourly 8 PM–3 AM ET on election night, then every 3 hours 8 AM–11 PM
Nov 4–6 — and publish without review:

1. **Vote totals:** `scrape_results_nbc.py --apply ALL` (AP's count via NBC News).
   Wikipedia was the source until the morning of Nov 4, when it still had no totals
   for 49 states; switching states between sources can trip the guard's
   "votes fell" rule, so stay on one source.
2. **Race calls:** search for calls by AP, Decision Desk HQ, NBC, CNN, ABC, CBS
   or Fox News (any one is enough) for districts not yet in
   `race_calls_2026.csv`; append a row per call (desk, time, link to the call),
   then `python data-pipeline/race_calls.py --apply` to set each state's called
   seats. The validator rejects malformed, pre-election, unsourced or Wikipedia-
   sourced calls, and any edit to a committed call (append-only).
3. **Guard:** `python data-pipeline/results_guard.py` compares the results file
   with the last commit and reverts any state whose change looks wrong (votes
   fell, implausible turnout, a big swing on few new votes, stale timestamp,
   called seats going down, any certification). Reverted states keep their
   published numbers and are reported.
4. `build_results.py --check`, commit both files, push, verify the deploy.

Retracting a call and certifying a state stay manual (`race_calls.py
--allow-edits` for a retraction). To stop the automation, disable the
`election-results-*` tasks in the app's Scheduled section.

## Race calls file

`race_calls_2026.csv`: one row per called district — `district` (PA-07, WY-AL;
2026 lines), `party` (D/R/O), `winner`, `caller` (AP, DDHQ, NBC, CNN, ABC, CBS,
Fox), `called_at` (ISO with timezone), `source_url` (https, not Wikipedia),
`note`. `race_calls.py --apply` derives each state's `d_seats`/`r_seats`/
`other_seats` in house_2026.csv from it (certified states untouched).

## Rehearsal (never deployed)

Any `PH_*` override marks output `rehearsal: true`, shows a red banner, writes
the frozen record to gitignored `.rehearsal/`, and fails validation in CI.

```bash
PH_FREEZE_AT=$(date -u -v-1M +%FT%TZ) .venv/bin/python data-pipeline/update.py        # freeze now
PH_FREEZE_AT=… PH_RESULTS_CSV=tests/fixtures/results_2026_synthetic_election_night.csv …  # mid-count
PH_FREEZE_AT=… PH_PHASE=results PH_RESULTS_CSV=tests/fixtures/results_2026_synthetic_certified.csv …
PH_FAIL_BUILDER=generate_state_og .venv/bin/python data-pipeline/update.py              # expect exit 3
```

Do rehearsals in a copy of the repo, not the working tree: the pipeline rewrites
`public/`. The synthetic fixtures are 2024 votes relabeled; keep them off any
public URL, preview deploys included.

## Election week (ET; EST = UTC−5 from Nov 1)

GitHub runs the nightly "06:00 UTC" job late: through October 2026 it started
between about 5 and 9:30 AM ET. So Tuesday's scheduled run will almost certainly
start after the 5 AM freeze, and the last scheduled pre-election run is Monday
morning's. A manual run Monday evening makes the final projection include
Monday's polls, and covers a failed morning run (without one, nothing is
published in the 30 hours before the freeze and the freeze step errors).

- **Sun Nov 1** — code freeze. Check `/api/v1/projection.json` shows
  `"phase": "projection"` and `election.freeze_at`.
- **Mon Nov 2, 9–11 PM** — run the workflow by hand (starts right away, ~2 min):
  `gh workflow run update-data.yml --ref main`. When it finishes,
  `.venv/bin/python data-pipeline/freeze.py --check` must end with
  `→ final projection: production, generated …` and a Monday-evening timestamp.
  If it says "no projection published", run the workflow again and recheck.
  Any run that finishes later but before 5 AM becomes the final projection
  instead (still a real published one) — rerun `--check` if you push again.
- **Tue Nov 3**
  - 5:00 AM: freeze; site and API flip on their own. The scheduled run and the
    one-off "5:10 AM" rebuild start whenever GitHub gets to them (likely hours
    late); until one finishes, only the share image, search snippet, state pages
    and llms.txt still have pre-election wording.
  - Morning: `curl -s https://proportionalhouse.org/api/v1/projection.json | jq '{phase,generated_at,election}'`
    (phase `counting`, generated_at = Monday evening's run); `freeze.py --capture`, commit
    `data-pipeline/frozen/2026/`, push (this run also refreshes the static outputs).
    Social engine: `snapshot.py` should exit 0 without storing.
  - Evening loop (~10 PM, ~12:30 AM, morning): `git pull --rebase` → scrape draft → edit CSV
    → `build_results.py --check` → commit ("Results update: N states, M seats called, as of HH:MM ET")
    → push → check the site a few minutes later (a run takes ~1.5 min plus the deploy).
    Batch edits: CI queues only one pending run.
- **Nov 4–6** — twice a day. **Nov 7 → mid-Dec** — every 1–3 days; flip states to
  `certified` with the certification as the source (California ≈ Dec 11). At 50/50
  the phase becomes `results` by itself.
- **Jan 4, 2027** — `house_composition.json` should show `meta.congress == 120`.
  A failing changeover is a degraded run (exit 3), not an outage.

Never write the CI skip token in a commit message (see the workflow's note).

## After certification (not built yet)

0. Unpin the workflow's `runs-on: ubuntu-24.04` back to `ubuntu-latest` (pinned for the election).
1. `house_2026.json` from the certified CSV (independent/other seats supported), then
   `KNOWN_ACTUAL["2026"]`, then 2026 in `RETRO_CYCLES` (keep 2016).
2. Only then the 2026 row in `polling_error.json` (validation opens `house_{year}.json`).
3. Cross-check against the Clerk's statistics PDF (~March 2027).
4. Before any 2028 projection: move the 2026 history into its own file, then roll the
   baseline and publish cycle-neutral field names under `/api/v2/`.
