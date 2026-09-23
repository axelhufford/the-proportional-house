import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mounts = 0;
function Child({ explode }: { explode: boolean }) {
  useEffect(() => {
    mounts++;
  }, []);
  if (explode) throw new Error('boom');
  return <p>fine</p>;
}

describe('ErrorBoundary resetKey', () => {
  let container: HTMLDivElement;
  let root: Root;
  const render = (resetKey: string, explode = false) =>
    act(() =>
      root.render(
        <MemoryRouter>
          <ErrorBoundary resetKey={resetKey}>
            <Child explode={explode} />
          </ErrorBoundary>
        </MemoryRouter>,
      ),
    );

  beforeEach(() => {
    mounts = 0;
    // React logs caught render errors; keep the test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    container = document.createElement('div');
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.restoreAllMocks();
  });

  it('clears a caught error when resetKey changes, and only then', () => {
    render('/sandbox', true);
    expect(container.textContent).toContain('This page hit a snag');
    render('/sandbox');
    expect(container.textContent).toContain('This page hit a snag');
    render('/');
    expect(container.textContent).toContain('fine');
  });

  it('keeps healthy children mounted across resetKey changes', () => {
    // Layout passes the pathname here and gives the Home views one key, so
    // switching /, /retrospective and /sandbox must not remount Home.
    render('/');
    render('/retrospective');
    render('/sandbox');
    expect(container.textContent).toContain('fine');
    expect(mounts).toBe(1);
  });
});
