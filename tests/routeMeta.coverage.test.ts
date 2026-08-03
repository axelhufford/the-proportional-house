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
