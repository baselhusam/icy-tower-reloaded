<div align="center">

# 🐧 Icy Tower Reloaded

**A browser remake of the classic Icy Tower, with more to unlock, a daily challenge, replays and an AI that plays it. Host it on your office network for shared leaderboards and live tournaments.**

Run fast, jump high, chain combos and don't fall off the bottom.

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
![Canvas 2D](https://img.shields.io/badge/Canvas_2D-0b1e3a?logo=html5&logoColor=white)
[![npm](https://img.shields.io/npm/v/icy-tower-reloaded?color=cb3837&logo=npm)](https://www.npmjs.com/package/icy-tower-reloaded)
![Runtime deps](https://img.shields.io/badge/runtime_deps-0-7fe3ff)
![Tests](https://img.shields.io/badge/tests-vitest-6E9F18?logo=vitest&logoColor=white)

<br />

<img src="docs/media/climb.gif" width="300" alt="Gameplay: the penguin climbs the Ice Cave, chains combos and unlocks achievements" />
&nbsp;&nbsp;
<img src="docs/media/title.png" width="300" alt="Title screen with game modes and player card" />

</div>

---

## Play with your team

One person runs this on their machine (Node.js 22.13 or newer):

```bash
npx icy-tower-reloaded
```

```text
  🐧 Icy Tower Reloaded v0.1.0 · Office Arena

  🎮 Play here        http://localhost:4747
  🌐 Share with team  http://192.168.1.14:4747
  📺 Big screen       http://192.168.1.14:4747/tv
  🔑 Host link        http://192.168.1.14:4747/?admin=x7Qp2mR9aLc4
  💾 Database         ~/.icy-tower-reloaded/arena.db
```

Everyone else on the same network opens the **Share with team** link. Nobody else installs anything.

- **Climbers.** Every visit starts on *Who's climbing?*: continue as yourself, pick your climber from the list or make a new one. Names are unique, and your scores follow your climber to any machine. Add an optional 4-digit PIN so nobody else can play as you. There's no admin: anyone can remove a climber (they vanish from every board), and anyone can restore them from *Recently removed* for 7 days, after which they're deleted for good.
- **Shared leaderboards.** All-time Endless, today's Daily Tower, each tournament, and a **Characters** board that shows which climber holds each record and how often each one gets picked.
- **Tournaments.** The host starts one from the 🎛️ panel (click the green arena pill on the title screen) or from the terminal. Everyone gets the same tower, a countdown and an optional limit on attempts. When the clock runs out, runs still in progress end with *Time's up!* and count as they stand. A few seconds later the winner is announced to everyone.
- **Live.** The title screen shows who's online and who's climbing. During a run, rivals on the same board appear as name tags on the tower wall at the floor they've reached. Toasts pop up when someone makes the podium.
- **Big-screen board** at `/tv` for the office TV: tournament standings with a countdown, who's climbing right now (with live floor bars), all-time top 5, character records and a feed of new bests.
- **Scores can't be faked.** The client never sends a score. It sends the replay (seed + inputs), and the server re-runs the deterministic engine to get the real result. A 10-minute run verifies in about 20 ms. The server hands out the seeds, so you can't shop for an easy tower. It also rejects runs that are longer than the time since they started.
- **Zero runtime dependencies.** Storage is Node's built-in SQLite (`node:sqlite`) in one file. Live updates use Server-Sent Events, which get through proxies that block WebSockets. The whole package is about 60 kB.

### Arena CLI

| Command | What it does |
| --- | --- |
| `npx icy-tower-reloaded` | Start the arena (`--port 4747`, `--host 0.0.0.0`, `--name "Office Arena"`, `--db <file>`, `--open`) |
| `npx icy-tower-reloaded scores [daily \| <tournament-id>]` | Print a leaderboard in the terminal, e.g. to paste into Slack |
| `npx icy-tower-reloaded tournament create "Friday Cup" --minutes 30 --attempts 3 --starts-in 5` | Schedule a tournament. A running arena picks it up within 2 seconds |
| `npx icy-tower-reloaded tournament list` / `tournament end <id>` | See and end tournaments |
| `npx icy-tower-reloaded players` / `players reset-pin "<name>"` | List climbers (and recently removed ones), or clear a forgotten PIN |

`PORT`, `HOST`, `ICY_TOWER_DB`, `ICY_TOWER_ARENA` and `ICY_TOWER_ADMIN_KEY` work as environment variables too. Requests from the host's own machine are always allowed to host. Anyone who opens the **Host link** once also gets tournament controls on that device.

Picking a climber gives that browser a session token, so the same climber can play on several machines at once. XP, achievements and ghosts stay on each device (one set per climber); names, looks and verified runs live on the arena. Everything lives in one SQLite file, and databases from older versions are upgraded in place (duplicate names become "Sam 2"). To start a fresh season, point `--db` at a new file.

## Develop

```bash
npm install
npm run dev
```

Then open **http://localhost:5173** and press <kbd>Enter</kbd>.

| Command | What it does |
| --- | --- |
| `npm run dev` | The game alone, with hot reload (offline mode, like GitHub Pages) |
| `npm run dev:arena` | Arena server + game with hot reload on **http://localhost:4747** (dev database in `.arena/`) |
| `npm run build` | Type-check, then build the game into `dist/client/` and the arena CLI into `dist/server/` |
| `npm start` | Run the built arena |
| `npm test` | Engine determinism, replay verification and arena API tests |
| `npm run bot` | Headless AI benchmark (`npm run bot -- <games> <seed>`) |

`npm pack` / `npm publish` build first (`prepack`), and the package only ships `dist/`.

## How to play

| | Keyboard | Touch |
| --- | --- | --- |
| Run | <kbd>←</kbd> <kbd>→</kbd> or <kbd>A</kbd> <kbd>D</kbd> | ◀ ▶ pads |
| Jump | <kbd>Space</kbd> or <kbd>↑</kbd> | ▲ pad |
| Pause | <kbd>Esc</kbd> or <kbd>P</kbd> | |

- **Speed is height.** The faster you run, the higher you jump.
- **Bounce off walls** in mid-air to keep your speed.
- **Combos:** chain jumps that skip 2+ floors before the meter runs out. A combo cashes in for floors².
- **Keep moving.** The tower starts scrolling at floor 5 and speeds up every 30 seconds.

## Features

### A new zone every 50 floors

Six themed zones, each with its own palette, cross-faded as you climb. Higher zones add ice, moving, crumbling and spring platforms.

<p align="center">
  <img src="docs/media/zones.png" alt="The six zones: Ice Cave, Frozen Forest, Aurora Heights, Crystal Spire, Magma Frost and Starfield" />
</p>

### Progression

<table>
  <tr>
    <td align="center" width="25%"><img src="docs/media/game-over.png" alt="Game over screen with XP gain and unlocked achievements" /><br /><sub><b>Run summary</b>: XP, badges, unlocks</sub></td>
    <td align="center" width="25%"><img src="docs/media/achievements.png" alt="Achievements grid" /><br /><sub><b>18 achievements</b> that pop mid-run</sub></td>
    <td align="center" width="25%"><img src="docs/media/leaderboard.png" alt="Local leaderboard" /><br /><sub><b>Leaderboards</b>: Endless, Today, AI</sub></td>
    <td align="center" width="25%"><img src="docs/media/help.png" alt="How to play screen" /><br /><sub><b>How to play</b>, built in</sub></td>
  </tr>
</table>

- **XP and player levels**, plus lifetime stats (games, floors, jumps, combos, gems, play time).
- **Personal-best marker** drawn on the tower wall, so you know when you're past it.
- **Pickups:** 💎 gems (+25), 🚀 rocket jump, ❄️ freeze the scroll, 🧲 gem magnet.
- **Juice:** particles, screen shake, combo ratings from "NICE" all the way to "ABSOLUTE ZERO", and synthesized sound with no audio files.
- **Touch controls** on phones and tablets.

### Daily Tower: race your ghost

<img align="right" src="docs/media/daily.gif" width="240" alt="Daily Tower run racing a translucent ghost of the previous best" />

Everyone gets the same seeded tower each day, and it resets at midnight UTC.

Your best run becomes a **ghost** that you race on every retry. The HUD shows how many floors you're ahead or behind (`GHOST 9 (-2)`).

Every run is also recorded as a **replay**. You can watch it back from the game-over screen.

<br clear="right" />

### Watch the AI

<img align="right" src="docs/media/ai.gif" width="240" alt="Frosty the AI climbing through several zones at 4x speed" />

**Frosty** is a lookahead planner. Every few ticks it clones the game, simulates 90 short action plans, and picks the one that ends up highest and safest. It needs no training, because the engine is deterministic and cheap to clone.

Watch it from the menu at ×1, ×4 or ×16 speed. It also plays the attract-mode demo behind the title screen. Headless, it regularly gets past floor 2,000:

```text
$ npm run bot -- 4 7
seed 7: floor 2090, score 69921, best combo 36 floors, 492s game time in 7.3s, replay 15136B verified
seed 8: floor 2574, score 84276, best combo 29 floors, 600s game time in 8.5s, replay 18419B verified
```

<br clear="right" />

## Architecture

The game state is a pure function of `(seed, inputs)`. A whole run is stored as `{ seed, inputs }` in a few KB, and it can be re-simulated anywhere to verify the score.

```
src/engine/   Pure, deterministic simulation: no DOM, no Date, no Math.random
  sim.ts      createGame(seed) / step(state, inputBits) / cloneGame
  replay.ts   Input recorder (RLE), simulateReplay() for verification, Ghost
  rng.ts      Seeded RNG and daily seed
src/agents/   Agent interface (observe → input bits) + PlannerAgent ("Frosty")
src/render/   Canvas renderer, zone themes, particles (driven by engine events)
src/meta/     Profile, XP, achievements, leaderboards (localStorage)
src/net/      Arena client + the wire protocol shared with the server
src/tv/       Big-screen live board (/tv)
src/main.ts   Game loop (fixed 60 Hz + interpolation), menus, pilots (human / AI / replay)
server/       The arena: CLI, HTTP API, SSE live hub, SQLite store, replay verification
scripts/      Headless bot benchmark, GitHub Pages build
tests/        Determinism, cloning, replay round-trip, arena API
```

### Write your own agent

An agent sees an `Observation` each tick and returns an input bitmask. The engine doesn't touch the DOM, so an agent runs in Node at thousands of ticks per second:

```ts
import type { Agent } from './src/agents/api';
import { INPUT_JUMP, INPUT_RIGHT } from './src/engine/constants';

export const bunnyHop: Agent = {
  name: 'Bunny hop',
  act: (obs) => (obs.player.grounded ? INPUT_RIGHT | INPUT_JUMP : INPUT_RIGHT),
};
```

See [`scripts/bot.ts`](scripts/bot.ts) for a headless benchmark loop. In the browser, `window.icyTower` exposes `state`, `observe()` and `lastReplay()` for console tinkering.

## Roadmap

1. ~~**Verified leaderboards.**~~ Shipped as the LAN arena (`npx icy-tower-reloaded`). Next step: a hosted global one.
2. **AI agent arena.** An HTTP/WebSocket API around `observe()`/`step()` lets outside agents (LLMs, Python RL bots) play headless, with their own leaderboard.
3. **Shareable ghosts.** A link that carries a replay, so friends can race each other's runs.
4. **Weekly seasons, cosmetic unlocks** (scarves and hats bought with gems), and **live ghosts** of rivals in tournaments. The arena already streams everyone's floor; streaming their inputs would let you see them climb.

<div align="center">
<sub>All screenshots and GIFs are real gameplay, recorded headlessly from the dev build with Frosty at the controls.</sub>
</div>

## License

[MIT](LICENSE)
