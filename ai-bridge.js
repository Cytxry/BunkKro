/* BunkKro AI bridge: reads an uploaded timetable with the local BunkKro-AI server (BunkKro-AI/server.py, started
 * with start_bunkkro_ai.bat) and falls back to the in-browser scanner (timetable-scanner.js) when it is not running.
 *
 * Flow: upload -> /scan (a job) -> /status polled for page progress -> /result. When the file holds several
 * timetables (one per class / year / page) the student picks theirs, then their section row if the page prints
 * several per day. The slots come back in the app's own shape ({day 1-7, period, startTime, endTime, subjectName,
 * isBreak, isUncertain, ...}) with the box of the cell each was read from, so the Studio shows every period on the
 * real page. A last step groups the subject names and lets the student tidy them, link them to existing subjects or
 * drop classes that are not theirs, and creates the missing subjects with their weekly counts.
 */
(function () {
  const BASE = (window.BUNKKRO_AI_URL || 'http://127.0.0.1:8765').replace(/\/$/, '');
  const DAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  let available = null;          // null = not checked yet
  let checkedAt = 0;
  let engineVersion = null;      // the local engine's version (server /health), recorded with each import

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const cancelled = msg => Object.assign(new Error(msg), { cancelled: true });

  // Only this computer's owner looks for the local AI: the site opened locally, or opted in once with ?ai=1
  // (?ai=0 turns it off). Other visitors' browsers never probe their own localhost (no "access local devices"
  // prompts, no console errors) and simply use the built-in scanner.
  function enabled() {
    try {
      const q = new URLSearchParams(location.search).get('ai');
      if (q === '1') localStorage.setItem('bk_local_ai', '1');
      if (q === '0') localStorage.removeItem('bk_local_ai');
      if (localStorage.getItem('bk_local_ai') === '1') return true;
    } catch (e) { /* storage blocked: fall through to the host check */ }
    return location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  }

  async function isAvailable(force) {
    if (!enabled()) return false;
    if (!force && available !== null && Date.now() - checkedAt < 15000) return available;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 1200);
      const r = await fetch(BASE + '/health', { signal: ctl.signal });
      clearTimeout(timer);
      const h = r.ok ? await r.json() : {};
      available = h.ok === true;
      if (available) engineVersion = h.version || null;
    } catch (e) {
      available = false;
    }
    checkedAt = Date.now();
    return available;
  }

  async function call(method, path, body) {
    const r = await fetch(BASE + path, { method, body: method === 'POST' ? (body || '') : undefined });
    return r.json().catch(() => ({ ok: false, error: `server answered ${r.status}` }));
  }

  // ── small modal helpers (the app's own overlay / modal / button styles) ──────────────────────────────────────
  function modal(html, maxWidth, cat, escape) {
    const overlay = document.createElement('div');
    overlay.className = 'overlay show';
    if (escape) overlay.dataset.escape = escape;      // Escape presses this button (bunkke.js keydown handler)
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `<div class="modal modal-center" style="max-width:${maxWidth || 440}px;max-height:88vh;overflow:auto">
      ${cat ? `<img class="modal-cat" src="assets/${cat}.svg" alt="">` : ''}${html}</div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  function choose(title, sub, options, okLabel) {
    return new Promise(resolve => {
      const overlay = modal(`
        <h2>${escapeHtml(title)}</h2>
        <p class="sub">${escapeHtml(sub)}</p>
        <div class="mf" style="text-align:left">
          <select id="ai-choice-select" aria-label="${escapeHtml(title)}">
            ${options.map((o, i) => `<option value="${i}">${escapeHtml(o.label)}</option>`).join('')}
          </select>
        </div>
        <div class="modal-btns">
          <button class="btn-sec" data-act="cancel">Cancel</button>
          <button class="btn-pri" data-act="ok">${escapeHtml(okLabel)}</button>
        </div>`, 440, 'cat-detective', 'cancel');
      overlay.addEventListener('click', e => {
        const act = e.target.getAttribute && e.target.getAttribute('data-act');
        if (!act) return;
        const k = overlay.querySelector('#ai-choice-select').value;
        overlay.remove();
        resolve(act === 'ok' ? options[Number(k)].value : null);
      });
    });
  }

  function choiceLabel(c) {
    const m = /page_(\d+)/.exec(c.file);
    const t = /table(\d+)/.exec(c.file);
    const where = (m ? `Page ${Number(m[1])}` : 'Timetable') + (t ? `, table ${t[1]}` : '');
    const days = c.day_order ? 'Day-Order cycle' : c.days.map(d => d.slice(0, 3)).join(' ');
    const rows = c.tracks && c.tracks.length ? `, ${c.tracks.length} sections` : '';
    return `${where}: ${c.activities} classes (${days}${rows})`;
  }

  // ── reading ────────────────────────────────────────────────────────────────────────────────────────────────
  async function waitForJob(job, onPhase) {
    let last = '';
    for (;;) {
      const st = await call('GET', `/status?job=${job}`);
      if (st.state === 'done') return;
      if (st.state === 'error' || st.ok === false) throw new Error(st.message || st.error || 'the reader failed');
      const total = st.pages_total || 0;
      const done = st.pages_done || 0;
      const pct = st.state === 'queued' ? 12 : 15 + Math.round(65 * (total ? done / total : 0));
      const msg = st.state === 'queued' ? 'In the queue, another timetable is being read ⏳'
        : total > 1 ? `Page ${Math.min(done + 1, total)} of ${total} · scans take about a minute each, worth it 🫡`
          : 'A photo or scan takes a minute or two, hang tight 🫶';
      if (onPhase && msg + pct !== last) onPhase('ocr', pct, msg);
      last = msg + pct;
      await sleep(1500);
    }
  }

  async function loadImage(path) {
    try {
      const r = await fetch(BASE + path);
      if (!r.ok) return null;
      const url = URL.createObjectURL(await r.blob());
      const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      return canvas;
    } catch (e) {
      return null;
    }
  }

  // Studio cells (the app's shape) from the slots' boxes; each slot points at its cell
  function studioCells(slots) {
    const cells = [];
    const byKey = new Map();
    for (const s of slots) {
      if (!s.box) { s.cellId = null; continue; }
      const key = s.box.join(',');
      let cell = byKey.get(key);
      if (!cell) {
        cell = {
          id: 'ai' + cells.length,
          xmin: s.box[0], ymin: s.box[1], xmax: s.box[2], ymax: s.box[3],
          row: s.day, col: s.period,
          ocrText: s.rawText || s.subjectName,
          ocrConfidence: s.isUncertain ? 60 : 95,
          classification: s.isUncertain ? 'uncertain' : 'confirmed',
          source: 'bunkkro-ai',
        };
        byKey.set(key, cell);
        cells.push(cell);
      }
      s.cellId = cell.id;
    }
    return cells;
  }

  function matchSubjects(slots, subjects) {
    return slots.map(s => {
      if (s.isBreak) return { ...s, matchConfidence: 'break' };
      if (s.isUnknown) return { ...s, aiName: s.subjectName, matchConfidence: 'none' };   // nothing read: no subject to match
      const name = (s.subjectName || '').toLowerCase();
      const exact = subjects.find(x => x.name.toLowerCase() === name);
      const fuzzy = exact || subjects.find(x => name && x.name.length > 2 &&
        (name.includes(x.name.toLowerCase()) || x.name.toLowerCase().includes(name)));
      const hit = exact || fuzzy;
      return {
        ...s,
        aiName: s.subjectName,
        subjectId: hit ? hit.id : null,
        subjectName: hit ? hit.name : s.subjectName,
        matchConfidence: exact ? 'exact' : (fuzzy ? 'fuzzy' : 'none'),
      };
    });
  }

  const DOUBT_TEXT = {
    extent_uncertain: 'how many periods it lasts is unclear',
    possibly_covered_by_merged_cell: 'it may be part of a longer class next to it',
    border_unclear: 'the cell border is unclear',
    grid_time_conflicts_with_printed_time: 'the time printed in the cell differs from the column time',
    grid_time_invalid: 'the column time could not be read',
    own_time_unresolved: 'a time printed in the cell could not be read',
    own_time_unreadable: 'a time printed in the cell could not be read',
    meridiem_ambiguous: 'AM / PM is unclear',
    multiple_times_in_text: 'the cell prints several times',
    time_in_text_not_read: 'the cell prints a time that was not read',
    text_names_other_days: 'the text mentions other days',
    stacked_activities: 'the cell holds more than one class',
    split_cell: 'the cell holds more than one class',
    ink_without_text: 'something is printed there that could not be read',
    low_confidence: 'the text was hard to read',
    unverified_empty: 'nothing was read here, but the page was not fully read, so it may not be free',
    page_not_understood: 'the reader did not understand this page',
    split_unresolved: 'two classes may be printed together here, with nothing between them',
    alternatives_unlabelled: 'several classes share this time, and the timetable doesn\'t say who goes to which',
    session_label_shared: 'one "lab" word may belong to more than one class here',
    batch_overlap: 'one batch would have two classes at once',
    split_suspect: 'this box may have been split in the wrong place',
    subject_dropped: 'a subject printed in this box may be missing',
    duplicate_activity: 'this class may have been read twice',
    schema_invalid: 'the reading was malformed',
  };

  // review: the server's page verdict {status: complete|partial|failed, reasons, missingDays, unknownCells}
  function issues(slots, review) {
    const warnings = [];
    if (review && review.status === 'partial') {
      warnings.push({ message: `Part of this page could not be read (${(review.reasons || []).join('; ') || 'incomplete'}). ` +
        'Periods there are marked "Needs review" instead of free.' });
    }
    for (const s of slots) {
      if (s.isBreak) continue;
      const when = s.startTime ? `${s.startTime}${s.endTime ? '-' + s.endTime : ''}` : `period ${s.period}`;
      const told = (s.reviewReasons || [])[0];
      const base = { cellId: s.cellId || undefined, details: escapeHtml(s.rawText || s.subjectName) };
      if (s.isUnknown) {            // never shown as free: the student decides
        const why = (s.doubts || []).filter(d => d !== 'unverified_empty').map(d => DOUBT_TEXT[d]).filter(Boolean);
        warnings.push({ ...base, message: `${DAY_SHORT[s.day]} ${when}: class or free period? Nothing was read here${why[0] ? ' (' + why[0] + ')' : ''}. ` +
          'Pick its subject, or delete it if it is free' });
      } else if (s.overlapsAnotherClass) {
        warnings.push({ ...base, message: `${DAY_SHORT[s.day]} ${when}: two classes at the same time — keep yours` });
      } else if (!s.startTime) {
        warnings.push({ ...base, message: `${DAY_SHORT[s.day]} period ${s.period}: no time printed for this class` });
      } else if (s.isUncertain) {
        const why = (s.doubts || []).map(d => DOUBT_TEXT[d]).filter(Boolean);
        warnings.push({ ...base, message: `${DAY_SHORT[s.day]} ${when}: please check — ${told || why[0] || 'the reading is uncertain'}` });
      }
    }
    return { warnings, errors: [], disagreements: [] };
  }

  // file -> {slots, validation, studio: {canvas, cells} | null, source} or throws Error(reason)
  async function read(file, subjects, onPhase) {
    onPhase && onPhase('prep', 8, 'Handing it to BunkKro AI on this computer 🤝');
    const started = await call('POST', '/scan?filename=' + encodeURIComponent(file.name || 'upload.png'), file);
    if (!started.ok) throw new Error(started.error || 'the AI did not accept this file');
    await waitForJob(started.job, onPhase);
    // dayorder=1: the site has a Day Order calendar (day-order.js), so a Day 1 .. Day N timetable can be imported
    let res = await call('GET', `/result?job=${started.job}&dayorder=1`);
    const usable = res.choices || [];
    if (res.job && usable.length > 1) {        // several timetables: one per class, year or page
      onPhase && onPhase('fusion', 82, 'This file holds several timetables: choose yours...');
      const file2 = await choose('Which timetable is yours?', 'This file holds several timetables (one per class, year or page).',
        usable.map(c => ({ label: choiceLabel(c), value: c.file })), 'Use this timetable');
      if (file2 === null) throw cancelled('No timetable chosen');
      res = await call('POST', `/export?job=${res.job}&file=${encodeURIComponent(file2)}&dayorder=1`);
    }
    if (!res.ok && res.needs_track) {
      onPhase && onPhase('fusion', 85, 'Several class rows per day: choose yours...');
      const track = await choose('Which row is yours?', 'This timetable prints several class rows per day (sections or batches). Pick yours.',
        res.tracks.map(t => ({ label: t, value: t })), 'Use this row');
      if (track === null) throw cancelled('No class row chosen');
      res = await call('POST', `/export?job=${res.job}&file=${encodeURIComponent(res.file)}&track=${encodeURIComponent(track)}&dayorder=1`);
    }
    if (!res.ok) {
      const err = new Error(res.error || 'The AI could not read this timetable');
      // a page the reader judged not understood is refused on purpose: importing it would invent free periods
      if (res.review && res.review.status === 'failed') Object.assign(err, { refused: true, reasons: res.review.reasons || [] });
      throw err;
    }
    onPhase && onPhase('valid', 90, 'Matching your subjects 🧩');
    const slots = matchSubjects(nameSessions(res.slots), subjects || []);
    const canvas = res.image ? await loadImage(res.image) : null;
    const cells = canvas ? studioCells(slots) : [];
    return { slots, review: res.review || null, validation: issues(slots, res.review), dayOrder: !!res.dayOrder,
      studio: canvas && cells.length ? { canvas, cells } : null, source: res.file, engineVersion };
  }

  // ── labs and practicals ────────────────────────────────────────────────────────────────────────────────────
  // Only what the page prints: a class the timetable calls a lab or a practical. When the same subject also has
  // ordinary classes, the lab gets its own name ('DSA' and 'DSA Lab'), because many colleges count lab attendance on
  // its own; the subjects step can still link both to one subject. Nothing is added when the page says nothing.
  const SESSION_NAME = { lab: 'Lab', practical: 'Practical', tutorial: 'Tutorial' };
  function nameSessions(slots) {
    const key = s => (s.subjectName || '').trim().toLowerCase();
    const plain = new Set(slots.filter(s => !s.isBreak && !s.isUnknown && !SESSION_NAME[s.sessionType]).map(key));
    return slots.map(s => {
      const word = SESSION_NAME[s.sessionType];
      if (!word || s.isBreak || s.isUnknown || !plain.has(key(s))) return s;
      if (new RegExp(`\\b${word}\\b`, 'i').test(s.subjectName)) return s;
      return { ...s, subjectName: `${s.subjectName} ${word}` };
    });
  }

  // ── batch step (only when the timetable has classes for different batches) ─────────────────────────────────
  // The reader marks a class with the batches the page prints for it (`batches`), or as everyone's (`allBatches`);
  // a class that names no batch is for no batch in particular and always stays. A batch family is the code's letters
  // ('A1', 'A2' -> A; 'GR01' -> GR; 'Group 2' -> #). Asked only when a family has two or more batches.
  const family = b => (String(b).match(/^[A-Za-z]*/)[0] || '#').toUpperCase();
  function batchFamilies(slots) {
    const fams = new Map();
    for (const s of slots) {
      if (s.isBreak || !Array.isArray(s.batches)) continue;
      for (const b of s.batches) {
        const f = family(b);
        if (!fams.has(f)) fams.set(f, { codes: new Set(), subjects: new Set() });
        fams.get(f).codes.add(b);
        fams.get(f).subjects.add(s.subjectName);
      }
    }
    const order = (a, b) => a.localeCompare(b, undefined, { numeric: true });
    return [...fams.entries()].filter(([, v]) => v.codes.size >= 2)
      .map(([f, v]) => ({ family: f, codes: [...v.codes].sort(order), subjects: [...v.subjects].sort() }));
  }

  // choice: {family: code, ...} plus optional per-subject overrides {'family|subject': code}
  function keepsFor(s, choice) {
    if (!choice || s.isBreak || s.allBatches || !Array.isArray(s.batches) || !s.batches.length) return true;
    return s.batches.some(b => {
      const f = family(b);
      const mine = choice[`${f}|${s.subjectName}`] || choice[f];
      return !mine || mine === b;          // a family the student didn't pick for: kept
    });
  }

  // a class marked only because another one shares its time is no longer in doubt once the other one is gone
  function settleOverlaps(slots) {
    const clash = (a, b) => a !== b && a.day === b.day && !a.isBreak && !b.isBreak && a.startTime && b.startTime &&
      a.startTime < (b.endTime || b.startTime) && b.startTime < (a.endTime || a.startTime);
    return slots.map(s => {
      if (!s.overlapsAnotherClass || slots.some(o => clash(s, o))) return s;
      const doubt = s.isUnknown || !s.startTime || (s.doubts || []).length > 0;
      return { ...s, overlapsAnotherClass: false, isUncertain: doubt };
    });
  }

  // -> {slots, choice} ; choice null when nothing was asked or the student kept every batch
  function pickBatch(slots) {
    const fams = batchFamilies(slots);
    if (!fams.length) return Promise.resolve({ slots, choice: null });
    const open = slots.filter(s => !s.isBreak && !s.isUnknown && !s.allBatches && !(s.batches || []).length).length;
    const label = f => f.subjects.length <= 4 ? f.subjects.join(', ') : `${f.subjects.slice(0, 3).join(', ')} and ${f.subjects.length - 3} more`;
    return new Promise(resolve => {
      const overlay = modal(`
        <h2>Which batch are you in?</h2>
        <p class="sub">Some classes on this timetable are for one batch only. Pick yours and we'll keep just your classes.</p>
        ${fams.map((f, i) => `
          <div class="mf" style="text-align:left;margin-top:10px">
            <div style="font-size:.78rem;color:var(--muted);margin-bottom:6px">${escapeHtml(label(f))}</div>
            <div class="bk-batch-row" style="display:flex;flex-wrap:wrap;gap:6px" data-fam="${i}" role="radiogroup" aria-label="Your batch for ${escapeHtml(label(f))}">
              ${f.codes.map((c, k) => `<button type="button" class="day-chip${k === 0 ? ' on' : ''}" role="radio" style="min-width:56px;padding:0 14px" aria-checked="${k === 0}"
                 data-code="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}
            </div>
            ${f.subjects.length > 1 ? `<details style="margin-top:6px"><summary style="font-size:.74rem;color:var(--muted);cursor:pointer">Different batch for some subjects?</summary>
              ${f.subjects.map(sub => `<label style="display:flex;justify-content:space-between;gap:8px;font-size:.78rem;margin-top:6px">${escapeHtml(sub)}
                <select data-fam="${i}" data-subject="${escapeHtml(sub)}"><option value="">same as above</option>
                ${f.codes.map(c => `<option>${escapeHtml(c)}</option>`).join('')}</select></label>`).join('')}
            </details>` : ''}
          </div>`).join('')}
        ${open ? `<p class="sub" style="margin-top:10px">${open === 1 ? 'One class doesn\'t' : open + ' classes don\'t'} name a batch, so ${open === 1 ? 'it stays' : 'they stay'} on your timetable.</p>` : ''}
        <div class="modal-btns">
          <button class="btn-sec" data-act="all">Not sure, keep all</button>
          <button class="btn-pri" data-act="ok">That's my batch</button>
        </div>`, 460, 'cat-detective', 'all');
      overlay.addEventListener('click', e => {
        const chip = e.target.closest && e.target.closest('.bk-batch-row .day-chip');
        if (chip) {
          chip.parentElement.querySelectorAll('.day-chip').forEach(p => { p.classList.toggle('on', p === chip); p.setAttribute('aria-checked', p === chip); });
          return;
        }
        const act = e.target.getAttribute && e.target.getAttribute('data-act');
        if (!act) return;
        if (act === 'all') { overlay.remove(); resolve({ slots, choice: null }); return; }
        const choice = {};
        fams.forEach((f, i) => {
          const on = overlay.querySelector(`.bk-batch-row[data-fam="${i}"] .day-chip.on`);
          if (on) choice[f.family] = on.dataset.code;
          overlay.querySelectorAll(`select[data-fam="${i}"]`).forEach(sel => {
            if (sel.value) choice[`${f.family}|${sel.dataset.subject}`] = sel.value;
          });
        });
        overlay.remove();
        resolve({ slots: settleOverlaps(slots.filter(s => keepsFor(s, choice))), choice });
      });
    });
  }

  // ── subjects step ──────────────────────────────────────────────────────────────────────────────────────────
  // groups the classes by name; resolves to [{name, slots, action: 'create'|'link'|'drop'|'keep', subjectId}] or null
  function reviewSubjects(slots, subjects) {
    const groups = new Map();
    const unknown = slots.filter(s => s.isUnknown).length;
    for (const s of slots) {
      if (s.isBreak || s.isUnknown) continue;    // "Needs review" periods stay on the timetable, not as a subject
      // 'MA102', 'MA 102' and 'ma 102' are one subject
      const key = (s.aiName || s.subjectName || '').toUpperCase().replace(/[\s.]+/g, '');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }
    const rows = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
    if (!rows.length) return Promise.resolve([]);
    const options = (sel) => `
      <option value="create" ${sel === 'create' ? 'selected' : ''}>➕ Create as a new subject</option>
      ${subjects.map(x => `<option value="link:${escapeHtml(x.id)}" ${sel === 'link:' + x.id ? 'selected' : ''}>🔗 ${escapeHtml(x.name)}</option>`).join('')}
      <option value="keep">Keep, no subject</option>
      <option value="drop">🚫 Not my class (remove)</option>`;
    return new Promise(resolve => {
      const overlay = modal(`
        <h2>Your subjects</h2>
        <p class="sub">BunkKro AI found these classes. Tidy the names once (e.g. drop teacher or room
          text), link them to subjects you already track, or remove classes that are not yours.</p>
        ${unknown ? `<p class="sub" style="color:var(--warn)">⚠️ ${unknown} period${unknown > 1 ? 's' : ''} could not be confirmed as free.
          ${unknown > 1 ? 'They stay' : 'It stays'} on your timetable as "Needs review": open each one to pick its subject, or delete it if it is a free period.</p>` : ''}
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:12px;text-align:left">
          ${rows.map(([name, list], i) => {
            const linked = list[0].subjectId;
            const days = [...new Set(list.map(s => DAY_SHORT[s.day]))].join(' ');
            return `
            <div class="mf" style="border:1px solid var(--border);border-radius:14px;padding:10px 12px;margin:0">
              <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
                <input data-name="${i}" value="${escapeHtml(linked ? list[0].subjectName : (list[0].aiName || list[0].subjectName || name))}"
                       aria-label="Subject name" style="flex:1;min-width:0" maxlength="60">
                <span class="sync-freq-badge" style="white-space:nowrap" title="${escapeHtml(days)}">${list.length} / week</span>
              </div>
              <div style="font-size:.7rem;color:var(--muted);margin:6px 0">${escapeHtml(days)} · printed: ${escapeHtml(list[0].rawText || name).slice(0, 90)}</div>
              <select data-act-row="${i}" aria-label="What to do with this class">${options(linked ? 'link:' + linked : 'create')}</select>
            </div>`;
          }).join('')}
        </div>
        <div class="modal-btns">
          <button class="btn-sec" data-act="skip">Skip for now</button>
          <button class="btn-pri" data-act="ok">Save subjects</button>
        </div>`, 560, 'cat-books', 'skip');
      overlay.addEventListener('click', e => {
        const act = e.target.getAttribute && e.target.getAttribute('data-act');
        if (!act) return;
        if (act === 'skip') { overlay.remove(); resolve(null); return; }
        const plan = rows.map(([name, list], i) => {
          const choice = overlay.querySelector(`[data-act-row="${i}"]`).value;
          const typed = overlay.querySelector(`[data-name="${i}"]`).value.trim() || name;
          if (choice.startsWith('link:')) return { name: typed, slots: list, action: 'link', subjectId: choice.slice(5) };
          return { name: typed, slots: list, action: choice };
        });
        overlay.remove();
        resolve(plan);
      });
    });
  }

  // status line in the upload card: what the upload will use
  async function showStatus(force = true) {
    // shown in the upload box AND in the green "N classes loaded" bar (the box is hidden once there's a timetable)
    const els = ['tt-ai-status', 'tt-ai-status-loaded'].map(id => document.getElementById(id)).filter(Boolean);
    if (!els.length) return;
    if (!enabled()) { els.forEach(el => { el.innerHTML = ''; }); return; }   // visitors see the upload card as before
    const up = await isAvailable(force);
    // the on/off pill is a developer aid: only on this computer (localhost), never on the live site
    const devHost = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    const input = document.getElementById('tt-file-input');
    if (input) input.accept = up ? 'image/png, image/jpeg, image/jpg, image/webp, application/pdf' : 'image/png, image/jpeg, image/jpg';
    if (!devHost) { els.forEach(el => { el.innerHTML = ''; }); return; }
    els.forEach(el => { el.innerHTML = up
      ? '<span class="pill" title="Reads PDFs, photos and scans on this computer">✨ BunkKro AI on · PDFs &amp; scans welcome</span>'
      : '<span class="pill w" title="Double-click start_bunkkro_ai.bat in the BunkKro-AI folder, then upload again">BunkKro AI off · photos use the built-in scanner</span>'; });
  }

  // why a class is marked "worth a look", in a few words (the popup's quick check)
  function reason(s) {
    if (s.overlapsAnotherClass) return 'another class is at the same time. Keep yours, and delete the other';
    if (!s.startTime) return 'no time is printed for it. Add one if you know it';
    const why = (s.doubts || []).map(d => DOUBT_TEXT[d]).filter(Boolean);
    return (s.reviewReasons || [])[0] || why[0] || 'the reading was a little unclear';
  }

  window.BunkKroAI = { isAvailable, read, reviewSubjects, issues, matchSubjects, reason, showStatus, BASE,
    pickBatch, batchFamilies, keepsFor, settleOverlaps, nameSessions };
  showStatus();
  // re-check only while the Smart Timetable page is open: every 10 s while the AI is on, every 45 s while it's off
  if (enabled()) {
    const tick = async () => {
      const page = document.getElementById('page-timetable');
      if (page && page.classList.contains('active')) await showStatus();
      setTimeout(tick, available ? 10000 : 45000);
    };
    setTimeout(tick, 10000);
  }
})();
