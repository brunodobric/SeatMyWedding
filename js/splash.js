/**
 * Opening screen. The emblem animation itself is CSS (#splash in app.css);
 * this decides when it ends: once the intro has played and the app is ready,
 * the emblem flies into the header monogram and the screen fades away.
 * A tap skips the rest of the intro.
 */

const splash = {
  HOLD_MS: 200,        // a moment to see the finished emblem before it leaves
  EXIT_MS: 600,
  appReady: false,
  introDone: false,
  leaving: false,

  setup() {
    const el = document.getElementById('splash');
    if (!el) return;
    if (document.documentElement.classList.contains('no-splash')) { el.remove(); return; }
    try { sessionStorage.setItem('splashSeen', '1'); } catch (e) {}
    const finishIntro = () => { if (!this.introDone) { this.introDone = true; this.maybeLeave(); } };
    // The subtitle is the last part of the intro to settle.
    el.addEventListener('animationend', e => {
      if (e.target.classList.contains('sp-sub')) setTimeout(finishIntro, this.HOLD_MS);
    });
    el.addEventListener('pointerdown', finishIntro);
    // Reduced motion has no intro animation; also a fallback if an event is missed.
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(finishIntro, reduce ? 800 : 2600);
  },

  // Called by the app once the first screen is rendered.
  ready() {
    this.appReady = true;
    this.maybeLeave();
  },

  maybeLeave() {
    const el = document.getElementById('splash');
    if (!el || this.leaving || !this.appReady || !this.introDone) return;
    this.leaving = true;
    this.leave(el);
  },

  leave(el) {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reduce ? 300 : this.EXIT_MS;
    const done = () => el.remove();
    if (!el.animate) { done(); return; }
    const opts = { duration, easing: 'cubic-bezier(.55, 0, .3, 1)', fill: 'forwards' };
    el.style.pointerEvents = 'none';

    const emblem = el.querySelector('.sp-emblem');
    const target = document.querySelector('.header-monogram');
    const to = target && target.getBoundingClientRect();
    if (!reduce && emblem && to && to.width) {
      // The rings fill about 80% of the emblem's width; land them on the monogram.
      const from = emblem.getBoundingClientRect();
      const scale = (to.width * 1.1) / (from.width * 0.8);
      const dx = (to.left + to.width / 2) - (from.left + from.width / 2);
      // The rings sit at 60% of the emblem's height; scaling is about its centre.
      const dy = (to.top + to.height / 2) - (from.top + from.height / 2) - from.height * 0.1 * scale;
      emblem.animate([
        { transform: 'none', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 1, offset: 0.8 },
        { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0 }
      ], opts);
      target.animate([
        { transform: 'scale(1)' }, { transform: 'scale(1)', offset: 0.75 },
        { transform: 'scale(1.18)', offset: 0.88 }, { transform: 'scale(1)' }
      ], { duration: duration + 250, easing: 'ease-out' });
      el.querySelectorAll('.sp-title, .sp-sub').forEach(t => t.animate(
        [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-12px)' }],
        { ...opts, duration: duration * 0.6 }
      ));
    } else {
      el.querySelector('.sp-inner').animate([{ opacity: 1 }, { opacity: 0 }], opts);
    }
    el.querySelector('.sp-bg').animate([{ opacity: 1 }, { opacity: 0 }], { ...opts, delay: reduce ? 0 : duration * 0.25, duration: duration * (reduce ? 1 : 0.75) })
      .finished.then(done, done);
  }
};

splash.setup();
