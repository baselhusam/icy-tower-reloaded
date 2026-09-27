// The arena: a small HTTP API + live event stream + static file server for the built game.
// No framework; the routes are few and the whole thing should be readable in one sitting.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { dailySeedKey, hashSeed } from '../src/engine/rng';
import {
  APP_ID,
  PLAYER_NAME_MAX,
  TOURNAMENT_NAME_MAX,
  type BoardEntry,
  type FinishedRun,
  type Hello,
  type NewTournament,
  type PlayerAuth,
  type StartedRun,
  type Tournament,
} from '../src/net/protocol';
import { sanitizeLook } from '../src/render/characters';
import type { PlayerRow, Store } from './db';
import { LiveHub } from './live';
import { verifyReplay } from './verify';

export interface ArenaOptions {
  store: Store;
  arena: string;
  version: string;
  adminKey: string;
  /** The built game (dist/client). Null when something else serves it, e.g. Vite in dev. */
  clientDir: string | null;
  /** Addresses to advertise to other players; filled in once the server is listening. */
  urls: () => string[];
  /** Treat requests from this machine as the host (default true). */
  localAdmin?: boolean;
  /** Requests that aren't API calls or static files go here (the Vite dev middleware). */
  fallback?: (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
}

/** Tournament runs still in the air when the clock runs out may land within this window. */
const TOURNAMENT_GRACE_MS = 60_000;
/** Results are announced once the last runs have had time to land. */
const RESULTS_DELAY_MS = 8_000;
const MAX_BODY = 2_500_000;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: string[];
  body: () => Promise<Record<string, unknown>>;
  player: () => PlayerRow;
  admin: () => void;
}

const cleanName = (raw: unknown, max: number, fallback: string) => {
  // eslint-disable-next-line no-control-regex
  const s = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  return s || fallback;
};

const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

export function createArena(opts: ArenaOptions) {
  const { store } = opts;
  const live = new LiveHub();
  const routes: { method: string; path: RegExp; handler: Handler }[] = [];
  const route = (method: string, path: string, handler: Handler) =>
    routes.push({ method, path: new RegExp(`^${path.replace(/:\w+/g, '([^/]+)')}$`), handler });

  const isAdmin = (req: IncomingMessage) => {
    const addr = req.socket.remoteAddress ?? '';
    const local = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
    return (local && opts.localAdmin !== false) || req.headers['x-admin-key'] === opts.adminKey;
  };

  const tournamentsNow = () => store.tournaments();

  // ---- API --------------------------------------------------------------------------------------

  route('GET', '/api/hello', ({ req }): Hello => ({
    app: APP_ID,
    version: opts.version,
    arena: opts.arena,
    serverTime: Date.now(),
    daily: dailySeedKey(),
    urls: opts.urls(),
    admin: isAdmin(req),
    tournaments: tournamentsNow(),
    presence: live.presence(),
  }));

  // Create a player, or update the calling player's name and outfit.
  route('POST', '/api/players', async ({ req, body }): Promise<PlayerAuth> => {
    const b = await body();
    const name = cleanName(b.name, PLAYER_NAME_MAX, 'Player');
    const look = sanitizeLook(b.look);
    const auth = parseAuth(req);
    if (auth && store.authenticate(auth.id, auth.token)) {
      store.updatePlayer(auth.id, name, look);
      return auth;
    }
    return store.createPlayer(name, look);
  });

  // EventSource can't send headers, so the player id (not the token) rides in the query. It only
  // feeds the "N online" counter.
  route('GET', '/api/me/attempts', ({ player }) => store.tournamentAttempts(player().id));

  route('GET', '/api/live', ({ req, res, url }) => {
    const player = url.searchParams.get('player');
    live.subscribe(req, res, player && player.length <= 64 ? player : null);
    return STREAMING;
  });

  route('POST', '/api/runs', async ({ body, player }): Promise<StartedRun> => {
    const p = player();
    const b = await body();
    let board: string;
    let seed: number;
    let attemptsLeft: number | null = null;
    if (b.mode === 'daily') {
      board = `daily:${dailySeedKey()}`;
      seed = hashSeed(board);
    } else if (b.mode === 'tournament') {
      const t = store.tournament(String(b.tournamentId ?? ''));
      if (!t) throw new HttpError(404, 'No such tournament');
      if (t.status === 'upcoming') throw new HttpError(409, `${t.name} hasn't started yet`);
      if (t.status === 'finished') throw new HttpError(409, `${t.name} is over`);
      if (t.maxAttempts != null) {
        const used = store.attempts(p.id, t.board);
        if (used >= t.maxAttempts) throw new HttpError(409, `No attempts left in ${t.name}`);
        attemptsLeft = t.maxAttempts - used - 1;
      }
      board = t.board;
      seed = t.seed;
    } else {
      board = 'endless';
      seed = (Math.random() * 2 ** 32) >>> 0;
    }
    const runId = store.startRun(p, board, seed);
    live.climbing({ runId, playerId: p.id, name: p.name, look: p.look, board, floor: 0, score: 0, startedAt: Date.now() });
    return { runId, seed, board, attemptsLeft };
  });

  route('POST', '/api/runs/:id/progress', async ({ params, body, player }) => {
    const p = player();
    const run = store.getRun(params[0]);
    if (!run || run.playerId !== p.id) throw new HttpError(404, 'No such run');
    if (run.status !== 'started') return null;
    const b = await body();
    live.climbing({
      runId: run.id,
      playerId: p.id,
      name: p.name,
      look: p.look,
      board: run.board,
      floor: num(b.floor, 0, 1e6, 0),
      score: num(b.score, 0, 1e9, 0),
      startedAt: run.startedAt,
    });
    return null;
  });

  route('POST', '/api/runs/:id/finish', async ({ params, body, player }): Promise<FinishedRun> => {
    const p = player();
    const run = store.getRun(params[0]);
    if (!run || run.playerId !== p.id) throw new HttpError(404, 'No such run');
    if (run.status !== 'started') throw new HttpError(409, 'This run was already submitted');
    const b = await body();
    const now = Date.now();
    const tournament = run.board.startsWith('tournament:') ? store.tournament(run.board.slice('tournament:'.length)) : null;
    live.landed(run.id);
    if (run.board.startsWith('tournament:') && !tournament) {
      store.rejectRun(run.id, 'tournament was deleted');
      throw new HttpError(410, 'That tournament was deleted');
    }
    if (tournament && now > tournament.endsAt + TOURNAMENT_GRACE_MS) {
      store.rejectRun(run.id, 'submitted after the tournament closed');
      throw new HttpError(409, `${tournament.name} is closed`);
    }

    const verdict = verifyReplay(b.replay, {
      seed: run.seed,
      startedAt: run.startedAt,
      now,
      allowUnfinished: !!tournament && now >= tournament.endsAt - 3000,
    });
    if (!verdict.ok) {
      store.rejectRun(run.id, verdict.reason);
      throw new HttpError(422, `Run rejected: ${verdict.reason}`);
    }

    const s = verdict.state;
    const previousBest = store.bestScore(p.id, run.board);
    store.finishRun(run.id, {
      score: s.score,
      floor: s.floor,
      combo: s.stats.bestComboFloors,
      gems: s.stats.gems,
      jumps: s.stats.jumps,
      ticks: verdict.ticks,
      replay: String((b.replay as { inputs: string }).inputs),
    });
    const board = store.board(run.board, 10_000);
    const entry = board.find((e) => e.playerId === p.id)!;
    const personalBest = s.score > previousBest;
    live.broadcast({ type: 'run', board: run.board, entry, personalBest });
    if (tournament) live.broadcast({ type: 'tournaments', tournaments: tournamentsNow() });
    return { board: run.board, score: s.score, floor: s.floor, rank: entry.rank, players: board.length, personalBest, previousBest };
  });

  route('GET', '/api/runs/:id/replay', ({ params }) => {
    const r = store.replay(params[0]);
    if (!r) throw new HttpError(404, 'No such run');
    return { version: 1, ...r };
  });

  route('GET', '/api/boards/:board', ({ params, url }): BoardEntry[] => {
    let board: string;
    try {
      board = decodeURIComponent(params[0]);
    } catch {
      throw new HttpError(400, 'Bad board name');
    }
    if (board === 'daily') board = `daily:${dailySeedKey()}`;
    return store.board(board, num(url.searchParams.get('limit'), 1, 500, 50));
  });

  route('GET', '/api/characters', () => store.characters());

  route('GET', '/api/tournaments', () => tournamentsNow());

  route('POST', '/api/tournaments', async ({ body, admin }): Promise<Tournament> => {
    admin();
    const b = (await body()) as Partial<NewTournament>;
    const startsAt = Date.now() + num(b.startsInMinutes, 0, 7 * 24 * 60, 0) * 60_000;
    const t = store.createTournament({
      name: cleanName(b.name, TOURNAMENT_NAME_MAX, 'Tournament'),
      startsAt,
      endsAt: startsAt + num(b.minutes, 1, 7 * 24 * 60, 15) * 60_000,
      maxAttempts: b.maxAttempts ? num(b.maxAttempts, 1, 1000, 3) : null,
    });
    announceTournaments();
    return t;
  });

  route('POST', '/api/tournaments/:id/end', ({ params, admin }) => {
    admin();
    store.endTournament(params[0]);
    announceTournaments();
    return store.tournament(params[0]);
  });

  route('DELETE', '/api/tournaments/:id', ({ params, admin }) => {
    admin();
    store.deleteTournament(params[0]);
    announceTournaments();
    return null;
  });

  // ---- tournament clock ---------------------------------------------------------------------------
  // Tournaments start and end on their own (and may be created from the CLI while we run), so
  // poll the table and tell everyone when anything changes.

  let signature = '';
  const announced = new Set<string>();
  function announceTournaments() {
    const list = tournamentsNow();
    signature = list.map((t) => `${t.id}:${t.status}:${t.endsAt}`).join('|');
    live.broadcast({ type: 'tournaments', tournaments: list });
  }
  const clock = setInterval(() => {
    const list = tournamentsNow();
    const sig = list.map((t) => `${t.id}:${t.status}:${t.endsAt}`).join('|');
    if (sig !== signature) announceTournaments();
    const now = Date.now();
    for (const t of list) {
      const due = t.endsAt + RESULTS_DELAY_MS;
      if (t.status === 'finished' && now >= due && now - due < 120_000 && !announced.has(t.id)) {
        announced.add(t.id);
        live.broadcast({ type: 'tournamentResult', tournament: t, podium: store.board(t.board, 3) });
      }
    }
  }, 2000);
  signature = tournamentsNow()
    .map((t) => `${t.id}:${t.status}:${t.endsAt}`)
    .join('|');

  // ---- request handling ---------------------------------------------------------------------------

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://arena');
    try {
      if (url.pathname.startsWith('/api/')) {
        const method = req.method ?? 'GET';
        for (const r of routes) {
          const m = r.path.exec(url.pathname);
          if (!m || r.method !== method) continue;
          const ctx: Ctx = {
            req,
            res,
            url,
            params: m.slice(1),
            body: () => readJson(req),
            player: () => {
              const auth = parseAuth(req);
              const p = auth && store.authenticate(auth.id, auth.token);
              if (!p) throw new HttpError(401, 'Unknown player');
              return p;
            },
            admin: () => {
              if (!isAdmin(req)) throw new HttpError(403, 'Only the host can do that');
            },
          };
          const out = await r.handler(ctx);
          if (out === STREAMING) return;
          if (out === null || out === undefined) {
            res.writeHead(204, { 'cache-control': 'no-store' }).end();
          } else {
            sendJson(res, 200, out);
          }
          return;
        }
        throw new HttpError(404, 'Not found');
      }
      if (opts.clientDir && (await serveStatic(opts.clientDir, url.pathname, req, res))) return;
      if (opts.fallback) {
        opts.fallback(req, res, () => sendText(res, 404, 'Not found'));
        return;
      }
      sendText(res, 404, 'Not found');
    } catch (err) {
      if (res.headersSent) return void res.end();
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
      console.error(err);
      sendJson(res, 500, { error: 'Something went wrong on the arena server' });
    }
  }

  return {
    handle,
    live,
    close() {
      clearInterval(clock);
      live.close();
    },
  };
}

export type Arena = ReturnType<typeof createArena>;

// ---- helpers ----------------------------------------------------------------------------------------

const STREAMING = Symbol('streaming');

function parseAuthString(s: string | null | undefined): { id: string; token: string } | null {
  if (!s) return null;
  const i = s.indexOf(':');
  return i > 0 ? { id: s.slice(0, i), token: s.slice(i + 1) } : null;
}

function parseAuth(req: IncomingMessage) {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? parseAuthString(h.slice(7)) : null;
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Request too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!size) return resolveBody({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolveBody(v && typeof v === 'object' ? v : {});
      } catch {
        reject(new HttpError(400, 'Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function sendText(res: ServerResponse, status: number, text: string) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const PAGES: Record<string, string> = { '/': '/index.html', '/tv': '/tv.html' };

async function serveStatic(root: string, pathname: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let rel: string;
  try {
    rel = PAGES[pathname] ?? decodeURIComponent(pathname);
  } catch {
    return false;
  }
  const base = resolve(root);
  const file = resolve(join(base, rel));
  if (file !== base && !file.startsWith(base + sep)) return false;
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return false;
  const hashed = rel.startsWith('/assets/');
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'content-length': info.size,
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
  return true;
}
