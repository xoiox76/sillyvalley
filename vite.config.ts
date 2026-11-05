import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  publicDir: false,
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2022' },
});
