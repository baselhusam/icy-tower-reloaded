// Client for an arena server. When the game is served by `npx icy-tower-reloaded`, this finds
// the API next to the page, signs in as the climber picked on this device and keeps a live event
// stream open. Anywhere else (GitHub Pages, `npm run dev`) connect() quietly fails and the game
// stays offline.
import type { Replay } from '../engine/replay';
import {
  APP_ID,
  type BoardEntry,
  type CharacterStat,
  type FinishedRun,
  type Hello,
  type Me,
  type NewPlayer,
  type NewTournament,
  type PlayerAuth,
  type PlayerUpdate,
  type Presence,
  type Roster,
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
    /* private mode: we'll just pick a climber again next time */
  }
}

type Listener = (ev: ServerEvent) => void;

export class ArenaClient {
  hello: Hello | null = null;
  presence: Presence = { online: 0, climbers: [] };
  tournaments: Tournament[] = [];
  /** The climber this device plays as; null until one is picked. */
  me: Me | null = null;
  /** Called when the server stops accepting our session (the climber was removed, say). */
  onSignedOut: (() => void) | null = null;
  private auth: PlayerAuth | null = null;
  private adminKey: string | null = load<string>(ADMIN_KEY);
  private clockSkew = 0;
  private stream: EventSource | null = null;
  private listeners = new Set<Listener>();
  private base = new URL('api/', location.href);

  get connected() {
    return this.hello !== null;
  }

  get playerId() {
    return this.me?.id ?? null;
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

  /** Finds the arena and starts listening. Picking a climber is separate (see resume()). */
  async connect(): Promise<boolean> {
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
    this.openStream();
    return true;
  }

  /** The climber this device used last time, if the arena still knows them. */
  async resume(): Promise<Me | null> {
    this.auth = load<PlayerAuth>(AUTH_KEY);
    if (!this.auth) return null;
    try {
      this.me = await this.request<Me>('GET', 'me');
      this.openStream();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) this.forget();
    }
    return this.me;
  }

  roster(): Promise<Roster> {
    return this.request<Roster>('GET', 'players');
  }

  async createPlayer(p: NewPlayer): Promise<Me> {
    return this.signIn(await this.request<PlayerAuth>('POST', 'players', p));
  }

  /** Play as an existing climber; `pin` if they have one. */
  async claim(id: string, pin?: string): Promise<Me> {
    return this.signIn(await this.request<PlayerAuth>('POST', `players/${id}/claim`, { pin }));
  }

  /** Stop playing as this climber on this device. */
  async signOut() {
    if (this.auth) await this.request('POST', 'me/logout', {}).catch(() => {});
    this.forget();
    this.openStream();
  }

  removePlayer(id: string) {
    return this.request('DELETE', `players/${id}`);
  }

  restorePlayer(id: string): Promise<Me> {
    return this.request<Me>('POST', `players/${id}/restore`, {});
  }

  async updateProfile(update: PlayerUpdate): Promise<Me> {
    this.me = await this.request<Me>('PUT', 'me', update);
    return this.me;
  }

  async setPin(pin: string | null, current?: string): Promise<Me> {
    this.me = await this.request<Me>('PUT', 'me/pin', { pin, current });
    return this.me;
  }

  private async signIn(auth: PlayerAuth): Promise<Me> {
    if (this.auth) await this.request('POST', 'me/logout', {}).catch(() => {});
    this.auth = auth;
    save(AUTH_KEY, auth);
    this.me = await this.request<Me>('GET', 'me');
    this.openStream();
    return this.me;
  }

  private forget() {
    this.auth = null;
    this.me = null;
    save(AUTH_KEY, null);
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

  private async request<T>(method: string, path: string, body?: unknown, timeoutMs = 15000): Promise<T> {
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
    // The arena stopped knowing us (removed, or a fresh database): pick a climber again.
    if (res.status === 401 && headers.authorization && this.me) {
      this.forget();
      this.openStream();
      this.onSignedOut?.();
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
