import { Suspense, lazy, useCallback, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { ScrollManager } from './components/ScrollManager';
import { Home } from './pages/Home';
import { NotFound } from './pages/NotFound';
import { StateRedirect } from './pages/StateRedirect';
import type { ProjectionMeta, ProjectionPayload } from './lib/types';

// Home stays eagerly imported — it's the landing page for nearly every visit,
// so splitting it would only add a round-trip. Everything else is lazy: without
// this the initial bundle carried Methodology (and its static polling_error.json
// import), About's full FAQ, all three companion map pages, and both embed
// pages, none of which a first-time homepage visitor touches.
//
// These are default-exported via the `.then` shim because the pages use named
// exports, matching the existing lazy() usage in pages/Home.tsx.
const About = lazy(() => import('./pages/About').then((m) => ({ default: m.About })));
const Methodology = lazy(() =>
  import('./pages/Methodology').then((m) => ({ default: m.Methodology })),
);
const Rankings = lazy(() => import('./pages/Rankings').then((m) => ({ default: m.Rankings })));
const ElectoralCollege = lazy(() =>
  import('./pages/ElectoralCollege').then((m) => ({ default: m.ElectoralCollege })),
);
const Senate = lazy(() => import('./pages/Senate').then((m) => ({ default: m.Senate })));
const Circuits = lazy(() => import('./pages/Circuits').then((m) => ({ default: m.Circuits })));
const EmbedNational = lazy(() =>
  import('./pages/EmbedNational').then((m) => ({ default: m.EmbedNational })),
);
const EmbedState = lazy(() =>
  import('./pages/EmbedState').then((m) => ({ default: m.EmbedState })),
);

/** Neutral placeholder while a route chunk loads. */
function RouteFallback() {
  return <div className="max-w-5xl mx-auto px-4 py-12 text-stone-500">Loading…</div>;
}

export default function App() {
  const [meta, setMeta] = useState<ProjectionMeta | undefined>();

  const handleMetaChange = useCallback((payload: ProjectionPayload) => {
    setMeta(payload.meta);
  }, []);

  return (
    <BrowserRouter>
      <ScrollManager />
      <Routes>
        {/* Embed routes sit OUTSIDE the Layout — no nav, no footer, no
            stale-data banner. They're chrome-less by design for iframe use.
            They still need their own ErrorBoundary: the Layout's boundary only
            wraps its <Outlet/>, so without this a render throw white-screens
            the widget inside someone else's page — the worst place to fail
            silently. */}
        <Route
          path="/embed/national"
          element={
            <ErrorBoundary>
              <Suspense fallback={<RouteFallback />}>
                <EmbedNational />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/embed/state/:code"
          element={
            <ErrorBoundary>
              <Suspense fallback={<RouteFallback />}>
                <EmbedState />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route element={<Layout meta={meta} />}>
          <Route path="/" element={<Home onMetaChange={handleMetaChange} />} />
          {/* Clean, shareable URLs for the two non-default views. All three
              render the same Home; the active view is derived from the path. */}
          <Route path="/retrospective" element={<Home onMetaChange={handleMetaChange} />} />
          <Route path="/sandbox" element={<Home onMetaChange={handleMetaChange} />} />
          <Route
            path="/rankings"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Rankings />
              </Suspense>
            }
          />
          <Route
            path="/methodology"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Methodology meta={meta} />
              </Suspense>
            }
          />
          {/* Quieter companion pages — linked from the About FAQ, not the nav. */}
          <Route
            path="/electoral-college"
            element={
              <Suspense fallback={<RouteFallback />}>
                <ElectoralCollege />
              </Suspense>
            }
          />
          <Route
            path="/senate"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Senate />
              </Suspense>
            }
          />
          <Route
            path="/circuits"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Circuits />
              </Suspense>
            }
          />
          <Route
            path="/about"
            element={
              <Suspense fallback={<RouteFallback />}>
                <About />
              </Suspense>
            }
          />
          <Route path="/state/:code" element={<StateRedirect />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
