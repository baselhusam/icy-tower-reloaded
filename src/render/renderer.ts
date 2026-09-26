import * as C from '../engine/constants';
import { comboRating, type GameEvent, type GameState, type Platform, type PickupKind } from '../engine/sim';
import { blend, themeAt, type Theme } from './theme';

interface Particle {
  x: number; // world
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  gravity: number;
  shape: 'dot' | 'star' | 'square';
}

interface FloatText {
  text: string;
  x: number; // screen
  y: number;
  life: number;
  max: number;
  size: number;
  color: string;
  rise: number;
}

interface Banner {
  text: string;
  sub: string;
  life: number;
  max: number;
  color: string;
}

export interface Frame {
  state: GameState;
  alpha: number; // interpolation between previous and current tick
  prevX: number;
  prevY: number;
  prevCam: number;
  ghost: GameState | null;
  bestFloor: number;
  label: string | null; // e.g. "AI PLAYING" / "REPLAY"
  hud: boolean;
}

// How much extra tower a tall screen may reveal above the playfield. Must stay below the engine's
// generation lookahead (4 floors) so platforms never pop in on screen.
const MAX_EXTRA_VIEW = 3.75 * C.FLOOR_GAP;
// On even taller screens we zoom slightly and crop up to this much of each (purely decorative) wall.
const MAX_WALL_CROP = 24;

const PICKUP_STYLE: Record<PickupKind, { color: string; glyph: string }> = {
  gem: { color: '#7fe3ff', glyph: '' },
  rocket: { color: '#ff7a59', glyph: '🚀' },
  freeze: { color: '#9fd8ff', glyph: '❄️' },
  magnet: { color: '#ff5fa2', glyph: '🧲' },
};

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private texts: FloatText[] = [];
  private banners: Banner[] = [];
  private shake = 0;
  private time = 0;
  private spin = 0;
  private spinning = false;
  private squash = 0;
  private flash = 0;
  private snow: { x: number; y: number; s: number; d: number }[] = [];
  private lastZone = 0;
  private comboPulse = 0;
  private viewH = C.VIEW_H; // rendered height in world units; >= the simulation's VIEW_H
  private hudTop = 0;
  private hudBottom = 0;
  private cropL = 0; // world units of wall cropped off each side on very tall screens

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    for (let i = 0; i < 70; i++) {
      this.snow.push({ x: Math.random() * C.VIEW_W, y: Math.random() * (C.VIEW_H + MAX_EXTRA_VIEW), s: 0.5 + Math.random() * 2, d: Math.random() * 6.28 });
    }
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let scale = Math.min(vw / C.VIEW_W, vh / C.VIEW_H);
    this.viewH = C.VIEW_H;
    if (vh / scale > C.VIEW_H) {
      // Screens taller than 2:3 (phones) show extra tower above the playfield instead of letterboxing.
      // If that still isn't enough, zoom in a little and crop the decorative side walls.
      // The simulation's view never changes, so gameplay and replays are identical on every device.
      const maxH = C.VIEW_H + MAX_EXTRA_VIEW;
      scale = Math.min(Math.max(vw / C.VIEW_W, vh / maxH), vw / (C.VIEW_W - 2 * MAX_WALL_CROP));
      this.viewH = Math.min(maxH, vh / scale);
    }
    const w = Math.min(vw, Math.round(C.VIEW_W * scale));
    const h = Math.round(this.viewH * scale);
    const cropPx = (C.VIEW_W * scale - w) / 2;
    this.cropL = cropPx / scale;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    const k = (h * dpr) / this.viewH;
    this.ctx.setTransform(k, 0, 0, k, -cropPx * dpr, 0);
    const root = document.documentElement;
    root.style.setProperty('--game-w', `${w}px`);
    root.style.setProperty('--game-h', `${h}px`);
    root.classList.toggle('fullbleed', h >= vh - 2 && w >= vw - 2);
    // Keep the HUD clear of notches / home indicators where the canvas touches the screen edge.
    const css = getComputedStyle(root);
    const gap = (vh - h) / 2;
    this.hudTop = Math.max(0, parseFloat(css.getPropertyValue('--sat')) - gap || 0) / scale;
    this.hudBottom = Math.max(0, parseFloat(css.getPropertyValue('--sab')) - gap || 0) / scale;
  }

  reset() {
    this.particles = [];
    this.texts = [];
    this.banners = [];
    this.shake = 0;
    this.spin = 0;
    this.spinning = false;
    this.flash = 0;
    this.lastZone = 0;
  }

  // ---- event-driven juice ------------------------------------------------------------

  handle(events: GameEvent[], s: GameState) {
    const p = s.player;
    for (const e of events) {
      switch (e.type) {
        case 'jump':
          this.burst(p.x, p.y, 8, '#ffffff', 2.5, 'dot');
          this.spinning = s.combo.active && e.power > 14;
          if (e.rocket) this.burst(p.x, p.y, 30, '#ff9d5c', 5, 'star');
          this.squash = -0.25;
          break;
        case 'land':
          this.spinning = false;
          this.spin = 0;
          this.squash = Math.min(0.35, e.impact / 40);
          if (e.impact > 6) this.burst(p.x, p.y, Math.min(20, Math.floor(e.impact)), '#e8f6ff', 3, 'dot');
          if (e.impact > 16) this.shake = Math.max(this.shake, 4);
          break;
        case 'wall':
          this.burst(e.side < 0 ? C.PLAY_L : C.PLAY_R, p.y + 20, 10, '#ffe27a', 4, 'square');
          if (s.combo.active) this.spinning = true;
          break;
        case 'combo':
          this.comboPulse = 1;
          this.floatText(`+${e.floors}`, p.x, this.sy(s.cameraY, p.y) - 50, 20, '#ffe27a');
          break;
        case 'comboEnd': {
          const rating = comboRating(e.floors);
          this.banner(rating, `${e.floors} floor combo  +${e.points.toLocaleString()}`, '#ffe27a', 110);
          this.burst(p.x, p.y + 20, Math.min(80, 20 + e.floors), '#ffe27a', 7, 'star');
          this.shake = Math.max(this.shake, Math.min(14, 4 + e.floors / 8));
          this.flash = Math.min(0.5, e.floors / 150);
          break;
        }
        case 'comboBreak':
          if (e.floors > 0) this.floatText('combo lost', p.x, this.sy(s.cameraY, p.y) - 40, 16, '#ff8a8a');
          break;
        case 'pickup':
          this.burst(e.x, e.y, e.kind === 'gem' ? 10 : 26, PICKUP_STYLE[e.kind].color, 4, 'star');
          this.floatText(
            e.kind === 'gem' ? `+${C.GEM_POINTS}` : e.kind === 'rocket' ? 'ROCKET JUMP!' : e.kind === 'freeze' ? 'TIME FREEZE!' : 'GEM MAGNET!',
            e.x,
            this.sy(s.cameraY, e.y) - 20,
            e.kind === 'gem' ? 16 : 22,
            PICKUP_STYLE[e.kind].color,
          );
          break;
        case 'spring':
          this.burst(e.x, e.y, 16, '#8dffcf', 5, 'star');
          this.spinning = true;
          break;
        case 'crumble':
          this.floatText('!', p.x, this.sy(s.cameraY, p.y) - 60, 22, '#ffb36b');
          break;
        case 'milestone': {
          const zone = themeAt(e.floor).theme;
          this.banner(`FLOOR ${e.floor}`, `Entering ${zone.name}`, '#8dffcf', 150);
          for (let i = 0; i < 5; i++) this.burst(C.PLAY_L + Math.random() * (C.PLAY_R - C.PLAY_L), p.y + 200 + Math.random() * 200, 24, ['#ff5fa2', '#ffe27a', '#7fe3ff', '#8dffcf'][i % 4], 6, 'square');
          break;
        }
        case 'speedUp':
          this.banner('HURRY UP!', `Speed level ${e.level}`, '#ff7a59', 110);
          this.shake = Math.max(this.shake, 6);
          break;
        case 'gameOver':
          this.shake = 12;
          break;
      }
    }
  }

  private sy(cam: number, y: number) {
    return this.viewH - (y - cam);
  }

  private burst(x: number, y: number, n: number, color: string, speed: number, shape: Particle['shape']) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.3 + Math.random());
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v + speed * 0.4,
        life: 0,
        max: 30 + Math.random() * 30,
        color,
        size: 2 + Math.random() * 3,
        gravity: shape === 'dot' ? 0.12 : 0.18,
        shape,
      });
    }
    if (this.particles.length > 600) this.particles.splice(0, this.particles.length - 600);
  }

  private floatText(text: string, x: number, y: number, size: number, color: string) {
    this.texts.push({ text, x: Math.max(70, Math.min(C.VIEW_W - 70, x)), y, life: 0, max: 60, size, color, rise: 0.8 });
    if (this.texts.length > 8) this.texts.shift();
  }

  private banner(text: string, sub: string, color: string, max: number) {
    this.banners = [{ text, sub, life: 0, max, color }];
  }

  // ---- drawing ---------------------------------------------------------------------------

  draw(f: Frame) {
    const { ctx } = this;
    const s = f.state;
    this.time++;
    const cam = f.prevCam + (s.cameraY - f.prevCam) * f.alpha;
    const px = f.prevX + (s.player.x - f.prevX) * f.alpha;
    const py = f.prevY + (s.player.y - f.prevY) * f.alpha;
    const viewFloor = (cam + this.viewH / 2) / C.FLOOR_GAP;
    const theme = blend(viewFloor);
    const zone = themeAt(viewFloor).index;
    if (zone !== this.lastZone) this.lastZone = zone;

    ctx.save();
    if (this.shake > 0.2) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.shake *= 0.88;
    }

    this.drawBackground(theme, cam);
    this.drawBestMarker(f.bestFloor, cam, theme);
    for (const plat of s.platforms) this.drawPlatform(plat, cam, theme);
    this.drawPickups(s, cam);
    if (f.ghost && !f.ghost.over) this.drawPlayer(f.ghost.player.x, f.ghost.player.y, f.ghost, cam, 0.35, true);
    this.drawPlayer(px, py, s, cam, 1, false);
    this.drawParticles(cam);
    this.drawWalls(theme, cam);
    ctx.restore();

    if (s.freeze > 0) this.drawFreezeVignette(s.freeze);
    if (this.flash > 0.01) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash})`;
      ctx.fillRect(0, 0, C.VIEW_W, this.viewH);
      this.flash *= 0.85;
    }
    if (f.hud) this.drawHud(s, f, theme);
    this.drawTexts();
    this.drawBanners();
  }

  private drawBackground(t: Theme, cam: number) {
    const { ctx } = this;
    const g = ctx.createLinearGradient(0, 0, 0, this.viewH);
    g.addColorStop(0, t.skyTop);
    g.addColorStop(1, t.skyBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, C.VIEW_W, this.viewH);

    // Parallax tower bricks.
    const par = cam * 0.45;
    const bh = 36;
    const bw = 72;
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = t.brick;
    ctx.strokeStyle = t.brickLine;
    ctx.lineWidth = 2;
    const off = ((par % bh) + bh) % bh;
    const rowBase = Math.floor(par / bh);
    for (let r = -1; r < this.viewH / bh + 2; r++) {
      const y = this.viewH - r * bh - bh + off;
      const shift = (rowBase + r) % 2 === 0 ? 0 : bw / 2;
      for (let x = -bw + shift; x < C.VIEW_W + bw; x += bw) {
        ctx.fillRect(x + 2, y + 2, bw - 4, bh - 4);
        ctx.strokeRect(x + 2, y + 2, bw - 4, bh - 4);
      }
    }
    ctx.globalAlpha = 1;

    // Soft snowfall (screen space, purely cosmetic).
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (const f of this.snow) {
      f.y += f.s * 0.6;
      f.x += Math.sin((this.time + f.d * 50) / 60) * 0.3;
      if (f.y > this.viewH) {
        f.y = -4;
        f.x = Math.random() * C.VIEW_W;
      }
      ctx.globalAlpha = 0.25 + f.s * 0.2;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawWalls(t: Theme, cam: number) {
    const { ctx } = this;
    const bh = 48;
    const off = ((cam % bh) + bh) % bh;
    for (const x0 of [0, C.PLAY_R]) {
      ctx.fillStyle = t.wall;
      ctx.fillRect(x0, 0, C.WALL, this.viewH);
      ctx.strokeStyle = t.wallLine;
      ctx.lineWidth = 3;
      for (let y = this.viewH + off; y > -bh; y -= bh) {
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x0 + C.WALL, y);
        ctx.stroke();
      }
      const inner = x0 === 0 ? C.WALL : C.PLAY_R;
      const g = ctx.createLinearGradient(inner - (x0 === 0 ? 10 : -10), 0, inner, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(255,255,255,0.18)');
      ctx.fillStyle = g;
      ctx.fillRect(x0 === 0 ? C.WALL - 10 : C.PLAY_R, 0, 10, this.viewH);
    }
  }

  private drawBestMarker(best: number, cam: number, t: Theme) {
    if (best <= 0) return;
    const y = this.sy(cam, best * C.FLOOR_GAP + C.FLOOR_GAP / 2);
    if (y < -20 || y > this.viewH + 20) return;
    const { ctx } = this;
    ctx.save();
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = t.accent;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(C.PLAY_L, y);
    ctx.lineTo(C.PLAY_R, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = t.accent;
    ctx.font = 'bold 12px "Fredoka", system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`YOUR BEST · ${best}`, C.PLAY_R - 6, y - 6);
    ctx.restore();
  }

  private drawPlatform(p: Platform, cam: number, t: Theme) {
    if (p.broken) return;
    const { ctx } = this;
    const top = this.sy(cam, p.floor * C.FLOOR_GAP);
    if (top < -30 || top > this.viewH + 30) return;
    let x = p.x;
    if (p.crumble > 0) x += (Math.random() - 0.5) * 3;
    const w = p.w;
    const h = C.PLATFORM_H;

    let body = t.plat;
    let cap = t.platTop;
    if (p.kind === 'ice') {
      body = '#a8e6ff';
      cap = '#ffffff';
    } else if (p.kind === 'crumble') {
      body = '#9a7456';
      cap = '#d9b894';
    } else if (p.kind === 'moving') {
      body = '#8a97b0';
      cap = '#e3e9f5';
    } else if (p.kind === 'milestone') {
      body = t.accent;
    }

    ctx.globalAlpha = p.crumble > 0 ? Math.max(0.35, p.crumble / 36) : 1;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    roundRect(ctx, x + 3, top + 4, w, h, 6);
    ctx.fill();
    ctx.fillStyle = body;
    roundRect(ctx, x, top, w, h, 6);
    ctx.fill();
    ctx.fillStyle = cap;
    roundRect(ctx, x, top, w, 6, 4);
    ctx.fill();

    // Icicles.
    if (p.kind !== 'moving' && p.kind !== 'crumble') {
      ctx.fillStyle = cap;
      ctx.globalAlpha *= 0.8;
      const n = Math.floor(w / 22);
      for (let i = 0; i < n; i++) {
        const ix = x + 10 + i * 22 + ((p.floor * 7 + i * 13) % 9);
        const len = 5 + ((p.floor * 3 + i * 5) % 8);
        ctx.beginPath();
        ctx.moveTo(ix - 3, top + h);
        ctx.lineTo(ix + 3, top + h);
        ctx.lineTo(ix, top + h + len);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    if (p.kind === 'ice') {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(x + w * 0.2, top + 8, 14, 2);
      ctx.fillRect(x + w * 0.6, top + 9, 8, 2);
    } else if (p.kind === 'crumble') {
      ctx.strokeStyle = '#5a3f2a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.3, top + 2);
      ctx.lineTo(x + w * 0.35, top + 9);
      ctx.lineTo(x + w * 0.3, top + h);
      ctx.moveTo(x + w * 0.7, top + 3);
      ctx.lineTo(x + w * 0.66, top + h);
      ctx.stroke();
    } else if (p.kind === 'moving') {
      ctx.fillStyle = '#4a5670';
      const dir = Math.sign(p.vx);
      for (let i = 0; i < 3; i++) {
        const ax = x + w / 2 + (i - 1) * 14;
        ctx.beginPath();
        ctx.moveTo(ax - 4 * dir, top + 7);
        ctx.lineTo(ax + 4 * dir, top + 11);
        ctx.lineTo(ax - 4 * dir, top + 15);
        ctx.fill();
      }
    } else if (p.kind === 'spring') {
      const cx = x + w / 2;
      ctx.strokeStyle = '#8dffcf';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        ctx.moveTo(cx - 10, top - 2 - i * 4);
        ctx.lineTo(cx + 10, top - 4 - i * 4);
      }
      ctx.stroke();
      ctx.fillStyle = '#ff5fa2';
      roundRect(ctx, cx - 14, top - 20, 28, 5, 2);
      ctx.fill();
    }

    if (p.floor % 10 === 0 && p.floor > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      const label = `${p.floor}`;
      ctx.font = 'bold 13px "Fredoka", system-ui, sans-serif';
      const lw = ctx.measureText(label).width + 12;
      const lx = p.kind === 'milestone' ? C.VIEW_W / 2 - lw / 2 : x + 6;
      roundRect(ctx, lx, top + 20, lw, 18, 5);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.fillText(label, lx + 6, top + 33);
    }
    ctx.globalAlpha = 1;
  }

  private drawPickups(s: GameState, cam: number) {
    const { ctx } = this;
    for (const pk of s.pickups) {
      if (pk.taken) continue;
      const y = this.sy(cam, pk.y) + Math.sin((this.time + pk.id * 17) / 12) * 3;
      if (y < -20 || y > this.viewH + 20) continue;
      const style = PICKUP_STYLE[pk.kind];
      ctx.save();
      ctx.translate(pk.x, y);
      ctx.shadowColor = style.color;
      ctx.shadowBlur = 14;
      if (pk.kind === 'gem') {
        ctx.rotate(Math.sin(this.time / 20 + pk.id) * 0.2);
        ctx.fillStyle = style.color;
        ctx.beginPath();
        ctx.moveTo(0, -9);
        ctx.lineTo(8, -2);
        ctx.lineTo(0, 10);
        ctx.lineTo(-8, -2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath();
        ctx.moveTo(0, -9);
        ctx.lineTo(3, -2);
        ctx.lineTo(-3, -2);
        ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.strokeStyle = style.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.font = '16px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(style.glyph, 0, 1);
      }
      ctx.restore();
    }
  }

  private drawPlayer(x: number, y: number, s: GameState, cam: number, alpha: number, ghost: boolean) {
    const { ctx } = this;
    const p = s.player;
    const sy = this.sy(cam, y);
    if (!ghost) {
      if (this.spinning && !p.grounded) this.spin += 0.28 * p.facing;
      else this.spin *= 0.6;
      this.squash *= 0.8;
    }
    const sq = ghost ? 0 : this.squash;
    const stretch = !ghost && !p.grounded ? Math.max(-0.15, Math.min(0.15, p.vy / 80)) : 0;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, sy - C.PLAYER_H / 2);
    if (!ghost) ctx.rotate(this.spin);
    ctx.scale(p.facing * (1 + sq * 0.6 - stretch * 0.5), 1 - sq + stretch);

    // Speed trail.
    if (!ghost && Math.abs(p.vx) > 7) {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.ellipse(-i * 7, 2, 14, 18, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (ghost) {
      ctx.fillStyle = '#bfe8ff';
      ctx.beginPath();
      ctx.ellipse(0, 2, 15, 20, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    // Rocket flame when a charge is ready.
    if (s.rocket > 0) {
      ctx.fillStyle = `rgba(255,${120 + Math.random() * 80},60,0.9)`;
      ctx.beginPath();
      ctx.moveTo(-7, 18);
      ctx.lineTo(7, 18);
      ctx.lineTo(0, 30 + Math.random() * 8);
      ctx.fill();
    }
    // Feet.
    ctx.fillStyle = '#ff9d2e';
    ctx.beginPath();
    ctx.ellipse(-6, 19, 6, 3, 0, 0, Math.PI * 2);
    ctx.ellipse(7, 19, 6, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    // Body.
    ctx.fillStyle = '#1b2a4a';
    ctx.beginPath();
    ctx.ellipse(0, 1, 15, 19, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f4f8ff';
    ctx.beginPath();
    ctx.ellipse(3, 5, 10, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    // Flipper.
    ctx.fillStyle = '#14203a';
    ctx.beginPath();
    ctx.ellipse(-11, 4, 4, 10, p.grounded ? 0.2 : -0.9, 0, Math.PI * 2);
    ctx.fill();
    // Scarf, fluttering behind with speed.
    ctx.fillStyle = '#ff4d6d';
    ctx.fillRect(-13, -8, 26, 5);
    const flutter = Math.sin(this.time / 3) * 2;
    ctx.beginPath();
    ctx.moveTo(-10, -7);
    ctx.lineTo(-18 - Math.min(10, Math.abs(p.vx)), -9 + flutter);
    ctx.lineTo(-17 - Math.min(10, Math.abs(p.vx)), -2 + flutter);
    ctx.lineTo(-9, -3);
    ctx.fill();
    // Eyes + beak.
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(6, -12, 4.5, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0b1020';
    ctx.beginPath();
    ctx.arc(7.5, -12, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff9d2e';
    ctx.beginPath();
    ctx.moveTo(10, -8);
    ctx.lineTo(18, -6);
    ctx.lineTo(10, -4);
    ctx.fill();
    ctx.restore();

    if (s.magnet > 0) {
      ctx.save();
      ctx.strokeStyle = '#ff5fa2';
      ctx.globalAlpha = 0.25 + Math.sin(this.time / 6) * 0.1;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, sy - C.PLAYER_H / 2, 34 + Math.sin(this.time / 8) * 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawParticles(cam: number) {
    const { ctx } = this;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const q = this.particles[i];
      q.life++;
      q.x += q.vx;
      q.y += q.vy;
      q.vy -= q.gravity;
      q.vx *= 0.97;
      if (q.life > q.max) {
        this.particles.splice(i, 1);
        continue;
      }
      const a = 1 - q.life / q.max;
      ctx.globalAlpha = a;
      ctx.fillStyle = q.color;
      const x = q.x;
      const y = this.sy(cam, q.y);
      if (q.shape === 'dot') {
        ctx.beginPath();
        ctx.arc(x, y, q.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (q.shape === 'square') {
        ctx.fillRect(x - q.size / 2, y - q.size / 2, q.size, q.size);
      } else {
        star(ctx, x, y, q.size * 1.4);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawFreezeVignette(ticks: number) {
    const { ctx } = this;
    const a = Math.min(1, ticks / 60) * 0.35;
    const g = ctx.createRadialGradient(C.VIEW_W / 2, this.viewH / 2, this.viewH * 0.3, C.VIEW_W / 2, this.viewH / 2, this.viewH * 0.75);
    g.addColorStop(0, 'rgba(160,220,255,0)');
    g.addColorStop(1, `rgba(160,220,255,${a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, C.VIEW_W, this.viewH);
  }

  private drawHud(s: GameState, f: Frame, t: Theme) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(0, this.hudTop);
    ctx.textBaseline = 'alphabetic';
    // Score + floor.
    ctx.textAlign = 'left';
    ctx.font = 'bold 30px "Fredoka", system-ui, sans-serif';
    outlined(ctx, s.score.toLocaleString(), C.WALL + 10, 40, '#fff');
    ctx.font = 'bold 15px "Fredoka", system-ui, sans-serif';
    outlined(ctx, `FLOOR ${s.floor}`, C.WALL + 10, 62, t.accent);

    // Speed clock.
    const cx = C.PLAY_R - 30;
    const cy = 36;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.arc(cx, cy, 22, 0, Math.PI * 2);
    ctx.fill();
    const frac = s.scrolling ? s.speedTicks / C.SPEED_LEVEL_TICKS : 0;
    ctx.strokeStyle = frac > 0.85 ? '#ff7a59' : '#8dffcf';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, 18, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px "Fredoka", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${s.speedLevel}`, cx, cy + 6);
    ctx.font = 'bold 9px "Fredoka", system-ui, sans-serif';
    ctx.fillText('SPEED', cx, cy + 34);

    // Power-up chips.
    let chipX = C.VIEW_W / 2 - 60;
    const chip = (glyph: string, label: string, color: string) => {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      roundRect(ctx, chipX, 14, 56, 24, 12);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.font = '13px system-ui, "Apple Color Emoji", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(glyph, chipX + 6, 31);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px "Fredoka", system-ui, sans-serif';
      ctx.fillText(label, chipX + 26, 31);
      chipX += 62;
    };
    if (s.rocket > 0) chip('🚀', `×${s.rocket}`, '#ff7a59');
    if (s.freeze > 0) chip('❄️', `${Math.ceil(s.freeze / 60)}s`, '#9fd8ff');
    if (s.magnet > 0) chip('🧲', `${Math.ceil(s.magnet / 60)}s`, '#ff5fa2');

    // Combo meter.
    const c = s.combo;
    const mx = Math.max(C.WALL / 2, this.cropL + 20);
    const top = 120;
    const hgt = 260;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(ctx, mx - 9, top, 18, hgt, 9);
    ctx.fill();
    if (c.active) {
      const fill = (c.timer / C.COMBO_TICKS) * (hgt - 6);
      const g = ctx.createLinearGradient(0, top + hgt, 0, top);
      g.addColorStop(0, '#ff5fa2');
      g.addColorStop(1, '#ffe27a');
      ctx.fillStyle = g;
      roundRect(ctx, mx - 6, top + hgt - 3 - fill, 12, fill, 6);
      ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px "Fredoka", system-ui, sans-serif';
    ctx.save();
    ctx.translate(mx, top + hgt + 16);
    ctx.fillText('COMBO', 0, 0);
    ctx.restore();

    if (c.active && c.floors > 0) {
      this.comboPulse *= 0.9;
      const scale = 1 + this.comboPulse * 0.35;
      ctx.save();
      ctx.translate(C.WALL + 50, top + 30);
      ctx.scale(scale, scale);
      ctx.textAlign = 'left';
      ctx.font = 'bold 28px "Fredoka", system-ui, sans-serif';
      outlined(ctx, `${c.floors}`, 0, 0, '#ffe27a');
      ctx.font = 'bold 12px "Fredoka", system-ui, sans-serif';
      outlined(ctx, `${c.jumps} jumps · ${comboRating(c.floors)}`, 0, 18, '#fff');
      ctx.restore();
    }

    if (f.ghost) {
      ctx.textAlign = 'right';
      ctx.font = 'bold 12px "Fredoka", system-ui, sans-serif';
      const gFloor = f.ghost.floor;
      const ahead = s.floor - gFloor;
      outlined(ctx, `GHOST ${gFloor}  (${ahead >= 0 ? '+' : ''}${ahead})`, C.PLAY_R - 6, 86, ahead >= 0 ? '#8dffcf' : '#ff8a8a');
    }
    if (f.label) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 14px "Fredoka", system-ui, sans-serif';
      const blink = Math.floor(this.time / 30) % 2 === 0;
      if (blink) outlined(ctx, f.label, C.VIEW_W / 2, this.viewH - 20 - this.hudTop - this.hudBottom, '#ffe27a');
    }
    ctx.restore();
  }

  private drawTexts() {
    const { ctx } = this;
    ctx.textAlign = 'center';
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life++;
      t.y -= t.rise;
      if (t.life > t.max) {
        this.texts.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = 1 - Math.max(0, (t.life - t.max * 0.6) / (t.max * 0.4));
      ctx.font = `bold ${t.size}px "Fredoka", system-ui, sans-serif`;
      outlined(ctx, t.text, t.x, t.y, t.color);
    }
    ctx.globalAlpha = 1;
  }

  private drawBanners() {
    const { ctx } = this;
    for (let i = this.banners.length - 1; i >= 0; i--) {
      const b = this.banners[i];
      b.life++;
      if (b.life > b.max) {
        this.banners.splice(i, 1);
        continue;
      }
      const inT = Math.min(1, b.life / 12);
      const outT = Math.max(0, (b.life - b.max + 20) / 20);
      const scale = 0.4 + easeOutBack(inT) * 0.6;
      ctx.save();
      ctx.globalAlpha = 1 - outT;
      ctx.translate(C.VIEW_W / 2, this.viewH * 0.33);
      ctx.scale(scale, scale);
      ctx.rotate(Math.sin(b.life / 10) * 0.03);
      ctx.textAlign = 'center';
      ctx.font = 'bold 44px "Fredoka", system-ui, sans-serif';
      outlined(ctx, b.text, 0, 0, b.color, 7);
      ctx.font = 'bold 16px "Fredoka", system-ui, sans-serif';
      outlined(ctx, b.sub, 0, 28, '#fff', 4);
      ctx.restore();
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, Math.max(0, h), Math.min(r, h / 2, w / 2));
}

function outlined(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, width = 4) {
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(8,12,30,0.85)';
  ctx.lineWidth = width;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const rr = i % 2 === 0 ? r : r * 0.4;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function easeOutBack(t: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
