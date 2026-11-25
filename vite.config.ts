import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    // When the app is served through the platform's preview proxy the HMR
    // WebSocket cannot connect and Vite's fallback behaviour is a full page
    // reload — which looked like "login just reloads the page". Only enable HMR
    // for direct local development.
    hmr: process.env.DISABLE_HMR === '1' ? false : { overlay: false },
  },
  build: { outDir: 'dist', sourcemap: false, target: 'es2020' },
});
