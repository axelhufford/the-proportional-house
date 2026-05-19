# The Proportional House — Project Plan

A web app that projects what the U.S. House of Representatives would look like if every state allocated its congressional seats by proportional representation, based on current generic-ballot polling.

**Project name:** The Proportional House
**Working domain options:** `theproportionalhouse.com`, `theproportionalhouse.org`, `theproportionalhouse.us` — check availability before committing.

This document is the spec. It's written to be handed to Claude Code as the source of truth for the build. Phases below are sized for one Claude Code session each.

---

## 1. Concept

The U.S. House is winner-take-all by single-member district. Combined with redistricting, this produces delegations that often look nothing like the statewide vote — Texas votes ~55% R / 45% D and gets a delegation that's ~70% R; New York votes ~55% D / 45% R and gets a delegation that's ~70% D.

This app shows what the House would look like if every state allocated its seats proportionally to the statewide two-party vote share, based on **current generic-ballot polling**. The reveal isn't a one-way ratchet toward either party — under 2024 baselines the national totals come out close to neutral because D-gerrymandered states like CA/NY/IL lose D seats while R-gerrymandered states like TX/FL/OH lose R seats. The interesting story is the *state-level* shifts: nearly every state with more than ~5 seats is meaningfully distorted today, in one direction or the other.

Three view modes:
- **Current Projection** (default): Apply today's generic-ballot polling to 2024 state baselines, allocate proportionally.
- **2024 Retrospective**: Apply proportional allocation to actual 2024 House popular vote. Shows the pure distortion of the current system, with no projection involved.
- **Sandbox**: A slider for national generic ballot from R+15 to D+15. Map recomputes in real time.

---

## 2. Core Methodology

This is the most important section. The math determines everything else.

### Step 1: Baseline (static)

For each state, compute the total House votes cast for Democratic candidates and Republican candidates in 2024, summed across all districts. Source: Daily Kos Elections' 2024 House results spreadsheet, or FEC official results.

For each state, store:
- `seats_2024`: number of House seats
- `d_votes_2024`, `r_votes_2024`: total two-party vote
- `d_share_2024`, `r_share_2024`: two-party shares

National 2024 House two-party popular vote: pin to a single source (FEC final tally or Daily Kos Elections final) and record the exact number with citation in `baseline/house_2024.json`. Different sources put it anywhere from ~R+2.8 to ~R+3.6 depending on whether uncontested races, third parties, and late-counted CA/NY ballots are included. This number is the pivot point for every swing calc — a 1-point error biases every projection by ~3–5 seats. Surface the chosen number and source on the methodology page.

**Note on uncontested races**: Some 2024 House districts had no major-party opponent. Florida had 8 uncontested R seats; New York had several uncontested D seats; Texas, Louisiana, Alabama had partial uncontested slates. The two-party share computed from those states is not the state's actual two-party preference — it's the share among contested districts only. Applying uniform swing to that distorted baseline produces visibly wrong state-level results.

**V1 decision: impute uncontested races.** Use that district's 2024 presidential vote share, scaled by a typical down-ballot dropoff (~3–5 points toward the in-party). Daily Kos Elections publishes presidential-by-CD data for this purpose. This is roughly one afternoon of pipeline work and is worth doing up front — the credibility of state-level numbers is the whole product. (The original "accept and document" v1 path is preserved here as a fallback if the imputation pipeline slips, in which case the affected states need a prominent baseline-distortion warning on their detail panels, not just on the methodology page.)

### Step 2: Current National Mood

Pull the full generic-ballot poll database from Silver Bulletin's free public Google Sheets CSV:

```
https://docs.google.com/spreadsheets/d/e/2PACX-1vRsvXNCZ0ubJr8D_yNcU5q6C0_HBa35K7oDK03KpO7Ca43UwdXaIdvVLWoXEmHHph0EREz5430Hm5yZ/pub?output=csv
```

This is Nate Silver's curated database of every generic ballot poll, free to download (the model itself is paywalled; the raw data is not). It's linked from his free landing page at <https://www.natesilver.net/p/generic-ballot-average-2026-nate-silver-bulletin-congress-polls>. The CSV includes pollster name, dates, sample size, population (LV/RV/A), and D/R percentages.

Loading is one line: `df = pd.read_csv(URL)`.

Filter to polls from the last 30 days. Compute a weighted average of the margin (D% − R%), weighted by:

- **Recency**: exponential decay, half-life ~14 days from poll midpoint.
- **Sample size**: `sqrt(sample_size)` so a 3,000-respondent poll counts roughly 1.7× a 1,000-respondent poll.
- **Population**: likely voters > registered voters > adults. Use a multiplier (e.g., LV=1.0, RV=0.85, A=0.7).

Result: `current_generic_ballot_margin` (positive = D advantage). Store the underlying poll list too, since we'll display it in the methodology page and the state detail panel.

**Cross-check (optional, recommended)**: scrape Ballotpedia's headline generic-ballot number from <https://ballotpedia.org/Ballotpedia's_Polling_Index:_Generic_congressional_vote> and log a warning if our computed average diverges from it by more than 2 points. Ballotpedia is a 17-year-old nonprofit with stable infrastructure and is the best independent sanity check.

### Step 3: Compute Swing

```
swing = current_generic_ballot_margin - baseline_2024_national_margin
```

Where `baseline_2024_national_margin` is the chosen-and-cited number from Step 1 (negative for R lead). If current generic ballot is D+5.7 and 2024 was R+2.6, swing = 8.3 points toward Democrats. This is the number we apply to every state's baseline.

**Units (audit checklist).** `current_generic_ballot_margin` and `swing` are in margin points (D% minus R%, e.g., +5.7). State vote shares are stored as fractions in [0,1] (0.513, not 51.3). All math below assumes the baseline is already two-party-normalized.

### Step 4: Apply Swing to Each State

**V1: Uniform swing.** Every state shifts by the full swing amount.

```python
projected_d_share = baseline_d_share + (swing / 2 / 100)
projected_r_share = baseline_r_share - (swing / 2 / 100)
```

(Divide by 2 because a swing of N points in the margin = N/2 points shift in each party's share.)

Clamp to [0.001, 0.999] (not [0, 1]) so the sandbox extremes don't produce a pure-shutout share that Sainte-Laguë can't divide.

**V2: Elasticity-weighted swing.** Each state has an elasticity coefficient indicating how much it moves with the national environment. Wisconsin and Michigan are elastic (move a lot); Massachusetts and Wyoming are inelastic (don't move much). Multiply uniform swing by state elasticity. Source: compute from historical House results (regress state margin on national margin), or use Silver Bulletin's published values if accessible.

**Regime-break note for elasticity regression.** A naive 5–10 cycle fit crosses the 2022 redistricting boundary; state responsiveness to national mood changed materially in states that redistricted (NC, NY, OH, etc.). Weight post-2022 cycles more heavily, or fit elasticity only on 2022+ once 2026 results land. Don't trust a flat 10-cycle regression.

### Step 5: Allocate Seats

**Default method: Sainte-Laguë (Webster).**

For a state with N seats, generate quotients:
- D's quotients: `d_votes / 1`, `d_votes / 3`, `d_votes / 5`, ..., `d_votes / (2N-1)`
- R's quotients: same with `r_votes`

Sort all 2N quotients descending. Top N quotients win seats. Count how many of those N belong to each party.

Sainte-Laguë is the most proportional of the common divisor methods. D'Hondt slightly favors larger parties. Hamilton/largest-remainder is also proportional but has known paradoxes. The differences between methods are small in two-party races but visible in larger delegations — e.g., in a 10-seat state at 55/45, D'Hondt typically gives 6-4 while Sainte-Laguë can give 5-5 depending on exact shares. In small delegations (≤5 seats) the two methods almost always agree.

Provide a toggle in the methodology section for the curious. Default to Sainte-Laguë everywhere else.

### Step 6: Edge Cases

- **1-seat states** (currently AK, DE, ND, SD, VT, WY): winner-take-all of statewide vote. No proportional allocation possible. Display "1-0" or "0-1" with a note.
- **2-seat states** (currently HI, ID, ME, MS, MT, NH, NM, NV, RI, WV — verify against current apportionment): only 0-2, 1-1, 2-0 possible. Use Sainte-Laguë as normal; it will naturally produce these.
- **Tied vote in a 2-seat state**: split 1-1.
- **Third parties**: V1 collapses to two-party share. V2 could include third parties that clear a threshold (e.g., 5% statewide), but this is rarely relevant for U.S. House.
- **Sandbox extreme values**: clamp shares to [0.001, 0.999] so the slider can't break the math (a true 0 share is not divisible under Sainte-Laguë).

---

## 3. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend framework | React + TypeScript + Vite | Static site, fast dev, no SSR needed |
| Styling | Tailwind CSS | Standard, fast iteration |
| Map | D3 + TopoJSON | Full control over Albers projection, AK/HI insets, mode transitions. Use `d3.geoAlbersUsa` — handles AK/HI insets automatically — and `us-atlas` from npm for the TopoJSON. |
| Charts | Recharts | Polling trend line, lightweight |
| Data pipeline | Python + pandas | Standard for this kind of work |
| Pipeline scheduler | GitHub Actions (cron nightly) | Free, integrated with deploy |
| Hosting | Cloudflare Pages | Free, fast, auto-deploys on commit |

Static site at heart. Data is pre-computed nightly and committed to the repo as JSON. The client just loads JSON and renders. No backend, no API costs.

---

## 4. Data Pipeline

Nightly GitHub Action (`.github/workflows/update-data.yml`) runs `data-pipeline/update.py`:

1. Fetch Silver Bulletin's public CSV: `pd.read_csv(SILVER_BULLETIN_URL)` (URL in Step 2 of Methodology).
2. Compute our own weighted polling average (recency × sample-size × population). We compute it ourselves rather than scraping someone else's number because (a) the headline averages from Silver Bulletin and other aggregators are paywalled or scrape-fragile, and (b) computing it ourselves means the methodology page can show exactly what's in the average.
3. Optionally: scrape Ballotpedia's headline number as a cross-check. Log a warning if our average diverges by >2 points.
4. Load static `baseline/house_2024.json` (state-level 2024 results, manually curated once).
5. Compute national swing.
6. For each state: apply swing → compute projected D% and R% → run Sainte-Laguë allocation.
7. Write output files:
   - `public/data/projection.json`
   - `public/data/polling_trend.json` (last 180 days of polls for the sandbox chart, derived from the same CSV)
   - `public/data/baseline_2024.json` (for the Retrospective mode)
   - `public/data/meta.json` (last-updated timestamp, generic ballot used, polls included, cross-check result)
8. **Deploy via artifact, not commit.** Have the GitHub Action build the full site (Vite build with the freshly generated JSONs in `public/data/`) and deploy directly to Cloudflare Pages via `wrangler pages deploy`. Don't commit generated JSONs back to the repo — over a year that's 365+ data-only commits drowning out real changes. The repo stays clean; data lives only in the deployed bundle.
9. Email on failure (via GitHub Actions failure notification).

### Backup plan if Silver Bulletin's CSV disappears

The CSV is a Google Sheets publish-to-web link, which is one of the most durable URL formats on the internet, and Nate Silver advertises it from his free landing page — strong commercial reasons to keep it up. But if it ever breaks:

- **Fallback 1**: scrape Ballotpedia's polling index page. They publish their headline average and list constituent polls. Ballotpedia is a 17-year-old 501(c)(3) nonprofit and is the most stable institution among the polling aggregators.
- **Fallback 2**: scrape Decision Desk HQ's free generic-ballot aggregate at `polls.decisiondeskhq.com/averages/generic-ballot/national/lv-rv-adults`.
- **Fallback 3**: manually curate polls from a fixed list of pollsters (Marist, YouGov/Economist, Quinnipiac, Morning Consult, etc.) by reading their own sites. Tedious but completely independent.

Implement the GitHub Action with a try/except chain so that if the primary source fails, the pipeline tries fallback 1 automatically and surfaces a warning in `meta.json` (which the frontend can render as a banner). **Before relying on the scraping fallbacks**, do a one-time ToS check for Ballotpedia and DDHQ (likely fine for low-volume nightly fetches, but worth confirming — if either disallows scraping, the chain collapses to "manual pollster list" and that's weaker than the plan implies).

---

## 5. Feature Spec

### Map (main view)

- U.S. choropleth, Albers USA projection with AK/HI insets.
- Color encoding (user toggleable):
  - **Mode A — Delegation Balance**: D margin of seat allocation, deep blue → red.
  - **Mode B — Distortion**: PR allocation minus actual current delegation, per state. Highlights states where the current system most distorts the vote.
- Hover: tooltip with state name, seats, projected D-R split, projected vote share.
- Click: opens state detail panel.

### Header / National Summary

- Big number: projected House under PR (e.g., **D 230 / R 205**).
- Side number: actual current House for comparison.
- "Difference under PR: +X D / -X R."
- Generic ballot used: "D+5.7 (as of May 13)."
- View-mode toggle: **Current Projection · 2024 Retrospective · Sandbox**.

### State Detail Panel

When a user clicks a state:
- State name, total House seats.
- **Actual current delegation** vs. **Projected under PR** (visual: two stacked bars, or two delegation strips with D/R icons).
- Baseline 2024 vote share.
- Swing applied (national; if elasticity is enabled, state-specific).
- Projected 2026 vote share.
- Sainte-Laguë allocation table (collapsible "show the math" section listing the quotients for the nerdy).
- Polling trend chart: national generic ballot over last 180 days. (State-level House polls are rare outside competitive Senate states, so don't promise a state-level chart — link out to state polls if any exist, otherwise just show national.)

### Sandbox Mode

- Slider: national generic ballot from R+15 to D+15, in 0.1 increments.
- Map and all numbers update in real time.
- Allocation runs client-side in TypeScript (port of the Python logic).
- "What does the map look like at a tie?" preset buttons (R+5, Tie, D+5, D+10) for quick exploration.

### 2024 Retrospective Mode

- Same UI, but uses actual 2024 vote shares (no swing applied).
- Side-by-side toggle to show: "Actual 2024 House" vs. "If 2024 had used PR."
- This mode is the clearest demonstration of the system's distortion since there's no modeling involved.

### Methodology Page

Dedicated route. Plain-language explanation. Math written out. Assumptions listed. Limitations stated honestly (uniform swing is approximate; state-level polling is sparse; uncontested races distort baselines; PR allocation method is a choice). Link to GitHub repo.

---

## 6. Repo Structure

```
the-proportional-house/
├── .github/
│   └── workflows/
│       └── update-data.yml          # nightly cron
├── data-pipeline/
│   ├── update.py                    # main entry point
│   ├── allocation.py                # Sainte-Laguë, D'Hondt, Hamilton
│   ├── fetch_polls.py               # Silver Bulletin CSV fetcher + fallbacks
│   ├── requirements.txt
│   └── baseline/
│       └── house_2024.json          # one-time curated
├── public/
│   └── data/
│       ├── projection.json          # auto-generated
│       ├── polling_trend.json       # auto-generated
│       ├── baseline_2024.json       # auto-generated (copy)
│       ├── meta.json                # auto-generated
│       └── states.topojson          # static
├── src/
│   ├── components/
│   │   ├── Map.tsx
│   │   ├── StateDetail.tsx
│   │   ├── NationalSummary.tsx
│   │   ├── Sandbox.tsx
│   │   ├── ModeToggle.tsx
│   │   └── PollingTrendChart.tsx
│   ├── lib/
│   │   ├── allocation.ts            # mirror of Python logic for sandbox
│   │   ├── swing.ts
│   │   └── formatting.ts
│   ├── pages/
│   │   ├── Home.tsx
│   │   └── Methodology.tsx
│   ├── App.tsx
│   └── main.tsx
├── tests/
│   ├── allocation.test.ts           # parity with Python
│   └── allocation.test.py
├── index.html
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── vite.config.ts
└── README.md
```

**Important**: allocation logic lives in both Python (pipeline) and TypeScript (sandbox). Maintain a shared test fixture (`tests/fixtures/allocation_cases.json`) and run it against both implementations to ensure parity. Include every real-world state at several swing values in the fixture, not just synthetic edge cases — that's what catches subtle floating-point divergences (e.g., Python banker's rounding vs JS) on data that actually ships.

---

## 7. Build Phases

Each phase is sized for roughly one Claude Code session.

### Phase 1 — Foundation + Allocation Logic
- Scaffold Vite + React + TS + Tailwind. Pick a license (MIT or Apache 2.0; permissive fits the "show your work" ethos) and commit it.
- Render U.S. map with D3 + TopoJSON, `d3.geoAlbersUsa` (AK/HI insets are automatic), `us-atlas` for the TopoJSON.
- Implement Sainte-Laguë in both Python (`allocation.py`) and TypeScript (`allocation.ts`). Add D'Hondt and Hamilton for completeness.
- Write shared test fixtures in JSON (`tests/fixtures/allocation_cases.json`) — include every real-world state at several swing values, not just synthetic edge cases. Run from both languages, assert identical output. Cover 1-seat states, 2-seat states, ties, extreme vote shares.
- Hard-coded mock `projection.json` with realistic placeholder values to drive the UI.
- Hover tooltips, click-to-open state detail panel scaffold.
- Header with mock national totals.
- **Done when**: parity tests pass in both languages; clicking any state opens a side panel with mock data; map colors render correctly.

### Phase 2 — Data Pipeline
- Curate `baseline/house_2024.json` once: per-state 2024 two-party vote totals from FEC or Daily Kos (cite source), plus the **chosen national margin number** (Methodology Step 1 pivot).
- **Impute uncontested races** using Daily Kos's presidential-by-CD data scaled by typical down-ballot dropoff (~3–5 points). If this slips, fall back to "accept and warn" with state-level distortion banners.
- Build `fetch_polls.py` — one-liner to load Silver Bulletin's public CSV via `pd.read_csv()`. Optionally add Ballotpedia scrape as cross-check.
- Build `update.py` end-to-end: fetch → average → swing → allocate → write JSONs.
- Run locally, verify outputs look right.
- **Done when**: `python update.py` produces real `projection.json` matching reasonable expectations: (a) given a D+6 environment with 2024 R+2.6 baseline (swing ~+8.6 D), Dems net gain roughly **+10 to +15 seats** vs actual House under uniform swing + Sainte-Laguë; (b) the 2024 Retrospective mode shows a small net swing (single digits in either direction). If retrospective shows ≥15-seat swing, the math is wrong.

  **Note on the projection number being smaller than first guessed.** An earlier draft estimated +25–35 D seats. Real data is smaller because blue states with D-favoring gerrymanders (CA, NY, IL, MD) actually *lose* D seats under PR, partially offsetting gains in R-gerrymandered states (TX, FL, OH). The aggregate distortion under the current map is approximately net-neutral in 2024 — the interesting story is the *state-level* shifts, not the national total. The methodology page should make this explicit so visitors don't expect a one-way ratchet toward D.

### Phase 3 — Wire Up Real Data + Methodology Page
- Frontend loads real JSONs.
- State detail panel renders real numbers, including Sainte-Laguë quotient breakdown.
- Build methodology page with full prose explanation. Include an interactive Sainte-Laguë demo (small widget: enter D votes / R votes / N seats, see the quotient table and resulting allocation — reuses the TS allocation function from Phase 1).
- Add "last updated" footer pulling from `meta.json`; add a "stale data" banner if `meta.json` is >48h old.
- **Done when**: the live local site shows accurate, current projections.

### Phase 4 — GitHub Action + Deploy
- Write `.github/workflows/update-data.yml` (cron daily at, say, 6am UTC).
- Action runs Python pipeline, builds the Vite site with the fresh data, deploys directly to Cloudflare Pages via `wrangler pages deploy` (no commits back to the repo).
- Connect repo to Cloudflare Pages.
- Test the action manually with `workflow_dispatch`.
- Confirm Ballotpedia/DDHQ ToS allow the fallback scrapes before going live.
- **Done when**: site is live at a real URL, auto-updates nightly.

### Phase 5 — Sandbox + Retrospective
- Sandbox slider with client-side recomputation (memoize per-state allocation by `(state_id, projected_d_share rounded to 0.001)` if continuous drag feels laggy; otherwise leave it alone).
- 2024 Retrospective mode toggle.
- **Done when**: all three view modes work with real data.

### Phase 6 — Polish
- Polling trend chart on state detail panel (national; state-level only if polls exist).
- Animation between modes (D3 transitions on map colors).
- **Accessibility pass**: keyboard nav on states, ARIA labels mirroring tooltip content, tabular fallback for the map, sufficient color contrast.
- **Color palette pass**: use a distinct hue pair for the Distortion view (e.g., purple ↔ orange) so it doesn't visually duplicate the Delegation Balance view; ensure colorblind-friendly (ColorBrewer RdBu or similar).
- **Mobile layout**: design sketch first — map shrinks to top half, scrollable state list below replaces the side panel, tap either to update the other.
- Copy editing on methodology page.
- **Done when**: site looks polished, fully accessible, mobile usable.

### Phase 7 — Optional V2 (later)
- Elasticity-weighted swing (mind the 2022 redistricting regime break — see Methodology Step 4)
- Pollster house-effect correction in the polling average (estimate each pollster's deviation from the overall average and adjust)
- State-level polling overlay where available
- Embed widget version (`/embed/state/TX` iframe)
- "Historical PR" mode (apply PR to past elections)
- Social share images per state

---

## 8. Open Decisions

- **2024 national popular-vote margin source** (resolve in Phase 2): FEC final tally vs Daily Kos Elections final. Pick one, cite it, record the exact number in `baseline/house_2024.json`.
- **Domain registration**: check `theproportionalhouse.com`, `.org`, and `.us` availability. `.org` is the natural fit for a public-good visualization project; `.us` is a nice patriotic touch and likely available; `.com` may be squatted. Don't block on this — defer until ~80% through Phase 3.
- **Color palette**: standard red/blue is expected but feels stale. Design pass should produce two distinct diverging palettes (one for Delegation Balance, one for Distortion) and confirm CB-friendliness.
- **Elasticity values for V2**: compute from historical data ourselves (post-2022 cycles only — see regime-break note in Methodology Step 4), or seek permission to use published values from Silver Bulletin / Split Ticket.

---

## 9. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Silver Bulletin CSV disappears | Fallback chain in the pipeline: Ballotpedia scrape → DDHQ scrape → manual pollster list. Pipeline tries fallbacks automatically and logs warning. |
| Pipeline breaks silently | GitHub Action emails on failure; add a "stale data" banner on the site if `meta.json` is more than 48 hours old. |
| Methodology criticism | Methodology page is exhaustive and honest. Code is open source. Show your work. |
| Bias accusations | The model is mechanical and reproducible. The math doesn't choose sides. Make this point explicitly on the methodology page. |
| Uncontested races distorting baselines | Impute in v1 using Daily Kos presidential-by-CD data scaled by ~3–5 point down-ballot dropoff. If imputation slips, fall back to per-state distortion banners on detail panels (not just methodology page). |
| 2024 national margin number is wrong | Cite a single source in `baseline/house_2024.json`; surface on methodology page. A 1-point error biases every projection by ~3–5 seats. |
| Python ↔ TypeScript allocation drift | Shared JSON fixture covering every state at multiple swing values, run from both languages in CI. |
| Allocation method debates | Sainte-Laguë is the academic default for proportionality. Toggle is available for the curious. |

---

## Deploy setup (one-time, for Phase 4)

The pipeline ships via [.github/workflows/update-data.yml](.github/workflows/update-data.yml), which runs daily at 06:00 UTC and on `workflow_dispatch`. It executes the Python pipeline, builds the Vite site against the freshly-generated JSONs in `public/data/`, and uploads the `dist/` artifact to Cloudflare Pages with `wrangler pages deploy`. Nothing is committed back to the repo — the deployed bundle is the source of truth for the live data.

**One-time setup the workflow needs:**

1. **Cloudflare Pages project.** In the Cloudflare dashboard, create a Pages project named exactly `the-proportional-house` using **Direct Upload** mode (do not connect a Git provider — the GitHub Action handles deploys). On first run, `wrangler` will pick this project by name.
2. **Cloudflare API token.** In Cloudflare → My Profile → API Tokens, create a token with the `Cloudflare Pages: Edit` permission for your account. Copy the token.
3. **Cloudflare account ID.** Visible in the right sidebar of any Cloudflare dashboard page.
4. **GitHub repo secrets.** In the repo's Settings → Secrets and variables → Actions, add:
   - `CLOUDFLARE_API_TOKEN` — the token from step 2.
   - `CLOUDFLARE_ACCOUNT_ID` — the account ID from step 3.
5. **First run.** Trigger via Actions → "Update data + deploy" → Run workflow. The first successful run publishes to `the-proportional-house.pages.dev`.

**Deploying manually.** Use `npm run deploy` — never `wrangler pages deploy dist` directly. The combined script runs `pipeline → build → wrangler deploy` in sequence so the bundle being shipped contains the same fresh data the nightly Action would have shipped. Running `wrangler pages deploy dist` on its own will publish whatever stale `public/data/*.json` happens to be on your laptop (often days old from your last local pipeline run), and Cloudflare Pages will promote that deploy to the friendly `the-proportional-house.pages.dev` alias — silently overwriting the fresh data the nightly Action just published. If you only want to push *code* changes without re-running the pipeline, push to GitHub and trigger the workflow manually via the Actions tab (`Run workflow`) — that's the cheapest correct path.

**Open TODO** (per the review note in Section 4): confirm Ballotpedia and Decision Desk HQ's robots.txt / ToS allow our nightly fallback scrapes before we wire those fetchers in. Until that's done the pipeline relies solely on the Silver Bulletin CSV.

---

## 10. Stretch Ideas (not for v1)

- Per-state historical view: "Texas under PR, 2010–2024."
- Senate version using state pop. (less interesting since Senate isn't seat-allocated)
- International comparison: "U.S. House under German MMP" or "U.K.-style FPTP applied to U.S."
- Newsletter subscription that emails subscribers when the projection shifts by more than X seats.
- API for journalists / researchers.

---

## Quick Reference for Claude Code

When starting a session, begin by reading:
1. This file (`PROJECT_PLAN.md`)
2. Section 2 (Methodology) — the math is the contract.
3. The current phase's "Done when" criterion.

When in doubt, prefer:
- Static over dynamic (no backend, no runtime fetches except sandbox slider).
- Transparent over clever (methodology is the product as much as the map is).
- Honest defaults over hidden choices (every assumption surfaces in the UI or the methodology page).
