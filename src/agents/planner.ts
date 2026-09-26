// "Frosty", a lookahead agent. Every few ticks it clones the game, tries a handful of short
// action plans in simulation, scores where each one ends up, and commits to the best first move.
// It needs no training: it works because the engine is deterministic and cheap to clone.
import * as C from '../engine/constants';
import { cloneGame, step, type GameState } from '../engine/sim';
import type { Agent } from './api';

const L = C.INPUT_LEFT;
const R = C.INPUT_RIGHT;
const J = C.INPUT_JUMP;

const FIRST_MOVES = [0, L, R, J, L | J, R | J];

interface Plan {
  first: number;
  firstTicks: number;
  then: number;
}

export interface PlannerOptions {
  /** How often to re-plan, in ticks. Lower is stronger and slower. */
  replanEvery?: number;
  /** How far ahead each plan is simulated, in ticks. */
  horizon?: number;
}

export class PlannerAgent implements Agent {
  readonly name = 'Frosty (lookahead planner)';
  private plan: number[] = [];
  private replanEvery: number;
  private horizon: number;
  private plans: Plan[] = [];

  constructor(opts: PlannerOptions = {}) {
    this.replanEvery = opts.replanEvery ?? 3;
    this.horizon = opts.horizon ?? 70;
    for (const first of FIRST_MOVES) {
      for (const firstTicks of [3, 12, 24]) {
        for (const then of [L | J, R | J, J, L, R]) this.plans.push({ first, firstTicks, then });
      }
    }
  }

  reset() {
    this.plan = [];
  }

  act(_obs: unknown, state: Readonly<GameState>): number {
    if (this.plan.length === 0) this.plan = this.search(state as GameState);
    return this.plan.shift() ?? 0;
  }

  private search(s: GameState): number[] {
    let best = -Infinity;
    let bestPlan = this.plans[0];
    for (const plan of this.plans) {
      const sim = cloneGame(s);
      let deathTick = -1;
      let peak = -Infinity;
      for (let t = 0; t < this.horizon; t++) {
        step(sim, t < plan.firstTicks ? plan.first : plan.then);
        if (sim.over) {
          deathTick = t;
          break;
        }
        if (sim.player.grounded) peak = Math.max(peak, sim.player.groundFloor);
      }
      const v = this.evaluate(s, sim, deathTick, peak);
      if (v > best) {
        best = v;
        bestPlan = plan;
      }
    }
    const out: number[] = [];
    for (let t = 0; t < this.replanEvery; t++) out.push(t < bestPlan.firstTicks ? bestPlan.first : bestPlan.then);
    return out;
  }

  private evaluate(start: GameState, end: GameState, deathTick: number, peak: number): number {
    if (deathTick >= 0) return -1e9 + deathTick;
    const p = end.player;
    let v = 0;
    v += (end.score - start.score) * 4; // floors, gems and cashed-in combos
    v += (end.floor - start.floor) * 120;
    v += (p.grounded ? p.groundFloor : p.y / C.FLOOR_GAP) * 60;
    if (peak > -Infinity) v += peak * 30;
    v += end.combo.floors * 25; // keep combos alive
    v += Math.abs(p.vx) * 8; // speed means bigger jumps later
    const margin = p.y - end.cameraY;
    if (margin < 260) v -= (260 - margin) * 12; // stay away from the bottom of the screen
    return v;
  }
}
