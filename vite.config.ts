import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { configFromEnv } from './server/nemotron/client.ts';
import { formatFinding } from './server/nora/format.ts';

// The dashboard reaches SpacetimeDB through this server (/v1 -> the local database on
// port 3000), so a browser or phone only ever talks to the address it loaded the page
// from. No second port to open, and no cross-origin request to block.
const spacetime = { '/v1': { target: process.env.SPACETIME_HTTP ?? 'http://127.0.0.1:3000', ws: true, changeOrigin: true } };

/**
 * POST /api/nora/format {notes} -> {title, source, text}: Nora (Nemotron) tidies rough
 * notes into a finding for a person to review. The NVIDIA key stays in this server's
 * .env and is never sent to the browser. Nothing is saved here.
 */
function noraFormat(env: Record<string, string>): Plugin {
  const handler = async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
    const send = (status: number, body: unknown) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
    if (req.method !== 'POST') return send(405, { error: 'POST only' });
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 20_000) return send(413, { error: 'Notes are too long.' }); }
    try {
      const { notes } = JSON.parse(raw || '{}') as { notes?: unknown };
      if (typeof notes !== 'string') return send(400, { error: 'Send {"notes": "..."}' });
      send(200, await formatFinding(configFromEnv(env), notes));
    } catch (e) {
      send(502, { error: (e as Error).message });
    }
  };
  return {
    name: 'nora-format',
    configureServer(server) { server.middlewares.use('/api/nora/format', (req, res) => void handler(req, res)); },
    configurePreviewServer(server) { server.middlewares.use('/api/nora/format', (req, res) => void handler(req, res)); },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env } as Record<string, string>;
  return {
    plugins: [react(), tailwindcss(), noraFormat(env)],
    // allowedHosts: a tunnel (cloudflared, ngrok) can serve the dashboard to teammates on any network.
    server: { proxy: spacetime, allowedHosts: true },
    preview: { proxy: spacetime, allowedHosts: true },
  };
});
