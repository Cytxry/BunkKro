// Settings and pricing pages. Uses the app's globals from bunkke.js (currentUser, supabaseClient, askDialog, toast,
// globalTarget, roundMode, semStart/semEnd, updateUser...). Every handler here is on the actions.js ALLOWED list.

// Shown under Help & legal as "Contact us" once set (e.g. 'support@yourdomain.in'); the row stays hidden while empty.
const BK_SUPPORT_EMAIL = '';

// ── theme: light / dark / system (theme-init.js applies it before the first paint) ───────────────────────────────
function themeMode() {
  try { const t = localStorage.getItem('bk_theme'); return t === 'dark' || t === 'system' ? t : 'light'; } catch (e) { return 'light'; }
}
const bkDarkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
function applyThemeMode() {
  const m = themeMode();
  const dark = m === 'dark' || (m === 'system' && bkDarkQuery && bkDarkQuery.matches);
  if (dark) document.documentElement.dataset.theme = 'dark'; else delete document.documentElement.dataset.theme;
  if (typeof applyThemeIcon === 'function') applyThemeIcon();
}
bkDarkQuery?.addEventListener?.('change', () => { if (themeMode() === 'system') applyThemeMode(); });
function setThemeMode(m) {
  try { localStorage.setItem('bk_theme', m); } catch (e) { /* private mode */ }
  applyThemeMode();
  renderSettings();
}

function setSeg(id, value) {
  document.querySelectorAll(`#${id} [role="radio"]`).forEach(b => {
    const on = b.dataset.v === value;
    b.setAttribute('aria-checked', String(on));
    b.classList.toggle('on', on);
  });
}

// ── settings page ───────────────────────────────────────────────────────────────────────────────────────────────
function renderSettings() {
  if (!document.getElementById('page-settings')) return;
  const u = currentUser || {};
  const m = u.user_metadata || {};
  const email = u.email || '';
  const name = (m.full_name || m.name || '').trim() || (email ? email.split('@')[0] : 'Account');
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('set-name', name);
  set('set-email', email);
  const av = document.getElementById('set-avatar');
  if (av) {
    const pic = m.avatar_url || m.picture || '';
    av.textContent = name.charAt(0).toUpperCase();
    av.style.backgroundImage = pic ? `url("${encodeURI(pic)}")` : '';
    av.classList.toggle('has-pic', !!pic);
  }
  const providers = u.app_metadata?.providers || [u.app_metadata?.provider].filter(Boolean);
  const google = providers.includes('google'), pass = providers.includes('email') || !providers.length;
  set('set-method', google && pass ? 'Google, or your email and password' : google ? 'Google' : 'Email and password');
  const pw = document.getElementById('set-password-row');
  if (pw) pw.hidden = !pass;

  const t = document.getElementById('set-target');
  if (t && document.activeElement !== t) t.value = globalTarget;
  setSeg('set-round', roundMode);
  set('set-round-hint', roundMode === 'up' ? '74.2% counts as 75%.' : roundMode === 'exact' ? '74.6% stays 74.6%.' : '74.6% counts as 74%.');
  const fmt = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  set('set-sem', typeof semStart !== 'undefined' && semStart
    ? `${fmt(semStart)}${typeof semEnd !== 'undefined' && semEnd ? ' to ' + fmt(semEnd) : ''}` : 'Not set yet. The bunk planner works better with them.');

  setSeg('set-theme', themeMode());

  const ai = document.getElementById('set-local-ai');
  if (ai) { try { ai.checked = localStorage.getItem('bk_local_ai') === '1'; } catch (e) { ai.checked = false; } }
  const share = document.getElementById('set-share-fixes');
  if (share) share.checked = !!window.BunkKroImport?.sharing?.();

  set('set-plan-desc', m.bk_pro_waitlist ? "Everything you need to track attendance. You're on the list for Pro."
    : 'Everything you need to track attendance. Pro is on its way.');

  const row = document.getElementById('set-contact-row');
  if (row) {
    row.hidden = !BK_SUPPORT_EMAIL;
    if (BK_SUPPORT_EMAIL) document.getElementById('set-contact').href = 'mailto:' + BK_SUPPORT_EMAIL + '?subject=' + encodeURIComponent('BunkKro');
  }
}

async function editDisplayName() {
  const cur = (currentUser?.user_metadata?.full_name || '').trim();
  const v = await askDialog({ title: 'Your name', message: 'Shown on your home page and in the account menu.',
    ok: 'Save name', cat: 'cat-happy', input: { label: 'Name', placeholder: cur || 'Your name' } });
  if (typeof v !== 'string') return;
  const name = v.trim().slice(0, 60);
  if (!name) { toast('Type a name first', 'err'); return; }
  const { data, error } = await supabaseClient.auth.updateUser({ data: { full_name: name } });
  if (error) { toast("Couldn't save your name: " + error.message, 'err'); return; }
  if (data?.user) currentUser = data.user;
  renderProfile(); renderSettings();
  if (typeof renderHome === 'function' && currPage === 'home') renderHome();
  toast('Name saved ✓');
}

async function changePassword() {
  const v = await askDialog({ title: 'Change your password', message: 'At least 6 characters. You stay logged in here.',
    ok: 'Save new password', cat: 'cat-detective', input: { label: 'New password', type: 'password', placeholder: '••••••••' } });
  if (typeof v !== 'string') return;
  if (v.length < 6) { toast('At least 6 characters — try again', 'err'); return; }
  const { error } = await supabaseClient.auth.updateUser({ password: v });
  if (error) { toast("Couldn't change it: " + error.message, 'err'); return; }
  toast('Password changed ✓');
}

async function logoutEverywhere() {
  const ok = await askDialog({ title: 'Log out everywhere?', message: 'Your login ends on every device and in the extension. ' +
    'Your data stays. You log in again to use BunkKro.', ok: 'Log out everywhere', danger: true, cat: 'cat-peek' });
  if (!ok) return;
  const { error } = await supabaseClient.auth.signOut({ scope: 'global' });
  if (error) { toast("Couldn't log out everywhere: " + error.message, 'err'); return; }
  location.reload();
}

function setLocalAi(on) {
  try { if (on) localStorage.setItem('bk_local_ai', '1'); else localStorage.removeItem('bk_local_ai'); } catch (e) { /* private mode */ }
  toast(on ? 'BunkKro AI on: start it on this computer to read timetables' : 'Using the built-in scanner');
  window.BunkKroAI?.showStatus?.();
}

async function setFixSharing(on) {
  if (!window.BunkKroImport?.setSharing) return;
  await window.BunkKroImport.setSharing(!!on);
  toast(on ? 'Thanks! Your fixes help BunkKro AI learn' : 'Off. What you shared is deleted');
  renderSettings();
}

// Everything the student stored, as one JSON file (their right to a copy of their data). Read with their own
// login, so row-level security returns only their rows. No tokens are included.
async function downloadMyData() {
  if (!currentUser) return;
  const btn = document.getElementById('set-export');
  if (btn) btn.disabled = true;
  const tables = ['subjects', 'timetables', 'timetable_entries', 'daily_period_logs', 'tracker_logs', 'timetable_exceptions',
                  'timetable_imports', 'timetable_feedback'];
  const out = { exported_at: new Date().toISOString(), account: { id: currentUser.id, email: currentUser.email,
    created_at: currentUser.created_at, settings: currentUser.user_metadata || {} } };
  const failed = [];
  for (const t of tables) {
    const { data, error } = await supabaseClient.from(t).select('*').eq('user_id', currentUser.id);
    if (error) { if (!/42P01|PGRST20[25]/.test(error.code || '')) failed.push(t); continue; }
    out[t] = data || [];
  }
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bunkkro-data-${getLocalDateString()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  if (btn) btn.disabled = false;
  if (failed.length) toast(`Downloaded, but ${failed.join(', ')} couldn't be read. Try again later.`, 'err');
  else toast('Your data is downloaded ✓');
}

function startTour() {
  goPage('home');
  setTimeout(() => window.BunkGuide?.tour?.(), 300);
}

// ── pricing page ────────────────────────────────────────────────────────────────────────────────────────────────
let pricePeriod = 'sem';
function setPricePeriod(p) { pricePeriod = p === 'month' ? 'month' : 'sem'; renderPricing(); }
function renderPricing() {
  setSeg('price-period', pricePeriod);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  if (pricePeriod === 'month') { set('pro-amt', '₹49'); set('pro-per', 'a month'); set('pro-note', 'Billed monthly. Cancel any time.'); }
  else { set('pro-amt', '₹199'); set('pro-per', 'a semester'); set('pro-note', '6 months for ₹199, about ₹33 a month.'); }
  const on = !!currentUser?.user_metadata?.bk_pro_waitlist;
  const cta = document.getElementById('pro-cta');
  if (cta) { cta.disabled = on; cta.textContent = on ? "You're on the list ✓" : 'Tell me when Pro launches'; }
  set('pro-fine', on ? `We'll email ${currentUser?.email || 'you'} once, when it's ready.` : "No payment now. We'll email you once.");
}

async function joinProWaitlist() {
  if (!currentUser) return;
  const cta = document.getElementById('pro-cta');
  if (cta) cta.disabled = true;
  const { data, error } = await supabaseClient.auth.updateUser({ data: { bk_pro_waitlist: new Date().toISOString(), bk_pro_period: pricePeriod } });
  if (error) { if (cta) cta.disabled = false; toast("Couldn't add you: " + error.message, 'err'); return; }
  if (data?.user) currentUser = data.user;
  renderPricing();
  if (window.BunkFx && cta) BunkFx.float(cta, '✨');
  toast("You're on the list ✨");
}
