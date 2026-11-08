// Batch step and lab naming (ai-bridge.js), run in Node:  node tests/ai-batch-check.js
// Loads ai-bridge.js in a sandbox with a stub page and checks the pure parts: which classes a batch choice keeps,
// when the step is asked at all, overlap marks after a pick, and lab / practical naming.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = {
  window: {}, location: { protocol: 'http:', hostname: 'localhost' }, console,
  document: { getElementById: () => null, querySelector: () => null, addEventListener() {} },
  localStorage: { getItem: () => null, setItem() {} }, fetch: async () => ({ ok: false, json: async () => ({}) }),
  setTimeout: () => 0, AbortController: class { abort() {} get signal() { return {}; } }, URL,
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'ai-bridge.js'), 'utf8'), sandbox);
const AI = sandbox.BunkKroAI;

let failed = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};
let n = 0;
const slot = (subjectName, extra = {}) => ({ id: `s${++n}`, day: 1, startTime: '11:00', endTime: '12:00', subjectName,
  isBreak: false, isUnknown: false, isUncertain: false, doubts: [], ...extra });

// the acceptance timetable's boxes, as the export gives them
const a1 = slot('DSA', { batches: ['A1'], sessionType: 'lab', alternativeGroup: 'g1', overlapsAnotherClass: true, isUncertain: true });
const a2 = slot('OS', { batches: ['A2'], sessionType: 'lab', alternativeGroup: 'g1', overlapsAnotherClass: true, isUncertain: true });
const shared = slot('DSA', { batches: ['A1', 'A2'], sessionType: 'lab', startTime: '10:00', endTime: '11:00' });
const all = slot('Mathematics', { allBatches: true, startTime: '13:00', endTime: '14:00' });
const plain = slot('DSA', { startTime: '09:00', endTime: '10:00' });
const lab = slot('DSA', { sessionType: 'lab', day: 5, startTime: '09:00', endTime: '10:00' });
const page = [a1, a2, shared, all, plain, lab];

// asked only when a family has two or more batches
eq('families', AI.batchFamilies(page).map(f => [f.family, f.codes]), [['A', ['A1', 'A2']]]);
eq('no batches: not asked', AI.batchFamilies([plain, lab, all]).length, 0);
eq('one batch only: not asked', AI.batchFamilies([shared].map(s => ({ ...s, batches: ['A1'] }))).length, 0);

// picking A1: A2's lab goes; the shared lab, the all-batches class and classes naming no batch stay
const keep = c => page.filter(s => AI.keepsFor(s, c)).map(s => s.id);
eq('A1 keeps its own, shared, all and unnamed', keep({ A: 'A1' }), [a1.id, shared.id, all.id, plain.id, lab.id]);
eq('A2', keep({ A: 'A2' }), [a2.id, shared.id, all.id, plain.id, lab.id]);
eq('A3 is not in the shared lab', AI.keepsFor(shared, { A: 'A3' }), false);
eq('keep all', keep(null).length, page.length);
// per-subject override: A1 in general, A2 for OS
eq('override for one subject', keep({ A: 'A1', 'A|OS': 'A2' }), [a1.id, a2.id, shared.id, all.id, plain.id, lab.id]);
// another family isn't touched by a pick in this one
eq('other family untouched', AI.keepsFor(slot('CN', { batches: ['B1'] }), { A: 'A1' }), true);
eq('French GR01 family', AI.batchFamilies([slot('X', { batches: ['GR01'] }), slot('Y', { batches: ['GR02'] })])[0].family, 'GR');

// after the pick, the "two classes at once" mark goes from the class that is now alone
const left = AI.settleOverlaps(page.filter(s => AI.keepsFor(s, { A: 'A1' })));
const mine = left.find(s => s.id === a1.id);
eq('overlap mark cleared', [mine.overlapsAnotherClass, mine.isUncertain], [false, false]);
const doubtful = AI.settleOverlaps([{ ...a1, doubts: ['split_suspect'] }]);
eq('a real doubt stays', doubtful[0].isUncertain, true);
const still = AI.settleOverlaps([a1, a2]);
eq('both still there: still marked', still.map(s => s.overlapsAnotherClass), [true, true]);

// labs: own name only when the same subject also has ordinary classes, and only what the page says
const named = AI.nameSessions([plain, lab, slot('OS', { sessionType: 'practical' }), slot('CN Lab', { sessionType: 'lab' }),
  slot('CN Lab', {})]);
eq('lab and practical names', named.map(s => s.subjectName), ['DSA', 'DSA Lab', 'OS', 'CN Lab', 'CN Lab']);
eq('no lab invented', AI.nameSessions([slot('DSA'), slot('DSA')]).map(s => s.subjectName), ['DSA', 'DSA']);

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exitCode = failed ? 1 : 0;
