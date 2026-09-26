// Deterministic game simulation. No DOM, no Date, no Math.random:
// same seed + same per-tick inputs => identical game, on any machine.
// That property powers replays, ghosts, server-side score verification and AI agents.
import * as C from './constants';
import { nextRandom } from './rng';

export type PlatformKind = 'normal' | 'ice' | 'moving' | 'crumble' | 'spring' | 'milestone';
export type PickupKind = 'gem' | 'rocket' | 'freeze' | 'magnet';

export interface Platform {
  floor: number;
  x: number; // left edge
  w: number;
  kind: PlatformKind;
  vx: number; // moving platforms only
  crumble: number; // -1 untouched, >0 ticks until it breaks
  broken: boolean;
}

export interface Pickup {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
  taken: boolean;
}

export interface Player {
  x: number; // center
  y: number; // feet
  vx: number;
  vy: number;
  grounded: boolean;
  groundFloor: number;
  jumpFloor: number;
  coyote: number;
  facing: 1 | -1;
}

export interface Combo {
  active: boolean;
  floors: number;
  jumps: number;
  timer: number;
}

export interface Stats {
  jumps: number;
  wallBounces: number;
  combos: number;
  bestComboFloors: number;
  bestComboPoints: number;
  gems: number;
  powerups: number;
  springs: number;
}

export type GameEvent =
  | { type: 'jump'; power: number; rocket: boolean }
  | { type: 'land'; floor: number; delta: number; impact: number; kind: PlatformKind }
  | { type: 'wall'; side: -1 | 1; speed: number }
  | { type: 'combo'; floors: number; jumps: number }
  | { type: 'comboEnd'; floors: number; jumps: number; points: number }
  | { type: 'comboBreak'; floors: number }
  | { type: 'pickup'; kind: PickupKind; x: number; y: number }
  | { type: 'milestone'; floor: number }
  | { type: 'speedUp'; level: number }
  | { type: 'spring'; x: number; y: number }
  | { type: 'crumble'; floor: number }
  | { type: 'gameOver' };

export interface GameState {
  seed: number;
  rng: number;
  tick: number;
  player: Player;
  platforms: Platform[]; // contiguous floors, platforms[i].floor === platforms[0].floor + i
  pickups: Pickup[];
  nextFloor: number;
  nextPickupId: number;
  cameraY: number; // world y of the bottom of the screen
  scrolling: boolean;
  speedLevel: number;
  speedTicks: number;
  floor: number; // highest floor reached
  score: number;
  comboScore: number;
  gemScore: number;
  combo: Combo;
  rocket: number; // charges
  freeze: number; // ticks
  magnet: number; // ticks
  over: boolean;
  stats: Stats;
  events: GameEvent[]; // events produced by the latest step only
}

export function createGame(seed: number): GameState {
  const s: GameState = {
    seed: seed >>> 0,
    rng: seed >>> 0,
    tick: 0,
    player: {
      x: C.VIEW_W / 2,
      y: 0,
      vx: 0,
      vy: 0,
      grounded: true,
      groundFloor: 0,
      jumpFloor: 0,
      coyote: 0,
      facing: 1,
    },
    platforms: [],
    pickups: [],
    nextFloor: 0,
    nextPickupId: 1,
    cameraY: -60,
    scrolling: false,
    speedLevel: 1,
    speedTicks: 0,
    floor: 0,
    score: 0,
    comboScore: 0,
    gemScore: 0,
    combo: { active: false, floors: 0, jumps: 0, timer: 0 },
    rocket: 0,
    freeze: 0,
    magnet: 0,
    over: false,
    stats: {
      jumps: 0,
      wallBounces: 0,
      combos: 0,
      bestComboFloors: 0,
      bestComboPoints: 0,
      gems: 0,
      powerups: 0,
      springs: 0,
    },
    events: [],
  };
  generate(s);
  return s;
}

export function cloneGame(s: GameState): GameState {
  return {
    ...s,
    player: { ...s.player },
    platforms: s.platforms.map((p) => ({ ...p })),
    pickups: s.pickups.map((p) => ({ ...p })),
    combo: { ...s.combo },
    stats: { ...s.stats },
    events: [],
  };
}

export function platformAt(s: GameState, floor: number): Platform | undefined {
  if (s.platforms.length === 0) return undefined;
  return s.platforms[floor - s.platforms[0].floor];
}

function overlaps(px: number, plat: Platform): boolean {
  return px + C.PLAYER_R * 0.6 >= plat.x && px - C.PLAYER_R * 0.6 <= plat.x + plat.w;
}

function makePlatform(s: GameState, f: number): Platform {
  const full = f === 0 || f % C.MILESTONE_EVERY === 0;
  if (full) {
    return { floor: f, x: C.PLAY_L, w: C.PLAY_R - C.PLAY_L, kind: 'milestone', vx: 0, crumble: -1, broken: false };
  }
  const d = Math.min(1, f / 600);
  const w = Math.round(190 - 115 * d + nextRandom(s) * (80 - 40 * d));
  const x = Math.round(C.PLAY_L + nextRandom(s) * (C.PLAY_R - C.PLAY_L - w));

  const pSpring = f >= 25 ? 0.035 : 0;
  const pIce = f >= 40 ? Math.min(0.2, 0.06 + (f - 40) / 2000) : 0;
  const pMoving = f >= 60 ? Math.min(0.22, 0.06 + (f - 60) / 1500) : 0;
  const pCrumble = f >= 120 ? Math.min(0.18, 0.05 + (f - 120) / 1500) : 0;
  const r = nextRandom(s);
  let kind: PlatformKind = 'normal';
  let vx = 0;
  if (r < pSpring) kind = 'spring';
  else if (r < pSpring + pIce) kind = 'ice';
  else if (r < pSpring + pIce + pMoving) {
    kind = 'moving';
    vx = (nextRandom(s) < 0.5 ? -1 : 1) * (0.7 + nextRandom(s) * (0.6 + 1.4 * d));
  } else if (r < pSpring + pIce + pMoving + pCrumble) kind = 'crumble';

  const cx = x + w / 2;
  const y = f * C.FLOOR_GAP;
  if (f >= 3 && nextRandom(s) < 0.3) {
    s.pickups.push({ id: s.nextPickupId++, kind: 'gem', x: cx + (nextRandom(s) - 0.5) * w * 0.6, y: y + 30, taken: false });
  }
  if (f >= 12 && nextRandom(s) < 0.045) {
    const k = nextRandom(s);
    const kindP: PickupKind = k < 0.4 ? 'rocket' : k < 0.7 ? 'freeze' : 'magnet';
    s.pickups.push({ id: s.nextPickupId++, kind: kindP, x: cx, y: y + 36, taken: false });
  }
  return { floor: f, x, w, kind, vx, crumble: -1, broken: false };
}

function generate(s: GameState) {
  const top = s.cameraY + C.VIEW_H + 4 * C.FLOOR_GAP;
  while (s.nextFloor * C.FLOOR_GAP < top) {
    s.platforms.push(makePlatform(s, s.nextFloor));
    s.nextFloor++;
  }
  const bottom = s.cameraY - 3 * C.FLOOR_GAP;
  let drop = 0;
  // Always keep the platform the player stands on (the camera could, in theory, outrun it for a tick).
  while (drop < s.platforms.length - 1 && (s.platforms[drop].floor + 1) * C.FLOOR_GAP < bottom && s.platforms[drop].floor < s.player.groundFloor) drop++;
  if (drop > 0) s.platforms.splice(0, drop);
  if (s.pickups.length && s.pickups[0].y < bottom) s.pickups = s.pickups.filter((p) => p.y >= bottom && !p.taken);
}

function endCombo(s: GameState) {
  const c = s.combo;
  if (!c.active) return;
  if (c.jumps >= C.COMBO_MIN_JUMPS && c.floors >= C.COMBO_MIN_FLOORS) {
    const points = c.floors * c.floors;
    s.comboScore += points;
    s.stats.combos++;
    s.stats.bestComboFloors = Math.max(s.stats.bestComboFloors, c.floors);
    s.stats.bestComboPoints = Math.max(s.stats.bestComboPoints, points);
    s.events.push({ type: 'comboEnd', floors: c.floors, jumps: c.jumps, points });
  } else {
    s.events.push({ type: 'comboBreak', floors: c.floors });
  }
  c.active = false;
  c.floors = 0;
  c.jumps = 0;
  c.timer = 0;
}

function land(s: GameState, plat: Platform, impact: number) {
  const p = s.player;
  const f = plat.floor;
  p.y = f * C.FLOOR_GAP;
  p.vy = 0;
  p.grounded = true;
  p.groundFloor = f;
  const delta = f - p.jumpFloor;
  s.events.push({ type: 'land', floor: f, delta, impact, kind: plat.kind });

  if (delta >= 2) {
    const c = s.combo;
    c.active = true;
    c.floors += delta;
    c.jumps++;
    c.timer = C.COMBO_TICKS;
    s.events.push({ type: 'combo', floors: c.floors, jumps: c.jumps });
  } else if (delta !== 0 || !s.combo.active) {
    // Landing back on the same floor (e.g. a wall-bounce hop) keeps the combo clock running.
    endCombo(s);
  }

  if (f > s.floor) {
    for (let m = Math.floor(s.floor / C.MILESTONE_EVERY) + 1; m * C.MILESTONE_EVERY <= f; m++) {
      s.events.push({ type: 'milestone', floor: m * C.MILESTONE_EVERY });
    }
    s.floor = f;
  }

  if (plat.kind === 'crumble' && plat.crumble < 0) {
    plat.crumble = 36;
    s.events.push({ type: 'crumble', floor: f });
  }
  if (plat.kind === 'spring') {
    p.vy = C.SPRING_VY;
    p.grounded = false;
    p.jumpFloor = f;
    s.stats.springs++;
    s.events.push({ type: 'spring', x: p.x, y: p.y });
  }
}

function collect(s: GameState, pk: Pickup) {
  pk.taken = true;
  switch (pk.kind) {
    case 'gem':
      s.gemScore += C.GEM_POINTS;
      s.stats.gems++;
      break;
    case 'rocket':
      s.rocket += 1;
      s.stats.powerups++;
      break;
    case 'freeze':
      s.freeze = C.FREEZE_TICKS;
      s.stats.powerups++;
      break;
    case 'magnet':
      s.magnet = C.MAGNET_TICKS;
      s.stats.powerups++;
      break;
  }
  s.events.push({ type: 'pickup', kind: pk.kind, x: pk.x, y: pk.y });
}

export function step(s: GameState, input: number): void {
  s.events.length = 0;
  if (s.over) return;
  s.tick++;
  const p = s.player;
  const left = (input & C.INPUT_LEFT) !== 0;
  const right = (input & C.INPUT_RIGHT) !== 0;
  const jump = (input & C.INPUT_JUMP) !== 0;

  // Platforms: movement and crumbling.
  for (const plat of s.platforms) {
    if (plat.broken) continue;
    if (plat.kind === 'moving') {
      plat.x += plat.vx;
      if (plat.x < C.PLAY_L) {
        plat.x = C.PLAY_L;
        plat.vx = -plat.vx;
      } else if (plat.x + plat.w > C.PLAY_R) {
        plat.x = C.PLAY_R - plat.w;
        plat.vx = -plat.vx;
      }
      if (p.grounded && p.groundFloor === plat.floor) p.x += plat.vx;
    }
    if (plat.crumble > 0 && --plat.crumble === 0) plat.broken = true;
  }

  // Horizontal movement.
  const ground = p.grounded ? platformAt(s, p.groundFloor) : undefined;
  const accel = p.grounded ? C.GROUND_ACCEL : C.AIR_ACCEL;
  if (left !== right) {
    const dir = left ? -1 : 1;
    // Turning around on the ground is snappier than accelerating.
    const turning = p.grounded && Math.sign(p.vx) === -dir && ground?.kind !== 'ice';
    p.vx += dir * accel * (turning ? 2 : 1);
    p.facing = dir as 1 | -1;
  } else if (p.grounded) {
    p.vx *= ground?.kind === 'ice' ? C.ICE_FRICTION : C.GROUND_FRICTION;
    if (Math.abs(p.vx) < 0.05) p.vx = 0;
  } else {
    p.vx *= C.AIR_DRAG;
  }
  p.vx = Math.max(-C.MAX_VX, Math.min(C.MAX_VX, p.vx));
  p.x += p.vx;

  // Walls: airborne hits bounce back at full speed (the classic combo trick).
  const minX = C.PLAY_L + C.PLAYER_R;
  const maxX = C.PLAY_R - C.PLAYER_R;
  if (p.x < minX || p.x > maxX) {
    const side: -1 | 1 = p.x < minX ? -1 : 1;
    p.x = side < 0 ? minX : maxX;
    if (!p.grounded && Math.abs(p.vx) > 2) {
      s.events.push({ type: 'wall', side, speed: Math.abs(p.vx) });
      p.vx = -p.vx;
      p.facing = side < 0 ? 1 : -1;
      s.stats.wallBounces++;
    } else {
      p.vx = 0;
    }
  }

  // Walking off an edge or standing on a platform that just crumbled.
  if (p.grounded) {
    const plat = platformAt(s, p.groundFloor);
    if (!plat || plat.broken || !overlaps(p.x, plat)) {
      p.grounded = false;
      p.coyote = C.COYOTE_TICKS;
      p.jumpFloor = p.groundFloor;
    }
  }

  if (jump && (p.grounded || p.coyote > 0)) {
    let vy = C.JUMP_BASE + Math.abs(p.vx) * C.JUMP_SPEED_BONUS;
    const rocket = s.rocket > 0;
    if (rocket) {
      vy *= C.ROCKET_MULT;
      s.rocket--;
    }
    p.vy = vy;
    p.grounded = false;
    p.coyote = 0;
    p.jumpFloor = p.groundFloor;
    s.stats.jumps++;
    s.events.push({ type: 'jump', power: vy, rocket });
  }

  if (!p.grounded) {
    if (p.coyote > 0) p.coyote--;
    p.vy = Math.max(p.vy - C.GRAVITY, -C.MAX_FALL);
    const prevY = p.y;
    p.y += p.vy;
    if (p.vy <= 0) {
      const hi = Math.floor(prevY / C.FLOOR_GAP);
      const lo = Math.ceil(p.y / C.FLOOR_GAP);
      for (let f = hi; f >= lo; f--) {
        const plat = platformAt(s, f);
        if (plat && !plat.broken && overlaps(p.x, plat)) {
          land(s, plat, -p.vy);
          break;
        }
      }
    }
  }

  if (s.combo.active && --s.combo.timer <= 0) endCombo(s);

  // Pickups.
  const pcy = p.y + C.PLAYER_H / 2;
  for (const pk of s.pickups) {
    if (pk.taken) continue;
    if (s.magnet > 0 && pk.kind === 'gem') {
      const dx = p.x - pk.x;
      const dy = pcy - pk.y;
      if (dx * dx + dy * dy < C.MAGNET_RADIUS * C.MAGNET_RADIUS) {
        pk.x += dx * 0.18;
        pk.y += dy * 0.18;
      }
    }
    if (Math.abs(pk.x - p.x) < C.PLAYER_R + 12 && Math.abs(pk.y - pcy) < C.PLAYER_H / 2 + 12) collect(s, pk);
  }

  // Camera: slow auto-scroll that speeds up every 30s, plus catch-up when the player climbs fast.
  if (!s.scrolling && s.floor >= C.SCROLL_START_FLOOR) s.scrolling = true;
  if (s.scrolling) {
    if (++s.speedTicks >= C.SPEED_LEVEL_TICKS && s.speedLevel < C.MAX_SPEED_LEVEL) {
      s.speedLevel++;
      s.speedTicks = 0;
      s.events.push({ type: 'speedUp', level: s.speedLevel });
    }
    if (s.freeze > 0) s.freeze--;
    else s.cameraY += C.BASE_SCROLL + (s.speedLevel - 1) * C.SCROLL_PER_LEVEL;
  }
  const target = p.y - C.VIEW_H * C.CATCHUP_LINE;
  if (s.cameraY < target) s.cameraY += (target - s.cameraY) * 0.12;
  const hardTop = p.y + C.PLAYER_H + 160 - C.VIEW_H;
  if (s.cameraY < hardTop) s.cameraY = hardTop;
  if (s.magnet > 0) s.magnet--;

  generate(s);

  if (p.y + C.PLAYER_H < s.cameraY - 10) {
    endCombo(s);
    s.over = true;
    s.events.push({ type: 'gameOver' });
  }

  s.score = s.floor * C.FLOOR_POINTS + s.comboScore + s.gemScore;
}

export function comboRating(floors: number): string {
  if (floors >= 200) return 'ABSOLUTE ZERO';
  if (floors >= 140) return 'GLACIAL!';
  if (floors >= 100) return 'AVALANCHE!';
  if (floors >= 70) return 'BLIZZARD!';
  if (floors >= 45) return 'FROSTBITE!';
  if (floors >= 25) return 'SLICK!';
  if (floors >= 15) return 'CHILLY!';
  if (floors >= 8) return 'COOL!';
  return 'NICE';
}
