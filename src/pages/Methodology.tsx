import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SainteLagueDemo } from '../components/SainteLagueDemo';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { ROUTE_META } from '../lib/routeMeta';
import { fetchJson } from '../lib/fetchJson';
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
    ROUTE_META['/methodology'].title,
    ROUTE_META['/methodology'].description,
    ROUTE_META['/methodology'].canonicalPath,
  );

  const [pipelineMeta, setPipelineMeta] = useState<MetaJson | null>(null);

  useEffect(() => {
    fetchJson<MetaJson>('/data/meta.json').then(setPipelineMeta).catch(() => {});
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 lg:grid lg:grid-cols-[208px_minmax(0,1fr)] lg:gap-10">
      <MethodologyToc />
      <article className="min-w-0 max-w-3xl prose-stone text-stone-800 leading-relaxed">
      <h1 className="font-serif text-3xl sm:text-4xl font-medium text-brand-navy tracking-tight">Methodology</h1>
      <p className="mt-3 text-stone-600">
        What would the U.S. House look like if every state allocated its seats by proportional
        representation, based on current generic-ballot polling? This page walks through exactly
        how that projection is computed, what data feeds it, and what it does and doesn’t tell you.
      </p>

      <Section id="short-version" title="The short version">
        <ol className="list-decimal pl-6 space-y-2">
          <li>For each state, take its 2024 two-party House vote share as a baseline.</li>
          <li>Compute the current national generic-ballot polling margin from a weighted average of recent polls.</li>
          <li>The difference between today’s generic-ballot margin and 2024’s national House margin is the <em>swing</em>.</li>
          <li>Shift each state’s two-party shares by that swing, scaled by the state’s elasticity (how much the state moved between 2020 and 2024 vs. the nation as a whole).</li>
          <li>Allocate the state’s seats to the projected shares using Sainte-Laguë.</li>
        </ol>
      </Section>

      <Section id="data-sources" title="Data sources">
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>2024 House baseline.</strong>{' '}
            <a className="underline" href="https://history.house.gov/Institution/Election-Statistics/2024election/" target="_blank" rel="noreferrer">
              U.S. House Clerk, <em>Statistics of the Presidential and Congressional Election of November 5, 2024</em>
            </a>{' '}
            (published March 10, 2025). We parse the per-state recapitulation on page 86. National total:
            R {pipelineMeta?.baseline_2024_r_margin ? `+${pipelineMeta.baseline_2024_r_margin.toFixed(2)}` : '+2.55'} points.
          </li>
          <li id="retrospectives" className="scroll-mt-24">
            <strong>Prior-cycle retrospectives (2016–2022).</strong>{' '}
            <a className="underline" href="https://doi.org/10.7910/DVN/IG0UN2" target="_blank" rel="noreferrer">
              MIT Election Data and Science Lab, <em>U.S. House 1976–2024</em>
            </a>. For each cycle we sum the reported Democratic and Republican votes per state to a
            two-party share, take the winner of each district for the actual seat counts, and apply the
            same Sainte-Laguë allocation. Note: prior cycles use the <em>reported</em> statewide vote
            (uncontested districts included), not the per-district imputation the 2024 baseline uses —
            so states with many uncontested races are approximate. Where a major party fielded
            <em> no</em> statewide candidate (e.g. North Dakota 2022, where the only challenger ran as an
            independent), the retrospective allocates the actual votes as cast — the seat goes to the
            party that ran, with no 50/50 “what if it were contested” counterfactual. 2024 stays sourced
            from the Clerk (above) so it matches the Current view’s structural baseline.
          </li>
          <li>
            <strong>Generic-ballot polls.</strong>{' '}
            <a className="underline" href="https://www.natesilver.net/p/generic-ballot-average-2026-nate-silver-bulletin-congress-polls" target="_blank" rel="noreferrer">
              Silver Bulletin’s public poll database
            </a>{' '}
            (Nate Silver). The CSV ships pre-adjusted columns that account for pollster house effects, so
            our weighted average inherits that correction. We additionally weight polls by recency
            (14-day exponential half-life), √sample size, and population (LV {'>'} RV {'>'} A).
          </li>
        </ul>
      </Section>

      <Section id="the-math" title="The math, written out">
        <p>Each state’s 2024 two-party D share is computed from the Clerk’s recap as <code>d_share = D / (D + R)</code>. The national swing is</p>
        <pre className="bg-stone-100 rounded p-3 text-sm overflow-x-auto">{`swing = current_generic_ballot_margin − baseline_2024_national_margin`}</pre>
        <p>where both terms are in margin points (positive = D advantage). For example, today the generic ballot sits at roughly D+{pipelineMeta?.generic_ballot?.margin?.toFixed(1) ?? '6.0'} and 2024 was R+{pipelineMeta?.baseline_2024_r_margin?.toFixed(2) ?? '2.55'}, giving a swing of about +{pipelineMeta?.swing?.toFixed(1) ?? '8.6'} points toward D.</p>
        <p>States don’t all respond to a national swing equally. California swung ~9 points toward Republicans between 2020 and 2024 while Pennsylvania barely moved. We capture that with a per-state <em>elasticity</em> coefficient: each state’s D-margin shift between the 2020 and 2024 presidential elections, divided by the national average shift.</p>
        <pre className="bg-stone-100 rounded p-3 text-sm overflow-x-auto">{`state_swing  = national_swing × elasticity_state
projected_d_share = baseline_d_share + (state_swing / 2 / 100)
projected_r_share = baseline_r_share − (state_swing / 2 / 100)`}</pre>
        <p>For example, California’s elasticity is 1.70 (it moved 1.7× more than national), so today’s +8.9 national swing toward Democrats becomes a +15.1 swing in California; but California is already heavily D, so the marginal seats gained are small. Pennsylvania’s elasticity is 0.51, so the swing applied there is +4.5 points, more conservative, reflecting Pennsylvania’s reputation as a tight, hard-to-move state. Source: unweighted mean of CD-level Biden/Harris vs. Trump margins from <a className="underline" href="https://www.the-downballot.com/p/the-downballots-calculations-of-presidential" target="_blank" rel="noreferrer">The Downballot</a>. Elasticities are clamped to [0.3, 2.0] to handle states whose 2020→2024 pres swing was small or in the opposite direction (which would otherwise yield unstable or negative elasticity).</p>
        <p>The divide-by-2 in both formulas is because a swing of N points in the <em>margin</em> shifts each party’s share by N/2 points (D up by half, R down by half). Shares are clamped to [0.001, 0.999] so extreme sandbox values don’t break Sainte-Laguë.</p>
      </Section>

      <Section id="sainte-lague" title="Sainte-Laguë allocation (with an interactive demo)">
        <p>To assign N seats given D and R vote totals, the Sainte-Laguë method computes a series of quotients for each party (votes divided by 1, 3, 5, 7, …, 2N−1) and assigns seats to the N largest quotients across both parties.</p>
        <p>This method is the most proportional of the common divisor methods. D’Hondt slightly favors larger parties; Hamilton/largest-remainder is also proportional but has known paradoxes. For two-party races the three methods usually agree; we use Sainte-Laguë as the default.</p>
        <p>Try it yourself. The same function powers the projection.</p>
        <div className="not-prose mt-4">
          <SainteLagueDemo />
        </div>
      </Section>

      <Section id="sandbox-view" title="The Sandbox view: what-if scenarios">
        <p>
          Where the <Link to="/" className="underline hover:text-brand-navy">Current</Link>{' '}
          and <Link to="/retrospective" className="underline hover:text-brand-navy">Retrospective</Link>{' '}
          views each show one computed outcome, the <strong>Sandbox</strong> is the interactive
          calculator. You set assumptions, and every state’s projected delegation, the national
          totals, and the map all recompute on the fly. If you’d rather see a reform than build
          one, a row of one-click <strong>Quick scenarios</strong> (Two new parties, Mixed-member,
          Multi-member districts, Bigger House, Reset) sets several knobs at once. Four knobs are
          available:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>Hypothetical generic ballot</strong>: slide the national D-vs-R margin from
            R+15 to D+15. The base D-R toggle that’s always been in Sandbox.
          </li>
          <li>
            <strong>Minor parties</strong> (up to three): model a coalition split with a
            preset like Progressive Left or America First, or build a Custom party with your own
            name, color, and draw ratio. Covered in detail in the next subsection.
          </li>
          <li>
            <strong>Allocation method</strong>: toggle between Pure PR (Sainte-Laguë, D’Hondt, or
            Hamilton), multi-member districts, or mixed-member proportional. For MMD and MMP a
            slider then fine-tunes the district size and the single-member share. Covered below in
            “Allocation methods.”
          </li>
          <li>
            <strong>House size</strong>: keep today’s 435, jump to the Wyoming Rule (~573) or cube
            root (~692) preset, or set any size with the slider. Covered below in “House size.”
          </li>
        </ul>
        <p>
          A <strong>comparison table</strong> at the bottom of the Sandbox view shows national
          seat totals under every allocation method side-by-side, given your current settings,
          so you can compare reform models without flipping the picker. When you dial an MMD/MMP
          slider to a non-preset value, a labeled “current” row is inserted so your exact setting
          appears alongside the named reference points.
        </p>
        <p>
          Sandbox state is captured in the URL (e.g.{' '}
          <code>/sandbox?ballot=…&amp;minor1=…&amp;method=mmd-4&amp;house=wyoming</code>),
          so any scenario you set up is a sharable link.
        </p>

        <h3 className="font-serif text-lg text-brand-navy mt-6 mb-2">Minor-party scenarios</h3>
        <p>
          You can add up to three minor parties to the projection (up to five parties total)
          and watch how the map, national totals, and every state’s delegation recompute live.
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>Progressive Left</strong> (emerald): a Bernie/AOC-style breakaway from the
            Democratic coalition. Defaults: 6% national share, draws 85% from D / 15% from R.
          </li>
          <li>
            <strong>America First</strong> (mustard gold): a Trump/MAGA-style breakaway from the
            Republican coalition. Defaults: 8% national share, draws 15% from D / 85% from R.
          </li>
          <li>
            <strong>Custom</strong>: give it any name, any color, and any draw ratio. Use this
            slot to model a Green Party, a Libertarian Party, a Centrist / Forward / No Labels
            party, a regional party, or anything else.
          </li>
        </ul>
        <p>
          The two preset draw ratios are <em>defaults</em>, not constraints. Every minor party
          (preset or Custom) has a draw-bias slider you can adjust on the fly.
        </p>
        <p>
          A <strong>per-state threshold slider</strong> (0–10%, default 5%) sets the minimum vote
          share a party needs within a given state to win any seats. This matches how most real
          PR systems work (Germany’s 5%, New Zealand’s 5%) and prevents 1% parties from
          winning random seats in 50-seat states. Below the threshold, the party’s share is
          zeroed and the remaining parties renormalize.
        </p>
        <p>
          <strong>Map under Sandbox extended mode:</strong> each state fills with its plurality
          party’s color. If a major party (D or R) holds plurality but a minor still won at least
          one seat, the state gets diagonal stripes overlaying the major color, one stripe per
          minor with seats. Hover a state for the full per-party breakdown.
        </p>
        <p>
          <strong>Per-state share is uniform-national in v1.</strong> The share you set is applied
          to every state identically: a 6% Progressive Left means 6% of the two-party vote share
          is reassigned in California, Wyoming, and everywhere in between. Real third parties
          cluster regionally (Greens stronger in Vermont, Libertarians stronger in the mountain
          west), but modeling that would need per-state minor-party data we don’t currently
          collect. Listed below under limitations.
        </p>
        <p>
          The Sandbox extended mode is a client-side <em>what-if</em> tool. Everything outside the
          sandbox (the Current view, the 2024 Retrospective, the public API, share PNGs, and CSV
          / JSON downloads) stays strictly two-party.
        </p>
      </Section>

      <Section id="methods" title="Sandbox: allocation methods (MMD and MMP)">
        <p>
          Pure statewide proportional representation is the cleanest reform on the spectrum but
          rarely the most politically viable in a US context. The Sandbox lets you toggle between
          four allocation models so you can compare across that spectrum. The comparison table at
          the bottom of the Sandbox view shows national seat totals under every method
          side-by-side, given your current settings; handy for “which reform is most or least
          proportional?” questions without flipping the picker.
        </p>
        <p className="text-sm text-stone-600 italic">
          A naming-convention note: the number after MMD is the <em>district size in seats</em>{' '}
          (MMD-3 = 3-seat districts, MMD-5 = 5-seat districts). The number after MMP is the{' '}
          <em>percentage of seats that come from single-member districts</em> (MMP-50 = 50% SMD +
          50% list). Both numbers are adjustable in the Sandbox with a slider — district magnitude
          from 2 to 10 seats, single-member share from 10% to 90% — so MMD-3/MMD-5 and MMP-50 are
          just the named presets, not the only options.
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>Pure PR.</strong> Every state allocates its seats by total statewide vote
            share under Sainte-Laguë. The most proportional of the four; the implicit baseline of
            the rest of the site.
          </li>
          <li>
            <strong>Multi-member districts (MMD-3, MMD-5).</strong> Each state is chopped into
            smaller districts of <em>N seats</em> (the number in the method name), and PR runs
            within each district independently. Real-world precedent: Ireland uses 3–5 seat STV
            districts; the Illinois House was elected by 3-seat cumulative voting from 1870 to 1980.
            Smaller districts mean less proportionality: a 3-seat district can only meaningfully
            represent two parties (a third party needs ~25% of the district vote to win even one of
            three seats), and a 5-seat district lowers that threshold to roughly 17%.{' '}
            <strong>MMD-3</strong> therefore sits between today’s SMD and pure PR, and{' '}
            <strong>MMD-5</strong> sits closer to pure PR. A district-magnitude slider lets you
            sweep the size from 2 (close to today’s single-member map) up to 10 (close to statewide
            PR); MMD-3 and MMD-5 are the presets that show up most often in real proposals.
          </li>
          <li>
            <strong>Mixed-member proportional (MMP-50).</strong> The <strong>50</strong> is the
            percentage of seats that come from single-member districts. Half of each state’s seats
            come from today’s SMDs (we use the current actual delegation as the proxy for “who’d
            win the district seats”); the other half are <em>list seats</em>, allocated to top
            each party up to its proportional target. Used in Germany, New Zealand, Scotland, and
            Wales. Familiar to US voters because the local-district relationship survives: your
            congressperson is still elected from your district, with the list seats added on top
            for proportionality. A single-member-share slider (10%–90%) exposes the same model at
            any ratio — fewer district seats lets the list tier compensate further, so a lower
            share is more proportional; MMP-50 is the 50/50 preset most reform proposals use.
          </li>
        </ul>
        <p>
          <strong>Caveats for MMD:</strong> the v1 model assumes uniform partisan distribution
          across all districts within a state. That’s mathematically clean but underestimates
          proportionality in real-world heterogeneous states. California’s San Francisco districts
          (heavily D) and Central Valley districts (heavily R) would cancel out geographically in a
          way our uniform-share math doesn’t capture. A geographic MMD model using real
          congressional districts is on the roadmap.
        </p>
        <p>
          <strong>Caveats for MMP:</strong> when a state’s actual SMD delegation already
          over-represents one party past its proportional target (the “overhang” case under heavy
          gerrymandering), Germany would expand the legislature to compensate (“Ausgleichsmandate”).
          We keep total seats fixed at the chosen House size for cleanliness, which means MMP can leave a small
          residual distortion in extreme overhang states. Minors get zero SMD seats by default
          (they don’t exist in today’s actual House delegations), so their seats come entirely from
          the proportional list.
        </p>

        <h3 className="font-serif text-lg text-brand-navy mt-6 mb-2">
          PR formula variants: Sainte-Laguë, D’Hondt, Hamilton
        </h3>
        <p>
          “Pure PR” itself isn’t fully specified: three standard formulas turn vote shares into
          seat counts, and they differ subtly. The Sandbox method picker exposes all three so you
          can see how the formula choice nudges the outcome (typically by 1–3 seats per state).
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>Sainte-Laguë</strong> (our default). Each party’s vote total is divided by the
            sequence 1, 3, 5, 7, … (the arithmetic-mean divisors); seats go to the largest
            quotients. The <em>most neutral</em> of the three: it neither favors nor penalizes
            large parties. Used in Germany (state-list rounds), New Zealand, Sweden, Norway, and
            Denmark.
          </li>
          <li>
            <strong>D’Hondt</strong>. Divisors are 1, 2, 3, 4, … instead. The slightly smaller
            first divisor (2 vs. Sainte-Laguë’s 3) makes the first-quotient race fiercer, so
            larger parties win marginal seats more often. <em>Slightly favors larger parties.</em>{' '}
            Used in Spain, Portugal, Belgium, the Netherlands, and the European Parliament. A
            12-seat state at 55/45 might land 7-5 under Sainte-Laguë but 8-4 under D’Hondt: small
            but real.
          </li>
          <li>
            <strong>Hamilton / Largest Remainder</strong>. A quota method, not a divisor method:
            each party gets <code>floor(vote_share × total_seats)</code> seats, then leftover seats
            go to the parties with the largest fractional remainders. Genuinely proportional in the
            average case, but susceptible to the <strong>Alabama paradox</strong> (adding a seat to
            the legislature can <em>cost</em> a state seats) and the related population paradox.
            The US Congress used Hamilton for inter-state apportionment until 1880 produced bizarre
            results; Huntington-Hill replaced it for federal use in 1941. Still in use in some
            European systems (Russia, Albania) and many state-level US contexts.
          </li>
        </ul>
        <p className="text-sm text-stone-600">
          The Sandbox comparison table renders all three variants side-by-side in the
          PR / PR (D’Hondt) / PR (Hamilton) rows, so you can see exactly where they diverge under
          your current settings.
        </p>
      </Section>

      <Section id="house-size" title="House size: 435 isn’t a constitutional number">
        <p>
          The House has been frozen at <strong>435 seats since 1929</strong>. The number isn’t in
          the Constitution. The Permanent Apportionment Act of that year fixed it after the
          politically toxic 1920 census fight. In fact the House{' '}
          <em>skipped reapportionment entirely after the 1920 census</em>, the only time in US
          history, because urban-rural balance shifts threatened too many incumbents. Before 1929,
          the House grew with the population.
        </p>
        <p>
          <strong>Why expansion matters.</strong> A larger House means smaller districts, more
          competitive seats, a less extreme small-state bonus (Wyoming’s single seat representing
          ~578 K people becomes proportionally less over-representative), and more proportional
          outcomes under any allocation method. Many academic reformers argue district size is a
          bigger lever than the choice of allocation method. The Sandbox House-size slider lets you
          test that claim directly.
        </p>
        <p>
          Three presets:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>435</strong>: today’s House. Frozen for nearly a century.
          </li>
          <li>
            <strong>Wyoming Rule</strong> (≈ 573 today). Cap district population at the smallest
            state’s. With the 2020 census,{' '}
            <code>331 M / 578 K ≈ 573</code> seats. Modest expansion; sharply equalizes the
            “people per representative” ratio across states. Rep. Cohen’s <em>Equal Voice Act</em>{' '}
            (HR 2114) is the most recent legislative expression of this rule.
          </li>
          <li>
            <strong>Cube root rule</strong> (≈ 692 today). The size of a legislature scales roughly
            as the cube root of population, proposed by Taagepera and Shugart in{' '}
            <em>Seats and Votes</em> (1989) after surveying democracies worldwide. With the 2020
            census, <code>∛331 M ≈ 692</code> seats. Bigger expansion; brings the US in line with
            most peer democracies’ legislators-per-capita.
          </li>
        </ul>
        <p>
          <strong>How seats redistribute under expansion.</strong> The Sandbox uses{' '}
          <strong>Huntington-Hill</strong> (a.k.a. “Method of Equal Proportions”) to apportion the
          new total among states. This is <em>the same method the real US House has used since
          1941</em>, and most reform proposals keep it. The algorithm: every state with
          population &gt; 0 starts with 1 seat, then the remaining seats are assigned one at a time
          to whichever state has the highest “priority” of <code>population / √(n × (n+1))</code>,
          where <em>n</em> is its current seat count.
        </p>
        <p>
          <strong>Comparing to “today” when the House grows.</strong> A bigger House gives every
          party more seats in raw terms, so a naïve “projected minus today” difference would be
          dominated by the added seats rather than by proportional distortion — at 573 seats both
          parties gain seats, yet a raw subtraction would wrongly imply one of them lost ~90. To
          isolate the reform’s actual effect, every “vs. today” comparison (the national
          “Difference under PR” card, each state’s seat-gain line, and the Distortion map color)
          measures against today’s delegation <em>scaled to the chosen House size</em> — the same
          proportional scaling described below for MMP. Because that scaled baseline sums to the
          projected chamber size, the difference is exactly zero-sum (+N D ⇔ −N R) again, and reads
          as the genuine partisan shift. At 435 seats the scaling is the identity, so nothing
          changes there. When the House is expanded, the summary card notes the scaled baseline and
          each state panel labels its “Today, scaled to N” strip.
        </p>
        <p>
          <strong>MMP caveat under expansion.</strong> When the House grows, each state’s “actual
          today” SMD delegation needs to be scaled up to fill the new seat count, but we don’t
          know how the new districts would have voted. We scale proportionally to the state’s old
          partisan ratio (an 8-D / 4-R state expanded from 12 → 16 seats becomes 11-D / 5-R as the
          MMP starting point). This is an assumption; document it when citing MMP results under
          House expansion.
        </p>
        <p className="text-sm text-stone-600">
          The Sandbox “Actual today” row always stays at 435 seats (that’s the historical fact),
          while every reform row reflects your chosen House size.
        </p>
      </Section>

      <Section id="the-reveal" title="The reveal is more modest than you might expect">
        <p>
          Under today’s D+{pipelineMeta?.generic_ballot?.margin?.toFixed(0) ?? '6'} polling and the 2024 baseline, the projection comes out at{' '}
          {pipelineMeta?.national && (
            <strong>
              D {pipelineMeta.national.projected.d_seats} / R {pipelineMeta.national.projected.r_seats}
            </strong>
          )}
          {pipelineMeta?.national && (
            <>
              , enough to flip control from the current{' '}
              <strong>{pipelineMeta.national.actual.d_seats}D / {pipelineMeta.national.actual.r_seats}R</strong>{' '}
              House, but a smaller net shift than the “PR would help one side enormously” intuition suggests.
            </>
          )}
        </p>
        <p>
          The reason: distortion goes <em>both ways</em>. R-gerrymandered states (TX, FL, OH) over-represent
          Republicans; D-gerrymandered states (CA, NY, IL, MD) over-represent Democrats. Under PR, both
          effects shrink, and they largely cancel at the national level. What remains is mostly the
          national-mood swing (today, toward Democrats) translating into seats more directly than the current map allows.
        </p>
        <p>
          The 2024 Retrospective view (applying PR to actual 2024 results with no swing) confirms this:
          {pipelineMeta?.retrospective_national && (
            <>
              {' '}D {pipelineMeta.retrospective_national.projected_pr.d_seats} / R {pipelineMeta.retrospective_national.projected_pr.r_seats}
              {' '}vs. actual D {pipelineMeta.retrospective_national.actual.d_seats} / R {pipelineMeta.retrospective_national.actual.r_seats}.
            </>
          )}
          {' '}A small net swing in either direction is exactly what you’d expect from a roughly neutral national distortion.
        </p>
        <p>
          The interesting story is at the <em>state</em> level: nearly every state with more than ~5 seats has a significantly distorted delegation today. Click around the map to see for yourself, or jump straight to the{' '}
          <Link className="underline hover:text-brand-navy" to="/rankings#most-distorted-today">
            most distorted state delegations
          </Link>
          .
        </p>
      </Section>

      <Section id="limitations" title="Assumptions and limitations">
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>Single-cycle elasticity calibration.</strong> Per-state elasticities come from only one observation: the 2020→2024 presidential swing. That’s the first full post-redistricting cycle, so it’s the most representative single data point we have, but a single cycle is a small sample. Two real caveats follow from that. First, the model is linear: a state with elasticity 1.5 doesn’t stop at the 100/0 boundary in extreme sandbox values (the clamp catches that, but the projection still saturates). Second, an idiosyncratic state event (a popular incumbent, a sudden scandal, a regional issue) shows up as elasticity but isn’t really about national mood. We’re not separating those signals here.
          </li>
          <li>
            <strong>Uncontested races, imputed from presidential vote.</strong> Where a House district had no major-party opponent in 2024, the raw House totals don’t reflect partisan lean (one party gets ~100% of the two-party vote). The 2024 cycle had unusually few such races: VT-AL (Becca Balint, D), LA-4 (Mike Johnson, R), WA-4 (Dan Newhouse, R), and WA-9 (Adam Smith, D). For each, we replace the district’s House two-party total with its 2024 <em>presidential</em> two-party split (sourced from <a className="underline" href="https://www.the-downballot.com/p/the-downballots-calculations-of-presidential" target="_blank" rel="noreferrer">The Downballot</a>’s pres-by-CD calculations) so the state baseline reflects partisan lean rather than no-contest. One edge case is deferred: FL-20 (Sheila Cherfilus-McCormick, D) was re-elected without appearing on the ballot at all, so the Clerk PDF records no vote total to replace; imputing here would require estimating House turnout from outside data, which we’re not doing yet. Each state-detail panel labels how many of its districts were imputed.
          </li>
          <li>
            <strong>Pipeline, API, and exports are two-party only.</strong> The 2024 baseline and the polling-driven projection both use D-vs-R two-party share; third-party and write-in votes are excluded. Realistic for U.S. House today (third parties rarely clear single digits), and it keeps the public API contract stable. The <Link className="underline" to="/sandbox">Sandbox</Link> view lets you model up to three additional parties as a <em>what-if</em>; see the Sandbox section above for the draw-ratio model and the uniform-national-share limitation that comes with it.
          </li>
          <li>
            <strong>Sainte-Laguë is a choice.</strong> Most academic work on proportional representation favors it. Reasonable people can prefer D’Hondt (slightly larger-party-favoring) or Hamilton (largest-remainder, with known paradoxes). The interactive demo above lets you sanity-check edge cases.
          </li>
          <li>
            <strong>State-level polling is sparse.</strong> Most states have no recent House-specific polling at all; even the ~10 states with active Senate races get House polling rarely. Rather than weight state polls (mostly empty), we use the elasticity approach above: every state moves with the national tide, just at different multipliers calibrated from the 2020→2024 presidential shift. A state-poll overlay where data exists is a v3 possibility, not how the current projection works.
          </li>
        </ul>
      </Section>

      <Section id="api" title="API and data downloads">
        <p>
          The full projection is available as a public, versioned JSON API and as direct CSV/JSON
          downloads. The download buttons sit beside the share buttons in the national summary
          on the homepage; the API endpoints below serve the same data programmatically.
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <code>GET /api/v1/projection.json</code>: the full projection in a stable, documented
            shape. Returns <code>api_version</code>, <code>generated_at</code>, <code>polling</code>{' '}
            (window, half-life, n_polls, swing), <code>national</code> totals, and one entry per
            state with both seat counts and underlying vote shares.
          </li>
          <li>
            <code>GET /api/v1/projection.csv</code>: the same data flattened to one row per state,
            alphabetical by postal code. Column order is documented and stable: <code>code, name,
            fips, total_seats, actual_D, actual_R, projected_D, projected_R, swing,
            vote_share_2024_D, vote_share_2024_R, vote_share_projected_D, vote_share_projected_R</code>.
          </li>
        </ul>
        <p className="text-sm text-stone-600">
          <strong>Cache:</strong> 5 minutes at the edge and in the browser.{' '}
          <strong>CORS:</strong> any origin (read-only public data).{' '}
          <strong>Version:</strong> the v1 contract is stable; breaking changes will ship under
          <code> /api/v2/</code>. If you build something with it, a credit link to{' '}
          <a className="underline" href="https://proportionalhouse.org" target="_blank" rel="noreferrer">proportionalhouse.org</a>{' '}
          is appreciated.
        </p>
        <p className="text-sm text-stone-600">
          <strong>License:</strong> the projection data is released under{' '}
          <a className="underline" href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>{' '}
          — free to reuse with attribution. The site’s source code is{' '}
          <a className="underline" href="https://github.com/axelhufford/the-proportional-house/blob/main/LICENSE" target="_blank" rel="noreferrer">MIT-licensed</a>.{' '}
          Suggested citation: “The Proportional House (proportionalhouse.org), accessed [date].”
        </p>
      </Section>

      <Section id="embeds" title="Embeddable widgets">
        <p>
          Two iframe-ready views let you drop the projection into a story or post:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <code>/embed/national</code>: the headline map plus national totals. Optional URL params:{' '}
            <code>?view=current|retrospective|sandbox</code>,{' '}
            <code>?color=balance|distortion</code>,{' '}
            <code>?ballot=&lt;margin&gt;</code> (sandbox).
          </li>
          <li>
            <code>/embed/state/:code</code>: a single state’s card (replace <code>:code</code> with
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
          content reflows. The snippet listens for that message and resizes the iframe; no
          fixed-height guessing.
        </p>
      </Section>

      <Section id="neutrality" title="Why the math doesn’t favor one side">
        <p>
          The pipeline doesn’t look at partisan labels except to count votes. The same code runs whether
          the swing is toward D or toward R. If the generic ballot flipped to R+6, the projection would
          gain seats for Republicans in blue states by exactly the same mechanism that gains them for
          Democrats today.
        </p>
        <p>Source code: <a className="underline" href="https://github.com/axelhufford/the-proportional-house" target="_blank" rel="noreferrer">github.com/axelhufford/the-proportional-house</a>.</p>
      </Section>
      </article>
    </div>
  );
}

// Table-of-contents entries — keep in sync with the <Section id=…> values + order.
const SECTIONS: { id: string; label: string }[] = [
  { id: 'short-version', label: 'The short version' },
  { id: 'data-sources', label: 'Data sources' },
  { id: 'the-math', label: 'The math' },
  { id: 'sainte-lague', label: 'Sainte-Laguë' },
  { id: 'sandbox-view', label: 'The Sandbox' },
  { id: 'methods', label: 'Allocation methods' },
  { id: 'house-size', label: 'House size' },
  { id: 'the-reveal', label: 'How modest the change is' },
  { id: 'limitations', label: 'Assumptions & limits' },
  { id: 'api', label: 'API & downloads' },
  { id: 'embeds', label: 'Embeds' },
  { id: 'neutrality', label: 'Why it’s neutral' },
];

/**
 * Page table of contents. Sticky rail on lg+ (first column of the page grid);
 * a collapsible "On this page" on mobile. Links are in-page hashes; the global
 * ScrollManager smooth-scrolls to them and each Section has scroll-mt-24 to
 * clear the masthead.
 */
function MethodologyToc() {
  return (
    <div>
      <details className="lg:hidden mb-6 rounded-xl border border-stone-200 bg-white/70 px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold text-brand-navy">On this page</summary>
        <ul className="mt-2 space-y-1.5 text-sm">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="text-stone-600 hover:text-brand-navy transition-colors">
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </details>
      <nav aria-label="On this page" className="hidden lg:block">
        <div className="sticky top-24">
          <div className="text-xs uppercase tracking-wider text-stone-500 font-medium mb-2">On this page</div>
          <ul className="space-y-0.5 text-sm border-l border-stone-200">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="block -ml-px border-l border-transparent pl-3 py-1 text-stone-600 hover:text-brand-navy hover:border-brand-navy transition-colors"
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </nav>
    </div>
  );
}

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-8 scroll-mt-24">
      <h2 className="font-serif text-xl sm:text-2xl font-medium text-brand-navy tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}
