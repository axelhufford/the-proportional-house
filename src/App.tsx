import { useCallback, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ScrollManager } from './components/ScrollManager';
import { Home } from './pages/Home';
import { About } from './pages/About';
import { EmbedNational } from './pages/EmbedNational';
import { EmbedState } from './pages/EmbedState';
import { Methodology } from './pages/Methodology';
import { NotFound } from './pages/NotFound';
import { Rankings } from './pages/Rankings';
import { ElectoralCollege } from './pages/ElectoralCollege';
import { Senate } from './pages/Senate';
import { StateRedirect } from './pages/StateRedirect';
import type { ProjectionMeta, ProjectionPayload } from './lib/types';

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
            stale-data banner. They're chrome-less by design for iframe use. */}
        <Route path="/embed/national" element={<EmbedNational />} />
        <Route path="/embed/state/:code" element={<EmbedState />} />
        <Route element={<Layout meta={meta} />}>
          <Route path="/" element={<Home onMetaChange={handleMetaChange} />} />
          {/* Clean, shareable URLs for the two non-default views. All three
              render the same Home; the active view is derived from the path. */}
          <Route path="/retrospective" element={<Home onMetaChange={handleMetaChange} />} />
          <Route path="/sandbox" element={<Home onMetaChange={handleMetaChange} />} />
          <Route path="/rankings" element={<Rankings />} />
          <Route path="/methodology" element={<Methodology meta={meta} />} />
          {/* Quieter companion pages — linked from the About FAQ, not the nav. */}
          <Route path="/electoral-college" element={<ElectoralCollege />} />
          <Route path="/senate" element={<Senate />} />
          <Route path="/about" element={<About />} />
          <Route path="/state/:code" element={<StateRedirect />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
