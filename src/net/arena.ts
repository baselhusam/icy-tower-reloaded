// Client for an arena server. When the game is served by `npx icy-tower-reloaded`, this finds
// the API next to the page, registers the player and keeps a live event stream open. Anywhere
// else (GitHub Pages, `npm run dev`) connect() quietly fails and the game stays offline.
import type { Replay } from '../engine/replay';
import type { Look } from '../render/characters';
import {
  APP_ID,
  type BoardEntry,
  type CharacterStat,
  type FinishedRun,
  type Hello,
  type NewTournament,
  type PlayerAuth,
  type Presence,
  type RunMode,
  type ServerEvent,
  type StartedRun,
  type Tournament,
} from './protocol';

const AUTH_KEY = 'icy-tower-reloaded:arena';
const ADMIN_KEY = 'icy-tower-reloaded:admin-key';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function save(key: string, value: unknown) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: we'll just register again next time */
  }
}

type Listener = (ev: ServerEvent) => void;

export class ArenaClient {
  hello: Hello | null = null;
  presence: Presence = { online: 0, climbers: [] };
  tournaments: Tournament[] = [];
  private auth: PlayerAuth | null = null;
  private adminKey: string | null = load<string>(ADMIN_KEY);
  private clockSkew = 0;
  private stream: EventSource | null = null;
  private listeners = new Set<Listener>();
  private lastProfile: { name: string; look: Look } | null = null;
  private base = new URL('api/', location.href);

  get connected() {
    return this.hello !== null;
  }

  get playerId() {
    return this.auth?.id ?? null;
  }

  get isHost() {
    return !!this.hello?.admin;
  }

  /** Server time, so every machine agrees when a tournament starts and ends. */
  now() {
    return Date.now() + this.clockSkew;
  }

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Joins the arena. Without a profile it only watches (the big-screen board does that). */
  async connect(profile?: { name: string; look: Look }): Promise<boolean> {
    // A host link (…/?admin=KEY) unlocks tournament controls on this device.
    const params = new URLSearchParams(location.search);
    const key = params.get('admin');
    if (key) {
      this.adminKey = key;
      save(ADMIN_KEY, key);
      params.delete('admin');
      const q = params.toString();
      history.replaceState(null, '', location.pathname + (q ? `?${q}` : '') + location.hash);
    }

    try {
      const t0 = Date.now();
      const hello = await this.request<Hello>('GET', 'hello', undefined, 2500);
      if (hello?.app !== APP_ID) return false;
      this.clockSkew = hello.serverTime - (t0 + Date.now()) / 2;
      this.hello = hello;
      this.tournaments = hello.tournaments;
      this.presence = hello.presence;
    } catch {
      return false;
    }
    if (profile) {
      this.auth = load<PlayerAuth>(AUTH_KEY);
      try {
        await this.updateProfile(profile);
      } catch {
        /* the stream below still works; we'll retry on the next profile change */
      }
    }
    this.openStream();
    return true;
  }

  async updateProfile(profile: { name: string; look: Look }) {
    this.lastProfile = profile;
    if (!this.hello) return;
    this.auth = await this.request<PlayerAuth>('POST', 'players', profile);
    save(AUTH_KEY, this.auth);
  }

  async startRun(mode: RunMode, tournamentId?: string): Promise<StartedRun> {
    return this.request<StartedRun>('POST', 'runs', { mode, tournamentId });
  }

  progress(runId: string, floor: number, score: number) {
    this.request('POST', `runs/${runId}/progress`, { floor, score }).catch(() => {});
  }

  finishRun(runId: string, replay: Replay): Promise<FinishedRun> {
    return this.request<FinishedRun>('POST', `runs/${runId}/finish`, { replay });
  }

  board(key: string, limit = 50): Promise<BoardEntry[]> {
    return this.request<BoardEntry[]>('GET', `boards/${encodeURIComponent(key)}?limit=${limit}`);
  }

  characters(): Promise<CharacterStat[]> {
    return this.request<CharacterStat[]>('GET', 'characters');
  }

  /** How many runs this player has started in each tournament, keyed by board. */
  attempts(): Promise<Record<string, number>> {
    return this.request<Record<string, number>>('GET', 'me/attempts');
  }

  replay(runId: string): Promise<Replay> {
    return this.request<Replay>('GET', `runs/${runId}/replay`);
  }

  createTournament(t: NewTournament): Promise<Tournament> {
    return this.request<Tournament>('POST', 'tournaments', t);
  }

  endTournament(id: string) {
    return this.request('POST', `tournaments/${id}/end`);
  }

  deleteTournament(id: string) {
    return this.request('DELETE', `tournaments/${id}`);
  }

  /** The tournament to feature: a live one, else the next upcoming one. */
  featured(): Tournament | null {
    const now = this.now();
    const live = this.tournaments.filter((t) => t.startsAt <= now && now < t.endsAt);
    if (live.length) return live.sort((a, b) => a.endsAt - b.endsAt)[0];
    const soon = this.tournaments.filter((t) => t.startsAt > now).sort((a, b) => a.startsAt - b.startsAt);
    return soon[0] ?? null;
  }

  private openStream() {
    const url = new URL('live', this.base);
    if (this.auth) url.searchParams.set('player', this.auth.id);
    this.stream?.close();
    this.stream = new EventSource(url);
    this.stream.onmessage = (m) => {
      let ev: ServerEvent;
      try {
        ev = JSON.parse(m.data);
      } catch {
        return;
      }
      if (ev.type === 'presence') this.presence = ev.presence;
      if (ev.type === 'tournaments') this.tournaments = ev.tournaments;
      for (const fn of this.listeners) fn(ev);
    };
  }

  private async request<T>(method: string, path: string, body?: unknown, timeoutMs = 15000, retried = false): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.auth) headers.authorization = `Bearer ${this.auth.id}:${this.auth.token}`;
    if (this.adminKey) headers['x-admin-key'] = this.adminKey;
    const res = await fetch(new URL(path, this.base), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    // The arena forgot us (new database): register again and retry once.
    if (res.status === 401 && !retried && path !== 'players' && this.lastProfile) {
      this.auth = null;
      await this.updateProfile(this.lastProfile);
      return this.request<T>(method, path, body, timeoutMs, true);
    }
    if (!res.ok) {
      const msg = await res
        .json()
        .then((j: { error?: string }) => j.error)
        .catch(() => null);
      throw new ApiError(res.status, msg ?? `Arena error ${res.status}`);
    }
    if (res.status === 204) return null as T;
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('application/json')) throw new ApiError(res.status, 'Not an arena');
    return (await res.json()) as T;
  }
}
