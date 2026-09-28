// SQLite storage via Node's built-in node:sqlite, so the package has no native dependencies.
// Everything the arena remembers lives in one file: players, every run (with its replay) and
// tournaments. Scores only ever come from server-verified replays.
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { CHARACTERS, sanitizeLook, type Look } from '../src/render/characters';
import {
  PLAYER_NAME_MAX,
  tournamentStatus,
  type BoardEntry,
  type BoardKey,
  type CharacterStat,
  type Me,
  type RemovedPlayer,
  type RosterEntry,
  type Tournament,
} from '../src/net/protocol';

const SCHEMA_VERSION = 2;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS players (
  id         TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL DEFAULT '', -- unused since v2: tokens live in sessions
  name       TEXT NOT NULL,
  look       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  name_key   TEXT,    -- lower-cased name; unique among players that aren't removed
  pin_hash   TEXT,    -- optional PIN needed to play as this climber on another device
  deleted_at INTEGER, -- removed by someone; purged for good after REMOVED_DAYS
  deleted_by TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tournaments (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  seed         INTEGER NOT NULL,
  starts_at    INTEGER NOT NULL,
  ends_at      INTEGER NOT NULL,
  max_attempts INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id            TEXT PRIMARY KEY,
  player_id     TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  board         TEXT NOT NULL,
  seed          INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'started', -- started | verified | rejected
  character     TEXT NOT NULL,
  look          TEXT NOT NULL,
  started_at    INTEGER NOT NULL,
  finished_at   INTEGER,
  score         INTEGER,
  floor         INTEGER,
  combo         INTEGER,
  gems          INTEGER,
  jumps         INTEGER,
  ticks         INTEGER,
  replay        TEXT,
  reject_reason TEXT
);
CREATE INDEX IF NOT EXISTS runs_by_board  ON runs(board, status, score DESC);
CREATE INDEX IF NOT EXISTS runs_by_player ON runs(player_id, board);
`;

export type PlayerRow = Me;

export interface RunRow {
  id: string;
  playerId: string;
  board: BoardKey;
  seed: number;
  status: 'started' | 'verified' | 'rejected';
  startedAt: number;
}

export interface RunResult {
  score: number;
  floor: number;
  combo: number;
  gems: number;
  jumps: number;
  ticks: number;
  replay: string;
}

interface TournamentRow {
  id: string;
  name: string;
  seed: number;
  starts_at: number;
  ends_at: number;
  max_attempts: number | null;
}

type Row = Record<string, SQLInputValue>;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const hashPin = (playerId: string, pin: string) => scryptSync(pin, `icy-tower-pin:${playerId}`, 32).toString('hex');

/** Names are unique regardless of case, so "sam" can't sneak in next to "Sam". */
export const nameKey = (name: string) => name.normalize('NFKC').toLowerCase();

/** `name`, or "name 2", "name 3"… for the first one `taken` doesn't claim. */
export function uniqueName(name: string, taken: (key: string) => boolean): string {
  if (!taken(nameKey(name))) return name;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = name.slice(0, PLAYER_NAME_MAX - suffix.length).trimEnd() + suffix;
    if (!taken(nameKey(candidate))) return candidate;
  }
}

const isUniqueViolation = (err: unknown) => err instanceof Error && /UNIQUE constraint failed/.test(err.message);
const parseLook = (json: unknown) => {
  try {
    return sanitizeLook(JSON.parse(String(json)));
  } catch {
    return sanitizeLook(null);
  }
};

const toPlayer = (r: Row): PlayerRow => ({ id: String(r.id), name: String(r.name), look: parseLook(r.look), pin: r.pin_hash != null });

export class Store {
  private constructor(readonly db: DatabaseSync) {}

  static async open(file: string): Promise<Store> {
    // Loaded lazily so the CLI can silence node:sqlite's "experimental" warning first.
    const { DatabaseSync } = await import('node:sqlite');
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
    db.exec(SCHEMA);
    const store = new Store(db);
    store.migrate();
    return store;
  }

  private migrate() {
    const version = Number(this.getMeta('schema_version') ?? 0);
    if (version < 2) {
      this.db.exec('BEGIN');
      try {
        // v2: unique names, optional PINs, removal, and sessions so one climber can be signed in
        // on several devices at once.
        const cols = new Set(this.all<Row>('PRAGMA table_info(players)').map((r) => String(r.name)));
        for (const col of ['name_key TEXT', 'pin_hash TEXT', 'deleted_at INTEGER', 'deleted_by TEXT']) {
          if (!cols.has(col.split(' ')[0])) this.db.exec(`ALTER TABLE players ADD COLUMN ${col}`);
        }
        this.run(
          `INSERT OR IGNORE INTO sessions (token_hash, player_id, created_at, last_seen)
           SELECT token_hash, id, created_at, last_seen FROM players WHERE token_hash != ''`,
        );
        // Older arenas registered a new player per browser, so there may be several "Sam"s. The
        // first of each keeps the name; later ones become "Sam 2" and so on.
        const players = this.all<Row>('SELECT id, name FROM players ORDER BY created_at');
        const taken = new Set<string>();
        const dupes = new Set<Row>();
        for (const p of players) {
          const key = nameKey(String(p.name));
          if (taken.has(key)) dupes.add(p);
          else taken.add(key);
        }
        for (const p of players) {
          const name = dupes.has(p) ? uniqueName(String(p.name), (k) => taken.has(k)) : String(p.name);
          taken.add(nameKey(name));
          this.run("UPDATE players SET name = ?, name_key = ?, token_hash = '' WHERE id = ?", name, nameKey(name), p.id);
        }
        this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS players_by_name ON players(name_key) WHERE deleted_at IS NULL');
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    }
    this.setMeta('schema_version', String(SCHEMA_VERSION));
  }

  close() {
    this.db.close();
  }

  private get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  private all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  private run(sql: string, ...params: SQLInputValue[]) {
    return this.db.prepare(sql).run(...params);
  }

  // ---- meta -----------------------------------------------------------------------------------

  getMeta(key: string): string | undefined {
    return this.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', key)?.value;
  }

  setMeta(key: string, value: string) {
    this.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  }

  // ---- players --------------------------------------------------------------------------------

  /** Null when the name is already taken. */
  createPlayer(name: string, look: Look, pin: string | null): { id: string; token: string } | null {
    const id = randomUUID();
    const now = Date.now();
    try {
      this.run(
        "INSERT INTO players (id, token_hash, name, name_key, look, pin_hash, created_at, last_seen) VALUES (?, '', ?, ?, ?, ?, ?, ?)",
        id,
        name,
        nameKey(name),
        JSON.stringify(look),
        pin ? hashPin(id, pin) : null,
        now,
        now,
      );
    } catch (err) {
      if (isUniqueViolation(err)) return null;
      throw err;
    }
    return { id, token: this.newSession(id) };
  }

  newSession(playerId: string): string {
    const token = randomBytes(24).toString('base64url');
    const now = Date.now();
    this.run('INSERT INTO sessions (token_hash, player_id, created_at, last_seen) VALUES (?, ?, ?, ?)', hashToken(token), playerId, now, now);
    return token;
  }

  endSession(token: string) {
    this.run('DELETE FROM sessions WHERE token_hash = ?', hashToken(token));
  }

  /** The player behind a session. Removed players are signed out until someone restores them. */
  authenticate(id: string, token: string): PlayerRow | null {
    const hash = hashToken(token);
    const row = this.get<Row>(
      `SELECT p.id, p.name, p.look, p.pin_hash FROM sessions s JOIN players p ON p.id = s.player_id
       WHERE s.token_hash = ? AND p.id = ? AND p.deleted_at IS NULL`,
      hash,
      id,
    );
    if (!row) return null;
    const now = Date.now();
    this.run('UPDATE sessions SET last_seen = ? WHERE token_hash = ?', now, hash);
    this.run('UPDATE players SET last_seen = ? WHERE id = ?', now, id);
    return toPlayer(row);
  }

  /** An active (not removed) player. */
  player(id: string): PlayerRow | null {
    const row = this.get<Row>('SELECT id, name, look, pin_hash FROM players WHERE id = ? AND deleted_at IS NULL', id);
    return row ? toPlayer(row) : null;
  }

  playerByName(name: string): (PlayerRow & { removed: boolean }) | null {
    const row = this.get<Row>(
      'SELECT id, name, look, pin_hash, deleted_at FROM players WHERE name_key = ? ORDER BY deleted_at IS NOT NULL, deleted_at DESC LIMIT 1',
      nameKey(name),
    );
    return row ? { ...toPlayer(row), removed: row.deleted_at != null } : null;
  }

  /** False when another player already has the name. */
  updatePlayer(id: string, name: string, look: Look): boolean {
    try {
      this.run('UPDATE players SET name = ?, name_key = ?, look = ?, last_seen = ? WHERE id = ?', name, nameKey(name), JSON.stringify(look), Date.now(), id);
      return true;
    } catch (err) {
      if (isUniqueViolation(err)) return false;
      throw err;
    }
  }

  checkPin(id: string, pin: string): boolean {
    const row = this.get<Row>('SELECT pin_hash FROM players WHERE id = ?', id);
    if (!row?.pin_hash) return true;
    const want = Buffer.from(String(row.pin_hash), 'hex');
    const got = Buffer.from(hashPin(id, pin), 'hex');
    return want.length === got.length && timingSafeEqual(want, got);
  }

  setPin(id: string, pin: string | null) {
    this.run('UPDATE players SET pin_hash = ? WHERE id = ?', pin ? hashPin(id, pin) : null, id);
  }

  /** Everyone who can be picked on the "Who's climbing?" screen, most recently active first. */
  roster(): RosterEntry[] {
    return this.all<Row>(
      `SELECT p.id, p.name, p.look, p.pin_hash, p.last_seen,
              (SELECT MAX(score) FROM runs r WHERE r.player_id = p.id AND r.board = 'endless' AND r.status = 'verified') AS best,
              (SELECT COUNT(*) FROM runs r WHERE r.player_id = p.id AND r.status = 'verified') AS runs
       FROM players p WHERE p.deleted_at IS NULL
       ORDER BY p.last_seen DESC`,
    ).map((r) => ({ ...toPlayer(r), best: Number(r.best ?? 0), runs: Number(r.runs), lastSeen: Number(r.last_seen) }));
  }

  removedPlayers(keepMs: number): RemovedPlayer[] {
    return this.all<Row>('SELECT id, name, look, deleted_at, deleted_by FROM players WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').map((r) => ({
      id: String(r.id),
      name: String(r.name),
      look: parseLook(r.look),
      removedAt: Number(r.deleted_at),
      removedBy: r.deleted_by == null ? null : String(r.deleted_by),
      purgeAt: Number(r.deleted_at) + keepMs,
    }));
  }

  /** Hides a player everywhere. Their runs stay until purgeRemoved(), so it can be undone. */
  removePlayer(id: string, by: string | null): PlayerRow | null {
    const p = this.player(id);
    if (p) this.run('UPDATE players SET deleted_at = ?, deleted_by = ? WHERE id = ?', Date.now(), by, id);
    return p;
  }

  /** Brings a removed player back; if someone took the name meanwhile, they get "Name 2". */
  restorePlayer(id: string): PlayerRow | null {
    const row = this.get<Row>('SELECT name FROM players WHERE id = ? AND deleted_at IS NOT NULL', id);
    if (!row) return null;
    const name = uniqueName(String(row.name), (k) => !!this.get<Row>('SELECT 1 FROM players WHERE name_key = ? AND deleted_at IS NULL', k));
    this.run('UPDATE players SET name = ?, name_key = ?, deleted_at = NULL, deleted_by = NULL WHERE id = ?', name, nameKey(name), id);
    return this.player(id);
  }

  /** Deletes players removed before `before`, with all their runs and sessions. */
  purgeRemoved(before: number): number {
    return Number(this.run('DELETE FROM players WHERE deleted_at IS NOT NULL AND deleted_at < ?', before).changes);
  }

  counts(): { players: number; runs: number } {
    return {
      players: Number(this.get<Row>('SELECT COUNT(*) AS n FROM players WHERE deleted_at IS NULL')!.n),
      runs: Number(this.get<Row>("SELECT COUNT(*) AS n FROM runs r JOIN players p ON p.id = r.player_id WHERE r.status = 'verified' AND p.deleted_at IS NULL")!.n),
    };
  }

  // ---- runs -----------------------------------------------------------------------------------

  startRun(player: PlayerRow, board: BoardKey, seed: number): string {
    const id = randomUUID();
    this.run(
      'INSERT INTO runs (id, player_id, board, seed, character, look, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      player.id,
      board,
      seed,
      player.look.char,
      JSON.stringify(player.look),
      Date.now(),
    );
    return id;
  }

  getRun(id: string): RunRow | null {
    const r = this.get<Row>('SELECT id, player_id, board, seed, status, started_at FROM runs WHERE id = ?', id);
    if (!r) return null;
    return {
      id: String(r.id),
      playerId: String(r.player_id),
      board: String(r.board),
      seed: Number(r.seed),
      status: r.status as RunRow['status'],
      startedAt: Number(r.started_at),
    };
  }

  /** Every run a player has started on a board counts as an attempt, finished or not. */
  attempts(playerId: string, board: BoardKey): number {
    return Number(this.get<Row>('SELECT COUNT(*) AS n FROM runs WHERE player_id = ? AND board = ?', playerId, board)!.n);
  }

  /** Attempts used per tournament board, for the "N tries left" line. */
  tournamentAttempts(playerId: string): Record<BoardKey, number> {
    const rows = this.all<Row>(
      "SELECT board, COUNT(*) AS n FROM runs WHERE player_id = ? AND board LIKE 'tournament:%' GROUP BY board",
      playerId,
    );
    return Object.fromEntries(rows.map((r) => [String(r.board), Number(r.n)]));
  }

  bestScore(playerId: string, board: BoardKey): number {
    const r = this.get<Row>("SELECT MAX(score) AS best FROM runs WHERE player_id = ? AND board = ? AND status = 'verified'", playerId, board);
    return Number(r?.best ?? 0);
  }

  finishRun(id: string, res: RunResult) {
    this.run(
      `UPDATE runs SET status = 'verified', finished_at = ?, score = ?, floor = ?, combo = ?, gems = ?, jumps = ?, ticks = ?, replay = ?
       WHERE id = ?`,
      Date.now(),
      res.score,
      res.floor,
      res.combo,
      res.gems,
      res.jumps,
      res.ticks,
      res.replay,
      id,
    );
  }

  rejectRun(id: string, reason: string) {
    this.run("UPDATE runs SET status = 'rejected', finished_at = ?, reject_reason = ? WHERE id = ?", Date.now(), reason, id);
  }

  replay(runId: string): { seed: number; inputs: string; ticks: number; score: number; floor: number } | null {
    const r = this.get<Row>("SELECT seed, replay, ticks, score, floor FROM runs WHERE id = ? AND status = 'verified'", runId);
    if (!r) return null;
    return { seed: Number(r.seed), inputs: String(r.replay), ticks: Number(r.ticks), score: Number(r.score), floor: Number(r.floor) };
  }

  // ---- boards ---------------------------------------------------------------------------------

  /** Each player's best verified run on a board, best first. Ties go to whoever got there first. */
  board(board: BoardKey, limit = 50): BoardEntry[] {
    const rows = this.all<Row>(
      `WITH ranked AS (
         SELECT r.*,
                ROW_NUMBER() OVER (PARTITION BY r.player_id ORDER BY r.score DESC, r.finished_at ASC) AS rn,
                COUNT(*)     OVER (PARTITION BY r.player_id) AS n
         FROM runs r
         WHERE r.board = ? AND r.status = 'verified'
       )
       SELECT ranked.player_id, ranked.look, ranked.score, ranked.floor, ranked.combo, ranked.gems, ranked.n,
              ranked.finished_at, p.name
       FROM ranked JOIN players p ON p.id = ranked.player_id
       WHERE rn = 1 AND p.deleted_at IS NULL
       ORDER BY ranked.score DESC, ranked.finished_at ASC
       LIMIT ?`,
      board,
      limit,
    );
    return rows.map((r, i) => ({
      rank: i + 1,
      playerId: String(r.player_id),
      name: String(r.name),
      look: parseLook(r.look),
      score: Number(r.score),
      floor: Number(r.floor),
      combo: Number(r.combo),
      gems: Number(r.gems),
      runs: Number(r.n),
      at: Number(r.finished_at),
    }));
  }

  characters(): CharacterStat[] {
    const played = new Map(
      this.all<Row>(
        `SELECT r.character, COUNT(*) AS runs, COUNT(DISTINCT r.player_id) AS players,
                MAX(r.score) AS best, MAX(r.floor) AS best_floor, AVG(r.score) AS avg
         FROM runs r JOIN players p ON p.id = r.player_id
         WHERE r.status = 'verified' AND p.deleted_at IS NULL GROUP BY r.character`,
      ).map((r) => [String(r.character), r]),
    );
    const champions = new Map(
      this.all<Row>(
        `SELECT character, name, score FROM (
           SELECT r.character, p.name, r.score,
                  ROW_NUMBER() OVER (PARTITION BY r.character ORDER BY r.score DESC, r.finished_at ASC) AS rn
           FROM runs r JOIN players p ON p.id = r.player_id
           WHERE r.status = 'verified' AND p.deleted_at IS NULL
         ) WHERE rn = 1`,
      ).map((r) => [String(r.character), { name: String(r.name), score: Number(r.score) }]),
    );
    const wearing = new Map(
      this.all<Row>("SELECT json_extract(look, '$.char') AS c, COUNT(*) AS n FROM players WHERE deleted_at IS NULL GROUP BY c").map((r) => [String(r.c), Number(r.n)]),
    );
    return CHARACTERS.map((c) => {
      const p = played.get(c.id);
      return {
        char: c.id,
        runs: Number(p?.runs ?? 0),
        players: Number(p?.players ?? 0),
        wearing: wearing.get(c.id) ?? 0,
        bestScore: Number(p?.best ?? 0),
        bestFloor: Number(p?.best_floor ?? 0),
        avgScore: Math.round(Number(p?.avg ?? 0)),
        champion: champions.get(c.id) ?? null,
      };
    }).sort((a, b) => b.bestScore - a.bestScore || b.runs - a.runs);
  }

  // ---- tournaments ----------------------------------------------------------------------------

  createTournament(t: { name: string; startsAt: number; endsAt: number; maxAttempts: number | null }): Tournament {
    const id = randomBytes(4).toString('hex');
    const seed = randomBytes(4).readUInt32LE();
    this.run(
      'INSERT INTO tournaments (id, name, seed, starts_at, ends_at, max_attempts, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      t.name,
      seed,
      t.startsAt,
      t.endsAt,
      t.maxAttempts,
      Date.now(),
    );
    return this.tournament(id)!;
  }

  tournament(id: string): Tournament | null {
    const row = this.get<TournamentRow>('SELECT * FROM tournaments WHERE id = ?', id);
    return row ? this.toTournament(row) : null;
  }

  /** Live and upcoming tournaments first, then the most recent finished ones. */
  tournaments(limit = 20): Tournament[] {
    const now = Date.now();
    return this.all<TournamentRow>('SELECT * FROM tournaments ORDER BY (ends_at > ?) DESC, starts_at DESC LIMIT ?', now, limit).map((r) =>
      this.toTournament(r, now),
    );
  }

  endTournament(id: string) {
    this.run('UPDATE tournaments SET ends_at = MIN(ends_at, ?) WHERE id = ?', Date.now(), id);
  }

  deleteTournament(id: string) {
    this.run('DELETE FROM runs WHERE board = ?', `tournament:${id}`);
    this.run('DELETE FROM tournaments WHERE id = ?', id);
  }

  private toTournament(r: TournamentRow, now = Date.now()): Tournament {
    const board = `tournament:${r.id}`;
    const top = this.board(board, 1)[0];
    const players = Number(
      this.get<Row>(
        "SELECT COUNT(DISTINCT r.player_id) AS n FROM runs r JOIN players p ON p.id = r.player_id WHERE r.board = ? AND r.status = 'verified' AND p.deleted_at IS NULL",
        board,
      )!.n,
    );
    const t = { startsAt: Number(r.starts_at), endsAt: Number(r.ends_at) };
    return {
      id: r.id,
      name: r.name,
      board,
      seed: Number(r.seed),
      ...t,
      maxAttempts: r.max_attempts == null ? null : Number(r.max_attempts),
      status: tournamentStatus(t, now),
      players,
      leader: top ? { name: top.name, score: top.score, look: top.look } : null,
    };
  }
}
