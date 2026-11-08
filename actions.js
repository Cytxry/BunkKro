/* Event handlers without inline JavaScript (for the Content-Security-Policy: no 'unsafe-inline', no 'unsafe-eval').
 *
 * Markup says what to call, as data:  <button data-on-click="goPage('home')">
 * and this file calls it. Nothing is evaluated: the call is parsed (a function name, then plain arguments: strings,
 * numbers, true / false / null, `this` (the element), `event`, `this.value`, `this.checked`, `this.files[0]`), and
 * only functions on the ALLOWED list can be called. Anything else is refused and logged.
 *
 * Handlers are attached to the element itself, the first time an event of that type starts anywhere on the page
 * (window, capture phase: before the event reaches the element), so they run exactly like the inline handlers they
 * replace: on the element, in bubbling order, and event.stopPropagation() still works.
 *
 * Also here: the few handlers that did more than one call, and the on-demand loading of the built-in scanner's
 * library (Tesseract.js), pinned to an exact version with an integrity hash. OpenCV.js is not loaded: it needs eval.
 */
(function () {
  'use strict';
  const EVENTS = ['click', 'change', 'input', 'submit', 'keydown'];
  // every function the site's markup calls (and nothing else)
  const ALLOWED = new Set([
    'BunkKroImport.checkNext', 'BunkKroImport.confirm', 'BunkKroImport.putBack', 'BunkKroImport.setSharing',
    'addPlannedHolidays', 'adjSim', 'applyWeeklyFrequencies', 'closeAddModal', 'closeAsk', 'closeCellInspector',
    'closeCooked', 'closeDaySwap', 'closeDeleteModal', 'closeExtraClassModal', 'closeHolidayPlanner', 'closePopover',
    'closeReschedule', 'closeSafeBunks', 'closeSemesterDialog', 'closeSharePack', 'closeSlotEditModal',
    'closeSyncFrequenciesModal', 'closeTtConfirmModal', 'confirmAdd', 'confirmAddExtraClass', 'confirmClearTimetable',
    'confirmDaySwap', 'confirmDeleteSubject', 'confirmImportPack', 'confirmProceedScan', 'confirmReschedule',
    'copyPackCode', 'createSubjectFromInspector', 'deleteCurrentSlot', 'deleteSubject', 'downloadPack', 'goPage',
    'handleAuth', 'handleLogout', 'holClear', 'holShiftMonth', 'inspectorDeleteCell', 'inspectorSplitCell',
    'inspectorToggleBreak', 'markPeriodAttendance', 'markSlotFree', 'markSlotRight', 'nativeSharePack', 'navDate',
    'obAddRow', 'obBack', 'obFinish', 'obNext', 'onDateSelected', 'onDayChip', 'onInspectorSubjectChange',
    'onPackFile', 'onPackText', 'onSlotSubjectSelect', 'onSlotTypeChange', 'openAddModal', 'openAddSlotModal',
    'openCellInspector', 'openCooked', 'openDaySwap', 'openEditCard', 'openEditSlotModal', 'openExtraClassModal',
    'openHolidayPlanner', 'openReplaceDialog', 'openSafeBunks', 'openSemesterDialog', 'openSharePack',
    'openStreakCalendar', 'openTodayTracker', 'openTrackerOn', 'removeMakeup', 'removePlannedHoliday',
    'renameSlotSubject', 'resetSim', 'resetToToday', 'saveCellInspectorChanges', 'saveSemesterDialog', 'saveSlotModal',
    'saveSubject', 'selAddMode', 'selMode', 'setEditMode', 'setUpto', 'shiftCalMonth', 'showReschedulePick',
    'startChipEdit', 'switchShareTab', 'switchTimetableTab', 'toggleAuthMode', 'toggleDateHoliday',
    'toggleProfileMenu', 'toggleSidebar', 'toggleSundayDisplay', 'toggleTheme', 'updateGlobalTarget',
    'updateRoundMode', 'updateSim',
    // below: the handlers that used to be more than one call
    'pickTimetableFile', 'openTimetablePicker', 'keyActivate', 'closeSafeBunksAndGo', 'removeSetupRow',
    'studioSelectCell'
  ]);

  // ── the call parser ──────────────────────────────────────────────────────────────────────────────────────────
  const cache = new Map();
  function parse(src) {
    if (cache.has(src)) return cache.get(src);
    const m = /^\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(([\s\S]*)\)\s*;?\s*$/.exec(src);
    if (!m) throw new Error('not a single call');
    const args = [];
    const s = m[2];
    let i = 0;
    const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
    ws();
    while (i < s.length) {
      const c = s[i];
      if (c === '"' || c === "'") {
        let out = '';
        i++;
        while (i < s.length && s[i] !== c) {
          if (s[i] === '\\' && i + 1 < s.length) { out += s[i + 1]; i += 2; } else out += s[i++];
        }
        if (s[i] !== c) throw new Error('unclosed string');
        i++;
        args.push(() => out);
      } else {
        const t = /^(-?\d+(?:\.\d+)?|true|false|null|undefined|event|this(?:\.(?:value|checked|files\[0\]))?)(?![\w$.\[])/.exec(s.slice(i));
        if (!t) throw new Error(`unsupported argument at "${s.slice(i, i + 20)}"`);
        i += t[1].length;
        const tok = t[1];
        if (/^-?\d/.test(tok)) { const n = Number(tok); args.push(() => n); }
        else if (tok === 'true') args.push(() => true);
        else if (tok === 'false') args.push(() => false);
        else if (tok === 'null') args.push(() => null);
        else if (tok === 'undefined') args.push(() => undefined);
        else if (tok === 'event') args.push((el, e) => e);
        else if (tok === 'this') args.push(el => el);
        else if (tok === 'this.value') args.push(el => el.value);
        else if (tok === 'this.checked') args.push(el => el.checked);
        else args.push(el => (el.files ? el.files[0] : undefined));
      }
      ws();
      if (i < s.length) {
        if (s[i] !== ',') throw new Error(`expected "," at "${s.slice(i, i + 20)}"`);
        i++;
        ws();
      }
    }
    const call = { name: m[1], args };
    cache.set(src, call);
    return call;
  }

  function run(el, type, event) {
    const src = el.getAttribute('data-on-' + type);
    if (!src) return;
    let call;
    try { call = parse(src); } catch (err) { console.warn('BunkKro: refused handler', JSON.stringify(src), err.message); return; }
    if (!ALLOWED.has(call.name)) { console.warn('BunkKro: refused handler (not allowed)', call.name); return; }
    const path = call.name.split('.');
    let owner = window;
    for (const p of path.slice(0, -1)) owner = owner && owner[p];
    const fn = owner && owner[path[path.length - 1]];
    if (typeof fn !== 'function') { console.warn('BunkKro: no such handler', call.name); return; }
    return fn.apply(owner === window ? el : owner, call.args.map(a => a(el, event)));
  }

  const bound = new WeakMap();
  function bind(el) {
    if (!el || el.nodeType !== 1) return;
    for (const type of EVENTS) {
      if (!el.hasAttribute('data-on-' + type)) continue;
      let set = bound.get(el);
      if (!set) bound.set(el, set = new Set());
      if (set.has(type)) continue;
      set.add(type);
      el.addEventListener(type, function (event) { return run(el, type, event); });
    }
  }
  // before an event reaches any element on its path, that element's handlers are attached
  for (const type of EVENTS) {
    window.addEventListener(type, event => {
      const path = event.composedPath ? event.composedPath() : [];
      for (const node of path) bind(node);
    }, true);
  }

  // ── the handlers that did more than one thing ────────────────────────────────────────────────────────────────
  window.pickTimetableFile = function (input) {
    const file = input && input.files && input.files[0];
    if (file && typeof handleTimetableFileUpload === 'function') handleTimetableFileUpload(file);
    if (input) input.value = '';
  };
  window.openTimetablePicker = function () {
    const input = document.getElementById('tt-file-input');
    if (input) input.click();
  };
  window.keyActivate = function (event, el) {               // a div acting as a button: Enter / Space press it
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); el.click(); }
  };
  window.closeSafeBunksAndGo = function (subjectId) {
    if (typeof closeSafeBunks === 'function') closeSafeBunks();
    if (typeof goPage === 'function') goPage('subject', subjectId);
  };
  window.removeSetupRow = function (el) {
    const row = el && el.closest('.subj-setup-row');
    if (row) row.remove();
  };
  window.studioSelectCell = function (cellId) {
    if (typeof switchTimetableTab === 'function') switchTimetableTab('studio');
    if (typeof scannerState !== 'undefined') scannerState.selectedCellId = cellId;
    if (typeof renderStudioCanvas === 'function') renderStudioCanvas();
  };

  // ── the built-in scanner's libraries, only when the scanner runs ─────────────────────────────────────────────
  // Most visits never need it. Exact version, checked by hash: a changed CDN file is refused, not run.
  const LIBS = {
    tesseract: { src: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
      integrity: 'sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F', ready: () => !!window.Tesseract }
  };
  const loading = {};
  function load(name, timeoutMs) {
    const lib = LIBS[name];
    if (lib.ready()) return Promise.resolve(true);
    if (!loading[name]) {
      loading[name] = new Promise(resolve => {
        const s = document.createElement('script');
        s.src = lib.src;
        s.integrity = lib.integrity;
        s.crossOrigin = 'anonymous';
        s.async = true;
        s.onerror = () => resolve(false);
        s.onload = () => resolve(true);
        document.head.appendChild(s);
      }).then(ok => {
        if (!ok) return false;
        if (lib.ready()) return true;
        return new Promise(resolve => {
          const t0 = Date.now();
          (function wait() {
            if (lib.ready()) return resolve(true);
            if (Date.now() - t0 > timeoutMs) return resolve(false);
            setTimeout(wait, 150);
          })();
        });
      });
    }
    return loading[name];
  }
  // Tesseract only. OpenCV.js needs eval, which the site's Content-Security-Policy refuses (no 'unsafe-eval'), and
  // it didn't help: on a clean, slightly tilted photo the scanner read 35 scraps with it and 1 class without
  // (docs/engineering/m10_security/README.md, M11 CSP). The scanner uses its own straightening instead.
  window.loadScannerLibs = async function () {
    const tess = await load('tesseract', 15000);
    window.cvLoadFailed = true;
    return { tesseract: tess, opencv: false };
  };

  window.BunkActions = { parse, ALLOWED, bind };
})();
