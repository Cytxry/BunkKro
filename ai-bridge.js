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
      available = r.ok && (await r.json()).ok === true;
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
  function modal(html, maxWidth, cat) {
    const overlay = document.createElement('div');
    overlay.className = 'overlay show';
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
        </div>`, 440, 'cat-detective');
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
      const msg = st.state === 'queued' ? 'Waiting for the AI (another timetable is being read)...'
        : total > 1 ? `Reading page ${Math.min(done + 1, total)} of ${total} (scanned pages take about a minute each)...`
          : 'Reading the timetable (a photo or scan takes a minute or two)...';
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
  };

  function issues(slots) {
    const warnings = [];
    for (const s of slots) {
      if (s.isBreak) continue;
      const when = s.startTime ? `${s.startTime}${s.endTime ? '-' + s.endTime : ''}` : `period ${s.period}`;
      const base = { cellId: s.cellId || undefined, details: escapeHtml(s.rawText || s.subjectName) };
      if (s.overlapsAnotherClass) {
        warnings.push({ ...base, message: `${DAY_SHORT[s.day]} ${when}: two classes at the same time — keep yours` });
      } else if (!s.startTime) {
        warnings.push({ ...base, message: `${DAY_SHORT[s.day]} period ${s.period}: no time printed for this class` });
      } else if (s.isUncertain) {
        const why = (s.doubts || []).map(d => DOUBT_TEXT[d]).filter(Boolean);
        warnings.push({ ...base, message: `${DAY_SHORT[s.day]} ${when}: please check — ${why[0] || 'the reading is uncertain'}` });
      }
    }
    return { warnings, errors: [], disagreements: [] };
  }

  // file -> {slots, validation, studio: {canvas, cells} | null, source} or throws Error(reason)
  async function read(file, subjects, onPhase) {
    onPhase && onPhase('prep', 8, 'Sending the timetable to BunkKro AI on this computer...');
    const started = await call('POST', '/scan?filename=' + encodeURIComponent(file.name || 'upload.png'), file);
    if (!started.ok) throw new Error(started.error || 'the AI did not accept this file');
    await waitForJob(started.job, onPhase);
    let res = await call('GET', `/result?job=${started.job}`);
    const usable = (res.choices || []).filter(c => !c.day_order);
    if (res.job && usable.length > 1) {        // several timetables: one per class, year or page
      onPhase && onPhase('fusion', 82, 'This file holds several timetables: choose yours...');
      const file2 = await choose('Which timetable is yours?', 'This file holds several timetables (one per class, year or page).',
        usable.map(c => ({ label: choiceLabel(c), value: c.file })), 'Use this timetable');
      if (file2 === null) throw cancelled('No timetable chosen');
      res = await call('POST', `/export?job=${res.job}&file=${encodeURIComponent(file2)}`);
    }
    if (!res.ok && res.needs_track) {
      onPhase && onPhase('fusion', 85, 'Several class rows per day: choose yours...');
      const track = await choose('Which row is yours?', 'This timetable prints several class rows per day (sections or batches). Pick yours.',
        res.tracks.map(t => ({ label: t, value: t })), 'Use this row');
      if (track === null) throw cancelled('No class row chosen');
      res = await call('POST', `/export?job=${res.job}&file=${encodeURIComponent(res.file)}&track=${encodeURIComponent(track)}`);
    }
    if (!res.ok) throw new Error(res.error || 'The AI could not read this timetable');
    onPhase && onPhase('valid', 90, 'Loading the page and matching your subjects...');
    const slots = matchSubjects(res.slots, subjects || []);
    const canvas = res.image ? await loadImage(res.image) : null;
    const cells = canvas ? studioCells(slots) : [];
    return { slots, validation: issues(slots), studio: canvas && cells.length ? { canvas, cells } : null, source: res.file };
  }

  // ── subjects step ──────────────────────────────────────────────────────────────────────────────────────────
  // groups the classes by name; resolves to [{name, slots, action: 'create'|'link'|'drop'|'keep', subjectId}] or null
  function reviewSubjects(slots, subjects) {
    const groups = new Map();
    for (const s of slots) {
      if (s.isBreak) continue;
      // 'MA102', 'MA 102' and 'ma 102' are one subject
      const key = (s.aiName || s.subjectName || '').toUpperCase().replace(/[s.]+/g, '');
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
        </div>`, 560, 'cat-books');
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
  async function showStatus() {
    const el = document.getElementById('tt-ai-status');
    if (!el) return;
    if (!enabled()) { el.innerHTML = ''; return; }        // visitors see the upload card exactly as before
    const up = await isAvailable(true);
    el.innerHTML = up
      ? '<span class="pill" title="Reads PDFs, photos and scans on this computer">✨ BunkKro AI on · PDFs &amp; scans welcome</span>'
      : '<span class="pill w" title="Double-click start_bunkkro_ai.bat in the BunkKro-AI folder, then upload again">BunkKro AI off · photos use the built-in scanner</span>';
    const input = document.getElementById('tt-file-input');
    if (input) input.accept = up ? 'image/png, image/jpeg, image/jpg, image/webp, application/pdf' : 'image/png, image/jpeg, image/jpg';
  }

  window.BunkKroAI = { isAvailable, read, reviewSubjects, issues, BASE };
  showStatus();
  if (enabled()) setInterval(showStatus, 10000);
})();
