import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { usageApi } from './vite.usage-plugin.js';

export default defineConfig({
  plugins: [react(), usageApi()],
  // Assets are loaded from file:// once packaged, so paths must be relative.
  base: './',
  server: { port: 5273 },
  build: { outDir: 'dist' },
});
