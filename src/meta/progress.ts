// Everything that persists between runs: profile, lifetime stats, achievements, XP/levels,
// local leaderboards and best replays (used as ghosts). Browser-local for now; the shapes
// here are what a global leaderboard API would accept.
import type { Replay } from '../engine/replay';
import type { GameState } from '../engine/sim';

export type Mode = 'endless' | 'daily';

export interface ScoreEntry {
  name: string;
  score: number;
  floor: number;
  combo: number;
  date: string;
  bot?: boolean;
}

export interface Lifetime {
  games: number;
  floors: number;
  jumps: number;
  gems: number;
  combos: number;
  wallBounces: number;
  powerups: number;
  springs: number;
  playSeconds: number;
}

export interface Profile {
  name: string;
  xp: number;
  lifetime: Lifetime;
  achievements: Record<string, string>; // id -> date unlocked
  boards: Record<string, ScoreEntry[]>; // "endless" or "daily:YYYY-MM-DD"
  ghosts: Record<string, Replay>; // best replay per board key
  muted: boolean;
}

export interface Achievement {
  id: string;
  title: string;
  desc: string;
  icon: string;
  check: (run: GameState, life: Lifetime) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-steps', title: 'First Steps', desc: 'Reach floor 25', icon: '👣', check: (r) => r.floor >= 25 },
  { id: 'century', title: 'Century', desc: 'Reach floor 100', icon: '💯', check: (r) => r.floor >= 100 },
  { id: 'skyscraper', title: 'Skyscraper', desc: 'Reach floor 250', icon: '🏙️', check: (r) => r.floor >= 250 },
  { id: 'stratosphere', title: 'Stratosphere', desc: 'Reach floor 500', icon: '🚀', check: (r) => r.floor >= 500 },
  { id: 'orbit', title: 'Low Orbit', desc: 'Reach floor 1000', icon: '🛰️', check: (r) => r.floor >= 1000 },
  { id: 'combo-10', title: 'Chain Starter', desc: 'Land a 10-floor combo', icon: '🔗', check: (r) => r.stats.bestComboFloors >= 10 },
  { id: 'combo-30', title: 'Combo Artist', desc: 'Land a 30-floor combo', icon: '🎨', check: (r) => r.stats.bestComboFloors >= 30 },
  { id: 'combo-75', title: 'Blizzard', desc: 'Land a 75-floor combo', icon: '🌨️', check: (r) => r.stats.bestComboFloors >= 75 },
  { id: 'combo-150', title: 'Absolute Zero', desc: 'Land a 150-floor combo', icon: '🧊', check: (r) => r.stats.bestComboFloors >= 150 },
  { id: 'bouncer', title: 'Pinball', desc: '25 wall bounces in one run', icon: '🏓', check: (r) => r.stats.wallBounces >= 25 },
  { id: 'gem-run', title: 'Gem Hoarder', desc: 'Collect 40 gems in one run', icon: '💎', check: (r) => r.stats.gems >= 40 },
  { id: 'power-hungry', title: 'Power Hungry', desc: 'Grab 5 power-ups in one run', icon: '⚡', check: (r) => r.stats.powerups >= 5 },
  { id: 'score-10k', title: 'Five Digits', desc: 'Score 10,000 in one run', icon: '🏅', check: (r) => r.score >= 10000 },
  { id: 'score-50k', title: 'High Roller', desc: 'Score 50,000 in one run', icon: '🏆', check: (r) => r.score >= 50000 },
  { id: 'max-speed', title: 'Hurry Up!', desc: 'Survive to speed level 5', icon: '⏱️', check: (r) => r.speedLevel >= 5 },
  { id: 'veteran', title: 'Veteran', desc: 'Play 25 games', icon: '🎖️', check: (_r, l) => l.games >= 25 },
  { id: 'marathon', title: 'Marathon', desc: 'Climb 5,000 floors in total', icon: '🏃', check: (_r, l) => l.floors >= 5000 },
  { id: 'jeweler', title: 'Jeweler', desc: 'Collect 500 gems in total', icon: '👑', check: (_r, l) => l.gems >= 500 },
];

const KEY = 'icy-tower-reloaded:v1';

function blankProfile(): Profile {
  return {
    name: '',
    xp: 0,
    lifetime: { games: 0, floors: 0, jumps: 0, gems: 0, combos: 0, wallBounces: 0, powerups: 0, springs: 0, playSeconds: 0 },
    achievements: {},
    boards: {},
    ghosts: {},
    muted: false,
  };
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Profile;
      const base = blankProfile();
      return { ...base, ...p, lifetime: { ...base.lifetime, ...p.lifetime } };
    }
  } catch {
    /* storage unavailable: play without persistence */
  }
  return blankProfile();
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore quota / privacy mode */
  }
}

// Level N needs 250 * N^1.5 cumulative-ish XP; gentle early, slower later.
export function levelFromXp(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let remaining = xp;
  for (;;) {
    const need = Math.round(250 * Math.pow(level, 1.5));
    if (remaining < need) return { level, into: remaining, need };
    remaining -= need;
    level++;
  }
}

export function xpForRun(r: GameState): number {
  return Math.round(r.floor * 2 + r.score / 50 + r.stats.gems * 3 + r.stats.combos * 10);
}

export interface RunResult {
  xp: number;
  levelBefore: number;
  levelAfter: number;
  unlocked: Achievement[];
  rank: number; // 1-based rank on the board, 0 if it didn't place
  personalBest: boolean;
}

export function boardKey(mode: Mode, dailyKey: string): string {
  return mode === 'daily' ? `daily:${dailyKey}` : 'endless';
}

export function recordRun(profile: Profile, run: GameState, key: string, replay: Replay, bot: boolean): RunResult {
  const levelBefore = levelFromXp(profile.xp).level;
  const xp = bot ? 0 : xpForRun(run);
  const unlocked: Achievement[] = [];

  if (!bot) {
    profile.xp += xp;
    const l = profile.lifetime;
    l.games++;
    l.floors += run.floor;
    l.jumps += run.stats.jumps;
    l.gems += run.stats.gems;
    l.combos += run.stats.combos;
    l.wallBounces += run.stats.wallBounces;
    l.powerups += run.stats.powerups;
    l.springs += run.stats.springs;
    l.playSeconds += Math.round(run.tick / 60);
    const today = new Date().toISOString().slice(0, 10);
    for (const a of ACHIEVEMENTS) {
      if (!profile.achievements[a.id] && a.check(run, l)) {
        profile.achievements[a.id] = today;
        unlocked.push(a);
      }
    }
  }

  const board = (profile.boards[key] ??= []);
  const prevBest = board.filter((e) => !e.bot).reduce((m, e) => Math.max(m, e.score), 0);
  const entry: ScoreEntry = {
    name: bot ? '🤖 Frosty' : profile.name || 'Player',
    score: run.score,
    floor: run.floor,
    combo: run.stats.bestComboFloors,
    date: new Date().toISOString(),
    bot: bot || undefined,
  };
  board.push(entry);
  board.sort((a, b) => b.score - a.score);
  board.length = Math.min(board.length, 10);
  const rank = board.indexOf(entry) + 1;
  const personalBest = !bot && run.score > prevBest;
  if (personalBest) profile.ghosts[key] = replay;

  // Old daily boards and ghosts are dead weight.
  for (const k of Object.keys(profile.ghosts)) if (k.startsWith('daily:') && k !== key && k < key) delete profile.ghosts[k];

  saveProfile(profile);
  return { xp, levelBefore, levelAfter: levelFromXp(profile.xp).level, unlocked, rank, personalBest };
}
