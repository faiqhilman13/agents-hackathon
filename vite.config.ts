import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({
  plugins: [react()], base: './',
  build: { outDir: 'dist/extension', rollupOptions: { input: {
    library: resolve('index.html'), popup: resolve('popup.html'), panel: resolve('panel.html')
  } } }
});
