/**
 * Guards the four places the route list is mirrored.
 *
 * ROUTE_META drives both `useDocumentTitle` (client-side) and the build-time
 * prerender in vite.config.ts. A route added to App.tsx without a ROUTE_META
 * entry produces no per-route HTML — so every crawler and social/AI bot sees
 * the homepage's title and OG card for that URL. There is no build error and,
 * until now, no test.
 *
 * The same list is also mirrored in data-pipeline/generate_sitemap.py
 * (FIXED_ROUTES) and generate_llms.py, both checked here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ROUTE_META, SITE_ORIGIN } from '../src/lib/routeMeta';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf-8');

/**
 * Static routes declared in App.tsx. Excludes the catch-all, parameterized
 * routes (`/state/:code` redirects; `/embed/*` is chrome-less and deliberately
 * not indexed) — none of which get prerendered marketing metadata.
 */
function appRoutes(): string[] {
  const src = read('src/App.tsx');
  const paths = [...src.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
  return paths.filter(
    (p) => p !== '*' && !p.includes(':') && !p.startsWith('/embed'),
  );
}

describe('ROUTE_META covers every indexable route', () => {
  it('has an entry for each static route in App.tsx', () => {
    const missing = appRoutes().filter((p) => !ROUTE_META[p]);
    expect(
      missing,
      `Routes in App.tsx with no ROUTE_META entry (they would inherit the ` +
        `homepage title and OG card for every crawler): ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('has no ROUTE_META entry for a route that no longer exists', () => {
    const routes = new Set(appRoutes());
    const orphans = Object.keys(ROUTE_META).filter((p) => !routes.has(p));
    expect(orphans, `ROUTE_META entries with no matching <Route>: ${orphans.join(', ')}`).toEqual([]);
  });

  it('gives every entry a distinct, non-empty title and description', () => {
    const titles = new Set<string>();
    for (const [path, meta] of Object.entries(ROUTE_META)) {
      expect(meta.title.length, `${path} title`).toBeGreaterThan(10);
      expect(meta.description.length, `${path} description`).toBeGreaterThan(50);
      expect(titles.has(meta.title), `duplicate title for ${path}`).toBe(false);
      titles.add(meta.title);
      expect(meta.canonicalPath, `${path} canonicalPath`).toBe(path);
    }
  });
});

describe('every route ships its own <noscript> body', () => {
  /**
   * The prerender plugin clones one index.html per route and only rewrites the
   * head, so without per-route noscript prose every route's crawler-visible
   * body is byte-identical. Google filed /senate, /sandbox and /retrospective
   * under "Crawled - currently not indexed" while that was true. '/' is the
   * exception: its paragraph is generated from meta.json at build time.
   */
  it('gives every non-home route distinct, substantive prose', () => {
    const seen = new Set<string>();
    for (const [path, meta] of Object.entries(ROUTE_META)) {
      if (path === '/') continue;
      const prose = meta.noscript ?? '';
      expect(prose.length, `${path} has no noscript prose`).toBeGreaterThan(120);
      expect(seen.has(prose), `duplicate noscript prose for ${path}`).toBe(false);
      seen.add(prose);
    }
  });

  it('keeps the LIVE-SUMMARY placeholder the prerender plugin substitutes', () => {
    expect(read('index.html')).toContain('<!--LIVE-SUMMARY-->');
    expect(read('vite.config.ts')).toContain("replace('<!--LIVE-SUMMARY-->', body)");
  });
});

describe('every valid path is a real file, so unknown paths can 404', () => {
  /**
   * public/_redirects used to end with `/*  /index.html  200`, which answered
   * every unknown path with the homepage at HTTP 200 — a soft 404 across the
   * whole URL space. Removing it is only safe while every valid path is a
   * static asset Pages can serve directly, so these guard that precondition.
   */
  it('has no SPA catch-all in _redirects', () => {
    const redirects = read('public/_redirects')
      .split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('#'));
    const catchAll = redirects.find((l) => l.trim().startsWith('/*'));
    expect(
      catchAll,
      `A /* rule in _redirects re-introduces the soft 404: ${catchAll ?? ''}`,
    ).toBeUndefined();
  });

  it('ships a static 404 page for Pages to serve on a real miss', () => {
    const page = read('public/404.html');
    expect(page).toContain('<title>');
    // Must not be indexable itself, and must offer a way back into the site.
    expect(page).toContain('name="robots" content="noindex"');
    expect(page).toContain('href="/"');
  });

  it('prerenders a shell for every /embed route in App.tsx', () => {
    const embedRoutes = [...read('src/App.tsx').matchAll(/<Route\s+path="(\/embed[^"]*)"/g)].map(
      (m) => m[1],
    );
    expect(embedRoutes.length, 'no /embed routes found — did App.tsx change?').toBeGreaterThan(0);
    // writeEmbedShells emits exactly these two trees. A third embed route would
    // have no file and would 404 now that the catch-all is gone.
    expect(new Set(embedRoutes)).toEqual(new Set(['/embed/national', '/embed/state/:code']));
    const config = read('vite.config.ts');
    expect(config).toContain("'embed/national.html'");
    expect(config).toContain('embed/state/${code}.html');
  });
});

describe('the <noscript> shell carries an internal link graph', () => {
  /**
   * The prerendered HTML is a bare SPA shell, so before React runs there were
   * no internal links at all — every route was an orphan reachable only from
   * sitemap.xml, which carries no link equity and no anchor text.
   */
  it('gives every route distinct, descriptive anchor text', () => {
    const labels = new Set<string>();
    for (const [path, meta] of Object.entries(ROUTE_META)) {
      expect(meta.navLabel.length, `${path} navLabel too short`).toBeGreaterThan(5);
      expect(meta.navLabel.length, `${path} navLabel too long for a link`).toBeLessThan(45);
      expect(/^(here|this|link|click)/i.test(meta.navLabel), `${path} navLabel is not descriptive`).toBe(
        false,
      );
      expect(labels.has(meta.navLabel), `duplicate navLabel for ${path}`).toBe(false);
      labels.add(meta.navLabel);
    }
  });
});

describe('the pipeline generators mirror the same routes', () => {
  it('generate_sitemap.py lists every ROUTE_META path', () => {
    const py = read('data-pipeline/generate_sitemap.py');
    const missing = Object.keys(ROUTE_META).filter((p) => {
      // The sitemap stores paths without the leading slash for non-root routes.
      const needle = p === '/' ? '"/"' : `"${p}"`;
      return !py.includes(needle) && !py.includes(`'${p}'`);
    });
    expect(missing, `Routes missing from generate_sitemap.py: ${missing.join(', ')}`).toEqual([]);
  });

  it('generate_llms.py references the same origin', () => {
    const py = read('data-pipeline/generate_llms.py');
    expect(py).toContain(SITE_ORIGIN.replace('https://', ''));
  });
});
