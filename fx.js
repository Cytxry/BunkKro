/* BunkKro's little moments of motion: a pop, a floating emoji, a confetti burst, a soft entrance.
 * Small and quick, always optional: nothing happens with "reduce motion" on, and nothing depends on it finishing.
 */
(function () {
  'use strict';
  const still = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const COLORS = ['--st1', '--st2', '--st3', '--st4', '--st5', '--st6', '--st7', '--st8'];
  const color = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#6574BE';

  // a quick bounce of an element (a button just pressed, a card just saved)
  function pop(el, scale = 1.06) {
    if (!el || still() || !el.animate) return;
    el.animate([{ transform: 'scale(1)' }, { transform: `scale(${scale})`, offset: 0.4 },
                { transform: 'scale(.98)', offset: 0.75 }, { transform: 'scale(1)' }],
               { duration: 360, easing: 'ease-out' });
  }

  // an emoji that rises from an element and fades (✨ present, 💤 absent, 🔥 streak ...)
  function float(el, emoji, x = 0.5) {
    if (!el || still() || !document.body.animate) return;
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    const s = document.createElement('span');
    s.className = 'fx-float';
    s.textContent = emoji;
    s.style.left = `${r.left + r.width * x}px`;
    s.style.top = `${r.top}px`;
    document.body.appendChild(s);
    const done = () => s.remove();
    s.animate([{ transform: 'translate(-50%, 0) scale(.6)', opacity: 0 },
               { transform: 'translate(-50%, -18px) scale(1.15)', opacity: 1, offset: 0.35 },
               { transform: 'translate(-50%, -40px) scale(.9)', opacity: 0 }],
              { duration: 900, easing: 'ease-out' }).finished.then(done, done);
    setTimeout(done, 1300);
  }

  // a small burst of coloured dots from an element (a timetable confirmed)
  function confetti(el, n = 16) {
    if (!el || still() || !document.body.animate) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    for (let i = 0; i < n; i++) {
      const d = document.createElement('span');
      d.className = 'fx-dot';
      d.style.left = `${cx}px`;
      d.style.top = `${cy}px`;
      d.style.background = color(COLORS[i % COLORS.length]);
      if (i % 3 === 0) d.style.borderRadius = '2px';
      document.body.appendChild(d);
      const a = (Math.PI * 2 * i) / n + (i % 2 ? 0.25 : -0.15);
      const dist = 46 + (i * 37) % 40;
      const dx = Math.cos(a) * dist, dy = Math.sin(a) * dist - 18;
      const done = () => d.remove();
      d.animate([{ transform: 'translate(-50%, -50%) scale(.4)', opacity: 1 },
                 { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1) rotate(${i * 40}deg)`, opacity: 1, offset: 0.6 },
                 { transform: `translate(calc(-50% + ${dx * 1.1}px), calc(-50% + ${dy + 30}px)) scale(.8) rotate(${i * 70}deg)`, opacity: 0 }],
                { duration: 900 + (i % 4) * 60, easing: 'cubic-bezier(.2,.8,.3,1)' }).finished.then(done, done);
      setTimeout(done, 1400);
    }
  }

  // things that just appeared (new subjects in the sidebar) slide in one after another
  function stagger(els) {
    if (still()) return;
    els.filter(Boolean).forEach((el, i) => el.animate && el.animate(
      [{ opacity: 0, transform: 'translateX(-10px)' }, { opacity: 1, transform: 'none' }],
      { duration: 320, delay: i * 60, easing: 'cubic-bezier(.2,.85,.25,1)', fill: 'backwards' }));
  }

  window.BunkFx = { pop, float, confetti, stagger };
})();
