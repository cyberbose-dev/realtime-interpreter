import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/**
 * `npm run dev` only: serves /config.json and /api/* by running lambda/api.ts locally
 * with your AWS credentials (e.g. AWS_PROFILE=xxx npm run dev). Login is skipped.
 */
function localApi(): Plugin {
  return {
    name: 'local-api',
    apply: 'serve',
    configureServer(server) {
      process.env.AWS_REGION ??= 'ap-northeast-1';
      process.env.DRAFT_MODEL_ID ??= 'jp.amazon.nova-2-lite-v1:0';
      process.env.FINAL_MODEL_ID ??= 'jp.anthropic.claude-haiku-4-5-20251001-v1:0';
      server.middlewares.use(async (req, res, next) => {
        if (req.url === '/config.json') {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ region: process.env.AWS_REGION, clientId: '', cognitoDomain: '', dev: true }));
          return;
        }
        const m = req.method === 'POST' && req.url?.match(/^\/api\/([a-z-]+)$/);
        if (!m) return next();
        let body = '';
        for await (const chunk of req) body += chunk;
        const api = await server.ssrLoadModule(fileURLToPath(new URL('../lambda/api.ts', import.meta.url)));
        const out = await api.handler({ pathParameters: { op: m[1] }, body });
        res.statusCode = out.statusCode;
        res.setHeader('content-type', 'application/json');
        res.end(out.body);
      });
    },
  };
}

export default defineConfig({
  root: import.meta.dirname,
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  server: { fs: { allow: ['..'] } },
  plugins: [localApi()],
});
