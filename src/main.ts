import './style.css';
import { observe, type Agent } from './agents/api';
import { PlannerAgent } from './agents/planner';
import { Sfx } from './audio';
import { TICK_RATE, VIEW_H } from './engine/constants';
import { Ghost, InputRecorder, decodeInputs, type Replay } from './engine/replay';
import { dailySeedKey, hashSeed } from './engine/rng';
import { createGame, step, type GameEvent, type GameState } from './engine/sim';
import { Controls } from './input';
import { Music, type MusicMood } from './music';
import { ArenaClient } from './net/arena';
import { tournamentStatus, type BoardEntry, type CharacterStat, type ServerEvent, type StartedRun, type Tournament, type TournamentStatus } from './net/protocol';
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
import { avatarURL, CHARACTERS, COLORS, DEFAULT_LOOK, drawStage, EXTRAS, FROSTY_LOOK, HATS, randomLook, type Look } from './render/characters';
import { Renderer, type Rival } from './render/renderer';

type Pilot = { kind: 'human' } | { kind: 'ai'; agent: Agent } | { kind: 'replay'; inputs: Uint8Array; i: number };
type PlayMode = Mode | 'tournament' | 'ai';

interface Session {
  mode: PlayMode;
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
  runId: string | null; // set when the arena is keeping score
  tournament: Tournament | null;
  timeUp: boolean; // the tournament clock ended the run
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const panels = ['menu', 'help', 'board', 'achievements', 'pause', 'over', 'wardrobe', 'host'];

const canvas = $<HTMLCanvasElement>('#game');
const renderer = new Renderer(canvas);
const sfx = new Sfx();
const controls = new Controls($('#touch'));
const profile: Profile = loadProfile();
sfx.muted = profile.muted;
const music = new Music(sfx);
music.enabled = profile.music;
const isTouch = matchMedia('(pointer: coarse)').matches;
const arena = new ArenaClient();

let session: Session | null = null;
let paused = false;
let speed = 1;
let lastReplay: Replay | null = null;
let lastMode: PlayMode = 'endless';
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
  $<HTMLImageElement>('#pc-avatar').src = avatarURL(profile.look);
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
  paintMusicBtn();
  renderArena();
  show('menu');
  selectMenu(menuIndex, false);
}

// Title menu: one selection shared by keyboard and mouse, like a console menu.
let menuIndex = 0;
const menuEntries = () => [...document.querySelectorAll<HTMLElement>('#menu .item:not(.hidden), #menu .dock-btn')];
const modeCount = () => document.querySelectorAll('#menu .item:not(.hidden)').length;

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

function boardRow(e: { name: string; look?: Look; bot?: boolean; score: number }, i: number, sub: string, cls = '', attrs = '') {
  const rank = i < 0 ? '–' : (['🥇', '🥈', '🥉'][i] ?? i + 1);
  return `<li class="${cls}" ${attrs}><span class="rank">${rank}</span><img class="av" src="${avatarURL(e.look ?? (e.bot ? FROSTY_LOOK : DEFAULT_LOOK))}" alt="" /><span>${escapeHtml(e.name)}<small>${sub}</small></span><b>${e.score.toLocaleString()}</b></li>`;
}

const emptyRow = (text: string) => `<li class="empty">${text}</li>`;

/** The tournament the Scores panel shows: the featured one, else the most recent. */
const boardCup = () => arena.featured() ?? arena.tournaments[0] ?? null;

function boardTabs(): { id: string; label: string }[] {
  if (!arena.connected) {
    return [
      { id: 'endless', label: 'Endless' },
      { id: 'daily', label: 'Today' },
      { id: 'ai', label: 'AI' },
    ];
  }
  const cup = boardCup();
  return [
    { id: 'endless', label: 'Endless' },
    { id: 'daily', label: 'Today' },
    ...(cup ? [{ id: 'cup', label: '🏆 Cup' }] : []),
    { id: 'chars', label: 'Characters' },
  ];
}

function arenaBoardKey(tab: string): string | null {
  if (tab === 'endless') return 'endless';
  if (tab === 'daily') return 'daily';
  if (tab === 'cup') return boardCup()?.board ?? null;
  return null;
}

/** Does the open Scores tab show this server board? */
function boardShows(board: string) {
  const key = arenaBoardKey(boardTab);
  return key === board || (key === 'daily' && board.startsWith('daily:'));
}

let boardReq = 0;

async function renderBoard(refresh = false) {
  const tabs = boardTabs();
  if (!tabs.some((t) => t.id === boardTab)) boardTab = tabs[0].id;
  $('#board-tabs').innerHTML = tabs
    .map((t) => `<button data-tab="${t.id}" class="${t.id === boardTab ? 'active' : ''}">${escapeHtml(t.label)}</button>`)
    .join('');
  if (!isOpen('board')) show('board');
  const ol = $('#board-list');
  const head = $('#board-head');
  const req = ++boardReq;

  if (!arena.connected || boardTab === 'ai') {
    head.classList.add('hidden');
    $('#board-note').innerHTML = arena.connected
      ? 'AI runs stay on this device.'
      : 'Scores are stored on this device. Host an arena with <code>npx icy-tower-reloaded</code> to compete with your team.';
    const key = boardTab === 'daily' ? boardKey('daily', dailySeedKey()) : boardTab;
    const list = profile.boards[key] ?? [];
    ol.innerHTML = list.length
      ? list.map((e, i) => boardRow(e, i, `floor ${e.floor} · combo ${e.combo} · ${new Date(e.date).toLocaleDateString()}`)).join('')
      : emptyRow('No runs yet. Go set the bar!');
    return;
  }

  $('#board-note').textContent = 'Every run is replayed on the arena server before it counts, so these scores are real.';
  if (!refresh) ol.innerHTML = emptyRow('Loading…');
  try {
    if (boardTab === 'chars') {
      head.classList.add('hidden');
      const stats = await arena.characters();
      if (req === boardReq) ol.innerHTML = characterRows(stats);
      return;
    }
    const key = arenaBoardKey(boardTab)!;
    const rows = await arena.board(key);
    if (req !== boardReq) return;
    updateBoardHead();
    ol.innerHTML = rows.length
      ? rows.map((e) => arenaRow(e)).join('')
      : emptyRow(boardTab === 'cup' ? 'No scores yet. The podium is wide open!' : 'No runs yet. Go set the bar!');
    markClimbing();
  } catch {
    if (req === boardReq) ol.innerHTML = emptyRow("Couldn't reach the arena.");
  }
}

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

function arenaRow(e: BoardEntry) {
  const sub = `floor ${e.floor} · combo ${e.combo} · ${plural(e.runs, 'run')}`;
  return boardRow(e, e.rank - 1, sub, e.playerId === arena.playerId ? 'me' : '', `data-player="${e.playerId}"`);
}

function characterRows(stats: CharacterStat[]) {
  return stats
    .map((c, i) => {
      const ch = CHARACTERS.find((x) => x.id === c.char)!;
      const sub = c.runs
        ? `${c.champion ? `record by ${escapeHtml(c.champion.name)} · ` : ''}${plural(c.runs, 'run')} · avg ${c.avgScore.toLocaleString()} · worn by ${c.wearing}`
        : `No runs yet · worn by ${c.wearing}`;
      return boardRow({ name: ch.name, look: { ...DEFAULT_LOOK, char: c.char }, score: c.bestScore }, c.runs ? i : -1, sub);
    })
    .join('');
}

/** Status line above a tournament board. */
function updateBoardHead() {
  const head = $('#board-head');
  const cup = boardTab === 'cup' ? boardCup() : null;
  head.classList.toggle('hidden', !cup);
  if (!cup) return;
  const now = arena.now();
  const status = tournamentStatus(cup, now);
  const when =
    status === 'upcoming' ? `starts in <b>${duration(cup.startsAt - now)}</b>` : status === 'live' ? `<b>${duration(cup.endsAt - now)}</b> left` : 'final standings';
  const tries = cup.maxAttempts ? ` · ${cup.maxAttempts} attempt${cup.maxAttempts === 1 ? '' : 's'} each` : '';
  head.innerHTML = `${status === 'live' ? '🔴' : status === 'upcoming' ? '⏳' : '🏁'} <b>${escapeHtml(cup.name)}</b> · ${when} · ${plural(cup.players, 'player')}${tries}`;
}

function markClimbing() {
  const board = arenaBoardKey(boardTab);
  const ids = new Set(
    arena.presence.climbers.filter((c) => c.board === board || (board === 'daily' && c.board.startsWith('daily:'))).map((c) => c.playerId),
  );
  document.querySelectorAll<HTMLElement>('#board-list li[data-player]').forEach((li) => li.classList.toggle('climbing', ids.has(li.dataset.player!)));
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

// ---- wardrobe ------------------------------------------------------------------------------

let wardrobePop = 0;

function renderWardrobe() {
  const l = profile.look;
  const ch = CHARACTERS.find((c) => c.id === l.char)!;
  $('#wd-name').textContent = ch.name;
  $('#wd-tag').textContent = ch.tag;
  $('#wd-chars').innerHTML = CHARACTERS.map(
    (c) => `<button class="wd-char ${c.id === l.char ? 'on' : ''}" data-char="${c.id}"><img src="${avatarURL({ ...l, char: c.id }, 56)}" alt="" /><span>${c.name}</span></button>`,
  ).join('');
  $('#wd-hat').innerHTML = HATS.map((h) => `<button class="opt ${h.id === l.hat ? 'on' : ''}" data-hat="${h.id}" title="${h.name}">${h.icon}</button>`).join('');
  $('#wd-color').innerHTML = COLORS.map((c, i) => `<button class="opt swatch ${i === l.color ? 'on' : ''}" data-color="${i}" style="--c:${c}" aria-label="Colour ${i + 1}"></button>`).join('');
  $('#wd-extra').innerHTML = EXTRAS.map((x) => `<button class="opt ${x.id === l.extra ? 'on' : ''}" data-extra="${x.id}" title="${x.name}">${x.icon}</button>`).join('');
}

function setLook(patch: Partial<Look>) {
  profile.look = { ...profile.look, ...patch };
  saveProfile(profile);
  syncProfile();
  wardrobePop = 1;
  sfx.menuMove();
  renderWardrobe();
}

function cycleCharacter(dir: number) {
  const i = CHARACTERS.findIndex((c) => c.id === profile.look.char);
  setLook({ char: CHARACTERS[(i + dir + CHARACTERS.length) % CHARACTERS.length].id });
}

$('#wardrobe').addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-char], [data-hat], [data-color], [data-extra], [data-wd]');
  if (!el) return;
  const d = el.dataset;
  if (d.char) setLook({ char: d.char as Look['char'] });
  else if (d.hat) setLook({ hat: d.hat as Look['hat'] });
  else if (d.color) setLook({ color: Number(d.color) });
  else if (d.extra) setLook({ extra: d.extra as Look['extra'] });
  else if (d.wd === 'prev') cycleCharacter(-1);
  else if (d.wd === 'next') cycleCharacter(1);
  else if (d.wd === 'random') setLook(randomLook());
});

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

interface StartOptions {
  ghost?: Replay | null;
  board?: string;
  run?: StartedRun | null;
  tournament?: Tournament | null;
}

function start(mode: PlayMode, pilot: Pilot, seed: number, o: StartOptions = {}) {
  sfx.unlock();
  renderer.reset();
  const state = createGame(seed);
  session = {
    mode,
    state,
    pilot,
    recorder: new InputRecorder(),
    ghost: o.ghost ? new Ghost(o.ghost) : null,
    boardKey: o.board ?? (mode === 'ai' ? 'ai' : boardKey(mode === 'daily' ? 'daily' : 'endless', dailySeedKey())),
    prevX: state.player.x,
    prevY: state.player.y,
    prevCam: state.cameraY,
    toasted: new Set(),
    overAt: 0,
    runId: o.run?.runId ?? null,
    tournament: o.tournament ?? null,
    timeUp: false,
  };
  if (pilot.kind !== 'replay') lastMode = mode;
  paused = false;
  speed = 1;
  $('#ff-btn').textContent = '⏩ ×1';
  show(null);
}

let starting = false;

async function startMode(mode: PlayMode) {
  if (starting) return;
  if (mode === 'ai') return start('ai', { kind: 'ai', agent: new PlannerAgent() }, randomSeed());

  // With an arena, the server hands out the seed and keeps score; without one we play locally.
  const tournament = mode === 'tournament' ? arena.featured() : null;
  let run: StartedRun | null = null;
  if (arena.connected) {
    starting = true;
    try {
      run = await arena.startRun(mode, tournament?.id);
    } catch (err) {
      if (mode === 'tournament') {
        toast('⛔', "Can't join right now", (err as Error).message);
        backToMenu();
        return;
      }
      toast('📡', 'Playing offline', 'The arena is unreachable, so this run stays on this device.');
    } finally {
      starting = false;
    }
  }
  if (mode === 'tournament' && (!run || !tournament)) return backToMenu();

  const board = run?.board ?? (mode === 'daily' ? boardKey('daily', dailySeedKey()) : 'endless');
  const seed = run?.seed ?? (mode === 'daily' ? hashSeed(board) : randomSeed());
  const ghost = mode === 'endless' ? null : (profile.ghosts[board] ?? null);
  start(mode, { kind: 'human' }, seed, { board, run, tournament, ghost });
  if (tournament && run?.attemptsLeft != null) {
    attemptsLeft.set(tournament.id, run.attemptsLeft);
    toast('🎯', run.attemptsLeft ? `${run.attemptsLeft} attempt${run.attemptsLeft === 1 ? '' : 's'} left after this one` : 'Last attempt!', 'Make it count.');
  }
}

function backToMenu() {
  session = null;
  attract ??= makeAttract();
  renderMenu();
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
  if (s.runId && st.tick % TICK_RATE === 0) arena.progress(s.runId, st.floor, st.score);
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
        music.surge();
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
  submitRun(s, replay);

  $('#over-title').textContent = bot ? 'The AI fell!' : s.timeUp ? "Time's up!" : 'Game Over';
  $('#o-score').textContent = st.score.toLocaleString();
  $('#o-floor').textContent = `${st.floor}`;
  $('#o-combo').textContent = `${st.stats.bestComboFloors}`;
  $('#o-gems').textContent = `${st.stats.gems}`;
  const badges: string[] = [];
  if (res.personalBest) badges.push(`<span class="badge">★ New personal best</span>`);
  if (!s.runId && res.rank > 0 && res.rank <= 3) badges.push(`<span class="badge mint">#${res.rank} on ${s.mode === 'daily' ? "today's" : 'the'} board</span>`);
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

// Sends the replay to the arena, which re-simulates it and answers with where it placed.
let submitSeq = 0;

async function submitRun(s: Session, replay: Replay) {
  const box = $('#o-arena');
  box.className = 'arena-result';
  box.classList.toggle('hidden', !s.runId);
  if (!s.runId) return;
  const seq = ++submitSeq;
  box.textContent = '📡 Verifying your run with the arena…';
  try {
    const r = await arena.finishRun(s.runId, replay);
    if (seq !== submitSeq) return;
    const medal = ['🥇', '🥈', '🥉'][r.rank - 1] ?? '';
    const best = r.personalBest ? ' · <span class="badge mint">New best</span>' : ` · your best is ${r.previousBest.toLocaleString()}`;
    box.innerHTML = `${medal} <b>#${r.rank}</b> of ${r.players} ${boardLabel(r.board)}${best}`;
  } catch (err) {
    if (seq !== submitSeq) return;
    box.classList.add('error');
    box.textContent = `⚠️ ${(err as Error).message}`;
  }
}

function boardLabel(board: string) {
  if (board === 'endless') return 'all-time';
  if (board.startsWith('daily:')) return "on today's tower";
  const t = arena.tournaments.find((x) => x.board === board);
  return t ? `in ${escapeHtml(t.name)}` : 'in the tournament';
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
    runId: null,
    tournament: null,
    timeUp: false,
  };
}

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(100, now - last);
  last = now;
  const active = session ?? attract;

  // A tournament's clock ends every run still in the air.
  const cup = session?.tournament;
  if (session && cup && !session.state.over && arena.now() >= cup.endsAt) {
    session.state.over = true;
    session.timeUp = true;
    session.overAt = now;
    paused = false;
    show(null);
    renderer.announce("TIME'S UP!", cup.name);
    sfx.gameOver();
  }

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
      look: session && pilot !== 'ai' ? profile.look : FROSTY_LOOK,
      rivals: session && pilot === 'human' ? rivalsOn(session.boardKey) : undefined,
      clock: session?.tournament && pilot === 'human' ? clock(session.tournament.endsAt - arena.now()) : null,
    });
  }
  if (isOpen('wardrobe')) {
    drawStage($<HTMLCanvasElement>('#wd-preview'), profile.look, now / (1000 / 60), wardrobePop);
    wardrobePop *= 0.85;
  }

  music.update(musicMood());
  if (session?.overAt && now - session.overAt > (session.timeUp ? 2400 : 1100)) finish(session);
}

function musicMood(): MusicMood {
  if (!session) return { scene: 'menu' };
  const st = session.state;
  // Danger ramps up over the bottom ~quarter of the screen once the tower is scrolling.
  const height = (st.player.y - st.cameraY) / VIEW_H;
  return {
    scene: 'play',
    speedLevel: st.speedLevel,
    scrolling: st.scrolling,
    floor: st.floor,
    danger: st.scrolling ? Math.max(0, Math.min(1, (0.28 - height) / 0.28)) : 0,
    combo: st.combo.active,
    frozen: st.freeze > 0,
    paused,
    over: st.over,
  };
}

// ---- arena (LAN multiplayer) ---------------------------------------------------------------------

const attemptsLeft = new Map<string, number>();

async function loadAttempts() {
  try {
    const used = await arena.attempts();
    for (const t of arena.tournaments) if (t.maxAttempts) attemptsLeft.set(t.id, Math.max(0, t.maxAttempts - (used[t.board] ?? 0)));
    if (!session && isOpen('menu')) renderCup();
  } catch {
    /* the menu falls back to the tournament's limit */
  }
}
const lastStatus = new Map<string, TournamentStatus>();

function duration(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m${s < 600 ? ` ${s % 60}s` : ''}`;
  return `${s}s`;
}

function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Everyone else climbing the same board right now, for the name tags on the tower wall. */
function rivalsOn(board: string): Rival[] {
  return arena.presence.climbers
    .filter((c) => c.board === board && c.playerId !== arena.playerId)
    .map((c) => ({ name: c.name, floor: c.floor, color: COLORS[c.look.color] ?? COLORS[0] }));
}

function renderArena() {
  const on = arena.connected;
  $('#arena-bar').classList.toggle('hidden', !on);
  if (on) {
    const p = arena.presence;
    $('#arena-name').textContent = arena.hello!.arena;
    const climbing = p.climbers.length ? ` · ${p.climbers.length} climbing` : '';
    $('#arena-meta').textContent = `${p.online} online${climbing}${arena.isHost ? ' · host' : ''}`;
  }
  renderCup();
}

function renderCup() {
  const t = arena.connected ? arena.featured() : null;
  const item = $('#cup-item');
  const changed = item.classList.contains('hidden') === !!t;
  item.classList.toggle('hidden', !t);
  if (changed) selectMenu(menuIndex, false);
  if (!t) return;
  const now = arena.now();
  const live = now >= t.startsAt;
  $('#cup-name').textContent = t.name;
  const chip = $('#cup-chip');
  chip.textContent = live ? 'LIVE' : 'SOON';
  chip.className = `chip ${live ? 'live' : 'soon'}`;
  const left = attemptsLeft.get(t.id);
  const tries = t.maxAttempts ? ` · ${left ?? t.maxAttempts} ${(left ?? t.maxAttempts) === 1 ? 'try' : 'tries'} left` : '';
  const leader = t.leader ? `👑 ${t.leader.name} ${t.leader.score.toLocaleString()}` : 'No scores yet';
  $('#cup-meta').textContent = live
    ? `${duration(t.endsAt - now)} left · ${leader}${tries}`
    : `Starts in ${duration(t.startsAt - now)} · same tower for everyone`;
}

function renderHost() {
  const invite = arena.hello?.urls[0] ?? location.origin;
  $('#host-url').textContent = invite;
  $<HTMLAnchorElement>('#host-tv').href = new URL('tv', location.href).href;
  const now = arena.now();
  $('#host-list').innerHTML = arena.tournaments.length
    ? arena.tournaments
        .map((t) => {
          const status = tournamentStatus(t, now);
          const when =
            status === 'upcoming' ? `starts in ${duration(t.startsAt - now)}` : status === 'live' ? `${duration(t.endsAt - now)} left` : `ended ${new Date(t.endsAt).toLocaleString()}`;
          const leader = t.leader ? ` · 👑 ${escapeHtml(t.leader.name)}` : '';
          return `<li><span>${status === 'live' ? '🔴' : status === 'upcoming' ? '⏳' : '🏁'} ${escapeHtml(t.name)}<small>${when} · ${t.players} players${leader}</small></span><span class="acts">${
            status !== 'finished' ? `<button data-host-end="${t.id}">End</button>` : ''
          }<button data-host-delete="${t.id}" aria-label="Delete">🗑</button></span></li>`;
        })
        .join('')
    : '';
  if (!isOpen('host')) show('host');
}

function arenaProfile() {
  return { name: profile.name || 'Player', look: profile.look };
}

let syncTimer = 0;
function syncProfile() {
  if (!arena.connected) return;
  clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => arena.updateProfile(arenaProfile()).catch(() => {}), 600);
}

function onArenaEvent(ev: ServerEvent) {
  const onMenu = !session && isOpen('menu');
  switch (ev.type) {
    case 'presence':
      if (onMenu) renderArena();
      if (isOpen('board')) markClimbing();
      break;
    case 'run': {
      if (isOpen('board') && boardShows(ev.board)) renderBoard(true);
      const e = ev.entry;
      if (e.playerId !== arena.playerId && ev.personalBest && e.rank <= 3) {
        toast(['🥇', '🥈', '🥉'][e.rank - 1], `${e.name} is #${e.rank} ${boardLabel(ev.board)}`, `${e.score.toLocaleString()} points · floor ${e.floor}`);
      }
      break;
    }
    case 'tournaments':
      for (const t of ev.tournaments) {
        if (t.status === 'live' && lastStatus.get(t.id) !== 'live') {
          toast('🏁', `${t.name} is live!`, `Same tower for everyone${t.maxAttempts ? `, ${t.maxAttempts} attempts each` : ''}. Go!`);
          sfx.milestone();
        }
        lastStatus.set(t.id, t.status);
      }
      if (session?.tournament) session.tournament = ev.tournaments.find((t) => t.id === session!.tournament!.id) ?? session.tournament;
      if (onMenu) renderArena();
      if (isOpen('host')) renderHost();
      if (isOpen('board')) renderBoard(true);
      break;
    case 'tournamentResult': {
      const [first, ...rest] = ev.podium;
      if (first) {
        const others = rest.map((e, i) => `${['🥈', '🥉'][i]} ${e.name}`).join('  ');
        toast('👑', `${first.name} wins ${ev.tournament.name}!`, `${first.score.toLocaleString()} points${others ? `  ${others}` : ''}`);
        sfx.achievement();
      } else {
        toast('🏁', `${ev.tournament.name} is over`, 'Nobody finished a run this time.');
      }
      break;
    }
  }
}

async function connectArena() {
  if (!(await arena.connect(arenaProfile()))) return;
  for (const t of arena.tournaments) lastStatus.set(t.id, t.status);
  arena.on(onArenaEvent);
  loadAttempts();
  if (!session && isOpen('menu')) renderMenu();
  toast('🟢', `Joined ${arena.hello!.arena}`, profile.name ? 'Your scores now count for the whole team.' : 'Pick a name below so the team knows who you are.');
}

$('#host-form').addEventListener('keydown', (e) => e.stopPropagation());
$('#host-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget as HTMLFormElement;
  const f = new FormData(form);
  try {
    const t = await arena.createTournament({
      name: String(f.get('name') ?? '').trim() || 'Tournament',
      minutes: Number(f.get('minutes')),
      startsInMinutes: Number(f.get('startsIn')),
      maxAttempts: f.get('attempts') ? Number(f.get('attempts')) : null,
    });
    form.reset();
    if (t.status === 'upcoming') toast('⏳', `${t.name} is scheduled`, `It starts in ${duration(t.startsAt - arena.now())}.`);
  } catch (err) {
    toast('⛔', "Couldn't create the tournament", (err as Error).message);
  }
});
$('#host-list').addEventListener('click', async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-host-end], [data-host-delete]');
  if (!btn) return;
  const t = arena.tournaments.find((x) => x.id === (btn.dataset.hostEnd ?? btn.dataset.hostDelete));
  if (!t) return;
  try {
    if (btn.dataset.hostEnd) await arena.endTournament(t.id);
    else if (confirm(`Delete "${t.name}" and all of its scores?`)) await arena.deleteTournament(t.id);
  } catch (err) {
    toast('⛔', 'That didn’t work', (err as Error).message);
  }
});

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
    case 'tournament': {
      const t = arena.featured();
      if (t && arena.now() < t.startsAt) {
        toast('⏳', `${t.name} starts in ${duration(t.startsAt - arena.now())}`, 'Warm up in Endless meanwhile!');
        break;
      }
      attract = null;
      sfx.menuSelect();
      startMode('tournament');
      break;
    }
    case 'arena':
      if (arena.isHost) renderHost();
      else renderBoard();
      break;
    case 'wardrobe':
      renderWardrobe();
      show('wardrobe');
      break;
    case 'board':
      boardTab = arena.featured()?.status === 'live' ? 'cup' : boardTab;
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
  syncProfile();
});
$('#name').addEventListener('keydown', (e) => e.stopPropagation());
$('#mute').addEventListener('click', () => {
  profile.muted = !profile.muted;
  sfx.muted = profile.muted;
  saveProfile(profile);
  renderMenu();
});
function paintMusicBtn() {
  $('#music').innerHTML = `<span class="ico">🎵</span><span>${profile.music ? 'Music' : 'No music'}</span>`;
  $('#music').classList.toggle('off', !profile.music);
}
function toggleMusic() {
  profile.music = !profile.music;
  music.enabled = profile.music;
  saveProfile(profile);
  paintMusicBtn();
}
$('#music').addEventListener('click', toggleMusic);
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !e.repeat && !(document.activeElement instanceof HTMLInputElement)) {
    sfx.unlock();
    toggleMusic();
  }
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
  else if (isOpen('wardrobe') && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) cycleCharacter(e.code === 'ArrowLeft' ? -1 : 1);
  else if (e.code === 'Escape' && ['help', 'board', 'achievements', 'wardrobe', 'host'].some(isOpen)) renderMenu();
});
document.querySelectorAll<HTMLElement>('#menu .item, #menu .dock-btn').forEach((el) =>
  el.addEventListener('pointerenter', () => selectMenu(menuEntries().indexOf(el))),
);
setInterval(() => {
  if (!session && isOpen('menu') && document.activeElement?.id !== 'name') renderMenu();
}, 30000);
// Tournament countdowns.
setInterval(() => {
  if (!arena.connected) return;
  if (!session && isOpen('menu')) renderCup();
  if (isOpen('board') && boardTab === 'cup') updateBoardHead();
}, 1000);

// Expose the engine for external agents / console tinkering.
(window as unknown as Record<string, unknown>).icyTower = {
  get state() {
    return session?.state;
  },
  observe: () => (session ? observe(session.state) : null),
  input: () => controls.read(),
  lastReplay: () => lastReplay,
  arena,
};

attract = makeAttract();
renderMenu();
requestAnimationFrame(frame);
connectArena();
