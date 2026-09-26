// Tiny synthesized sound effects, so the game ships with zero audio assets.
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  private ensure(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.35;
        this.master.connect(this.ctx.destination);
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  unlock() {
    this.ensure();
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.25, slideTo?: number, delay = 0) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  jump(power: number) {
    const f = 260 + power * 14;
    this.tone(f, 0.12, 'square', 0.12, f * 1.8);
  }
  land() {
    this.tone(140, 0.06, 'triangle', 0.18, 90);
  }
  wall() {
    this.tone(520, 0.05, 'square', 0.1, 380);
  }
  combo(floors: number) {
    const f = 400 + Math.min(floors, 120) * 8;
    this.tone(f, 0.08, 'sine', 0.18, f * 1.25);
  }
  comboEnd(floors: number) {
    const notes = floors >= 45 ? [523, 659, 784, 1047, 1319] : floors >= 15 ? [523, 659, 784, 1047] : [523, 784];
    notes.forEach((n, i) => this.tone(n, 0.16, 'square', 0.12, undefined, i * 0.07));
  }
  comboBreak() {
    this.tone(300, 0.2, 'sawtooth', 0.08, 120);
  }
  gem() {
    this.tone(1320, 0.06, 'sine', 0.14);
    this.tone(1760, 0.1, 'sine', 0.12, undefined, 0.05);
  }
  powerup() {
    [660, 880, 1100, 1320].forEach((n, i) => this.tone(n, 0.09, 'triangle', 0.16, undefined, i * 0.05));
  }
  spring() {
    this.tone(200, 0.3, 'sine', 0.2, 900);
  }
  crumble() {
    this.tone(90, 0.25, 'sawtooth', 0.1, 50);
  }
  speedUp() {
    [880, 660, 880, 660].forEach((n, i) => this.tone(n, 0.1, 'square', 0.1, undefined, i * 0.12));
  }
  milestone() {
    [523, 659, 784, 1047, 784, 1047].forEach((n, i) => this.tone(n, 0.14, 'triangle', 0.16, undefined, i * 0.09));
  }
  gameOver() {
    [440, 370, 311, 220].forEach((n, i) => this.tone(n, 0.25, 'triangle', 0.18, undefined, i * 0.16));
  }
  achievement() {
    [784, 988, 1175, 1568].forEach((n, i) => this.tone(n, 0.12, 'sine', 0.16, undefined, i * 0.08));
  }
}
