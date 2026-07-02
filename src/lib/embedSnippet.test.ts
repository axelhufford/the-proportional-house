import { describe, expect, it } from 'vitest';
import { EMBED_RESIZE_MESSAGE_TYPE } from './embedPostMessage';
import { buildEmbedSnippet, nationalEmbedPath } from './embedSnippet';
import { SITE_ORIGIN } from './routeMeta';

describe('buildEmbedSnippet', () => {
  it('embeds the absolute src and title in the iframe', () => {
    const snippet = buildEmbedSnippet('/embed/national', 'The Proportional House');
    expect(snippet).toContain(`src="${SITE_ORIGIN}/embed/national"`);
    expect(snippet).toContain('title="The Proportional House"');
    expect(snippet).toContain('loading="lazy"');
  });

  it('listens for the resize message type the embeds actually post', () => {
    const snippet = buildEmbedSnippet('/embed/national', 't');
    expect(snippet).toContain(`e.data.type === '${EMBED_RESIZE_MESSAGE_TYPE}'`);
  });

  it('targets the iframe by exact src so multiple embeds resize independently', () => {
    const snippet = buildEmbedSnippet('/embed/state/TX', 'Texas');
    expect(snippet).toContain(`querySelector('iframe[src="${SITE_ORIGIN}/embed/state/TX"]')`);
    expect(snippet).not.toContain('src*=');
  });

  it('escapes query params and quotes for the attribute context', () => {
    const snippet = buildEmbedSnippet('/embed/national?view=sandbox&ballot=5.0', 'A "quoted" title');
    expect(snippet).toContain('view=sandbox&amp;ballot=5.0');
    expect(snippet).toContain('title="A &quot;quoted&quot; title"');
  });
});

describe('nationalEmbedPath', () => {
  it('maps the plain current view to the bare embed path', () => {
    expect(nationalEmbedPath('https://proportionalhouse.org/')).toBe('/embed/national');
  });

  it('carries view, color, and sandbox ballot through', () => {
    expect(nationalEmbedPath('https://proportionalhouse.org/sandbox?ballot=5.0&color=distortion')).toBe(
      '/embed/national?view=sandbox&color=distortion&ballot=5.0',
    );
    expect(nationalEmbedPath('https://proportionalhouse.org/retrospective?year=2022')).toBe(
      '/embed/national?view=retrospective',
    );
  });

  it('drops params the embed does not read', () => {
    expect(
      nationalEmbedPath('https://proportionalhouse.org/?state=CA&color=balance'),
    ).toBe('/embed/national');
    // ballot only applies in sandbox view
    expect(nationalEmbedPath('https://proportionalhouse.org/?ballot=5.0')).toBe('/embed/national');
  });
});
