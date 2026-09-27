import { defineConfig } from 'vite';

export default defineConfig({
  // Rutas relativas: el resultado de `npm run build` funciona en cualquier subcarpeta
  // (p. ej. GitHub Pages).
  base: './',
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 1200 },
  optimizeDeps: { exclude: ['manifold-3d'] },
});
