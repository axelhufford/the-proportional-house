import { useCallback, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { Methodology } from './pages/Methodology';
import type { ProjectionMeta, ProjectionPayload } from './lib/types';

export default function App() {
  const [meta, setMeta] = useState<ProjectionMeta | undefined>();

  const handleMetaChange = useCallback((payload: ProjectionPayload) => {
    setMeta(payload.meta);
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout meta={meta} />}>
          <Route path="/" element={<Home onMetaChange={handleMetaChange} />} />
          <Route path="/methodology" element={<Methodology meta={meta} />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
