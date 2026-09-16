import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
 * The <noscript> block for /retrospective, built from
 * public/data/retrospectives.json so its numbers can't drift from what the page
 * renders. Returns '' when the file is missing or garbled — the hand-written
 * ROUTE_META['/retrospective'].noscript prose ships in that case.
 */
function buildRetrospectiveNoscript(): string {
  let data: Record<string, any> | null = null;
  try {
    data = JSON.parse(readFileSync(resolve('public/data/retrospectives.json'), 'utf8'));
  } catch {
    return '';
  }
  const cycles = data?.cycles;
  if (!cycles || typeof cycles !== 'object') return '';
  const rows = Object.keys(cycles)
    .sort()
    .map((year) => {
      const national = cycles[year]?.national;
      const actual = national?.actual;
      const pr = national?.projected_pr;
      if (!actual || !pr) return '';
      return (
        `<li>${escText(year)}: popular vote ${escText(fmtMargin(national?.popular_vote_d_margin))}` +
        ` — actual House D ${actual.d_seats} / R ${actual.r_seats}, allocated proportionally` +
        ` D ${pr.d_seats} / R ${pr.r_seats}.</li>`
      );
    })
    .filter(Boolean);
  if (!rows.length) return '';
  return (
    '<p>Proportional allocation applied to the certified votes of past U.S. House elections:</p>' +
    `<ul>${rows.join('')}</ul>`
  );
}

/**
 * Read public/data/projection.json at build time, or null when missing/garbled.
 */
function readProjectionJson(): Record<string, any> | null {
  try {
    return JSON.parse(readFileSync(resolve('public/data/projection.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The <noscript> navigation block: real <a href> links from every prerendered
 * page to every other one.
 *
 * This exists because the prerendered HTML is the SPA shell — <div id="root">
 * and nothing else. Before React runs there is not a single internal link on
 * any route, so a crawler's first pass sees nine unconnected orphan pages and
 * discovers them only through sitemap.xml. Sitemap discovery carries no
 * internal link equity and no anchor text, which is the likeliest reason
 * /senate sat in "Crawled - currently not indexed" while the genuinely linked
 * static pages (/retrospectives, /state/*) indexed without trouble.
 *
 * `current` is omitted from its own list — a page shouldn't link to itself.
 */
function buildNavNoscript(current: string): string {
  const links = Object.values(ROUTE_META)
    .filter((m) => m.canonicalPath !== current)
    .map((m) => `<li><a href="${escAttr(m.canonicalPath)}">${escText(m.navLabel)}</a></li>`)
    .join('');
  const retrospectives =
    current === '/retrospectives'
      ? ''
      : '<li><a href="/retrospectives">Retrospectives write-up</a></li>';
  return `<nav><p>More from The Proportional House:</p><ul>${links}${retrospectives}</ul></nav>`;
}

/**
 * A linked index of all 50 per-state pages, from public/data/projection.json.
 *
 * The state pages are real prose with their own canonicals and they index
 * fine, but nothing in the pre-JS HTML linked to them either — /rankings only
 * mentioned "/state/" as plain text. Returns '' when the data is unavailable.
 */
function buildStateIndexNoscript(): string {
  const states = readProjectionJson()?.states;
  if (!Array.isArray(states) || !states.length) return '';
  const items = states
    .filter((st: any) => typeof st?.code === 'string' && typeof st?.name === 'string')
    .map((st: any) => {
      const href = `/state/${escAttr(String(st.code).toLowerCase())}`;
      return `<li><a href="${href}">${escText(st.name)} under proportional representation</a></li>`;
    })
    .join('');
  if (!items) return '';
  return `<nav><p>Every state:</p><ul>${items}</ul></nav>`;
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
      const retrospectiveNoscript = buildRetrospectiveNoscript();
      // The 50 per-state links are long, so they go on the two routes they
      // actually belong to rather than on every page: the national map and the
      // rankings leaderboards, both of which are about the states.
      const stateIndex = buildStateIndexNoscript();
      for (const meta of Object.values(ROUTE_META)) {
        const isHome = meta.canonicalPath === '/';
        const url =
          meta.canonicalPath === '/' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${meta.canonicalPath}`;
        const title = escAttr(meta.title);
        const desc = escAttr(isHome ? meta.description + todayLine : meta.description);
        // Every route gets its own <noscript> body. Shipping the same generic
        // "requires JavaScript" fallback on all of them made each route look
        // like thin duplicate content to crawlers that don't run our JS.
        // Home and /retrospective are generated from public/data so they track
        // the numbers on the page; the rest is static prose from ROUTE_META.
        const routeNoscript = isHome
          ? noscriptSummary
          : meta.canonicalPath === '/retrospective'
            ? retrospectiveNoscript || meta.noscript || ''
            : (meta.noscript ?? '');
        const wantsStateIndex =
          meta.canonicalPath === '/' || meta.canonicalPath === '/rankings';
        const body =
          routeNoscript +
          buildNavNoscript(meta.canonicalPath) +
          (wantsStateIndex ? stateIndex : '');
        const html = template
          .replace(/<title>[\s\S]*?<\/title>/, `<title>${escText(meta.title)}</title>`)
          .replace(/(<meta name="description" content=")[^"]*(")/, `$1${desc}$2`)
          .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
          .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
          .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${title}$2`)
          .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${desc}$2`)
          .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${title}$2`)
          .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${desc}$2`)
          // Per-route <noscript> body: the route's own prose, then the
          // cross-links that give the pre-JS HTML an internal link graph.
          .replace('<!--LIVE-SUMMARY-->', body);
        const file =
          meta.canonicalPath === '/' ? 'index.html' : `${meta.canonicalPath.slice(1)}.html`;
        writeFileSync(resolve(outDir, file), html);
      }
      writeEmbedShells(outDir, template);
    },
  };
}

/**
 * Emit a static shell for every /embed/* route.
 *
 * These used to be served by the `/*  /index.html  200` catch-all in
 * _redirects. That catch-all is gone — it was what made every unknown path
 * answer HTTP 200 with the homepage, i.e. a soft 404 on the whole URL space —
 * so each embed route now needs a real file, exactly like the per-route and
 * per-state pages. Cloudflare Pages serves a nested asset at its clean URL
 * (dist/state/ca.html is already served at /state/ca in production), so
 * dist/embed/state/ca.html answers /embed/state/ca.
 *
 * Every shell is noindex: an embed is a chrome-less copy of content that has a
 * real page elsewhere, and newsrooms iframe these into articles, so they are
 * genuinely reachable by a crawler. Links are still followed, so the link back
 * to the full page below keeps working.
 */
function writeEmbedShells(outDir: string, template: string): void {
  const states = readProjectionJson()?.states;
  const codes: string[] = Array.isArray(states)
    ? states
        .map((st: any) => (typeof st?.code === 'string' ? st.code.toLowerCase() : ''))
        .filter(Boolean)
    : [];

  const shell = (canonicalPath: string, backLink: string) =>
    template
      .replace(
        /<link rel="canonical" href="[^"]*"\s*\/?>/,
        '<meta name="robots" content="noindex" />',
      )
      .replace('<!--LIVE-SUMMARY-->', backLink)
      // Not a page anyone should land on from search or a shared link.
      .replace(/<title>[\s\S]*?<\/title>/, `<title>The Proportional House</title>`)
      .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${SITE_ORIGIN}${canonicalPath}$2`);

  mkdirSync(resolve(outDir, 'embed/state'), { recursive: true });
  writeFileSync(
    resolve(outDir, 'embed/national.html'),
    shell('/embed/national', '<p><a href="/">The full interactive map &rarr;</a></p>'),
  );
  for (const code of codes) {
    writeFileSync(
      resolve(outDir, `embed/state/${code}.html`),
      shell(
        `/embed/state/${code}`,
        `<p><a href="/state/${code}">The full page for this state &rarr;</a></p>`,
      ),
    );
  }
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
