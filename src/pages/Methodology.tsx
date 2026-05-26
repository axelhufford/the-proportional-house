import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SainteLagueDemo } from '../components/SainteLagueDemo';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import type { ProjectionMeta } from '../lib/types';

interface MethodologyProps {
  // Kept for symmetry with the route definition; the page primarily reads its
  // own meta.json so it works on a deep-link refresh before Home has fetched.
  meta?: ProjectionMeta;
}

interface MetaJson {
  baseline_2024_r_margin?: number;
  swing?: number;
  generic_ballot?: { margin: number; n_polls: number; window_days: number };
  national?: { projected: { d_seats: number; r_seats: number }; actual: { d_seats: number; r_seats: number } };
  retrospective_national?: { projected_pr: { d_seats: number; r_seats: number }; actual: { d_seats: number; r_seats: number } };
}

export function Methodology(_props: MethodologyProps) {
  useDocumentTitle(
    'Methodology · The Proportional House',
    'How the projection works: data sources, Sainte-Laguë allocation, state elasticity, uncontested-race imputation, and limitations.',
    '/methodology',
  );

  const [pipelineMeta, setPipelineMeta] = useState<MetaJson | null>(null);

  useEffect(() => {
    fetch('/data/meta.json').then((r) => r.json()).then(setPipelineMeta).catch(() => {});
  }, []);

  return (
    <article className="max-w-3xl mx-auto px-6 py-8 prose-stone text-stone-800 leading-relaxed">
      <h1 className="font-serif text-3xl sm:text-4xl font-medium text-brand-navy tracking-tight">Methodology</h1>
      <p className="mt-3 text-stone-600">
        What would the U.S. House look like if every state allocated its seats by proportional
        representation, based on current generic-ballot polling? This page walks through exactly
        how that projection is computed, what data feeds it, and what it does and doesn't tell you.
      </p>

      <Section title="The short version">
        <ol className="list-decimal pl-6 space-y-2">
          <li>For each state, take its 2024 two-party House vote share as a baseline.</li>
          <li>Compute the current national generic-ballot polling margin from a weighted average of recent polls.</li>
          <li>The difference between today's generic-ballot margin and 2024's national House margin is the <em>swing</em>.</li>
          <li>Shift each state's two-party shares by that swing, scaled by the state's elasticity (how much the state moved between 2020 and 2024 vs the nation as a whole).</li>
          <li>Allocate the state's seats to the projected shares using Sainte-Laguë.</li>
        </ol>
      </Section>

      <Section title="Data sources">
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>2024 House baseline.</strong>{' '}
            <a className="underline" href="https://history.house.gov/Institution/Election-Statistics/2024election/" target="_blank" rel="noreferrer">
              U.S. House Clerk, <em>Statistics of the Presidential and Congressional Election of November 5, 2024</em>
            </a>{' '}
            (published March 10, 2025). We parse the per-state recapitulation on page 86. National total:
            R {pipelineMeta?.baseline_2024_r_margin ? `+${pipelineMeta.baseline_2024_r_margin.toFixed(2)}` : '+2.55'} points.
          </li>
          <li>
            <strong>Generic-ballot polls.</strong>{' '}
            <a className="underline" href="https://www.natesilver.net/p/generic-ballot-average-2026-nate-silver-bulletin-congress-polls" target="_blank" rel="noreferrer">
              Silver Bulletin's public poll database
            </a>{' '}
            (Nate Silver). The CSV ships pre-adjusted columns that account for pollster house effects, so
            our weighted average inherits that correction. We additionally weight polls by recency
            (14-day exponential half-life), √sample size, and population (LV {'>'} RV {'>'} A).
          </li>
        </ul>
      </Section>

      <Section title="The math, written out">
        <p>Each state's 2024 two-party D share is computed from the Clerk's recap as <code>d_share = D / (D + R)</code>. The national swing is</p>
        <pre className="bg-stone-100 rounded p-3 text-sm overflow-x-auto">{`swing = current_generic_ballot_margin − baseline_2024_national_margin`}</pre>
        <p>where both terms are in margin points (positive = D advantage). For example, today the generic ballot sits at roughly D+{pipelineMeta?.generic_ballot?.margin?.toFixed(1) ?? '6.0'} and 2024 was R+{pipelineMeta?.baseline_2024_r_margin?.toFixed(2) ?? '2.55'}, giving a swing of about +{pipelineMeta?.swing?.toFixed(1) ?? '8.6'} points toward D.</p>
        <p>States don't all respond to a national swing equally — California swung ~9 points toward Republicans between 2020 and 2024 while Pennsylvania barely moved. We capture that with a per-state <em>elasticity</em> coefficient: each state's D-margin shift between the 2020 and 2024 presidential elections, divided by the national average shift.</p>
        <pre className="bg-stone-100 rounded p-3 text-sm overflow-x-auto">{`state_swing  = national_swing × elasticity_state
projected_d_share = baseline_d_share + (state_swing / 2 / 100)
projected_r_share = baseline_r_share − (state_swing / 2 / 100)`}</pre>
        <p>For example, California's elasticity is 1.70 (it moved 1.7× more than national), so today's +8.9 national swing toward Democrats becomes a +15.1 swing in California — but California is already heavily D, so the marginal seats gained are small. Pennsylvania's elasticity is 0.51, so the swing applied there is +4.5 points — more conservative, reflecting Pennsylvania's reputation as a tight, hard-to-move state. Source: unweighted mean of CD-level Biden/Harris vs Trump margins from <a className="underline" href="https://www.the-downballot.com/p/the-downballots-calculations-of-presidential" target="_blank" rel="noreferrer">The Downballot</a>. Elasticities are clamped to [0.3, 2.0] to handle states whose 2020→2024 pres swing was small or in the opposite direction (would otherwise yield unstable or negative elasticity).</p>
        <p>The divide-by-2 in both formulas is because a swing of N points in the <em>margin</em> shifts each party's share by N/2 points (D up by half, R down by half). Shares are clamped to [0.001, 0.999] so extreme sandbox values don't break Sainte-Laguë.</p>
      </Section>

      <Section title="Sainte-Laguë allocation (with an interactive demo)">
        <p>To assign N seats given D and R vote totals, the Sainte-Laguë method computes a series of quotients for each party — votes divided by 1, 3, 5, 7, …, (2N−1) — and assigns seats to the N largest quotients across both parties.</p>
        <p>This method is the most proportional of the common divisor methods. D'Hondt slightly favors larger parties; Hamilton/largest-remainder is also proportional but has known paradoxes. For two-party races the three methods usually agree; we use Sainte-Laguë as the default.</p>
        <p>Try it yourself — the same function powers the projection.</p>
        <div className="not-prose mt-4">
          <SainteLagueDemo />
        </div>
      </Section>

      <Section title="Sandbox: third-party scenarios">
        <p>
          The Sandbox view lets you go beyond the strictly two-party projection. You can add
          up to three minor parties — so five total — and watch how the map, national totals,
          and every state's delegation recompute live.
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>Progressive Left</strong> (emerald) — a Bernie/AOC-style breakaway from the
            Democratic coalition. Defaults: 6% national share, draws 85% from D / 15% from R.
          </li>
          <li>
            <strong>America First</strong> (mustard gold) — a Trump/MAGA-style breakaway from the
            Republican coalition. Defaults: 8% national share, draws 15% from D / 85% from R.
          </li>
          <li>
            <strong>Custom</strong> — give it any name, any color, and any draw ratio. Use this
            slot to model a Green Party, a Libertarian Party, a Centrist / Forward / No Labels
            party, a regional party, or anything else.
          </li>
        </ul>
        <p>
          The two preset draw ratios are <em>defaults</em>, not constraints — every minor party
          (preset or Custom) has a draw-bias slider you can adjust on the fly.
        </p>
        <p>
          A <strong>per-state threshold slider</strong> (0–10%, default 5%) sets the minimum vote
          share a party needs within a given state to win any seats. This matches how most real
          PR systems work — Germany's 5%, New Zealand's 5% — and prevents 1% parties from
          winning random seats in 50-seat states. Below the threshold, the party's share is
          zeroed and the remaining parties renormalize.
        </p>
        <p>
          <strong>Map under Sandbox extended mode:</strong> each state fills with its plurality
          party's color. If a major party (D or R) holds plurality but a minor still won at least
          one seat, the state gets diagonal stripes overlaying the major color — one stripe per
          minor with seats. Hover a state for the full per-party breakdown.
        </p>
        <p>
          <strong>Per-state share is uniform-national in v1.</strong> The share you set is applied
          to every state identically — a 6% Progressive Left means 6% of the two-party vote share
          is reassigned in California, Wyoming, and everywhere in between. Real third parties
          cluster regionally (Greens stronger in Vermont, Libertarians stronger in the mountain
          west), but modeling that would need per-state minor-party data we don't currently
          collect. Listed below under limitations.
        </p>
        <p>
          The Sandbox extended mode is a client-side <em>what-if</em> tool. Everything outside the
          sandbox — the Current view, the 2024 Retrospective, the public API, share PNGs, and CSV
          / JSON downloads — stays strictly two-party.
        </p>
      </Section>

      <Section title="Allocation methods: MMD and MMP">
        <p>
          Pure statewide proportional representation is the cleanest reform on the spectrum but
          rarely the most politically viable. The Sandbox lets you toggle between four allocation
          models so you can compare across that spectrum — and a comparison table at the bottom
          of the Sandbox page shows national totals under every method side-by-side.
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>Pure PR.</strong> Every state allocates its seats by total statewide vote
            share under Sainte-Laguë. The most proportional of the four; the implicit baseline of
            the rest of the site.
          </li>
          <li>
            <strong>Multi-member districts (MMD).</strong> Each state is chopped into smaller
            districts of 3 or 5 seats, and PR runs within each district. Real-world precedent:
            Ireland uses 3–5 seat STV districts; Illinois House elected by 3-seat cumulative
            voting from 1870–1980. Smaller districts mean less proportionality (a 3-seat district
            can only meaningfully represent two parties), so MMD-3 sits between today's SMD and
            pure PR; MMD-5 sits closer to pure PR.
          </li>
          <li>
            <strong>Mixed-member proportional (MMP-50).</strong> Half of each state's seats come
            from today's single-member districts (we use the current actual delegation as the
            proxy for "who'd win the district seats"). The other half are list seats, allocated
            to top each party up to its proportional target. Used in Germany, New Zealand,
            Scotland, and Wales. Familiar to US voters because the local-district relationship
            survives.
          </li>
        </ul>
        <p>
          <strong>Caveats for MMD:</strong> the v1 model assumes uniform partisan distribution
          across all districts within a state. That's mathematically clean but underestimates
          proportionality in real-world heterogeneous states — California's San Francisco
          districts (heavily D) and Central Valley districts (heavily R) would cancel out
          geographically in a way our uniform-share math doesn't capture. A geographic MMD model
          using real congressional districts is on the roadmap.
        </p>
        <p>
          <strong>Caveats for MMP:</strong> when a state's actual SMD delegation already
          over-represents one party past its proportional target (the "overhang" case under heavy
          gerrymandering), Germany would expand the legislature to compensate ("Ausgleichsmandate").
          We keep total seats fixed at 435 for cleanliness, which means MMP can leave a small
          residual distortion in extreme overhang states. Minors get zero SMD seats by default
          (they don't exist in today's actual House delegations) — their seats come entirely from
          the proportional list.
        </p>
      </Section>

      <Section title="The reveal is more modest than you might expect">
        <p>
          Under today's D+{pipelineMeta?.generic_ballot?.margin?.toFixed(0) ?? '6'} polling and the 2024 baseline, the projection comes out at{' '}
          {pipelineMeta?.national && (
            <strong>
              D {pipelineMeta.national.projected.d_seats} / R {pipelineMeta.national.projected.r_seats}
            </strong>
          )}
          {pipelineMeta?.national && (
            <>
              {' '}— enough to flip control from the current{' '}
              <strong>{pipelineMeta.national.actual.d_seats}D / {pipelineMeta.national.actual.r_seats}R</strong>{' '}
              House, but a smaller net shift than the "PR would help one side enormously" intuition suggests.
            </>
          )}
        </p>
        <p>
          The reason: distortion goes <em>both ways</em>. R-gerrymandered states (TX, FL, OH) over-represent
          Republicans; D-gerrymandered states (CA, NY, IL, MD) over-represent Democrats. Under PR, both
          effects shrink, and they largely cancel at the national level — what remains is mostly the
          national-mood swing (today, toward Democrats) translating into seats more directly than the current map allows.
        </p>
        <p>
          The 2024 Retrospective view (applying PR to actual 2024 results with no swing) confirms this:
          {pipelineMeta?.retrospective_national && (
            <>
              {' '}D {pipelineMeta.retrospective_national.projected_pr.d_seats} / R {pipelineMeta.retrospective_national.projected_pr.r_seats}
              {' '}vs actual D {pipelineMeta.retrospective_national.actual.d_seats} / R {pipelineMeta.retrospective_national.actual.r_seats}.
            </>
          )}
          {' '}A small net swing in either direction is exactly what you'd expect from a roughly neutral national distortion.
        </p>
        <p>
          The interesting story is at the <em>state</em> level: nearly every state with more than ~5 seats has a significantly distorted delegation today. Click around the map to see for yourself — or jump straight to the{' '}
          <Link className="underline hover:text-brand-navy" to="/rankings#most-distorted-today">
            most distorted state delegations
          </Link>
          .
        </p>
      </Section>

      <Section title="Assumptions and limitations">
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>Single-cycle elasticity calibration.</strong> Per-state elasticities come from only one observation: the 2020→2024 presidential swing. That's the first full post-redistricting cycle, so it's the most representative single data point we have, but a single cycle is a small sample. Two real caveats follow from that. First, the model is linear: a state with elasticity 1.5 doesn't stop at the 100/0 boundary in extreme sandbox values (the clamp catches that, but the projection still saturates). Second, an idiosyncratic state event — a popular incumbent, a sudden scandal, a regional issue — shows up as elasticity but isn't really about national mood. We're not separating those signals here.
          </li>
          <li>
            <strong>Uncontested races, imputed from presidential vote.</strong> Where a House district had no major-party opponent in 2024, the raw House totals don't reflect partisan lean (one party gets ~100% of the two-party vote). The 2024 cycle had unusually few such races: VT-AL (Becca Balint, D), LA-4 (Mike Johnson, R), WA-4 (Dan Newhouse, R), and WA-9 (Adam Smith, D). For each, we replace the district's House two-party total with its 2024 <em>presidential</em> two-party split (sourced from <a className="underline" href="https://www.the-downballot.com/p/the-downballots-calculations-of-presidential" target="_blank" rel="noreferrer">The Downballot</a>'s pres-by-CD calculations) so the state baseline reflects partisan lean rather than no-contest. One edge case is deferred: FL-20 (Sheila Cherfilus-McCormick, D) was re-elected without appearing on the ballot at all, so the Clerk PDF records no vote total to replace — imputing here would require estimating House turnout from outside data, which we're not doing yet. Each state-detail panel labels how many of its districts were imputed.
          </li>
          <li>
            <strong>Pipeline, API, and exports are two-party only.</strong> The 2024 baseline and the polling-driven projection both use D-vs-R two-party share; third-party and write-in votes are excluded. Realistic for U.S. House today (third parties rarely clear single digits), and it keeps the public API contract stable. The <Link className="underline" to="/?view=sandbox">Sandbox</Link> view lets you model up to three additional parties as a <em>what-if</em> — see the Sandbox section above for the draw-ratio model and the uniform-national-share limitation that comes with it.
          </li>
          <li>
            <strong>Sainte-Laguë is a choice.</strong> Most academic work on proportional representation favors it. Reasonable people can prefer D'Hondt (slightly larger-party-favoring) or Hamilton (largest-remainder, with known paradoxes). The interactive demo above lets you sanity-check edge cases.
          </li>
          <li>
            <strong>State-level polling is sparse.</strong> Most states have no recent House-specific polling at all; even the ~10 states with active Senate races get House polling rarely. Rather than weight state polls (mostly empty), we use the elasticity approach above — every state moves with the national tide, just at different multipliers calibrated from the 2020→2024 presidential shift. A state-poll overlay where data exists is a v3 possibility, not how the current projection works.
          </li>
        </ul>
      </Section>

      <Section title="API and data downloads">
        <p>
          The full projection is available as a public, versioned JSON API and as direct CSV/JSON
          downloads. The download buttons sit beside the share buttons in the national summary
          on the homepage; the API endpoints below serve the same data programmatically.
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <code>GET /api/v1/projection.json</code> — the full projection in a stable, documented
            shape. Returns <code>api_version</code>, <code>generated_at</code>, <code>polling</code>{' '}
            (window, half-life, n_polls, swing), <code>national</code> totals, and one entry per
            state with both seat counts and underlying vote shares.
          </li>
          <li>
            <code>GET /api/v1/projection.csv</code> — the same data flattened to one row per state,
            alphabetical by postal code. Column order is documented and stable: <code>code, name,
            fips, total_seats, actual_D, actual_R, projected_D, projected_R, swing,
            vote_share_2024_D, vote_share_2024_R, vote_share_projected_D, vote_share_projected_R</code>.
          </li>
        </ul>
        <p className="text-sm text-stone-600">
          <strong>Cache:</strong> 5 minutes at the edge and in the browser.{' '}
          <strong>CORS:</strong> any origin (read-only public data).{' '}
          <strong>Version:</strong> the v1 contract is stable — breaking changes will ship under
          <code> /api/v2/</code>. If you build something with it, a credit link to{' '}
          <a className="underline" href="https://proportionalhouse.org" target="_blank" rel="noreferrer">proportionalhouse.org</a>{' '}
          is appreciated.
        </p>
      </Section>

      <Section title="Embeddable widgets">
        <p>
          Two iframe-ready views let you drop the projection into a story or post:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <code>/embed/national</code> — the headline map + national totals. Optional URL params:{' '}
            <code>?view=current|retrospective|sandbox</code>,{' '}
            <code>?color=balance|distortion</code>,{' '}
            <code>?ballot=&lt;margin&gt;</code> (sandbox).
          </li>
          <li>
            <code>/embed/state/:code</code> — a single state's card (replace <code>:code</code> with
            the two-letter postal abbreviation, e.g. <code>CA</code>).
          </li>
        </ul>
        <p>Minimal host snippet:</p>
        <pre className="bg-stone-100 rounded p-3 text-xs overflow-x-auto">{`<iframe
  src="https://proportionalhouse.org/embed/national"
  style="width:100%; border:0;"
  title="The Proportional House"
  loading="lazy"
></iframe>
<script>
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'proportional-house:resize') {
      const f = document.querySelector('iframe[src*="proportionalhouse.org/embed"]');
      if (f) f.style.height = e.data.height + 'px';
    }
  });
</script>`}</pre>
        <p className="text-sm text-stone-600">
          The embed posts its content height to the parent window on mount and whenever the
          content reflows. The snippet listens for that message and resizes the iframe — no
          fixed-height guessing.
        </p>
      </Section>

      <Section title="Why the math doesn't favor one side">
        <p>
          The pipeline doesn't look at partisan labels except to count votes. The same code runs whether
          the swing is toward D or toward R. If the generic ballot flipped to R+6, the projection would
          gain seats for Republicans in blue states by exactly the same mechanism that gains them for
          Democrats today.
        </p>
        <p>Source code: <a className="underline" href="https://github.com/axelhufford/the-proportional-house" target="_blank" rel="noreferrer">github.com/axelhufford/the-proportional-house</a>.</p>
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-serif text-xl sm:text-2xl font-medium text-brand-navy tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}
