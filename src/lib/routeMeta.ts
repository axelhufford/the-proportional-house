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
    title: 'The Proportional House: U.S. House under proportional representation',
    description:
      'See how the U.S. House would look if every state allocated its seats by proportional representation, based on current generic-ballot polling.',
    canonicalPath: '/',
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
};
