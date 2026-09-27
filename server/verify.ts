// Server-side anti-cheat. A client never tells us its score: it sends the replay (seed + one
// input byte per tick) and we re-run the deterministic engine to find out what really happened.
import { TICK_RATE } from '../src/engine/constants';
import { createGame, step, type GameState } from '../src/engine/sim';

/** An hour of play. Nobody survives that long; it just bounds the work a submission can cost. */
export const MAX_TICKS = 60 * 60 * TICK_RATE;
const MAX_INPUT_CHARS = 2_000_000;
const RUN = /^([0-7])([0-9a-z]{1,6})$/;

export interface VerifyContext {
  seed: number;
  startedAt: number; // when the server handed out this run
  now: number;
  /** Tournament runs may stop before game over once the clock has run out. */
  allowUnfinished: boolean;
}

export type Verdict = { ok: true; state: GameState; ticks: number } | { ok: false; reason: string };

export function verifyReplay(raw: unknown, ctx: VerifyContext): Verdict {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.version !== 1) return { ok: false, reason: 'unsupported replay version' };
  if (r.seed !== ctx.seed) return { ok: false, reason: 'replay is for a different tower' };
  if (typeof r.inputs !== 'string' || r.inputs.length > MAX_INPUT_CHARS) return { ok: false, reason: 'malformed inputs' };

  // Parse and bound the run-length encoding before simulating anything.
  const runs: [input: number, count: number][] = [];
  let ticks = 0;
  if (r.inputs) {
    for (const part of r.inputs.split('.')) {
      const m = RUN.exec(part);
      if (!m) return { ok: false, reason: 'malformed inputs' };
      const count = parseInt(m[2], 36);
      ticks += count;
      if (count < 1 || ticks > MAX_TICKS) return { ok: false, reason: 'run is too long' };
      runs.push([Number(m[1]), count]);
    }
  }

  // The game can't run faster than real time for a human, so the replay can't be longer than
  // the time since the server handed out the seed (plus slack for clocks and the network).
  const realMs = ctx.now - ctx.startedAt + 10_000;
  if ((ticks * 1000) / TICK_RATE > realMs) return { ok: false, reason: 'run is longer than the time since it started' };

  const s = createGame(ctx.seed);
  for (const [input, count] of runs) {
    for (let i = 0; i < count && !s.over; i++) step(s, input);
  }
  if (!s.over && !ctx.allowUnfinished) return { ok: false, reason: 'run did not end' };
  return { ok: true, state: s, ticks };
}
