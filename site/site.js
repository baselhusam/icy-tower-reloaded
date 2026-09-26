// Landing page for Icy Tower Reloaded. No dependencies, no build step.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Same palettes as src/render/theme.ts.
  const THEMES = [
    { name: 'Ice Cave', skyTop: '#0b1e3a', skyBottom: '#1d4f86', brick: '#1a3d6b', brickLine: '#10294a', wall: '#2a5d99', wallLine: '#183d6a', plat: '#5fa8e8', platTop: '#d9f2ff', accent: '#7fe3ff' },
    { name: 'Frozen Forest', skyTop: '#07251f', skyBottom: '#1c5a4a', brick: '#16463a', brickLine: '#0d2e26', wall: '#2c6b58', wallLine: '#194538', plat: '#58c2a0', platTop: '#dcfff2', accent: '#8dffcf' },
    { name: 'Aurora Heights', skyTop: '#140a33', skyBottom: '#3b1f73', brick: '#2b1a5a', brickLine: '#1a0f3b', wall: '#4b2e8e', wallLine: '#2e1b5e', plat: '#9b7dff', platTop: '#efe6ff', accent: '#c6a8ff' },
    { name: 'Crystal Spire', skyTop: '#2a0a2e', skyBottom: '#7a2a6e', brick: '#5a1f55', brickLine: '#3a1238', wall: '#8a3a7e', wallLine: '#5c2254', plat: '#ff8ad8', platTop: '#ffe8f7', accent: '#ffb3e6' },
    { name: 'Magma Frost', skyTop: '#2a0c05', skyBottom: '#8a2f12', brick: '#5e200c', brickLine: '#3d1407', wall: '#9a3a18', wallLine: '#62230d', plat: '#ff9d5c', platTop: '#fff0e0', accent: '#ffc27a' },
    { name: 'Starfield', skyTop: '#000008', skyBottom: '#101a3a', brick: '#0e1530', brickLine: '#070b1c', wall: '#1c2a55', wallLine: '#101a38', plat: '#e8e8ff', platTop: '#ffffff', accent: '#ffe27a' },
  ];

  const hexRgb = (h) => {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const mix = (a, b, t) => {
    const x = hexRgb(a);
    const y = hexRgb(b);
    return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
  };

  // ---------- Penguin sprite (same shapes as the canvas renderer) ----------
  const HATS = {
    none: () => '',
    beanie: (c) => `<path d="M-12 -12 Q-12 -27 0 -27 Q12 -27 12 -12 Z" fill="${c}"/><rect x="-13.5" y="-15" width="27" height="5" rx="2.5" fill="#fff" opacity=".85"/><circle cx="0" cy="-28.5" r="3.8" fill="#fff"/>`,
    party: () => `<path d="M-8 -15 L3 -35 L10 -15 Z" fill="#9b7dff"/><path d="M-5 -20 L7 -20 M-2 -26 L5 -26" stroke="#ffd24a" stroke-width="2.4"/><circle cx="3" cy="-35" r="3" fill="#ffd24a"/>`,
    crown: () => `<path d="M-11 -14 L-11 -27 L-5.5 -20 L0 -30 L5.5 -20 L11 -27 L11 -14 Z" fill="#ffd24a" stroke="#a86e12" stroke-width="1.2" stroke-linejoin="round"/><circle cx="0" cy="-19" r="2" fill="#ff4d6d"/>`,
    tophat: (c) => `<rect x="-13" y="-18" width="26" height="3.5" rx="1.5" fill="#101522"/><rect x="-8" y="-33" width="16" height="16" rx="1.5" fill="#101522"/><rect x="-8" y="-21.5" width="16" height="3.5" fill="${c}"/>`,
    office: (c) => `<path d="M2.5 -3.5 L7.5 -3.5 L8.8 8 L5 12 L1.2 8 Z" fill="${c}" stroke="rgba(0,0,0,.25)" stroke-width=".6"/><rect x="-7" y="-26" width="14" height="3" rx="1.5" fill="#1b2a4a"/><circle cx="-9" cy="-18" r="3.2" fill="#1b2a4a"/><circle cx="9" cy="-18" r="3.2" fill="#1b2a4a"/><path d="M-9 -18 Q-9 -26 0 -26 Q9 -26 9 -18" fill="none" stroke="#1b2a4a" stroke-width="2"/>`,
    antenna: () => `<path d="M-2 -17 L-4 -28" stroke="#9cc3e6" stroke-width="1.6" stroke-linecap="round"/><circle cx="-4" cy="-29.5" r="2.8" fill="#7fe3ff" style="animation: antenna 1.2s steps(1) infinite"/>`,
  };

  function penguin({ scarf = '#ff4d6d', body = '#1b2a4a', belly = '#f4f8ff', flipper = '#14203a', feet = '#ff9d2e', hat = 'none', visor = false, ghost = false } = {}) {
    if (ghost) {
      body = belly = flipper = feet = scarf = '#bfe8ff';
    }
    const eye = visor
      ? `<rect x="0.5" y="-15.5" width="14" height="6.5" rx="3.2" fill="#7fe3ff"/><rect x="3" y="-14" width="5" height="2" rx="1" fill="#fff"/>`
      : `<ellipse cx="6" cy="-12" rx="4.5" ry="5" fill="#fff"/><circle cx="7.5" cy="-12" r="2.2" fill="#0b1020"/>`;
    return `<svg viewBox="-30 -37 56 63" aria-hidden="true"${ghost ? ' style="opacity:.55"' : ''}>
      <ellipse cx="-6" cy="19" rx="6" ry="3" fill="${feet}"/><ellipse cx="7" cy="19" rx="6" ry="3" fill="${feet}"/>
      <ellipse cx="0" cy="1" rx="15" ry="19" fill="${body}"/>
      <ellipse cx="3" cy="5" rx="10" ry="13" fill="${belly}"${ghost ? ' opacity=".6"' : ''}/>
      <ellipse cx="-11" cy="4" rx="4" ry="10" fill="${flipper}" transform="rotate(12 -11 4)"/>
      <rect x="-13" y="-8" width="26" height="5" rx="1.5" fill="${scarf}"/>
      <path d="M-10 -7 L-25 -9 L-24 -2 L-9 -3 Z" fill="${scarf}"/>
      ${eye}
      <path d="M10 -8 L18 -6 L10 -4 Z" fill="${visor ? '#ffc27a' : feet}"/>
      ${ghost ? '' : HATS[hat](scarf)}
    </svg>`;
  }

  const CHARS = {
    pengu: {
      look: {},
      color: '#ff4d6d',
      role: 'Player one · you',
      name: 'Pengu',
      desc: 'The hero of the tower. Red scarf, orange feet, zero fear of heights. Earns XP every run, levels up, and remembers every personal best with a marker painted on the wall.',
      stats: { Speed: 72, Combos: 64, Nerve: 94 },
      quote: 'The floor is not lava. The bottom of the screen is.',
    },
    frosty: {
      look: { body: '#123a5c', belly: '#dff7ff', scarf: '#7fe3ff', visor: true, hat: 'antenna' },
      color: '#7fe3ff',
      role: 'The AI · lookahead planner',
      name: 'Frosty',
      desc: 'Every few ticks Frosty clones the game, simulates 90 short action plans and picks the one that ends up highest and safest. No training needed: the engine is deterministic and cheap to clone.',
      stats: { Speed: 96, Combos: 82, Consistency: 99 },
      quote: 'seed 8: floor 2574, score 84276. 600 s of game time in 8.5 s.',
    },
    ghost: {
      look: { ghost: true },
      color: '#bfe8ff',
      role: 'Daily Tower · your best run',
      name: 'Ghost',
      desc: "Your best Daily Tower run, replayed input for input. It climbs beside you on every retry, and the HUD tells you how many floors you're ahead or behind.",
      stats: { Memory: 100, Patience: 100, Mercy: 4 },
      quote: 'GHOST 9 (-2). Two floors behind yourself.',
    },
  };

  const fill = () =>
    $$('[data-peng]').forEach((el) => {
      el.innerHTML = penguin(CHARS[el.dataset.peng].look);
    });
  fill();

  // ---------- Scroll: the page is the tower ----------
  const root = document.documentElement;
  const altFloor = $('#alt-floor');
  const altZone = $('#alt-zone');
  const altFill = $('#alt-fill');
  const altPeng = $('#alt-peng');
  altPeng.innerHTML = penguin();
  const TOP_FLOOR = 320;
  let ticking = false;
  // Each section is pinned to the floor in its eyebrow; the altimeter interpolates between them.
  let anchors = [];
  function measure() {
    const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    anchors = [[0, 0]];
    $$('[data-floor]').forEach((s) => {
      const y = Math.min(max, s.getBoundingClientRect().top + scrollY - 90);
      if (y > anchors[anchors.length - 1][0]) anchors.push([y, +s.dataset.floor]);
    });
    anchors.push([max + 1, TOP_FLOOR]);
  }
  function floorAt(y) {
    for (let k = 1; k < anchors.length; k++) {
      const [y0, f0] = anchors[k - 1];
      const [y1, f1] = anchors[k];
      if (y <= y1) return f0 + ((f1 - f0) * Math.max(0, y - y0)) / (y1 - y0);
    }
    return TOP_FLOOR;
  }

  function onScroll() {
    ticking = false;
    const f = floorAt(scrollY);
    const zf = Math.min(THEMES.length - 1, f / 50);
    const i = Math.floor(zf);
    const j = Math.min(THEMES.length - 1, i + 1);
    const into = zf - i;
    const t = into > 0.72 ? (into - 0.72) / 0.28 : 0; // hold, then cross-fade like the game does
    const a = THEMES[i];
    const b = THEMES[j];
    root.style.setProperty('--sky-top', mix(a.skyTop, b.skyTop, t));
    root.style.setProperty('--sky-bot', mix(a.skyBottom, b.skyBottom, t));
    root.style.setProperty('--accent', mix(a.accent, b.accent, t));
    altFloor.textContent = Math.round(f);
    altZone.textContent = a.name;
    altFill.style.height = `${(f / TOP_FLOOR) * 100}%`;
    altPeng.style.bottom = `${(f / TOP_FLOOR) * 100}%`;
  }
  addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(onScroll);
    }
  }, { passive: true });
  const remeasure = () => {
    measure();
    onScroll();
  };
  addEventListener('resize', remeasure);
  addEventListener('load', remeasure);
  new ResizeObserver(remeasure).observe(document.body);
  remeasure();

  // ---------- Snow ----------
  const snow = $('#snow');
  const sctx = snow.getContext('2d');
  let flakes = [];
  function sizeSnow() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    snow.width = innerWidth * dpr;
    snow.height = innerHeight * dpr;
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round(Math.min(90, innerWidth / 16));
    flakes = Array.from({ length: n }, () => ({
      x: Math.random() * innerWidth,
      y: Math.random() * innerHeight,
      r: 0.6 + Math.random() * 2.2,
      s: 0.25 + Math.random() * 0.8,
      w: Math.random() * Math.PI * 2,
    }));
  }
  let lastScroll = scrollY;
  function drawSnow() {
    const dy = scrollY - lastScroll;
    lastScroll = scrollY;
    sctx.clearRect(0, 0, innerWidth, innerHeight);
    sctx.fillStyle = 'rgba(233,251,255,0.75)';
    for (const f of flakes) {
      f.w += 0.01;
      f.y += f.s - dy * 0.25 * f.r; // a little parallax while climbing
      f.x += Math.sin(f.w) * 0.3;
      if (f.y > innerHeight + 4) f.y = -4;
      if (f.y < -4) f.y = innerHeight + 4;
      sctx.globalAlpha = 0.35 + f.r / 4;
      sctx.beginPath();
      sctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      sctx.fill();
    }
    requestAnimationFrame(drawSnow);
  }
  sizeSnow();
  addEventListener('resize', sizeSnow);
  if (!reduced) drawSnow();

  // ---------- Reveal on scroll + hero counters ----------
  const revealables = $$('.sec-head, .cast, .playground, .zones, .mode, .badges-wrap, .terminal, .agent, .t-panel, .tf, .t-cta, .roadmap li, .final');
  revealables.forEach((el, i) => {
    el.classList.add('reveal');
    el.style.transitionDelay = `${(i % 3) * 70}ms`;
  });
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      }),
    { threshold: 0.12 },
  );
  revealables.forEach((el) => io.observe(el));

  $$('[data-count]').forEach((el) => {
    const target = +el.dataset.count;
    const start = performance.now() + 900;
    const dur = 1400;
    const tick = (now) => {
      const k = Math.min(1, Math.max(0, (now - start) / dur));
      el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3))).toLocaleString();
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // ---------- Hero device ----------
  const overlay = $('#device-overlay');
  const frame = $('#game-frame');
  overlay.addEventListener('click', () => {
    overlay.classList.add('gone');
    frame.focus();
    try {
      frame.contentWindow.focus();
    } catch {}
  });

  // ---------- Cast ----------
  const castCard = $('#cast-card');
  const castFigure = $('#cast-figure');
  function showChar(id) {
    const c = CHARS[id];
    castCard.style.setProperty('--char', c.color);
    castFigure.innerHTML = penguin(c.look);
    castFigure.classList.remove('swap');
    void castFigure.offsetWidth;
    castFigure.classList.add('swap');
    setTimeout(() => castFigure.classList.remove('swap'), 500);
    $('#cast-role').textContent = c.role;
    $('#cast-name').textContent = c.name;
    $('#cast-desc').textContent = c.desc;
    $('#cast-quote').textContent = c.quote;
    const stats = $('#cast-stats');
    stats.innerHTML = Object.entries(c.stats)
      .map(([k]) => `<div><dt>${k}</dt><dd><i style="--v:0%"></i></dd></div>`)
      .join('');
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        $$('dd i', stats).forEach((el, i) => el.style.setProperty('--v', `${Object.values(c.stats)[i]}%`));
      }),
    );
    $$('.cast-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.char === id);
      t.setAttribute('aria-selected', t.dataset.char === id);
    });
  }
  $$('.cast-tab').forEach((t) => t.addEventListener('click', () => showChar(t.dataset.char)));
  showChar('pengu');

  // ---------- Wardrobe ----------
  const SCARVES = [
    ['Classic', '#ff4d6d'],
    ['Aurora', '#9b7dff'],
    ['Forest', '#58c2a0'],
    ['Magma', '#ff9d5c'],
    ['Gold', '#ffd24a'],
    ['Crystal', '#ff8ad8'],
    ['Glacier', '#7fe3ff'],
  ];
  const HAT_LIST = [
    ['none', 'None'],
    ['beanie', 'Beanie'],
    ['party', 'Party'],
    ['crown', 'Crown'],
    ['tophat', 'Top hat'],
    ['office', 'Office 🎧'],
  ];
  const look = { scarf: SCARVES[0][1], hat: 'none' };
  const wp = $('#wardrobe-peng');
  const renderLook = () => (wp.innerHTML = penguin(look));
  $('#scarves').innerHTML = SCARVES.map(([n, c], i) => `<button class="swatch${i ? '' : ' active'}" style="--c:${c}" data-c="${c}" title="${n}" aria-label="${n} scarf"></button>`).join('');
  $('#hats').innerHTML = HAT_LIST.map(([id, n], i) => `<button class="hat-btn${i ? '' : ' active'}" data-hat="${id}">${n}</button>`).join('');
  $('#scarves').addEventListener('click', (e) => {
    const b = e.target.closest('.swatch');
    if (!b) return;
    look.scarf = b.dataset.c;
    $$('.swatch').forEach((s) => s.classList.toggle('active', s === b));
    renderLook();
  });
  $('#hats').addEventListener('click', (e) => {
    const b = e.target.closest('.hat-btn');
    if (!b) return;
    look.hat = b.dataset.hat;
    $$('.hat-btn').forEach((s) => s.classList.toggle('active', s === b));
    renderLook();
  });
  renderLook();

  // ---------- Controls playground: a tiny version of the real physics ----------
  (() => {
    const stage = $('#pg-stage');
    const pengEl = $('#pg-peng');
    const pop = $('#pg-pop');
    const hint = $('#pg-hint');
    pengEl.innerHTML = `<div class="flip">${penguin()}</div>`;
    if (matchMedia('(pointer: coarse)').matches) hint.textContent = 'Hold the buttons below to run and jump';
    const flip = $('.flip', pengEl);
    const ground = document.createElement('div');
    ground.className = 'pg-floor';
    stage.appendChild(ground);

    const GROUND = 10;
    const WALL = 18;
    const R = 13;
    const PH = 14;
    const plats = $$('.pg-plat', stage).map((el) => ({ el, y: +getComputedStyle(el).getPropertyValue('--y'), gem: $('span', el) }));
    const input = { left: false, right: false, jump: false };
    const p = { x: 70, y: GROUND, vx: 0, vy: 0, grounded: true, level: 0, facing: 1, squash: 0 };
    let visible = false;
    let focusedIn = false;
    let acc = 0;
    let last = 0;
    let running = false;

    const RATINGS = [
      [4, 'BLIZZARD!'],
      [3, 'SLICK!'],
      [2, 'COOL!'],
    ];

    function say(text, x, y, color) {
      pop.textContent = text;
      pop.style.left = `${Math.max(90, Math.min(stage.clientWidth - 90, x))}px`;
      pop.style.bottom = `${y + 60}px`;
      pop.style.color = color || '';
      pop.classList.remove('show');
      void pop.offsetWidth;
      pop.classList.add('show');
    }

    function step() {
      const W = stage.clientWidth;
      const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      if (dir) {
        if (p.grounded && Math.sign(p.vx) === -dir) p.vx *= 0.6;
        p.vx += dir * (p.grounded ? 0.55 : 0.4);
        p.facing = dir;
      } else if (p.grounded) {
        p.vx *= 0.87;
      }
      if (!p.grounded) p.vx *= 0.99;
      p.vx = Math.max(-10, Math.min(10, p.vx));

      if (input.jump && p.grounded) {
        p.vy = 10 + 0.9 * Math.abs(p.vx);
        p.grounded = false;
      }

      const prevY = p.y;
      if (!p.grounded) p.vy = Math.max(-20, p.vy - 0.5);
      p.x += p.vx;
      p.y += p.vy;

      // Walls: bounce in mid-air, keep the speed.
      if (p.x - R < WALL || p.x + R > W - WALL) {
        p.x = Math.max(WALL + R, Math.min(W - WALL - R, p.x));
        if (!p.grounded && Math.abs(p.vx) > 3) {
          p.vx = -p.vx;
          p.facing = Math.sign(p.vx);
          say('BOUNCE!', p.x, p.y, '#8dffcf');
        } else {
          p.vx = 0;
        }
      }

      // Landing.
      if (p.vy <= 0) {
        let landed = null;
        let top = GROUND;
        if (p.y <= GROUND) landed = { level: 0 };
        plats.forEach((pl, i) => {
          const t = pl.y + PH;
          const l = pl.el.offsetLeft;
          const r = l + pl.el.offsetWidth;
          if (prevY >= t && p.y <= t && p.x + R * 0.6 > l && p.x - R * 0.6 < r && t >= top) {
            landed = { level: i + 1, pl };
            top = t;
          }
        });
        if (landed) {
          if (!p.grounded) p.squash = 1;
          p.y = top;
          p.vy = 0;
          p.grounded = true;
          const skipped = landed.level - p.level;
          if (skipped >= 2) {
            const r = RATINGS.find(([n]) => skipped >= n);
            say(r ? r[1] : 'NICE', p.x, p.y);
          }
          if (landed.pl?.gem && !landed.pl.gem.classList.contains('got')) {
            landed.pl.gem.classList.add('got');
            say('+25 💎', p.x, p.y, '#ffd24a');
            setTimeout(() => landed.pl.gem.classList.remove('got'), 2500);
          }
          p.level = landed.level;
        }
      }

      // Walked off an edge.
      if (p.grounded && p.y > GROUND) {
        const on = plats.some((pl) => {
          const l = pl.el.offsetLeft;
          const r = l + pl.el.offsetWidth;
          return Math.abs(pl.y + PH - p.y) < 0.5 && p.x + R * 0.6 > l && p.x - R * 0.6 < r;
        });
        if (!on) p.grounded = false;
      }
      p.squash *= 0.8;
    }

    function render() {
      const sq = p.squash * 0.25;
      const stretch = p.grounded ? 0 : Math.min(0.15, Math.abs(p.vy) / 80);
      pengEl.style.transform = `translate(${p.x - 22}px, ${-p.y + 2}px)`;
      flip.style.transform = `scale(${p.facing * (1 + sq - stretch * 0.5)}, ${1 - sq + stretch})`;
      flip.style.transformOrigin = '50% 100%';
      $('#m-speed').style.width = `${(Math.abs(p.vx) / 10) * 100}%`;
      $('#m-jump').style.width = `${((10 + 0.9 * Math.abs(p.vx)) / 19) * 100}%`;
    }

    function loop(now) {
      if (!visible) {
        running = false;
        return;
      }
      acc += Math.min(100, now - (last || now));
      last = now;
      while (acc >= 1000 / 60) {
        step();
        acc -= 1000 / 60;
      }
      render();
      requestAnimationFrame(loop);
    }

    new IntersectionObserver(([e]) => {
      visible = e.intersectionRatio > 0.35;
      if (visible && !running) {
        running = true;
        last = 0;
        requestAnimationFrame(loop);
      }
    }, { threshold: [0, 0.35, 0.6] }).observe(stage);

    const KEYS = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ' ': 'jump', ArrowUp: 'jump', w: 'jump', W: 'jump' };
    const keyBtn = (k) => $(`.key[data-key="${k}"]`);
    function set(k, on) {
      input[k] = on;
      keyBtn(k).classList.toggle('down', on);
      if (on) hint.classList.add('hide');
    }
    stage.addEventListener('focus', () => (focusedIn = true));
    stage.addEventListener('click', () => stage.focus({ preventScroll: true }));
    document.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('#controls')) focusedIn = false;
    });
    addEventListener('keydown', (e) => {
      const k = KEYS[e.key];
      if (!k || !visible) return;
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
      if (typing) return;
      // Arrow keys always drive the penguin while it is on screen; space only once you've clicked in,
      // so the page can still be scrolled with it.
      if (k === 'jump' && e.key === ' ' && !focusedIn) return;
      e.preventDefault();
      set(k, true);
    });
    addEventListener('keyup', (e) => {
      const k = KEYS[e.key];
      if (k) set(k, false);
    });
    $$('.key').forEach((b) => {
      const k = b.dataset.key;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture?.(e.pointerId);
        set(k, true);
      });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => b.addEventListener(ev, () => set(k, false)));
    });
    render();
  })();

  // ---------- Zones ----------
  const ZONES = [
    { floors: 'Floors 0 – 49', desc: 'Where every climb starts. Wide platforms and a gentle scroll, then your first springs at floor 25 and slippery ice from floor 40.', hz: [['normal', '▭ Normal'], ['spring', '🌀 Spring', 25], ['ice', '🧊 Ice', 40]] },
    { floors: 'Floors 50 – 99', desc: 'Pine green and a little narrower. Platforms start sliding from side to side at floor 60.', hz: [['ice', '🧊 Ice'], ['spring', '🌀 Spring'], ['moving', '↔ Moving', 60]] },
    { floors: 'Floors 100 – 149', desc: 'The sky lights up and the floor starts giving way. Crumbling platforms show up at floor 120.', hz: [['ice', '🧊 Ice'], ['moving', '↔ Moving'], ['crumble', '💥 Crumbling', 120]] },
    { floors: 'Floors 150 – 199', desc: 'Every hazard is in the mix now, and the platforms keep shrinking. Combos are the fastest way up.', hz: [['ice', '🧊 Ice'], ['moving', '↔ Moving'], ['crumble', '💥 Crumbling'], ['spring', '🌀 Spring']] },
    { floors: 'Floors 200 – 249', desc: 'Hot colours, cold platforms. By now the scroll is quick, so standing still is not an option.', hz: [['ice', '🧊 Ice'], ['moving', '↔ Moving'], ['crumble', '💥 Crumbling'], ['spring', '🌀 Spring']] },
    { floors: 'Floors 250 +', desc: 'Past the clouds. The zones loop from here, but the tower keeps getting harder all the way to floor 600.', hz: [['ice', '🧊 Ice'], ['moving', '↔ Moving'], ['crumble', '💥 Crumbling'], ['spring', '🌀 Spring']] },
  ];
  const tower = $('#zone-tower');
  tower.innerHTML = THEMES.map(
    (t, i) => `<li><button class="zone-btn" data-z="${i}" style="--zt:${t.skyTop};--zb:${t.skyBottom};--za:${t.accent}"><span class="zone-dot"></span><span><b>${t.name}</b><small>${ZONES[i].floors}</small></span></button></li>`,
  ).join('');
  const zview = $('#zone-view');
  const scene = $('#zone-scene');
  const LAYOUT = [
    [0.08, 0.34, 0.1],
    [0.52, 0.3, 0.28],
    [0.14, 0.3, 0.46],
    [0.58, 0.26, 0.64],
    [0.26, 0.28, 0.82],
  ];
  function showZone(i) {
    const t = THEMES[i];
    const z = ZONES[i];
    const vars = { '--zt': t.skyTop, '--zb': t.skyBottom, '--zw': t.wall, '--zwl': t.wallLine, '--zbl': t.brickLine, '--zp': t.plat, '--zpt': t.platTop, '--za': t.accent };
    Object.entries(vars).forEach(([k, v]) => zview.style.setProperty(k, v));
    const kinds = z.hz.map((h) => h[0]);
    const stars = i === 2 || i === 5 ? Array.from({ length: 28 }, (_, n) => `<i class="zstar" style="left:${(n * 37) % 100}%;top:${(n * 53) % 100}%;animation-delay:${(n % 7) * 0.3}s"></i>`).join('') : '';
    const platsHtml = LAYOUT.map(([x, w, y], n) => {
      const kind = n === 0 ? 'normal' : kinds[n % kinds.length];
      return `<div class="zp ${kind}" style="left:calc(26px + ${x * 100}% - ${x * 52}px);width:${w * 100}%;bottom:${y * 100}%;animation-delay:${n * 60}ms"></div>`;
    }).join('');
    const pl = LAYOUT[2];
    scene.innerHTML = `${stars}<div class="zbrick"></div><div class="zw" style="left:0"></div><div class="zw" style="right:0"></div><span class="zlabel">${t.name.toUpperCase()}</span>${platsHtml}<div class="zpeng" style="left:calc(26px + ${(pl[0] + pl[1] / 2) * 100}% - 40px);bottom:calc(${pl[2] * 100}% + 13px)">${penguin()}</div>`;
    $('#zone-floors').textContent = z.floors;
    $('#zone-name').textContent = t.name;
    $('#zone-desc').textContent = z.desc;
    $('#zone-hazards').innerHTML = z.hz.map(([, label, at]) => `<span class="hz${at ? ' new' : ''}">${label}${at ? ` <small>from ${at}</small>` : ''}</span>`).join('');
    $$('.zone-btn').forEach((b) => b.classList.toggle('active', +b.dataset.z === i));
  }
  tower.addEventListener('click', (e) => {
    const b = e.target.closest('.zone-btn');
    if (b) showZone(+b.dataset.z);
  });
  showZone(0);

  // ---------- Achievements (from src/meta/progress.ts) ----------
  const ACH = [
    ['👣', 'First Steps', 'Reach floor 25'],
    ['💯', 'Century', 'Reach floor 100'],
    ['🏙️', 'Skyscraper', 'Reach floor 250'],
    ['🚀', 'Stratosphere', 'Reach floor 500'],
    ['🛰️', 'Low Orbit', 'Reach floor 1000'],
    ['🔗', 'Chain Starter', 'Land a 10-floor combo'],
    ['🎨', 'Combo Artist', 'Land a 30-floor combo'],
    ['🌨️', 'Blizzard', 'Land a 75-floor combo'],
    ['🧊', 'Absolute Zero', 'Land a 150-floor combo'],
    ['🏓', 'Pinball', '25 wall bounces in one run'],
    ['💎', 'Gem Hoarder', 'Collect 40 gems in one run'],
    ['⚡', 'Power Hungry', 'Grab 5 power-ups in one run'],
    ['🏅', 'Five Digits', 'Score 10,000 in one run'],
    ['🏆', 'High Roller', 'Score 50,000 in one run'],
    ['⏱️', 'Hurry Up!', 'Survive to speed level 5'],
    ['🎖️', 'Veteran', 'Play 25 games'],
    ['🏃', 'Marathon', 'Climb 5,000 floors in total'],
    ['👑', 'Jeweler', 'Collect 500 gems in total'],
  ];
  const badges = $('#badges');
  badges.innerHTML = ACH.map(([ico, title], i) => `<button class="badge" data-i="${i}" title="${title}" aria-label="${title}">${ico}</button>`).join('');
  badges.addEventListener('click', (e) => {
    const b = e.target.closest('.badge');
    if (!b) return;
    const [, title, desc] = ACH[+b.dataset.i];
    $$('.badge').forEach((x) => x.classList.toggle('active', x === b));
    $('#badge-desc').innerHTML = `<b>${title}</b>${desc}`;
  });
  badges.children[8].click();

  // ---------- Terminal ----------
  const CMDS = [
    {
      tab: 'dev',
      cmd: 'npm run dev',
      out: [
        '<span class="d">&gt; icy-tower-reloaded@0.1.0 dev</span>',
        '<span class="d">&gt; vite</span>',
        '',
        '  <span class="ok">VITE v8.3.1</span>  ready in <span class="c">180 ms</span>',
        '',
        '  <span class="ok">➜</span>  <span class="c">Local:</span>   <span class="a">http://localhost:5173/</span>',
        '  <span class="d">➜  Network: use --host to expose</span>',
        '',
        '<span class="d"># open it and press Enter to climb</span>',
      ],
    },
    {
      tab: 'test',
      cmd: 'npm test',
      out: [
        '<span class="d">&gt; vitest run</span>',
        '',
        ' <span class="ok">✓</span> engine determinism <span class="d">(4)</span>',
        '   <span class="ok">✓</span> produces identical games from the same seed and inputs',
        '   <span class="ok">✓</span> clones are independent and continue identically',
        '   <span class="ok">✓</span> round-trips inputs through the replay encoder and re-verifies the score',
        '   <span class="ok">✓</span> ends the game when the player falls below the screen',
        '',
        ' <span class="d">Test Files</span>  <span class="ok">1 passed</span> (1)',
        '      <span class="d">Tests</span>  <span class="ok">4 passed</span> (4)',
      ],
    },
    {
      tab: 'bot',
      cmd: 'npm run bot -- 4 7',
      out: [
        '<span class="d">&gt; tsx scripts/bot.ts 4 7</span>',
        '',
        '<span class="a">seed 7:</span> floor <span class="g">2090</span>, score 69921, best combo 36 floors, 492s game time in 7.3s, replay 15136B <span class="ok">verified</span>',
        '<span class="a">seed 8:</span> floor <span class="g">2574</span>, score 84276, best combo 29 floors, 600s game time in 8.5s, replay 18419B <span class="ok">verified</span>',
        '',
        '<span class="d"># Frosty plays headless at ~70x real time,</span>',
        '<span class="d"># and every run is re-simulated to verify the score.</span>',
      ],
    },
    {
      tab: 'build',
      cmd: 'npm run build',
      out: [
        '<span class="d">&gt; tsc --noEmit &amp;&amp; vite build</span>',
        '',
        'vite v8.3.1 building client environment for production...',
        '<span class="ok">✓</span> 18 modules transformed.',
        '<span class="d">dist/</span>index.html                  <span class="c">8.74 kB</span> <span class="d">│ gzip:  2.83 kB</span>',
        '<span class="d">dist/</span><span class="a">assets/index.css</span>           <span class="c">17.01 kB</span> <span class="d">│ gzip:  4.55 kB</span>',
        '<span class="d">dist/</span><span class="a">assets/index.js</span>            <span class="c">59.47 kB</span> <span class="d">│ gzip: 22.29 kB</span>',
        '',
        '<span class="ok">✓ built in 139ms</span>  <span class="d"># the whole game, ~30 kB gzipped</span>',
      ],
    },
    {
      tab: 'console',
      cmd: 'icyTower.observe()',
      prompt: '›',
      out: [
        '{',
        '  tick: <span class="g">4312</span>, floor: <span class="g">137</span>, score: <span class="g">3918</span>,',
        '  player: { x: 212.4, y: 10960, vx: <span class="g">8.6</span>, vy: 12.1, grounded: <span class="k">false</span> },',
        '  combo: { active: <span class="ok">true</span>, floors: <span class="g">14</span>, jumps: 5, ticksLeft: 121 },',
        '  powerups: { rocket: 0, freeze: 0, magnet: <span class="g">312</span> },',
        '  platforms: [ { floor: 138, kind: <span class="ok">\'crumble\'</span>, … }, … ],',
        '  pickups: [ { kind: <span class="ok">\'gem\'</span>, x: 190, y: 11230 } ]',
        '}',
      ],
    },
  ];
  const tabs = $('#term-tabs');
  const body = $('#term-body');
  tabs.innerHTML = CMDS.map((c, i) => `<button class="term-tab" role="tab" data-i="${i}">${c.tab}</button>`).join('');
  let run = 0;
  let current = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));
  async function play(i) {
    const id = ++run;
    current = i;
    $$('.term-tab').forEach((t) => t.classList.toggle('active', +t.dataset.i === i));
    const c = CMDS[i];
    const prompt = `<span class="p">${c.prompt || '$'}</span> `;
    body.innerHTML = prompt + '<span class="cursor"></span>';
    let typed = '';
    for (const ch of c.cmd) {
      await sleep(38);
      if (id !== run) return;
      typed += ch;
      body.innerHTML = `${prompt}<span class="c">${typed}</span><span class="cursor"></span>`;
    }
    await sleep(260);
    let html = `${prompt}<span class="c">${typed}</span>\n`;
    for (const line of c.out) {
      await sleep(line ? 110 : 40);
      if (id !== run) return;
      html += line + '\n';
      body.innerHTML = html + '<span class="cursor"></span>';
    }
  }
  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('.term-tab');
    if (b) play(+b.dataset.i);
  });
  $('#term-copy').addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText(CMDS[current].cmd);
      e.target.textContent = 'Copied!';
    } catch {
      e.target.textContent = 'Press ⌘C';
    }
    setTimeout(() => (e.target.textContent = 'Copy'), 1400);
  });
  let termStarted = false;
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !termStarted) {
      termStarted = true;
      play(0);
    }
  }, { threshold: 0.3 }).observe(body);
  $$('.term-tab')[0].classList.add('active');

  // ---------- Teams: bracket preview ----------
  const DEPTS = [
    ['⚙️', 'Engineering', '#7fe3ff'],
    ['📣', 'Marketing', '#ff8ad8'],
    ['🎨', 'Design', '#9b7dff'],
    ['🎧', 'Support', '#58c2a0'],
    ['📈', 'Sales', '#ffd24a'],
    ['⚖️', 'Legal', '#e8e8ff'],
    ['💰', 'Finance', '#8dffcf'],
    ['🌱', 'People', '#ff9d5c'],
  ];
  const ROUND_NAMES = ['Quarterfinals', 'Semifinals', 'Final'];
  let rounds;
  function resetBracket() {
    rounds = [DEPTS.map((_, i) => ({ d: i, score: null })), Array(4).fill(null), Array(2).fill(null)];
    renderBracket();
    $('#bracket-play').textContent = 'Play round ▶';
    $('#bracket-foot').textContent = '8 departments · one shared seed per round · best of 3 runs';
  }
  const played = (r) => r.every((s) => s && s.score != null);
  function renderBracket() {
    const slot = (s, pairWinner) => {
      if (!s) return '<div class="slot tbd"><span class="nm">TBD</span><span class="sc">–</span></div>';
      const [ico, name] = DEPTS[s.d];
      const cls = s.score == null ? '' : pairWinner === s ? ' win' : ' lose';
      return `<div class="slot${cls}"><span class="nm">${ico} ${name}</span><span class="sc">${s.score == null ? '–' : `F${s.score}`}</span></div>`;
    };
    const cols = rounds.map((r, ri) => {
      const matches = [];
      for (let m = 0; m < r.length; m += 2) {
        const a = r[m];
        const b = r[m + 1];
        const w = a && b && a.score != null && b.score != null ? (a.score >= b.score ? a : b) : null;
        matches.push(`<div class="match">${slot(a, w)}${slot(b, w)}</div>`);
      }
      return `<div class="round"><span class="round-title">${ROUND_NAMES[ri]}</span><div class="round-m">${matches.join('')}</div></div>`;
    });
    const fin = rounds[2];
    const champ = played(fin) ? (fin[0].score >= fin[1].score ? fin[0] : fin[1]) : null;
    cols.push(`<div class="champion${champ ? ' won' : ''}"><span class="trophy">🏆</span><b>${champ ? DEPTS[champ.d][1] : 'Champion'}</b><small>${champ ? `Floor ${champ.score}` : 'Friday 17:00'}</small></div>`);
    $('#bracket').innerHTML = cols.join('');
  }
  function playRound() {
    const ri = rounds.findIndex((r) => !played(r));
    if (ri === -1) return resetBracket();
    const r = rounds[ri];
    r.forEach((s) => (s.score = 90 + Math.floor(Math.random() * 260) + ri * 40));
    const winners = [];
    let upset = null;
    for (let m = 0; m < r.length; m += 2) {
      const [a, b] = [r[m], r[m + 1]];
      const w = a.score >= b.score ? a : b;
      const l = w === a ? b : a;
      winners.push({ d: w.d, score: null });
      if (!upset || w.score - l.score < upset.gap) upset = { w, l, gap: w.score - l.score };
    }
    if (ri < 2) rounds[ri + 1] = winners;
    renderBracket();
    const foot = $('#bracket-foot');
    if (ri === 2) {
      const champ = r[0].score >= r[1].score ? r[0] : r[1];
      foot.textContent = `🏆 ${DEPTS[champ.d][1]} take the Frost Cup at floor ${champ.score}. Posted to #general.`;
      $('#bracket-play').textContent = 'Reset ↺';
    } else {
      foot.textContent = `${ROUND_NAMES[ri]} done · closest match: ${DEPTS[upset.w.d][1]} beat ${DEPTS[upset.l.d][1]} by ${upset.gap} floor${upset.gap === 1 ? '' : 's'}`;
    }
  }
  $('#bracket-play').addEventListener('click', playRound);
  resetBracket();

  // ---------- Teams: live company leaderboard ----------
  const PEOPLE = [
    ['Maya R.', 0, 412],
    ['Omar K.', 4, 388],
    ['Lina S.', 2, 351],
    ['Jonas P.', 3, 327],
    ['Priya N.', 1, 298],
    ['Sam T.', 6, 264],
    ['Hana M.', 7, 231],
  ].map(([name, dept, floor]) => ({ name, dept, floor, el: null }));
  const lboard = $('#lboard');
  PEOPLE.forEach((p) => {
    const li = document.createElement('li');
    li.className = 'lrow';
    const [ico, dname, color] = DEPTS[p.dept];
    li.innerHTML = `<span class="lrank"></span><span class="lav">${penguin({ scarf: color, hat: 'office' })}</span><span class="lname"><b>${p.name}</b><small>${ico} ${dname}</small></span><span class="lscore"></span>`;
    p.el = li;
    lboard.appendChild(li);
  });
  const score = (f) => (f * 10 + Math.round(f * f * 0.21)).toLocaleString();
  function layoutBoard(animate) {
    const before = new Map(PEOPLE.map((p) => [p, p.el.getBoundingClientRect().top]));
    PEOPLE.sort((a, b) => b.floor - a.floor);
    PEOPLE.forEach((p, i) => {
      lboard.appendChild(p.el);
      $('.lrank', p.el).textContent = i + 1;
      $('.lscore', p.el).innerHTML = `${score(p.floor)}<small>floor ${p.floor}</small>`;
    });
    if (!animate || reduced) return;
    PEOPLE.forEach((p) => {
      const dy = before.get(p) - p.el.getBoundingClientRect().top;
      if (!dy) return;
      p.el.style.transition = 'none';
      p.el.style.transform = `translateY(${dy}px)`;
      requestAnimationFrame(() => {
        p.el.style.transition = '';
        p.el.style.transform = '';
      });
    });
  }
  layoutBoard(false);
  let boardVisible = false;
  new IntersectionObserver(([e]) => (boardVisible = e.isIntersecting), { threshold: 0.2 }).observe(lboard);
  setInterval(() => {
    if (!boardVisible || document.hidden) return;
    const lowerHalf = PEOPLE.slice(2);
    const p = Math.random() < 0.7 ? lowerHalf[Math.floor(Math.random() * lowerHalf.length)] : PEOPLE[Math.floor(Math.random() * PEOPLE.length)];
    p.floor += 12 + Math.floor(Math.random() * 60);
    p.el.classList.add('bump');
    setTimeout(() => p.el.classList.remove('bump'), 900);
    layoutBoard(true);
  }, 2200);
})();
