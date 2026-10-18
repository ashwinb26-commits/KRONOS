import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Absolute base path, taken from BASE_PATH when it is set.
 *
 * It has to be absolute, never './'. The app has client-side routes
 * (/admin/historical and so on), and relative asset paths resolve differently
 * depending on how deep the current URL is, so nested routes would request
 * their scripts from the wrong place and render a blank page.
 *
 * Cloudflare Pages serves from the domain root, so '/' is right there. The
 * GitHub Pages workflow sets BASE_PATH to '/<repository name>/', because a
 * project site lives at https://<owner>.github.io/<repository name>/.
 */
const base = process.env.BASE_PATH ?? '/';
if (!base.startsWith('/') || !base.endsWith('/')) {
  throw new Error(`BASE_PATH must start and end with a slash, got "${base}".`);
}

export default defineConfig({
  base,
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
