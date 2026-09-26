// The contract any AI agent implements. An agent sees an Observation each tick and returns
// an input bitmask. Because the engine is headless and deterministic, agents can be trained
// or benchmarked in Node at thousands of ticks per second (see scripts/bot.ts).
import * as C from '../engine/constants';
import type { GameState, PlatformKind, PickupKind } from '../engine/sim';

export interface Observation {
  tick: number;
  player: { x: number; y: number; vx: number; vy: number; grounded: boolean; floor: number };
  cameraY: number;
  scrollSpeed: number;
  floor: number;
  score: number;
  combo: { active: boolean; floors: number; jumps: number; ticksLeft: number };
  powerups: { rocket: number; freeze: number; magnet: number };
  platforms: { floor: number; x: number; w: number; y: number; kind: PlatformKind; vx: number }[];
  pickups: { kind: PickupKind; x: number; y: number }[];
}

export interface Agent {
  readonly name: string;
  /** Called once per tick. Return a bitmask of INPUT_LEFT | INPUT_RIGHT | INPUT_JUMP. */
  act(obs: Observation, state: Readonly<GameState>): number;
  reset?(): void;
}

export function observe(s: GameState): Observation {
  const p = s.player;
  return {
    tick: s.tick,
    player: { x: p.x, y: p.y, vx: p.vx, vy: p.vy, grounded: p.grounded, floor: p.groundFloor },
    cameraY: s.cameraY,
    scrollSpeed: s.scrolling && s.freeze === 0 ? C.BASE_SCROLL + (s.speedLevel - 1) * C.SCROLL_PER_LEVEL : 0,
    floor: s.floor,
    score: s.score,
    combo: { active: s.combo.active, floors: s.combo.floors, jumps: s.combo.jumps, ticksLeft: s.combo.timer },
    powerups: { rocket: s.rocket, freeze: s.freeze, magnet: s.magnet },
    platforms: s.platforms
      .filter((pl) => !pl.broken && pl.floor * C.FLOOR_GAP < s.cameraY + C.VIEW_H)
      .map((pl) => ({ floor: pl.floor, x: pl.x, w: pl.w, y: pl.floor * C.FLOOR_GAP, kind: pl.kind, vx: pl.vx })),
    pickups: s.pickups.filter((pk) => !pk.taken).map((pk) => ({ kind: pk.kind, x: pk.x, y: pk.y })),
  };
}
