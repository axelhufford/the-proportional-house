/**
 * Single source of truth for per-route SEO/social metadata.
 *
 * Used in two places that must never drift:
 *   - the page components (via useDocumentTitle) set these client-side on nav, and
 *   - the build-time prerender plugin (vite.config.ts) bakes them into static
 *     per-route HTML (dist/index.html, dist/rankings.html, …) so crawlers and
 *     social/AI bots — which don't run our JS — see the right title, description,
 *     canonical, and Open Graph/Twitter tags for each route.
 */
export const SITE_ORIGIN = 'https://proportionalhouse.org';

export interface RouteMeta {
  title: string;
  description: string;
  /** Path with a leading slash, e.g. "/" or "/rankings". */
  canonicalPath: string;
  /**
   * Short anchor text for the cross-links in the <noscript> nav. The
   * prerendered HTML is a bare SPA shell, so these are the only internal
   * links a crawler sees before it runs our JS — they carry the anchor-text
   * signal for the page they point at, so describe the destination rather
   * than saying "here".
   */
  navLabel: string;
  /**
   * Route-specific prose for the <noscript> crawler fallback, baked in by the
   * prerender plugin. Without it every route ships the same generic "this site
   * requires JavaScript" body, which reads as duplicate thin content to a
   * crawler that doesn't render our JS — Google filed /senate, /sandbox and
   * /retrospective under "Crawled - currently not indexed" for exactly that.
   *
   * Raw HTML, inserted verbatim: write plain markup (no Tailwind classes —
   * noscript content isn't part of the utility scan) and escape by hand.
   * Every number here must come from public/data/*.json; the home and
   * /retrospective summaries are generated from that data at build time
   * instead, so they can't drift.
   */
  noscript?: string;
}

export const ROUTE_META: Record<string, RouteMeta> = {
  '/': {
    title: 'The U.S. House under proportional representation',
    description:
      'See how many seats each party would hold if the U.S. House used proportional representation instead of winner-take-all districts — a daily projection from the current generic-ballot polling average, with 2016–2024 retrospectives.',
    canonicalPath: '/',
    navLabel: 'The national map',
  },
  '/retrospective': {
    title: 'Past U.S. House elections under PR, 2016–2024 · The Proportional House',
    description:
      'Apply proportional representation to the actual votes of the 2016–2024 U.S. House elections. See, cycle by cycle, how many seats winner-take-all districts shifted from a proportional result.',
    canonicalPath: '/retrospective',
    navLabel: 'Past elections under PR (2016–2024)',
    noscript:
      '<p>Proportional allocation applied to the actual certified votes of the 2016, 2018, 2020, ' +
      '2022 and 2024 U.S. House elections — cycle by cycle, how many seats winner-take-all ' +
      'districts moved away from a proportional result.</p>',
  },
  '/sandbox': {
    title: 'Sandbox: build your own U.S. House · The Proportional House',
    description:
      'Experiment with the U.S. House: change the national vote, add third parties, switch the allocation method (Pure PR, MMD, MMP), set a threshold, and resize the chamber — and watch the seats recompute live.',
    canonicalPath: '/sandbox',
    navLabel: 'Sandbox: build your own House',
    noscript:
      '<p>An interactive model of the U.S. House: set the national vote margin, add third parties, ' +
      'switch the allocation method (Pure PR, multi-member districts, or MMP), impose an electoral ' +
      'threshold, and resize the chamber beyond 435 seats — every seat count recomputes live.</p>',
  },
  '/rankings': {
    title: 'Most distorted U.S. House delegations · The Proportional House',
    description:
      'Which state delegations diverge most from proportional representation? Leaderboards of the biggest D shifts, biggest R shifts, and most one-sided House delegations.',
    canonicalPath: '/rankings',
    navLabel: 'Most distorted state delegations',
    noscript:
      '<p>Leaderboards of the state delegations that diverge most from a proportional result: the ' +
      'largest shifts toward Democrats, the largest shifts toward Republicans, and the most ' +
      'one-sided delegations in the country. Each state also has a static summary page ' +
      'under /state/.</p>',
  },
  '/methodology': {
    title: 'Methodology · The Proportional House',
    description:
      'How the projection works: data sources, Sainte-Laguë allocation, state elasticity, the Sandbox’s allocation methods (PR, MMD, MMP) and House-size expansion, uncontested-race imputation, and limitations.',
    canonicalPath: '/methodology',
    navLabel: 'Methodology and data sources',
    noscript:
      '<p>How the projection is built: the generic-ballot polling average, Sainte-Laguë seat ' +
      'allocation, per-state elasticity, imputation for uncontested races, and the allocation ' +
      'methods behind the Sandbox (Pure PR, MMD, MMP) — plus the known limitations of each.</p>',
  },
  '/about': {
    title: 'About · The Proportional House',
    description:
      'About The Proportional House: a non-partisan visualization of how the U.S. House would look under proportional representation. Plus a FAQ on the methodology and politics.',
    canonicalPath: '/about',
    navLabel: 'About and FAQ',
    noscript:
      '<p>A non-partisan visualization of how the U.S. House would look if seats were allocated in ' +
      'proportion to votes instead of won district by district, with a FAQ on the methodology and ' +
      'the politics.</p>',
  },
  '/electoral-college': {
    title: 'The Proportional Electoral College · The Proportional House',
    description:
      'What if each state split its electoral votes proportionally instead of winner-take-all? Applied to every presidential election since 1976 — including how often no candidate would reach 270, sending the election to the House.',
    canonicalPath: '/electoral-college',
    navLabel: 'The proportional Electoral College',
    noscript:
      '<p>What if every state split its electoral votes in proportion to its popular vote instead ' +
      'of awarding them winner-take-all? Applied to all 13 presidential elections from 1976 to 2024 ' +
      '(Sainte-Laguë allocation), the proportional leader differs from the actual winner in 2000 ' +
      'and 2016. In four of the thirteen — 1992, 1996, 2000 and 2016 — no candidate reaches 270, ' +
      'which under the Twelfth Amendment would send the election to the House.</p>',
  },
  '/senate': {
    title: 'The Senate’s malapportionment · The Proportional House',
    description:
      'Every state gets two senators regardless of population. See how lopsided that is — a Wyoming voter has ~68× the Senate representation of a Californian, and the smallest states holding under 18% of the population can command a Senate majority.',
    canonicalPath: '/senate',
    navLabel: 'The Senate’s malapportionment',
    noscript:
      '<p>Every state elects two senators regardless of population. On 2020 Census figures, Wyoming ' +
      'has one senator per 288,426 residents and California one per 19,769,112 — a 68.5× gap ' +
      'in per-person Senate representation. The 26 smallest states hold 17.6% of the U.S. ' +
      'population and elect a 52-seat Senate majority. This page ranks all 50 states by people per ' +
      'senator.</p>',
  },
  '/circuits': {
    title: 'The federal circuit map · The Proportional House',
    description:
      'The U.S. Courts of Appeals are carved into wildly unequal circuits — the 9th covers ~1 in 5 Americans. See today’s circuits by population and authorized judges, and an illustrative redraw into far more equal circuits.',
    canonicalPath: '/circuits',
    navLabel: 'The federal circuit map',
    noscript:
      '<p>The U.S. Courts of Appeals are divided into 12 geographic circuits of wildly unequal ' +
      'size. The 9th Circuit covers 66.8 million people — about one in five Americans — against ' +
      '14.2 million in the 1st, a 4.7× spread across 167 authorized active judgeships. This ' +
      'page maps today\'s circuits by population and judges alongside an illustrative redraw that ' +
      'narrows that spread to 1.9×.</p>',
  },
};

/**
 * Build a schema.org `Dataset` JSON-LD object for a page, mirroring the shape the
 * homepage emits for the projection. The companion experiment pages inject this
 * via an inline `<script type="application/ld+json">` so crawlers — and Google
 * Dataset Search — can discover each experiment's underlying public JSON.
 */
export function datasetSchema(opts: {
  name: string;
  description: string;
  /** Page path with a leading slash, e.g. "/senate". */
  canonicalPath: string;
  /** Public data file path with a leading slash, e.g. "/data/senate.json". */
  dataPath: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: opts.name,
    description: opts.description,
    url: `${SITE_ORIGIN}${opts.canonicalPath}`,
    isAccessibleForFree: true,
    // CC BY 4.0 — same data license as the homepage projection.
    license: 'https://creativecommons.org/licenses/by/4.0/',
    creator: {
      '@type': 'Person',
      name: 'Axel Hufford',
      url: 'https://axelhufford.com',
    },
    distribution: {
      '@type': 'DataDownload',
      encodingFormat: 'application/json',
      contentUrl: `${SITE_ORIGIN}${opts.dataPath}`,
    },
  };
}
