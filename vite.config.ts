import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fmtMargin } from './src/lib/format';
import { ROUTE_META, SITE_ORIGIN } from './src/lib/routeMeta';

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const escText = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Read public/data/meta.json at build time, or null when missing/garbled.
 * In CI the pipeline runs before the build, so this is the day's data; the
 * CI fallback path can ship older meta.json lacking newer fields — every
 * consumer must optional-chain.
 */
function readPublicMetaJson(): Record<string, any> | null {
  try {
    return JSON.parse(readFileSync(resolve('public/data/meta.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The " Today: …" clause appended to the HOME route's description (and the
 * longer <noscript> paragraph), built from the day's meta.json. Returns
 * empty strings when the data isn't available — the static copy ships as-is.
 */
function buildLiveSummary(meta: Record<string, any> | null): {
  todayLine: string;
  noscriptSummary: string;
} {
  const projected = meta?.national?.projected;
  const margin = meta?.generic_ballot?.margin;
  const date = String(meta?.generated_at ?? '').slice(0, 10);
  if (!projected || typeof margin !== 'number' || !date) {
    return { todayLine: '', noscriptSummary: '' };
  }
  const marginLabel = fmtMargin(margin);
  const unc = meta?.uncertainty;
  const majority = meta?.majority;
  const bandClause = unc
    ? `, range D ${unc.d_seats_low}–${unc.d_seats_high} at ±${unc.epsilon_points} pts`
    : '';
  const tipClause = majority
    ? `, control flips at ${fmtMargin(majority.tipping_margin)}`
    : '';
  const todayLine =
    ` Today: D ${projected.d_seats} / R ${projected.r_seats} under PR` +
    ` (generic ballot ${marginLabel}${bandClause}${tipClause}). Updated ${date}.`;

  const actual = meta?.national?.actual;
  const actualClause = actual ? ` (actual House today: D ${actual.d_seats} / R ${actual.r_seats})` : '';
  const noscriptSummary =
    `<p>As of ${escText(date)}: under today's polling (${escText(marginLabel)}), a proportional ` +
    `U.S. House would be D ${projected.d_seats} / R ${projected.r_seats}${actualClause}.` +
    (unc
      ? ` If polls miss by the historical ±${unc.epsilon_points} points, the range is ` +
        `D ${unc.d_seats_low}–${unc.d_seats_high}.`
      : '') +
    (majority
      ? ` Control of the House would flip at ${escText(fmtMargin(majority.tipping_margin))} on the generic ballot.`
      : '') +
    `</p>`;
  return { todayLine, noscriptSummary };
}

/**
 * Build-time per-route meta prerender.
 *
 * The app is a client-rendered SPA: Cloudflare serves the same index.html for
 * every route (`_redirects`: /* → /index.html), and useDocumentTitle only
 * patches the head *after* JS runs — so social/AI/non-JS crawlers see the
 * homepage's title + Open Graph card on /rankings, /methodology, /about.
 *
 * This plugin clones the built index.html into a static file per route with the
 * head rewritten from ROUTE_META (title, description, canonical, og:* and
 * twitter:*). Cloudflare Pages serves dist/rankings.html at /rankings via clean
 * URLs (same mechanism as the per-state pages), and the body is the unchanged
 * SPA shell with the correct hashed assets, so the app still hydrates normally.
 * The '/' entry also re-stamps dist/index.html so the homepage's static meta
 * matches the richer client-set values.
 */
function prerenderRouteMeta(): Plugin {
  let outDir = 'dist';
  return {
    name: 'prerender-route-meta',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      let template: string;
      try {
        template = readFileSync(resolve(outDir, 'index.html'), 'utf8');
      } catch {
        return; // no index.html (e.g. lib build) — nothing to do
      }
      // Live numbers for the home route: appended to the description (before
      // escaping) and swapped into the <noscript> placeholder. Empty strings
      // when meta.json is missing/old — static copy ships unchanged.
      const { todayLine, noscriptSummary } = buildLiveSummary(readPublicMetaJson());
      for (const meta of Object.values(ROUTE_META)) {
        const isHome = meta.canonicalPath === '/';
        const url =
          meta.canonicalPath === '/' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${meta.canonicalPath}`;
        const title = escAttr(meta.title);
        const desc = escAttr(isHome ? meta.description + todayLine : meta.description);
        const html = template
          .replace(/<title>[\s\S]*?<\/title>/, `<title>${escText(meta.title)}</title>`)
          .replace(/(<meta name="description" content=")[^"]*(")/, `$1${desc}$2`)
          .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
          .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
          .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${title}$2`)
          .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${desc}$2`)
          .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${title}$2`)
          .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${desc}$2`)
          // Live <noscript> summary on the home route; placeholder stripped
          // everywhere else (and when the data is unavailable).
          .replace('<!--LIVE-SUMMARY-->', isHome ? noscriptSummary : '');
        const file =
          meta.canonicalPath === '/' ? 'index.html' : `${meta.canonicalPath.slice(1)}.html`;
        writeFileSync(resolve(outDir, file), html);
      }
    },
  };
}

/**
 * Cache-bust the home OG share card.
 *
 * og:image points at a fixed /og-card.png that the daily pipeline overwrites in
 * place, so messaging apps (iMessage, Slack, Twitter…) keep showing the version
 * they first cached. Stamping the URL with the data date — ?v=YYYY-MM-DD from
 * public/data/meta.json — makes the URL change whenever the numbers do, so they
 * re-fetch. Runs in transformIndexHtml, so the per-route clones that
 * prerenderRouteMeta makes from the built index.html inherit the stamped URL.
 * (The pipeline stamps the same date on the retrospectives + per-state pages.)
 */
function ogCacheBust(): Plugin {
  let version = '';
  return {
    name: 'og-cache-bust',
    apply: 'build',
    buildStart() {
      const meta = readPublicMetaJson();
      version = String(meta?.generated_at ?? '').slice(0, 10);
      if (!version) version = new Date().toISOString().slice(0, 10);
    },
    transformIndexHtml(html) {
      return html.replace(/\/og-card\.png(?=")/g, `/og-card.png?v=${version}`);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), prerenderRouteMeta(), ogCacheBust()],
  build: {
    rollupOptions: {
      output: {
        // Split vendor code into long-lived cacheable chunks so app updates
        // don't bust the React + d3 + topojson bytes on repeat visits.
        // Recharts gets its own chunk automatically via React.lazy() in
        // src/pages/Home.tsx — no need to declare it here.
        // Rolldown (Vite 8) only takes the function form; scheduler and
        // react-router are listed because the old object form swept in each
        // package's exclusive deps, and these two must stay in the react
        // chunk to keep it self-contained.
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id)) {
            return 'react';
          }
          if (/[\\/]node_modules[\\/](d3-geo|topojson-client)[\\/]/.test(id)) {
            return 'd3-geo';
          }
        },
      },
    },
  },
});
