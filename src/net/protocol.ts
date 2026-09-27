// The wire format between the game and an arena server (`npx icy-tower-reloaded`).
// Shared by the browser client (src/net/arena.ts) and the Node server (server/), so both sides
// always agree on the shapes. Types plus one tiny pure helper.
import type { Replay } from '../engine/replay';
import type { CharId, Look } from '../render/characters';

export const APP_ID = 'icy-tower-reloaded';
export const PLAYER_NAME_MAX = 16;
export const TOURNAMENT_NAME_MAX = 32;

/** "endless", "daily:YYYY-MM-DD" or "tournament:<id>". */
export type BoardKey = string;
export type RunMode = 'endless' | 'daily' | 'tournament';
export type TournamentStatus = 'upcoming' | 'live' | 'finished';

export interface Hello {
  app: typeof APP_ID;
  version: string;
  arena: string;
  serverTime: number; // ms since epoch, for countdowns that agree across machines
  daily: string; // today's daily key on the server (UTC)
  urls: string[]; // addresses other people on the network can open
  admin: boolean; // this client may host tournaments
  tournaments: Tournament[];
  presence: Presence;
}

export interface PlayerAuth {
  id: string;
  token: string;
}

export interface PlayerUpdate {
  name: string;
  look: Look;
}

export interface Tournament {
  id: string;
  name: string;
  board: BoardKey;
  seed: number;
  startsAt: number;
  endsAt: number;
  maxAttempts: number | null;
  status: TournamentStatus;
  players: number;
  leader: { name: string; score: number; look: Look } | null;
}

export interface NewTournament {
  name: string;
  minutes: number;
  startsInMinutes?: number;
  maxAttempts?: number | null;
}

export interface BoardEntry {
  rank: number;
  playerId: string;
  name: string;
  look: Look;
  score: number;
  floor: number;
  combo: number;
  gems: number;
  runs: number; // verified runs on this board
  at: number; // when the best run finished
}

export interface StartRun {
  mode: RunMode;
  tournamentId?: string;
}

export interface StartedRun {
  runId: string;
  seed: number;
  board: BoardKey;
  attemptsLeft: number | null; // after this one; null = unlimited
}

export interface RunProgress {
  floor: number;
  score: number;
}

export interface FinishRun {
  replay: Replay;
}

export interface FinishedRun {
  board: BoardKey;
  score: number;
  floor: number;
  rank: number; // this player's rank on the board after the run
  players: number; // how many players are on the board
  personalBest: boolean;
  previousBest: number;
}

export interface CharacterStat {
  char: CharId;
  runs: number;
  players: number; // distinct players who have climbed with it
  wearing: number; // players whose current look uses it
  bestScore: number;
  bestFloor: number;
  avgScore: number;
  champion: { name: string; score: number } | null;
}

export interface Climber {
  runId: string;
  playerId: string;
  name: string;
  look: Look;
  board: BoardKey;
  floor: number;
  score: number;
  startedAt: number;
}

export interface Presence {
  online: number; // distinct players with the game open
  climbers: Climber[];
}

export type ServerEvent =
  | { type: 'presence'; presence: Presence }
  | { type: 'run'; board: BoardKey; entry: BoardEntry; personalBest: boolean }
  | { type: 'tournaments'; tournaments: Tournament[] }
  | { type: 'tournamentResult'; tournament: Tournament; podium: BoardEntry[] };

export function tournamentStatus(t: { startsAt: number; endsAt: number }, now: number): TournamentStatus {
  return now < t.startsAt ? 'upcoming' : now < t.endsAt ? 'live' : 'finished';
}

export interface ApiError {
  error: string;
}
