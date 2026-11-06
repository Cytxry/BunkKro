/* Fairy, the guide cat: dims the page, spotlights one thing, and says what to do in a speech bubble.
 *
 *   BunkGuide.afterImport(newSubjects, { first })   after a timetable import
 *       first timetable ever: a congratulation (once per account); any import that made new subjects (replaced or
 *       added): "you're good to go", then the first new subject, its numbers, and the semester dates if missing.
 *       no new subjects: just a "you're good to go" toast.
 *   BunkGuide.nudge()                               on load: points at something the attendance maths needs and is
 *                                                   missing (the semester dates), at most once a day
 * Every tour can be skipped (Skip, Esc, or a tap on the dim area); nothing in the app waits on it.
 */
(function () {
  'use strict';
  const uid = () => (typeof currentUser !== 'undefined' && currentUser ? currentUser.id : 'guest');
  const flag = name => `bk_guide_${name}_${uid()}`;
  const get = name => { try { return localStorage.getItem(flag(name)); } catch (e) { return null; } };
  const set = (name, v) => { try { localStorage.setItem(flag(name), v); } catch (e) { /* private mode */ } };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => (typeof getLocalDateString === 'function' ? getLocalDateString() : new Date().toISOString().slice(0, 10));
  let live = null;

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // a target inside the phone's sidebar drawer: open the drawer first
  function reveal(el) {
    const side = document.getElementById('sidebar');
    if (el && side && side.contains(el) && !side.classList.contains('open') && window.innerWidth <= 860 &&
        typeof toggleSidebar === 'function') toggleSidebar();
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
  }

  function close(done) {
    if (!live) return;
    window.removeEventListener('resize', live.place);
    window.removeEventListener('scroll', live.place, true);
    document.removeEventListener('keydown', live.key, true);
    live.root.classList.add('bg-out');
    const root = live.root;
    setTimeout(() => root.remove(), 220);
    live = null;
    if (done) done();
  }

  // steps: [{ target: () => Element | null, cat, title, text, ok, okAction, later }]
  function tour(steps, onEnd) {
    close();
    let i = 0;
    const root = document.createElement('div');
    root.className = 'bg-root';
    root.innerHTML = `<div class="bg-veil"></div><div class="bg-hole" hidden></div><div class="bg-arrow" hidden aria-hidden="true"></div>
      <div class="bg-card" role="dialog" aria-modal="true" aria-live="polite"></div>`;
    document.body.appendChild(root);
    const veil = root.querySelector('.bg-veil'), hole = root.querySelector('.bg-hole');
    const arrow = root.querySelector('.bg-arrow'), card = root.querySelector('.bg-card');
    const finish = () => close(onEnd);

    const place = () => {
      const s = steps[i];
      const el = s.target ? s.target() : null;
      const has = el && visible(el);
      root.classList.toggle('bg-center', !has);
      hole.hidden = arrow.hidden = !has;
      veil.classList.toggle('bg-solid', !has);
      const W = window.innerWidth, H = window.innerHeight;
      if (!has) { card.style.left = card.style.top = ''; return; }
      const r = el.getBoundingClientRect(), pad = 8;
      Object.assign(hole.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
      const cw = card.offsetWidth, ch = card.offsetHeight, gap = 22;
      // beside the target when there's room (a sidebar item), else below or above it
      let left, top, dir;
      if (r.right + gap + cw < W - 12 && r.width < W * 0.4) { left = r.right + gap; top = r.top + r.height / 2 - ch / 2; dir = 'left'; }
      else if (r.bottom + gap + ch < H - 12) { left = r.left + r.width / 2 - cw / 2; top = r.bottom + gap; dir = 'up'; }
      else { left = r.left + r.width / 2 - cw / 2; top = r.top - gap - ch; dir = 'down'; }
      left = Math.max(12, Math.min(left, W - cw - 12));
      top = Math.max(12, Math.min(top, H - ch - 12));
      Object.assign(card.style, { left: `${left}px`, top: `${top}px` });
      arrow.className = `bg-arrow bg-${dir}`;
      if (dir === 'left') Object.assign(arrow.style, { left: `${r.right + 2}px`, top: `${r.top + r.height / 2 - 10}px` });
      else if (dir === 'up') Object.assign(arrow.style, { left: `${r.left + r.width / 2 - 10}px`, top: `${r.bottom + 2}px` });
      else Object.assign(arrow.style, { left: `${r.left + r.width / 2 - 10}px`, top: `${r.top - 22}px` });
    };

    const show = () => {
      const s = steps[i];
      const el = s.target ? s.target() : null;
      if (el) reveal(el);
      card.innerHTML = `<img class="bg-cat" src="assets/${esc(s.cat || 'cat-fairy-wave')}.svg" alt="">
        <div class="bg-bubble"><div class="bg-title">${s.title}</div><div class="bg-text">${s.text}</div>
          <div class="bg-btns"><button class="btn-pri btn-sm" data-g="ok">${esc(s.ok || 'Next')}</button>
            <button class="aic-link" data-g="${s.later ? 'later' : 'skip'}">${esc(s.later || (i < steps.length - 1 ? 'Skip tour' : ''))}</button>
          </div>
          ${steps.length > 1 ? `<div class="bg-dots">${steps.map((_, k) => `<span class="${k === i ? 'on' : ''}"></span>`).join('')}</div>` : ''}
        </div>`;
      const skip = card.querySelector('[data-g="skip"]');
      if (skip && !skip.textContent) skip.remove();              // the last step: nothing to skip
      card.classList.remove('bg-pop'); void card.offsetWidth; card.classList.add('bg-pop');
      requestAnimationFrame(place);
      setTimeout(place, 260);                                    // after a page switch or a drawer opening
      card.querySelector('[data-g="ok"]').focus({ preventScroll: true });
      if (s.onShow) s.onShow(card);
    };

    card.addEventListener('click', async e => {
      const g = e.target.closest?.('[data-g]')?.dataset.g;
      if (!g) return;
      const s = steps[i];
      if (g === 'ok' || (g === 'later' && s.laterNext && i < steps.length - 1)) {
        if (g === 'ok' && s.okAction) await s.okAction();
        if (i < steps.length - 1) { i++; show(); } else finish();
      } else finish();
    });
    veil.addEventListener('click', finish);
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); finish(); } };
    live = { root, place, key };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('keydown', key, true);
    show();
  }

  const firstSubject = () => document.querySelector('#nav-subjects .nav-item');
  const semLink = () => document.getElementById('sem-link');
  const semMissing = () => typeof semStart !== 'undefined' && !semStart && !(typeof semEnd !== 'undefined' && semEnd);
  let afterTour = null;              // something to open once the tour has closed (the semester dialog)
  const semStep = () => ({
    target: semLink, cat: 'cat-fairy-confused',
    title: 'One more thing 📅',
    text: 'When does your semester end? It decides how many classes are left, so your bunk maths comes out right.',
    ok: 'Set it now', okAction: () => { afterTour = () => { if (typeof openSemesterDialog === 'function') setTimeout(openSemesterDialog, 260); }; },
    later: 'Later', laterNext: true
  });

  // after an import: the first timetable ever gets the full welcome (once per account); any import that made new
  // subjects (a replaced or added timetable too) is shown where their attendance goes, since new subjects start at 0
  function afterImport(newSubjects, opts = {}) {
    if (uid() === 'guest') return;
    const welcome = opts.first && !get('first_tt');
    if (!welcome && !newSubjects.length) {
      if (typeof toast === 'function') toast("You're good to go ✨");
      return;
    }
    if (welcome) set('first_tt', today());
    const n = newSubjects.length, first = newSubjects[0];
    const steps = [{
      target: null, cat: 'cat-fairy-happy',
      title: welcome ? 'Your first timetable is in! 🎉' : 'New timetable, who dis? ✨',
      text: `${welcome ? 'BunkKro now knows your week' : 'Your week is updated'}${n ? `, and ${n} new subject${n === 1 ? ' is' : 's are'} ready` : ''}. ${n ? "Let me show you around real quick, it's 30 seconds." : "You're good to go ✨"}`,
      ok: n ? 'Show me' : 'Yay',
      onShow: c => { if (window.BunkFx) setTimeout(() => BunkFx.confetti(c.querySelector('.bg-cat'), welcome ? 22 : 14), 320); }
    }];
    if (first) {
      const navOf = () => document.getElementById('nav-s-' + first.id) || document.querySelector('#nav-subjects .nav-item');
      steps.push({
        target: navOf, cat: 'cat-fairy-wave',
        title: n === 1 ? 'Your new subject ✨' : 'Your new subjects ✨',
        text: 'Already had some classes this semester? Open each one and add how many you\'ve attended. Starting fresh? You can skip this.',
        ok: 'Open it',
        okAction: () => {
          if (typeof goPage === 'function') goPage('subject', first.id);
          const side = document.getElementById('sidebar');
          if (side && side.classList.contains('open') && typeof toggleSidebar === 'function') toggleSidebar();
          const ed = document.getElementById('edit-card');
          if (ed) ed.open = true;
        }
      }, {
        target: () => document.getElementById('form-exact'), cat: 'cat-fairy-peek',
        title: 'Your numbers so far',
        text: `Type how many classes you attended and how many you missed so far. The total adds itself up. Then save.${n > 1 ? ` Same for the other ${n - 1} subject${n === 2 ? '' : 's'}.` : ''} Semester just started? Leave them at 0.`,
        ok: 'Next'
      }, {
        target: () => document.querySelector('#edit-card .mode-seg'), cat: 'cat-fairy-confused',
        title: "Don't know the exact numbers? 🤔",
        text: 'Pick <strong>⚡ Estimate</strong>: tell BunkKro when the semester started and roughly how many classes you missed, and it works out the rest. <strong>🎯 Official numbers</strong> is for when your college portal shows them.',
        ok: 'Makes sense'
      }, {
        target: () => document.getElementById('sp-chips'), cat: 'cat-fairy-wave',
        title: 'Quick edits live up here ✏️',
        text: 'Tap Present, Absent or Target on any subject to change it in a second, no form needed.',
        ok: 'Nice',
        okAction: () => { const ed = document.getElementById('edit-card'); if (ed) ed.open = false; }
      });
    }
    if (semMissing()) steps.push(semStep());
    steps.push({
      target: null, cat: 'cat-fairy-happy',
      title: "That's it, you're good to go! 🎉",
      text: 'Mark your classes as they happen and BunkKro keeps the bunk maths for you. Have fun, and bunk wisely 😼',
      ok: "Let's go",
      onShow: c => { if (window.BunkFx) setTimeout(() => BunkFx.confetti(c.querySelector('.bg-cat'), 26), 320); }
    });
    setTimeout(() => tour(steps, runAfterTour), 500);
  }
  function runAfterTour() { const f = afterTour; afterTour = null; if (f) f(); }

  // something the attendance maths needs is missing: point at it (not during the first-timetable tour, once a day)
  function nudge() {
    if (uid() === 'guest' || live || get('nudge') === today()) return;
    if (typeof subjects === 'undefined' || !subjects.length || !semMissing()) return;
    set('nudge', today());
    tour([semStep()], runAfterTour);
  }

  window.BunkGuide = { tour, afterImport, nudge, close };
})();
