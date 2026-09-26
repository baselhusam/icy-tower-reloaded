// Headless benchmark: run an AI agent on N seeds and print results.
//   npm run bot            # 3 random seeds
//   npm run bot -- 10 42   # 10 games starting at seed 42
import { observe } from '../src/agents/api';
import { PlannerAgent } from '../src/agents/planner';
import { createGame, step } from '../src/engine/sim';
import { InputRecorder, simulateReplay, type Replay } from '../src/engine/replay';

const games = Number(process.argv[2] ?? 3);
const firstSeed = Number(process.argv[3] ?? Math.floor(Math.random() * 1e9));
const maxTicks = 60 * 60 * 10; // 10 minutes of game time

for (let g = 0; g < games; g++) {
  const seed = firstSeed + g;
  const agent = new PlannerAgent();
  const s = createGame(seed);
  const rec = new InputRecorder();
  const t0 = performance.now();
  while (!s.over && s.tick < maxTicks) {
    const input = agent.act(observe(s), s);
    rec.push(input);
    step(s, input);
  }
  const ms = performance.now() - t0;
  const replay: Replay = { version: 1, seed, inputs: rec.encode(), ticks: rec.ticks, score: s.score, floor: s.floor };
  const verified = simulateReplay(replay).score === s.score;
  console.log(
    `seed ${seed}: floor ${s.floor}, score ${s.score}, best combo ${s.stats.bestComboFloors} floors, ` +
      `${(s.tick / 60).toFixed(0)}s game time in ${(ms / 1000).toFixed(1)}s, replay ${replay.inputs.length}B ${verified ? 'verified' : 'MISMATCH'}`,
  );
}
