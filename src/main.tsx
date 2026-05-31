import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// Self-hosted variable fonts (woff2 bundled + fingerprinted by Vite, served
// same-origin). Replaces the render-blocking Google Fonts <link> — faster first
// paint, no layout shift, no third-party request. Serif ships normal + italic
// (the masthead subtitle and retrospective copy use italic); Inter is body text
// only, so normal is enough.
import '@fontsource-variable/inter';
import '@fontsource-variable/source-serif-4';
import '@fontsource-variable/source-serif-4/wght-italic.css';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
