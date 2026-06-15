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
}

export const ROUTE_META: Record<string, RouteMeta> = {
  '/': {
    title: 'Current U.S. House seats under proportional representation · The Proportional House',
    description:
      'See how many seats each party would hold if the U.S. House used proportional representation instead of winner-take-all districts — a daily projection from the current generic-ballot polling average, with 2016–2024 retrospectives.',
    canonicalPath: '/',
  },
  '/retrospective': {
    title:
      'Retrospective: how past U.S. House elections would look under proportional representation · The Proportional House',
    description:
      'Apply proportional representation to the actual votes of the 2016–2024 U.S. House elections. See, cycle by cycle, how many seats winner-take-all districts shifted from a proportional result.',
    canonicalPath: '/retrospective',
  },
  '/sandbox': {
    title: 'Sandbox: build your own proportional U.S. House · The Proportional House',
    description:
      'Experiment with the U.S. House: change the national vote, add third parties, switch the allocation method (Pure PR, MMD, MMP), set a threshold, and resize the chamber — and watch the seats recompute live.',
    canonicalPath: '/sandbox',
  },
  '/rankings': {
    title:
      'House rankings: most distorted delegations under proportional representation · The Proportional House',
    description:
      'Which state delegations diverge most from proportional representation? Leaderboards of the biggest D shifts, biggest R shifts, and most one-sided House delegations.',
    canonicalPath: '/rankings',
  },
  '/methodology': {
    title: 'Methodology · The Proportional House',
    description:
      'How the projection works: data sources, Sainte-Laguë allocation, state elasticity, the Sandbox’s allocation methods (PR, MMD, MMP) and House-size expansion, uncontested-race imputation, and limitations.',
    canonicalPath: '/methodology',
  },
  '/about': {
    title: 'About · The Proportional House',
    description:
      'About The Proportional House: a non-partisan visualization of how the U.S. House would look under proportional representation. Plus a FAQ on the methodology and politics.',
    canonicalPath: '/about',
  },
  '/electoral-college': {
    title: 'The Proportional Electoral College, 1976–2024 · The Proportional House',
    description:
      'What if each state split its electoral votes proportionally instead of winner-take-all? Applied to every presidential election since 1976 — including how often no candidate would reach 270, sending the election to the House.',
    canonicalPath: '/electoral-college',
  },
  '/senate': {
    title: 'The Senate’s malapportionment · The Proportional House',
    description:
      'Every state gets two senators regardless of population. See how lopsided that is — a Wyoming voter has ~68× the Senate representation of a Californian, and the smallest states holding under 18% of the population can command a Senate majority.',
    canonicalPath: '/senate',
  },
  '/circuits': {
    title: 'The federal circuit map · The Proportional House',
    description:
      'The U.S. Courts of Appeals are carved into wildly unequal circuits — the 9th covers ~1 in 5 Americans. See today’s circuits by population and authorized judges, and an illustrative redraw into far more equal circuits.',
    canonicalPath: '/circuits',
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
