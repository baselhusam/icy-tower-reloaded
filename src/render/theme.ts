// A new look every 50 floors, cross-faded so each milestone feels like entering a new zone.
export interface Theme {
  name: string;
  skyTop: string;
  skyBottom: string;
  brick: string;
  brickLine: string;
  wall: string;
  wallLine: string;
  plat: string;
  platTop: string;
  accent: string;
}

export const THEMES: Theme[] = [
  { name: 'Ice Cave', skyTop: '#0b1e3a', skyBottom: '#1d4f86', brick: '#1a3d6b', brickLine: '#10294a', wall: '#2a5d99', wallLine: '#183d6a', plat: '#5fa8e8', platTop: '#d9f2ff', accent: '#7fe3ff' },
  { name: 'Frozen Forest', skyTop: '#07251f', skyBottom: '#1c5a4a', brick: '#16463a', brickLine: '#0d2e26', wall: '#2c6b58', wallLine: '#194538', plat: '#58c2a0', platTop: '#dcfff2', accent: '#8dffcf' },
  { name: 'Aurora Heights', skyTop: '#140a33', skyBottom: '#3b1f73', brick: '#2b1a5a', brickLine: '#1a0f3b', wall: '#4b2e8e', wallLine: '#2e1b5e', plat: '#9b7dff', platTop: '#efe6ff', accent: '#c6a8ff' },
  { name: 'Crystal Spire', skyTop: '#2a0a2e', skyBottom: '#7a2a6e', brick: '#5a1f55', brickLine: '#3a1238', wall: '#8a3a7e', wallLine: '#5c2254', plat: '#ff8ad8', platTop: '#ffe8f7', accent: '#ffb3e6' },
  { name: 'Magma Frost', skyTop: '#2a0c05', skyBottom: '#8a2f12', brick: '#5e200c', brickLine: '#3d1407', wall: '#9a3a18', wallLine: '#62230d', plat: '#ff9d5c', platTop: '#fff0e0', accent: '#ffc27a' },
  { name: 'Starfield', skyTop: '#000008', skyBottom: '#101a3a', brick: '#0e1530', brickLine: '#070b1c', wall: '#1c2a55', wallLine: '#101a38', plat: '#e8e8ff', platTop: '#ffffff', accent: '#ffe27a' },
];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function themeAt(floor: number): { theme: Theme; next: Theme; t: number; index: number } {
  const zone = Math.max(0, Math.floor(floor / 50));
  const into = floor - zone * 50;
  const theme = THEMES[zone % THEMES.length];
  const next = THEMES[(zone + 1) % THEMES.length];
  const t = into > 44 ? (into - 44) / 6 : 0;
  return { theme, next, t, index: zone };
}

export function blend(floor: number): Theme {
  const { theme, next, t } = themeAt(floor);
  if (t === 0) return theme;
  const out = { ...theme } as Theme;
  for (const k of Object.keys(theme) as (keyof Theme)[]) {
    if (k !== 'name') out[k] = mix(theme[k], next[k], t);
  }
  return out;
}
