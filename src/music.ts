// Adaptive chiptune soundtrack, synthesized on the fly like the sound effects.
// A lookahead scheduler plays one 16th-note step at a time; each step reads the latest game
// "mood", so the music speeds up with the scroll speed, stacks new layers every couple of
// speed levels, darkens its harmony in each new zone, and panics when you near the bottom.
import type { Sfx } from './audio';

export type MusicMood =
  | { scene: 'silent' }
  | { scene: 'menu' }
  | {
      scene: 'play';
      speedLevel: number; // 1..9, bumps every 30s once the tower scrolls
      scrolling: boolean;
      floor: number;
      danger: number; // 0..1, how close the player is to falling off the bottom
      combo: boolean;
      frozen: boolean;
      paused: boolean;
      over: boolean;
    };

type Quality = 'm' | 'M' | 'd';
type Chord = [root: number, q: Quality];

const INTERVALS: Record<Quality, number[]> = { m: [0, 3, 7], M: [0, 4, 7], d: [0, 3, 6] };

// One progression per 50-floor zone, drifting from dreamy minor to harmonic-minor and
// phrygian tension. Roots are semitones above the zone's key.
const PROGRESSIONS: Chord[][] = [
  [[0, 'm'], [8, 'M'], [3, 'M'], [10, 'M']], // Ice Cave: i VI III VII
  [[0, 'm'], [8, 'M'], [10, 'M'], [7, 'm']], // Frozen Forest: i VI VII v
  [[0, 'm'], [5, 'm'], [8, 'M'], [7, 'M']], // Aurora Heights: i iv VI V
  [[0, 'm'], [1, 'M'], [0, 'm'], [11, 'd']], // Crystal Spire: i bII i vii°
  [[0, 'm'], [8, 'M'], [5, 'm'], [7, 'M']], // Magma Frost: i VI iv V
  [[0, 'm'], [1, 'M'], [8, 'M'], [7, 'M']], // Starfield: i bII VI V
];
// Each zone also climbs to a new key, so a milestone feels like a lift.
const KEYS = [0, 2, 3, 5, 7, 8];

// Lead motifs index into the chord tones stretched over octaves (0-2 = root/3rd/5th, 3-5 an octave up...).
const _ = -1;
const MOTIF_A = [3, _, _, 4, _, 3, _, 2, 3, _, 5, _, 4, _, 2, _];
const MOTIF_B = [5, _, 4, _, 3, _, 4, _, 2, _, _, _, 3, _, _, _];
const MOTIF_RUN = [3, 4, 5, 4, 3, 4, 5, 6, 5, 4, 3, 2, 3, 4, 5, 6];

const midi = (m: number) => 440 * 2 ** ((m - 69) / 12);
const wrap = (n: number, lo: number) => lo + (((n - lo) % 12) + 12) % 12;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export class Music {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private noise: AudioBuffer | null = null;
  private timer = 0;

  private mood: MusicMood = { scene: 'silent' };
  private running = false; // are steps being scheduled right now
  private nextTime = 0;
  private step = 0;
  private bpm = 96;
  private tier = 0;
  private zone = 0;
  private fill = false;
  enabled = true;

  constructor(private sfx: Sfx) {}

  /** Called every frame with the current game mood. */
  update(mood: MusicMood) {
    const prev = this.mood;
    this.mood = mood;
    const audible = this.enabled && !this.sfx.muted && mood.scene !== 'silent' && !(mood.scene === 'play' && mood.over);
    if (!audible) {
      if (this.running) this.stop(mood.scene === 'play' && mood.over);
      return;
    }
    // A fresh run (or leaving the menu) restarts the song on a downbeat.
    const restarted = prev.scene !== mood.scene || (mood.scene === 'play' && prev.scene === 'play' && prev.over);
    if (!this.running || restarted) this.start();
    this.shape();
  }

  /** The tower just sped up: crash cymbal now, drum fill into the next bar. */
  surge() {
    if (!this.running || !this.ctx) return;
    this.crash(this.ctx.currentTime + 0.02, 0.35);
    this.fill = true;
  }

  private setup(): boolean {
    if (this.ctx) return true;
    const ctx = this.sfx.context();
    if (!ctx) return false;
    this.ctx = ctx;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 2400;
    this.filter.Q.value = 0.7;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(this.filter).connect(comp).connect(ctx.destination);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return true;
  }

  private start() {
    if (!this.setup() || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.step = 0;
    this.fill = false;
    this.nextTime = now + 0.08;
    const target = this.targets();
    this.bpm = target.bpm;
    this.tier = target.tier;
    this.zone = target.zone;
    this.running = true;
    if (!this.timer) this.timer = window.setInterval(() => this.schedule(), 25);
  }

  private stop(dramatic: boolean) {
    this.running = false;
    if (!this.ctx || !this.bus || !this.filter) return;
    const t = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(t);
    this.bus.gain.setTargetAtTime(0, t, dramatic ? 0.25 : 0.08);
    // On game over the whole band sinks, like the tower swallowing you.
    if (dramatic) this.filter.frequency.setTargetAtTime(180, t, 0.2);
  }

  /** Volume and brightness follow the mood continuously. */
  private shape() {
    if (!this.ctx || !this.bus || !this.filter) return;
    const m = this.mood;
    const t = this.ctx.currentTime;
    // Kept well under the sound effects; swells a little with each tier.
    let gain = 0.18;
    let cutoff = 2000;
    if (m.scene === 'play') {
      gain = 0.22 + Math.max(0, this.tier) * 0.016;
      cutoff = 2600 + this.tier * 1500;
      if (m.frozen) cutoff = 1100; // the freeze power-up muffles the world
      if (m.paused) {
        gain = 0.1;
        cutoff = 500;
      }
    }
    this.bus.gain.setTargetAtTime(gain, t, 0.12);
    this.filter.frequency.setTargetAtTime(cutoff, t, 0.15);
  }

  private targets(): { bpm: number; tier: number; zone: number } {
    const m = this.mood;
    if (m.scene !== 'play') return { bpm: 92, tier: -1, zone: 0 };
    const zone = Math.floor(m.floor / 50);
    // Tier 0 before the tower starts moving, then a new layer every two speed levels,
    // with one more once you pass floor 100.
    const tier = m.scrolling ? Math.min(5, Math.ceil(m.speedLevel / 2) + (zone >= 2 ? 1 : 0)) : 0;
    const bpm = Math.min(184, 112 + (m.scrolling ? (m.speedLevel - 1) * 7 : 0) + Math.min(zone, 6) * 2);
    return { bpm, tier, zone };
  }

  private schedule() {
    if (!this.running || !this.ctx) return;
    const ctx = this.ctx;
    // Tab was asleep: don't try to catch up on missed notes.
    if (this.nextTime < ctx.currentTime - 0.2) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + 0.12) {
      const target = this.targets();
      // Tempo glides toward the target so each speed-up feels like the band pushing harder.
      this.bpm += (target.bpm - this.bpm) * 0.04;
      if (this.step % 16 === 0) {
        // New layers and key changes land on the downbeat.
        this.tier = target.tier;
        this.zone = target.zone;
      }
      this.playStep(this.step, this.nextTime);
      this.nextTime += 60 / this.bpm / 4;
      this.step++;
    }
  }

  private playStep(n: number, t: number) {
    const s = n % 16;
    const bar = Math.floor(n / 16);
    const tier = this.tier;
    const prog = PROGRESSIONS[this.zone % PROGRESSIONS.length];
    const [root, q] = prog[bar % 4];
    const key = KEYS[this.zone % KEYS.length];
    const tones = INTERVALS[q].map((i) => i + root + key);
    const dur16 = 60 / this.bpm / 4;
    const m = this.mood;
    const danger = m.scene === 'play' ? clamp01(m.danger) : 0;
    const combo = m.scene === 'play' && m.combo;

    // Pad: soft sustained chord, the only layer that's always there.
    if (s === 0) {
      const vol = tier >= 4 ? 0.018 : 0.03;
      for (const tone of tones) this.voice(t, midi(wrap(tone, 57)), dur16 * 16, 'triangle', vol, 0.25);
    }

    // Bass: from a heartbeat on the downbeat to a galloping 16th drive.
    const bassNote = midi(wrap(tones[0], 38));
    if (tier < 0 || tier === 0) {
      if (s === 0 || s === 10) this.voice(t, bassNote, dur16 * 5, 'triangle', 0.16, 0.01);
    } else if (tier <= 2) {
      if (s % 4 === 0 || (tier === 2 && s % 4 === 3)) this.voice(t, bassNote, dur16 * 1.6, 'triangle', 0.18, 0.005);
    } else if (tier === 3) {
      if (s % 2 === 0) this.voice(t, s % 4 === 2 ? bassNote * 2 : bassNote, dur16 * 1.4, 'square', 0.07, 0.005);
    } else if (s % 4 !== 1) {
      this.voice(t, s % 4 === 3 ? bassNote * 2 : bassNote, dur16 * 0.9, 'sawtooth', 0.075, 0.003);
    }

    // Arpeggio: chord tones cycling upward, faster and brighter as tiers rise.
    const arpEvery = tier >= 2 ? 1 : 2;
    if (s % arpEvery === 0) {
      const i = (s / arpEvery) % 4;
      const note = wrap(tones[i % 3], 69) + (i === 3 ? 12 : 0) + (tier >= 5 ? 12 : 0);
      const type: OscillatorType = tier >= 3 ? 'square' : 'sine';
      this.voice(t, midi(note), dur16 * (arpEvery === 2 ? 1.6 : 0.8), type, tier >= 3 ? 0.028 : 0.045, 0.004);
    }

    // Lead melody arrives at tier 3; at the top tier it becomes a frantic run.
    if (tier >= 3) {
      const motif = tier >= 5 && bar % 2 === 1 ? MOTIF_RUN : bar % 4 === 3 ? MOTIF_B : MOTIF_A;
      const idx = motif[s];
      if (idx >= 0) {
        let len = 1;
        while (s + len < 16 && motif[s + len] < 0 && len < 4) len++;
        const stack = [0, 1, 2].map((k) => wrap(tones[k], 72));
        stack.sort((a, b) => a - b);
        const note = stack[idx % 3] + 12 * Math.floor(idx / 3) - 12;
        this.voice(t, midi(note), dur16 * len * 0.9, tier >= 4 ? 'sawtooth' : 'square', 0.035, 0.005, true);
      }
    }

    // Drums.
    if (tier >= 1) {
      const kick = tier >= 4 ? s % 4 === 0 || (tier >= 5 && s === 14) : s === 0 || s === 8 || (tier >= 2 && s === 10);
      if (kick) this.kick(t);
    }
    const inFill = this.fill && s >= 12;
    if (tier >= 2 || inFill) {
      if (inFill || s === 4 || s === 12) this.snare(t, inFill ? 0.1 + (s - 12) * 0.03 : 0.16);
      if (!inFill && tier >= 5 && bar % 4 === 3 && s >= 12) this.snare(t, 0.1);
    }
    if (tier >= 2) {
      if (tier >= 4 && s % 4 === 2) this.hat(t, 0.05, 0.16);
      else if (tier >= 3 || s % 2 === 0) this.hat(t, s % 2 === 0 ? 0.045 : 0.025, 0.035);
    }
    if (s === 15 && this.fill) this.fill = false;
    if (s === 0 && bar % 8 === 0 && bar > 0 && tier >= 3) this.crash(t, 0.18);

    // Reward: a sparkle line rides on top while a combo is alive.
    if (combo && s % 2 === 1) {
      const i = ((s - 1) / 2) % 3;
      this.voice(t, midi(wrap(tones[i], 84)), dur16 * 0.8, 'sine', 0.03, 0.002);
    }

    // Stress: a heartbeat and a dissonant alarm swell as you slip toward the bottom.
    if (danger > 0.12) {
      if (s % 8 === 0 || s % 8 === 3) this.heartbeat(t, 0.2 + 0.3 * danger);
      if (s % 2 === 0) {
        const alarm = wrap(key, 81) + (s % 4 === 0 ? 0 : 1);
        this.voice(t, midi(alarm), dur16 * 0.7, 'square', 0.035 * danger, 0.002);
      }
    }
  }

  // ---- instruments --------------------------------------------------------------------------

  private voice(t: number, freq: number, dur: number, type: OscillatorType, vol: number, attack: number, vibrato = false) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (vibrato && dur > 0.2) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 6;
      depth.gain.value = freq * 0.012;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(t + 0.08);
      lfo.stop(t + dur + 0.05);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setTargetAtTime(0.0001, t + Math.max(attack, dur * 0.6), dur * 0.25);
    osc.connect(g).connect(this.bus!);
    osc.start(t);
    osc.stop(t + dur * 1.6 + 0.05);
  }

  private kick(t: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    osc.connect(g).connect(this.bus!);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  private hiss(t: number, dur: number, vol: number, type: BiquadFilterType, freq: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.bus!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  private snare(t: number, vol: number) {
    this.hiss(t, 0.14, vol, 'bandpass', 1900);
    this.voice(t, 185, 0.06, 'triangle', vol * 0.8, 0.001);
  }

  private hat(t: number, vol: number, dur: number) {
    this.hiss(t, dur, vol, 'highpass', 7500);
  }

  private crash(t: number, vol: number) {
    this.hiss(t, 1.3, vol, 'highpass', 4200);
  }

  private heartbeat(t: number, vol: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(70, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.15);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(g).connect(this.bus!);
    osc.start(t);
    osc.stop(t + 0.2);
  }
}
