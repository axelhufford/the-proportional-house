import { useEffect, useState } from 'react';
import { SainteLagueDemo } from '../components/SainteLagueDemo';
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
  const [pipelineMeta, setPipelineMeta] = useState<MetaJson | null>(null);

  useEffect(() => {
    fetch('/data/meta.json').then((r) => r.json()).then(setPipelineMeta).catch(() => {});
  }, []);

  return (
    <article className="max-w-3xl mx-auto px-6 py-8 prose-stone text-stone-800 leading-relaxed">
      <h1 className="font-serif text-3xl sm:text-4xl font-medium text-brand-navy tracking-tight">Methodology</h1>
      <p className="mt-3 text-stone-600">
        The Proportional House is a counterfactual: what would the U.S. House of Representatives look
        like if every state allocated its seats by proportional representation, based on current
        generic-ballot polling? This page explains exactly how that number is computed, what data
        feeds it, and what it does and doesn't tell you.
      </p>

      <Section title="The short version">
        <ol className="list-decimal pl-6 space-y-2">
          <li>For each state, take its 2024 two-party House vote share as a baseline.</li>
          <li>Compute the current national generic-ballot polling margin from a weighted average of recent polls.</li>
          <li>The difference between today's generic-ballot margin and 2024's national House margin is the <em>swing</em>.</li>
          <li>Shift each state's two-party shares by that swing (uniform swing assumption).</li>
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
        <p>Each state's projected D share is</p>
        <pre className="bg-stone-100 rounded p-3 text-sm overflow-x-auto">{`projected_d_share = baseline_d_share + (swing / 2 / 100)
projected_r_share = baseline_r_share − (swing / 2 / 100)`}</pre>
        <p>The divide-by-2 is because a swing of N points in the <em>margin</em> shifts each party's share by N/2 points (D up by half, R down by half). Shares are clamped to [0.001, 0.999] so extreme sandbox values don't break Sainte-Laguë.</p>
      </Section>

      <Section title="Sainte-Laguë allocation (with an interactive demo)">
        <p>To assign N seats given D and R vote totals, the Sainte-Laguë method computes a series of quotients for each party — votes divided by 1, 3, 5, 7, …, (2N−1) — and assigns seats to the N largest quotients across both parties.</p>
        <p>This method is the most proportional of the common divisor methods. D'Hondt slightly favors larger parties; Hamilton/largest-remainder is also proportional but has known paradoxes. For two-party races the three methods usually agree; we use Sainte-Laguë as the default.</p>
        <p>Try it yourself — the same function powers the projection.</p>
        <div className="not-prose mt-4">
          <SainteLagueDemo />
        </div>
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
          The interesting story is at the <em>state</em> level: nearly every state with more than ~5 seats has a significantly distorted delegation today. Click around the map to see for yourself.
        </p>
      </Section>

      <Section title="Assumptions and limitations">
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>Uniform swing.</strong> We apply the same point shift to every state. Real elasticity varies (Wisconsin moves more than Wyoming). A future v2 will weight by state elasticity.
          </li>
          <li>
            <strong>Uncontested races distort baselines.</strong> Vermont in 2024 had no Republican House candidate; its 2024 baseline reads 100/0 D. We flag that state in the UI and use a neutral 50/50 baseline before applying swing. The cleaner fix — imputing votes for uncontested districts from presidential-by-CD data — is deferred to v2.
          </li>
          <li>
            <strong>Two-party only.</strong> Third-party and write-in votes are excluded from the share. Realistic for U.S. House, but it does mean the model can't represent a Greens or Libertarian breakthrough.
          </li>
          <li>
            <strong>Sainte-Laguë is a choice.</strong> Most academic work on proportional representation favors it. Reasonable people can prefer D'Hondt (slightly larger-party-favoring) or Hamilton (largest-remainder, with known paradoxes). The interactive demo above lets you sanity-check edge cases.
          </li>
          <li>
            <strong>State-level polling is sparse.</strong> For most states, we have no recent generic-ballot polling. We apply the national swing uniformly; the projected state-level shares are an inference, not a direct measurement.
          </li>
        </ul>
      </Section>

      <Section title="Why the math doesn't favor one side">
        <p>
          The pipeline doesn't look at partisan labels except to count votes. The same code runs whether
          the swing is toward D or toward R. If the generic ballot flipped to R+6, the projection would
          gain seats for Republicans in blue states by exactly the same mechanism that gains them for
          Democrats today.
        </p>
        <p>Source code: <a className="underline" href="https://github.com/" target="_blank" rel="noreferrer">[link will be added at deploy]</a>.</p>
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
