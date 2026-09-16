// Fail the build if any URL the site advertises has no file to serve it.
//
// public/_redirects no longer ends with `/*  /index.html  200`. That rule was
// a soft 404 across the whole URL space — every unknown path answered with the
// homepage at HTTP 200 — but it was also an accidental safety net: a route
// that lost its prerendered file still returned *something*. Without it, a
// missing file is a hard 404 on a real page, so the invariant it rested on
// ("every valid path is a static asset") has to be checked before deploying,
// not discovered in Search Console weeks later.
//
// Run against the built output: node scripts/verify-dist-routes.mjs [distDir]
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIST = resolve(process.argv[2] ?? 'dist');
const SITEMAP = resolve('public/sitemap.xml');
const ORIGIN = 'https://proportionalhouse.org';

/** Mirror Cloudflare Pages' asset resolution for a clean URL. */
function resolves(pathname) {
  if (pathname === '' || pathname === '/') return isFile(join(DIST, 'index.html'));
  const p = pathname.replace(/^\//, '');
  return isFile(join(DIST, p)) || isFile(join(DIST, `${p}.html`)) || isFile(join(DIST, p, 'index.html'));
}
const isFile = (f) => existsSync(f) && statSync(f).isFile();

const sitemap = readFileSync(SITEMAP, 'utf8');
const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
if (urls.length === 0) {
  console.error('verify-dist-routes: sitemap.xml has no <loc> entries — refusing to pass.');
  process.exit(1);
}

const paths = urls.map((u) => (u.startsWith(ORIGIN) ? u.slice(ORIGIN.length) : u));
// Not in the sitemap (deliberately noindex), but still real routes that must
// resolve — newsrooms iframe these into articles.
const embeds = ['/embed/national', '/embed/state/ca', '/embed/state/wy'];
// A hard 404 needs somewhere to land.
const infra = ['/404.html', '/robots.txt', '/sitemap.xml'];

const missing = [...paths, ...embeds, ...infra].filter((p) => !resolves(p));
if (missing.length) {
  console.error(`verify-dist-routes: ${missing.length} advertised path(s) have no file in ${DIST}:`);
  for (const m of missing) console.error(`  ${m}`);
  process.exit(1);
}

// The catch-all must not come back.
const redirects = existsSync('public/_redirects') ? readFileSync('public/_redirects', 'utf8') : '';
const catchAll = redirects
  .split('\n')
  .find((l) => l.trim().startsWith('/*') && !l.trim().startsWith('#'));
if (catchAll) {
  console.error(`verify-dist-routes: _redirects has a catch-all, re-introducing the soft 404:\n  ${catchAll}`);
  process.exit(1);
}

console.log(
  `verify-dist-routes: OK — ${paths.length} sitemap URLs, ${embeds.length} embed routes, ` +
    `${infra.length} infra files all resolve in ${DIST}.`,
);
