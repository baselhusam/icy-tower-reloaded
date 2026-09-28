// The big-screen board (/tv): put it on the office TV during a tournament. It watches the arena's
// live stream and never registers as a player.
import './tv.css';
import { ArenaClient } from '../net/arena';
import { tournamentStatus, type BoardEntry, type CharacterStat, type Climber, type ServerEvent, type Tournament } from '../net/protocol';
import { avatarURL, CHARACTERS, COLORS, DEFAULT_LOOK } from '../render/characters';

const $ = (sel: string) => document.querySelector<HTMLElement>(sel)!;
const arena = new ArenaClient();
const MEDALS = ['🥇', '🥈', '🥉'];
const fresh = new Map<string, number>(); // playerId -> until when their row glows

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (n: number) => n.toLocaleString();

function duration(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** The tournament to show: live, else upcoming, else one that ended in the last hour. */
function featured(): Tournament | null {
  const now = arena.now();
  return arena.featured() ?? arena.tournaments.find((t) => t.endsAt <= now && now - t.endsAt < 3_600_000) ?? null;
}

function featureBoard(): string {
  return featured()?.board ?? 'daily';
}

function row(e: BoardEntry, big: boolean) {
  const glow = (fresh.get(e.playerId) ?? 0) > Date.now() ? ' fresh' : '';
  const rank = MEDALS[e.rank - 1] ?? e.rank;
  const detail = big ? `<small>floor ${e.floor} · combo ${e.combo} · ${e.runs} run${e.runs === 1 ? '' : 's'}</small>` : '';
  return `<li class="r${e.rank}${glow}"><span class="rank">${rank}</span><img src="${avatarURL(e.look, big ? 96 : 56)}" alt="" /><span class="who">${esc(e.name)}${detail}</span><b>${fmt(e.score)}</b></li>`;
}

async function renderFeature() {
  const t = featured();
  const rows = await arena.board(featureBoard(), 10);
  $('#feature-kicker').textContent = t ? (t.status === 'finished' ? 'Final standings' : t.status === 'live' ? '🔴 Live tournament' : 'Up next') : "Today's tower";
  $('#feature-title').textContent = t?.name ?? 'Daily Tower';
  $('#standings').innerHTML = rows.length
    ? rows.map((e) => row(e, true)).join('')
    : `<li class="empty">${t?.status === 'upcoming' ? 'Warming up… the tower opens soon.' : 'No scores yet. Be the first on the board!'}</li>`;
  renderClock();
}

function renderClock() {
  const t = featured();
  const el = $('#countdown');
  if (!t) {
    const now = new Date(arena.now());
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    el.innerHTML = `<span>new tower in</span><b>${duration(next - now.getTime())}</b>`;
    el.className = 'countdown';
    return;
  }
  const now = arena.now();
  const status = tournamentStatus(t, now);
  el.className = `countdown ${status}`;
  el.innerHTML =
    status === 'upcoming'
      ? `<span>starts in</span><b>${duration(t.startsAt - now)}</b>`
      : status === 'live'
        ? `<span>time left</span><b>${duration(t.endsAt - now)}</b>`
        : `<span>finished</span><b>🏁</b>`;
}

async function renderSide() {
  const [all, chars] = await Promise.all([arena.board('endless', 5), arena.characters()]);
  $('#alltime').innerHTML = all.length ? all.map((e) => row(e, false)).join('') : '<li class="empty">No runs yet</li>';
  $('#chars').innerHTML = characterRows(chars);
}

function characterRows(stats: CharacterStat[]) {
  return stats
    .map((c, i) => {
      const ch = CHARACTERS.find((x) => x.id === c.char)!;
      const who = c.champion ? `<small>record: ${esc(c.champion.name)} · ${c.runs} runs</small>` : `<small>${c.runs} runs</small>`;
      return `<li><span class="rank">${c.runs ? (MEDALS[i] ?? i + 1) : '·'}</span><img src="${avatarURL({ ...DEFAULT_LOOK, char: c.char }, 56)}" alt="" /><span class="who">${ch.name}${who}</span><b>${fmt(c.bestScore)}</b></li>`;
    })
    .join('');
}

function renderClimbers() {
  const list: Climber[] = arena.presence.climbers;
  $('#online').textContent = String(arena.presence.online);
  if (!list.length) {
    $('#climbers').innerHTML = '<li class="empty">Nobody on the tower right now.</li>';
    return;
  }
  const top = Math.max(50, ...list.map((c) => c.floor));
  $('#climbers').innerHTML = list
    .slice(0, 8)
    .map((c) => {
      const color = COLORS[c.look.color] ?? COLORS[0];
      const where = c.board === 'endless' ? 'endless' : c.board.startsWith('daily:') ? 'daily' : (arena.tournaments.find((t) => t.board === c.board)?.name ?? 'cup');
      return `<li><img src="${avatarURL(c.look, 56)}" alt="" /><div class="climb"><div class="line"><b>${esc(c.name)}</b><span>${esc(where)} · ${fmt(c.score)}</span></div><div class="track"><i style="width:${(c.floor / top) * 100}%;background:${color}"></i></div></div><b class="floor">${c.floor}</b></li>`;
    })
    .join('');
}

function feed(html: string) {
  const el = document.createElement('span');
  el.innerHTML = html;
  const f = $('#feed');
  f.prepend(el);
  while (f.children.length > 6) f.lastElementChild!.remove();
}

let refreshTimer = 0;
function refreshSoon() {
  clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    renderFeature().catch(() => {});
    renderSide().catch(() => {});
  }, 250);
}

function onEvent(ev: ServerEvent) {
  switch (ev.type) {
    case 'presence':
      renderClimbers();
      break;
    case 'run': {
      const e = ev.entry;
      fresh.set(e.playerId, Date.now() + 6000);
      const cup = arena.tournaments.find((t) => t.board === ev.board);
      const where = ev.board === 'endless' ? 'all-time' : ev.board.startsWith('daily:') ? "on today's tower" : `in ${esc(cup?.name ?? 'the tournament')}`;
      if (ev.personalBest) feed(`${MEDALS[e.rank - 1] ?? '⭐'} <b>${esc(e.name)}</b> set a new best: ${fmt(e.score)} (#${e.rank} ${where})`);
      refreshSoon();
      break;
    }
    case 'tournaments':
    case 'roster': // a removed or restored climber changes the boards
      refreshSoon();
      break;
    case 'tournamentResult': {
      const w = ev.podium[0];
      feed(w ? `👑 <b>${esc(w.name)}</b> wins ${esc(ev.tournament.name)} with ${fmt(w.score)}!` : `🏁 ${esc(ev.tournament.name)} is over`);
      refreshSoon();
      break;
    }
  }
}

async function boot() {
  if (!(await arena.connect())) {
    $('#offline').classList.remove('hidden');
    $('#arena').textContent = 'Offline';
    return;
  }
  const hello = arena.hello!;
  $('#arena').textContent = hello.arena;
  $('#join-url').textContent = (hello.urls[0] ?? location.origin).replace(/^https?:\/\//, '');
  arena.on(onEvent);
  renderClimbers();
  await Promise.all([renderFeature(), renderSide()]).catch(() => {});
  setInterval(renderClock, 1000);
  // A slow safety net in case the stream dropped something while reconnecting.
  setInterval(refreshSoon, 60_000);
}

boot();
