// SQLite storage via Node's built-in node:sqlite, so the package has no native dependencies.
// Everything the arena remembers lives in one file: players, every run (with its replay) and
// tournaments. Scores only ever come from server-verified replays.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { CHARACTERS, sanitizeLook, type Look } from '../src/render/characters';
import { tournamentStatus, type BoardEntry, type BoardKey, type CharacterStat, type Tournament } from '../src/net/protocol';

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS players (
  id         TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  name       TEXT NOT NULL,
  look       TEXT NOT NULL,
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

export interface PlayerRow {
  id: string;
  name: string;
  look: Look;
}

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
const parseLook = (json: unknown) => {
  try {
    return sanitizeLook(JSON.parse(String(json)));
  } catch {
    return sanitizeLook(null);
  }
};

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
    store.setMeta('schema_version', String(SCHEMA_VERSION));
    return store;
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

  createPlayer(name: string, look: Look): { id: string; token: string } {
    const id = randomUUID();
    const token = randomBytes(24).toString('base64url');
    const now = Date.now();
    this.run(
      'INSERT INTO players (id, token_hash, name, look, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      hashToken(token),
      name,
      JSON.stringify(look),
      now,
      now,
    );
    return { id, token };
  }

  authenticate(id: string, token: string): PlayerRow | null {
    const row = this.get<Row>('SELECT id, name, look, token_hash FROM players WHERE id = ?', id);
    if (!row || row.token_hash !== hashToken(token)) return null;
    this.run('UPDATE players SET last_seen = ? WHERE id = ?', Date.now(), id);
    return { id: String(row.id), name: String(row.name), look: parseLook(row.look) };
  }

  updatePlayer(id: string, name: string, look: Look) {
    this.run('UPDATE players SET name = ?, look = ?, last_seen = ? WHERE id = ?', name, JSON.stringify(look), Date.now(), id);
  }

  counts(): { players: number; runs: number } {
    return {
      players: Number(this.get<Row>('SELECT COUNT(*) AS n FROM players')!.n),
      runs: Number(this.get<Row>("SELECT COUNT(*) AS n FROM runs WHERE status = 'verified'")!.n),
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
       WHERE rn = 1
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
        `SELECT character, COUNT(*) AS runs, COUNT(DISTINCT player_id) AS players,
                MAX(score) AS best, MAX(floor) AS best_floor, AVG(score) AS avg
         FROM runs WHERE status = 'verified' GROUP BY character`,
      ).map((r) => [String(r.character), r]),
    );
    const champions = new Map(
      this.all<Row>(
        `SELECT character, name, score FROM (
           SELECT r.character, p.name, r.score,
                  ROW_NUMBER() OVER (PARTITION BY r.character ORDER BY r.score DESC, r.finished_at ASC) AS rn
           FROM runs r JOIN players p ON p.id = r.player_id
           WHERE r.status = 'verified'
         ) WHERE rn = 1`,
      ).map((r) => [String(r.character), { name: String(r.name), score: Number(r.score) }]),
    );
    const wearing = new Map(
      this.all<Row>("SELECT json_extract(look, '$.char') AS c, COUNT(*) AS n FROM players GROUP BY c").map((r) => [String(r.c), Number(r.n)]),
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
    const players = Number(this.get<Row>("SELECT COUNT(DISTINCT player_id) AS n FROM runs WHERE board = ? AND status = 'verified'", board)!.n);
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
