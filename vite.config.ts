import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The dashboard reaches SpacetimeDB through this server (/v1 -> the local database on
// port 3000), so a browser or phone only ever talks to the address it loaded the page
// from. No second port to open, and no cross-origin request to block.
const spacetime = { '/v1': { target: process.env.SPACETIME_HTTP ?? 'http://127.0.0.1:3000', ws: true, changeOrigin: true } };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: spacetime },
  preview: { proxy: spacetime },
});
