import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { observe } from '../src/agents/api';
import { PlannerAgent } from '../src/agents/planner';
import { InputRecorder, type Replay } from '../src/engine/replay';
import { createGame, step } from '../src/engine/sim';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BoardEntry, FinishedRun, Hello, Me, PlayerAuth, Roster, ServerEvent, StartedRun, Tournament } from '../src/net/protocol';
import { Store } from '../server/db';
import { startArena, type RunningArena } from '../server/serve';

let arena: RunningArena;
let base = '';

async function api<T>(path: string, init: { method?: string; body?: unknown; auth?: PlayerAuth; admin?: string } = {}) {
  const res = await fetch(base + path, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: {
      'content-type': 'application/json',
      ...(init.auth ? { authorization: `Bearer ${init.auth.id}:${init.auth.token}` } : {}),
      ...(init.admin ? { 'x-admin-key': init.admin } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
}

/** Plays a whole game with the AI and returns its replay. */
function playGame(seed: number, maxTicks = 60 * 60 * 3): Replay {
  const s = createGame(seed);
  const rec = new InputRecorder();
  const agent = new PlannerAgent({ replanEvery: 6 });
  while (!s.over && s.tick < maxTicks) {
    const input = s.floor >= 30 ? 0 : agent.act(observe(s), s); // climb a bit, then give up
    rec.push(input);
    step(s, input);
  }
  return { version: 1, seed, inputs: rec.encode(), ticks: rec.ticks, score: s.score, floor: s.floor };
}

/** Polls until `check` passes, so tests don't depend on how fast throttled events arrive. */
async function until(check: () => boolean, ms = 3000) {
  for (const end = Date.now() + ms; !check() && Date.now() < end; ) await new Promise((r) => setTimeout(r, 20));
  return check();
}

/** Pretend the run started an hour ago, so an instantly-simulated game passes the real-time check. */
function backdate(runId: string) {
  arena.store.db.prepare('UPDATE runs SET started_at = started_at - 3600000 WHERE id = ?').run(runId);
}

beforeAll(async () => {
  arena = await startArena({ port: 0, host: '127.0.0.1', db: ':memory:', arena: 'Test Arena', adminKey: 'secret' });
  base = `http://127.0.0.1:${arena.port}`;
});

afterAll(() => arena.close());

describe('arena server', () => {
  it('says hello', async () => {
    const { data } = await api<Hello>('/api/hello');
    expect(data.app).toBe('icy-tower-reloaded');
    expect(data.arena).toBe('Test Arena');
    expect(data.admin).toBe(true); // loopback is the host
  });

  it('registers players and verifies a submitted run', async () => {
    const { data: me } = await api<PlayerAuth>('/api/players', { body: { name: '  Sara\u0007 ', look: { char: 'yuki', hat: 'crown', color: 2, extra: 'cape' } } });
    expect(me.id).toBeTruthy();

    const { data: run } = await api<StartedRun>('/api/runs', { body: { mode: 'endless' }, auth: me });
    expect(run.board).toBe('endless');

    // Submitting a minute of play right away is faster than real time: rejected.
    const replay = { version: 1, seed: run.seed, inputs: '0' + (60 * 60).toString(36), ticks: 60 * 60, score: 0, floor: 0 };
    const tooFast = await api<{ error: string }>('/api/runs/' + run.runId + '/finish', { body: { replay }, auth: me });
    expect(tooFast.status).toBe(422);
    expect(tooFast.data.error).toMatch(/longer than the time/);

    const { data: run2 } = await api<StartedRun>('/api/runs', { body: { mode: 'endless' }, auth: me });
    backdate(run2.runId);
    const honest = playGame(run2.seed);
    const { status, data: fin } = await api<FinishedRun>(`/api/runs/${run2.runId}/finish`, { body: { replay: { ...honest, score: 999999 } }, auth: me });
    expect(status).toBe(200);
    expect(fin.score).toBe(honest.score); // the claimed score is ignored
    expect(fin.rank).toBe(1);
    expect(fin.personalBest).toBe(true);

    const { data: board } = await api<BoardEntry[]>('/api/boards/endless');
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ name: 'Sara', score: honest.score, look: { char: 'yuki' } });

    const { data: chars } = await api<{ char: string; runs: number; champion: { name: string } | null }[]>('/api/characters');
    expect(chars.find((c) => c.char === 'yuki')).toMatchObject({ runs: 1, champion: { name: 'Sara' } });
  });

  it('rejects a replay for a different tower and unknown players', async () => {
    const { data: me } = await api<PlayerAuth>('/api/players', { body: { name: 'Omar' } });
    const { data: run } = await api<StartedRun>('/api/runs', { body: { mode: 'daily' }, auth: me });
    backdate(run.runId);
    const bad = await api<{ error: string }>(`/api/runs/${run.runId}/finish`, { body: { replay: playGame(run.seed + 1) }, auth: me });
    expect(bad.status).toBe(422);
    expect(bad.data.error).toMatch(/different tower/);
    const anon = await api('/api/runs', { body: { mode: 'endless' }, auth: { id: me.id, token: 'nope' } });
    expect(anon.status).toBe(401);
  });

  it('runs a tournament with limited attempts and streams events', async () => {
    const events: ServerEvent[] = [];
    const ctrl = new AbortController();
    const stream = fetch(`${base}/api/live`, { signal: ctrl.signal }).then(async (res) => {
      const reader = res.body!.getReader();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += new TextDecoder().decode(value);
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (data) events.push(JSON.parse(data.slice(6)));
        }
      }
    }).catch(() => {});
    expect(await until(() => events.length > 0)).toBe(true); // subscribed

    const { data: t } = await api<Tournament>('/api/tournaments', { body: { name: 'Friday Cup', minutes: 10, maxAttempts: 1 } });
    expect(t.status).toBe('live');

    const { data: me } = await api<PlayerAuth>('/api/players', { body: { name: 'Lina' } });
    const { data: run } = await api<StartedRun>('/api/runs', { body: { mode: 'tournament', tournamentId: t.id }, auth: me });
    expect(run.seed).toBe(t.seed);
    expect(run.attemptsLeft).toBe(0);

    await api(`/api/runs/${run.runId}/progress`, { body: { floor: 12, score: 120 }, auth: me });
    expect(await until(() => events.some((e) => e.type === 'presence' && e.presence.climbers.some((c) => c.floor === 12)))).toBe(true);
    backdate(run.runId);
    const { data: fin } = await api<FinishedRun>(`/api/runs/${run.runId}/finish`, { body: { replay: playGame(run.seed) }, auth: me });
    expect(fin.rank).toBe(1);

    const again = await api<{ error: string }>('/api/runs', { body: { mode: 'tournament', tournamentId: t.id }, auth: me });
    expect(again.status).toBe(409);
    expect(again.data.error).toMatch(/No attempts left/);

    expect(await until(() => events.some((e) => e.type === 'run' && e.entry.name === 'Lina'))).toBe(true);
    ctrl.abort();
    await stream;
    expect(events.some((e) => e.type === 'tournaments')).toBe(true);

    const { data: list } = await api<Tournament[]>('/api/tournaments');
    expect(list[0].leader?.name).toBe('Lina');
  });

  it('only lets the host manage tournaments', async () => {
    const other = await startArena({ port: 0, host: '127.0.0.1', db: ':memory:', arena: 'Locked', adminKey: 'secret', localAdmin: false });
    const url = `http://127.0.0.1:${other.port}/api/tournaments`;
    const post = (key?: string) =>
      fetch(url, { method: 'POST', headers: key ? { 'x-admin-key': key } : {}, body: JSON.stringify({ name: 'Cup', minutes: 5 }) });
    try {
      expect((await post()).status).toBe(403);
      expect((await post('wrong')).status).toBe(403);
      expect((await post('secret')).status).toBe(200);
    } finally {
      await other.close();
    }
  });
});

describe('tournament clock', () => {
  it("accepts a run cut short by the end of the tournament, and nothing after the grace period", async () => {
    const t = arena.store.createTournament({ name: 'Sprint', startsAt: Date.now() - 1000, endsAt: Date.now() + 300, maxAttempts: null });
    const { data: me } = await api<PlayerAuth>('/api/players', { body: { name: 'Nour' } });
    const { data: run } = await api<StartedRun>('/api/runs', { body: { mode: 'tournament', tournamentId: t.id }, auth: me });
    backdate(run.runId);

    // 20 seconds of climbing that hasn't ended: only acceptable once the clock has run out.
    const s = createGame(run.seed);
    const rec = new InputRecorder();
    const agent = new PlannerAgent({ replanEvery: 6 });
    for (let i = 0; i < 20 * 60; i++) {
      const input = agent.act(observe(s), s);
      rec.push(input);
      step(s, input);
    }
    expect(s.over).toBe(false);
    const replay = { version: 1, seed: run.seed, inputs: rec.encode(), ticks: rec.ticks, score: s.score, floor: s.floor };

    await new Promise((r) => setTimeout(r, 400));
    const { status, data } = await api<FinishedRun>(`/api/runs/${run.runId}/finish`, { body: { replay }, auth: me });
    expect(status).toBe(200);
    expect(data.score).toBe(s.score);

    const late = await api<{ error: string }>('/api/runs', { body: { mode: 'tournament', tournamentId: t.id }, auth: me });
    expect(late.status).toBe(409);
    expect(late.data.error).toMatch(/is over/);
  });

  it('rejects an unfinished run while the tournament is still going', async () => {
    const { data: me } = await api<PlayerAuth>('/api/players', { body: { name: 'Rami' } });
    const { data: run } = await api<StartedRun>('/api/runs', { body: { mode: 'endless' }, auth: me });
    backdate(run.runId);
    const res = await api<{ error: string }>(`/api/runs/${run.runId}/finish`, { body: { replay: { version: 1, seed: run.seed, inputs: '2a', ticks: 10, score: 0, floor: 0 } }, auth: me });
    expect(res.status).toBe(422);
    expect(res.data.error).toMatch(/did not end/);
  });
});

describe('climbers', () => {
  const create = (name: string, pin?: string) => api<PlayerAuth>('/api/players', { body: { name, look: { char: 'pip' }, pin } });

  it('keeps names unique, ignoring case', async () => {
    const first = await create('Hadi');
    expect(first.status).toBe(200);
    const again = await create('  hADI ');
    expect(again.status).toBe(409);
    expect((again.data as unknown as { error: string }).error).toMatch(/taken/);
    expect((await create('   ')).status).toBe(400);

    const other = await create('Yara');
    const rename = await api('/api/me', { method: 'PUT', body: { name: 'hadi' }, auth: other.data });
    expect(rename.status).toBe(409);
    const ok = await api<Me>('/api/me', { method: 'PUT', body: { name: 'Yara B' }, auth: other.data });
    expect(ok.data.name).toBe('Yara B');
  });

  it('lets anyone pick a climber, and asks for the PIN when there is one', async () => {
    const open = await create('Karim');
    const { data: roster } = await api<Roster>('/api/players');
    expect(roster.players.find((p) => p.id === open.data.id)).toMatchObject({ name: 'Karim', pin: false, runs: 0 });

    // Another device picks Karim: a second session, and the first one keeps working.
    const { data: second } = await api<PlayerAuth>(`/api/players/${open.data.id}/claim`, { body: {} });
    expect(second.token).not.toBe(open.data.token);
    expect((await api<Me>('/api/me', { auth: second })).data.name).toBe('Karim');
    expect((await api<Me>('/api/me', { auth: open.data })).status).toBe(200);

    const locked = await create('Dana', '4321');
    expect((await api<Roster>('/api/players')).data.players.find((p) => p.name === 'Dana')?.pin).toBe(true);
    expect((await api(`/api/players/${locked.data.id}/claim`, { body: {} })).status).toBe(403);
    expect((await api(`/api/players/${locked.data.id}/claim`, { body: { pin: '0000' } })).status).toBe(403);
    expect((await api<PlayerAuth>(`/api/players/${locked.data.id}/claim`, { body: { pin: '4321' } })).status).toBe(200);
    expect((await create('Bad PIN', '12a4')).status).toBe(400);

    // Guessing gets you locked out for a while, even with the right PIN.
    for (let i = 0; i < 5; i++) await api(`/api/players/${locked.data.id}/claim`, { body: { pin: '1111' } });
    expect((await api(`/api/players/${locked.data.id}/claim`, { body: { pin: '4321' } })).status).toBe(429);
  });

  it('changes a PIN only with the current one, and signs out', async () => {
    const { data: me } = await create('Tala', '1234');
    expect((await api('/api/me/pin', { method: 'PUT', body: { pin: '5555' }, auth: me })).status).toBe(403);
    const { data: changed } = await api<Me>('/api/me/pin', { method: 'PUT', body: { pin: null, current: '1234' }, auth: me });
    expect(changed.pin).toBe(false);
    expect((await api<PlayerAuth>(`/api/players/${me.id}/claim`, { body: {} })).status).toBe(200);

    expect((await api('/api/me/logout', { body: {}, auth: me })).status).toBe(204);
    expect((await api('/api/me', { auth: me })).status).toBe(401);
  });

  it('removes a climber from every board, and anyone can bring them back', async () => {
    const { data: me } = await create('Zaid');
    const { data: run } = await api<StartedRun>('/api/runs', { body: { mode: 'endless' }, auth: me });
    backdate(run.runId);
    await api(`/api/runs/${run.runId}/finish`, { body: { replay: playGame(run.seed) }, auth: me });
    const onBoard = async () => (await api<BoardEntry[]>('/api/boards/endless?limit=500')).data.some((e) => e.playerId === me.id);
    expect(await onBoard()).toBe(true);

    const { data: remover } = await create('Maha');
    expect((await api(`/api/players/${me.id}`, { method: 'DELETE', auth: remover })).status).toBe(204);
    expect((await api(`/api/players/${me.id}`, { method: 'DELETE' })).status).toBe(404);
    expect(await onBoard()).toBe(false);
    expect((await api('/api/me', { auth: me })).status).toBe(401);
    expect((await api(`/api/players/${me.id}/claim`, { body: {} })).status).toBe(404);
    const { data: roster } = await api<Roster>('/api/players');
    expect(roster.players.some((p) => p.id === me.id)).toBe(false);
    expect(roster.removed.find((p) => p.id === me.id)).toMatchObject({ name: 'Zaid', removedBy: 'Maha' });

    // Someone takes the name meanwhile; the restored climber comes back as "Zaid 2", scores intact.
    expect((await create('zaid')).status).toBe(200);
    const { data: back } = await api<Me>(`/api/players/${me.id}/restore`, { body: {} });
    expect(back.name).toBe('Zaid 2');
    expect(await onBoard()).toBe(true);
    expect((await api<Me>('/api/me', { auth: me })).data.name).toBe('Zaid 2');
  });

  it('purges climbers removed long enough ago, runs and all', async () => {
    const { data: me } = await create('Old Timer');
    await api<StartedRun>('/api/runs', { body: { mode: 'endless' }, auth: me });
    await api(`/api/players/${me.id}`, { method: 'DELETE' });
    expect(arena.store.purgeRemoved(Date.now() - 60_000)).toBe(0); // too recent
    expect(arena.store.purgeRemoved(Date.now() + 1)).toBeGreaterThanOrEqual(1);
    expect(arena.store.db.prepare('SELECT COUNT(*) AS n FROM runs WHERE player_id = ?').get(me.id)).toEqual({ n: 0 });
    expect((await api<Me>(`/api/players/${me.id}/restore`, { body: {} })).status).toBe(404);
  });
});

describe('database upgrade', () => {
  it('moves v1 tokens into sessions and makes duplicate names unique', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'icy-arena-'));
    const file = join(dir, 'arena.db');
    try {
      const { DatabaseSync } = await import('node:sqlite');
      const v1 = new DatabaseSync(file);
      v1.exec(`
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO meta VALUES ('schema_version', '1');
        CREATE TABLE players (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, name TEXT NOT NULL, look TEXT NOT NULL,
                              created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL);`);
      const hash = (t: string) => createHash('sha256').update(t).digest('hex');
      const add = v1.prepare('INSERT INTO players VALUES (?, ?, ?, ?, ?, ?)');
      add.run('a', hash('tok-a'), 'Sam', '{}', 1, 1);
      add.run('b', hash('tok-b'), 'sam', '{}', 2, 2);
      add.run('c', hash('tok-c'), 'Sam 2', '{}', 3, 3);
      v1.close();

      const store = await Store.open(file);
      expect(store.getMeta('schema_version')).toBe('2');
      expect(store.authenticate('a', 'tok-a')?.name).toBe('Sam');
      expect(store.authenticate('b', 'tok-b')?.name).toBe('sam 3'); // "Sam 2" was already someone
      expect(store.authenticate('c', 'tok-c')?.name).toBe('Sam 2');
      expect(store.createPlayer('SAM', { char: 'pip', hat: 'none', color: 0, extra: 'none' }, null)).toBeNull();
      store.close();
      (await Store.open(file)).close(); // opening again is a no-op
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
