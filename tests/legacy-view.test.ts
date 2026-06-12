import { describe, it, expect } from 'vitest';
import { legacyViewRedirectTarget, onRequest } from '../functions/index';

const target = (pathAndQuery: string) =>
  legacyViewRedirectTarget(new URL(pathAndQuery, 'https://proportionalhouse.org'));

describe('legacyViewRedirectTarget', () => {
  it('maps view=retrospective to /retrospective', () => {
    expect(target('/?view=retrospective')).toBe('/retrospective');
  });

  it('maps view=sandbox to /sandbox', () => {
    expect(target('/?view=sandbox')).toBe('/sandbox');
  });

  it('maps view=current to bare /', () => {
    expect(target('/?view=current')).toBe('/');
  });

  it('collapses unknown views to / (parseViewMode fallback)', () => {
    expect(target('/?view=bogus')).toBe('/');
  });

  it('strips view but preserves remaining params', () => {
    expect(target('/?view=retrospective&year=2020&color=distortion')).toBe(
      '/retrospective?year=2020&color=distortion',
    );
  });

  it('preserves params when an unknown view collapses to home', () => {
    expect(target('/?view=bogus&state=CA')).toBe('/?state=CA');
  });

  it('strips repeated view params', () => {
    expect(target('/?view=sandbox&view=current&ballot=3.0')).toBe('/sandbox?ballot=3.0');
  });

  it('returns null when no view param is present', () => {
    expect(target('/')).toBeNull();
    expect(target('/?year=2020&color=distortion')).toBeNull();
  });
});

describe('onRequest', () => {
  const homepage = () => new Response('<html>home</html>', { status: 200 });
  const context = (url: string, method = 'GET') => ({
    request: new Request(url, { method }),
    env: { ASSETS: { fetch: async () => homepage() } },
  });

  it('301s legacy view URLs to the clean path', async () => {
    const res = await onRequest(context('https://proportionalhouse.org/?view=retrospective'));
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://proportionalhouse.org/retrospective');
  });

  it('preserves non-view query params in the Location', async () => {
    const res = await onRequest(
      context('https://proportionalhouse.org/?view=sandbox&ballot=3.0'),
    );
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://proportionalhouse.org/sandbox?ballot=3.0');
  });

  it('redirects HEAD requests too', async () => {
    const res = await onRequest(
      context('https://proportionalhouse.org/?view=retrospective', 'HEAD'),
    );
    expect(res.status).toBe(301);
  });

  it('serves the asset when no view param is present', async () => {
    const res = await onRequest(context('https://proportionalhouse.org/'));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('home');
  });
});
