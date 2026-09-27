// `npx icy-tower-reloaded` — host the game for everyone on your network.
import { spawn } from 'node:child_process';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { tournamentStatus } from '../src/net/protocol';
import { Store } from './db';
import { c, DEFAULT_DB, DEFAULT_PORT, packageVersion, printBanner, startArena } from './serve';

const HELP = `
${c.bold('🐧 icy-tower-reloaded')} — host Icy Tower for your office or LAN

${c.bold('Usage')}
  npx icy-tower-reloaded [serve] [options]      start the arena (default)
  npx icy-tower-reloaded scores [board]         print a leaderboard
  npx icy-tower-reloaded tournament <command>   manage tournaments

${c.bold('Serve options')}
  -p, --port <n>         port to listen on            (default ${DEFAULT_PORT}, env PORT)
  -H, --host <addr>      interface to bind            (default 0.0.0.0 = whole network)
  -n, --name <text>      arena name shown to players  (default "<hostname> Arena")
      --db <file>        SQLite database file         (default ~/.icy-tower-reloaded/arena.db)
      --admin-key <key>  key that unlocks hosting from other machines (default: generated, saved in the db)
  -o, --open             open the game in your browser

${c.bold('Leaderboards')}
  scores                 all-time endless board
  scores daily           today's Daily Tower
  scores <tournament-id> a tournament's standings
      --limit <n>        rows to print (default 10)

${c.bold('Tournaments')}
  tournament list
  tournament create "<name>" --minutes 30 [--attempts 3] [--starts-in 5]
  tournament end <id>

${c.bold('Other')}
  -v, --version          print the version
  -h, --help             show this help

Everything is stored in one SQLite file. Scores are verified by replaying every run on the
server, so nobody can post a fake score. Requires Node.js 22.13 or newer.
`;

function fail(msg: string): never {
  console.error(`${c.red('✖')} ${msg}`);
  process.exit(1);
}

function openBrowser(url: string) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

async function main() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) fail(`Node.js 22.13+ is required (you have ${process.versions.node}).`);

  const { values: v, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: 'string', short: 'p' },
      host: { type: 'string', short: 'H' },
      name: { type: 'string', short: 'n' },
      db: { type: 'string' },
      'admin-key': { type: 'string' },
      open: { type: 'boolean', short: 'o' },
      limit: { type: 'string' },
      minutes: { type: 'string' },
      attempts: { type: 'string' },
      'starts-in': { type: 'string' },
      version: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (v.help) return void console.log(HELP);
  if (v.version) return void console.log(packageVersion());

  const db = resolve(v.db ?? process.env.ICY_TOWER_DB ?? DEFAULT_DB);
  const [command = 'serve', ...args] = positionals;

  switch (command) {
    case 'serve':
      return serve(db, v);
    case 'scores':
      return scores(db, args[0] ?? 'endless', Number(v.limit ?? 10));
    case 'tournament':
    case 'tournaments':
      return tournament(db, args, v);
    default:
      fail(`Unknown command "${command}". Try --help.`);
  }
}

async function serve(db: string, v: Record<string, string | boolean | undefined>) {
  const port = Number(v.port ?? process.env.PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`Invalid port: ${v.port}`);
  const options = {
    port,
    host: String(v.host ?? process.env.HOST ?? '0.0.0.0'),
    db,
    arena: String(v.name ?? process.env.ICY_TOWER_ARENA ?? `${hostname().replace(/\.local$/, '')} Arena`),
    adminKey: (v['admin-key'] as string | undefined) ?? process.env.ICY_TOWER_ADMIN_KEY,
  };
  let arena;
  try {
    arena = await startArena(options);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'EADDRINUSE') fail(`Port ${port} is already in use. Pick another with --port.`);
    throw err;
  }
  printBanner(arena, options);
  if (v.open) openBrowser(arena.local);

  const stop = () => {
    console.log(c.dim('\n  Closing the arena. Scores are saved.'));
    arena.close().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

async function scores(db: string, which: string, limit: number) {
  const store = await Store.open(db);
  try {
    let board = which;
    let title = 'Endless · all time';
    if (which === 'daily' || which === 'today') {
      board = `daily:${new Date().toISOString().slice(0, 10)}`;
      title = `Daily Tower · ${board.slice(6)}`;
    } else if (which !== 'endless') {
      const t = store.tournament(which.replace(/^tournament:/, ''));
      if (!t) fail(`No board or tournament called "${which}".`);
      board = t.board;
      title = `${t.name} · ${t.status}`;
    }
    const rows = store.board(board, limit);
    console.log(`\n  🏆 ${c.bold(title)}\n`);
    if (!rows.length) console.log(c.dim('  No verified runs yet.\n'));
    for (const r of rows) {
      const medal = ['🥇', '🥈', '🥉'][r.rank - 1] ?? `${String(r.rank).padStart(2)}.`;
      console.log(
        `  ${medal} ${r.name.padEnd(17)} ${c.bold(r.score.toLocaleString().padStart(9))}  ${c.dim(`floor ${r.floor} · combo ${r.combo} · ${r.look.char} · ${r.runs} run${r.runs === 1 ? '' : 's'}`)}`,
      );
    }
    console.log('');
  } finally {
    store.close();
  }
}

async function tournament(db: string, args: string[], v: Record<string, string | boolean | undefined>) {
  const store = await Store.open(db);
  try {
    const [sub = 'list', arg] = args;
    if (sub === 'list' || sub === 'ls') {
      const list = store.tournaments(50);
      if (!list.length) return void console.log(c.dim('\n  No tournaments yet. Create one with: tournament create "Friday Cup" --minutes 30\n'));
      console.log('');
      for (const t of list) {
        const when =
          t.status === 'upcoming'
            ? `starts ${new Date(t.startsAt).toLocaleString()}`
            : t.status === 'live'
              ? `ends ${new Date(t.endsAt).toLocaleTimeString()}`
              : `ended ${new Date(t.endsAt).toLocaleString()}`;
        const badge = t.status === 'live' ? c.green('● live') : t.status === 'upcoming' ? c.yellow('◷ soon') : c.dim('■ done');
        const leader = t.leader ? `leader ${t.leader.name} (${t.leader.score.toLocaleString()})` : 'no runs yet';
        console.log(`  ${badge}  ${c.bold(t.name)} ${c.dim(`[${t.id}]`)}  ${c.dim(`${when} · ${t.players} players · ${leader}`)}`);
      }
      return void console.log('');
    }
    if (sub === 'create' || sub === 'new') {
      if (!arg) fail('Give the tournament a name: tournament create "Friday Cup" --minutes 30');
      const minutes = Number(v.minutes ?? 15);
      const startsIn = Number(v['starts-in'] ?? 0);
      const attempts = v.attempts ? Number(v.attempts) : null;
      if (!(minutes > 0) || !(startsIn >= 0) || (attempts !== null && !(attempts >= 1))) fail('Check --minutes, --starts-in and --attempts.');
      const startsAt = Date.now() + startsIn * 60_000;
      const t = store.createTournament({ name: arg.slice(0, 32), startsAt, endsAt: startsAt + minutes * 60_000, maxAttempts: attempts });
      console.log(`\n  ${c.green('✔')} Created ${c.bold(t.name)} ${c.dim(`[${t.id}]`)} · ${tournamentStatus(t, Date.now())} · ${minutes} min${attempts ? ` · ${attempts} attempts` : ''}`);
      console.log(c.dim('  A running arena picks it up within a couple of seconds.\n'));
      return;
    }
    if (sub === 'end') {
      const t = arg && store.tournament(arg);
      if (!t) fail(`No tournament with id "${arg ?? ''}". See: tournament list`);
      store.endTournament(t.id);
      return void console.log(`\n  ${c.green('✔')} Ended ${c.bold(t.name)}.\n`);
    }
    fail(`Unknown tournament command "${sub}". Use list, create or end.`);
  } finally {
    store.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
