// Boots an arena: opens the database, starts the HTTP server and prints where to join.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { homedir, networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createArena } from './app';
import { Store } from './db';

// node:sqlite still prints an "experimental" warning on load; it's stable enough for us.
const emitWarning = process.emitWarning;
process.emitWarning = function (warning: string | Error, ...rest: unknown[]) {
  const type = typeof rest[0] === 'string' ? rest[0] : (rest[0] as { type?: string } | undefined)?.type;
  if (type === 'ExperimentalWarning' && String(warning).includes('SQLite')) return;
  return (emitWarning as (...a: unknown[]) => void).call(process, warning, ...rest);
} as typeof process.emitWarning;

export const DEFAULT_PORT = 4747;
export const DEFAULT_DB = join(homedir(), '.icy-tower-reloaded', 'arena.db');

type Fallback = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

export interface ServeOptions {
  port: number;
  host: string;
  db: string;
  arena: string;
  adminKey?: string;
  localAdmin?: boolean;
  /** Dev only: hands back a middleware (Vite) that serves the client instead of dist/client. */
  dev?: (server: Server) => Promise<Fallback>;
}

const here = dirname(fileURLToPath(import.meta.url));

/** Walks up from this file to the package root (works from server/ in dev and dist/server/ when installed). */
function packageRoot(): string {
  let dir = here;
  for (let i = 0; i < 4; i++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg) && JSON.parse(readFileSync(pkg, 'utf8')).name === 'icy-tower-reloaded') return dir;
    dir = dirname(dir);
  }
  return resolve(here, '..');
}

export function packageVersion(): string {
  try {
    return JSON.parse(readFileSync(join(packageRoot(), 'package.json'), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

function clientDir(): string | null {
  const dir = join(packageRoot(), 'dist', 'client');
  return existsSync(join(dir, 'index.html')) ? dir : null;
}

/** Every IPv4 address other machines on the network might reach us at. */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

export async function startArena(o: ServeOptions) {
  const store = await Store.open(o.db);
  const adminKey = o.adminKey || store.getMeta('admin_key') || randomBytes(9).toString('base64url');
  store.setMeta('admin_key', adminKey);

  const server = createServer();
  const fallback = o.dev ? await o.dev(server) : undefined;
  const client = o.dev ? null : clientDir();
  if (!o.dev && !client) console.warn('⚠️  No built game found (dist/client). Run `npm run build` first; the API still works.');

  let port = o.port;
  const wildcard = o.host === '0.0.0.0' || o.host === '::';
  const urls = () => (wildcard ? lanAddresses() : [o.host]).map((ip) => `http://${ip}:${port}`);
  const arena = createArena({ store, arena: o.arena, version: packageVersion(), adminKey, localAdmin: o.localAdmin, clientDir: client, urls, fallback });
  server.on('request', arena.handle);

  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(o.port, o.host, () => {
      server.off('error', fail);
      ok();
    });
  });
  const addr = server.address();
  if (addr && typeof addr === 'object') port = addr.port;

  let closing: Promise<void> | null = null;
  const close = () =>
    (closing ??= new Promise<void>((done) => {
      arena.close();
      server.close(() => {
        store.close();
        done();
      });
      server.closeAllConnections();
    }));

  return { server, store, arena, port, adminKey, urls, local: `http://localhost:${port}`, close };
}

export type RunningArena = Awaited<ReturnType<typeof startArena>>;

// ---- banner -------------------------------------------------------------------------------------------

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const c = { bold: paint('1'), dim: paint('2'), cyan: paint('36'), green: paint('32'), yellow: paint('33'), magenta: paint('35'), red: paint('31') };

export function printBanner(a: RunningArena, o: ServeOptions) {
  const lan = a.urls().filter((u) => !u.includes('localhost'));
  const lines = [
    '',
    `  🐧 ${c.bold(c.cyan('Icy Tower Reloaded'))} ${c.dim(`v${packageVersion()}`)} · ${c.bold(o.arena)}`,
    '',
    `  🎮 Play here        ${c.bold(a.local)}`,
    ...(lan.length
      ? lan.map((u, i) => `  ${i === 0 ? '🌐 Share with team' : '                 '}  ${c.bold(c.cyan(u))}`)
      : [`  🔒 Only reachable from this machine (listening on ${o.host})`]),
    `  📺 Big screen       ${(lan[0] ?? a.local) + '/tv'}`,
    `  🔑 Host link        ${c.dim(`${lan[0] ?? a.local}/?admin=${a.adminKey}`)}`,
    `  💾 Database         ${c.dim(o.db)}`,
    '',
    c.dim('  Anyone on your network can open the link and join. Press Ctrl+C to stop.'),
    '',
  ];
  console.log(lines.join('\n'));
}
