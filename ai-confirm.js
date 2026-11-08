/* BunkKro AI: confirm an imported timetable in one tap.
 *
 * After BunkKro AI reads a timetable it is already on the Schedule, as before. One small bar sits above it:
 *   draft                      "Does it look right?" -> one tap to confirm. Periods the AI couldn't read ("Class or
 *                              free?") are never dropped: the student checks them, or confirms with them unchecked.
 *                              Classes the AI wasn't fully sure of are "worth a look", never required.
 *   confirmed                  every period was decided by the student
 *   confirmed_with_unresolved  the student chose to save with some "Class or free?" periods left
 * "Check them" opens each flagged period in turn; each popup answers in one tap (free / it's right) or a fix.
 * Confirming records that the student checked it (the timetable itself is saved as you edit).
 *
 * Nothing is lost to an AI reading: until the new timetable is confirmed, the old one is kept ("Put back my old
 * timetable"), and the old subjects the student chose to remove (with their attendance) are only removed on confirm.
 *
 * Improving the AI is a separate, explicit choice (off until the student turns it on): confirming a timetable is not
 * consent. When it is on, what the AI read and what the student kept are sent on confirm (never the file); "Turn
 * off" stops it and deletes what was sent.
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
  const uuid = () => (typeof newUuid === 'function' ? newUuid() : crypto.randomUUID());
  const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
  // only an explicit "Turn on" counts: confirming a timetable is not consent to help train the AI
  const sharing = () => { const s = load('share', null); return !!(s && s.value === true); };
  let held = [];                         // subjects to remove once the import that is starting is confirmed
  let cloudReady = true;                 // false once the cloud tables turn out not to exist (migration not run yet)
  let walk = 0;                          // when "Check them" was last used: the popup moves on to the next one

  const pick = s => ({
    day: s.day, startTime: s.startTime || '', endTime: s.endTime || '', subjectName: s.subjectName || '',
    rawText: s.rawText || '', isUnknown: !!s.isUnknown, isUncertain: !!s.isUncertain, isBreak: !!s.isBreak,
    cellId: s.cellId || null,
    // what the page says about it (W11): kept in the import record, also for the classes of other batches
    ...(s.batches && s.batches.length ? { batches: s.batches.slice() } : {}),
    ...(s.allBatches ? { allBatches: true } : {}),
    ...(s.sessionType ? { sessionType: s.sessionType } : {}),
    ...(s.alternativeGroup ? { alternativeGroup: s.alternativeGroup } : {})
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
      baseIds: (meta && meta.baseIds) || [],         // "Add to it": classes that were there before, not the AI's
      // the timetable before this import, the old subjects to remove on confirm and the subjects this import created
      previous: (meta && meta.previous) || null,
      batch: (meta && meta.batch) || null,           // the student's batch, when the timetable asked for one
      fixes: 0
    };
    held = [];
    save('import', imp);                 // at once: a confirm (or put back) right after must find this record
    render();
    let hash = null;
    try { hash = await sha256(meta && meta.file); } catch (e) { /* hashing is only for spotting re-uploads */ }
    const now = load('import', null);    // the record as it is now (it may have been confirmed meanwhile)
    if (now && now.id === imp.id) {
      now.sourceHash = hash;
      save('import', now);
      cloud(now);
    }
  }

  function active() {
    const imp = load('import', null);
    if (!imp || typeof timetable === 'undefined' || !timetable.length) return null;
    const ids = new Set(Object.values(imp.ids || {}));
    return timetable.some(s => ids.has(s.id)) ? imp : null;     // the timetable on screen came from this import
  }

  const isUnsure = s => !s.isBreak && !s.isUnknown && s.isUncertain;
  function counts() {
    const lessons = timetable.filter(s => !s.isBreak);
    return {
      classes: lessons.filter(s => !s.isUnknown).length,
      days: new Set(lessons.map(s => s.day)).size,
      unresolved: lessons.filter(s => s.isUnknown).length,
      unsure: lessons.filter(isUnsure).length
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
        type = t.length ? t.join('+') : (p.isUncertain && !cur.isUncertain ? 'confirmed_unsure' : 'unchanged');
      }
      out.push({ type, entryId: cur ? cur.id : null, predicted: p, confirmed: cur ? pick(cur) : null });
    }
    const before = new Set(imp.baseIds || []);
    for (const s of timetable) {
      if (!s.isBreak && !used.has(s.id) && !before.has(s.id)) out.push({ type: 'class_added', entryId: s.id, predicted: null, confirmed: pick(s) });
    }
    return out;
  }
  const isFix = c => !['unchanged', 'unresolved', 'confirmed_unsure'].includes(c.type);

  // subjects that must not be matched by name: chosen for removal with the old timetable, not removed yet
  function pendingDrops() {
    const imp = active();
    return new Set([...held, ...((imp && imp.status === 'draft' && imp.previous && imp.previous.dropIds) || [])]);
  }
  function holdDrops(ids) { held = (ids || []).slice(); }

  // "Put back my old timetable": the draft goes, the old timetable comes back as it was, and the subjects this
  // import created go too, unless attendance was already marked for them
  async function putBack() {
    const imp = active();
    if (!imp || imp.status !== 'draft' || !imp.previous) return;
    const ok = typeof askDialog === 'function' ? await askDialog({
      title: 'Put back your old timetable?', message: 'The new one goes, and your old classes come back as they were.',
      ok: 'Put it back', cancel: 'Keep the new one', cat: 'cat-worried' }) : true;
    if (!ok) return;
    timetable = imp.previous.timetable || [];
    imp.status = 'cancelled';
    imp.ids = {};
    save('import', imp);
    const marked = id => typeof trackerLog !== 'undefined' && Object.values(trackerLog).some(d => d && d[id]);
    const extra = (imp.previous.created || []).filter(id => subjects.some(s => s.id === id) && !marked(id));
    if (extra.length && typeof removeSubjectCompletely === 'function') {
      for (const id of extra) await removeSubjectCompletely(id);
    }
    const synced = typeof saveTimetableToStorageAndDB === 'function' ? await saveTimetableToStorageAndDB() : true;
    cloud(imp);
    if (typeof renderAll === 'function') renderAll();
    render();
    if (typeof toast === 'function') {
      toast(synced === false ? 'Old timetable back on this device; cloud sync failed, it will retry' : 'Your old timetable is back ✓');
    }
  }

  async function confirm() {
    const imp = active();
    if (!imp) return;
    walk = 0;
    const c = counts();
    const diff = corrections(imp);
    const btn = document.querySelector('#tt-confirm-bar .btn-pri');
    if (window.BunkFx && btn) { if (c.unresolved) BunkFx.pop(btn); else BunkFx.confetti(btn); }
    imp.status = c.unresolved ? 'confirmed_with_unresolved' : 'confirmed';
    imp.confirmedAt = new Date().toISOString();
    imp.fixes = diff.filter(isFix).length;
    const drops = (imp.previous && imp.previous.dropIds) || [];
    imp.previous = null;                 // confirmed: the old timetable is no longer kept
    save('import', imp);
    if (drops.length && typeof dropOldSubjects === 'function') {   // the student's choice in the Replace dialog
      await dropOldSubjects(drops);
      if (typeof saveTimetableToStorageAndDB === 'function') saveTimetableToStorageAndDB();
      if (typeof renderAll === 'function') renderAll();
    }
    if (sharing() && uid() !== 'guest') queueFeedback(imp, diff);
    cloud(imp);
    render();
    if (typeof toast === 'function') {
      toast(c.unresolved ? `Saved, with ${plural(c.unresolved, 'period')} still to check` : 'Timetable confirmed ✓ it\'s giving organised ✨');
    }
  }

  // the flagged periods in reading order: "Class or free?" first, then the ones worth a look
  function flagged() {
    const order = (a, b) => a.day - b.day || String(a.startTime).localeCompare(String(b.startTime));
    return [...timetable.filter(s => s.isUnknown && !s.isBreak).sort(order), ...timetable.filter(isUnsure).sort(order)];
  }

  function checkNext() {
    const next = flagged()[0];
    if (!next) { walk = 0; return render(); }
    walk = Date.now();
    const card = document.querySelector(`.tt-slot-card[data-slot-id="${next.id}"]`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (typeof openEditSlotModal === 'function') openEditSlotModal(next.id);
  }

  // after a popup answer (a save re-renders the timetable within a moment of closing), open the next flagged one.
  // Cancel doesn't re-render, so it ends the walk.
  function continueWalk() {
    if (!walk) return;
    const open = document.getElementById('slot-edit-overlay');
    if (open && open.classList.contains('show')) return;
    if (Date.now() - walk > 10 * 60 * 1000) { walk = 0; return; }
    if (!flagged().length) { walk = 0; return; }
    setTimeout(() => { if (walk) checkNext(); }, 450);
  }
  if (typeof window.closeSlotEditModal === 'function') {
    const close = window.closeSlotEditModal;
    window.closeSlotEditModal = function () {
      const r = close.apply(this, arguments);
      if (walk) {                       // closed: continue only if a save re-renders right after (not on Cancel)
        const stamp = walk = Date.now();
        setTimeout(() => { if (walk === stamp) walk = 0; }, 1500);
      }
      return r;
    };
  }

  // ── improving the AI (on unless turned off) ────────────────────────────────────────────────────────────────
  async function setSharing(on) {
    save('share', { value: !!on, at: new Date().toISOString(), version: 3 });   // v3: off unless turned on
    if (!on) {
      save('feedback_queue', []);
      if (canCloud()) {
        const { error } = await supabaseClient.from('timetable_feedback').delete().eq('user_id', uid());
        if (error && !missingTable(error)) console.warn('BunkKro AI feedback delete:', error.message);
      }
    } else {
      const imp = active();
      if (imp && imp.status !== 'draft') queueFeedback(imp, corrections(imp));
    }
    const imp = load('import', null);
    if (imp) cloud(imp);
    render();
    if (typeof toast === 'function') {
      toast(on ? 'Thanks! Your fixes will help BunkKro AI learn 💜' : 'Turned off, and removed the fixes already sent');
    }
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
    const share = load('share', null);
    const { error } = await supabaseClient.from('timetable_imports').upsert([{
      id: imp.id, user_id: uid(), engine_version: imp.engineVersion, source_hash: imp.sourceHash, status: imp.status,
      created_at: imp.createdAt, confirmed_at: imp.confirmedAt, class_count: c.classes, unresolved_count: c.unresolved,
      corrections_count: imp.fixes || 0, training_consent: sharing(), consent_at: share ? share.at : imp.createdAt
    }], { onConflict: 'id' });
    if (error) return cloudError(error);
    flush();
  }

  async function flush() {
    const queue = load('feedback_queue', []);
    if (!queue.length || !canCloud()) return;
    if (!sharing()) return save('feedback_queue', []);
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
    const signedIn = uid() !== 'guest';
    if (note) {
      const bits = [];
      if (imp && imp.status !== 'draft') {
        const left = counts().unresolved;
        bits.push(`<span class="aic-note-ok">✓ Confirmed</span>${left ? `, ${left} still to check` : ''}`);
      }
      if (imp && signedIn) {
        bits.push(sharing()
          ? 'Your fixes help BunkKro AI learn · <button class="tt-rescan-link" onclick="BunkKroImport.setSharing(false)">Turn off</button>'
          : 'Help BunkKro AI learn from your fixes? <button class="tt-rescan-link" onclick="BunkKroImport.setSharing(true)">Turn on</button>');
      }
      note.innerHTML = bits.length ? ' · ' + bits.join(' · ') : '';
    }
    if (bar) {
      if (!imp || imp.status !== 'draft') {
        bar.hidden = true;
        bar.innerHTML = '';
      } else {
        const c = counts();
        const them = n => (n === 1 ? 'it' : 'them');
        const chips = `<span class="aic-chip">${plural(c.classes, 'class', 'classes')}</span>` +
          `<span class="aic-chip">${plural(c.days, 'day')}</span>` +
          (c.unresolved ? `<span class="aic-chip warn">${c.unresolved} to check</span>` : '') +
          (c.unsure ? `<span class="aic-chip info">${c.unsure} worth a look</span>` : '') +
          (!c.unresolved && !c.unsure ? '<span class="aic-chip ok">all checked</span>' : '');
        const sub = c.unresolved
          ? `BunkKro AI couldn't tell if ${c.unresolved === 1 ? 'one period is' : c.unresolved + ' periods are'} a class or free. Check ${them(c.unresolved)}, then confirm.`
          : c.unsure
            ? `Every period is filled in. ${c.unsure === 1 ? 'One class is' : c.unsure + ' classes are'} marked ⚠️ because the AI wasn't fully sure, so ${them(c.unsure)}'s worth a quick look.`
            : 'Tap any class below to fix it. When it matches your college timetable, confirm.';
        const actions = c.unresolved
          ? `<button class="btn-pri" onclick="BunkKroImport.checkNext()">Check ${them(c.unresolved)}</button>
             <button class="aic-link" onclick="BunkKroImport.confirm()">Confirm with ${c.unresolved} unchecked</button>`
          : `<button class="btn-pri" onclick="BunkKroImport.confirm()">Looks right · Confirm</button>` +
            (c.unsure ? `<button class="aic-link" onclick="BunkKroImport.checkNext()">Look at the ${c.unsure === 1 ? 'unsure one' : c.unsure + ' unsure ones'}</button>` : '');
        const back = imp.previous && (imp.previous.timetable || []).length
          ? '<button class="aic-link" onclick="BunkKroImport.putBack()">Put back my old timetable</button>' : '';
        bar.hidden = false;
        bar.className = 'aic-bar draft';
        bar.innerHTML = `
          <img class="aic-cat" src="assets/cat-blue-detective.svg" alt="">
          <div class="aic-body">
            <div class="aic-title">Here's your timetable ✨ Does it look right?</div>
            <div class="aic-sub">${sub}</div>
            <div class="aic-chips">${chips}</div>
            ${signedIn && sharing() ? '<div class="aic-fine">You chose to help BunkKro AI learn: confirming sends your fixes (never your file).</div>' : ''}
          </div>
          <div class="aic-actions">${actions}${back}</div>`;
      }
    }
    continueWalk();
  }

  window.BunkKroImport = { start, render, confirm, checkNext, setSharing, putBack, pendingDrops, holdDrops,
    corrections: () => { const i = active(); return i ? corrections(i) : []; } };
  document.addEventListener('DOMContentLoaded', () => { render(); flush(); });
})();
