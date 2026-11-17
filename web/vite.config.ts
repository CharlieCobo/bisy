import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `vite build --mode pages` genera la versión para GitHub Pages (todo en el navegador),
// servida en https://<usuario>.github.io/bisy/
export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/bisy/' : '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4000' },
  },
  optimizeDeps: { exclude: ['sql.js'] },
}));
