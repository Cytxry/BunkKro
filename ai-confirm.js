/* BunkKro AI: confirm an imported timetable, and (separately, optional) share the fixes.
 *
 * After BunkKro AI reads a timetable it is already on the Schedule tab, as before. This adds one small bar above it:
 *   draft                      "Look right?" -> one tap to confirm. Periods the AI couldn't read ("Needs review")
 *                              are never dropped: the student checks them, or confirms with them still unchecked.
 *   confirmed                  every period was decided by the student
 *   confirmed_with_unresolved  the student chose to save with some "Needs review" periods left
 * Confirming saves nothing new (the timetable is saved as you edit); it records that the student checked it.
 *
 * Sharing fixes for AI improvement is a separate choice, off until the student says yes, asked once after a
 * confirmation that changed something. It sends what the AI read and what the student kept for each period,
 * never the file. It can be stopped from the "Schedule loaded" bar, which also deletes what was shared.
 *
 * Cloud tables (migrations/2026-11-06-ai-confirmation.sql): timetable_imports, timetable_feedback. Until they
 * exist, everything stays on this device and nothing breaks.
 */
(function () {
  'use strict';
  const uid = () => (typeof currentUser !== 'undefined' && currentUser ? currentUser.id : 'guest');
  const key = name => `bk_ai_${name}_${uid()}`;
  const load = (name, fallback) => {
    try { const v = JSON.parse(localStorage.getItem(key(name))); return v == null ? fallback : v; } catch (e) { return fallback; }
  };
  const save = (name, value) => { try { localStorage.setItem(key(name), JSON.stringify(value)); } catch (e) { /* private mode */ } };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uuid = () => (typeof newUuid === 'function' ? newUuid() : crypto.randomUUID());
  const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
  let cloudReady = true;                 // false once the cloud tables turn out not to exist (migration not run yet)

  const pick = s => ({
    day: s.day, startTime: s.startTime || '', endTime: s.endTime || '', subjectName: s.subjectName || '',
    rawText: s.rawText || '', isUnknown: !!s.isUnknown, isUncertain: !!s.isUncertain, isBreak: !!s.isBreak,
    cellId: s.cellId || null
  });

  async function sha256(file) {
    if (!file || !crypto.subtle) return null;
    const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ── import record ──────────────────────────────────────────────────────────────────────────────────────────
  // predicted: the slots exactly as BunkKro AI exported them (before the student's subject step);
  // slots: the timetable now on screen (saved, so ids are final) whose aiRef points back to a predicted slot
  async function start(predicted, slots, meta) {
    const imp = {
      id: uuid(), status: 'draft', createdAt: new Date().toISOString(), confirmedAt: null,
      engineVersion: (meta && meta.engineVersion) || null, sourceHash: null,
      predicted: predicted.map(s => ({ aiRef: s.id, ...pick(s) })),
      ids: Object.fromEntries(slots.filter(s => s.aiRef).map(s => [s.aiRef, s.id])),
      fixes: 0, askShare: false
    };
    try { imp.sourceHash = await sha256(meta && meta.file); } catch (e) { /* hashing is only for spotting re-uploads */ }
    save('import', imp);
    render();
    cloud(imp);
  }

  function active() {
    const imp = load('import', null);
    if (!imp || typeof timetable === 'undefined' || !timetable.length) return null;
    const ids = new Set(Object.values(imp.ids || {}));
    return timetable.some(s => ids.has(s.id)) ? imp : null;     // the timetable on screen came from this import
  }

  function counts() {
    const lessons = timetable.filter(s => !s.isBreak);
    return {
      classes: lessons.filter(s => !s.isUnknown).length,
      days: new Set(lessons.map(s => s.day)).size,
      unresolved: lessons.filter(s => s.isUnknown).length
    };
  }

  // what the student changed, period by period (unchanged and unresolved periods are recorded, not counted as fixes)
  function corrections(imp) {
    const byId = new Map(timetable.map(s => [s.id, s]));
    const used = new Set();
    const out = [];
    for (const p of imp.predicted) {
      if (p.isBreak) continue;
      const id = imp.ids[p.aiRef];
      const cur = id ? byId.get(id) : null;
      if (cur) used.add(cur.id);
      let type;
      if (!cur) type = p.isUnknown ? 'marked_free' : 'class_removed';
      else if (p.isUnknown) type = cur.isUnknown ? 'unresolved' : 'unknown_was_class';
      else {
        const t = [];
        if (norm(cur.subjectName) !== norm(p.subjectName)) t.push('subject');
        if (cur.day !== p.day) t.push('day');
        if ((cur.startTime || '') !== p.startTime || (cur.endTime || '') !== p.endTime) t.push('time');
        type = t.length ? t.join('+') : 'unchanged';
      }
      out.push({ type, entryId: cur ? cur.id : null, predicted: p, confirmed: cur ? pick(cur) : null });
    }
    for (const s of timetable) {
      if (!s.isBreak && !used.has(s.id)) out.push({ type: 'class_added', entryId: s.id, predicted: null, confirmed: pick(s) });
    }
    return out;
  }
  const isFix = c => c.type !== 'unchanged' && c.type !== 'unresolved';

  function confirm() {
    const imp = active();
    if (!imp) return;
    const c = counts();
    const diff = corrections(imp);
    imp.status = c.unresolved ? 'confirmed_with_unresolved' : 'confirmed';
    imp.confirmedAt = new Date().toISOString();
    imp.fixes = diff.filter(isFix).length;
    const consent = load('share', null);
    imp.askShare = imp.fixes > 0 && !consent && uid() !== 'guest';   // only signed-in fixes can ever be sent
    save('import', imp);
    if (consent && consent.value) queueFeedback(imp, diff);
    cloud(imp);
    render();
    if (typeof toast === 'function') {
      toast(c.unresolved ? `Saved — ${plural(c.unresolved, 'period')} still marked "Needs review"` : 'Timetable confirmed ✓');
    }
  }

  function checkNext() {
    const next = timetable.filter(s => s.isUnknown && !s.isBreak)
      .sort((a, b) => a.day - b.day || String(a.startTime).localeCompare(String(b.startTime)))[0];
    if (!next) return render();
    if (typeof switchTimetableTab === 'function') switchTimetableTab('schedule');
    const card = document.querySelector(`.tt-slot-card[data-slot-id="${next.id}"]`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (typeof openEditSlotModal === 'function') openEditSlotModal(next.id);
  }

  // ── sharing fixes (opt-in) ─────────────────────────────────────────────────────────────────────────────────
  function share(yes) {
    save('share', { value: !!yes, at: new Date().toISOString(), version: 1 });
    const imp = load('import', null);
    if (imp) {
      imp.askShare = false;
      save('import', imp);
      if (yes && active()) queueFeedback(imp, corrections(imp));
      cloud(imp);
    }
    render();
    if (typeof toast === 'function') toast(yes ? 'Thank you! Your fixes help BunkKro AI learn 💜' : 'No problem — nothing is shared');
  }

  async function stopSharing() {
    save('share', { value: false, at: new Date().toISOString(), version: 1 });
    save('feedback_queue', []);
    if (cloudReady && uid() !== 'guest' && typeof supabaseClient !== 'undefined' && supabaseClient) {
      const { error } = await supabaseClient.from('timetable_feedback').delete().eq('user_id', uid());
      if (error && !missingTable(error)) console.warn('BunkKro AI feedback delete:', error.message);
    }
    const imp = load('import', null);
    if (imp) cloud(imp);
    render();
    if (typeof toast === 'function') toast('Stopped sharing, and removed the fixes you shared');
  }

  function queueFeedback(imp, diff) {
    const rows = diff.filter(c => c.type !== 'unresolved').map(c => ({
      id: uuid(), import_id: imp.id, entry_id: c.entryId, correction_type: c.type,
      predicted_value: c.predicted, confirmed_value: c.confirmed, source_cell_id: (c.predicted && c.predicted.cellId) || null,
      engine_version: imp.engineVersion, training_consent: true, review_state: 'pending'
    }));
    const queue = load('feedback_queue', []).filter(r => r.import_id !== imp.id).concat(rows);
    save('feedback_queue', queue);
    flush();
  }

  // ── cloud (Supabase), best effort ──────────────────────────────────────────────────────────────────────────
  const missingTable = e => /42P01|PGRST20[25]/.test(e.code || '') || /does not exist|schema cache/i.test(e.message || '');
  const canCloud = () => cloudReady && uid() !== 'guest' && typeof supabaseClient !== 'undefined' && supabaseClient &&
    (typeof isOnline !== 'function' || isOnline());

  async function cloud(imp) {
    if (!canCloud()) return;
    const c = active() ? counts() : { classes: 0, unresolved: 0 };
    const consent = load('share', null);
    const { error } = await supabaseClient.from('timetable_imports').upsert([{
      id: imp.id, user_id: uid(), engine_version: imp.engineVersion, source_hash: imp.sourceHash, status: imp.status,
      created_at: imp.createdAt, confirmed_at: imp.confirmedAt, class_count: c.classes, unresolved_count: c.unresolved,
      corrections_count: imp.fixes || 0, training_consent: !!(consent && consent.value),
      consent_at: consent ? consent.at : null
    }], { onConflict: 'id' });
    if (error) return cloudError(error);
    flush();
  }

  async function flush() {
    const queue = load('feedback_queue', []);
    if (!queue.length || !canCloud()) return;
    const consent = load('share', null);
    if (!consent || !consent.value) return save('feedback_queue', []);
    const rows = queue.map(r => ({ ...r, user_id: uid() }));
    const { error } = await supabaseClient.from('timetable_feedback').upsert(rows, { onConflict: 'id' });
    if (error) return cloudError(error);
    save('feedback_queue', []);
  }

  function cloudError(error) {
    if (missingTable(error)) {
      cloudReady = false;               // the migration hasn't been run: keep everything on this device
      console.info('BunkKro AI confirmation: cloud tables not set up yet; kept on this device');
    } else {
      console.warn('BunkKro AI confirmation sync:', error.message);
    }
  }

  // ── the bar ────────────────────────────────────────────────────────────────────────────────────────────────
  function render() {
    const bar = document.getElementById('tt-confirm-bar');
    const note = document.getElementById('tt-ai-note');
    const imp = active();
    const consent = load('share', null);
    if (note) {
      const bits = [];
      if (imp && imp.status !== 'draft') {
        const left = counts().unresolved;
        bits.push(`<span class="aic-note-ok">✓ Confirmed</span>${left ? `, ${left} still to check` : ''}`);
      }
      if (consent && consent.value) bits.push('Sharing fixes with BunkKro AI · <button class="tt-rescan-link" onclick="BunkKroImport.stopSharing()">Stop</button>');
      note.innerHTML = bits.length ? ' · ' + bits.join(' · ') : '';
    }
    if (!bar) return;
    if (!imp || (imp.status !== 'draft' && !imp.askShare)) { bar.hidden = true; bar.innerHTML = ''; return; }
    bar.hidden = false;
    if (imp.status === 'draft') {
      const c = counts();
      const chips = `<span class="aic-chip">${plural(c.classes, 'class', 'classes')}</span>` +
        `<span class="aic-chip">${plural(c.days, 'day')}</span>` +
        (c.unresolved ? `<span class="aic-chip warn">${c.unresolved} to check</span>` : '<span class="aic-chip ok">all checked</span>');
      bar.className = 'aic-bar draft';
      bar.innerHTML = `
        <img class="aic-cat" src="assets/cat-blue-detective.svg" alt="">
        <div class="aic-body">
          <div class="aic-title">Here's your timetable ✨ Does it look right?</div>
          <div class="aic-sub">${c.unresolved
            ? `BunkKro AI couldn't tell if ${c.unresolved === 1 ? 'one period is' : c.unresolved + ' periods are'} a class or free. Check ${c.unresolved === 1 ? 'it' : 'them'}, then confirm.`
            : 'Tap any class below to fix it. When it matches your college timetable, confirm.'}</div>
          <div class="aic-chips">${chips}</div>
        </div>
        <div class="aic-actions">
          ${c.unresolved
            ? `<button class="btn-pri" onclick="BunkKroImport.checkNext()">Check ${c.unresolved === 1 ? 'it' : 'them'}</button>
               <button class="aic-link" onclick="BunkKroImport.confirm()">Confirm with ${c.unresolved} unchecked</button>`
            : `<button class="btn-pri" onclick="BunkKroImport.confirm()">Looks right · Confirm</button>`}
        </div>`;
    } else {
      bar.className = 'aic-bar thanks';
      bar.innerHTML = `
        <img class="aic-cat" src="assets/cat-happy.svg" alt="">
        <div class="aic-body">
          <div class="aic-title">Confirmed! 🎉 You fixed ${plural(imp.fixes, 'thing')}.</div>
          <div class="aic-sub">Want to help BunkKro AI read timetables better? Share what it read and what you changed. Your file isn't shared, it's optional, and you can stop anytime.</div>
        </div>
        <div class="aic-actions">
          <button class="btn-pri" onclick="BunkKroImport.share(true)">Share my fixes</button>
          <button class="aic-link" onclick="BunkKroImport.share(false)">No thanks</button>
        </div>`;
    }
  }

  window.BunkKroImport = { start, render, confirm, checkNext, share, stopSharing, corrections: () => { const i = active(); return i ? corrections(i) : []; } };
  document.addEventListener('DOMContentLoaded', () => { render(); flush(); });
})();
