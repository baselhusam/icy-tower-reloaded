// `npm run dev:arena` — the arena server with Vite in middleware mode: one port, the real API,
// and hot reload for the game. Not part of the published package.
import { resolve } from 'node:path';
import { createServer as createVite } from 'vite';
import { printBanner, startArena } from './serve';

const options = {
  port: Number(process.env.PORT ?? 4747),
  host: '0.0.0.0',
  db: resolve(process.env.ICY_TOWER_DB ?? '.arena/dev.db'),
  arena: 'Dev Arena',
  dev: async (server: import('node:http').Server) => {
    const vite = await createVite({ server: { middlewareMode: true, hmr: { server } }, appType: 'mpa' });
    return (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => {
      if (req.url === '/tv' || req.url?.startsWith('/tv?')) req.url = req.url.replace('/tv', '/tv.html');
      vite.middlewares(req, res, next);
    };
  },
};

const arena = await startArena(options);
printBanner(arena, options);
