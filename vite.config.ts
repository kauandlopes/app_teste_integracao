import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/erp-simulador/',
  root: 'src/client',
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: true,
    port: 5174,
    proxy: {
      '/erp-simulador/api': {
        target: 'http://127.0.0.1:3004',
        changeOrigin: true,
      },
    },
  },
  plugins: [react()],
});
