// Static server for dist/ that applies public/_headers and public/_redirects
// the way Cloudflare Pages does, so CSP and the SPA fallback can be verified
// locally (workerd/wrangler needs macOS 13.5+; this box is on 12.6).
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';

const ROOT = resolve(process.argv[2] ?? 'dist');
const HEADERS_FILE = resolve(process.argv[3] ?? 'public/_headers');
const PORT = Number(process.argv[4] ?? 4180);

// Parse _headers into [{ pattern, headers }] in file order.
function parseHeaders(text) {
  const rules = [];
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = { pattern: line.trim(), headers: {} };
      rules.push(current);
    } else if (current) {
      const idx = line.indexOf(':');
      if (idx > 0) current.headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return rules;
}

const RULES = existsSync(HEADERS_FILE) ? parseHeaders(readFileSync(HEADERS_FILE, 'utf8')) : [];

function matches(pattern, pathname) {
  if (pattern.endsWith('/*')) return pathname.startsWith(pattern.slice(0, -1));
  if (pattern === '/*') return true;
  return pattern === pathname;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);

  // Later rules win, matching Cloudflare's "most specific last" behavior here.
  const applied = {};
  for (const r of RULES) if (matches(r.pattern, pathname)) Object.assign(applied, r.headers);

  const candidates = [
    join(ROOT, pathname),
    join(ROOT, pathname + '.html'),
    join(ROOT, pathname, 'index.html'),
  ];
  let file = candidates.find((c) => existsSync(c) && statSync(c).isFile());
  // SPA fallback, mirroring `/*  /index.html  200`.
  if (!file) file = join(ROOT, 'index.html');

  const body = readFileSync(file);
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    ...applied,
  });
  res.end(body);
}).listen(PORT, () => console.log(`serving ${ROOT} with ${HEADERS_FILE} on http://localhost:${PORT}`));
