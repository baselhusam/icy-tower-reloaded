// A replay is just the seed plus one input byte per tick. Run-length encoded it is tiny
// (a few KB for a long game), so it can be stored, shared as a ghost, or sent to a server
// that re-simulates it to verify a leaderboard score.
import { createGame, step, type GameState } from './sim';

export interface Replay {
  version: 1;
  seed: number;
  inputs: string; // RLE: "<input><count base36>." repeated
  ticks: number;
  score: number;
  floor: number;
}

export class InputRecorder {
  private runs: string[] = [];
  private last = -1;
  private count = 0;
  ticks = 0;

  push(input: number) {
    this.ticks++;
    if (input === this.last) {
      this.count++;
      return;
    }
    this.flush();
    this.last = input;
    this.count = 1;
  }

  private flush() {
    if (this.count > 0) this.runs.push(`${this.last}${this.count.toString(36)}`);
  }

  encode(): string {
    this.flush();
    const out = this.runs.join('.');
    this.runs.pop();
    return out;
  }
}

export function decodeInputs(encoded: string): Uint8Array {
  if (!encoded) return new Uint8Array(0);
  const runs = encoded.split('.').map((r) => [Number(r[0]), parseInt(r.slice(1), 36)] as const);
  const total = runs.reduce((n, [, c]) => n + c, 0);
  const out = new Uint8Array(total);
  let i = 0;
  for (const [v, c] of runs) {
    out.fill(v, i, i + c);
    i += c;
  }
  return out;
}

/** Re-run a replay from scratch. A server can call this to verify a submitted score. */
export function simulateReplay(replay: Replay): GameState {
  const s = createGame(replay.seed);
  const inputs = decodeInputs(replay.inputs);
  for (let i = 0; i < inputs.length && !s.over; i++) step(s, inputs[i]);
  return s;
}

/** Steps a second game alongside the player's, driven by a recorded replay. */
export class Ghost {
  readonly state: GameState;
  private inputs: Uint8Array;
  private i = 0;

  constructor(replay: Replay) {
    this.state = createGame(replay.seed);
    this.inputs = decodeInputs(replay.inputs);
  }

  advance() {
    if (this.state.over || this.i >= this.inputs.length) return;
    step(this.state, this.inputs[this.i++]);
  }
}
