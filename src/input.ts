import { INPUT_JUMP, INPUT_LEFT, INPUT_RIGHT } from './engine/constants';

// Keyboard + touch, folded into the same bitmask the engine and AI agents use.
export class Controls {
  private keys = new Set<string>();
  private touch = 0;
  onPause: (() => void) | null = null;

  constructor(private touchRoot: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
      if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) this.onPause?.();
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.touch = 0;
    });
    this.bindTouch();
  }

  private bindTouch() {
    const pads = this.touchRoot.querySelectorAll<HTMLElement>('[data-input]');
    const active = new Map<number, number>();
    const recompute = () => {
      this.touch = 0;
      for (const bit of active.values()) this.touch |= bit;
    };
    pads.forEach((pad) => {
      const bit = Number(pad.dataset.input);
      pad.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        pad.setPointerCapture(e.pointerId);
        active.set(e.pointerId, bit);
        pad.classList.add('down');
        recompute();
      });
      const up = (e: PointerEvent) => {
        active.delete(e.pointerId);
        pad.classList.remove('down');
        recompute();
      };
      pad.addEventListener('pointerup', up);
      pad.addEventListener('pointercancel', up);
    });
  }

  read(): number {
    const k = this.keys;
    let bits = this.touch;
    if (k.has('ArrowLeft') || k.has('KeyA')) bits |= INPUT_LEFT;
    if (k.has('ArrowRight') || k.has('KeyD')) bits |= INPUT_RIGHT;
    if (k.has('Space') || k.has('ArrowUp') || k.has('KeyW')) bits |= INPUT_JUMP;
    return bits;
  }

  anyKey(): boolean {
    return this.keys.size > 0;
  }
}
