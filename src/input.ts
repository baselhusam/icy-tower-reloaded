import { INPUT_JUMP, INPUT_LEFT, INPUT_RIGHT } from './engine/constants';

/** A thumb has to slide this far (CSS px) from where it landed before the climber runs. */
const STICK_DEAD = 8;
/** The stick's centre trails the thumb so it never sits more than this far away; turning around
 *  is then always a short slide back, however far the thumb has wandered. */
const STICK_REACH = 26;
/** A tap on the jump side counts for this long, so quick taps and taps just before landing work. */
const JUMP_BUFFER_MS = 130;

/** Keeps a thumb's events coming to its zone even when it slides across the middle. */
function capture(el: HTMLElement, pointerId: number) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    /* the pointer is already gone */
  }
}

// Keyboard + touch, folded into the same bitmask the engine and AI agents use.
//
// Touch: the left half of the screen is a floating stick (put a thumb down anywhere and slide
// left/right), the right half is one big jump button. No need to look at your thumbs.
export class Controls {
  private keys = new Set<string>();
  private stickBits = 0;
  private jumpTouches = 0;
  private jumpUntil = 0;
  onPause: (() => void) | null = null;
  /** Fired on the first touch of a run, to fade out the "how to" hints. */
  onTouch: (() => void) | null = null;

  constructor(private touchRoot: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
      if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) this.onPause?.();
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.release());
    this.bindTouch();
  }

  /** Lets go of everything, e.g. when a run starts or the game pauses. */
  release() {
    this.keys.clear();
    this.stickBits = 0;
    this.jumpTouches = 0;
    this.jumpUntil = 0;
    this.touchRoot.querySelectorAll('.down').forEach((el) => el.classList.remove('down'));
  }

  private bindTouch() {
    const stickZone = this.touchRoot.querySelector<HTMLElement>('.zone.stick')!;
    const jumpZone = this.touchRoot.querySelector<HTMLElement>('.zone.jump')!;
    const ring = stickZone.querySelector<HTMLElement>('.stick-ring')!;
    const knob = stickZone.querySelector<HTMLElement>('.stick-knob')!;
    let stick: { id: number; cx: number } | null = null;

    const place = (x: number, y: number) => {
      const r = stickZone.getBoundingClientRect();
      stickZone.style.setProperty('--x', `${x - r.left}px`);
      stickZone.style.setProperty('--y', `${y - r.top}px`);
    };
    const steer = (x: number) => {
      if (!stick) return;
      const dx = x - stick.cx;
      if (dx > STICK_REACH) stick.cx = x - STICK_REACH;
      if (dx < -STICK_REACH) stick.cx = x + STICK_REACH;
      const d = x - stick.cx;
      this.stickBits = d > STICK_DEAD ? INPUT_RIGHT : d < -STICK_DEAD ? INPUT_LEFT : 0;
      knob.style.setProperty('--dx', `${d}px`);
      ring.dataset.dir = this.stickBits === INPUT_RIGHT ? 'right' : this.stickBits === INPUT_LEFT ? 'left' : '';
    };

    stickZone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (stick) return; // one thumb steers
      capture(stickZone, e.pointerId);
      stick = { id: e.pointerId, cx: e.clientX };
      place(e.clientX, e.clientY);
      stickZone.classList.add('down');
      steer(e.clientX);
      this.onTouch?.();
    });
    stickZone.addEventListener('pointermove', (e) => {
      if (stick?.id === e.pointerId) steer(e.clientX);
    });
    const stickUp = (e: PointerEvent) => {
      if (stick?.id !== e.pointerId) return;
      stick = null;
      this.stickBits = 0;
      stickZone.classList.remove('down');
      knob.style.setProperty('--dx', '0px');
      ring.dataset.dir = '';
      stickZone.style.removeProperty('--x'); // back to its resting spot
      stickZone.style.removeProperty('--y');
    };
    stickZone.addEventListener('pointerup', stickUp);
    stickZone.addEventListener('pointercancel', stickUp);

    jumpZone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      capture(jumpZone, e.pointerId);
      this.jumpTouches++;
      this.jumpUntil = performance.now() + JUMP_BUFFER_MS;
      jumpZone.classList.add('down');
      this.onTouch?.();
    });
    const jumpUp = () => {
      this.jumpTouches = Math.max(0, this.jumpTouches - 1);
      if (!this.jumpTouches) jumpZone.classList.remove('down');
    };
    jumpZone.addEventListener('pointerup', jumpUp);
    jumpZone.addEventListener('pointercancel', jumpUp);
  }

  read(): number {
    const k = this.keys;
    let bits = this.stickBits;
    if (this.jumpTouches > 0 || performance.now() < this.jumpUntil) bits |= INPUT_JUMP;
    if (k.has('ArrowLeft') || k.has('KeyA')) bits |= INPUT_LEFT;
    if (k.has('ArrowRight') || k.has('KeyD')) bits |= INPUT_RIGHT;
    if (k.has('Space') || k.has('ArrowUp') || k.has('KeyW')) bits |= INPUT_JUMP;
    return bits;
  }

  anyKey(): boolean {
    return this.keys.size > 0;
  }
}
