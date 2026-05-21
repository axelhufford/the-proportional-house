import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // Split vendor code into long-lived cacheable chunks so app updates
        // don't bust the React + d3 + topojson bytes on repeat visits.
        // Recharts gets its own chunk automatically via React.lazy() in
        // src/components/StateDetail.tsx — no need to declare it here.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          // Only declare packages that are actually imported in src/.
          // us-atlas is fetched at runtime as JSON, d3-selection isn't
          // directly imported (it's a transitive dep) — listing them here
          // would crash Vite's resolver.
          'd3-geo': ['d3-geo', 'topojson-client'],
        },
      },
    },
  },
});
