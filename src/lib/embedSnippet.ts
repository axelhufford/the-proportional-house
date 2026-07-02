/**
 * Builds the copy-paste iframe snippet for the embeddable views.
 *
 * Single source of truth for the snippet: the Methodology "Embeddable
 * widgets" section renders it, and the Embed buttons (national share row,
 * state detail panel) copy it to the clipboard. The script half pairs with
 * the postMessage protocol in embedPostMessage.ts — the embed posts its
 * height, the snippet resizes the iframe.
 */
import { EMBED_RESIZE_MESSAGE_TYPE } from './embedPostMessage';
import { SITE_ORIGIN } from './routeMeta';

/** Escape a string for use inside a double-quoted HTML attribute. */
function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * The host-page snippet for one embed: an iframe plus the resize listener.
 *
 * `path` is the embed path with a leading slash, optionally with query
 * params, e.g. "/embed/national?view=sandbox&ballot=5.0" or
 * "/embed/state/TX". The selector matches the iframe's exact src (not the
 * docs' historical `src*=` prefix match) so a page hosting several
 * Proportional House embeds resizes each one independently.
 */
export function buildEmbedSnippet(path: string, title: string): string {
  const src = `${SITE_ORIGIN}${path}`;
  return `<iframe
  src="${escapeAttr(src)}"
  style="width:100%; border:0;"
  title="${escapeAttr(title)}"
  loading="lazy"
></iframe>
<script>
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === '${EMBED_RESIZE_MESSAGE_TYPE}') {
      const f = document.querySelector('iframe[src="${escapeAttr(src)}"]');
      if (f) f.style.height = e.data.height + 'px';
    }
  });
</script>`;
}

/**
 * Embed src params for the national view, whitelisted to what
 * EmbedNational actually reads (?view, ?color, ?ballot). Everything else
 * on the current URL (minors, method, house, open state…) has no effect
 * on the embed, so including it would only mislead.
 *
 * `currentUrl` is the canonical scenario URL Home keeps in sync (same
 * source the Copy-link button trusts). Retrospective year is NOT
 * representable (the embed has no ?year param) — callers disable the
 * button for states the embed can't show, extended sandbox included.
 */
export function nationalEmbedPath(currentUrl: string | URL): string {
  const url = new URL(currentUrl);
  const params = new URLSearchParams();
  const view =
    url.pathname === '/retrospective' ? 'retrospective'
    : url.pathname === '/sandbox' ? 'sandbox'
    : null;
  if (view) params.set('view', view);
  const color = url.searchParams.get('color');
  if (color === 'distortion') params.set('color', color);
  const ballot = url.searchParams.get('ballot');
  if (view === 'sandbox' && ballot !== null) params.set('ballot', ballot);
  const search = params.toString();
  return search ? `/embed/national?${search}` : '/embed/national';
}
