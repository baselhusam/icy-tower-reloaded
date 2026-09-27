// Real-time fan-out over Server-Sent Events: who's online, who's climbing right now (and how
// high), verified runs as they land, and tournament changes. SSE needs no library and passes
// through proxies and corporate networks that sometimes block WebSockets.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Climber, Presence, ServerEvent } from '../src/net/protocol';

interface Client {
  res: ServerResponse;
  playerId: string | null;
}

const CLIMBER_TIMEOUT_MS = 12_000; // no heartbeat for this long = they closed the tab
const PRESENCE_THROTTLE_MS = 750;

export class LiveHub {
  private clients = new Set<Client>();
  private climbers = new Map<string, Climber & { beat: number }>();
  private presenceTimer: NodeJS.Timeout | null = null;
  private timers: NodeJS.Timeout[] = [];

  constructor() {
    this.timers.push(
      setInterval(() => this.sweep(), 3000),
      setInterval(() => {
        for (const c of this.clients) c.res.write(': ping\n\n');
      }, 20_000),
    );
  }

  subscribe(req: IncomingMessage, res: ServerResponse, playerId: string | null) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    const client: Client = { res, playerId };
    this.clients.add(client);
    this.send(client, { type: 'presence', presence: this.presence() });
    this.schedulePresence();
    req.on('close', () => {
      this.clients.delete(client);
      this.schedulePresence();
    });
  }

  broadcast(ev: ServerEvent) {
    for (const c of this.clients) this.send(c, ev);
  }

  presence(): Presence {
    const online = new Set<string>();
    for (const c of this.clients) if (c.playerId) online.add(c.playerId);
    const climbers = [...this.climbers.values()].map(({ beat: _, ...c }) => c).sort((a, b) => b.floor - a.floor);
    return { online: online.size, climbers };
  }

  climbing(c: Climber) {
    const prev = this.climbers.get(c.runId);
    this.climbers.set(c.runId, { ...c, beat: Date.now() });
    if (!prev || prev.floor !== c.floor) this.schedulePresence();
  }

  landed(runId: string) {
    if (this.climbers.delete(runId)) this.schedulePresence();
  }

  close() {
    for (const t of this.timers) clearInterval(t);
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
    for (const c of this.clients) c.res.end();
    this.clients.clear();
  }

  private send(c: Client, ev: ServerEvent) {
    c.res.write(`data: ${JSON.stringify(ev)}\n\n`);
  }

  private schedulePresence() {
    this.presenceTimer ??= setTimeout(() => {
      this.presenceTimer = null;
      this.broadcast({ type: 'presence', presence: this.presence() });
    }, PRESENCE_THROTTLE_MS);
  }

  private sweep() {
    const cutoff = Date.now() - CLIMBER_TIMEOUT_MS;
    let changed = false;
    for (const [id, c] of this.climbers) {
      if (c.beat < cutoff) {
        this.climbers.delete(id);
        changed = true;
      }
    }
    if (changed) this.schedulePresence();
  }
}
