import { describe, expect, it } from 'vitest';
import { observe } from '../src/agents/api';
import { PlannerAgent } from '../src/agents/planner';
import { INPUT_JUMP, INPUT_LEFT, INPUT_RIGHT } from '../src/engine/constants';
import { InputRecorder, decodeInputs, simulateReplay } from '../src/engine/replay';
import { cloneGame, createGame, step } from '../src/engine/sim';

function scripted(tick: number): number {
  const phase = Math.floor(tick / 90) % 2;
  return (phase ? INPUT_LEFT : INPUT_RIGHT) | (tick % 7 === 0 ? INPUT_JUMP : 0);
}

describe('engine determinism', () => {
  it('produces identical games from the same seed and inputs', () => {
    const a = createGame(1234);
    const b = createGame(1234);
    for (let t = 0; t < 3000; t++) {
      step(a, scripted(t));
      step(b, scripted(t));
    }
    expect(JSON.stringify({ ...a, events: [] })).toBe(JSON.stringify({ ...b, events: [] }));
  });

  it('clones are independent and continue identically', () => {
    const a = createGame(99);
    for (let t = 0; t < 500; t++) step(a, scripted(t));
    const b = cloneGame(a);
    for (let t = 500; t < 1500; t++) {
      step(a, scripted(t));
      step(b, scripted(t));
    }
    expect(b.score).toBe(a.score);
    expect(b.player).toEqual(a.player);
  });

  it('round-trips inputs through the replay encoder and re-verifies the score', () => {
    const s = createGame(7);
    const rec = new InputRecorder();
    const inputs: number[] = [];
    const agent = new PlannerAgent();
    for (let t = 0; t < 2400 && !s.over; t++) {
      const i = agent.act(observe(s), s);
      inputs.push(i);
      rec.push(i);
      step(s, i);
    }
    const encoded = rec.encode();
    expect(Array.from(decodeInputs(encoded))).toEqual(inputs);
    const verified = simulateReplay({ version: 1, seed: 7, inputs: encoded, ticks: rec.ticks, score: s.score, floor: s.floor });
    expect(verified.score).toBe(s.score);
    expect(s.floor).toBeGreaterThan(20);
  });

  it('ends the game when the player falls below the screen', () => {
    const s = createGame(5);
    // Climb a bit so the scroll starts, then stand still.
    s.floor = 10;
    for (let t = 0; t < 60 * 60 && !s.over; t++) step(s, 0);
    expect(s.over).toBe(true);
  });
});
