import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { ROUTE_META, SITE_ORIGIN } from './src/lib/routeMeta';

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const escText = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
      for (const meta of Object.values(ROUTE_META)) {
        const url =
          meta.canonicalPath === '/' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${meta.canonicalPath}`;
        const title = escAttr(meta.title);
        const desc = escAttr(meta.description);
        const html = template
          .replace(/<title>[\s\S]*?<\/title>/, `<title>${escText(meta.title)}</title>`)
          .replace(/(<meta name="description" content=")[^"]*(")/, `$1${desc}$2`)
          .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
          .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
          .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${title}$2`)
          .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${desc}$2`)
          .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${title}$2`)
          .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${desc}$2`);
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
      try {
        const meta = JSON.parse(readFileSync(resolve('public/data/meta.json'), 'utf8'));
        version = String(meta.generated_at ?? '').slice(0, 10);
      } catch {
        // meta.json missing/garbled — fall back to the build date below
      }
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
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          // Only declare packages that are actually imported in src/.
          // us-atlas is fetched at runtime as JSON, d3-selection isn't
          // directly imported (it's a transitive dep) — listing them here
          // would crash Vite's resolver.
          'd3-geo': ['d3-geo', 'topojson-client'],
        },
      },
    },
  },
});
