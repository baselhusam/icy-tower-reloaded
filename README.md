# Icy Tower Reloaded 🐧

A browser remake of Icy Tower with more gamification. It's built so that leaderboards and AI agents can be added cleanly.

```bash
npm install
npm run dev      # play at http://localhost:5173
npm test         # engine determinism + replay verification tests
npm run bot      # headless AI benchmark (npm run bot -- <games> <seed>)
```

## What's in it

- **Classic core:** the faster you run, the higher you jump. Mid-air wall bounces keep your speed. Combos score floors², and the tower speeds up every 30s.
- **Gamification:**
  - XP and player levels.
  - 18 achievements, which pop mid-run.
  - Lifetime stats.
  - Personal-best marker drawn in the tower.
  - Local leaderboards (Endless / Daily / AI).
- **Daily Tower:** everyone gets the same seeded tower each day. You race a ghost of your best run.
- **Variety:**
  - Six themed zones, one every 50 floors.
  - Ice, moving, crumbling and spring platforms.
  - Gems, plus 🚀 rocket, ❄️ freeze and 🧲 magnet power-ups.
- **Juice:** particles, screen shake, combo ratings, synthesized sound (no assets), and touch controls on mobile.
- **Replays:** every run is recorded, and you can watch it back after game over.
- **AI:** "Frosty", a lookahead planner. Watch it from the menu (at ×1, ×4 or ×16); it also plays the attract-mode demo.

## Architecture

```
src/engine/   Pure, deterministic simulation: no DOM, no Date, no Math.random
  sim.ts      createGame(seed) / step(state, inputBits) / cloneGame
  replay.ts   input recorder (RLE), simulateReplay() for verification, Ghost
src/agents/   Agent interface (observe → input bits) + PlannerAgent
src/render/   Canvas renderer, themes, particles (driven by engine events)
src/meta/     Profile, XP, achievements, leaderboards (localStorage)
src/main.ts   Game loop (fixed 60Hz + interpolation), menus, pilots (human / AI / replay)
```

The game state is a pure function of `(seed, inputs)`, so a finished run can be stored as `{ seed, inputs }` in a few KB.

## Roadmap

1. **Global leaderboard:** the client submits a replay, and the server runs `simulateReplay()` and stores the verified score. This rules out faking scores through the network.
2. **AI agent arena:** an HTTP/WebSocket API around `observe()`/`step()` lets external agents (LLMs, RL bots written in Python) play headless, with a separate AI leaderboard.
3. **Shareable ghosts:** a link that carries a replay, so friends can race each other's runs.
4. **Weekly seasons, cosmetic unlocks** (scarves and hats paid for with gems), and **async multiplayer races** on the same seed.
