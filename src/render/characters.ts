// Playable characters and their wardrobe. Every character is drawn procedurally in a local frame:
// origin at the body centre, +x is the direction they face, feet rest at y = +20 (PLAYER_H / 2).
// Purely cosmetic: the simulation never sees any of this.

export type CharId = 'pip' | 'harold' | 'yuki';
export type HatId = 'none' | 'beanie' | 'cap' | 'crown' | 'tophat' | 'party';
export type ExtraId = 'none' | 'scarf' | 'shades' | 'cape';

export interface Look {
  char: CharId;
  hat: HatId;
  color: number; // index into COLORS
  extra: ExtraId;
}

export interface Pose {
  t: number; // animation clock in frames
  grounded: boolean;
  vx: number;
}

export const CHARACTERS: { id: CharId; name: string; tag: string }[] = [
  { id: 'pip', name: 'Pip', tag: 'The penguin who never stops climbing' },
  { id: 'harold', name: 'Harold', tag: 'The original tower climber' },
  { id: 'yuki', name: 'Yuki', tag: 'Small yeti, enormous jumps' },
];

export const HATS: { id: HatId; name: string; icon: string }[] = [
  { id: 'none', name: 'None', icon: '✕' },
  { id: 'beanie', name: 'Beanie', icon: '🧶' },
  { id: 'cap', name: 'Cap', icon: '🧢' },
  { id: 'crown', name: 'Crown', icon: '👑' },
  { id: 'tophat', name: 'Top hat', icon: '🎩' },
  { id: 'party', name: 'Party', icon: '🥳' },
];

export const EXTRAS: { id: ExtraId; name: string; icon: string }[] = [
  { id: 'none', name: 'None', icon: '✕' },
  { id: 'scarf', name: 'Scarf', icon: '🧣' },
  { id: 'shades', name: 'Shades', icon: '🕶️' },
  { id: 'cape', name: 'Cape', icon: '🦸' },
];

export const COLORS = ['#ff4d6d', '#ff9d2e', '#ffd23f', '#3ddc97', '#3aa0ff', '#9b5de5', '#ff5fa2', '#39415a'];

export const DEFAULT_LOOK: Look = { char: 'pip', hat: 'none', color: 0, extra: 'scarf' };
// The AI (and the attract mode behind the menus) always wears this, so it never looks like you.
export const FROSTY_LOOK: Look = { char: 'pip', hat: 'beanie', color: 4, extra: 'scarf' };

export function sanitizeLook(raw: unknown): Look {
  const l = (raw ?? {}) as Partial<Look>;
  const pick = <T extends string>(v: unknown, list: { id: T }[], fallback: T) => (list.some((x) => x.id === v) ? (v as T) : fallback);
  return {
    char: pick(l.char, CHARACTERS, DEFAULT_LOOK.char),
    hat: pick(l.hat, HATS, DEFAULT_LOOK.hat),
    color: Number.isInteger(l.color) && l.color! >= 0 && l.color! < COLORS.length ? l.color! : DEFAULT_LOOK.color,
    extra: pick(l.extra, EXTRAS, DEFAULT_LOOK.extra),
  };
}

export function randomLook(): Look {
  const any = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  return { char: any(CHARACTERS).id, hat: any(HATS).id, color: Math.floor(Math.random() * COLORS.length), extra: any(EXTRAS).id };
}

// Where accessories attach on each body.
interface Rig {
  hat: { x: number; y: number; w: number }; // rim centre + width
  eye: { x: number; y: number; w: number };
  neck: { y: number; hw: number };
}

const RIGS: Record<CharId, Rig> = {
  pip: { hat: { x: 1, y: -14, w: 20 }, eye: { x: 7, y: -12, w: 11 }, neck: { y: -6, hw: 13 } },
  harold: { hat: { x: 1, y: -15, w: 22 }, eye: { x: 7, y: -10, w: 11 }, neck: { y: 0.5, hw: 7 } },
  yuki: { hat: { x: 2, y: -14, w: 21 }, eye: { x: 7, y: -8, w: 13 }, neck: { y: 3, hw: 12 } },
};

export function drawCharacter(ctx: CanvasRenderingContext2D, look: Look, pose: Pose) {
  const color = COLORS[look.color] ?? COLORS[0];
  const rig = RIGS[look.char];
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (look.extra === 'cape') cape(ctx, color, rig, pose);
  if (look.char === 'harold') harold(ctx, color, pose);
  else if (look.char === 'yuki') yuki(ctx, color, pose);
  else pip(ctx, color, pose);
  if (look.extra === 'scarf') scarf(ctx, color, rig, pose);
  if (look.extra === 'shades') shades(ctx, rig);
  hat(ctx, look.hat, color, rig);
  ctx.restore();
}

// ---- bodies ------------------------------------------------------------------------------------

function pip(ctx: CanvasRenderingContext2D, color: string, pose: Pose) {
  // Feet.
  ctx.fillStyle = '#ff9d2e';
  ellipse(ctx, -6, 19, 6, 3);
  ellipse(ctx, 7, 19, 6, 3);
  // Body with an open jacket; the white belly shows through the front.
  ctx.fillStyle = '#1b2a4a';
  ellipse(ctx, 0, 1, 15, 19);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = color;
  ctx.fillRect(-20, -3, 40, 30);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(-20, -3, 40, 2);
  ctx.restore();
  ctx.fillStyle = '#f4f8ff';
  ellipse(ctx, 3, 5, 10, 13);
  // Flipper.
  ctx.fillStyle = '#14203a';
  ellipse(ctx, -11, 4, 4, 10, pose.grounded ? 0.2 : -0.9);
  // Eye + beak.
  ctx.fillStyle = '#fff';
  ellipse(ctx, 6, -12, 4.5, 5);
  ctx.fillStyle = '#0b1020';
  circle(ctx, 7.5, -12, 2.2);
  ctx.fillStyle = '#ff9d2e';
  ctx.beginPath();
  ctx.moveTo(10, -8);
  ctx.lineTo(18, -6);
  ctx.lineTo(10, -4);
  ctx.fill();
}

function harold(ctx: CanvasRenderingContext2D, color: string, pose: Pose) {
  const skin = '#ffd0a6';
  const air = !pose.grounded;
  const sw = air ? 0 : Math.sin(pose.t * 0.45) * Math.min(1, Math.abs(pose.vx) / 4) * 6;
  const sleeve = shade(color, -0.25);

  // Back limbs.
  limb(ctx, -1, 4, air ? -10 : -1 - sw, air ? -3 : 11, sleeve, 5);
  ctx.fillStyle = skin;
  circle(ctx, air ? -10 : -1 - sw, air ? -3 : 11, 2.8);
  limb(ctx, -3, 12, air ? -8 : -3 - sw, air ? 15 : 17, '#26477f', 6);
  shoe(ctx, air ? -8 : -3 - sw, air ? 15 : 17);
  // Front leg.
  limb(ctx, 3, 12, air ? 8 : 3 + sw, air ? 12 : 17, '#3464b0', 6);
  shoe(ctx, air ? 8 : 3 + sw, air ? 12 : 17);
  // Torso.
  ctx.fillStyle = color;
  rrect(ctx, -8, 0, 16, 14, 5);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(-8, 6, 16, 2.5);
  ctx.fillStyle = '#26477f';
  ctx.fillRect(-7, 12, 14, 2.5);
  // Front arm.
  limb(ctx, 2, 4, air ? 11 : 2 + sw, air ? -6 : 11, color, 5);
  ctx.fillStyle = skin;
  circle(ctx, air ? 11 : 2 + sw, air ? -6 : 11, 2.8);
  // Big head.
  ctx.fillStyle = skin;
  ctx.fillRect(-2, -2, 4, 3);
  circle(ctx, 1, -9, 11);
  // Hair: clipped to the head so it follows the skull, plus spikes on top.
  ctx.fillStyle = '#4a2a17';
  ctx.save();
  circle(ctx, 1, -9, 11.5, false);
  ctx.clip();
  ctx.fillRect(-12, -22, 26, 8.5);
  ctx.fillRect(-12, -22, 8, 18);
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo(-9, -15);
  ctx.lineTo(-15, -17);
  ctx.lineTo(-7, -19);
  ctx.lineTo(-8, -24);
  ctx.lineTo(-1, -20);
  ctx.lineTo(2, -25);
  ctx.lineTo(5, -19.5);
  ctx.lineTo(11, -21);
  ctx.lineTo(10, -14);
  ctx.lineTo(13, -12);
  ctx.lineTo(8, -12);
  ctx.fill();
  // Ear.
  ctx.fillStyle = skin;
  circle(ctx, -3, -8, 3);
  ctx.fillStyle = '#e9a97c';
  circle(ctx, -3, -8, 1.4);
  // Face.
  ctx.fillStyle = '#fff';
  ellipse(ctx, 6.5, -10, 3.2, 4);
  ctx.fillStyle = '#1a1020';
  circle(ctx, 7.5, -9.6, 1.9);
  ctx.strokeStyle = '#4a2a17';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(3.5, -15);
  ctx.lineTo(9, -14.5);
  ctx.stroke();
  ctx.fillStyle = '#f2b184';
  circle(ctx, 11.5, -7, 2.2);
  ctx.strokeStyle = '#8a3b2a';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(7, -5, 3, 0.2, Math.PI * 0.8);
  ctx.stroke();
}

function yuki(ctx: CanvasRenderingContext2D, color: string, pose: Pose) {
  // Feet.
  ctx.fillStyle = '#8fa8cc';
  ellipse(ctx, -6, 18.5, 7, 3.5);
  ellipse(ctx, 7, 18.5, 7, 3.5);
  // Fluffy body in a tee.
  fluffy(ctx, 0, 6, 15, 13, '#eef4fc', 14);
  ctx.save();
  ellipse(ctx, 0, 6, 15, 13, 0, false);
  ctx.clip();
  ctx.fillStyle = color;
  ctx.fillRect(-20, 3, 40, 12);
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillRect(-20, 8, 40, 2);
  ctx.restore();
  // Arm.
  ctx.fillStyle = '#ffffff';
  ellipse(ctx, -8, 7, 4.5, 8.5, pose.grounded ? 0.35 : -1.2);
  // Head.
  fluffy(ctx, 2, -7, 12, 11, '#ffffff', 12);
  ctx.fillStyle = '#f3e2b3';
  ctx.beginPath();
  ctx.moveTo(-6, -15);
  ctx.quadraticCurveTo(-11, -20, -8, -25);
  ctx.lineTo(-2, -17);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(6, -17);
  ctx.quadraticCurveTo(9, -22, 7, -27);
  ctx.lineTo(11, -16);
  ctx.fill();
  // Face.
  ctx.fillStyle = '#bfe6ff';
  ellipse(ctx, 6.5, -6, 7, 7.5);
  ctx.fillStyle = '#0b1020';
  circle(ctx, 4.5, -8, 1.8);
  circle(ctx, 9.5, -8, 1.8);
  ctx.fillStyle = '#fff';
  circle(ctx, 5, -8.6, 0.7);
  circle(ctx, 10, -8.6, 0.7);
  ctx.fillStyle = 'rgba(255,95,162,0.45)';
  circle(ctx, 2.5, -4.5, 1.8);
  circle(ctx, 12, -4.5, 1.8);
  ctx.fillStyle = '#2a3350';
  ctx.beginPath();
  ctx.arc(7, -3.5, 2.6, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillRect(7.2, -3.5, 1.4, 1.4);
}

// ---- accessories -------------------------------------------------------------------------------

function hat(ctx: CanvasRenderingContext2D, id: HatId, color: string, rig: Rig) {
  if (id === 'none') return;
  const { x, y, w } = rig.hat;
  const r = w / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.08);
  switch (id) {
    case 'beanie':
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 1, r, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = shade(color, -0.2);
      rrect(ctx, -r - 1, -2, w + 2, 5, 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      circle(ctx, 0, -r - 1, 4);
      break;
    case 'cap':
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 1, r, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = shade(color, -0.3);
      ellipse(ctx, r + 2, 0.5, 8, 2.6);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(-2, -r + 1, 3, r);
      ctx.fillStyle = shade(color, -0.3);
      circle(ctx, 0, -r + 1, 1.8);
      break;
    case 'crown':
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.moveTo(-r + 1, 1);
      ctx.lineTo(-r, -9);
      ctx.lineTo(-r / 2, -4);
      ctx.lineTo(0, -12);
      ctx.lineTo(r / 2, -4);
      ctx.lineTo(r, -9);
      ctx.lineTo(r - 1, 1);
      ctx.fill();
      ctx.fillStyle = '#e0a800';
      ctx.fillRect(-r + 1, -1, w - 2, 2.5);
      ctx.fillStyle = color;
      circle(ctx, 0, -4, 2);
      ctx.fillStyle = '#7fe3ff';
      circle(ctx, -r / 2 - 1, -1.5, 1.4);
      circle(ctx, r / 2 + 1, -1.5, 1.4);
      break;
    case 'tophat':
      ctx.fillStyle = '#16161f';
      ellipse(ctx, 0, 0, r + 4, 2.8);
      rrect(ctx, -r * 0.7, -17, r * 1.4, 17, 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillRect(-r * 0.7, -5, r * 1.4, 3.5);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(r * 0.3, -16, 2, 10);
      break;
    case 'party':
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-r + 2, 1);
      ctx.lineTo(r - 2, 1);
      ctx.lineTo(2, -21);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      circle(ctx, -2, -4, 1.5);
      circle(ctx, 4, -9, 1.5);
      circle(ctx, 0, -14, 1.3);
      ctx.fillStyle = '#ffe27a';
      circle(ctx, 2, -22, 3);
      break;
  }
  ctx.restore();
}

function scarf(ctx: CanvasRenderingContext2D, color: string, rig: Rig, pose: Pose) {
  const { y, hw } = rig.neck;
  const flutter = Math.sin(pose.t / 3) * 2;
  const trail = Math.min(10, Math.abs(pose.vx));
  ctx.fillStyle = color;
  rrect(ctx, -hw, y - 2.5, hw * 2, 5, 2.5);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-hw + 3, y - 1.5);
  ctx.lineTo(-hw - 5 - trail, y - 3 + flutter);
  ctx.lineTo(-hw - 4 - trail, y + 4 + flutter);
  ctx.lineTo(-hw + 4, y + 2.5);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  for (let sx = -hw + 4; sx < hw - 2; sx += 6) ctx.fillRect(sx, y - 2.5, 2, 5);
}

function shades(ctx: CanvasRenderingContext2D, rig: Rig) {
  const { x, y, w } = rig.eye;
  ctx.strokeStyle = '#0b0b12';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y - 1.5);
  ctx.lineTo(x - w / 2 - 6, y - 2.5);
  ctx.stroke();
  ctx.fillStyle = '#0b0b12';
  rrect(ctx, x - w / 2, y - 3, w, 6, 2.5);
  ctx.fill();
  ctx.fillStyle = 'rgba(160,230,255,0.7)';
  ctx.fillRect(x - w / 2 + 2, y - 1.8, 3, 1.3);
}

function cape(ctx: CanvasRenderingContext2D, color: string, rig: Rig, pose: Pose) {
  const y = rig.neck.y - 1;
  const flow = Math.min(12, Math.abs(pose.vx) * 1.2) + (pose.grounded ? 0 : 5);
  const wave = Math.sin(pose.t / 4) * 2;
  ctx.fillStyle = shade(color, -0.35);
  ctx.beginPath();
  ctx.moveTo(-3, y);
  ctx.lineTo(4, y);
  ctx.quadraticCurveTo(-4, 10, -6 - flow * 0.4, 20 + wave * 0.5);
  ctx.lineTo(-14 - flow, 16 - flow * 0.6 + wave);
  ctx.quadraticCurveTo(-12, 4, -3, y);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-3, y);
  ctx.quadraticCurveTo(-11, 5, -14 - flow, 16 - flow * 0.6 + wave);
  ctx.lineTo(-10 - flow * 0.7, 17 - flow * 0.3 + wave);
  ctx.quadraticCurveTo(-7, 6, -3, y);
  ctx.fill();
}

// ---- stage + avatars ---------------------------------------------------------------------------

// Wardrobe preview: the character hops on a little ice ledge under a coloured spotlight.
export function drawStage(cv: HTMLCanvasElement, look: Look, t: number, pop: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr)) cv.width = Math.round(w * dpr);
  if (cv.height !== Math.round(h * dpr)) cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const color = COLORS[look.color];
  const cx = w / 2;
  const floorY = h * 0.82;

  // Spotlight + slowly turning rays.
  const glow = ctx.createRadialGradient(cx, h * 0.55, 4, cx, h * 0.55, h * 0.62);
  glow.addColorStop(0, hexA(color, 0.45));
  glow.addColorStop(1, hexA(color, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.translate(cx, h * 0.55);
  ctx.rotate(t / 400);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 10; i++) {
    ctx.rotate((Math.PI * 2) / 10);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-h * 0.09, -h);
    ctx.lineTo(h * 0.09, -h);
    ctx.fill();
  }
  ctx.restore();

  // Hop cycle: airborne for the first 40% of each beat, then a squash on landing.
  const p = (t % 100) / 100;
  const hop = p < 0.4 ? Math.sin((p / 0.4) * Math.PI) : 0;
  const squash = p >= 0.4 && p < 0.55 ? 0.22 * (1 - (p - 0.4) / 0.15) : 0;
  const s = (h / 90) * (1 + pop * 0.18);

  // Ice ledge + shadow.
  ctx.fillStyle = '#5fa8e8';
  rrect(ctx, cx - s * 32, floorY, s * 64, s * 9, s * 3);
  ctx.fill();
  ctx.fillStyle = '#d9f2ff';
  rrect(ctx, cx - s * 32, floorY, s * 64, s * 3.5, s * 2);
  ctx.fill();
  for (let i = 0; i < 5; i++) {
    const ix = cx - s * 24 + i * s * 12;
    ctx.beginPath();
    ctx.moveTo(ix - s * 2, floorY + s * 9);
    ctx.lineTo(ix + s * 2, floorY + s * 9);
    ctx.lineTo(ix, floorY + s * (13 + (i % 2) * 4));
    ctx.fill();
  }
  ctx.fillStyle = `rgba(0,0,0,${0.3 - hop * 0.15})`;
  ellipse(ctx, cx, floorY + s, s * (15 - hop * 5), s * 2.5);

  ctx.save();
  ctx.translate(cx, floorY - s * 20 * (1 - squash) - hop * s * 16);
  ctx.scale(s * (1 + squash * 0.6), s * (1 - squash));
  drawCharacter(ctx, look, { t, grounded: hop === 0, vx: 0 });
  ctx.restore();
}

const avatarCache = new Map<string, string>();

// A small portrait for leaderboards and menus. Cached per look + size.
export function avatarURL(look: Look, size = 64): string {
  const key = `${look.char}/${look.hat}/${look.color}/${look.extra}/${size}`;
  let url = avatarCache.get(key);
  if (!url) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size * 2;
    const ctx = cv.getContext('2d')!;
    const s = (size * 2) / 50;
    ctx.translate(size - s * 2, size * 2 - s * 21.5);
    ctx.scale(s, s);
    drawCharacter(ctx, look, { t: 0, grounded: true, vx: 0 });
    url = cv.toDataURL();
    avatarCache.set(key, url);
  }
  return url;
}

// ---- helpers -----------------------------------------------------------------------------------

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = 0, fill = true) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  if (fill) ctx.fill();
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill = true) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) ctx.fill();
}

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, h / 2, w / 2));
}

function limb(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function shoe(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = '#f4f6fb';
  ellipse(ctx, x + 2, y + 1.5, 4.8, 2.8);
  ctx.fillStyle = '#ff4d6d';
  ctx.fillRect(x - 1, y + 2.6, 7, 1.4);
}

// A fur ball: an ellipse with a scalloped outline and a slightly shaded underside.
function fluffy(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string, tufts: number) {
  ctx.fillStyle = color;
  ellipse(ctx, x, y, rx, ry);
  for (let i = 0; i < tufts; i++) {
    const a = (i / tufts) * Math.PI * 2;
    circle(ctx, x + Math.cos(a) * rx, y + Math.sin(a) * ry, 3.2);
  }
  ctx.fillStyle = 'rgba(120,150,200,0.14)';
  ctx.save();
  ellipse(ctx, x, y, rx + 1, ry + 1, 0, false);
  ctx.clip();
  ctx.fillRect(x - rx - 4, y + ry * 0.3, rx * 2 + 8, ry);
  ctx.restore();
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt);
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
