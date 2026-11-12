import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';

const page = (f) => fileURLToPath(new URL(f, import.meta.url));

// Runs /api/agent inside `npm run dev`, so you don't need the Vercel CLI locally.
function localApi(env) {
  return {
    name: 'local-api',
    configureServer(server) {
      server.middlewares.use('/api/agent', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
        let raw = ''; for await (const chunk of req) raw += chunk;
        const { handleAgentRequest } = await server.ssrLoadModule('/api/_agent.js');
        const { status, json } = await handleAgentRequest(JSON.parse(raw || '{}'), env);
        res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(json));
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') }; // '' = also load non-VITE_ vars (server only)
  return {
    plugins: [localApi(env)],
    build: {
      rollupOptions: {
        input: { main: page('./index.html'), kid: page('./kid.html'), teacher: page('./teacher.html') },
      },
    },
  };
});
