import './style.css';
import { observe, type Agent } from './agents/api';
import { PlannerAgent } from './agents/planner';
import { Sfx } from './audio';
import { TICK_RATE } from './engine/constants';
import { Ghost, InputRecorder, decodeInputs, type Replay } from './engine/replay';
import { dailySeedKey, hashSeed } from './engine/rng';
import { createGame, step, type GameEvent, type GameState } from './engine/sim';
import { Controls } from './input';
import {
  ACHIEVEMENTS,
  boardKey,
  levelFromXp,
  loadProfile,
  recordRun,
  saveProfile,
  type Mode,
  type Profile,
} from './meta/progress';
import { Renderer } from './render/renderer';

type Pilot = { kind: 'human' } | { kind: 'ai'; agent: Agent } | { kind: 'replay'; inputs: Uint8Array; i: number };

interface Session {
  mode: Mode | 'ai';
  state: GameState;
  pilot: Pilot;
  recorder: InputRecorder;
  ghost: Ghost | null;
  boardKey: string;
  prevX: number;
  prevY: number;
  prevCam: number;
  toasted: Set<string>;
  overAt: number;
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const panels = ['menu', 'help', 'board', 'achievements', 'pause', 'over'];

const canvas = $<HTMLCanvasElement>('#game');
const renderer = new Renderer(canvas);
const sfx = new Sfx();
const controls = new Controls($('#touch'));
const profile: Profile = loadProfile();
sfx.muted = profile.muted;
const isTouch = matchMedia('(pointer: coarse)').matches;

let session: Session | null = null;
let paused = false;
let speed = 1;
let lastReplay: Replay | null = null;
let lastMode: Mode | 'ai' = 'endless';
let boardTab = 'endless';

// ---- screens -------------------------------------------------------------------------------

function show(id: string | null) {
  (document.activeElement as HTMLElement | null)?.blur?.();
  for (const p of panels) $(`#${p}`).classList.toggle('hidden', p !== id);
  const playing = id === null && session !== null;
  $('#touch').classList.toggle('hidden', !(playing && isTouch && session?.pilot.kind === 'human'));
  $('#spectator').classList.toggle('hidden', !(playing && session?.pilot.kind !== 'human'));
}

function bestOn(key: string, bots = false) {
  return (profile.boards[key] ?? []).find((e) => bots || !e.bot);
}

function untilNextDaily(): string {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const mins = Math.max(1, Math.round((next - now.getTime()) / 60000));
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}

function renderMenu() {
  $<HTMLInputElement>('#name').value = profile.name;
  const lv = levelFromXp(profile.xp);
  $('#lvl').textContent = `${lv.level}`;
  $('#lvl-ring').style.setProperty('--p', `${(lv.into / lv.need) * 100}`);
  $('#lvl-bar').style.width = `${(lv.into / lv.need) * 100}%`;
  $('#lvl-xp').textContent = `${lv.into.toLocaleString()} / ${lv.need.toLocaleString()} XP`;

  const endless = bestOn('endless');
  $('#endless-meta').textContent = endless
    ? `Best ${endless.score.toLocaleString()} · floor ${endless.floor}`
    : 'How high can you go?';
  const daily = bestOn(boardKey('daily', dailySeedKey()));
  const chip = $('#daily-chip');
  chip.textContent = daily ? 'GHOST' : 'NEW';
  chip.classList.toggle('ghost', !!daily);
  $('#daily-meta').textContent = daily
    ? `Best ${daily.score.toLocaleString()} · new tower in ${untilNextDaily()}`
    : `Same tower for everyone · ends in ${untilNextDaily()}`;
  const ai = bestOn('ai', true);
  $('#ai-meta').textContent = ai ? `Frosty's record: floor ${ai.floor}` : 'Frosty, the lookahead bot';

  $('#ach-count').textContent = `${Object.keys(profile.achievements).length}/${ACHIEVEMENTS.length}`;
  $('#mute').innerHTML = `<span class="ico">${profile.muted ? '🔇' : '🔊'}</span><span>${profile.muted ? 'Muted' : 'Sound'}</span>`;
  show('menu');
  selectMenu(menuIndex, false);
}

// Title menu: one selection shared by keyboard and mouse, like a console menu.
let menuIndex = 0;
const menuEntries = () => [...document.querySelectorAll<HTMLElement>('#menu .item, #menu .dock-btn')];
const modeCount = () => document.querySelectorAll('#menu .item').length;

function selectMenu(i: number, sound = true) {
  const entries = menuEntries();
  const next = Math.max(0, Math.min(entries.length - 1, i));
  if (sound && next !== menuIndex) sfx.menuMove();
  menuIndex = next;
  entries.forEach((el, j) => el.classList.toggle('selected', j === menuIndex));
}

function menuKey(e: KeyboardEvent): boolean {
  const modes = modeCount();
  const inDock = menuIndex >= modes;
  switch (e.code) {
    case 'ArrowDown':
    case 'KeyS':
      if (!inDock) selectMenu(menuIndex + 1);
      return true;
    case 'ArrowUp':
    case 'KeyW':
      selectMenu(inDock ? modes - 1 : menuIndex - 1);
      return true;
    case 'ArrowLeft':
    case 'KeyA':
      if (inDock) selectMenu(Math.max(modes, menuIndex - 1));
      return true;
    case 'ArrowRight':
    case 'KeyD':
      if (inDock) selectMenu(menuIndex + 1);
      return true;
    case 'Enter':
    case 'Space':
      e.preventDefault();
      sfx.unlock();
      menuEntries()[menuIndex]?.click();
      return true;
  }
  return false;
}

function renderBoard() {
  document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === boardTab));
  const key = boardTab === 'daily' ? boardKey('daily', dailySeedKey()) : boardTab;
  const list = profile.boards[key] ?? [];
  const ol = $('#board-list');
  ol.innerHTML = list.length
    ? list
        .map(
          (e, i) =>
            `<li><span class="rank">${['🥇', '🥈', '🥉'][i] ?? i + 1}</span><span>${escapeHtml(e.name)}<small>floor ${e.floor} · combo ${e.combo} · ${new Date(e.date).toLocaleDateString()}</small></span><b>${e.score.toLocaleString()}</b></li>`,
        )
        .join('')
    : `<li class="empty">No runs yet. Go set the bar!</li>`;
  show('board');
}

function renderAchievements() {
  $('#ach-grid').innerHTML = ACHIEVEMENTS.map((a) => {
    const on = profile.achievements[a.id];
    return `<div class="ach ${on ? 'on' : ''}"><span class="icon">${a.icon}</span><div><b>${a.title}</b><span>${a.desc}</span></div></div>`;
  }).join('');
  const l = profile.lifetime;
  const cells: [string, string][] = [
    ['Games', l.games.toLocaleString()],
    ['Floors', l.floors.toLocaleString()],
    ['Jumps', l.jumps.toLocaleString()],
    ['Combos', l.combos.toLocaleString()],
    ['Gems', l.gems.toLocaleString()],
    ['Play time', `${Math.round(l.playSeconds / 60)}m`],
  ];
  $('#lifetime').innerHTML = cells.map(([k, v]) => `<div><b>${v}</b>${k}</div>`).join('');
  show('achievements');
}

function toast(icon: string, title: string, desc: string) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="icon">${icon}</span><div><b>${escapeHtml(title)}</b>${escapeHtml(desc)}</div>`;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// ---- sessions ------------------------------------------------------------------------------

function randomSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

function start(mode: Mode | 'ai', pilot: Pilot, seed: number, ghostReplay: Replay | null = null) {
  sfx.unlock();
  renderer.reset();
  const state = createGame(seed);
  session = {
    mode,
    state,
    pilot,
    recorder: new InputRecorder(),
    ghost: ghostReplay ? new Ghost(ghostReplay) : null,
    boardKey: mode === 'ai' ? 'ai' : boardKey(mode, dailySeedKey()),
    prevX: state.player.x,
    prevY: state.player.y,
    prevCam: state.cameraY,
    toasted: new Set(),
    overAt: 0,
  };
  if (pilot.kind !== 'replay') lastMode = mode;
  paused = false;
  speed = 1;
  $('#ff-btn').textContent = '⏩ ×1';
  show(null);
}

function startMode(mode: Mode | 'ai') {
  if (mode === 'ai') {
    start('ai', { kind: 'ai', agent: new PlannerAgent() }, randomSeed());
  } else if (mode === 'daily') {
    const key = boardKey('daily', dailySeedKey());
    start('daily', { kind: 'human' }, hashSeed(key), profile.ghosts[key] ?? null);
  } else {
    start('endless', { kind: 'human' }, randomSeed());
  }
}

function playReplay(replay: Replay) {
  start(lastMode, { kind: 'replay', inputs: decodeInputs(replay.inputs), i: 0 }, replay.seed);
}

function nextInput(s: Session): number {
  switch (s.pilot.kind) {
    case 'human':
      return controls.read();
    case 'ai':
      return s.pilot.agent.act(observe(s.state), s.state);
    case 'replay':
      return s.pilot.i < s.pilot.inputs.length ? s.pilot.inputs[s.pilot.i++] : 0;
  }
}

function tick(s: Session) {
  const st = s.state;
  s.prevX = st.player.x;
  s.prevY = st.player.y;
  s.prevCam = st.cameraY;
  const input = nextInput(s);
  s.recorder.push(input);
  step(st, input);
  s.ghost?.advance();
  if (st.events.length) {
    renderer.handle(st.events, st);
    if (speed === 1) playSounds(st.events);
  }
  if (s.pilot.kind === 'human' && st.tick % 30 === 0) checkLiveAchievements(s);
  if (st.over && !s.overAt) s.overAt = performance.now();
}

function playSounds(events: GameEvent[]) {
  for (const e of events) {
    switch (e.type) {
      case 'jump':
        sfx.jump(e.power);
        break;
      case 'land':
        if (e.impact > 4) sfx.land();
        break;
      case 'wall':
        sfx.wall();
        break;
      case 'combo':
        sfx.combo(e.floors);
        break;
      case 'comboEnd':
        sfx.comboEnd(e.floors);
        break;
      case 'comboBreak':
        if (e.floors > 0) sfx.comboBreak();
        break;
      case 'pickup':
        if (e.kind === 'gem') sfx.gem();
        else sfx.powerup();
        break;
      case 'spring':
        sfx.spring();
        break;
      case 'crumble':
        sfx.crumble();
        break;
      case 'speedUp':
        sfx.speedUp();
        break;
      case 'milestone':
        sfx.milestone();
        break;
      case 'gameOver':
        sfx.gameOver();
        break;
    }
  }
}

// Run-based achievements pop mid-game; they're committed to the profile when the run ends.
function checkLiveAchievements(s: Session) {
  for (const a of ACHIEVEMENTS) {
    if (profile.achievements[a.id] || s.toasted.has(a.id)) continue;
    if (a.check(s.state, { ...profile.lifetime, games: 0, floors: 0, gems: 0 })) {
      s.toasted.add(a.id);
      toast(a.icon, `Achievement: ${a.title}`, a.desc);
      sfx.achievement();
    }
  }
}

function finish(s: Session) {
  const st = s.state;
  const replay: Replay = { version: 1, seed: st.seed, inputs: s.recorder.encode(), ticks: s.recorder.ticks, score: st.score, floor: st.floor };
  lastReplay = replay;
  if (s.pilot.kind === 'replay') {
    session = null;
    renderMenu();
    return;
  }
  const bot = s.pilot.kind === 'ai';
  const res = recordRun(profile, st, s.boardKey, replay, bot);

  $('#over-title').textContent = bot ? 'The AI fell!' : 'Game Over';
  $('#o-score').textContent = st.score.toLocaleString();
  $('#o-floor').textContent = `${st.floor}`;
  $('#o-combo').textContent = `${st.stats.bestComboFloors}`;
  $('#o-gems').textContent = `${st.stats.gems}`;
  const badges: string[] = [];
  if (res.personalBest) badges.push(`<span class="badge">★ New personal best</span>`);
  if (res.rank > 0 && res.rank <= 3) badges.push(`<span class="badge mint">#${res.rank} on ${s.mode === 'daily' ? "today's" : 'the'} board</span>`);
  if (res.levelAfter > res.levelBefore) badges.push(`<span class="badge pink">Level up! Lv ${res.levelAfter}</span>`);
  if (s.ghost) {
    const diff = st.score - s.ghost.state.score;
    if (s.ghost.state.tick > 0) badges.push(`<span class="badge ${diff >= 0 ? 'mint' : 'pink'}">${diff >= 0 ? 'Beat your ghost' : 'Ghost wins'} (${diff >= 0 ? '+' : ''}${diff.toLocaleString()})</span>`);
  }
  $('#over-badges').innerHTML = badges.join('');

  const xpLine = $('.xp-gain');
  xpLine.classList.toggle('hidden', bot);
  const lv = levelFromXp(profile.xp);
  $('#o-lvl').textContent = `Lv ${lv.level}`;
  $('#o-xp').textContent = `+${res.xp.toLocaleString()} XP`;
  const bar = $('#o-bar');
  bar.style.transition = 'none';
  bar.style.width = res.levelAfter > res.levelBefore ? '0%' : `${(Math.max(0, lv.into - res.xp) / lv.need) * 100}%`;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      bar.style.transition = '';
      bar.style.width = `${(lv.into / lv.need) * 100}%`;
    }),
  );

  $('#o-unlocks').innerHTML = res.unlocked
    .map((a) => `<div class="ach on"><span class="icon">${a.icon}</span><div><b>${a.title}</b><span>${a.desc}</span></div></div>`)
    .join('');
  if (res.unlocked.length) setTimeout(() => sfx.achievement(), 400);
  session = null;
  show('over');
}

// ---- main loop -------------------------------------------------------------------------------

const STEP_MS = 1000 / TICK_RATE;
let acc = 0;
let last = performance.now();
// An idle attract-mode game runs behind the menus.
let attract: Session | null = null;

function makeAttract(): Session {
  const state = createGame(randomSeed());
  return {
    mode: 'ai',
    state,
    pilot: { kind: 'ai', agent: new PlannerAgent({ replanEvery: 4 }) },
    recorder: new InputRecorder(),
    ghost: null,
    boardKey: '',
    prevX: state.player.x,
    prevY: state.player.y,
    prevCam: state.cameraY,
    toasted: new Set(),
    overAt: 0,
  };
}

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(100, now - last);
  last = now;
  const active = session ?? attract;

  if (active && !paused) {
    acc += dt * (session ? speed : 1);
    let steps = 0;
    while (acc >= STEP_MS && steps < 8 * speed) {
      acc -= STEP_MS;
      steps++;
      if (session) {
        if (!session.state.over) tick(session);
      } else if (attract) {
        attract.prevX = attract.state.player.x;
        attract.prevY = attract.state.player.y;
        attract.prevCam = attract.state.cameraY;
        const inp = nextInput(attract);
        step(attract.state, inp);
        if (attract.state.events.length) renderer.handle(attract.state.events, attract.state);
        if (attract.state.over || attract.state.floor > 400) {
          attract = makeAttract();
          renderer.reset();
        }
      }
    }
    if (steps >= 8 * speed) acc = 0;
  }

  if (active) {
    const pilot = active.pilot.kind;
    renderer.draw({
      state: active.state,
      alpha: paused ? 1 : acc / STEP_MS,
      prevX: active.prevX,
      prevY: active.prevY,
      prevCam: active.prevCam,
      ghost: active.ghost?.state ?? null,
      bestFloor: session && pilot === 'human' ? Math.max(0, ...(profile.boards[active.boardKey] ?? []).filter((e) => !e.bot).map((e) => e.floor)) : 0,
      hud: session !== null,
      label: !session ? null : pilot === 'ai' ? '🤖 AI PLAYING' : pilot === 'replay' ? '🎬 REPLAY' : null,
    });
  }

  if (session?.overAt && now - session.overAt > 1100) finish(session);
}

// ---- wiring ---------------------------------------------------------------------------------

controls.onPause = () => {
  if (!session || session.state.over) return;
  paused = !paused;
  show(paused ? 'pause' : null);
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden && session && !session.state.over && session.pilot.kind === 'human' && !paused) controls.onPause?.();
});

document.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action], [data-tab]');
  if (!btn) return;
  sfx.unlock();
  if (btn.dataset.tab) {
    boardTab = btn.dataset.tab;
    renderBoard();
    return;
  }
  switch (btn.dataset.action) {
    case 'endless':
    case 'daily':
    case 'ai':
      attract = null;
      sfx.menuSelect();
      startMode(btn.dataset.action);
      break;
    case 'board':
      renderBoard();
      break;
    case 'achievements':
      renderAchievements();
      break;
    case 'help':
      show('help');
      break;
    case 'back':
      renderMenu();
      break;
    case 'resume':
      paused = false;
      show(null);
      break;
    case 'quit':
      paused = false;
      session = null;
      attract ??= makeAttract();
      renderMenu();
      break;
    case 'retry':
      startMode(lastMode);
      break;
    case 'replay':
      if (lastReplay) playReplay(lastReplay);
      break;
  }
});

$('#name').addEventListener('input', (e) => {
  profile.name = (e.target as HTMLInputElement).value.trim().slice(0, 16);
  saveProfile(profile);
});
$('#name').addEventListener('keydown', (e) => e.stopPropagation());
$('#mute').addEventListener('click', () => {
  profile.muted = !profile.muted;
  sfx.muted = profile.muted;
  saveProfile(profile);
  renderMenu();
});
$('#ff-btn').addEventListener('click', () => {
  speed = speed === 1 ? 4 : speed === 4 ? 16 : 1;
  $('#ff-btn').textContent = `⏩ ×${speed}`;
});
$('#exit-btn').addEventListener('click', () => {
  if (session) {
    session = null;
    attract ??= makeAttract();
    renderMenu();
  }
});
const isOpen = (id: string) => !$(`#${id}`).classList.contains('hidden');
window.addEventListener('keydown', (e) => {
  if (session || document.activeElement instanceof HTMLInputElement) return;
  if (isOpen('menu')) menuKey(e);
  else if (isOpen('over') && e.code === 'Enter') startMode(lastMode);
  else if (e.code === 'Escape' && (isOpen('help') || isOpen('board') || isOpen('achievements'))) renderMenu();
});
document.querySelectorAll<HTMLElement>('#menu .item, #menu .dock-btn').forEach((el, i) =>
  el.addEventListener('pointerenter', () => selectMenu(i)),
);
setInterval(() => {
  if (!session && isOpen('menu') && document.activeElement?.id !== 'name') renderMenu();
}, 30000);

// Expose the engine for external agents / console tinkering.
(window as unknown as Record<string, unknown>).icyTower = {
  get state() {
    return session?.state;
  },
  observe: () => (session ? observe(session.state) : null),
  input: () => controls.read(),
  lastReplay: () => lastReplay,
};

attract = makeAttract();
renderMenu();
requestAnimationFrame(frame);
