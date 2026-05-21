import { useCallback, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ScrollManager } from './components/ScrollManager';
import { Home } from './pages/Home';
import { About } from './pages/About';
import { Methodology } from './pages/Methodology';
import { NotFound } from './pages/NotFound';
import { Rankings } from './pages/Rankings';
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
        <Route element={<Layout meta={meta} />}>
          <Route path="/" element={<Home onMetaChange={handleMetaChange} />} />
          <Route path="/rankings" element={<Rankings />} />
          <Route path="/methodology" element={<Methodology meta={meta} />} />
          <Route path="/about" element={<About />} />
          <Route path="/state/:code" element={<StateRedirect />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
