import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Relative base path.
 *
 * The starter used './' so it could sit under a GitHub Pages project URL. This
 * A relative base keeps the static dashboard usable when GitHub Pages serves
 * it from a repository project URL instead of a custom domain root.
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    // One vendor chunk for React keeps the admin and public bundles small
    // enough that a first visit to the dashboard does not download the editor.
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules/react') ? 'react' : undefined),
      },
    },
  },
});
