/* A clock-face time picker for every <input type="time" data-clock> on the page.
 *
 * The input keeps its id and its value ('HH:MM', 24-hour, '' when empty), so the code that reads and writes it is
 * unchanged. It is shown as a tappable field ("9:30 AM"); tapping it opens a dial: pick the hour (tap or drag), then
 * it turns to minutes; AM / PM beside it. Keyboard: arrows change the current hand, Enter sets, Esc cancels.
 */
(function () {
  'use strict';
  const pad = n => String(n).padStart(2, '0');
  const parse = v => { const m = /^(\d{1,2}):(\d{2})$/.exec(v || ''); return m ? { h: +m[1] % 24, m: +m[2] % 60 } : null; };
  const label = v => { const t = parse(v); if (!t) return ''; const h12 = t.h % 12 || 12; return `${h12}:${pad(t.m)} ${t.h < 12 ? 'AM' : 'PM'}`; };
  const still = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  let pop = null;

  function enhance(input) {
    if (input.dataset.clockReady) return;
    input.dataset.clockReady = '1';
    const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    input.type = 'text';
    input.readOnly = true;
    input.inputMode = 'none';
    input.classList.add('clock-field');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('aria-haspopup', 'dialog');
    const face = document.createElement('span');
    face.className = 'clock-face-text';
    input.insertAdjacentElement('afterend', face);
    const wrap = document.createElement('span');
    wrap.className = 'clock-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.append(input, face);
    let raw = '';
    const show = () => { face.textContent = label(raw) || '--:--'; face.classList.toggle('empty', !raw); };
    // the page sets .value ('09:30' / '') and reads it back: keep the 24-hour value, show the friendly one
    Object.defineProperty(input, 'value', {
      configurable: true,
      get() { return raw; },
      set(v) { const t = parse(String(v || '').trim()); raw = t ? `${pad(t.h)}:${pad(t.m)}` : ''; proto.set.call(this, raw); show(); }
    });
    input.value = proto.get.call(input);
    const open = e => { e.preventDefault(); openDial(input); };
    input.addEventListener('click', open);
    face.addEventListener('click', open);
    input.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') open(e); });
  }

  function openDial(input) {
    close();
    const t = parse(input.value) || { h: 9, m: 0 };
    const st = { h: t.h, m: t.m, mode: 'h', had: !!input.value };
    const el = document.createElement('div');
    el.className = 'clock-pop';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Pick a time');
    el.tabIndex = -1;
    el.innerHTML = `
      <div class="clock-head">
        <button type="button" class="clock-seg" data-mode="h" aria-label="Hour"></button><span class="clock-colon">:</span>
        <button type="button" class="clock-seg" data-mode="m" aria-label="Minutes"></button>
        <span class="clock-ampm" role="group" aria-label="AM or PM">
          <button type="button" data-ap="am">AM</button><button type="button" data-ap="pm">PM</button>
        </span>
      </div>
      <div class="clock-dial-wrap">
        <svg class="clock-dial" viewBox="0 0 220 220" aria-hidden="true">
          <circle cx="110" cy="110" r="104" class="clock-bg"/>
          <line class="clock-hand" x1="110" y1="110" x2="110" y2="30"/>
          <circle class="clock-knob" cx="110" cy="30" r="18"/>
          <circle cx="110" cy="110" r="4" class="clock-pin"/>
          <g class="clock-nums"></g>
        </svg>
      </div>
      <div class="clock-hint"></div>
      <div class="clock-btns">
        <button type="button" class="aic-link" data-act="clear">Clear</button>
        <span style="flex:1"></span>
        <button type="button" class="btn-sec btn-sm" data-act="cancel">Cancel</button>
        <button type="button" class="btn-pri btn-sm" data-act="set">Set</button>
      </div>`;
    document.body.appendChild(el);
    const svg = el.querySelector('.clock-dial'), nums = el.querySelector('.clock-nums');
    const hand = el.querySelector('.clock-hand'), knob = el.querySelector('.clock-knob');

    const draw = () => {
      const h12 = st.h % 12 || 12;
      el.querySelector('[data-mode="h"]').textContent = h12;
      el.querySelector('[data-mode="m"]').textContent = pad(st.m);
      el.querySelectorAll('.clock-seg').forEach(b => b.classList.toggle('on', b.dataset.mode === st.mode));
      el.querySelector('[data-ap="am"]').classList.toggle('on', st.h < 12);
      el.querySelector('[data-ap="pm"]').classList.toggle('on', st.h >= 12);
      el.querySelector('.clock-hint').textContent = st.mode === 'h' ? 'Pick the hour' : 'Now the minutes';
      const items = st.mode === 'h' ? [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
      nums.innerHTML = items.map((v, k) => {
        const a = (k / 12) * Math.PI * 2, x = 110 + Math.sin(a) * 82, y = 110 - Math.cos(a) * 82;
        const on = st.mode === 'h' ? v === h12 : v === st.m;
        return `<text x="${x.toFixed(1)}" y="${(y + 5).toFixed(1)}" class="${on ? 'on' : ''}">${st.mode === 'h' ? v : pad(v)}</text>`;
      }).join('');
      const frac = st.mode === 'h' ? (h12 % 12) / 12 : st.m / 60;
      const a = frac * Math.PI * 2, x = 110 + Math.sin(a) * 82, y = 110 - Math.cos(a) * 82;
      hand.setAttribute('x2', x.toFixed(1)); hand.setAttribute('y2', y.toFixed(1));
      knob.setAttribute('cx', x.toFixed(1)); knob.setAttribute('cy', y.toFixed(1));
      knob.classList.toggle('between', st.mode === 'm' && st.m % 5 !== 0);
    };
    const setMode = mode => {
      st.mode = mode;
      if (!still()) svg.animate([{ opacity: 0.4, transform: 'scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'ease-out' });
      draw();
    };
    const fromPoint = (e, snap) => {
      const r = svg.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      let a = Math.atan2(dx, -dy); if (a < 0) a += Math.PI * 2;
      if (st.mode === 'h') {
        let h = Math.round((a / (Math.PI * 2)) * 12) % 12;            // 0 = 12 o'clock
        st.h = (st.h >= 12 ? 12 : 0) + h;
      } else {
        let m = Math.round((a / (Math.PI * 2)) * 60) % 60;
        if (snap) m = Math.round(m / 5) * 5 % 60;
        st.m = m;
      }
      draw();
    };
    let dragging = false, moved = false;
    svg.addEventListener('pointerdown', e => { dragging = true; moved = false; svg.setPointerCapture(e.pointerId); fromPoint(e, true); });
    svg.addEventListener('pointermove', e => { if (dragging) { moved = true; fromPoint(e, false); } });
    svg.addEventListener('pointerup', e => {
      if (!dragging) return;
      dragging = false;
      fromPoint(e, !moved || st.mode === 'h');
      if (st.mode === 'h') setTimeout(() => setMode('m'), 160);
    });

    const done = keep => {
      if (keep === 'set') input.value = `${pad(st.h)}:${pad(st.m)}`;
      else if (keep === 'clear') input.value = '';
      if (keep) input.dispatchEvent(new Event('change', { bubbles: true }));
      close();
      input.focus({ preventScroll: true });
    };
    el.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.mode) setMode(b.dataset.mode);
      else if (b.dataset.ap) { st.h = (st.h % 12) + (b.dataset.ap === 'pm' ? 12 : 0); draw(); }
      else if (b.dataset.act === 'set') done('set');
      else if (b.dataset.act === 'clear') done('clear');
      else if (b.dataset.act === 'cancel') done(null);
    });
    el.addEventListener('keydown', e => {
      const step = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0;
      if (step) {
        e.preventDefault();
        if (st.mode === 'h') st.h = (st.h + step + 24) % 24; else st.m = (st.m + step * 5 + 60) % 60;
        draw();
      } else if (e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); if (st.mode === 'h') setMode('m'); else done('set'); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
    });
    const outside = e => { if (!el.contains(e.target) && e.target !== input && !input.parentNode.contains(e.target)) done(null); };
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);

    // under the field when it fits, above it otherwise; a bottom sheet on phones
    const place = () => {
      const r = input.parentNode.getBoundingClientRect(), W = innerWidth, H = innerHeight;
      if (W <= 640) { el.classList.add('sheet'); el.style.left = el.style.top = ''; return; }
      const w = el.offsetWidth, h = el.offsetHeight;
      const top = r.bottom + 8 + h < H ? r.bottom + 8 : Math.max(8, r.top - 8 - h);
      el.style.left = `${Math.max(8, Math.min(r.left, W - w - 8))}px`;
      el.style.top = `${top}px`;
    };
    pop = { el, outside, place };
    draw(); place();
    window.addEventListener('resize', place);
    el.focus({ preventScroll: true });
    if (!still()) el.animate([{ opacity: 0, transform: 'translateY(-4px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'ease-out' });
  }

  function close() {
    if (!pop) return;
    document.removeEventListener('pointerdown', pop.outside, true);
    window.removeEventListener('resize', pop.place);
    pop.el.remove();
    pop = null;
  }

  function init() { document.querySelectorAll('input[type="time"][data-clock]').forEach(enhance); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.BunkClock = { enhance, close };
})();
