import { defineConfig } from 'vite';

export default defineConfig({
  root: 'demo',
  server: {
    host: '0.0.0.0'
  },
  build: {
    outDir: '../dist-demo',
    emptyOutDir: true
  }
});
