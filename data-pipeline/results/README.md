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
# Draft from Wikipedia infoboxes → data-pipeline/results/drafts/ (gitignored) + diff
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
seats); enter race calls by hand from news desks' calls. Fill vote gaps for big
states from state election offices (put that URL in `source_url`).

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

- **Sun Nov 1** — code freeze. Check `/api/v1/projection.json` shows
  `"phase": "projection"` and `election.freeze_at`.
- **Mon Nov 2, evening** — `freeze.py --check` should pick production's projection.
- **Tue Nov 3**
  - ~1:10 AM: last scheduled projection run.
  - 5:00 AM: freeze; site and API flip on their own. 5:10 AM: one-off cron rebuilds static outputs.
  - By ~9 AM: `curl -s https://proportionalhouse.org/api/v1/projection.json | jq '{phase,generated_at,election}'`
    (phase `counting`, generated_at ≈ Nov 3 06:xx UTC); `freeze.py --capture`, commit
    `data-pipeline/frozen/2026/`, push. Social engine: `snapshot.py` should exit 0 without storing.
  - Evening loop (~10 PM, ~12:30 AM, morning): `git pull --rebase` → scrape draft → edit CSV
    → `build_results.py --check` → commit ("Results update: N states, M seats called, as of HH:MM ET")
    → push → check the site ~8 min later. Batch edits: CI queues only one pending run.
- **Nov 4–6** — twice a day. **Nov 7 → mid-Dec** — every 1–3 days; flip states to
  `certified` with the certification as the source (California ≈ Dec 11). At 50/50
  the phase becomes `results` by itself.
- **Jan 4, 2027** — `house_composition.json` should show `meta.congress == 120`.
  A failing changeover is a degraded run (exit 3), not an outage.

Never write the CI skip token in a commit message (see the workflow's note).

## After certification (not built yet)

1. `house_2026.json` from the certified CSV (independent/other seats supported), then
   `KNOWN_ACTUAL["2026"]`, then 2026 in `RETRO_CYCLES` (keep 2016).
2. Only then the 2026 row in `polling_error.json` (validation opens `house_{year}.json`).
3. Cross-check against the Clerk's statistics PDF (~March 2027).
4. Before any 2028 projection: move the 2026 history into its own file, then roll the
   baseline and publish cycle-neutral field names under `/api/v2/`.
