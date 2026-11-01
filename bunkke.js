const SUPABASE_URL = "https://mvlyeygitnnuksuxmcsy.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_OrUBxAQ1tk1wqI6HQ7SIPA_bYwohXlf";

let supabaseClient;
let authListenerInitialized = false;

// INIT ONLY ONCE
if (!window.supabase) {
  console.error("❌ Supabase CDN not loaded");
} else {
  supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);
  console.log("✅ Supabase initialized");
}

window.addEventListener('online', () => toast('Back online'));
window.addEventListener('offline', () => toast('You are offline', 'err'));

function isOnline() {
  return navigator.onLine;
}

// ✅ CALL AFTER DOM LOADS
window.addEventListener('DOMContentLoaded', () => {
  DOM.init();
  initAuth();
});


// ══════════════════════════════════════════════════════
//  SESSION STORAGE HELPER
// ══════════════════════════════════════════════════════
function storeSession(session) {
  if (!session) {
    console.warn('⚠️ Attempted to store null session');
    localStorage.removeItem('sb-session');
    return false;
  }

  try {
    const sessionData = JSON.stringify(session);
    localStorage.setItem('sb-session', sessionData);
    console.log('✅ Session stored in localStorage');
    
    // Send to extension
    sendSessionToExtension(session);
    
    return true;
  } catch (error) {
    console.error('❌ Failed to store session:', error);
    return false;
  }
}

function sendSessionToExtension(session) {
  if (!window.chrome?.runtime) {
    console.log('ℹ️ Chrome extension API not available');
    return;
  }

  try {
    chrome.runtime.sendMessage(
      {
        type: 'SET_SESSION',
        session: session
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn('⚠️ Extension not available:', chrome.runtime.lastError.message);
        } else {
          console.log('✅ Session sent to extension');
        }
      }
    );
  } catch (error) {
    console.warn('⚠️ Failed to send to extension:', error.message);
  }
}

// Auth state
let currentUser = null;
let isAuthMode = 'login'; // 'login' or 'signup'
// Check session on page load
// ══════════════════════════════════════════════════════
//  INIT AUTH - FIXED TO PREVENT DUPLICATE LISTENERS
// ══════════════════════════════════════════════════════
async function initAuth() {
  try {
    // 🔥 listen for auth changes (this is the real source of truth)
    // Supabase also fires this on token refresh and when the tab regains
    // focus; showApp() only reloads data when the signed-in user changes.
    supabaseClient.auth.onAuthStateChange((event, session) => {
      if (session) {
        currentUser = session.user;
        localStorage.setItem('sb-session', JSON.stringify(session));
        setTimeout(() => showApp(), 0);
      } else {
        appLoadedFor = null;
        showAuthModal();
      }
    });

    // ⚠️ OPTIONAL: just check once, but DO NOT DELETE STORAGE
    const { data: { session } } = await supabaseClient.auth.getSession();

    console.log("Initial session:", session);

    if (session) {
      currentUser = session.user;
      localStorage.setItem('sb-session', JSON.stringify(session));
      showApp();
    } else {
      showAuthModal();
    }

  } catch (error) {
    console.error('Auth error:', error);
    showAuthModal();
  }
}


// ══════════════════════════════════════════════════════
//  ✨ SUPABASE DATA FUNCTIONS
// ══════════════════════════════════════════════════════

let subjects = []; // Keep this global variable

// Load subjects from Supabase
async function loadSubjects() {
  if (!currentUser) return;
  
  try {
    const { data, error } = await supabaseClient
      .from('subjects') // ✅ FIXED
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: true });
    
    if (error) throw error;
    
    subjects = (data || []).map(s => ({
      id: s.id,
      name: s.name || '',
      code: s.code || (s.name || '').slice(0,2).toUpperCase() + '101',
      total: s.total || 0,
      present: s.present || 0,
      perWeek: s.per_week || 0,
      target: s.target || null,
      semTotal: s.sem_total || null,
      mode: s.mode || 'exact'
    }));
    
    renderAll();
  } catch (error) {
    console.error('Error loading subjects:', error);
    subjects = [];
  }
}

// ══════════════════════════════════════════════════════
//  ✨ LOAD TIMETABLE, TRACKER & EXCEPTIONS FROM SUPABASE
// ══════════════════════════════════════════════════════

let timetable = [];
let timetableMeta = { id: null, title: 'Weekly Timetable', showSunday: false };
let dailyPeriodLogs = {}; // date -> { [entryId]: { status: 'p'|'a'|'c', subjectId, periodIndex, isExtra, extraName } }
let dateExceptions = {}; // date -> { type: 'holiday', note: '' }
let selectedTrackerDate = ''; // YYYY-MM-DD

function getLocalDateString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Load Timetable from Supabase (with localStorage fallback)
async function loadTimetable() {
  if (!currentUser) return;

  try {
    // 1. Fetch active timetable
    const { data: ttData, error: ttError } = await supabaseClient
      .from('timetables')
      .select('*')
      .eq('user_id', currentUser.id)
      .limit(1);

    if (ttError && ttError.code !== 'PGRST116') {
      console.warn('Timetables table not accessible, using cached:', ttError.message);
    }

    if (ttData && ttData.length > 0) {
      timetableMeta = { id: ttData[0].id, title: ttData[0].title || 'Weekly Timetable', showSunday: false };
    }

    // 2. Fetch timetable entries
    const { data: entriesData, error: entriesError } = await supabaseClient
      .from('timetable_entries')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('day_of_week', { ascending: true })
      .order('period_index', { ascending: true });

    if (!entriesError && entriesData) {
      timetable = entriesData.map(e => ({
        id: e.id,
        day: e.day_of_week,
        period: e.period_index,
        startTime: e.start_time || '',
        endTime: e.end_time || '',
        subjectId: e.subject_id,
        subjectName: e.subject_name,
        isBreak: e.is_break || false,
        isUncertain: false
      }));
      localStorage.setItem('bk_timetable_' + currentUser.id, JSON.stringify(timetable));
    } else {
      // Offline / cached fallback
      const cached = localStorage.getItem('bk_timetable_' + currentUser.id);
      if (cached) timetable = JSON.parse(cached);
    }
  } catch (error) {
    console.warn('Error loading timetable:', error);
    const cached = localStorage.getItem('bk_timetable_' + (currentUser ? currentUser.id : ''));
    if (cached) timetable = JSON.parse(cached);
  }

  // Check if any sunday entry exists
  if (timetable.some(t => t.day === 7)) {
    timetableMeta.showSunday = true;
  }
}

// Load Daily Period Logs & Legacy Tracker
async function loadDailyPeriodLogs() {
  if (!currentUser) return;
  
  dailyPeriodLogs = {};
  
  try {
    const { data, error } = await supabaseClient
      .from('daily_period_logs')
      .select('*')
      .eq('user_id', currentUser.id);
    
    if (!error && data) {
      data.forEach(row => {
        if (!dailyPeriodLogs[row.date]) dailyPeriodLogs[row.date] = {};
        const key = row.entry_id || row.subject_id;
        const isExtra = String(row.entry_id || '').startsWith('extra_');
        dailyPeriodLogs[row.date][key] = {
          status: row.status,
          subjectId: row.subject_id,
          periodIndex: row.period_index || 1,
          entryId: row.entry_id,
          ...(isExtra ? { isExtra: true, extraName: subjects.find(x => x.id === row.subject_id)?.name || 'Extra Class' } : {})
        };
      });
      localStorage.setItem('bk_daily_period_logs_' + currentUser.id, JSON.stringify(dailyPeriodLogs));
    } else {
      const cached = localStorage.getItem('bk_daily_period_logs_' + currentUser.id);
      if (cached) dailyPeriodLogs = JSON.parse(cached);
    }
  } catch (err) {
    console.warn('Error loading daily period logs:', err);
    const cached = localStorage.getItem('bk_daily_period_logs_' + (currentUser ? currentUser.id : ''));
    if (cached) dailyPeriodLogs = JSON.parse(cached);
  }
}

// Load Date Exceptions (Holidays, etc.)
async function loadDateExceptions() {
  if (!currentUser) return;
  dateExceptions = {};

  try {
    const { data, error } = await supabaseClient
      .from('timetable_exceptions')
      .select('*')
      .eq('user_id', currentUser.id);

    if (!error && data) {
      data.forEach(row => {
        dateExceptions[row.date] = {
          type: row.type,
          note: row.note || '',
          ...(row.type === 'custom_day' ? { plan: parseDayPlan(row.note) } : {})
        };
      });
      localStorage.setItem('bk_date_exceptions_' + currentUser.id, JSON.stringify(dateExceptions));
    } else {
      const cached = localStorage.getItem('bk_date_exceptions_' + currentUser.id);
      if (cached) dateExceptions = JSON.parse(cached);
    }
  } catch (err) {
    console.warn('Error loading date exceptions:', err);
    const cached = localStorage.getItem('bk_date_exceptions_' + (currentUser ? currentUser.id : ''));
    if (cached) dateExceptions = JSON.parse(cached);
  }
}

// Legacy tracker loader for backwards compatibility
async function loadTracker() {
  if (!currentUser) return;
  
  try {
    const { data, error } = await supabaseClient
      .from('tracker_logs')
      .select('*')
      .eq('user_id', currentUser.id);
    
    if (error) throw error;
    
    trackerLog = {};
    (data || []).forEach(row => {
      if (!trackerLog[row.date]) {
        trackerLog[row.date] = {};
      }
      trackerLog[row.date][row.subject_id] = row.status;
    });
    
  } catch (error) {
    console.error('Error loading legacy tracker:', error);
    trackerLog = {};
  }
}

// Add new subject to Supabase
async function addSubject(subjectData) {
  if (!currentUser) {
    toast('Please login first', 'err');
    return false;
  }

  if (!isOnline()) {
    toast('No internet connection', 'err');
    return false;
  }

  try {
    const payload = {
      user_id: currentUser.id,
      name: subjectData.name,
      code: subjectData.code || '',
      total: subjectData.total || 0,
      present: subjectData.present || 0,
      per_week: subjectData.perWeek || 0,
      target: subjectData.target || null,
      sem_total: subjectData.semTotal || null,
      mode: subjectData.mode || 'exact'
    };

    const { data, error } = await supabaseClient
      .from('subjects') // ✅ FIXED (lowercase)
      .insert([payload])
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      throw new Error('Insert succeeded but no data returned');
    }

    const inserted = data[0];

    // ✅ Update local UI state
    subjects.push({
      id: inserted.id,
      name: inserted.name,
      code: inserted.code,
      total: inserted.total,
      present: inserted.present,
      perWeek: inserted.per_week,
      target: inserted.target,
      semTotal: inserted.sem_total,
      mode: inserted.mode
    });

    renderAll();

    return true;

  } catch (err) {
    console.error('Error adding subject:', err);
    toast('Failed to add subject', 'err');
    return false;
  }
}

async function updateSubject(id, updatedData) {
  if (!currentUser) return false;

  try {
    const { error } = await supabaseClient
      .from('subjects')
      .update({
        name: updatedData.name,
        code: updatedData.code,
        total: updatedData.total,
        present: updatedData.present,
        per_week: updatedData.perWeek,
        target: updatedData.target,
        sem_total: updatedData.semTotal,
        mode: updatedData.mode
      })
      .eq('id', id)
      .eq('user_id', currentUser.id);

    if (error) throw error;

    return true;
  } catch (err) {
    console.error('Update error:', err);
    toast('Failed to update subject', 'err');
    return false;
  }
}

// Change a subject's counts by a delta, on top of what's saved right now.
// (Writing this tab's remembered numbers would wipe out classes marked on
// another device or tab in the meantime.)
async function applySubjectDelta(s, dTotal, dPresent) {
  if (!s || (!dTotal && !dPresent)) return true;
  try {
    const { data, error } = await supabaseClient.from('subjects').select('total,present')
      .eq('id', s.id).eq('user_id', currentUser.id).limit(1);
    if (!error && data && data[0]) { s.total = data[0].total || 0; s.present = data[0].present || 0; }
  } catch (e) { /* offline: use what this tab has */ }
  s.total = Math.max(0, s.total + dTotal);
  s.present = Math.min(s.total, Math.max(0, s.present + dPresent));
  return updateSubject(s.id, { total: s.total, present: s.present });
}

// Delete subject from Supabase
async function deleteSubjectFromDB(subjectId) {
  if (!currentUser) return false;
  
  try {
    const { error } = await supabaseClient
      .from('subjects') // ✅ FIXED
      .delete()
      .eq('id', subjectId)
      .eq('user_id', currentUser.id);
    
    if (error) throw error;
    
    subjects = subjects.filter(s => s.id !== subjectId);
    // The DB unlinks its timetable rows itself (ON DELETE SET NULL); mirror that
    // locally so the slots keep their name but stop pointing at a deleted subject.
    let unlinked = false;
    timetable.forEach(slot => { if (slot.subjectId === subjectId) { slot.subjectId = null; unlinked = true; } });
    if (unlinked) localStorage.setItem('bk_timetable_' + currentUser.id, JSON.stringify(timetable));
    
    renderAll();
    return true;
  } catch (error) {
    console.error('Error deleting subject:', error);
    toast('Failed to delete subject', 'err');
    return false;
  }
}


// Toggle between login and signup
function toggleAuthMode() {
  isAuthMode = isAuthMode === 'login' ? 'signup' : 'login';
  
  if (isAuthMode === 'signup') {
    document.getElementById('auth-title').textContent = 'Sign Up';
    document.getElementById('auth-subtitle').textContent = 'Create your account to get started';
    document.getElementById('auth-submit').textContent = 'Sign Up';
    document.getElementById('auth-toggle-text').textContent = 'Already have an account?';
    document.getElementById('auth-toggle-btn').textContent = 'Login';
  } else {
    document.getElementById('auth-title').textContent = 'Login';
    document.getElementById('auth-subtitle').textContent = 'Enter your credentials to continue';
    document.getElementById('auth-submit').textContent = 'Login';
    document.getElementById('auth-toggle-text').textContent = "Don't have an account?";
    document.getElementById('auth-toggle-btn').textContent = 'Sign Up';
  }
  
  hideAuthMessages();
}

// Handle auth form submission
async function handleAuth(event) {
  event.preventDefault();
  
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const submitBtn = document.getElementById('auth-submit');
  
  if (!email || !password) {
    showAuthError('Please enter email and password');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = isAuthMode === 'login' ? 'Logging in...' : 'Signing up...';
  hideAuthMessages();
  
  try {
    let result;

    if (isAuthMode === 'signup') {
      // SIGNUP
      result = await supabaseClient.auth.signUp({
        email,
        password,
      });
      
      if (result.error) throw result.error;

      if (result.data.user && !result.data.session) {
        showAuthSuccess('Account created! Check your email to confirm.');
        setTimeout(() => toggleAuthMode(), 2000);
        return;
      }

      if (result.data.session) {
        console.log('✅ Signup successful with immediate session');
        currentUser = result.data.user;
        
        // Store session
        localStorage.setItem('sb-session', JSON.stringify(result.data.session));
        
        showAuthSuccess('Account created successfully!');
        setTimeout(() => {
          showApp();
        }, 1000);
      }

    } else {
      // LOGIN
      const result = await supabaseClient.auth.signInWithPassword({
  email,
  password,
});

if (result.error) throw result.error;

console.log("LOGIN RESPONSE:", result.data);

// 🔥 USE THIS (NOT getSession)
const session = result.data.session;

if (!session) {
  console.error("❌ No session returned from login");
  return;
}

// ✅ STORE IT IMMEDIATELY
localStorage.setItem('sb-session', JSON.stringify(session));

console.log("✅ Session saved:", session);

// optional UI stuff
currentUser = result.data.user;
showAuthSuccess('Login successful!');
window.location.reload();

      // ✅ Dispatch custom event for content script
      window.dispatchEvent(new CustomEvent('session-updated', { 
        detail: { session } 
      }));

      currentUser = result.data.user;

      showAuthSuccess('Login successful!');

      // ✅ Load app
      setTimeout(async () => {
        await showApp();
      }, 800);
    }

  } catch (error) {
    console.error('❌ Auth error:', error);
    
    let errorMessage = 'An error occurred. Please try again.';
    
    if (error.message.includes('Invalid login credentials')) {
      errorMessage = 'Invalid email or password.';
    } else if (error.message.includes('User already registered')) {
      errorMessage = 'This email is already registered. Try logging in.';
    } else if (error.message.includes('Password should be')) {
      errorMessage = 'Password must be at least 6 characters.';
    } else if (error.message.includes('Invalid email')) {
      errorMessage = 'Please enter a valid email address.';
    } else if (error.message.includes('Email not confirmed')) {
      errorMessage = 'Please confirm your email address first.';
    } else {
      errorMessage = error.message;
    }
    
    showAuthError(errorMessage);

  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = isAuthMode === 'login' ? 'Login' : 'Sign Up';
  }
}

// Logout
async function handleLogout() {
  if (!(await askDialog({ title: 'Log out?', message: "You'll need your email and password to log back in.", ok: 'Log out', cat: 'cat-wave' }))) return;
  
  try {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
    
    console.log('✅ Logged out successfully');
    currentUser = null;
    appLoadedFor = null;
    trackerLog = {};
    localStorage.removeItem('sb-session');
    
    // Notify extension
    if (window.chrome?.runtime) {
      try {
        chrome.runtime.sendMessage({ type: 'CLEAR_SESSION' });
      } catch (e) {
        console.warn('Extension not available');
      }
    }
    
    showAuthModal();
    
    // Clear form
    document.getElementById('auth-email').value = '';
    document.getElementById('auth-password').value = '';
    
    toast('Logged out successfully');
  } catch (error) {
    console.error('❌ Logout error:', error);
    toast('Error logging out: ' + error.message, 'err');
  }
}

// Show/hide functions remain the same
function showAuthModal() {
  document.getElementById('auth-overlay').classList.add('show');
  document.getElementById('logout-btn').style.display = 'none';
  toggleProfileMenu(false);
}

// Coming back to the tab (phone unlocked, switched from another tab/device):
// reload so this tab isn't working from numbers that have changed elsewhere.
// Skipped while something is being edited so nothing typed gets lost.
let hiddenAt = 0, refreshing = false;
function busyEditing() {
  return !!document.querySelector('.overlay.show, .cooked-overlay.show, .chip-input')
    || (currPage === 'subject' && document.getElementById('edit-card')?.open)
    || (typeof ttDrag !== 'undefined' && ttDrag.el);
}
async function refreshData() {
  if (!currentUser || refreshing || appLoading || busyEditing()) return;
  refreshing = true;
  try {
    await loadSubjects();
    await loadTimetable();
    await loadDailyPeriodLogs();
    await loadDateExceptions();
    if (busyEditing()) return;
    renderAll();
    if (currPage === 'subject' && currSubjId) renderSubject(currSubjId, true);
  } finally { refreshing = false; }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (hiddenAt && Date.now() - hiddenAt > 20000) refreshData();
});

let appLoadedFor = null;   // user id whose data is loaded
let appLoading = null;     // in-flight load, shared by concurrent callers
function showApp() {
  document.getElementById('auth-overlay').classList.remove('show');
  document.getElementById('logout-btn').style.display = 'flex';
  renderProfile();
  const uid = currentUser?.id;
  if (!uid) return Promise.resolve();
  if (appLoadedFor === uid) return appLoading || Promise.resolve();
  appLoadedFor = uid;
  selectedTrackerDate = getLocalDateString();
  appLoading = (async () => {
    applyPrefsFromAccount();
    await loadSubjects();
    await loadTimetable();
    await loadDailyPeriodLogs();
    await loadDateExceptions();
    await loadTracker();
    renderAll();
  })().finally(() => { appLoading = null; });
  return appLoading;
}


const DOM = {
  authOverlay: null,
  logoutBtn: null,
  toast: null,
  init() {
    this.authOverlay = document.getElementById('auth-overlay');
    this.logoutBtn = document.getElementById('logout-btn');
    this.toast = document.getElementById('toast');
  }
};

// Show error message
function showAuthError(message) {
  const errorEl = document.getElementById('auth-error');
  errorEl.textContent = '❌ ' + message;
  errorEl.style.display = 'block';
  document.getElementById('auth-success').style.display = 'none';
}

// Show success message
function showAuthSuccess(message) {
  const successEl = document.getElementById('auth-success');
  successEl.textContent = '✓ ' + message;
  successEl.style.display = 'block';
  document.getElementById('auth-error').style.display = 'none';
}

// Hide auth messages
function hideAuthMessages() {
  document.getElementById('auth-error').style.display = 'none';
  document.getElementById('auth-success').style.display = 'none';
}

// NOT RELATED TO SUPABASE DOWN BELOW

const SUBJ_THEMES = Array.from({ length: 8 }, (_, i) => ({ c: `var(--st${i + 1})`, bg: `var(--st${i + 1}-bg)` }));
function subjTheme(i) { return SUBJ_THEMES[((i % SUBJ_THEMES.length) + SUBJ_THEMES.length) % SUBJ_THEMES.length]; }

// Decorative icon chosen from the subject name only.
function subjIcon(name) {
  const n = (name || '').toLowerCase();
  if (/math|calc|algebra|statist|discrete|probab|numer/.test(n)) return 'calc';
  if (/python|program|code|coding|java|c\+\+|software|web|algorithm|compiler|data struct|\bdsa\b|\boop/.test(n)) return 'code';
  if (/science|physic|chem|bio|lab/.test(n)) return 'flask';
  if (/network|internet|\bcn\b|cloud|web/.test(n)) return 'globe';
  if (/database|dbms|sql|data base/.test(n)) return 'database';
  if (/operating|\bos\b|system|architect|electronic|circuit|digital|micro/.test(n)) return 'cpu';
  if (/english|language|literat|hindi|communic|writ|essay/.test(n)) return 'book';
  if (/design|draw|art|graphic/.test(n)) return 'pen';
  if (/econ|account|financ|business|manag|market/.test(n)) return 'chart';
  return 'cap';
}

function ic(name, cls = '') {
  return `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

function escapeHTML(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const WISDOM = [
  "Attend today so future you can nap guilt-free.",
  "A bunk saved is a bunk earned.",
  "The front row has the best Wi-Fi. Allegedly.",
  "Spend bunks like snacks: slowly, and only on the good days.",
  "Monday you shows up so Friday you can vanish.",
  "Never bunk the class right before the exam. Trust.",
  "Two quiet weeks of attending = one peaceful bunk.",
  "Bunk on a full tank, not on an empty one.",
  "The best bunk is the one you planned, not the one you panicked into.",
  "Check your numbers before you check out.",
  "Bunks are a budget. Don't spend next month's today.",
  "75% is the floor, not the goal.",
  "Early on, every class is cheap. Later, every class is gold.",
  "One bunk is a choice. Three in a row is a lifestyle.",
  "Attend the boring lecture; that's where the exam questions hide.",
  "Show up in week one and you'll have room to breathe in week ten.",
  "Your future self is watching your attendance. Be nice to them.",
  "The class you skip is always the one with the surprise quiz.",
  "Save your bunks for fests, fevers and finals prep.",
  "A good attendance streak is cheaper than a condonation form.",
  "Being present is half the marks. Paying attention is the other half.",
  "Skip a class, not a habit.",
  "Weekends exist so weekdays don't have to be bunked.",
  "The safest bunk is in a subject with room to spare.",
  "Balance your bunks across subjects; don't drain one.",
  "If you're at the limit, today is not the day.",
  "A lab missed is a lab you'll have to beg for later.",
  "Attendance is compound interest: small deposits, big peace.",
  "Bunking the first class of the day is the easiest way to bunk them all.",
  "Plan bunks around deadlines, not around moods.",
  "Mark your attendance daily. Memory is a terrible accountant.",
  "Track it today, thank yourself on results day.",
  "Never trust 'sir won't take attendance today'.",
  "Proxy is temporary. Attendance records are forever.",
  "The register doesn't accept excuses, only signatures.",
  "When in doubt, show up and sit at the back.",
  "Half asleep in class still counts as present.",
  "A surprise holiday is a free bunk. Don't waste one the day before.",
  "Two hours of lab often counts twice. Bunk wisely.",
  "Cancelled class? Free time. Rescheduled class? Not free time.",
  "Ten focused minutes beat an hour of 'studying' with your phone.",
  "Notes from class are worth twice the ones you borrow.",
  "Ask the doubt now; the exam won't wait for you to ask later.",
  "Revise on the same day and you'll learn it once, not thrice.",
  "Sit near people who take notes. It's contagious.",
  "Start the assignment the day it's given. Even one line counts.",
  "Small daily wins beat heroic all-nighters.",
  "Sleep is a study tool. Use it.",
  "Past papers are the cheat code the syllabus forgot to hide.",
  "Teach it to a friend and you'll never forget it.",
  "A clean desk makes a calm mind. A messy one makes memes.",
  "Write it down. Your brain is for thinking, not storing.",
  "The syllabus is a map. Don't wander without it.",
  "Pomodoro: 25 minutes of work, 5 of guilt-free scrolling.",
  "Read the question twice, answer it once.",
  "The night before the exam is for revision, not for learning.",
  "Highlight less, understand more.",
  "Hard topics get easier after the second try. Always.",
  "Your best study spot is the one without your bed in it.",
  "Group study works when there's a group and some study.",
  "Exam week calm is built in week three.",
  "Finish one chapter fully rather than five halfway.",
  "Check the marking scheme. Effort goes where marks are.",
  "Breaks are part of the plan, not a break from it.",
  "Coffee helps. Planning helps more.",
  "Progress, not perfection. Also, attendance.",
  "Be the student your teachers remember for the right reasons.",
  "You don't need motivation, you need a timetable.",
  "Bad day? Show up anyway. Tomorrow you will be proud.",
  "Discipline is choosing between what you want now and what you want most.",
  "Your GPA doesn't define you, but it does open doors.",
  "Every expert was once a confused first-year.",
  "Drink water. Seriously. Brains are mostly water.",
  "Stretch between lectures. Your back is also enrolled here.",
  "Eat breakfast before the 9 AM. Hungry brains bunk.",
  "Walk to class a little early. Late entries are louder than you think.",
  "Compare yourself with last week's you, not the class topper.",
  "It's okay to rest. It's not okay to vanish for a month.",
  "Make a friend in every class. Notes are a love language.",
  "Reply to the class group, but don't live in it.",
  "Keep one small goal for today. Just one.",
  "Consistency is boring, and boring works.",
  "Nobody remembers the classes you attended. Only the exam you failed.",
  "The semester is a marathon with surprise sprints.",
  "Plan the week on Sunday, survive it on Monday.",
  "Cats nap 16 hours a day and still never miss dinner. Prioritise.",
  "Even cats show up for the important stuff (food).",
  "Be like a cat: rest a lot, but land on your feet.",
  "Curiosity didn't fail the cat. It topped the class.",
  "A sleepy cat in class is still a cat in class.",
  "Keep a buffer of 3–4 classes above target. Life happens.",
  "Medical leave needs paperwork. Keep your prescriptions.",
  "Find out if your college counts OD (on duty) as present.",
  "Know your college's attendance rule: per subject or overall?",
  "Labs, tutorials and theory may have separate attendance. Track each.",
  "Screenshot your portal attendance every few weeks. Just in case.",
  "If your portal and this app disagree, trust the portal and update here.",
  "Holidays declared? Mark them so your numbers stay honest.",
  "Extra class announced? Add it — it counts in your favour.",
  "Your timetable changed? Fix it here before you forget.",
  "Swap days happen. 'Saturday follows Monday' is a thing — mark it.",
  "Exams coming up? Attendance shortfall is cheaper to fix now.",
  "Best time to fix low attendance: last month. Next best: today.",
  "Need 75%? Aim for 80% and sleep easier.",
  "A sick day is not a bunk. Rest properly and come back stronger.",
  "Leave a little room in every subject for emergencies.",
  "Check in daily — your streak is a tiny reward for a big habit.",
  "Share your timetable with classmates. Teamwork makes it work.",
  "Missed a class? Get the notes the same day.",
  "Being on time is attending twice: once in body, once in mind.",
  "Some teachers mark attendance at the end. Stay till the end.",
  "The last week can't fix your percentage. Too few classes left.",
  "Your attendance today is a gift to your hall ticket.",
  "Attendance can't buy marks, but low attendance can cost them.",
  "Show up. Sit down. Take notes. Repeat. That's the whole secret.",
];

// One line per day, walking through the whole list before any line repeats
// (counted from a fixed date, so it doesn't jump back at New Year).
function dailyPick(list, offset = 0) {
  const d = new Date();
  const day = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(2024, 0, 1)) / 864e5);
  // Step through with a stride coprime to the length so neighbouring days feel varied
  const n = list.length;
  let stride = 7;
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  while (gcd(stride, n) !== 1) stride++;
  return list[(((day + offset) * stride) % n + n) % n];
}

function renderWisdom() {
  const el = document.getElementById('wisdom-text');
  if (el) el.textContent = `"${dailyPick(WISDOM)}"`;
}
 
const ROASTS = {
  god: [
    'Attendance merchant fr 🧾',
    'Front row energy. Respect.',
    'Sir\'s favorite. Admitted.',
    'Locked in. No thoughts, all attendance.',
    'Attendance so high it\'s embarrassing.',
    'The register knows your handwriting.',
    'You could bunk a week and still flex.',
    'Teacher\'s pet speedrun: complete.',
    'Built different. Built present.',
    'Your attendance has attendance.',
    'Main character of the register. 👑',
    'Bench is basically your second home.',
  ],
  safe: [
    'Solid. Bunk approved. 😎',
    'Chilling in the safe zone.',
    'Attendance secured. Barely.',
    'Not cooked. Yet.',
    'Massive W but don\'t get cocky.',
    'Comfortable. Suspiciously comfortable.',
    'Green zone. Touch grass responsibly.',
    'A bunk or two won\'t hurt. Probably.',
    'Healthy numbers. Keep the streak alive.',
    'Vibing above the line. ✨',
    'Safe, but the canteen is calling.',
    'You\'ve earned a guilt-free nap.',
  ],
  medium: [
    'Walking on thin ice rn.',
    'Living dangerously. Bold.',
    'One slip and it\'s wraps.',
    'The audacity to consider bunking.',
    'Risky ahh move incoming.',
    'Close enough to smell the danger.',
    'Show up. Just show up. Please.',
    'Attendance doing the bare minimum.',
    'This is a "set two alarms" situation. ⏰',
    'Just a few classes from safety.',
    'The comeback starts tomorrow, 8 AM sharp.',
    'Bunking now would be a plot twist.',
  ],
  low: [
    'Attendance on life support. 💀',
    'Bro attends through screenshots.',
    'Faculty knows you by your absence.',
    'Academic comeback loading... slowly.',
    'Sir definitely hates you probably.',
    'Your seat filed a missing person report.',
    'Roll call skips your name out of habit.',
    'Classmates think you\'re a rumour.',
    'The register has trust issues now.',
    'Bunk privileges: revoked. 🚫',
    'Time to become a morning person. Sorry.',
    'Plot armour not found.',
  ],
  cooked: [
    'Hall ticket in danger. Not joking.',
    'Parents will hear lore soon.',
    'Respawn recommended.',
    'Cooked beyond recognition. 🔥',
    'Bro you are finished.',
    'Condonation form loading...',
    'Even the ceiling fan attends more.',
    'This subject forgot you exist.',
    'Medical certificate arc incoming. 🩺',
    'Attendance? Never heard of her.',
    'Speedrunning detention any%.',
    'The HOD wants a word. Several.',
  ]
};
 
const SIM_REACTIONS = {
  safe_in_limit: ['Still chilling 😎', 'Green light, bestie.', 'Locked in.', 'W move actually.', 'Bunk responsibly.', 'Calculated. Respect.', 'Enjoy the nap, you earned it.'],
  safe_over_limit: ['Greedy ahh', 'Playing dangerous games.', 'Bold of you.', 'You sure about this?', 'Spending bunks like pocket money.', 'Future you is side-eyeing this.'],
  warn: ['Risky ahh move 💀', 'One more and you\'re cooked.', 'Sir is watching.', 'This is a warning.', 'Cutting it way too close.', 'Your safety net is a thread.'],
  cooked: ['Academic terrorism detected.', 'Bro loves consequences.', 'Hall ticket crying rn.', 'Cooked. Done. Finished. 💀', 'Absolutely not. Close the tab.', 'The register will remember this.']
};

const VERDICT_SUBS = {
  safe: ['Massive W.', 'Solid.', 'Attendance merchant vibes.', 'Go touch some grass.', 'Peak academic weapon.', 'Sleep in once, you\'ve earned it.'],
  warn: ['Walking on thin ice.', 'Don\'t get greedy.', 'One wrong move and you\'re cooked.', 'Spend them wisely.', 'Save them for emergencies.', 'Choose your bunks carefully.'],
  cooked: ['Respawn recommended.', 'Academic terrorism.', 'Hall ticket trembling.', 'Time for a comeback arc.', 'Alarms on. No excuses.', 'Front row, every day, starting now.']
};
 
const TOAST_MSGS = {
  save: ['Numbers updated.', 'Damage updated.', 'Data secured.', 'Numbers don\'t lie.'],
  delete: ['Subject yeeted.', 'Gone. Forgotten.'],
  add: ['Subject added.', 'New victim added.']
};
 
function randFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
// Stable pick: the same seed (e.g. the same attendance numbers) always gives
// the same line, so roasts only change when the numbers do — not on refresh.
function stablePick(arr, seed) {
  const str = String(seed);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return arr[(h >>> 0) % arr.length];
}
function randToast(type) { return randFrom(TOAST_MSGS[type] || ['Done.']); }
 
// ══════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════
let globalTarget = parseInt(localStorage.getItem('bk_global_target') || '75');
let semStart = localStorage.getItem('bk_sem_start') || '';
let examDate = localStorage.getItem('bk_exam_date') || '';
let semEnd = localStorage.getItem('bk_sem_end') || '';   // last day of classes
// Semester length in weeks, used to estimate the last day of classes when the student only knows the first day
let semWeeks = (n => (n >= 8 && n <= 30 ? n : 16))(parseInt(localStorage.getItem('bk_sem_weeks') || '16'));
// subjectId -> 'YYYY-MM-DD': the numbers typed in for that subject already
// include every class up to and including this day (see "counted up to").
let countedUpTo = {};
try { countedUpTo = JSON.parse(localStorage.getItem('bk_counted_upto') || '{}') || {}; } catch { countedUpTo = {}; }
let streak = parseInt(localStorage.getItem('bk_streak') || '0');
let lastCheck = localStorage.getItem('bk_last_check') || '';
 
let currSubjId = null;
let currPage = 'home';
let editMode = 'exact';
let addMode = 'exact';
 
let trackerLog = {};        
let trackerLocked = false;  
// ══════════════════════════════════════════════════════
//  PERSISTENCE
// ══════════════════════════════════════════════════════

function savePrefs() {
  localStorage.setItem('bk_global_target', globalTarget);
  localStorage.setItem('bk_sem_start', semStart);
  localStorage.setItem('bk_exam_date', examDate);
  localStorage.setItem('bk_sem_end', semEnd);
  localStorage.setItem('bk_sem_weeks', semWeeks);
  localStorage.setItem('bk_counted_upto', JSON.stringify(countedUpTo));
  localStorage.setItem('bk_streak', streak);
  localStorage.setItem('bk_last_check', lastCheck);
  schedulePrefsSync();
}

// Semester start, exam date and the global target belong to the account
// (kept in the user's auth metadata — no extra table), so every device sees
// the same values. localStorage stays as the offline copy.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
let prefsSyncTimer = null;
function schedulePrefsSync() {
  if (!currentUser || !supabaseClient?.auth?.updateUser) return;
  clearTimeout(prefsSyncTimer);
  prefsSyncTimer = setTimeout(async () => {
    const want = { semStart, examDate, semEnd, semWeeks, target: globalTarget };
    const meta = currentUser?.user_metadata || {};
    if (JSON.stringify(meta.bk_prefs || {}) === JSON.stringify(want) && JSON.stringify(meta.bk_counted_upto || {}) === JSON.stringify(countedUpTo)) return;
    try {
      const { data, error } = await supabaseClient.auth.updateUser({ data: { bk_prefs: want, bk_counted_upto: countedUpTo } });
      if (error) throw error;
      if (data?.user) currentUser = data.user;
    } catch (err) {
      console.warn('Could not sync semester settings:', err.message);
    }
  }, 500);
}
function applyPrefsFromAccount() {
  const p = currentUser?.user_metadata?.bk_prefs;
  if (!p || typeof p !== 'object') {
    // First time on an account: upload whatever this device already has
    if (semStart || examDate || semEnd || globalTarget !== 75 || Object.keys(countedUpTo).length) schedulePrefsSync();
    return;
  }
  if (typeof p.semStart === 'string' && (p.semStart === '' || DATE_RE.test(p.semStart))) semStart = p.semStart;
  if (typeof p.examDate === 'string' && (p.examDate === '' || DATE_RE.test(p.examDate))) examDate = p.examDate;
  if (typeof p.semEnd === 'string' && (p.semEnd === '' || DATE_RE.test(p.semEnd))) semEnd = p.semEnd;
  if (Number.isInteger(p.semWeeks) && p.semWeeks >= 8 && p.semWeeks <= 30) semWeeks = p.semWeeks;
  localStorage.setItem('bk_sem_weeks', semWeeks);
  const cu = currentUser?.user_metadata?.bk_counted_upto;
  if (cu && typeof cu === 'object') {
    countedUpTo = {};
    Object.entries(cu).forEach(([k, v]) => { if (typeof v === 'string' && DATE_RE.test(v)) countedUpTo[k] = v; });
  }
  localStorage.setItem('bk_sem_end', semEnd);
  localStorage.setItem('bk_counted_upto', JSON.stringify(countedUpTo));
  const t = Math.round(Number(p.target));
  if (t >= 1 && t <= 100) globalTarget = t;
  localStorage.setItem('bk_global_target', globalTarget);
  localStorage.setItem('bk_sem_start', semStart);
  localStorage.setItem('bk_exam_date', examDate);
}
 
// ══════════════════════════════════════════════════════
//  MATH UTILS
// ══════════════════════════════════════════════════════
// Rounded DOWN: 74.6% must read 74%, never 75%, or a 75% target would look
// met when it isn't. Every "am I above target" check relies on this.
function attPct(present, total) { return total > 0 ? Math.floor(present * 100 / total) : 0; }
function pct(s) { return attPct(s.present, s.total); }
function getTarget(s) { return s?.target || globalTarget; }
// Integer-first ordering avoids float error (e.g. 29/50*100 = 57.999…).
function bunkable(s) { return Math.max(0, Math.floor(s.present * 100 / getTarget(s)) - s.total); }
function needed(s, tgt) {
  const t = tgt ?? getTarget(s);
  if (pct(s) >= t) return 0;
  if (t >= 100) return Infinity; // one absence means 100% is out of reach
  return Math.max(0, Math.ceil((t * s.total - 100 * s.present) / (100 - t)));
}
function pctColor(p, tgt) {
  tgt = tgt ?? globalTarget;
  if (p >= tgt) return 'var(--good)';
  if (p >= tgt - 15) return 'var(--warn-fill)';
  return 'var(--danger-fill)';
}
// Text-safe variant of pctColor (same thresholds) for numbers rendered as text.
function pctTextColor(p, tgt) {
  tgt = tgt ?? globalTarget;
  if (p >= tgt) return 'var(--good)';
  if (p >= tgt - 15) return 'var(--warn)';
  return 'var(--danger)';
}
// A subject with no classes counted yet has no percentage to judge: it is
// neither safe nor at risk (0/0 must not show up as a red "0% At risk").
function hasClasses(s) { return s.total > 0; }
function isAtRisk(s) { return hasClasses(s) && pct(s) < getTarget(s); }
function subjStatus(s) { return hasClasses(s) ? pctStatus(pct(s), getTarget(s)) : { cls: 'neutral', label: 'No classes yet' }; }
function subjPctText(s) { return hasClasses(s) ? pct(s) + '%' : '—'; }
function subjFill(s) { return hasClasses(s) ? pctColor(pct(s), getTarget(s)) : 'var(--border2)'; }
function subjTextColor(s) { return hasClasses(s) ? pctTextColor(pct(s), getTarget(s)) : 'var(--muted)'; }
function subjRoast(s) {
  return hasClasses(s) ? getRoast(pct(s), getTarget(s), subjRoastSeed(s)) : 'Fresh start — no classes counted yet.';
}
function pctStatus(p, tgt) {
  tgt = tgt ?? globalTarget;
  if (p >= tgt) return { cls: 'good', label: 'On track' };
  if (p >= tgt - 15) return { cls: 'warn', label: 'Below target' };
  return { cls: 'danger', label: 'At risk' };
}
// Whole weeks since a YYYY-MM-DD date, counted from local midnight.
function weeksSince(dateStr) {
  if (!dateStr || !DATE_RE.test(dateStr)) return 0;
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.max(0, Math.floor((Date.now() - new Date(y, m - 1, d)) / 864e5 / 7));
}
function weeksFromStart() { return weeksSince(semStart); }

// The last day of classes used to count what is left: the one the student set, else an estimate from the first day
// and the semester length (students usually know when classes began, not when they end). null when neither is known.
function semEndInfo() {
  if (semEnd && DATE_RE.test(semEnd)) return { date: semEnd, estimated: false };
  if (!semStart || !DATE_RE.test(semStart)) return null;
  const [y, m, d] = semStart.split('-').map(Number);
  return { date: getLocalDateString(new Date(y, m - 1, d + semWeeks * 7 - 1)), estimated: true };
}
function estimateTotalFrom(start, pw) { return Math.round(weeksSince(start) * (pw || 0)); }
function estimateTotal(pw) { return estimateTotalFrom(semStart, pw); }
// With known class days: count the real class days from the semester start up
// to yesterday, skipping days marked as holidays.
function estimateHeldByDays(start, counts) {
  if (!start || !DATE_RE.test(start)) return { held: 0, holidays: 0 };
  const [y, m, d] = start.split('-').map(Number);
  const day = new Date(y, m - 1, d), today = getLocalDateString();
  let held = 0, holidays = 0;
  for (let i = 0; i < 400; i++, day.setDate(day.getDate() + 1)) {
    const ds = getLocalDateString(day);
    if (ds >= today) break;
    const n = counts[day.getDay() || 7] || 0;
    if (!n) continue;
    if (dateExceptions[ds]?.type === 'holiday') { holidays += n; continue; }
    held += n;
  }
  return { held, holidays };
}
function fmtShort(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
function fmtDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function daysUntil(d) {
  if (!d) return null;
  return Math.ceil((new Date(d) - Date.now()) / 864e5);
}
 
// ══════════════════════════════════════════════════════
//  ROAST ENGINE
// ══════════════════════════════════════════════════════
function roastTier(p, tgt) {
  if (p >= tgt + 15) return 'god';
  if (p >= tgt) return 'safe';
  if (p >= tgt - 10) return 'medium';
  if (p >= tgt - 20) return 'low';
  return 'cooked';
}
// seed: anything that identifies the situation (subject + its numbers).
function getRoast(p, tgt, seed = '') {
  tgt = tgt ?? globalTarget;
  return stablePick(ROASTS[roastTier(p, tgt)], `${seed}|${p}|${tgt}`);
}
function subjRoastSeed(s) { return `${s.id}|${s.present}/${s.total}`; }
function getSimReaction(planBunks, bunkableNow, safe, projPct, tgt, seed = '') {
  const key = `${seed}|${planBunks}|${projPct}|${tgt}`;
  if (!safe) return stablePick(SIM_REACTIONS.cooked, key);
  if (projPct - tgt <= 2) return stablePick(SIM_REACTIONS.warn, key);
  if (planBunks > bunkableNow) return stablePick(SIM_REACTIONS.safe_over_limit, key);
  return stablePick(SIM_REACTIONS.safe_in_limit, key);
}
// Seed for overall verdicts: changes only when any subject's numbers change.
function overallSeed() { return subjects.map(s => `${s.present}/${s.total}/${getTarget(s)}`).join(','); }
 
// ══════════════════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════════════════
function toast(msg, type = 'ok') {
  const t = document.getElementById('toast');
  t.innerHTML = `<span>${type === 'ok' ? '✓' : '✕'}</span> `;
  t.append(String(msg)); // plain text: messages often contain subject names
  t.className = `toast show ${type}`;
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2600);
}
 
// ══════════════════════════════════════════════════════
//  IN-APP DIALOG — styled like the rest of the site, used instead of the
//  browser's confirm()/prompt(). Resolves to true/false, or the typed text
//  (null when cancelled) if `input` is given.
// ══════════════════════════════════════════════════════
let askResolve = null, askInput = false, askReturnFocus = null;
function askDialog({ title, message = '', ok = 'OK', cancel = 'Cancel', danger = false, cat = 'cat-worried', input = null }) {
  if (askResolve) closeAsk(false);
  askInput = !!input;
  askReturnFocus = document.activeElement;
  document.getElementById('ask-title').textContent = title;
  document.getElementById('ask-msg').textContent = message;
  document.getElementById('ask-msg').hidden = !message;
  document.getElementById('ask-cat').src = `assets/${cat}.svg`;
  const okBtn = document.getElementById('ask-ok');
  okBtn.textContent = ok;
  okBtn.classList.toggle('danger', danger);
  document.getElementById('ask-cancel').textContent = cancel;
  const wrap = document.getElementById('ask-input-wrap');
  const field = document.getElementById('ask-input');
  wrap.hidden = !input;
  if (input) {
    document.getElementById('ask-input-label').textContent = input.label || '';
    field.value = input.value || '';
    field.placeholder = input.placeholder || '';
  }
  document.getElementById('ask-overlay').classList.add('show');
  setTimeout(() => { if (input) { field.focus(); field.select(); } else okBtn.focus(); }, 30);
  return new Promise(res => { askResolve = res; });
}
function closeAsk(confirmed) {
  const ov = document.getElementById('ask-overlay');
  if (!ov.classList.contains('show') && !askResolve) return;
  let result = !!confirmed;
  if (askInput) {
    const v = document.getElementById('ask-input').value.trim();
    if (confirmed && !v) { document.getElementById('ask-input').focus(); return; }
    result = confirmed ? v : null;
  }
  ov.classList.remove('show');
  const res = askResolve;
  askResolve = null;
  askReturnFocus?.focus?.();
  res?.(result);
}

// ══════════════════════════════════════════════════════
//  SIDEBAR
// ══════════════════════════════════════════════════════
function toggleSidebar() {
  const open = document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('mob-menu')?.setAttribute('aria-expanded', String(open));
}
function renderNav() {
  document.getElementById('global-target').value = globalTarget;
  const sl = document.getElementById('sem-link-text');
  if (sl) sl.textContent = semStart && semEnd ? `Semester: ${fmtShort(semStart)} – ${fmtShort(semEnd)}`
    : semStart ? `Semester: ${fmtShort(semStart)} – ~${fmtShort(semEndInfo().date)}` : 'Set semester dates';
  document.getElementById('nav-subjects').innerHTML = subjects.map((s, i) => {
    const risk = isAtRisk(s);
    const active = currPage === 'subject' && currSubjId === s.id ? ' active' : '';
    const st = subjStatus(s).cls;
    return `<button class="nav-item${active}" id="nav-s-${s.id}" onclick="goPage('subject','${s.id}')">
      <span class="nav-dot" style="background:${subjTheme(i).c}"></span>
      <span class="nav-text">${escapeHTML(s.name)}</span>
      <span class="${risk ? 'nav-risk' : 'nav-safe'} nav-pct ${st}">${subjPctText(s)}</span>
    </button>`;
  }).join('');
  renderWisdom();
  renderStreak();
}

function updateGlobalTarget(v) {
  globalTarget = Math.max(1, Math.min(100, parseInt(v)||75));
  document.getElementById('global-target').value = globalTarget;
  savePrefs();
  renderNav();
  if (currPage === 'subject' && currSubjId) renderSubject(currSubjId, true);
  else renderHome();
}
 
// ══════════════════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════════════════
function goPage(page, id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  currPage = page;
  if (page === 'subject') {
    currSubjId = id;
    document.getElementById('page-subject').classList.add('active');
    const nv = document.getElementById(`nav-s-${id}`);
    if (nv) nv.classList.add('active');
    renderSubject(id);
  } else {
    document.getElementById(`page-${page}`).classList.add('active');
    const nv = document.getElementById(`nav-${page}`);
    if (nv) nv.classList.add('active');
    if (page === 'tracker') renderTracker();
    else if (page === 'timetable') renderTimetable();
    else renderHome();
  }
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('mob-menu')?.setAttribute('aria-expanded', 'false');
  toggleProfileMenu(false);
  closeAllPopovers();
  window.scrollTo(0, 0);
}

function openTodayTracker() {
  selectedTrackerDate = getLocalDateString();
  goPage('tracker');
}
 
// ══════════════════════════════════════════════════════
//  HOME
// ══════════════════════════════════════════════════════
function userFirstName() {
  const m = currentUser?.user_metadata || {};
  const full = (m.full_name || m.name || m.first_name || '').trim();
  return full ? full.split(/\s+/)[0] : '';
}

function renderHome() {
  const now = new Date();
  const hr = now.getHours();
  const greetings = ['Up late', 'Good morning', 'Good afternoon', 'Good evening'];
  const waves = ['🌙', '🌤️', '👋', '👋'];
  const gi = hr < 5 ? 0 : hr < 12 ? 1 : hr < 17 ? 2 : 3;
  const name = userFirstName();
  document.getElementById('home-head').innerHTML = `${greetings[gi]}${name ? ', ' + escapeHTML(name) : ''}! <span class="wave" aria-hidden="true">${waves[gi]}</span>`;
  const greetCat = document.getElementById('greet-cat');
  if (greetCat) greetCat.src = `assets/${['cat-moon', 'cat-coffee', 'cat-laptop', hr < 21 ? 'cat-yarn' : 'cat-moon'][gi]}.svg`;
  document.getElementById('home-sub').textContent = now.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

  closeAllPopovers();
  renderHomeToday();
  renderStreak();
  requestAnimationFrame(balanceHomeColumns);

  if (!subjects.length) {
    document.getElementById('stats-grid').innerHTML = '';
    document.getElementById('verdict-wrap').innerHTML = '';
    document.getElementById('subject-cards').innerHTML = `
      <div class="empty">
        <img class="empty-illus" src="assets/cat-box.svg" alt="">
        <h3>No subjects yet</h3>
        <p>Add your subjects to find out if you're cooked.</p>
        <div class="empty-actions">
          <button class="btn-pri" onclick="openAddModal()">${ic('plus','ic-sm')} Add Subject</button>
          <button class="btn-sec" onclick="openSharePack('in')">${ic('users','ic-sm')} Import from a classmate</button>
        </div>
      </div>`;
    document.getElementById('bar-chart').innerHTML = '<div class="empty" style="padding:20px;width:100%"><p style="margin:0">Your class history will show up here.</p></div>';
    return;
  }
 
  const total = subjects.reduce((a,s)=>a+s.total,0);
  const present = subjects.reduce((a,s)=>a+s.present,0);
  const ov = attPct(present, total);
  const safeBunks = subjects.reduce((a,s)=>a+bunkable(s),0);
  const atRisk = subjects.filter(isAtRisk);
  const bestBunk = [...subjects].sort((a,b)=>bunkable(b)-bunkable(a))[0];
  const hasBest = bestBunk && bunkable(bestBunk) > 0;
  const ovCls = pctStatus(ov, globalTarget).cls;

  document.getElementById('stats-grid').innerHTML = `
    <div class="sc tone-${ovCls === 'good' ? 'green' : ovCls === 'warn' ? 'amber' : 'pink'}">
      <div class="sc-top"><span class="sc-chip ${ovCls === 'good' ? 'green' : ovCls === 'warn' ? 'amber' : 'pink'}">${ic('trend','ic-sm')}</span><span class="sc-lbl">Overall attendance</span></div>
      <div class="sc-val" style="color:${pctTextColor(ov)}">${ov}<span class="unit">%</span></div>
      <div class="sc-sub">target: ${globalTarget}% · ${present}/${total} classes</div>
    </div>
    <button class="sc tone-green" id="safe-card" onclick="openSafeBunks()" aria-haspopup="dialog">
      <span class="sc-top"><span class="sc-chip green">${ic('coffee','ic-sm')}</span><span class="sc-lbl">Safe bunks</span><span class="sc-go">${ic('chevron-right','ic-sm')}</span></span>
      <span class="sc-val" style="color:${safeBunks>0?'var(--good)':'var(--danger)'}">${safeBunks}</span>
      <span class="sc-sub">${safeBunks>0?'go ahead, skip something':'you are cooked. attend.'}</span>
    </button>
    <div class="sc tone-pink">
      <div class="sc-top"><span class="sc-chip pink">${ic('alert','ic-sm')}</span><span class="sc-lbl">At risk</span></div>
      <div class="sc-val" style="color:${atRisk.length>0?'var(--danger)':'var(--good)'}">${atRisk.length}</div>
      <div class="sc-sub sc-clip">${atRisk.length>0?escapeHTML(atRisk.map(s=>s.name).join(', ')):'all subjects safe ✓'}</div>
    </div>
    <div class="sc tone-blue">
      <div class="sc-top"><span class="sc-chip blue">${ic('star','ic-sm')}</span><span class="sc-lbl">Best to bunk</span></div>
      <div class="sc-val sc-val-text${hasBest && bestBunk.name.length > 12 ? ' long' : ''}" title="${hasBest ? escapeHTML(bestBunk.name) : ''}">${hasBest ? escapeHTML(bestBunk.name) : '—'}</div>
      <div class="sc-sub">${hasBest ? bunkable(bestBunk)+' bunk'+(bunkable(bestBunk)!==1?'s':'')+' left' : 'nowhere is safe rn'}</div>
    </div>
  `;
 
  renderVerdictCard(ov, atRisk, safeBunks);
 
  document.getElementById('subject-cards').innerHTML = subjects.map((s,i) => {
    const p = pct(s), tgt = getTarget(s), bk = bunkable(s);
    const risk = isAtRisk(s);
    const st = subjStatus(s);
    return `<button class="subj-card ${risk?'at-risk':'safe-zone'}" onclick="goPage('subject','${s.id}')">
      <span class="subj-avatar" style="background:${subjTheme(i).c}" aria-hidden="true">${escapeHTML((s.name || '?').trim().charAt(0))}</span>
      <span class="subj-card-main">
        <span class="subj-card-name">${escapeHTML(s.name)}</span>
        <span class="subj-card-roast">${subjRoast(s)}</span>
        <span class="subj-bar"><span class="subj-bar-fill" style="width:${Math.min(100,p)}%;background:${subjFill(s)}"></span><span class="subj-bar-target" style="left:${Math.min(100,tgt)}%" title="Target ${tgt}%"></span></span>
      </span>
      <span class="subj-card-right">
        <span class="subj-card-pct" style="color:${subjTextColor(s)}">${subjPctText(s)}</span>
        <span class="status-pill ${st.cls}">${st.label}</span>
        <span class="subj-card-bunk">${bk>0?`${bk} bunk${bk!==1?'s':''} left`:(risk?(isFinite(needed(s))?`need ${needed(s)} more`:'can\'t reach target'):hasClasses(s)?'0 bunks left':'mark your first class')}</span>
      </span>
      <span class="subj-chev">${ic('chevron-right','ic-sm')}</span>
    </button>`;
  }).join('');
 
  const maxV = Math.max(...subjects.map(s=>s.total), 1);
  document.getElementById('bar-chart').innerHTML = subjects.map((s,i) => {
    const ph = Math.round(s.present/maxV*112);
    const ah = Math.round((s.total-s.present)/maxV*112);
    return `<button class="bg" onclick="goPage('subject','${s.id}')" title="${escapeHTML(s.name)}: ${s.present} present, ${s.total-s.present} absent" aria-label="${escapeHTML(s.name)}: ${s.present} present, ${s.total-s.present} absent">
      <span class="bw"><span class="b p" style="height:${ph}px"></span><span class="b a" style="height:${ah}px"></span></span>
      <span class="bl">${escapeHTML(s.name)}</span>
    </button>`;
  }).join('');
}

// ══════════════════════════════════════════════════════
//  ANCHORED POPOVERS (Safe Bunks, Streak calendar)
// ══════════════════════════════════════════════════════
const POPOVERS = { 'streak-pop': 'streak-card' };
let popTrigger = null;

function openPopover(popId, html) {
  Object.keys(POPOVERS).forEach(id => { if (id !== popId) closePopover(id, false); });
  const pop = document.getElementById(popId);
  const anchor = document.getElementById(POPOVERS[popId]);
  if (!pop || !anchor) return;
  pop.innerHTML = html;
  pop.hidden = false;
  positionPopover(pop, anchor);
  anchor.setAttribute('aria-expanded', 'true');
  popTrigger = anchor;
  pop.querySelector('.pop-close')?.focus({ preventScroll: true });
}

// Absolutely positioned inside its relative wrapper; flips above / clamps to stay on screen.
function positionPopover(pop, anchor) {
  const host = pop.offsetParent || pop.parentElement;
  const h = host.getBoundingClientRect();
  const a = anchor.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const margin = 12;
  const w = Math.min(pop.dataset.width ? +pop.dataset.width : 340, vw - margin * 2);
  pop.style.width = w + 'px';
  let leftVp = a.left + a.width / 2 - w / 2;
  leftVp = Math.max(margin, Math.min(leftVp, vw - margin - w));
  const ph = pop.offsetHeight;
  const below = window.innerHeight - a.bottom, above = a.top;
  const fitsBelow = below >= ph + 20, fitsAbove = above >= ph + 20;
  const flip = !fitsBelow && fitsAbove;
  pop.classList.toggle('above', flip);
  pop.style.left = (leftVp - h.left) + 'px';
  pop.style.top = (flip ? a.top - h.top - ph - 10 : a.bottom - h.top + 10) + 'px';
  // No room either side (short screens): open below and scroll just enough
  if (!fitsBelow && !fitsAbove) {
    const over = a.bottom + 10 + ph + margin - window.innerHeight;
    if (over > 0) window.scrollBy({ top: over, behavior: 'instant' });
  }
  pop.style.setProperty('--caret-x', Math.max(18, Math.min(w - 18, a.left + a.width / 2 - leftVp)) + 'px');
}

function closePopover(popId, restoreFocus = true) {
  const pop = document.getElementById(popId);
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  const anchor = document.getElementById(POPOVERS[popId]);
  anchor?.setAttribute('aria-expanded', 'false');
  if (restoreFocus && anchor && document.body.contains(anchor)) anchor.focus({ preventScroll: true });
}
function closeAllPopovers(restoreFocus = false) { Object.keys(POPOVERS).forEach(id => closePopover(id, restoreFocus)); }
function anyPopoverOpen() { return Object.keys(POPOVERS).some(id => !document.getElementById(id)?.hidden); }

// ── Safe Bunks dialog: same source of truth as the card (bunkable()/getTarget()) ──
function openSafeBunks() {
  const rows = subjects.map((s, i) => ({ s, i, p: pct(s), tgt: getTarget(s), bk: bunkable(s) }));
  const eligible = rows.filter(r => r.s.total > 0 && r.p >= r.tgt).sort((a, b) => b.bk - a.bk || b.p - a.p);
  const below = rows.filter(r => r.s.total > 0 && r.p < r.tgt).length;
  const noData = rows.filter(r => !(r.s.total > 0)).length;
  const total = rows.reduce((a, r) => a + r.bk, 0);

  let title, cls, cat;
  if (total > 5) { title = `${total} safe bunks. Go touch grass.`; cls = 'var(--good)'; cat = 'cat-chill'; }
  else if (total > 0) { title = `${total} safe bunk${total !== 1 ? 's' : ''}. Spend wisely.`; cls = 'var(--warn)'; cat = 'cat-laptop'; }
  else { title = 'Zero safe bunks. Attend.'; cls = 'var(--danger)'; cat = 'cat-sad'; }

  document.getElementById('sb-cat').src = `assets/${cat}.svg`;
  document.getElementById('sb-title').innerHTML = `<span style="color:${cls}">${escapeHTML(title)}</span>`;
  const extra = [below ? `${below} below target` : '', noData ? `${noData} with no classes yet` : ''].filter(Boolean).join(' · ');
  document.getElementById('sb-msg').textContent = eligible.length
    ? `Skip these and you still stay at or above each subject's target.${extra ? ` (${extra} — not listed.)` : ''}`
    : `No subject has room to skip right now.${extra ? ` (${extra}.)` : ''} Attend a few to build a buffer.`;
  document.getElementById('sb-breakdown').innerHTML = eligible.map(r => `
    <button class="cooked-row safe-row" onclick="closeSafeBunks(); goPage('subject','${r.s.id}')">
      <span class="cooked-dot" style="background:${subjTheme(r.i).c}"></span>
      <span class="subj-n">${escapeHTML(r.s.name)}</span>
      <span class="subj-p" style="color:${pctTextColor(r.p, r.tgt)}">${r.p}%</span>
      <span class="subj-s">${r.bk > 0 ? `😎 ${r.bk} bunk${r.bk !== 1 ? 's' : ''} left` : `🤏 at ${r.tgt}% — none left`}</span>
    </button>`).join('');

  safePopTrigger = document.activeElement;
  document.getElementById('safe-overlay').classList.add('show');
  document.querySelector('#safe-overlay .cooked-close')?.focus({ preventScroll: true });
}
let safePopTrigger = null;
function closeSafeBunks() {
  const ov = document.getElementById('safe-overlay');
  if (!ov || !ov.classList.contains('show')) return;
  ov.classList.remove('show');
  if (safePopTrigger && document.body.contains(safePopTrigger)) safePopTrigger.focus({ preventScroll: true });
}

// ── Streak ──
// Worked out from your saved attendance, so it's the same on every device and
// the extension counts too: a day "counts" when at least one class on it is
// marked. Days with nothing to mark (weekends, holidays, no classes) are
// skipped rather than breaking it, and today only counts once it's marked.
function utcDayKey(d) { return getLocalDateString(d); }
function shiftDayKey(key, n) { const [y, m, d] = key.split('-').map(Number); return getLocalDateString(new Date(y, m - 1, d + n)); }
function markedDays() {
  return Object.keys(dailyPeriodLogs)
    .filter(d => DATE_RE.test(d) && Object.values(dailyPeriodLogs[d] || {}).some(l => l && l.status))
    .sort();
}
function isFreeDay(key) {
  if (dateExceptions[key]?.type === 'holiday') return true;
  return !getAllClassesForDate(key).some(c => isMarkable(c, key));
}
function activeStreak() {
  const marked = new Set(markedDays());
  if (!marked.size) return 0;
  const today = getLocalDateString(), first = [...marked][0];
  let n = 0, k = marked.has(today) ? today : shiftDayKey(today, -1); // today isn't over yet
  for (let i = 0; i < 400 && k >= first; i++, k = shiftDayKey(k, -1)) {
    if (marked.has(k)) n++;
    else if (!isFreeDay(k)) break;
  }
  return n;
}
function bestStreak(hist) {
  if (!hist.length) return 0;
  const marked = new Set(hist), today = getLocalDateString();
  let best = 0, run = 0;
  for (let k = hist[0], i = 0; k <= today && i < 800; k = shiftDayKey(k, 1), i++) {
    if (marked.has(k)) best = Math.max(best, ++run);
    else if (k !== today && !isFreeDay(k)) run = 0;
  }
  return Math.max(best, activeStreak());
}
function getCheckinHistory() { return markedDays(); }

let calMonth = null; // { y, m }
function openStreakCalendar(e) {
  if (!document.getElementById('streak-pop')?.hidden) { closePopover('streak-pop'); return; }
  const now = new Date();
  calMonth = { y: now.getFullYear(), m: now.getMonth() };
  openPopover('streak-pop', streakCalendarHTML());
}
function shiftCalMonth(delta) {
  const hist = getCheckinHistory();
  const now = new Date();
  const first = hist.length ? hist[0].split('-').map(Number) : [now.getFullYear(), now.getMonth() + 1];
  const min = first[0] * 12 + (first[1] - 1), max = now.getFullYear() * 12 + now.getMonth();
  const next = Math.max(min, Math.min(max, calMonth.y * 12 + calMonth.m + delta));
  calMonth = { y: Math.floor(next / 12), m: next % 12 };
  const pop = document.getElementById('streak-pop');
  pop.innerHTML = streakCalendarHTML();
  positionPopover(pop, document.getElementById('streak-card'));
  pop.querySelector(delta < 0 ? '.cal-prev' : '.cal-next')?.focus({ preventScroll: true });
}
function streakCalendarHTML() {
  const hist = getCheckinHistory();
  const set = new Set(hist);
  const cur = activeStreak(), best = bestStreak(hist);
  const now = new Date();
  const todayKey = utcDayKey(now);
  const { y, m } = calMonth;
  const first = hist.length ? hist[0].split('-').map(Number) : [now.getFullYear(), now.getMonth() + 1];
  const atMin = y * 12 + m <= first[0] * 12 + (first[1] - 1);
  const atMax = y * 12 + m >= now.getFullYear() * 12 + now.getMonth();
  const daysIn = new Date(y, m + 1, 0).getDate();
  const lead = (new Date(y, m, 1).getDay() + 6) % 7; // Monday-first
  const pad = n => String(n).padStart(2, '0');
  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<span class="cal-cell blank"></span>';
  let monthCount = 0;
  for (let d = 1; d <= daysIn; d++) {
    const key = `${y}-${pad(m + 1)}-${pad(d)}`;
    const hit = set.has(key);
    if (hit) monthCount++;
    const isToday = key === todayKey;
    cells += `<span class="cal-cell${hit ? ' hit' : ''}${isToday ? ' today' : ''}" ${hit ? `title="Marked attendance"` : ''}>${hit ? `<span class="cal-flame" aria-hidden="true">${ic('fire-solid')}</span>` : ''}<span class="cal-d">${d}</span>${hit ? '<span class="sr-only">marked attendance</span>' : ''}</span>`;
  }
  const monthName = new Date(y, m, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  return `
    <div class="pop-head">
      <span class="pop-icon amber">${ic('fire-solid','ic-sm')}</span>
      <h3 id="streak-pop-title">Your streak <span class="pop-count">${cur} day${cur !== 1 ? 's' : ''}</span></h3>
      <button class="pop-close" onclick="closePopover('streak-pop')" aria-label="Close">${ic('x','ic-sm')}</button>
    </div>
    <div class="cal-head">
      <button class="cal-nav cal-prev" onclick="shiftCalMonth(-1)" ${atMin ? 'disabled' : ''} aria-label="Previous month">${ic('chevron-left','ic-sm')}</button>
      <span class="cal-month">${monthName}</span>
      <button class="cal-nav cal-next" onclick="shiftCalMonth(1)" ${atMax ? 'disabled' : ''} aria-label="Next month">${ic('chevron-right','ic-sm')}</button>
    </div>
    <div class="cal-grid" role="grid" aria-label="${monthName} days with attendance marked">
      ${['M','T','W','T','F','S','S'].map(w => `<span class="cal-wd">${w}</span>`).join('')}
      ${cells}
    </div>
    <p class="pop-meta">${hist.length ? 'Mark any class on a class day to keep it going. Days without classes don\'t break it.' : 'Mark your first class on Daily Classes to start your streak.'}</p>
    <div class="pop-foot"><span>Current <strong>${cur}</strong></span><span>Best <strong>${best}</strong></span><span>This month <strong>${monthCount}</strong></span></div>
  `;
}

// Classes from the past week that were never marked. Only for people who mark
// daily (counted from their first mark, never before the semester start).
function unmarkedRecent() {
  const tracked = Object.keys(dailyPeriodLogs).filter(d => Object.keys(dailyPeriodLogs[d] || {}).length).sort();
  if (!tracked.length) return null;
  const from = [tracked[0], semStart || ''].sort().pop();
  const today = new Date();
  let total = 0, earliest = null;
  for (let i = 7; i >= 1; i--) {
    const d = getLocalDateString(new Date(today.getFullYear(), today.getMonth(), today.getDate() - i));
    if (d < from || dateExceptions[d]?.type === 'holiday') continue;
    const n = getAllClassesForDate(d).filter(c => isMarkable(c, d) && !c.status).length;
    if (n) { total += n; earliest = earliest || d; }
  }
  return total ? { total, earliest } : null;
}
function openTrackerOn(date) {
  selectedTrackerDate = date;
  goPage('tracker');
}
function renderUnmarkedNudge() {
  const box = document.getElementById('home-unmarked');
  if (!box) return;
  const u = unmarkedRecent();
  box.innerHTML = u
    ? `<button class="unmarked-nudge" onclick="openTrackerOn('${u.earliest}')">${ic('clock','ic-sm')}<span><strong>${u.total} class${u.total !== 1 ? 'es' : ''}</strong> from the past week ${u.total !== 1 ? "aren't" : "isn't"} marked yet</span><span class="unmarked-go">Mark ${ic('arrow-right','ic-xs')}</span></button>`
    : '';
}

// Class history goes under whichever home column is shorter, so the two
// columns end close together whether you have 3 subjects or 12.
function balanceHomeColumns() {
  const card = document.getElementById('history-card');
  const cols = document.querySelectorAll('#page-home .dash-grid > .dash-col');
  if (!card || cols.length < 2 || !document.getElementById('page-home').classList.contains('active')) return;
  const [left, right] = cols;
  if (getComputedStyle(left.parentElement).gridTemplateColumns.split(' ').length < 2) {
    if (card.parentElement !== right) right.appendChild(card); // one column: history last
    return;
  }
  const gap = 18;
  const h = el => [...el.children].filter(c => c !== card).reduce((a, c) => a + c.offsetHeight + gap, 0);
  const target = h(left) <= h(right) ? left : right;
  if (card.parentElement !== target) target.appendChild(card);
}
let balanceTimer = null;
window.addEventListener('resize', () => { clearTimeout(balanceTimer); balanceTimer = setTimeout(balanceHomeColumns, 120); });

// Read-only list of today's schedule; marking happens on Daily Classes.
function renderHomeToday() {
  renderUnmarkedNudge();
  const box = document.getElementById('home-today');
  if (!box) return;
  const todayStr = getLocalDateString();

  if (dateExceptions[todayStr]?.type === 'holiday') {
    box.innerHTML = `<div class="today-note"><img src="assets/cat-beach.svg" alt=""><div><strong>Holiday today 🏖️</strong><br>No classes count today. Enjoy!</div></div>`;
    return;
  }

  const classes = getAllClassesForDate(todayStr);

  if (!classes.length) {
    box.innerHTML = timetable.length
      ? `<div class="today-note"><img src="assets/cat-books.svg" alt=""><div><strong>No classes today</strong><br>Nap responsibly.</div></div>`
      : `<div class="today-note"><img src="assets/cat-peek.svg" alt=""><div><strong>No timetable yet</strong><br><button class="link-btn" style="padding:0" onclick="goPage('timetable')">Set up your weekly schedule</button></div></div>`;
    return;
  }

  const STATES = {
    p: { cls: 'present', label: 'Present', icon: 'check' },
    a: { cls: 'absent', label: 'Absent', icon: 'x' },
    cancelled: { cls: 'cancelled', label: 'Cancelled', icon: '' },
  };
  const countable = classes.filter(isCountable);
  const markable = countable.filter(c => !isPreCounted(c, todayStr));
  const marked = markable.filter(c => STATES[c.status]).length;
  // Periods not linked to a subject can't be tracked: one line instead of a row each
  const unlinked = classes.length - countable.length;
  const linkLine = unlinked ? `<button class="tl-unlinked" onclick="openTodayTracker()">${ic('pen','ic-sm')}<span>${unlinked} class${unlinked !== 1 ? 'es' : ''} today ${unlinked !== 1 ? "aren't" : "isn't"} linked to a subject</span><span class="unmarked-go">Link ${ic('arrow-right','ic-xs')}</span></button>` : '';
  if (!countable.length) {
    box.innerHTML = `<div class="today-note"><img src="assets/cat-confused.svg" alt=""><div><strong>Nothing to mark yet</strong><br>Link today's periods to your subjects to track them.</div></div>${linkLine}`;
    return;
  }
  const shown = countable.slice(0, 6);
  box.innerHTML = `${markable.length ? `<div class="tl-progress"><span class="tl-progress-bar"><span style="width:${Math.round(marked / markable.length * 100)}%"></span></span><span>${marked}/${markable.length} marked</span></div>` : ''}
  <ol class="timeline">${shown.map(c => {
    const s = subjects.find(x => x.id === c.subjectId);
    const name = s ? s.name : c.subjectName;
    const time = c.startTime ? (c.endTime ? `${c.startTime} – ${c.endTime}` : c.startTime) : (c.isExtra ? 'Extra class' : c.isMakeup ? 'Makeup class' : `Period ${c.period}`);
    const st = STATES[c.status];
    if (s && isPreCounted(c, todayStr)) return `<li class="tl-row is-counted">
      <span class="tl-dot" aria-hidden="true">${ic('check', 'ic-xs')}</span>
      <span class="tl-body"><span class="tl-name">${escapeHTML(name)}</span><span class="tl-time">${escapeHTML(time)}</span></span>
      <span class="tl-state">In your numbers</span>
    </li>`;
    if (!s) return `<li class="tl-row is-unlinked">
      <span class="tl-dot" aria-hidden="true"></span>
      <span class="tl-body"><span class="tl-name">${escapeHTML(name || 'Class')}</span><span class="tl-time">${escapeHTML(time)}</span></span>
      <span class="tl-state">Not linked</span>
    </li>`;
    return `<li class="tl-row ${st ? 'is-' + st.cls : 'is-pending'}">
      <span class="tl-dot" aria-hidden="true">${st && st.icon ? ic(st.icon, 'ic-xs') : ''}</span>
      <span class="tl-body"><span class="tl-name">${escapeHTML(name)}</span><span class="tl-time">${escapeHTML(time)}${c.isExtra && c.startTime ? ' · Extra' : ''}${c.isMakeup && c.startTime ? ' · Makeup' : ''}</span></span>
      <span class="tl-state">${st ? st.label : 'Not marked'}</span>
    </li>`;
  }).join('')}</ol>${countable.length > shown.length ? `<button class="today-more link-btn" onclick="openTodayTracker()">+${countable.length - shown.length} more today</button>` : ''}${linkLine}`;
}
 
function renderVerdictCard(ov, atRisk, safeBunks) {
  let cls, emoji, title, sub;
  const seed = 'verdict|' + overallSeed();
  if (atRisk.length === 0 && safeBunks > 5) {
    cls='safe'; emoji='😎'; title='Locked in. Safe to bunk.';
    sub = `${safeBunks} total bunks available. You're chilling. ${stablePick(VERDICT_SUBS.safe, seed)}`;
  } else if (atRisk.length === 0 && safeBunks > 0) {
    cls='warn'; emoji='🤏'; title=`${safeBunks} bunk${safeBunks!==1?'s':''} left. Play it smart.`;
    sub = stablePick(VERDICT_SUBS.warn, seed);
  } else if (atRisk.length === 0) {
    cls='warn'; emoji='🫠'; title='No safe bunks. Attend everything.';
    sub = 'You\'re right at the edge. Do NOT skip anything.';
  } else {
    cls='cooked'; emoji='💀'; title='Bro you are cooked.';
    sub = `${atRisk.map(s=>s.name).join(', ')} below target. ${stablePick(VERDICT_SUBS.cooked, seed)}`;
  }
  document.getElementById('verdict-wrap').innerHTML = `
    <button class="verdict-card ${cls}" onclick="openCooked()">
      <span class="verdict-emoji" aria-hidden="true">${emoji}</span>
      <span class="verdict-body">
        <span class="verdict-title">${escapeHTML(title)}</span>
        <span class="verdict-sub">${escapeHTML(sub)}</span>
      </span>
      <img class="verdict-illus" src="assets/${cls === 'cooked' ? (atRisk.length > subjects.length / 2 ? 'cat-sad' : 'cat-worried') : cls === 'safe' ? 'cat-chill' : 'cat-laptop'}.svg" alt="">
      <span class="verdict-tap">Am I Cooked? ${ic('arrow-right','ic-sm')}</span>
    </button>`;
}
 
// ══════════════════════════════════════════════════════
//  STREAK
// ══════════════════════════════════════════════════════
function renderStreak() {
  const pill = document.getElementById('streak-card');
  if (!pill) return;
  const today = getLocalDateString();
  const cur = activeStreak();
  const freeToday = isFreeDay(today);
  const doneToday = markedDays().includes(today);
  document.getElementById('streak-count').textContent = cur;
  pill.classList.toggle('lit', cur > 0 && (doneToday || freeToday));
  pill.classList.toggle('pending', cur > 0 && !doneToday && !freeToday);
  pill.classList.toggle('cold', cur === 0);
  const tip = doneToday ? `${cur}-day streak — today's done`
    : cur > 0 && freeToday ? `${cur}-day streak — no classes today`
    : cur > 0 ? `${cur}-day streak — mark today's classes to keep it`
    : 'Mark a class to start a streak';
  pill.title = tip;
  pill.setAttribute('aria-label', `${tip}. Open streak calendar`);
}

// ══════════════════════════════════════════════════════
//  ACCOUNT MENU & THEME
// ══════════════════════════════════════════════════════
function renderProfile() {
  const email = currentUser?.email || '';
  const name = userFirstName() || (email ? email.split('@')[0] : 'Account');
  const initial = (name || email || '?').charAt(0).toUpperCase();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('user-avatar', initial); set('pm-avatar', initial);
  set('pm-name', name); set('user-email', email);
  const pic = currentUser?.user_metadata?.avatar_url || currentUser?.user_metadata?.picture || '';
  ['user-avatar', 'pm-avatar'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.backgroundImage = pic ? `url("${encodeURI(pic)}")` : '';
    el.classList.toggle('has-pic', !!pic);
  });
  document.getElementById('profile-btn')?.setAttribute('aria-label', `Account menu for ${name}`);
}

function toggleProfileMenu(force) {
  const menu = document.getElementById('profile-menu');
  const btn = document.getElementById('profile-btn');
  if (!menu || !btn) return;
  const open = typeof force === 'boolean' ? force : menu.hidden;
  menu.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
}

function applyThemeIcon() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  btn.innerHTML = ic(dark ? 'moon' : 'sun');
  btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#15161F' : '#F6F5F0');
}

function toggleTheme() {
  const dark = document.documentElement.dataset.theme !== 'dark';
  if (dark) document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('bk_theme', dark ? 'dark' : 'light'); } catch (e) {}
  applyThemeIcon();
  if (currPage === 'timetable' && scannerState.activeTab === 'studio') renderStudioCanvas();
}


 
// ══════════════════════════════════════════════════════
//  AM I COOKED MODAL
// ══════════════════════════════════════════════════════
function openCooked() {
  if (!subjects.length) { toast('Add subjects first', 'err'); return; }
  const total = subjects.reduce((a,s)=>a+s.total,0);
  const present = subjects.reduce((a,s)=>a+s.present,0);
  const ov = attPct(present, total);
  const atRisk = subjects.filter(isAtRisk);
  const safeBunks = subjects.reduce((a,s)=>a+bunkable(s),0);
 
  let emoji, verdict, msg, cls;
  const seed = 'cooked|' + overallSeed();
  if (atRisk.length === 0 && ov >= globalTarget + 10 && safeBunks > 5) {
    emoji='😎'; verdict='Nah you\'re chilling.'; cls='color:var(--accent)';
    msg = `${ov}% overall. ${safeBunks} bunks available. ${stablePick(ROASTS.god, seed)} ${stablePick(ROASTS.safe, seed + '+')}`;
  } else if (atRisk.length === 0 && safeBunks > 0) {
    emoji='🤏'; verdict='Safe. But don\'t get greedy.'; cls='color:var(--warn)';
    msg = `${ov}% overall. Only ${safeBunks} safe bunks left. ${stablePick(ROASTS.medium, seed)}`;
  } else if (atRisk.length === 0) {
    emoji='😬'; verdict='One absence away from disaster.'; cls='color:var(--warn)';
    msg = `${ov}% overall. Zero bunks available. ${stablePick(ROASTS.medium, seed)}`;
  } else if (atRisk.length <= subjects.length / 2) {
    emoji='💀'; verdict='Partially cooked.'; cls='color:var(--danger)';
    msg = `${atRisk.length} subject${atRisk.length>1?'s':''} below target. ${stablePick(ROASTS.low, seed)}`;
  } else {
    emoji='🔥'; verdict='Cooked beyond recognition.'; cls='color:var(--danger)';
    msg = `${atRisk.length} subjects in the danger zone. ${stablePick(ROASTS.cooked, seed)}`;
  }
 
  document.getElementById('ck-emoji').textContent = emoji;
  const ckCat = document.getElementById('ck-cat');
  if (ckCat) ckCat.src = `assets/${atRisk.length > subjects.length / 2 ? 'cat-sad' : atRisk.length > 0 ? 'cat-worried' : (safeBunks > 5 ? 'cat-chill' : 'cat-laptop')}.svg`;
  document.getElementById('ck-verdict').innerHTML = `<span style="${cls}">${verdict}</span>`;
  document.getElementById('ck-msg').textContent = msg;
  document.getElementById('ck-breakdown').innerHTML = subjects.map((s,i) => {
    const p = pct(s), tgt = getTarget(s), bk = bunkable(s), col = pctColor(p, tgt);
    const status = !hasClasses(s) ? '🆕 no classes yet' : p >= tgt ? (bk > 3 ? '😎 safe' : '🤏 tight') : (isFinite(needed(s)) ? `💀 -${needed(s)} needed` : '💀 out of reach');
    return `<div class="cooked-row">
      <span class="cooked-dot" style="background:${subjTheme(i).c}"></span>
      <span class="subj-n">${escapeHTML(s.name)}</span>
      <span class="subj-p" style="color:${subjTextColor(s)}">${subjPctText(s)}</span>
      <span class="subj-s">${status}</span>
    </div>`;
  }).join('');
 
  document.getElementById('cooked-overlay').classList.add('show');
}
function closeCooked() { document.getElementById('cooked-overlay').classList.remove('show'); }
 
// ══════════════════════════════════════════════════════
//  SUBJECT PAGE
// ══════════════════════════════════════════════════════
function renderSubject(id, preserveSim) {
  const s = subjects.find(x=>x.id===id);
  if (!s) { goPage('home'); return; }
  const p = pct(s), tgt = getTarget(s), col = pctColor(p, tgt), bk = bunkable(s), nd = needed(s);
 
  document.getElementById('sp-title').textContent = s.name;
  document.getElementById('sp-meta').textContent = `${s.code||''} · Target: ${tgt}% · ${s.mode==='estimate'?'Estimated':'Exact'} Mode`;
  document.getElementById('sp-name').textContent = s.name;
  document.getElementById('sp-roast').textContent = subjRoast(s);
  document.getElementById('mode-label').innerHTML = s.mode==='estimate'
    ? `<span class="mode-tag est">📡 Estimated</span>`
    : `<span class="mode-tag exact">🎯 Exact</span>`;
 
  // Circle
  const r = 64, circ = 2*Math.PI*r;
  const fill = document.getElementById('circ-fill');
  fill.style.stroke = col;
  fill.style.strokeDasharray = circ;
  fill.style.strokeDashoffset = circ - Math.min(100, p)/100*circ;
  if (!hasClasses(s)) fill.style.stroke = 'var(--border2)';
  document.getElementById('circ-pct').textContent = subjPctText(s);
  document.getElementById('circ-pct').style.color = subjTextColor(s);

  // Subject theme (decorative)
  const th = subjTheme(subjects.indexOf(s));
  const spIcon = document.getElementById('sp-icon');
  if (spIcon) { spIcon.innerHTML = ic(subjIcon(s.name)); spIcon.style.background = th.bg; spIcon.style.color = th.c; }
  const spCat = document.getElementById('sp-cat');
  if (spCat) spCat.src = `assets/${!hasClasses(s) ? 'cat-box' : p >= tgt ? (p >= tgt + 15 ? 'cat-trophy' : bk > 3 ? 'cat-happy' : 'cat-laptop') : (p < tgt - 15 || !isFinite(nd) ? 'cat-sad' : 'cat-worried')}.svg`;
  const hero = document.getElementById('sp-hero');
  if (hero) hero.style.setProperty('--hero-tint', th.bg);

  // Chips
  // Official-numbers subjects: tap Total / Present / Target to change them.
  // Estimated subjects are worked out from dates, so they're edited below.
  const editable = s.mode !== 'estimate';
  const chip = (cls, icon, label, value, field) => editable && field
    ? `<button type="button" class="chip ${cls} editable" data-field="${field}" onclick="startChipEdit('${field}')" aria-label="${label}: ${value}. Tap to change"><span class="chip-lbl">${ic(icon,'ic-sm')} ${label}${ic('pen','ic-xs chip-pen')}</span><span class="cv">${value}</span></button>`
    : `<div class="chip ${cls}"><span class="chip-lbl">${ic(icon,'ic-sm')} ${label}</span><div class="cv">${value}</div></div>`;
  document.getElementById('sp-chips').innerHTML =
    chip('indigo', 'calendar', 'Total', s.total, 'total') +
    chip('green', 'check', 'Present', s.present, 'present') +
    chip('pink', 'x', 'Absent', s.total - s.present, null) +
    chip('amber', 'target', 'Target', tgt + '%', 'target');
 
  // Advice
  let pills = '', advText = '';
  if (!hasClasses(s)) {
    pills = `<span class="pill">🆕 Fresh subject</span>`;
    advText = `No classes counted yet. Mark them on <strong>Daily Classes</strong> as they happen${editable ? ', or tap <strong>Total</strong> / <strong>Present</strong> above to enter your numbers' : ', or open <strong>Edit subject</strong> below'}.`;
  } else if (p >= tgt && bk > 0) {
    pills = Array.from({length:Math.min(bk,5)},(_,j)=>`<span class="pill">Skip ${j+1}</span>`).join('');
    if (bk>5) pills += `<span class="pill">+${bk-5} more</span>`;
    const wk = weeklyCount(s) > 0 ? ` (~${(bk/weeklyCount(s)).toFixed(1)} weeks worth)` : '';
    advText = `You can skip <strong>${bk} more class${bk!==1?'es':''}</strong> in ${escapeHTML(s.name)} before hitting ${tgt}%${wk}. Space them out — don\'t bunk 2 in a row.`;
  } else if (p < tgt) {
    pills = `<span class="pill d">💀 Below ${tgt}%</span>`;
    const wk = weeklyCount(s) > 0 ? ` That's about ${Math.ceil(nd/weeklyCount(s))} weeks of showing up.` : '';
    const li = remainingInfo(s), left = li ? li.n : null, ab = li?.est ? '~' : '';
    const mx = left !== null ? attPct(s.present + left, s.total + left) : null;
    const mxs = mx !== null ? `<strong style="color:${pctTextColor(mx, tgt)}">${ab}${mx}%</strong>` : '';
    advText = !isFinite(nd)
      ? `A ${tgt}% target can't be reached once a class is missed. Try a lower target for this subject.`
      : left !== null && nd > left
        ? `Real talk: only <strong>${ab}${left}</strong> class${left !== 1 ? 'es' : ''} left this semester. Even if you show up to every single one, you max out at ${mxs}. ${tgt}% is gone. So stop doing math, attend everything, and talk to your department about condonation early.${remainingNote(li, s)}`
        : left !== null
        ? `You need <strong>${nd} classes in a row</strong> to get back to ${tgt}% — you've got ${ab}${left} left, so it's doable. Attend every one from here and you end the sem at ${mxs}. No bunks. None. Zero. Go.${remainingNote(li, s)}`
        : `You need <strong>${nd} consecutive classes</strong> just to reach ${tgt}%.${wk}${nd > s.total ? ` That's more classes than you've had all semester so far — <button class="link-btn" style="padding:0" onclick="openSemesterDialog()">set your semester dates</button> to see if it's even possible.` : ''} No bunks. None. Zero. Go.`;
  } else {
    pills = `<span class="pill w">⚠️ ${p === tgt ? `Exactly at ${tgt}%` : 'No bunks to spare'}</span>`;
    advText = p === tgt
      ? `Literally one absence away from danger. Attend <strong>3–4 more</strong> to build buffer before even thinking about bunking.`
      : `You're at ${p}%, but skipping even one class drops you below ${tgt}%. Attend <strong>3–4 more</strong> to build a buffer.`;
  }
  document.getElementById('adv-pills').innerHTML = pills;
  document.getElementById('adv-text').innerHTML = advText;
 
  // Simulator
  initSim(s, tgt, p, preserveSim);
 
  // Edit form (collapsed whenever you arrive on a subject)
  const card = document.getElementById('edit-card');
  if (card && !preserveSim) card.open = false;
  const hint = document.getElementById('edit-sum-hint');
  if (hint) hint.textContent = editable ? 'Name, attendance numbers, target, tracking mode' : 'Estimated subject — change semester start, classes/week, missed classes';
  editMode = s.mode || 'exact';
  fillEditForm(s);
}
 
// ══════════════════════════════════════════════════════
//  SUBJECT FORMS (shared by Add Subject and Edit subject)
// ══════════════════════════════════════════════════════
function numField(id) {
  const raw = (document.getElementById(id)?.value ?? '').trim();
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : NaN;
}
function textField(id) { return (document.getElementById(id)?.value ?? '').trim(); }

// Checks what the user typed and works out the numbers to save.
// Returns { values } or { error, field } (field = input id to point at).
function checkSubjectForm(f, excludeId) {
  const ids = f.ids || {};
  const name = (f.name || '').trim();
  if (!name) return { error: 'Give the subject a name.', field: ids.name };
  if (subjects.some(x => x.id !== excludeId && (x.name || '').trim().toLowerCase() === name.toLowerCase())) {
    return { error: `You already have a subject called "${name}".`, field: ids.name };
  }
  const bad = (v, min, max) => v !== null && v !== undefined && (Number.isNaN(v) || v < min || v > max);
  if (bad(f.target, 1, 100)) return { error: 'Target must be a whole number from 1 to 100 — or leave it blank to use your global target.', field: ids.target };
  const target = f.target ?? null;

  if (f.mode !== 'estimate') {
    if (bad(f.total, 0, 5000)) return { error: 'Total classes held must be a whole number (0 or more).', field: ids.total };
    if (bad(f.present, 0, 5000)) return { error: 'Classes attended must be a whole number (0 or more).', field: ids.present };
    const total = f.total ?? 0, present = f.present ?? 0;
    if (present > total) return { error: `Attended (${present}) can't be more than the total classes held (${total}).`, field: ids.present };
    if (bad(f.perWeek, 0, 30)) return { error: 'That\'s more classes a week than fit in a timetable.', field: ids.perWeek };
    return { values: { name, total, present, perWeek: f.perWeek ?? 0, target, semTotal: f.semTotal ?? null, mode: 'exact' } };
  }

  const start = f.semStart || '';
  if (!start) return { error: 'Pick the semester start date — the estimate counts classes from that day.', field: ids.semStart };
  if (start > getLocalDateString()) return { error: "The semester start can't be in the future.", field: ids.semStart };
  if (!f.perWeek || bad(f.perWeek, 1, 30)) return { error: 'Pick the days this subject is on — the estimate counts its classes from them.', field: ids.perWeek };
  if (bad(f.missed, 0, 5000)) return { error: 'Classes missed must be a whole number (0 or more).', field: ids.missed };
  const byDays = f.days && dayTotal(f.days) ? estimateHeldByDays(start, f.days) : null;
  const total = byDays ? byDays.held : estimateTotalFrom(start, f.perWeek), missed = f.missed ?? 0;
  if (missed > total) {
    return { error: `You've entered ${missed} missed, but only about ${total} class${total !== 1 ? 'es have' : ' has'} happened since ${fmtDate(start)}.`, field: ids.missed };
  }
  if (bad(f.semTotal, 1, 5000)) return { error: 'Classes in the whole semester must be a whole number — or leave it blank.', field: ids.semTotal };
  if (f.semTotal != null && f.semTotal < total) {
    return { error: `Classes in the whole semester (${f.semTotal}) can't be fewer than the ~${total} already held.`, field: ids.semTotal };
  }
  return { values: { name, total, present: total - missed, perWeek: f.perWeek, target, semTotal: f.semTotal ?? null, mode: 'estimate', semStart: start, days: byDays ? f.days : null, holidays: byDays?.holidays || 0 } };
}

// One friendly line describing what will be saved.
function subjectPreviewHTML(v) {
  let html = '';
  if (v.mode === 'estimate' && v.days) {
    html += `Since ${escapeHTML(fmtDate(v.semStart))}, ${escapeHTML(dayList(v.days))} classes: <strong>${v.total}</strong> held${v.holidays ? ` (${v.holidays} skipped for holidays)` : ''}. `;
  } else if (v.mode === 'estimate') {
    const w = weeksSince(v.semStart);
    html += `Since ${escapeHTML(fmtDate(v.semStart))}: ${w} week${w !== 1 ? 's' : ''} × ${v.perWeek}/week ≈ <strong>${v.total}</strong> class${v.total !== 1 ? 'es' : ''} held. `;
  }
  if (v.total === 0) {
    return html + (v.mode === 'estimate' && !v.days && weeksSince(v.semStart) === 0
      ? 'The estimate starts counting after the first full week.'
      : 'No classes counted yet — mark them on Daily Classes as they happen.');
  }
  const t = v.target || globalTarget;
  const fake = { present: v.present, total: v.total, target: v.target };
  const p = pct(fake), bk = bunkable(fake), nd = needed(fake);
  html += `<strong>${v.present}/${v.total}</strong> attended → <strong style="color:${pctTextColor(p, t)}">${p}%</strong> · `;
  html += p >= t
    ? (bk > 0 ? `${bk} safe bunk${bk !== 1 ? 's' : ''} at ${t}%` : `no bunks to spare at ${t}%`)
    : (isFinite(nd) ? `attend the next ${nd} to reach ${t}%` : `${t}% can't be reached anymore`);
  return html;
}

function showFormProblem(previewId, r) {
  const box = document.getElementById(previewId);
  if (box) { box.textContent = r.error; box.classList.add('is-error'); }
  const input = r.field && document.getElementById(r.field);
  if (input) { input.classList.add('invalid'); input.setAttribute('aria-invalid', 'true'); input.focus(); }
}
function clearFormProblem(scope) {
  scope?.querySelectorAll('.invalid').forEach(el => { el.classList.remove('invalid'); el.removeAttribute('aria-invalid'); });
}
function renderFormPreview(previewId, r, extra = '') {
  const box = document.getElementById(previewId);
  if (!box) return;
  box.classList.toggle('is-error', !!r.error);
  if (r.error) box.textContent = r.error;
  else box.innerHTML = subjectPreviewHTML(r.values) + extra;
}

// ══════════════════════════════════════════════════════
//  CLASS DAYS — which days a subject is on. Picking days puts the subject in
//  the weekly timetable, which is what Daily Classes shows; classes/week is
//  simply how many were picked.
// ══════════════════════════════════════════════════════
const DAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dayPickers = {}; // picker id -> { counts: {1..7: 0-2}, touched }
function emptyDays() { return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 }; }
function sameSubjectName(a, b) { return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase(); }
function subjectDayCounts(subjectId) {
  const c = emptyDays();
  timetable.forEach(t => { if (t.subjectId === subjectId && !t.isBreak) c[t.day] = (c[t.day] || 0) + 1; });
  return c;
}
// Timetable classes with this name that aren't linked to any subject yet
function unlinkedDayCounts(name) {
  const c = emptyDays();
  if (!name) return c;
  timetable.forEach(t => {
    if (!t.isBreak && !subjects.some(x => x.id === t.subjectId) && sameSubjectName(t.subjectName, name)) c[t.day] = (c[t.day] || 0) + 1;
  });
  return c;
}
function dayTotal(c) { return Object.values(c).reduce((a, n) => a + n, 0); }
function dayList(c) { return DAY_SHORT.filter((d, i) => i && c[i]).map((d, i) => d).join(', '); }
// Classes per week: from the timetable when the subject is in it, else what was typed before
function weeklyCount(s) {
  const n = timetable.filter(t => t.subjectId === s.id && !t.isBreak).length;
  return n || s.perWeek || 0;
}

// "Do these numbers already include today's class?" — asked only when the
// subject has a class today, since that's the only day it can be ambiguous.
const uptoChoice = {};
function setUpto(id, v) {
  uptoChoice[id] = v;
  document.querySelectorAll(`#${id} .mini-seg button`).forEach(b => { const on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
}
function showUpto(id, show) {
  const el = document.getElementById(id);
  if (el) el.hidden = !show;
  if (!uptoChoice[id]) setUpto(id, 'today');
}
// The day the entered numbers count up to
function uptoDate(id) {
  return !document.getElementById(id)?.hidden && uptoChoice[id] === 'yesterday' ? dayOffset(-1) : getLocalDateString();
}

function setDayPicker(id, counts, touched = false) {
  dayPickers[id] = { counts: { ...emptyDays(), ...counts }, touched };
  renderDayPicker(id);
}
function renderDayPicker(id) {
  const el = document.getElementById(id);
  const p = dayPickers[id];
  if (!el || !p) return;
  el.innerHTML = DAY_SHORT.slice(1).map((d, i) => {
    const n = p.counts[i + 1] || 0;
    return `<button type="button" class="day-chip${n ? ' on' : ''}" aria-pressed="${n > 0}" aria-label="${DAYS_MAP[i].name}: ${n} class${n !== 1 ? 'es' : ''}" onclick="onDayChip('${id}', ${i + 1})">${d}${n > 1 ? `<b>×${n}</b>` : ''}</button>`;
  }).join('');
  const note = document.getElementById(id + '-note');
  const total = dayTotal(p.counts);
  if (note) note.innerHTML = total
    ? `<strong>${total} class${total !== 1 ? 'es' : ''} a week</strong> · shows on Daily Classes every ${escapeHTML(dayList(p.counts))}.`
    : (p.note || 'No days picked — it won\'t show on Daily Classes. You can still keep its numbers up to date by hand.');
}
function onDayChip(id, day) {
  const p = dayPickers[id];
  if (!p) return;
  p.counts[day] = ((p.counts[day] || 0) + 1) % 3; // off → 1 → 2 → off
  p.touched = true;
  renderDayPicker(id);
  document.getElementById(id)?.classList.remove('invalid');
  if (id === 'as-days') updateAddPreview(); else updateEditPreview();
}
function pickerDays(id) { return dayPickers[id]?.counts || emptyDays(); }

// What changing a subject's days would do to the timetable.
function planSubjectDays(subjectId, name, counts) {
  const plan = { link: [], add: [], remove: [] };
  for (let d = 1; d <= 7; d++) {
    const mine = timetable.filter(t => t.subjectId === subjectId && !t.isBreak && t.day === d).sort((a, b) => a.period - b.period);
    let want = counts[d] || 0;
    if (want < mine.length) { plan.remove.push(...mine.slice(want)); continue; }
    want -= mine.length;
    // Reuse unlinked classes with the same name first (e.g. from a scan)
    const free = timetable.filter(t => !t.isBreak && t.day === d && !subjects.some(x => x.id === t.subjectId) && sameSubjectName(t.subjectName, name)).sort((a, b) => a.period - b.period);
    plan.link.push(...free.slice(0, want));
    for (let k = Math.min(want, free.length); k < want; k++) plan.add.push(d);
  }
  return plan;
}
// Apply it: link, add (at the end of that day, usual times for that period), remove.
async function applySubjectDays(subjectId, name, plan) {
  if (!plan.link.length && !plan.add.length && !plan.remove.length) return;
  plan.link.forEach(t => { t.subjectId = subjectId; t.subjectName = name; t.isUncertain = false; });
  plan.add.forEach(day => {
    const period = timetable.filter(t => t.day === day).reduce((m, t) => Math.max(m, t.period), 0) + 1;
    timetable.push({ id: newUuid(), day, period, ...ttBellTimes(period), subjectId, subjectName: name, isBreak: false, isUncertain: false });
  });
  if (plan.remove.length) {
    const gone = new Set(plan.remove);
    timetable = timetable.filter(t => !gone.has(t));
    if (scannerState?.fusedSlots && scannerState.fusedSlots !== timetable) scannerState.fusedSlots = scannerState.fusedSlots.filter(t => !gone.has(t));
  }
  if (plan.add.some(d => d === 7)) timetableMeta.showSunday = true;
  await saveTimetableToStorageAndDB();
}
function describeDayPlan(plan) {
  const days = arr => [...new Set(arr)].sort((a, b) => a - b).map(d => DAY_SHORT[d]).join(', ');
  const bits = [];
  if (plan.add.length || plan.link.length) bits.push(`added to ${days([...plan.add, ...plan.link.map(t => t.day)])}`);
  if (plan.remove.length) bits.push(`removed from ${days(plan.remove.map(t => t.day))}`);
  return bits.join(' and ');
}

// ══════════════════════════════════════════════════════
//  SEMESTER DATES
// ══════════════════════════════════════════════════════
// focus: 'start' | 'end' | 'past' (an estimated end already behind us) | undefined. A link that asks for one
// date opens the dialog on that field with a one-line hint, so the other field is not mistaken for the one asked.
function openSemesterDialog(focus) {
  document.getElementById('sem-start').value = semStart || '';
  document.getElementById('sem-end').value = semEnd || '';
  document.getElementById('sem-weeks').value = String(semWeeks);
  const ov = document.getElementById('sem-overlay');
  if (!ov.dataset.wired) { ov.dataset.wired = '1'; ov.addEventListener('input', semesterPreview); }
  const hint = document.getElementById('sem-hint');
  const field = focus === 'start' ? 'sem-start' : focus ? 'sem-end' : null;
  const text = focus === 'start'
    ? 'Just pick the <strong>first day of classes</strong> — BunkKro estimates when the semester ends. Add the last day too if you know it.'
    : focus === 'past'
      ? `It's been more than ${semWeeks} weeks since your first day of classes (${escapeHTML(fmtDate(semStart))}). Pick your <strong>last day of classes</strong> — or fix the first day if it's wrong.`
      : focus === 'end'
        ? 'Pick your <strong>last day of classes</strong> (the final teaching day before exams).' + (semStart ? ' Your first day is already filled in.' : '')
        : '';
  hint.innerHTML = text;
  hint.hidden = !text;
  document.querySelectorAll('#sem-overlay .mf').forEach(el => el.classList.toggle('sem-asked', !!field && !!el.querySelector('#' + field)));
  semesterPreview();
  ov.classList.add('show');
  if (field) setTimeout(() => document.getElementById(field).focus(), 60);
}
function closeSemesterDialog() { document.getElementById('sem-overlay').classList.remove('show'); }
function checkSemester(start, end) {
  if (start && start > getLocalDateString()) return "The first day of classes can't be in the future.";
  if (start && end && end <= start) return 'The last day has to come after the first day.';
  if (end && start) {
    const [a, b] = [start, end].map(x => { const [y, m, d] = x.split('-').map(Number); return new Date(y, m - 1, d); });
    if ((b - a) / 864e5 > 370) return "That's over a year — check the dates.";
  }
  return '';
}
function semesterPreview() {
  const start = document.getElementById('sem-start').value, end = document.getElementById('sem-end').value;
  const box = document.getElementById('sem-preview');
  const err = checkSemester(start, end);
  box.classList.toggle('is-error', !!err);
  if (err) { box.textContent = err; return; }
  const today = getLocalDateString();
  const weeks = parseInt(document.getElementById('sem-weeks').value) || 16;
  document.getElementById('sem-weeks-wrap').hidden = !!end;     // the length only matters while the last day is unknown
  const bits = [];
  if (start) bits.push(`Week ${Math.floor(weeksSince(start)) + 1} of the semester`);
  let last = end, estimated = false;
  if (!end && start) {
    const [y, m, d] = start.split('-').map(Number);
    last = getLocalDateString(new Date(y, m - 1, d + weeks * 7 - 1));
    estimated = true;
  }
  if (last) {
    const [y, m, d] = last.split('-').map(Number);
    const days = Math.ceil((new Date(y, m - 1, d) - new Date(today.replace(/-/g, '/'))) / 864e5);
    if (estimated) bits.push(days >= 0 ? `last day around ${fmtDate(last)} (estimated)` : `past ${weeks} weeks already — set the last day`);
    else bits.push(days >= 0 ? `${days} day${days !== 1 ? 's' : ''} of classes left` : 'classes have ended');
  }
  box.textContent = bits.join(' · ');
}
function saveSemesterDialog() {
  const start = document.getElementById('sem-start').value, end = document.getElementById('sem-end').value;
  const err = checkSemester(start, end);
  if (err) { semesterPreview(); return; }
  semStart = start; semEnd = end;
  semWeeks = parseInt(document.getElementById('sem-weeks').value) || semWeeks;
  savePrefs();
  closeSemesterDialog();
  renderNav();
  if (currPage === 'subject' && currSubjId) renderSubject(currSubjId, true); else if (currPage === 'home') renderHome();
  toast('Semester dates saved');
}

// Classes still to come for a subject this semester: real class days from
// today to the last day of classes (swaps, makeups and holidays included).
// Falls back to "classes in the whole semester" when that was entered.
// { n, est, guess }: est = the count is approximate; guess = it comes from the
// semester length x classes per week, because no semester dates are set.
function remainingInfo(s) {
  const end = semEndInfo();
  const today = getLocalDateString();
  // an estimated last day already behind us says nothing (the semester ran longer than the usual length)
  if (end && !(end.estimated && end.date < today) && timetable.some(t => t.subjectId === s.id && !t.isBreak)) {
    if (end.date < today) return { n: 0, est: false, guess: false };
    const day = new Date();
    let n = 0;
    for (let i = 0; i < 400; i++, day.setDate(day.getDate() + 1)) {
      const ds = getLocalDateString(day);
      if (ds > end.date) break;
      if (dateExceptions[ds]?.type === 'holiday') continue;
      n += getAllClassesForDate(ds).filter(c => c.subjectId === s.id && !c.status && !isPreCounted(c, ds)).length;
    }
    return { n, est: end.estimated, guess: false };
  }
  if (s.semTotal && s.semTotal > s.total) return { n: s.semTotal - s.total, est: false, guess: false };
  // No dates: a semester is about semWeeks weeks of this subject's classes, minus the ones already held
  const pw = weeklyCount(s);
  if (!end && pw > 0 && Math.round(semWeeks * pw) > s.total) return { n: Math.round(semWeeks * pw) - s.total, est: true, guess: true };
  return null;
}
function remainingClasses(s) { return remainingInfo(s)?.n ?? null; }
// Small print under an estimated count, with a link to set the real dates
function remainingNote(info, s) {
  if (!info?.est) return '';
  const link = (label, focus) => '<button class="link-btn" style="padding:0" onclick="openSemesterDialog(\'' + focus + '\')">' + label + '</button>';
  const end = semEndInfo();
  return ' <span style="font-size:.85em;color:var(--muted)">(' + (info.guess
    ? 'Estimated from a ' + semWeeks + '-week semester at ' + weeklyCount(s) + ' class' + (weeklyCount(s) !== 1 ? 'es' : '') + '/week — ' + link('set your semester dates', 'start') + ' for the real number.'
    : 'Estimated: classes end around ' + fmtShort(end.date) + ', ' + semWeeks + ' weeks after they began — ' + link('set the exact last day', 'end') + '.') + ')</span>';
}

// ── Edit subject ──
function readEditForm(s) {
  const est = editMode === 'estimate';
  return {
    mode: editMode,
    name: textField('inp-subject-name'),
    total: numField('inp-total'),
    present: numField('inp-present'),
    // Picked days decide classes/week; a subject never put on any day keeps its old number
    perWeek: dayTotal(pickerDays('edit-days')) || (dayTotal(subjectDayCounts(s.id)) ? 0 : (s.perWeek || 0)) || null,
    days: pickerDays('edit-days'),
    target: numField(est ? 'inp-est-target' : 'inp-target'),
    semStart: textField('inp-semstart'),
    missed: numField('inp-est-absent'),
    semTotal: est ? numField('inp-est-semtotal') : (s.semTotal ?? null),
    ids: {
      name: 'inp-subject-name', total: 'inp-total', present: 'inp-present',
      perWeek: 'edit-days', target: est ? 'inp-est-target' : 'inp-target',
      semStart: 'inp-semstart', missed: 'inp-est-absent', semTotal: 'inp-est-semtotal',
    },
  };
}

function fillEditForm(s) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
  set('inp-subject-name', s.name);
  // Both forms are filled so switching mode keeps what's there
  set('inp-total', s.total);
  set('inp-present', s.present);
  set('inp-absent', s.total - s.present);
  set('inp-target', s.target || '');
  set('inp-semstart', semStart);
  const days = subjectDayCounts(s.id);
  dayPickers['edit-days'] = { counts: days, touched: false,
    note: s.perWeek ? `No days set yet (you entered ${s.perWeek} a week) — pick them so it shows on Daily Classes.` : '' };
  renderDayPicker('edit-days');
  set('inp-est-absent', s.total - s.present);
  set('inp-est-target', s.target || '');
  set('inp-est-semtotal', s.semTotal || '');
  const body = document.querySelector('#edit-card .edit-body');
  if (body && !body.dataset.wired) {
    body.dataset.wired = '1';
    body.addEventListener('input', onEditInput);
  }
  clearFormProblem(body);
  const err = document.getElementById('edit-error');
  if (err) err.hidden = true;
  setUpto('edit-upto', 'today');
  setEditMode(editMode);
}

function onEditInput(e) {
  const id = e.target.id;
  const total = numField('inp-total'), present = numField('inp-present'), absent = numField('inp-absent');
  // Attended and missed fill each other in
  if (id === 'inp-absent' && Number.isInteger(total) && Number.isInteger(absent)) {
    document.getElementById('inp-present').value = Math.max(0, total - absent);
  } else if ((id === 'inp-total' || id === 'inp-present') && Number.isInteger(total) && Number.isInteger(present)) {
    document.getElementById('inp-absent').value = Math.max(0, total - present);
  }
  e.target.classList.remove('invalid');
  e.target.removeAttribute('aria-invalid');
  updateEditPreview();
}

function setEditMode(m) {
  editMode = m === 'estimate' ? 'estimate' : 'exact';
  const est = editMode === 'estimate';
  document.getElementById('form-exact').style.display = est ? 'none' : 'grid';
  document.getElementById('form-est').style.display = est ? 'block' : 'none';
  [['edit-mode-exact', !est], ['edit-mode-estimate', est]].forEach(([id, on]) => {
    const b = document.getElementById(id);
    if (b) { b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
  });
  clearFormProblem(document.querySelector('#edit-card .edit-body'));
  updateEditPreview();
}
function toggleMode() { setEditMode(editMode === 'exact' ? 'estimate' : 'exact'); }

function updateEditPreview() {
  const s = subjects.find(x => x.id === currSubjId);
  if (!s) return;
  const changed = numField('inp-total') !== s.total || numField('inp-present') !== s.present;
  showUpto('edit-upto', editMode === 'exact' && changed && (numField('inp-total') || 0) > 0 && hasClassToday(pickerDays('edit-days')));
  const r = checkSubjectForm(readEditForm(s), s.id);
  const warn = !r.error && editMode === 'estimate' && s.mode !== 'estimate' && s.total > 0
    ? `<span class="form-warn">Saving replaces your exact count (${s.present}/${s.total}) with this estimate.</span>` : '';
  renderFormPreview('edit-preview', r, warn);
}

async function saveSubject() {
  const s = subjects.find(x=>x.id===currSubjId);
  if (!s) {
    toast('Subject not found. Refreshing...', 'err');
    await loadSubjects();
    goPage('home');
    return;
  }
  const r = checkSubjectForm(readEditForm(s), s.id);
  if (r.error) { showFormProblem('edit-preview', r); return; }
  const v = r.values;
  const dayPlan = dayPickers['edit-days']?.touched ? planSubjectDays(s.id, v.name, pickerDays('edit-days')) : { link: [], add: [], remove: [] };
  if (dayPlan.remove.length && !(await askDialog({
    title: 'Change its days?',
    message: `${v.name} will be ${describeDayPlan(dayPlan)} in your weekly timetable. Attendance already marked stays counted.`,
    ok: 'Change days', cat: 'cat-calendar' }))) return;

  const saveBtn = document.querySelector('#edit-card .save-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  const before = { ...s };
  Object.assign(s, { name: v.name, total: v.total, present: v.present, perWeek: v.perWeek, target: v.target, semTotal: v.semTotal, mode: v.mode });
  const success = await updateSubject(currSubjId, {
    name: s.name, code: s.code || '', total: s.total, present: s.present,
    perWeek: s.perWeek, target: s.target, semTotal: s.semTotal, mode: s.mode
  });

  if (success) {
    if (v.mode === 'estimate' && v.semStart !== semStart) { semStart = v.semStart; savePrefs(); }
    // New numbers typed in: they cover classes up to today (or yesterday)
    const numbersChanged = v.total !== before.total || v.present !== before.present || v.mode !== before.mode;
    if (v.total === 0) { if (countedUpTo[s.id]) setCountedUpTo(s.id, null); }
    else if (v.mode === 'estimate') setCountedUpTo(s.id, dayOffset(-1));
    else if (numbersChanged) setCountedUpTo(s.id, uptoDate('edit-upto'));
    // Keep the subject's name on its timetable classes, then apply day changes
    if (v.name !== before.name) timetable.forEach(t => { if (t.subjectId === s.id) t.subjectName = v.name; });
    await applySubjectDays(s.id, v.name, dayPlan);
    if (v.name !== before.name && !dayPlan.link.length && !dayPlan.add.length && !dayPlan.remove.length && timetable.some(t => t.subjectId === s.id)) saveTimetableToStorageAndDB();
    const sv = document.getElementById('sim-input')?.value||0;
    renderSubject(currSubjId, true);
    renderNav();
    if (document.getElementById('sim-input')) {
      document.getElementById('sim-input').value = sv;
      updateSim();
    }
    toast(randToast('save'));
  } else {
    Object.assign(s, before); // keep the screen in step with what's actually saved
  }
  saveBtn.disabled = false;
  saveBtn.textContent = 'Save changes';
}

// ── Tap a number on the subject card to change it (official-numbers subjects) ──
function startChipEdit(field) {
  const s = subjects.find(x => x.id === currSubjId);
  const chip = document.querySelector(`#sp-chips .chip[data-field="${field}"]`);
  if (!s || !chip) return;
  const cur = field === 'target' ? (s.target ?? '') : s[field];
  const box = document.createElement('div');
  box.className = chip.className.replace('editable', 'editing');
  box.dataset.field = field;
  box.innerHTML = `${chip.querySelector('.chip-lbl').outerHTML}
    <input class="chip-input" type="number" inputmode="numeric" min="${field === 'target' ? 1 : 0}" ${field === 'target' ? `max="100" placeholder="${globalTarget}"` : ''} value="${cur}" aria-label="${field === 'target' ? 'Target %' : field === 'total' ? 'Total classes held' : 'Classes attended'}">`;
  chip.replaceWith(box);
  const input = box.querySelector('input');
  input.focus(); input.select();
  let done = false;
  const finish = async (keepOnError) => {
    if (done) return;
    const raw = input.value.trim();
    const n = raw === '' ? null : Number(raw);
    const f = { mode: 'exact', name: s.name, total: s.total, present: s.present, perWeek: s.perWeek, target: s.target ?? null, semTotal: s.semTotal ?? null };
    if (field === 'target') f.target = Number.isInteger(n) || n === null ? n : NaN;
    else f[field] = Number.isInteger(n) ? n : NaN;
    if (field !== 'target' && n === null) f[field] = NaN;
    const r = checkSubjectForm(f, s.id);
    if (r.error) {
      toast(r.error, 'err');
      if (keepOnError) { input.focus(); return; }
      done = true; renderSubject(s.id, true); return;
    }
    done = true;
    const v = r.values;
    if (v.total === s.total && v.present === s.present && (v.target ?? null) === (s.target ?? null)) { renderSubject(s.id, true); return; }
    const before = { ...s };
    Object.assign(s, { total: v.total, present: v.present, target: v.target });
    const ok = await updateSubject(s.id, { name: s.name, code: s.code || '', total: s.total, present: s.present, perWeek: s.perWeek, target: s.target, semTotal: s.semTotal, mode: s.mode });
    if (!ok) Object.assign(s, before);
    // Quick fixes keep the existing "counted up to"; first numbers ever cover up to today
    else if (field !== 'target' && !countedUpTo[s.id] && s.total > 0 && before.total === 0) setCountedUpTo(s.id, getLocalDateString());
    renderSubject(s.id, true);
    renderNav();
    if (ok) toast(randToast('save'));
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done = true; renderSubject(s.id, true); }
  });
  input.addEventListener('blur', () => finish(false));
}

async function deleteSubject() {
  const s = subjects.find(x=>x.id===currSubjId);
  if (!s) return;
  
  const p = pct(s);
  const tgt = getTarget(s);
  document.getElementById('delete-msg').innerHTML = `
    <strong style="color:var(--text);font-size:1rem">${escapeHTML(s.name)}</strong><br>
    <span style="font-weight:600;color:${subjTextColor(s)}">${hasClasses(s) ? p + '% attendance' : 'No classes counted yet'}</span><br>
    <span style="font-size:.8125rem;color:var(--text2);margin-top:8px;display:inline-block">This will also delete all tracker history for this subject.</span>
    ${(() => { const n = timetable.filter(t => t.subjectId === s.id && !t.isBreak).length; return n ? `<label class="pack-check del-tt"><input type="checkbox" id="del-tt-slots" checked> Also remove its ${n} class${n !== 1 ? 'es' : ''} from your weekly timetable</label>` : ''; })()}
  `;
  
  document.getElementById('delete-overlay').classList.add('show');
}

function closeDeleteModal() {
  document.getElementById('delete-overlay').classList.remove('show');
}

async function confirmDeleteSubject() {
  const subjId = currSubjId;
  const s = subjects.find(x=>x.id===subjId);
  if (!s) return;
  
  try {
    // Delete tracker logs first
    const { error: trackerError } = await supabaseClient
      .from('tracker_logs')
      .delete()
      .eq('user_id', currentUser.id)
      .eq('subject_id', subjId);
    
    if (trackerError) throw trackerError;
    
    if (countedUpTo[subjId]) setCountedUpTo(subjId, null);
    // Its timetable classes: remove them, or keep them (unlinked) to link to another subject
    const dropSlots = document.getElementById('del-tt-slots')?.checked;
    const slotIds = new Set(timetable.filter(t => t.subjectId === subjId).map(t => t.id));

    // Delete subject
    const success = await deleteSubjectFromDB(subjId);
    if (success && dropSlots && slotIds.size) {
      timetable = timetable.filter(t => !slotIds.has(t.id));
      if (scannerState?.fusedSlots && scannerState.fusedSlots !== timetable) scannerState.fusedSlots = scannerState.fusedSlots.filter(t => !slotIds.has(t.id));
      saveTimetableToStorageAndDB();
    }
    
    if (success) {
      // Clean up local tracker log
      Object.keys(trackerLog).forEach(date => {
        if (trackerLog[date][subjId]) {
          delete trackerLog[date][subjId];
        }
      });
      
      closeDeleteModal();
      goPage('home');
      toast(randToast('delete'));
    }
  } catch (error) {
    console.error('Delete error:', error);
    toast('Failed to delete subject', 'err');
  }
}
 
// ══════════════════════════════════════════════════════
//  SIMULATOR
// ══════════════════════════════════════════════════════
let _ss = null, _st = 75, _sp = 0;
function initSim(s, tgt, curP, preserve) {
  _ss = s; _st = tgt; _sp = curP;
  if (!preserve) document.getElementById('sim-input').value = 0;
  updateSim();
}
function adjSim(d) {
  const inp = document.getElementById('sim-input');
  inp.value = Math.max(0, (parseInt(inp.value)||0) + d);
  updateSim();
}
function resetSim() { document.getElementById('sim-input').value = 0; updateSim(); }
 
function updateSim() {
  const s = _ss; if (!s) return;
  const tgt = _st, pw = weeklyCount(s);
  const plan = Math.max(0, parseInt(document.getElementById('sim-input').value)||0);
  const projTotal = s.total + plan;
  const projPct = attPct(s.present, projTotal);
  const safe = projPct >= tgt;
  const bk_now = Math.max(0, Math.floor(s.present*100/tgt) - s.total);
 
  if (plan === 0) {
    const ri = remainingInfo(s), remaining = ri ? ri.n : null;
    const nd0 = needed(s, tgt);
    let h = bk_now > 0
      ? 'Can safely skip <strong>' + bk_now + '</strong> more.' + (pw>0 ? ' ~' + (bk_now/pw).toFixed(1) + ' weeks worth.' : '')
      : s.total === 0 ? 'No classes counted yet — nothing to simulate.'
      : _sp < tgt
        ? (isFinite(nd0)
            ? 'Already below ' + tgt + '%. Attend the next <strong>' + nd0 + '</strong> class' + (nd0 !== 1 ? 'es' : '') + ' to get back.'
            : 'Already below ' + tgt + '% — that target can\'t be reached anymore.')
        : 'Zero safe bunks. Right at the limit.';
    const end = semEndInfo();
    const semLink = (label, focus) => ' <button class="link-btn" style="padding:0" onclick="openSemesterDialog(\'' + focus + '\')">' + label + '</button>';
    // The advice above needs only the classes counted so far. Where the semester ENDS is an extra, shown only when
    // the classes still to come are known (last day of classes, or one estimated from the first day, or the
    // semester's class count); otherwise the card does not ask for more dates.
    if (s.total > 0 && remaining > 0) {
      const projEndPct = attPct(s.present + remaining, s.total + remaining);
      const about = ri.est ? 'about ' : '';
      if (_sp < tgt && isFinite(nd0) && nd0 > remaining) h = 'Only ' + about + '<strong>' + remaining + '</strong> class' + (remaining !== 1 ? 'es' : '') + ' left. Attend every single one and you still max out at <strong style="color:' + pctTextColor(projEndPct, tgt) + '">' + about + projEndPct + '%</strong> — ' + tgt + '% is off the table. Nothing to simulate here. Shut up and attend, then go talk condonation.';
      else h += ' If you attend all <strong>' + (about ? '~' : '') + remaining + '</strong> remaining classes, you end the semester at ' + about + '<strong style="color:' + pctTextColor(projEndPct, tgt) + '">' + projEndPct + '%</strong>.';
      h += remainingNote(ri, s);
    }
    document.getElementById('sim-result').innerHTML = '<div class="adv-text" style="color:var(--muted)">' + h + '</div>';
    return;
  }
 
  const wks = n => `${n} week${n !== 1 ? 's' : ''}`;
  const wkCtx = pw > 0 ? ` (~${wks(Math.round(plan / pw * 10) / 10)} of classes)` : '';
  const extraNd = safe ? 0 : needed({total:projTotal,present:s.present}, tgt);
  const ri = remainingInfo(s), remainingNow = ri ? ri.n : null, ab = ri?.est ? '~' : '';
  if (remainingNow !== null && plan > remainingNow) {
    document.getElementById('sim-result').innerHTML = '<div class="adv-text" style="color:var(--muted)">Bro, there ' + (remainingNow !== 1 ? 'are' : 'is') + ' only ' + ab + '<strong>' + remainingNow + '</strong> class' + (remainingNow !== 1 ? 'es' : '') + ' left this semester. You can\'t bunk ' + plan + '.' + remainingNote(ri, s) + '</div>';
    return;
  }
  const leftAfter = remainingNow !== null ? remainingNow - plan : null;
  // End of semester: skip `plan` classes, attend every other class left
  const eosPct = leftAfter !== null ? attPct(s.present + leftAfter, projTotal + leftAfter) : null;
  const eosStr = eosPct !== null ? '<strong style="color:' + pctTextColor(eosPct, tgt) + '">' + ab + eosPct + '%</strong>' : '';
  const recovCtx = !safe && !isFinite(extraNd) ? ` A ${tgt}% target can't be recovered after a bunk.`
    : !safe && extraNd > 0 && leftAfter !== null && extraNd > leftAfter
    ? ` Getting back to ${tgt}% would take <strong>${extraNd} straight classes</strong>, but only ${ab}${leftAfter} would be left. Attend all of them anyway and you end the sem at ${eosStr}.`
    : !safe && extraNd > 0 && leftAfter !== null
    ? ` Getting back takes <strong>${extraNd} straight classes</strong> — you'd have ${ab}${leftAfter} left, so it's doable. Attend every one and you end the sem at ${eosStr}.`
    : !safe && extraNd > 0 && leftAfter === null && extraNd > s.total
    ? ` Recovering would take <strong>${extraNd} straight classes</strong> — more than you've had all semester.`
    : !safe && extraNd > 0
    ? pw > 0 ? ` Need <strong>${extraNd} straight classes</strong> to recover — ~${wks(Math.ceil(extraNd/pw))}.`
             : ` Need <strong>${extraNd} consecutive</strong> to recover.`
    : '';
 
  const reaction = getSimReaction(plan, bk_now, safe, projPct, tgt, subjRoastSeed(s));
 
  let eosCtx = (safe && eosPct !== null && leftAfter > 0 ? ' Attend the rest and you end the sem at ' + eosStr + '.' : '') + remainingNote(ri, s);
 
  let icon, verdict;
  if (safe && plan <= bk_now) {
    icon = '✅'; verdict = '<strong style="color:var(--accent)">' + _sp + '% → ' + projPct + '%</strong> — above ' + tgt + '%' + wkCtx + '. ' + reaction + eosCtx;
  } else if (safe) {
    icon = '⚠️'; verdict = '<strong style="color:var(--warn)">' + _sp + '% → ' + projPct + '%</strong> — above ' + tgt + '%' + wkCtx + ' but ' + (plan-bk_now) + ' over limit. ' + reaction + eosCtx;
  } else {
    icon = '🚨'; verdict = '<strong style="color:var(--danger)">' + _sp + '% → ' + projPct + '%</strong> — <strong>' + (tgt - projPct) + '%</strong> below ' + tgt + '%' + wkCtx + '.' + recovCtx + ' ' + reaction + eosCtx;
  }
 
  const bw = Math.min(100,projPct), cw = Math.min(100,_sp);
  const tgtPos = Math.min(tgt, 97);
  document.getElementById('sim-result').innerHTML = `
    <div class="sim-bar-wrap">
      <div class="sim-bar">
        <div class="sim-cur" style="width:${cw}%"></div>
        <div class="sim-proj" style="width:${bw}%;background:${pctColor(projPct,tgt)}"></div>
        <div class="sim-line" style="left:${tgtPos}%"></div>
        <div class="sim-pct" style="color:${pctTextColor(projPct,tgt)}">${projPct}%</div>
      </div>
      <div class="sim-tgt-lbl" style="left:${tgtPos}%">${tgt}% ▼</div>
    </div>
    <div class="adv-text">${icon} ${verdict}</div>`;
}
 
// ══════════════════════════════════════════════════════
//  ONBOARDING
// ══════════════════════════════════════════════════════
let obMode = 'exact', obStep = 0;
function selMode(m) {
  obMode = m;
  document.querySelectorAll('.modal-opt').forEach(o => {
    if (o.id?.startsWith('ob-opt')) o.classList.remove('sel');
  });
  const el = document.getElementById(`ob-opt-${m}`);
  if (el) el.classList.add('sel');
}
function obNext() {
  if (obStep === 0) {
    obStep = 1;
    const today = getLocalDateString();
    document.getElementById('ob-sem-start').value = today;
    document.getElementById('ob-target').value = globalTarget;
  } else if (obStep === 1) {
    semStart = document.getElementById('ob-sem-start').value;
    examDate = document.getElementById('ob-exam').value;
    const tgt = parseInt(document.getElementById('ob-target').value)||75;
    globalTarget = tgt; savePrefs();
    obStep = 2;
    document.getElementById('ob-step2-head').textContent = obMode==='estimate' ? '⚡ Your Subjects & Schedule' : '🎯 Enter Your Subjects';
    document.getElementById('ob-est-note').style.display = obMode==='estimate' ? 'block' : 'none';
    document.getElementById('ob-subj-list').innerHTML = '';
    ['Maths','Physics','Programming'].forEach(n => obAddRow(n));
  }
  document.querySelectorAll('.modal-step').forEach(s=>s.classList.remove('active'));
  document.getElementById(`ob-${obStep}`).classList.add('active');
}
function obBack() {
  obStep = Math.max(0, obStep-1);
  document.querySelectorAll('.modal-step').forEach(s=>s.classList.remove('active'));
  document.getElementById(`ob-${obStep}`).classList.add('active');
}
function obAddRow(name='') {
  const isEst = obMode === 'estimate';
  const div = document.createElement('div');
  div.className = 'subj-setup-row';
  div.innerHTML = `
    <div class="rt">
      <input type="text" placeholder="Subject name" value="${escapeHTML(name)}">
      <button class="rm-btn" onclick="this.closest('.subj-setup-row').remove()">✕</button>
    </div>
    <div class="rf">
      ${isEst ? `
        <div><label>Classes/Week</label><input type="number" placeholder="3" min="1" data-f="pw"></div>
        <div><label>Missed</label><input type="number" placeholder="0" min="0" data-f="absent"></div>
        <div><label>Target %</label><input type="number" placeholder="${globalTarget}" min="1" max="100" data-f="target"></div>
        <div style="grid-column:span 3"><label>Sem Total (optional)</label><input type="number" placeholder="e.g. 60" min="0" data-f="semtotal" style="width:100%"></div>
      ` : `
        <div><label>Total</label><input type="number" placeholder="40" min="0" data-f="total"></div>
        <div><label>Present</label><input type="number" placeholder="32" min="0" data-f="present"></div>
        <div><label>Target %</label><input type="number" placeholder="${globalTarget}" min="1" max="100" data-f="target"></div>
      `}
    </div>`;
  document.getElementById('ob-subj-list').appendChild(div);
}

async function obFinish() {
  const rows = document.querySelectorAll('#ob-subj-list .subj-setup-row');
  if (!rows.length) { toast('Add at least one subject', 'err'); return; }
  
  const newSubjects = [];
  
  rows.forEach((row, i) => {
    const name = row.querySelector('input[type=text]').value.trim();
    if (!name) return;
    
    const f = {};
    row.querySelectorAll('[data-f]').forEach(inp => f[inp.dataset.f] = inp.value);

    const pw = Math.max(1, parseInt(f.pw)||3);
    const target = f.target ? Math.max(1,Math.min(100,parseInt(f.target)||globalTarget)) : null;
    const semTotalOb = f.semtotal ? (Math.max(0, parseInt(f.semtotal)) || null) : null;

    let total, present;
    
    if (obMode === 'estimate') {
      const absent = Math.max(0, parseInt(f.absent)||0);
      total = estimateTotal(pw);
      present = Math.max(0, total-absent);
    } else {
      total = Math.max(0, parseInt(f.total)||0);
      present = Math.max(0, parseInt(f.present)||0);
    }
    
    newSubjects.push({
      name,
      code: name.slice(0,2).toUpperCase()+'101',
      total,
      present: Math.min(present,total),
      perWeek: pw,
      target,
      semTotal: semTotalOb,
      mode: obMode
    });
  });
  
  if (!newSubjects.length) { toast('Add at least one subject', 'err'); return; }
  
  // ✅ Safer insert loop (same logic, better handling)
  for (const subject of newSubjects) {
    const success = await addSubject({
      name: subject.name,
      code: subject.code,
      total: subject.total,
      present: subject.present,
      perWeek: subject.perWeek,
      target: subject.target,
      semTotal: subject.semTotal,
      mode: subject.mode
    });

    if (!success) {
      toast('Failed to add some subjects', 'err');
      return;
    }
  }
  
  savePrefs();
  document.getElementById('ob-overlay').classList.remove('show');
  renderAll();
  toast('Welcome to BunkKro 🚀');
}
 
// ══════════════════════════════════════════════════════
//  ADD SUBJECT MODAL
// ══════════════════════════════════════════════════════
function openAddModal() {
  const ov = document.getElementById('add-overlay');
  ov.classList.add('show');
  ['as-name','as-total','as-present','as-missed','as-target','as-semtotal'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  setDayPicker('as-days', emptyDays());
  setUpto('as-upto', 'today');
  showUpto('as-upto', false);
  document.getElementById('as-semstart').value = semStart || '';
  if (!ov.dataset.wired) {
    ov.dataset.wired = '1';
    ov.addEventListener('input', e => {
      e.target.classList.remove('invalid'); e.target.removeAttribute('aria-invalid');
      // Typed a name that's already in the timetable (e.g. from a scan)? Pre-pick its days.
      if (e.target.id === 'as-name' && !dayPickers['as-days']?.touched) {
        const found = unlinkedDayCounts(textField('as-name'));
        const n = dayTotal(found);
        dayPickers['as-days'] = { counts: found, touched: false, note: '' };
        renderDayPicker('as-days');
        if (n) document.getElementById('as-days-note').innerHTML += ` <span class="form-ok">Found in your timetable — they'll be linked.</span>`;
      }
      updateAddPreview();
    });
  }
  // Without a semester start date, official numbers are the easier start
  selAddMode(semStart ? 'estimate' : 'exact');
  setTimeout(() => document.getElementById('as-name')?.focus(), 50);
}
function closeAddModal() { document.getElementById('add-overlay').classList.remove('show'); }
function selAddMode(m) {
  addMode = m;
  ['exact', 'estimate'].forEach(x => {
    const el = document.getElementById(`add-opt-${x}`);
    if (el) { el.classList.toggle('sel', x === m); el.setAttribute('aria-pressed', String(x === m)); }
  });
  document.getElementById('add-exact-fields').style.display = m === 'exact' ? 'block' : 'none';
  document.getElementById('add-est-fields').style.display = m === 'estimate' ? 'block' : 'none';
  clearFormProblem(document.getElementById('add-overlay'));
  updateAddPreview();
}
function readAddForm() {
  const est = addMode === 'estimate';
  return {
    mode: addMode,
    name: textField('as-name'),
    total: numField('as-total'),
    present: numField('as-present'),
    perWeek: dayTotal(pickerDays('as-days')) || null,
    days: pickerDays('as-days'),
    target: numField('as-target'),
    semStart: textField('as-semstart'),
    missed: numField('as-missed'),
    semTotal: est ? numField('as-semtotal') : null,
    ids: { name: 'as-name', total: 'as-total', present: 'as-present', perWeek: 'as-days', target: 'as-target', semStart: 'as-semstart', missed: 'as-missed', semTotal: 'as-semtotal' },
  };
}
function updateAddPreview() {
  const f = readAddForm();
  showUpto('as-upto', addMode === 'exact' && (f.total || 0) > 0 && hasClassToday(pickerDays('as-days')));
  const box = document.getElementById('as-preview');
  // Don't nag about the name before anything has been typed
  if (!f.name && f.total === null && f.present === null && f.missed === null && !f.perWeek) {
    if (box) { box.classList.remove('is-error'); box.textContent = addMode === 'estimate' ? 'Tip: classes held are counted from the semester start × classes per week.' : 'Copy total and attended from your college portal.'; }
    return;
  }
  const r = checkSubjectForm(f.name ? f : { ...f, name: '​' }, null);
  renderFormPreview('as-preview', r);
}

async function confirmAdd() {
  const submitBtn = document.getElementById('add-submit');
  const r = checkSubjectForm(readAddForm(), null);
  if (r.error) { showFormProblem('as-preview', r); return; }
  const v = r.values;

  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Adding...'; }
  try {
    const success = await addSubject({
      name: v.name,
      code: v.name.slice(0, 2).toUpperCase() + '101',
      total: v.total, present: v.present, perWeek: v.perWeek,
      target: v.target, semTotal: v.semTotal, mode: v.mode
    });
    if (success) {
      if (v.mode === 'estimate' && v.semStart !== semStart) { semStart = v.semStart; savePrefs(); }
      const created = subjects[subjects.length - 1];
      const plan = planSubjectDays(created.id, created.name, pickerDays('as-days'));
      await applySubjectDays(created.id, created.name, plan);
      // Classes already inside these numbers mustn't be marked again
      if (v.total > 0) setCountedUpTo(created.id, v.mode === 'estimate' ? dayOffset(-1) : uptoDate('as-upto'));
      closeAddModal();
      toast(plan.add.length || plan.link.length ? `${created.name} added — on Daily Classes every ${dayList(pickerDays('as-days'))}` : randToast('add'));
      renderAll();
    }
  } catch (err) {
    console.error('Add subject error:', err);
    toast('Something went wrong', 'err');
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Add Subject'; }
  }
}
 
// ══════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════
function renderAll() {
  renderNav();
  renderHome();
  if (currPage === 'tracker') renderTracker();
  else if (currPage === 'timetable') renderTimetable();
}

// Never auto-open onboarding. User adds subjects manually.
document.getElementById('ob-overlay').classList.remove('show');
renderAll();

// close modals on overlay click
document.getElementById('cooked-overlay').addEventListener('click', e => { if(e.target===e.currentTarget) closeCooked(); });
document.getElementById('safe-overlay').addEventListener('click', e => { if(e.target===e.currentTarget) closeSafeBunks(); });
document.getElementById('ask-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeAsk(false); });
['ob-overlay','add-overlay','delete-overlay','slot-edit-overlay','sync-freq-overlay','extra-class-overlay','tt-confirm-overlay','resched-overlay','dayswap-overlay','share-overlay','sem-overlay'].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('click', e => {
      if (e.target === e.currentTarget) {
        e.currentTarget.classList.remove('show');
      }
    });
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && askInput && e.target?.id === 'ask-input') { e.preventDefault(); closeAsk(true); return; }
  if (e.key !== 'Escape') return;
  if (document.getElementById('ask-overlay').classList.contains('show')) { closeAsk(false); return; }
  const openPop = Object.keys(POPOVERS).find(id => !document.getElementById(id)?.hidden);
  if (openPop) { closePopover(openPop); return; }
  if (!document.getElementById('profile-menu')?.hidden) { toggleProfileMenu(false); document.getElementById('profile-btn')?.focus(); return; }
  const sidebar = document.getElementById('sidebar');
  if (sidebar.classList.contains('open')) { toggleSidebar(); return; }
  if (document.getElementById('safe-overlay').classList.contains('show')) { closeSafeBunks(); return; }
  if (document.getElementById('cooked-overlay').classList.contains('show')) { closeCooked(); return; }
  if (document.getElementById('cell-inspector-overlay').classList.contains('show')) { closeCellInspector(); return; }
  const open = [...document.querySelectorAll('.overlay.show')].pop();
  if (open && open.id === 'tt-confirm-overlay') { closeTtConfirmModal(); return; }
  if (open) open.classList.remove('show');
});

document.addEventListener('click', e => {
  const path = e.composedPath();
  Object.entries(POPOVERS).forEach(([popId, anchorId]) => {
    const pop = document.getElementById(popId);
    if (pop && !pop.hidden && !path.includes(pop) && !path.includes(document.getElementById(anchorId))) closePopover(popId, false);
  });
  const menu = document.getElementById('profile-menu');
  if (menu && !menu.hidden && !e.target.closest('#profile')) toggleProfileMenu(false);
});
window.addEventListener('resize', () => closeAllPopovers());
applyThemeIcon();

// Setup drag and drop for timetable upload
document.addEventListener('DOMContentLoaded', () => {
  setupTimetableDragDrop();
});

function setupTimetableDragDrop() {
  const dropzone = document.getElementById('tt-dropzone');
  if (!dropzone) return;

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    }, false);
  });

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files && files.length > 0) {
      handleTimetableFileUpload(files[0]);
    }
  }, false);
}


// ══════════════════════════════════════════════════════
//  FEATURE 1 & 2: MULTI-ENGINE SMART TIMETABLE SCANNER & STUDIO
// ══════════════════════════════════════════════════════

let pendingOCRFile = null;
let currentScannedImageBlob = null;

// Global Studio & Scanner State
let scannerState = {
  rawImage: null,
  originalWidth: 0,
  originalHeight: 0,
  preprocessed: null,
  grid: null,
  cells: [],
  ocrResult: null,
  layout: null,
  fusedSlots: [],
  validation: { warnings: [], errors: [], disagreements: [] },
  history: [],
  historyIndex: -1,
  selectedCellId: null,
  hoveredCellId: null,
  activeTab: 'schedule',
  activeLayers: {
    original: true,
    cells: true,
    regions: false,
    confirmed: true,
    inferred: true,
    uncertain: true,
    manual: true,
    threshold: false,
    masks: false,
    segments: false,
    intersections: false,
    ocrwords: false
  }
};

// Check Engine Status for Badges
function checkEngineStatus() {
  const cvPill = document.getElementById('badge-cv-status');
  const tessPill = document.getElementById('badge-tess-status');
  const fusionPill = document.getElementById('badge-fusion-status');

  if (window.cv && window.cv.Mat) {
    if (cvPill) {
      cvPill.className = 'eng-pill ok';
      cvPill.textContent = '⚙️ OpenCV.js Ready';
    }
  } else {
    if (cvPill) {
      cvPill.className = 'eng-pill';
      cvPill.textContent = '⚙️ OpenCV.js (Morphology)';
    }
  }

  if (window.Tesseract) {
    if (tessPill) {
      tessPill.className = 'eng-pill ok';
      tessPill.textContent = '👁️ Tesseract OCR';
    }
  }

  if (window.TimetableScanner) {
    if (fusionPill) {
      fusionPill.className = 'eng-pill ok';
      fusionPill.textContent = '🧠 Fusion Engine';
    }
  }
}
setInterval(checkEngineStatus, 2000);
setTimeout(checkEngineStatus, 500);

async function handleTimetableFileUpload(file) {
  if (!file) return;

  const validTypes = ['image/png', 'image/jpeg', 'image/jpg'];
  // the local BunkKro AI server (ai-bridge.js) also reads PDFs and other image formats
  const aiTypes = ['application/pdf', 'image/webp', 'image/bmp', 'image/tiff'];
  const aiUp = window.BunkKroAI ? await BunkKroAI.isAvailable() : false;
  if (!validTypes.includes(file.type) && !(aiUp && aiTypes.includes(file.type))) {
    toast(aiUp ? 'Please upload a PDF or an image' : 'Please upload a valid PNG or JPG image', 'err');
    return;
  }

  // If user already has entries, confirm replacement
  if (timetable.length > 0) {
    pendingOCRFile = file;
    document.getElementById('tt-confirm-overlay').classList.add('show');
    return;
  }

  processTimetableImage(file);
}

// Applies the student's choices from the BunkKro AI subjects step: creates new subjects (with the weekly count the
// timetable gives them), links classes to existing subjects, drops classes that are not theirs, and renumbers periods.
async function applyAiSubjectPlan(slots, plan) {
  const dropped = new Set();
  let created = 0;
  let canCreate = !!currentUser && isOnline();
  if (!canCreate && plan.some(g => g.action === 'create')) {
    toast('Log in (and be online) to create subjects — names are kept on the timetable for now', 'err');
  }
  for (const g of plan) {
    if (g.action === 'drop') {
      g.slots.forEach(s => dropped.add(s.id));
      continue;
    }
    let subjectId = null;
    let name = g.name;
    if (g.action === 'link') {
      const s = subjects.find(x => x.id === g.subjectId);
      if (s) { subjectId = s.id; name = s.name; }
    } else if (g.action === 'create' && canCreate) {
      const existing = subjects.find(x => x.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        subjectId = existing.id;
      } else if (await addSubject({ name, code: name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() + '101',
                                     perWeek: g.slots.length, total: 0, present: 0 })) {
        subjectId = subjects[subjects.length - 1].id;
        created++;
      }
    }
    g.slots.forEach(s => {
      s.subjectId = subjectId;
      s.subjectName = name;
      s.matchConfidence = subjectId ? 'confirmed' : 'none';
    });
  }
  const kept = slots.filter(s => !dropped.has(s.id));
  for (let d = 1; d <= 7; d++) {
    kept.filter(s => s.day === d)
      .sort((a, b) => (a.startTime || '99:99').localeCompare(b.startTime || '99:99') || a.period - b.period)
      .forEach((s, i) => { s.period = i + 1; });
  }
  // a class at the same time as another is no longer in doubt once the other one was removed
  kept.forEach(s => {
    if (s.overlapsAnotherClass && !kept.some(o => o !== s && o.day === s.day && !o.isBreak && o.startTime &&
        o.startTime < (s.endTime || s.startTime) && s.startTime < (o.endTime || o.startTime))) {
      s.overlapsAnotherClass = false;
    }
  });
  if (created) toast(`Created ${created} subject${created > 1 ? 's' : ''} from your timetable ✓`);
  return kept;
}

function closeTtConfirmModal() {
  document.getElementById('tt-confirm-overlay').classList.remove('show');
  pendingOCRFile = null;
}

function confirmProceedScan() {
  // Capture before closing: closeTtConfirmModal() clears pendingOCRFile.
  const file = pendingOCRFile;
  closeTtConfirmModal();
  if (file) processTimetableImage(file);
}

function setScannerPhase(phaseName, pct, detailText) {
  const progressBox = document.getElementById('ocr-progress-box');
  const progressBar = document.getElementById('ocr-bar-fill');
  const statusText = document.getElementById('ocr-status-text');
  const details = document.getElementById('ocr-details');

  if (progressBox) progressBox.style.display = 'block';
  if (progressBar) progressBar.style.width = pct + '%';
  if (statusText) statusText.textContent = `Scanning Timetable... ${pct}%`;
  if (details && detailText) details.textContent = detailText;

  const phases = ['prep', 'geom', 'ocr', 'fusion', 'valid'];
  const currentIdx = phases.indexOf(phaseName);

  phases.forEach((p, idx) => {
    const el = document.getElementById(`phase-${p}`);
    if (el) {
      if (idx < currentIdx) {
        el.className = 'ocr-phase-item done';
      } else if (idx === currentIdx) {
        el.className = 'ocr-phase-item active';
      } else {
        el.className = 'ocr-phase-item';
      }
    }
  });
}

async function processTimetableImage(file) {
  currentScannedImageBlob = file;
  const progressBox = document.getElementById('ocr-progress-box');
  if (progressBox) progressBox.style.display = 'block';

  // BunkKro AI (local server) first; the in-browser scanner below stays the fallback for images
  if (window.BunkKroAI && await BunkKroAI.isAvailable()) {
    try {
      setScannerPhase('prep', 10, 'Sending the timetable to BunkKro AI on this computer...');
      const res = await BunkKroAI.read(file, subjects, setScannerPhase);
      setScannerPhase('valid', 95, 'Review your subjects...');
      const plan = await BunkKroAI.reviewSubjects(res.slots, subjects);
      const slots = plan ? await applyAiSubjectPlan(res.slots, plan) : res.slots;
      // the page itself in the Studio: every period boxed where it was read (double-click a box to inspect it)
      scannerState.rawImage = null;
      scannerState.grid = null;
      scannerState.ocrResult = null;
      scannerState.preprocessed = res.studio ? { canvas: res.studio.canvas } : null;
      scannerState.cells = res.studio ? res.studio.cells : [];
      scannerState.fusedSlots = slots;
      scannerState.validation = BunkKroAI.issues ? BunkKroAI.issues(slots) : res.validation;
      scannerState.history = [JSON.parse(JSON.stringify(slots))];
      scannerState.historyIndex = 0;
      updateStudioHistoryButtons();
      timetable = slots;
      saveTimetableToStorageAndDB();
      renderTimetable();
      renderValidationReport();
      renderStudioCanvas();
      setScannerPhase('valid', 100, '✓ Read by BunkKro AI');
      setTimeout(() => {
        if (progressBox) progressBox.style.display = 'none';
        const dropzone = document.getElementById('tt-dropzone');
        const loadedBar = document.getElementById('tt-loaded-bar');
        const loadedLabel = document.getElementById('tt-loaded-label');
        if (dropzone) dropzone.style.display = 'none';
        if (loadedBar) loadedBar.style.display = 'flex';
        if (loadedLabel && file && file.name) loadedLabel.textContent = file.name;
      }, 1200);
      const unsure = slots.filter(s => s.isUncertain && !s.isBreak).length;
      const classes = slots.filter(s => !s.isBreak).length;
      toast(`BunkKro AI read ${classes} classes${unsure ? ` — please check the ${unsure} marked ones` : ''}`);
      return;
    } catch (aiErr) {
      console.warn('BunkKro AI:', aiErr.message);
      if (aiErr.cancelled) {                 // the student cancelled a choice: nothing to fall back to
        if (progressBox) progressBox.style.display = 'none';
        toast('Upload cancelled');
        return;
      }
      if (!['image/png', 'image/jpeg', 'image/jpg'].includes(file.type)) {
        if (progressBox) progressBox.style.display = 'none';
        toast('BunkKro AI: ' + aiErr.message, 'err');
        return;
      }
      toast('BunkKro AI: ' + aiErr.message + ' — trying the built-in scanner', 'err');
    }
  }

  try {
    if (!window.TimetableScanner) {
      throw new Error('TimetableScanner module not initialized.');
    }

    // 0. Load Image
    setScannerPhase('prep', 10, 'Loading image file and analyzing dimensions...');
    const imgDataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = imgDataUrl;
    });

    scannerState.rawImage = img;
    scannerState.originalWidth = img.naturalWidth || img.width;
    scannerState.originalHeight = img.naturalHeight || img.height;

    // 1. Engine A: Preprocessing & Deskew
    setScannerPhase('prep', 20, 'Deskewing, grayscaling, and computing integral maps...');
    const preprocessed = await TimetableScanner.Preprocessor.deskewAndEnhance(img, {
      maxWorkingSide: 2000
    });
    scannerState.preprocessed = preprocessed;

    // 2. Engine B: OpenCV Geometry & Line Morphometry
    setScannerPhase('geom', 40, 'Extracting morphological lines, intersections, and cells...');
    let grid = null;
    let cells = [];
    try {
      grid = TimetableScanner.GeometryEngine.buildGrid(preprocessed);
      scannerState.grid = grid;

      cells = TimetableScanner.GeometryEngine.buildCells(grid, preprocessed.cfg || TimetableScanner.Config);
      scannerState.cells = cells;
    } catch (gErr) {
      console.warn('Geometry engine note:', gErr.message);
    }

    // 3. Engine C: Whole-Image + Targeted OCR
    setScannerPhase('ocr', 60, 'Recognizing subject codes, timings, and day tokens via Tesseract...');
    const ocrResult = await TimetableScanner.OCREngine.recognizeWholeImage(
      preprocessed.canvas,
      (p) => {
        const ocrPct = 40 + Math.round(p * 25);
        setScannerPhase('ocr', ocrPct, `Recognizing text blocks (${Math.round(p * 100)}%)...`);
      }
    );
    scannerState.ocrResult = ocrResult;

    // 4. Engine D & Fusion: Structural Layout Analysis & Multimodal Merging
    setScannerPhase('fusion', 80, 'Fusing geometric cells with OCR tokens, labs, and breaks...');
    const layout = TimetableScanner.LayoutEngine.analyzeTextLayout(
      ocrResult,
      { width: preprocessed.canvas.width, height: preprocessed.canvas.height }
    );
    scannerState.layout = layout;

    const fusedSlots = TimetableScanner.FusionEngine.fuseAndReconstruct(
      scannerState.cells,
      ocrResult,
      layout,
      subjects
    );
    scannerState.fusedSlots = fusedSlots;

    // 5. Validation Engine: Cross-Engine Disagreements & Consistency
    setScannerPhase('valid', 95, 'Validating period assignments and cross-engine disagreements...');
    const validation = TimetableScanner.ValidationEngine.validate(
      fusedSlots,
      scannerState.grid ? scannerState.grid.disagreements : [],
      subjects
    );
    scannerState.validation = validation;

    // Initialize history stack
    scannerState.history = [JSON.parse(JSON.stringify(fusedSlots))];
    scannerState.historyIndex = 0;
    updateStudioHistoryButtons();

    // Persist and render
    timetable = fusedSlots;
    saveTimetableToStorageAndDB();
    renderTimetable();
    renderValidationReport();
    renderStudioCanvas();

    // Finish
    setScannerPhase('valid', 100, '✓ Multi-engine scan complete!');
    setTimeout(() => {
      if (progressBox) progressBox.style.display = 'none';
      // Collapse dropzone, show compact loaded bar
      const dropzone = document.getElementById('tt-dropzone');
      const loadedBar = document.getElementById('tt-loaded-bar');
      const loadedLabel = document.getElementById('tt-loaded-label');
      if (dropzone) dropzone.style.display = 'none';
      if (loadedBar) loadedBar.style.display = 'flex';
      if (loadedLabel && file && file.name) loadedLabel.textContent = file.name;
    }, 1200);

    toast('Timetable reconstructed successfully! Inspect in Studio or review below.');

  } catch (err) {
    console.error('Scan Error:', err);
    if (progressBox) progressBox.style.display = 'none';
    toast('Scanner error: ' + (err.message || err), 'err');
  }
}

function reScanTimetable() {
  if (currentScannedImageBlob) {
    processTimetableImage(currentScannedImageBlob);
  } else {
    document.getElementById('tt-file-input').click();
  }
}

function clearScannedImage() {
  const previewBox = document.getElementById('tt-preview-box');
  const previewImg = document.getElementById('tt-scanned-preview-img');
  const progressBox = document.getElementById('ocr-progress-box');
  if (previewBox) previewBox.style.display = 'none';
  if (previewImg) previewImg.src = '';
  if (progressBox) progressBox.style.display = 'none';
  currentScannedImageBlob = null;
  document.getElementById('tt-file-input').value = '';
}

// ══════════════════════════════════════════════════════
//  STUDIO TABS, CANVAS VISUALIZER & LAYER TOGGLES
// ══════════════════════════════════════════════════════

function switchTimetableTab(tabKey) {
  scannerState.activeTab = tabKey;

  const btnSchedule = document.getElementById('tab-btn-schedule');
  const btnStudio = document.getElementById('tab-btn-studio');
  const btnDisagree = document.getElementById('tab-btn-disagree');

  const paneSchedule = document.getElementById('tab-pane-schedule');
  const paneStudio = document.getElementById('tab-pane-studio');
  const paneDisagree = document.getElementById('tab-pane-disagree');

  if (btnSchedule) btnSchedule.className = tabKey === 'schedule' ? 'tt-tab-btn active' : 'tt-tab-btn';
  if (btnStudio) btnStudio.className = tabKey === 'studio' ? 'tt-tab-btn active' : 'tt-tab-btn';
  if (btnDisagree) btnDisagree.className = tabKey === 'disagree' ? 'tt-tab-btn active' : 'tt-tab-btn';

  if (paneSchedule) paneSchedule.style.display = tabKey === 'schedule' ? 'block' : 'none';
  if (paneStudio) paneStudio.style.display = tabKey === 'studio' ? 'block' : 'none';
  if (paneDisagree) paneDisagree.style.display = tabKey === 'disagree' ? 'block' : 'none';

  if (tabKey === 'studio') {
    initStudioCanvasListeners();
    renderStudioCanvas();
  }
}

function toggleStudioLayer(layerName, isChecked) {
  scannerState.activeLayers[layerName] = isChecked;
  renderStudioCanvas();
}

function initStudioCanvasListeners() {
  const canvas = document.getElementById('studio-canvas');
  if (!canvas || canvas._listenersAttached) return;
  canvas._listenersAttached = true;

  canvas.addEventListener('mousemove', (e) => {
    if (!scannerState.preprocessed) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // Check if hovering over any cell
    const hovered = (scannerState.cells || []).find(c =>
      x >= c.xmin && x <= c.xmax && y >= c.ymin && y <= c.ymax
    );

    if (hovered && hovered.id !== scannerState.hoveredCellId) {
      scannerState.hoveredCellId = hovered.id;
      canvas.style.cursor = 'pointer';
      renderStudioCanvas();
    } else if (!hovered && scannerState.hoveredCellId) {
      scannerState.hoveredCellId = null;
      canvas.style.cursor = 'default';
      renderStudioCanvas();
    }
  });

  canvas.addEventListener('mouseleave', () => {
    if (scannerState.hoveredCellId) {
      scannerState.hoveredCellId = null;
      renderStudioCanvas();
    }
  });

  canvas.addEventListener('click', (e) => {
    if (!scannerState.preprocessed) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const clicked = (scannerState.cells || []).find(c =>
      x >= c.xmin && x <= c.xmax && y >= c.ymin && y <= c.ymax
    );

    if (clicked) {
      scannerState.selectedCellId = clicked.id;
      updateStudioInfoBox(clicked);
      renderStudioCanvas();
    }
  });

  canvas.addEventListener('dblclick', (e) => {
    if (!scannerState.preprocessed) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const clicked = (scannerState.cells || []).find(c =>
      x >= c.xmin && x <= c.xmax && y >= c.ymin && y <= c.ymax
    );

    if (clicked) {
      openCellInspector(clicked.id);
    }
  });
}

function renderStudioCanvas() {
  const canvas = document.getElementById('studio-canvas');
  const emptyState = document.getElementById('studio-empty-state');
  if (!canvas || !scannerState.preprocessed) {
    if (canvas) canvas.style.display = 'none';
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }
  if (emptyState) emptyState.style.display = 'none';
  canvas.style.display = 'inline-block';

  const prep = scannerState.preprocessed;
  const ctx = canvas.getContext('2d');

  canvas.width = prep.canvas.width;
  canvas.height = prep.canvas.height;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 1. Base Image Layer
  if (scannerState.activeLayers.original) {
    ctx.drawImage(prep.canvas, 0, 0);
  } else {
    ctx.fillStyle = '#F0EFE8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // 2. Binary Threshold Layer
  if (scannerState.activeLayers.threshold && prep.thresholdCanvas) {
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.drawImage(prep.thresholdCanvas, 0, 0);
    ctx.restore();
  }

  // 3. Grid Lines & Boundaries Layer
  if (scannerState.grid) {
    const drawLineSegment = (p1, p2, type) => {
      ctx.save();
      ctx.lineWidth = type === 'confirmed' ? 2 : (type === 'inferred' ? 1.5 : 1);

      if (type === 'confirmed') {
        if (!scannerState.activeLayers.confirmed) { ctx.restore(); return; }
        ctx.strokeStyle = '#10b981'; // solid green
        ctx.setLineDash([]);
      } else if (type === 'inferred') {
        if (!scannerState.activeLayers.inferred) { ctx.restore(); return; }
        ctx.strokeStyle = '#06b6d4'; // dashed cyan
        ctx.setLineDash([6, 4]);
      } else if (type === 'uncertain') {
        if (!scannerState.activeLayers.uncertain) { ctx.restore(); return; }
        ctx.strokeStyle = '#f59e0b'; // dotted amber
        ctx.setLineDash([3, 3]);
      } else if (type === 'manual') {
        if (!scannerState.activeLayers.manual) { ctx.restore(); return; }
        ctx.strokeStyle = '#a855f7'; // purple
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = '#ef4444'; // red absent
        ctx.setLineDash([2, 4]);
      }

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.restore();
    };

    // Draw horizontal and vertical grid lines
    if (scannerState.grid.horizontalLines) {
      scannerState.grid.horizontalLines.forEach(l => {
        drawLineSegment({ x: 0, y: l.y }, { x: canvas.width, y: l.y }, l.type || 'confirmed');
      });
    }

    if (scannerState.grid.verticalLines) {
      scannerState.grid.verticalLines.forEach(l => {
        drawLineSegment({ x: l.x, y: 0 }, { x: l.x, y: canvas.height }, l.type || 'confirmed');
      });
    }
  }

  // 4. Intersections Layer
  if (scannerState.activeLayers.intersections && scannerState.grid && scannerState.grid.intersections) {
    ctx.save();
    ctx.fillStyle = '#ef4444';
    scannerState.grid.intersections.forEach(pt => {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  // 5. OCR Words Layer
  if (scannerState.activeLayers.ocrwords && scannerState.ocrResult && scannerState.ocrResult.words) {
    ctx.save();
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.7)';
    ctx.fillStyle = 'rgba(6, 182, 212, 0.9)';
    ctx.font = '600 10px "DM Sans", sans-serif';
    scannerState.ocrResult.words.forEach(w => {
      if (!w.bbox) return;
      ctx.strokeRect(w.bbox.x0, w.bbox.y0, w.bbox.x1 - w.bbox.x0, w.bbox.y1 - w.bbox.y0);
    });
    ctx.restore();
  }

  // 6. Cell Regions & Boxes
  if (scannerState.cells && scannerState.cells.length > 0) {
    scannerState.cells.forEach(cell => {
      const w = cell.xmax - cell.xmin;
      const h = cell.ymax - cell.ymin;
      const isHovered = scannerState.hoveredCellId === cell.id;
      const isSelected = scannerState.selectedCellId === cell.id;

      // Region Fill
      if (scannerState.activeLayers.regions) {
        ctx.save();
        ctx.fillStyle = cell.classification === 'confirmed' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)';
        ctx.fillRect(cell.xmin, cell.ymin, w, h);
        ctx.restore();
      }

      // Cell Boundary Box
      if (scannerState.activeLayers.cells) {
        ctx.save();
        ctx.strokeStyle = isSelected ? '#f59e0b' : (isHovered ? '#38bdf8' : 'rgba(255, 255, 255, 0.3)');
        ctx.lineWidth = isSelected ? 3 : (isHovered ? 2 : 1);
        ctx.strokeRect(cell.xmin, cell.ymin, w, h);

        // Draw Cell Label & OCR Text Preview
        if (w > 40 && h > 20) {
          const matchedSlot = (scannerState.fusedSlots || []).find(s => s.cellId === cell.id);
          const labelText = matchedSlot ? matchedSlot.subjectName : (cell.ocrText || `C#${cell.id}`);

          ctx.fillStyle = isSelected ? '#f59e0b' : (isHovered ? '#38bdf8' : 'rgba(15, 23, 42, 0.85)');
          ctx.fillRect(cell.xmin + 2, cell.ymin + 2, Math.min(w - 4, 110), 16);

          ctx.fillStyle = isSelected || isHovered ? '#000' : '#fff';
          ctx.font = '700 10px "DM Sans", sans-serif';
          ctx.fillText(labelText.slice(0, 14), cell.xmin + 5, cell.ymin + 13);
        }
        ctx.restore();
      }
    });
  }
}

function updateStudioInfoBox(cell) {
  const box = document.getElementById('studio-info-box');
  if (!box) return;

  const matchedSlot = (scannerState.fusedSlots || []).find(s => s.cellId === cell.id);
  const matchedSubj = matchedSlot ? subjects.find(s => s.id === matchedSlot.subjectId) : null;
  const dayName = matchedSlot ? DAYS_MAP.find(d => d.num === matchedSlot.day)?.name : 'Unassigned';

  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
      <div>
        <div style="font-weight:700;color:var(--primary-deep)">Cell #${cell.id} · Row ${cell.row !== undefined ? cell.row : '?'}, Col ${cell.col !== undefined ? cell.col : '?'}</div>
        <div style="font-size:.8125rem;color:var(--text2);margin-top:2px">
          Bounds: x ${Math.round(cell.xmin)}–${Math.round(cell.xmax)}, y ${Math.round(cell.ymin)}–${Math.round(cell.ymax)} (${Math.round(cell.xmax - cell.xmin)} × ${Math.round(cell.ymax - cell.ymin)}px)
        </div>
      </div>
      <button class="btn-pri btn-sm" onclick="openCellInspector('${cell.id}')">🔬 Open cell inspector</button>
    </div>
    <div class="info-grid">
      <div class="info-tile">
        <span class="info-tile-lbl">Text found</span>
        <span class="info-tile-val">${escapeHTML(cell.ocrText || (matchedSlot ? matchedSlot.subjectName : '—'))}</span>
        <div class="info-tile-sub">Confidence ${cell.ocrConfidence || (matchedSlot ? Math.round(matchedSlot.ocrConfidence || 85) : 0)}%</div>
      </div>
      <div class="info-tile">
        <span class="info-tile-lbl">Schedule slot</span>
        <span class="info-tile-val">${dayName} · Period ${matchedSlot ? matchedSlot.period : '?'}</span>
        <div class="info-tile-sub">${matchedSubj ? `✓ ${escapeHTML(matchedSubj.name)}` : (matchedSlot?.isBreak ? '☕ Break' : 'Unmapped')}</div>
      </div>
      <div class="info-tile">
        <span class="info-tile-lbl">Boundaries</span>
        <div class="info-tile-sub" style="margin-top:2px">
          Top <strong style="color:var(--good)">${cell.edges?.top?.type || 'conf'}</strong> ·
          Right <strong style="color:var(--good)">${cell.edges?.right?.type || 'conf'}</strong><br>
          Bottom <strong style="color:var(--good)">${cell.edges?.bottom?.type || 'conf'}</strong> ·
          Left <strong style="color:var(--good)">${cell.edges?.left?.type || 'conf'}</strong>
        </div>
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════
//  HISTORY, UNDO / REDO & EXPORT
// ══════════════════════════════════════════════════════

function pushScannerHistory(actionName) {
  if (scannerState.historyIndex < scannerState.history.length - 1) {
    scannerState.history = scannerState.history.slice(0, scannerState.historyIndex + 1);
  }

  const snapshot = {
    fusedSlots: JSON.parse(JSON.stringify(scannerState.fusedSlots)),
    cells: JSON.parse(JSON.stringify(scannerState.cells))
  };

  scannerState.history.push(snapshot);
  if (scannerState.history.length > 30) scannerState.history.shift();
  scannerState.historyIndex = scannerState.history.length - 1;

  updateStudioHistoryButtons();
}

function updateStudioHistoryButtons() {
  const btnUndo = document.getElementById('btn-studio-undo');
  const btnRedo = document.getElementById('btn-studio-redo');
  const btnReset = document.getElementById('btn-studio-reset-edits');

  if (btnUndo) btnUndo.disabled = scannerState.historyIndex <= 0;
  if (btnRedo) btnRedo.disabled = scannerState.historyIndex >= scannerState.history.length - 1;
  if (btnReset) btnReset.disabled = scannerState.history.length <= 1;
}

function studioUndo() {
  if (scannerState.historyIndex > 0) {
    scannerState.historyIndex--;
    const state = scannerState.history[scannerState.historyIndex];
    scannerState.fusedSlots = JSON.parse(JSON.stringify(state.fusedSlots));
    if (state.cells) scannerState.cells = JSON.parse(JSON.stringify(state.cells));
    timetable = scannerState.fusedSlots;
    saveTimetableToStorageAndDB();
    renderTimetable();
    renderStudioCanvas();
    updateStudioHistoryButtons();
    toast('Undo successful');
  }
}

function studioRedo() {
  if (scannerState.historyIndex < scannerState.history.length - 1) {
    scannerState.historyIndex++;
    const state = scannerState.history[scannerState.historyIndex];
    scannerState.fusedSlots = JSON.parse(JSON.stringify(state.fusedSlots));
    if (state.cells) scannerState.cells = JSON.parse(JSON.stringify(state.cells));
    timetable = scannerState.fusedSlots;
    saveTimetableToStorageAndDB();
    renderTimetable();
    renderStudioCanvas();
    updateStudioHistoryButtons();
    toast('Redo successful');
  }
}

function studioResetEdits() {
  if (scannerState.history.length > 0) {
    const initialState = scannerState.history[0];
    scannerState.fusedSlots = JSON.parse(JSON.stringify(initialState.fusedSlots));
    if (initialState.cells) scannerState.cells = JSON.parse(JSON.stringify(initialState.cells));
    timetable = scannerState.fusedSlots;
    scannerState.historyIndex = 0;
    saveTimetableToStorageAndDB();
    renderTimetable();
    renderStudioCanvas();
    updateStudioHistoryButtons();
    toast('Edits discarded, restored scanned schedule');
  }
}

function exportScannerJSON() {
  const exportPayload = {
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    image: {
      width: scannerState.originalWidth,
      height: scannerState.originalHeight,
      skewAngle: scannerState.preprocessed ? scannerState.preprocessed.skewAngle : 0
    },
    geometry: {
      horizontalLinesCount: scannerState.grid?.horizontalLines?.length || 0,
      verticalLinesCount: scannerState.grid?.verticalLines?.length || 0,
      cellsCount: scannerState.cells?.length || 0
    },
    layout: scannerState.layout,
    timetable: scannerState.fusedSlots,
    validation: scannerState.validation
  };

  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportPayload, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute('href', dataStr);
  downloadAnchor.setAttribute('download', `bunkkro-timetable-${Date.now()}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  toast('Exported timetable analysis JSON 📥');
}

// ══════════════════════════════════════════════════════
//  MULTI-ENGINE CELL INSPECTOR MODAL & MUTATIONS
// ══════════════════════════════════════════════════════

let currentInspectedCellId = null;

function openCellInspector(cellId) {
  currentInspectedCellId = cellId;
  const cell = (scannerState.cells || []).find(c => c.id === cellId);
  const slot = (scannerState.fusedSlots || []).find(s => s.cellId === cellId);

  const title = document.getElementById('insp-cell-title');
  const sub = document.getElementById('insp-cell-sub');
  const ocrTextEl = document.getElementById('insp-ocr-text');
  const ocrConfEl = document.getElementById('insp-ocr-conf');
  const boundStatusEl = document.getElementById('insp-bound-status');
  const gridPosEl = document.getElementById('insp-grid-pos');
  const select = document.getElementById('insp-subject-select');
  const nameInput = document.getElementById('insp-subject-name-input');
  const overlay = document.getElementById('cell-inspector-overlay');

  if (title) title.textContent = `Cell Evidence Inspector #${cellId} 🔬`;
  if (sub) {
    const dayName = slot ? DAYS_MAP.find(d => d.num === slot.day)?.name : 'Day ?';
    sub.textContent = `${dayName} · Period ${slot ? slot.period : '?'}`;
  }

  const ocrText = cell?.ocrText || slot?.subjectName || '—';
  const ocrConf = cell?.ocrConfidence || slot?.ocrConfidence || 85;

  if (ocrTextEl) ocrTextEl.textContent = ocrText;
  if (ocrConfEl) ocrConfEl.textContent = `${Math.round(ocrConf)}% confidence`;
  if (boundStatusEl) boundStatusEl.textContent = cell?.classification || 'Confirmed';
  if (gridPosEl) gridPosEl.textContent = `Row ${cell?.row !== undefined ? cell.row : '?'}, Col ${cell?.col !== undefined ? cell.col : '?'}`;

  // Populate Subject Dropdown
  if (select) {
    select.innerHTML = '<option value="">-- Choose Existing Subject --</option>' +
      subjects.map(s => `<option value="${s.id}" ${slot && slot.subjectId === s.id ? 'selected' : ''}>${escapeHTML(s.name)} (${pct(s)}%)</option>`).join('');
  }

  if (nameInput) {
    nameInput.value = slot ? slot.subjectName : (cell?.ocrText || '');
  }

  // Draw Cell Region Crop Preview
  renderCellCropPreview(cell);

  if (overlay) overlay.classList.add('show');
}

function renderCellCropPreview(cell) {
  const cropCanvas = document.getElementById('insp-crop-canvas');
  if (!cropCanvas || !scannerState.preprocessed || !cell) return;

  const srcCanvas = scannerState.preprocessed.canvas;
  const padding = 10;
  const cropX = Math.max(0, cell.xmin - padding);
  const cropY = Math.max(0, cell.ymin - padding);
  const cropW = Math.min(srcCanvas.width - cropX, (cell.xmax - cell.xmin) + padding * 2);
  const cropH = Math.min(srcCanvas.height - cropY, (cell.ymax - cell.ymin) + padding * 2);

  cropCanvas.width = cropW;
  cropCanvas.height = cropH;

  const ctx = cropCanvas.getContext('2d');
  ctx.drawImage(srcCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  // Draw border around cell within crop
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 2;
  ctx.strokeRect(cell.xmin - cropX, cell.ymin - cropY, cell.xmax - cell.xmin, cell.ymax - cell.ymin);
}

function closeCellInspector() {
  const overlay = document.getElementById('cell-inspector-overlay');
  if (overlay) overlay.classList.remove('show');
  currentInspectedCellId = null;
}

function onInspectorSubjectChange(subjId) {
  if (!subjId) return;
  const s = subjects.find(x => x.id === subjId);
  if (s) {
    const nameInput = document.getElementById('insp-subject-name-input');
    if (nameInput) nameInput.value = s.name;
  }
}

async function createSubjectFromInspector() {
  const nameInput = document.getElementById('insp-subject-name-input');
  const rawName = nameInput ? nameInput.value.trim() : '';

  const subjName = await askDialog({ title: 'New subject', ok: 'Create subject', cat: 'cat-laptop', input: { label: 'Subject name', value: rawName || '', placeholder: 'e.g. Mathematics' } });
  if (!subjName) return;

  const ok = await addSubject({
    name: subjName,
    code: subjName.slice(0, 3).toUpperCase() + '101',
    perWeek: 3,
    total: 0,
    present: 0
  });

  if (ok) {
    const created = subjects[subjects.length - 1];
    const select = document.getElementById('insp-subject-select');
    if (select && created) {
      select.innerHTML += `<option value="${created.id}" selected>${escapeHTML(created.name)} (0%)</option>`;
      select.value = created.id;
    }
    toast(`Created subject "${subjName}" ✓`);
  }
}

function inspectorSplitCell(direction) {
  if (!currentInspectedCellId) return;

  const cellIdx = (scannerState.cells || []).findIndex(c => c.id === currentInspectedCellId);
  if (cellIdx === -1) return;

  const cell = scannerState.cells[cellIdx];
  const slotIdx = (scannerState.fusedSlots || []).findIndex(s => s.cellId === currentInspectedCellId);

  if (direction === 'v') {
    // Split vertically (into 2 periods)
    const midX = (cell.xmin + cell.xmax) / 2;
    const cell1 = { ...cell, xmax: midX, id: cell.id + '_a' };
    const cell2 = { ...cell, xmin: midX, id: cell.id + '_b' };

    scannerState.cells.splice(cellIdx, 1, cell1, cell2);

    if (slotIdx !== -1) {
      const slot = scannerState.fusedSlots[slotIdx];
      const slot1 = { ...slot, id: 'tt_' + Date.now() + '_1', cellId: cell1.id };
      const slot2 = { ...slot, id: 'tt_' + Date.now() + '_2', cellId: cell2.id, period: slot.period + 1 };
      scannerState.fusedSlots.splice(slotIdx, 1, slot1, slot2);
    }
  } else {
    // Split horizontally (into 2 rows)
    const midY = (cell.ymin + cell.ymax) / 2;
    const cell1 = { ...cell, ymax: midY, id: cell.id + '_a' };
    const cell2 = { ...cell, ymin: midY, id: cell.id + '_b' };

    scannerState.cells.splice(cellIdx, 1, cell1, cell2);
  }

  pushScannerHistory('Split Cell');
  timetable = scannerState.fusedSlots;
  saveTimetableToStorageAndDB();
  renderTimetable();
  renderStudioCanvas();
  closeCellInspector();
  toast('Cell split into two slots ✓');
}

function inspectorToggleBreak() {
  if (!currentInspectedCellId) return;
  const slot = (scannerState.fusedSlots || []).find(s => s.cellId === currentInspectedCellId);
  if (!slot) return;

  slot.isBreak = !slot.isBreak;
  if (slot.isBreak) {
    slot.subjectName = 'Break / Lunch';
    slot.subjectId = null;
  }

  pushScannerHistory('Toggle Break');
  timetable = scannerState.fusedSlots;
  saveTimetableToStorageAndDB();
  renderTimetable();
  renderStudioCanvas();
  closeCellInspector();
  toast(slot.isBreak ? 'Marked as Break ☕' : 'Marked as Class Slot');
}

function inspectorDeleteCell() {
  if (!currentInspectedCellId) return;

  scannerState.cells = (scannerState.cells || []).filter(c => c.id !== currentInspectedCellId);
  scannerState.fusedSlots = (scannerState.fusedSlots || []).filter(s => s.cellId !== currentInspectedCellId);

  pushScannerHistory('Delete Cell');
  timetable = scannerState.fusedSlots;
  saveTimetableToStorageAndDB();
  renderTimetable();
  renderStudioCanvas();
  closeCellInspector();
  toast('Cell deleted');
}

async function saveCellInspectorChanges() {
  if (!currentInspectedCellId) return;

  const select = document.getElementById('insp-subject-select');
  const nameInput = document.getElementById('insp-subject-name-input');

  const subjId = select ? select.value : '';
  const customName = nameInput ? nameInput.value.trim() : '';

  const slot = (scannerState.fusedSlots || []).find(s => s.cellId === currentInspectedCellId);
  if (slot) {
    slot.subjectId = subjId || null;
    slot.subjectName = customName || (subjects.find(s => s.id === subjId)?.name || 'Unassigned');
    slot.isUncertain = false;
  }

  pushScannerHistory('Edit Cell Properties');
  timetable = scannerState.fusedSlots;
  const synced = await saveTimetableToStorageAndDB();
  renderTimetable();
  renderStudioCanvas();
  closeCellInspector();
  if (synced !== false) toast('Changes applied ✓');
}

// ══════════════════════════════════════════════════════
//  CROSS-ENGINE DISAGREEMENT & VALIDATION REPORT
// ══════════════════════════════════════════════════════

function renderValidationReport() {
  const container = document.getElementById('disagree-items-list');
  const badge = document.getElementById('disagree-badge-count');
  if (!container) return;

  const val = scannerState.validation || { warnings: [], errors: [], disagreements: [] };
  const allIssues = [
    ...(val.errors || []).map(e => ({ type: 'error', ...e })),
    ...(val.warnings || []).map(w => ({ type: 'warn', ...w })),
    ...(val.disagreements || []).map(d => ({ type: 'disagree', ...d }))
  ];

  if (badge) {
    if (allIssues.length > 0) {
      badge.textContent = allIssues.length;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  if (allIssues.length === 0) {
    container.innerHTML = `
      <div class="empty">
        <img class="empty-illus" src="assets/cat-trophy.svg" alt="">
        <h3>All clear ✓</h3>
        <p>No layout conflicts, boundary disagreements or low-confidence text found in this scan.</p>
      </div>
    `;
    return;
  }

  const renderItem = (item) => {
    const isErr = item.type === 'error';
    const isDisagree = item.type === 'disagree';
    const icon = isErr ? '⛔' : (isDisagree ? '⚡' : '⚠️');
    const color = isErr ? 'var(--danger)' : (isDisagree ? 'var(--info)' : 'var(--warn)');
    const label = item.message || item.text || 'Cross-engine discrepancy';
    const detail = item.details || item.recommendation || 'Compare the grid lines with the detected text in the Inspector tab.';
    return `
      <div class="disagree-item-card">
        <div class="disagree-row">
          <span class="disagree-icon" aria-hidden="true">${icon}</span>
          <div class="disagree-body">
            <div class="disagree-title" style="color:${color}">${escapeHTML(label)}</div>
            <div class="disagree-detail">${escapeHTML(detail)}</div>
          </div>
          ${item.cellId ? `<button class="btn-sec btn-sm" style="flex-shrink:0" onclick="switchTimetableTab('studio'); scannerState.selectedCellId = '${item.cellId}'; renderStudioCanvas();">Inspect</button>` : ''}
        </div>
      </div>
    `;
  };

  const errors = allIssues.filter(i => i.type === 'error');
  const warnings = allIssues.filter(i => i.type === 'warn');
  const info = allIssues.filter(i => i.type === 'disagree');

  let html = '';
  if (errors.length) {
    html += `<div class="vgroup"><div class="vgroup-heading errors">⛔ Errors <span class="count">(${errors.length})</span></div>${errors.map(renderItem).join('')}</div>`;
  }
  if (warnings.length) {
    html += `<div class="vgroup"><div class="vgroup-heading warnings">⚠️ Warnings <span class="count">(${warnings.length})</span></div>${warnings.map(renderItem).join('')}</div>`;
  }
  if (info.length) {
    html += `<div class="vgroup"><div class="vgroup-heading info">⚡ Engine Disagreements <span class="count">(${info.length})</span></div>${info.map(renderItem).join('')}</div>`;
  }
  container.innerHTML = html;
}


// ══════════════════════════════════════════════════════
//  FEATURE 2: WEEKLY TIMETABLE GRID & EDITOR
// ══════════════════════════════════════════════════════

const DAYS_MAP = [
  { num: 1, name: 'Monday', short: 'Mon' },
  { num: 2, name: 'Tuesday', short: 'Tue' },
  { num: 3, name: 'Wednesday', short: 'Wed' },
  { num: 4, name: 'Thursday', short: 'Thu' },
  { num: 5, name: 'Friday', short: 'Fri' },
  { num: 6, name: 'Saturday', short: 'Sat' },
  { num: 7, name: 'Sunday', short: 'Sun' }
];

function updateUploadCardState() {
  const dropzone = document.getElementById('tt-dropzone');
  const loadedBar = document.getElementById('tt-loaded-bar');
  if (!dropzone || !loadedBar) return;
  const hasData = timetable.length > 0;
  dropzone.style.display = hasData ? 'none' : '';
  loadedBar.style.display = hasData ? 'flex' : 'none';
  if (hasData) {
    const label = document.getElementById('tt-loaded-label');
    const count = timetable.filter(s => !s.isBreak).length;
    if (label && loadedBar.style.display === 'flex') {
      label.textContent = `${count} class${count !== 1 ? 'es' : ''} loaded`;
    }
  }
}

function renderTimetable() {
  const container = document.getElementById('tt-grid-wrap');
  const badge = document.getElementById('tt-stats-badge');
  const sundayBtn = document.getElementById('btn-toggle-sunday');

  if (!container) return;

  updateUploadCardState();

  const activeDays = DAYS_MAP.filter(d => d.num <= 6 || timetableMeta.showSunday);

  if (sundayBtn) {
    sundayBtn.textContent = timetableMeta.showSunday ? '- Sunday' : '+ Sunday';
  }

  const validSubjectSlots = timetable.filter(s => !s.isBreak);
  if (badge) {
    badge.textContent = `${validSubjectSlots.length} class${validSubjectSlots.length !== 1 ? 'es' : ''} scheduled`;
  }

  if (!timetable.length) {
    container.innerHTML = `
      <div class="empty">
        <img class="empty-illus" src="assets/cat-peek.svg" alt="">
        <h3>No weekly schedule yet</h3>
        <p>Upload your timetable screenshot above, add class periods by hand, or import a classmate's setup.</p>
        <div class="empty-actions">
          <button class="btn-pri" onclick="openAddSlotModal(1, 1)">${ic('plus','ic-sm')} Add first class</button>
          <button class="btn-sec" onclick="openSharePack('in')">${ic('users','ic-sm')} Import from a classmate</button>
        </div>
      </div>
    `;
    return;
  }

  // Render weekly grid table
  const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  let html = `
    <p class="tt-dnd-hint">${ic('layers','ic-sm')} ${coarse ? 'Press and hold a class to drag it' : 'Drag a class to move it'} · drop it on another class to swap</p>
    <table class="tt-table">
      <thead>
        <tr>
          <th style="width:130px">Day</th>
          <th>Periods &amp; subjects</th>
        </tr>
      </thead>
      <tbody>
  `;

  activeDays.forEach(dayInfo => {
    const daySlots = timetable
      .filter(s => s.day === dayInfo.num)
      .sort((a, b) => a.period - b.period);

    html += `
      <tr data-day="${dayInfo.num}">
        <td class="tt-day-cell">
          <div class="tt-day-chip d${dayInfo.num}">${dayInfo.short}</div>
          <div class="tt-day-name">${dayInfo.name}</div>
          <div class="tt-day-count">${daySlots.filter(s=>!s.isBreak).length} classes</div>
        </td>
        <td>
          <div class="tt-slots-col" data-day="${dayInfo.num}">
            ${daySlots.map(slot => {
              const subjIdx = subjects.findIndex(s => s.id === slot.subjectId);
              const matchedSubj = subjIdx >= 0 ? subjects[subjIdx] : null;
              const displayName = matchedSubj ? matchedSubj.name : slot.subjectName;
              const timeDisplay = slot.startTime ? (slot.endTime ? `${slot.startTime} - ${slot.endTime}` : slot.startTime) : '';

              if (slot.isBreak) {
                return `
                  <button class="tt-slot-card break" data-slot-id="${slot.id}" onclick="openEditSlotModal('${slot.id}')" title="Click to edit · drag to move" aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown">
                    <span class="tt-slot-top">
                      <span class="tt-slot-pnum">P${slot.period}</span>
                      <span class="tt-slot-time">${escapeHTML(timeDisplay || 'Break')}</span>
                    </span>
                    <span class="tt-slot-name" style="display:block">☕ ${escapeHTML(slot.subjectName)}</span>
                  </button>
                `;
              }

              const th = subjTheme(subjIdx);
              const accent = matchedSubj && !slot.isUncertain ? ` style="border-left-color:${th.c};background:linear-gradient(135deg,${th.bg},var(--surface) 85%)"` : '';
              return `
                <button class="tt-slot-card ${slot.isUncertain ? 'uncertain' : ''}" data-slot-id="${slot.id}"${accent} onclick="openEditSlotModal('${slot.id}')" title="Click to edit · drag to move" aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown">
                  <span class="tt-slot-top">
                    <span class="tt-slot-pnum">Period ${slot.period}</span>
                    <span class="tt-slot-time">${escapeHTML(timeDisplay)}</span>
                  </span>
                  <span class="tt-slot-name"><span class="tt-slot-ic" style="color:${matchedSubj && !slot.isUncertain ? th.c : 'var(--muted)'}">${ic(subjIcon(displayName),'ic-sm')}</span>${escapeHTML(displayName)}</span>
                  ${slot.isUncertain ? '<span class="tt-slot-warn" style="display:block">⚠️ Review subject</span>' : ''}
                  ${matchedSubj ? `<span class="tt-slot-subjtag" style="display:block">✓ Linked to ${escapeHTML(matchedSubj.name)}</span>` : ''}
                </button>
              `;
            }).join('')}
            <button class="tt-add-slot-btn" onclick="openAddSlotModal(${dayInfo.num}, ${(daySlots.length ? Math.max(...daySlots.map(s=>s.period)) + 1 : 1)})">+ Add class</button>
          </div>
        </td>
      </tr>
    `;
  });

  html += `</tbody></table>`;
  container.innerHTML = html;
  initTimetableDrag();
}

// ══════════════════════════════════════════════════════
//  TIMETABLE DRAG & DROP
//  Drop a class on another class to swap them, or in a gap to move it there.
//  Period numbers and times belong to the position, so classes slide through
//  a day's time slots. A slot keeps its id, so marks for today stay with it.
// ══════════════════════════════════════════════════════

const ttDrag = { el: null, slot: null, active: false, target: null, suppressClick: false };

function ttDaySlots(day) {
  return timetable.filter(s => s.day === day).sort((a, b) => a.period - b.period);
}
function ttSlotPos(s) {
  return { day: s.day, period: s.period, startTime: s.startTime || '', endTime: s.endTime || '' };
}
function ttSlotLabel(s) {
  if (s.isBreak) return s.subjectName || 'Break';
  return subjects.find(x => x.id === s.subjectId)?.name || s.subjectName || 'Class';
}

// The usual times for a period number across the week (most common pair).
function ttBellTimes(period) {
  const counts = {};
  timetable.forEach(s => {
    if (s.period === period && s.startTime) {
      const k = s.startTime + '|' + (s.endTime || '');
      counts[k] = (counts[k] || 0) + 1;
    }
  });
  const best = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  if (!best) return { startTime: '', endTime: '' };
  const [startTime, endTime] = best.split('|');
  return { startTime, endTime };
}

// Hand out positions to items in visual order. Breaks stay where they are
// unless a break is the one being moved.
function ttLayoutDay(items, positions, keepBreaks) {
  const pos = positions.slice().sort((a, b) => a.period - b.period || a.startTime.localeCompare(b.startTime));
  let movable = items;
  if (keepBreaks) {
    items.filter(s => s.isBreak).forEach(b => {
      const i = pos.findIndex(p => p.period === b.period);
      if (i >= 0) pos.splice(i, 1);
    });
    movable = items.filter(s => !s.isBreak);
  }
  movable.forEach((s, i) => { if (pos[i]) Object.assign(s, pos[i]); });
}

// Move `slot` to `day`, before the slot with id `beforeId` (null = at the end).
function ttMoveSlot(slot, day, beforeId) {
  if (slot.day === day) {
    const dayItems = ttDaySlots(day);
    const positions = dayItems.map(ttSlotPos);
    const order = dayItems.filter(s => s !== slot);
    const k = beforeId ? order.findIndex(s => String(s.id) === beforeId) : order.length;
    order.splice(k < 0 ? order.length : k, 0, slot);
    ttLayoutDay(order, positions, !slot.isBreak);
    return;
  }
  const target = ttDaySlots(day);
  let k = beforeId ? target.findIndex(s => String(s.id) === beforeId) : target.length;
  if (k < 0) k = target.length;
  const lo = k > 0 ? target[k - 1].period : 0;
  const hi = k < target.length ? target[k].period : Infinity;
  if (hi - lo > 1) {
    // A free period sits right where it was dropped: take it.
    const p = slot.period > lo && slot.period < hi ? slot.period : lo + 1;
    const times = p === slot.period ? { startTime: slot.startTime || '', endTime: slot.endTime || '' } : ttBellTimes(p);
    Object.assign(slot, { day, period: p }, times);
    return;
  }
  // No free period there: the classes from the drop point slide one period
  // down, up to the next free period (a gap in the day, or after the last one).
  let j = k;
  while (j + 1 < target.length && target[j + 1].period - target[j].period <= 1) j++;
  const run = target.slice(k, j + 1);
  const newP = target[j].period + 1;
  const extra = { day, period: newP, ...ttBellTimes(newP) };
  ttLayoutDay([slot, ...run], [...run.map(ttSlotPos), extra], !slot.isBreak);
}

function ttSwapSlots(a, b) {
  const pa = ttSlotPos(a), pb = ttSlotPos(b);
  Object.assign(a, pb);
  Object.assign(b, pa);
}

function ttApplyMove(change, describe) {
  const before = JSON.stringify(timetable.map(ttSlotPos));
  change();
  if (JSON.stringify(timetable.map(ttSlotPos)) === before) return false;
  renderTimetable();
  saveTimetableToStorageAndDB();
  if (currPage === 'tracker') renderTracker();
  toast(describe());
  return true;
}

function ttDropDescribe(slot) {
  const d = DAYS_MAP.find(x => x.num === slot.day);
  return `${ttSlotLabel(slot)} → ${d ? d.name : 'Day ' + slot.day} · Period ${slot.period}`;
}

function initTimetableDrag() {
  const wrap = document.getElementById('tt-grid-wrap');
  if (!wrap || wrap.dataset.dnd) return;
  wrap.dataset.dnd = '1';
  wrap.addEventListener('pointerdown', ttPointerDown);
  // A finished drag must not also open the edit modal.
  wrap.addEventListener('click', e => {
    if (ttDrag.suppressClick) { e.stopPropagation(); e.preventDefault(); ttDrag.suppressClick = false; }
  }, true);
  wrap.addEventListener('contextmenu', e => { if (ttDrag.el) e.preventDefault(); });
  wrap.addEventListener('keydown', ttKeyMove);
  document.addEventListener('touchmove', e => { if (ttDrag.active) e.preventDefault(); }, { passive: false });
  document.addEventListener('keydown', e => {
    if (ttDrag.active && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); ttEndDrag(false); }
  }, true);
  window.addEventListener('blur', () => { if (ttDrag.el) ttEndDrag(false); });
}

function ttPointerDown(e) {
  const card = e.target.closest('.tt-slot-card[data-slot-id]');
  if (!card || e.button !== 0 || !e.isPrimary || ttDrag.el) return;
  const slot = timetable.find(s => String(s.id) === card.dataset.slotId);
  if (!slot) return;
  Object.assign(ttDrag, {
    el: card, slot, active: false, target: null, pointerId: e.pointerId, type: e.pointerType,
    startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY,
  });
  if (e.pointerType === 'touch') {
    // Press and hold so a normal swipe still scrolls the page.
    ttDrag.timer = setTimeout(() => { ttDrag.timer = null; ttStartDrag(); navigator.vibrate?.(12); }, 300);
  }
  document.addEventListener('pointermove', ttPointerMove);
  document.addEventListener('pointerup', ttPointerUp);
  document.addEventListener('pointercancel', ttPointerCancel);
}

function ttPointerMove(e) {
  if (e.pointerId !== ttDrag.pointerId) return;
  ttDrag.x = e.clientX; ttDrag.y = e.clientY;
  if (!ttDrag.active) {
    const dist = Math.hypot(e.clientX - ttDrag.startX, e.clientY - ttDrag.startY);
    if (ttDrag.type === 'touch') { if (dist > 10) ttEndDrag(false); return; }
    if (dist < 6) return;
    ttStartDrag();
  }
  e.preventDefault();
  ttUpdateDrag();
}

function ttPointerUp(e) {
  if (e.pointerId !== ttDrag.pointerId) return;
  ttEndDrag(ttDrag.active);
}
function ttPointerCancel(e) {
  if (e.pointerId !== ttDrag.pointerId) return;
  ttEndDrag(false);
}

function ttStartDrag() {
  const card = ttDrag.el;
  if (!card || !card.isConnected) { ttEndDrag(false); return; }
  ttDrag.active = true;
  const r = card.getBoundingClientRect();
  ttDrag.offX = ttDrag.startX - r.left;
  ttDrag.offY = ttDrag.startY - r.top;
  const ghost = card.cloneNode(true);
  ghost.removeAttribute('onclick');
  ghost.removeAttribute('data-slot-id');
  ghost.removeAttribute('id');
  ghost.classList.add('tt-drag-ghost');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.style.width = r.width + 'px';
  ghost.style.height = r.height + 'px';
  document.body.appendChild(ghost);
  ttDrag.ghost = ghost;
  const marker = document.createElement('div');
  marker.className = 'tt-drop-marker';
  document.body.appendChild(marker);
  ttDrag.marker = marker;
  card.classList.add('is-dragging');
  document.body.classList.add('tt-dragging');
  ttUpdateDrag();
  ttDrag.raf = requestAnimationFrame(ttAutoScroll);
}

// Keep the page (and the sideways-scrolling grid on phones) moving near edges.
function ttAutoScroll() {
  if (!ttDrag.active) return;
  const edge = 70, max = 16;
  const { x, y } = ttDrag;
  let moved = false;
  if (y < edge) { window.scrollBy({ top: -Math.ceil(max * (1 - y / edge)), behavior: 'instant' }); moved = true; }
  else if (y > innerHeight - edge) { window.scrollBy({ top: Math.ceil(max * (1 - (innerHeight - y) / edge)), behavior: 'instant' }); moved = true; }
  const wrap = document.getElementById('tt-grid-wrap');
  if (wrap && wrap.scrollWidth > wrap.clientWidth) {
    const wr = wrap.getBoundingClientRect();
    if (y > wr.top && y < wr.bottom) {
      if (x < wr.left + 40) { wrap.scrollLeft -= 10; moved = true; }
      else if (x > wr.right - 40) { wrap.scrollLeft += 10; moved = true; }
    }
  }
  if (moved) ttUpdateDrag();
  ttDrag.raf = requestAnimationFrame(ttAutoScroll);
}

function ttClearHighlights() {
  document.querySelectorAll('.tt-slot-card.is-swap-target').forEach(el => el.classList.remove('is-swap-target'));
  document.querySelectorAll('tr.is-drop-row').forEach(el => el.classList.remove('is-drop-row'));
  if (ttDrag.marker) ttDrag.marker.style.display = 'none';
}

function ttUpdateDrag() {
  const { x, y, ghost, el } = ttDrag;
  if (ghost) ghost.style.transform = `translate(${x - ttDrag.offX}px, ${y - ttDrag.offY}px) rotate(-2deg)`;
  ttClearHighlights();
  ttDrag.target = null;

  const under = document.elementFromPoint(x, y);
  const tr = under && under.closest('#tt-grid-wrap tr[data-day]');
  if (!tr) return;
  const day = parseInt(tr.dataset.day);
  const col = tr.querySelector('.tt-slots-col');
  const cards = [...col.querySelectorAll('.tt-slot-card[data-slot-id]')].filter(c => c !== el);
  const overCard = under.closest('.tt-slot-card[data-slot-id]');
  if (overCard === el) return; // back over its own spot: nothing to do

  tr.classList.add('is-drop-row');
  if (overCard) {
    const r = overCard.getBoundingClientRect();
    const rel = (x - r.left) / r.width;
    if (rel > 0.25 && rel < 0.75) {
      overCard.classList.add('is-swap-target');
      ttDrag.target = { type: 'swap', id: overCard.dataset.slotId };
      return;
    }
  }
  // Insert: before the first card that comes after the pointer in reading order.
  let before = null;
  for (const c of cards) {
    const r = c.getBoundingClientRect();
    if (y < r.top || (y <= r.bottom && x < r.left + r.width / 2)) { before = c; break; }
  }
  ttDrag.target = { type: 'insert', day, beforeId: before ? before.dataset.slotId : null };

  const m = ttDrag.marker;
  if (!m) return;
  let ref, left;
  if (before) { ref = before.getBoundingClientRect(); left = ref.left - 6; }
  else if (cards.length) { ref = cards[cards.length - 1].getBoundingClientRect(); left = ref.right + 2; }
  else { ref = (col.querySelector('.tt-add-slot-btn') || col).getBoundingClientRect(); left = ref.left - 6; }
  Object.assign(m.style, { display: 'block', left: left + 'px', top: ref.top + 'px', height: ref.height + 'px' });
}

function ttEndDrag(drop) {
  clearTimeout(ttDrag.timer);
  cancelAnimationFrame(ttDrag.raf);
  document.removeEventListener('pointermove', ttPointerMove);
  document.removeEventListener('pointerup', ttPointerUp);
  document.removeEventListener('pointercancel', ttPointerCancel);
  const { slot, target, active } = ttDrag;
  ttClearHighlights();
  ttDrag.ghost?.remove();
  ttDrag.marker?.remove();
  ttDrag.el?.classList.remove('is-dragging');
  document.body.classList.remove('tt-dragging');
  Object.assign(ttDrag, { el: null, slot: null, active: false, target: null, ghost: null, marker: null, timer: null });
  if (active) {
    ttDrag.suppressClick = true;
    setTimeout(() => { ttDrag.suppressClick = false; }, 0);
  }
  if (!drop || !slot || !target) return;

  if (target.type === 'swap') {
    const other = timetable.find(s => String(s.id) === target.id);
    if (!other || other === slot) return;
    ttApplyMove(() => ttSwapSlots(slot, other), () => `Swapped ${ttSlotLabel(slot)} ⇄ ${ttSlotLabel(other)}`);
  } else {
    ttApplyMove(() => ttMoveSlot(slot, target.day, target.beforeId), () => ttDropDescribe(slot));
  }
}

// Keyboard: Alt+←/→ moves a class earlier/later in its day, Alt+↑/↓ to the previous/next day.
function ttKeyMove(e) {
  if (!e.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  const card = e.target.closest('.tt-slot-card[data-slot-id]');
  const slot = card && timetable.find(s => String(s.id) === card.dataset.slotId);
  if (!slot) return;
  e.preventDefault();
  const dayItems = ttDaySlots(slot.day);
  const idx = dayItems.indexOf(slot);
  let changed = false;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const others = dayItems.filter(s => s !== slot);
    const k = e.key === 'ArrowLeft' ? idx - 1 : idx + 1;
    if (k < 0 || k > others.length) return;
    changed = ttApplyMove(() => ttMoveSlot(slot, slot.day, others[k] ? String(others[k].id) : null), () => ttDropDescribe(slot));
  } else {
    const days = DAYS_MAP.filter(d => d.num <= 6 || timetableMeta.showSunday).map(d => d.num);
    const next = days[days.indexOf(slot.day) + (e.key === 'ArrowUp' ? -1 : 1)];
    if (!next) return;
    const target = ttDaySlots(next);
    changed = ttApplyMove(() => ttMoveSlot(slot, next, target[idx] ? String(target[idx].id) : null), () => ttDropDescribe(slot));
  }
  if (changed) document.querySelector(`#tt-grid-wrap .tt-slot-card[data-slot-id="${CSS.escape(String(slot.id))}"]`)?.focus();
}

function toggleSundayDisplay() {
  timetableMeta.showSunday = !timetableMeta.showSunday;
  renderTimetable();
}

// ══════════════════════════════════════════════════════
//  CLASS PACK — share subjects, timetable and semester dates
//  (never attendance) with classmates as a file or a text code.
// ══════════════════════════════════════════════════════
const PACK_PREFIX = 'BUNKKRO1.';
const PACK_LIMITS = { text: 300000, subjects: 60, slots: 300 };
let importedPack = null;

function buildPack() {
  const idx = new Map(subjects.map((s, i) => [s.id, i]));
  return {
    app: 'bunkkro', kind: 'class-pack', version: 1, exportedAt: new Date().toISOString(),
    semester: { start: semStart || '', end: semEnd || '', weeks: semWeeks, examDate: examDate || '', target: globalTarget },
    subjects: subjects.map(s => ({
      name: s.name, code: s.code || '', perWeek: s.perWeek || 0,
      target: s.target || null, semTotal: s.semTotal || null,
    })),
    timetable: timetable.map(t => ({
      day: t.day, period: t.period, start: t.startTime || '', end: t.endTime || '',
      subject: t.isBreak ? null : (idx.has(t.subjectId) ? idx.get(t.subjectId) : null),
      name: t.isBreak ? (t.subjectName || 'Break') : (subjects[idx.get(t.subjectId)]?.name || t.subjectName || ''),
      break: !!t.isBreak,
    })),
  };
}

function packToCode(pack) {
  const bytes = new TextEncoder().encode(JSON.stringify(pack));
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return PACK_PREFIX + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Reads a file's text or a pasted code. Returns { pack } or { error }.
// Everything in it comes from someone else, so every field is checked.
function readPack(text) {
  text = String(text || '').trim();
  if (!text) return { error: 'Choose a file or paste the text first.' };
  if (text.length > PACK_LIMITS.text) return { error: 'That file is too big to be a BunkKro class file.' };
  let raw;
  try {
    if (text.startsWith('{')) raw = JSON.parse(text);
    else {
      const at = text.indexOf(PACK_PREFIX);
      if (at < 0) return { error: "That doesn't look like a BunkKro class file or code." };
      const b64 = text.slice(at + PACK_PREFIX.length).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
      raw = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
    }
  } catch {
    return { error: "Couldn't read that — the text may be cut off. Ask for the file instead." };
  }
  if (!raw || raw.app !== 'bunkkro' || raw.kind !== 'class-pack') return { error: "That doesn't look like a BunkKro class file." };
  if (raw.version > 1) return { error: 'This file was made by a newer version of BunkKro. Refresh the page and try again.' };

  const int = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : null);
  const time = v => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : '');
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  // Subjects (duplicate names merged, remembering where each original index went)
  const subjectsIn = Array.isArray(raw.subjects) ? raw.subjects.slice(0, PACK_LIMITS.subjects) : [];
  const subs = [], remap = new Map(), byName = new Map();
  subjectsIn.forEach((s, i) => {
    const name = str(s?.name, 80);
    if (!name) return;
    const key = name.toLowerCase();
    if (byName.has(key)) { remap.set(i, byName.get(key)); return; }
    byName.set(key, subs.length); remap.set(i, subs.length);
    subs.push({ name, code: str(s.code, 20), perWeek: int(s.perWeek, 0, 30) ?? 0, target: int(s.target, 1, 100), semTotal: int(s.semTotal, 1, 5000) });
  });

  const slotsIn = Array.isArray(raw.timetable) ? raw.timetable.slice(0, PACK_LIMITS.slots) : [];
  const slots = [];
  let skipped = Math.max(0, (Array.isArray(raw.timetable) ? raw.timetable.length : 0) - PACK_LIMITS.slots);
  slotsIn.forEach(t => {
    const day = int(t?.day, 1, 7), period = int(t?.period, 1, 20);
    if (!day || !period) { skipped++; return; }
    const isBreak = t.break === true;
    const subject = !isBreak && Number.isInteger(t.subject) && remap.has(t.subject) ? remap.get(t.subject) : null;
    const name = str(t.name, 80) || (subject !== null ? subs[subject].name : isBreak ? 'Break' : '');
    if (!isBreak && subject === null && !name) { skipped++; return; }
    slots.push({ day, period, start: time(t.start), end: time(t.end), subject, name, isBreak });
  });

  if (!subs.length && !slots.length) return { error: 'That class file is empty.' };
  const sem = raw.semester || {};
  const semesterIn = {
    start: DATE_RE.test(sem.start || '') ? sem.start : '',
    end: DATE_RE.test(sem.end || '') && (!DATE_RE.test(sem.start || '') || sem.end > sem.start) ? sem.end : '',
    examDate: DATE_RE.test(sem.examDate || '') ? sem.examDate : '',
    target: int(sem.target, 1, 100),
  };
  return { pack: { subjects: subs, slots, semester: semesterIn, skipped } };
}

function openSharePack(tab) {
  document.getElementById('share-overlay').classList.add('show');
  switchShareTab(tab || (subjects.length || timetable.length ? 'out' : 'in'));
}
function closeSharePack() {
  document.getElementById('share-overlay').classList.remove('show');
}
function switchShareTab(tab) {
  const out = tab === 'out';
  document.getElementById('share-pane-out').hidden = !out;
  document.getElementById('share-pane-in').hidden = out;
  [['share-tab-out', out], ['share-tab-in', !out]].forEach(([id, on]) => {
    const b = document.getElementById(id);
    b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on));
  });
  if (out) renderShareSummary();
  else resetImportPane();
}

function renderShareSummary() {
  const box = document.getElementById('share-summary');
  const lessons = timetable.filter(t => !t.isBreak).length;
  const days = new Set(timetable.filter(t => !t.isBreak).map(t => t.day)).size;
  const empty = !subjects.length && !timetable.length;
  box.innerHTML = empty
    ? '<li>Nothing to share yet — add subjects or set up your timetable first.</li>'
    : [
      `📚 <strong>${subjects.length}</strong> subject${subjects.length !== 1 ? 's' : ''}${subjects.length ? ': ' + escapeHTML(subjects.slice(0, 4).map(s => s.name).join(', ')) + (subjects.length > 4 ? '…' : '') : ''}`,
      `🗓️ <strong>${lessons}</strong> class${lessons !== 1 ? 'es' : ''} a week${days ? ` over ${days} day${days !== 1 ? 's' : ''}` : ''}`,
      semStart ? `📅 Semester started <strong>${escapeHTML(fmtDate(semStart))}</strong>` : '📅 No semester start date set',
      `🎯 Target <strong>${globalTarget}%</strong>`,
      '🔒 Not included: your attendance, marks and history',
    ].map(x => `<li>${x}</li>`).join('');
  document.querySelectorAll('#share-pane-out .share-actions button').forEach(b => { b.disabled = empty; });
  document.getElementById('share-code').hidden = true;
  const native = document.getElementById('share-native');
  native.hidden = !(navigator.canShare && navigator.canShare({ files: [packFile()] }));
}

function packFile() {
  return new File([JSON.stringify(buildPack(), null, 2)], `bunkkro-class-${getLocalDateString()}.json`, { type: 'application/json' });
}
function downloadPack() {
  const file = packFile();
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Class file downloaded — send it to your class group');
}
async function copyPackCode() {
  const code = packToCode(buildPack());
  const box = document.getElementById('share-code');
  try {
    await navigator.clipboard.writeText(code);
    box.hidden = true;
    toast('Copied — paste it in your class group');
  } catch {
    // Clipboard blocked: show the code so it can be copied by hand
    box.value = code; box.hidden = false; box.focus(); box.select();
    toast('Select the text below and copy it');
  }
}
async function nativeSharePack() {
  try { await navigator.share({ files: [packFile()], title: 'BunkKro class setup', text: 'Import this in BunkKro → Smart Timetable → Share / Import' }); }
  catch (err) { if (err?.name !== 'AbortError') toast('Sharing failed — try Download file', 'err'); }
}

function resetImportPane() {
  importedPack = null;
  document.getElementById('pack-file').value = '';
  document.getElementById('pack-file-name').textContent = 'Choose the file you received';
  document.getElementById('pack-text').value = '';
  document.getElementById('pack-error').hidden = true;
  document.getElementById('pack-preview').innerHTML = '';
  document.getElementById('pack-import-btn').disabled = true;
}
function onPackFile(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  document.getElementById('pack-file-name').textContent = file.name;
  document.getElementById('pack-text').value = '';
  if (file.size > PACK_LIMITS.text) return showPackResult({ error: 'That file is too big to be a BunkKro class file.' });
  const reader = new FileReader();
  reader.onload = () => showPackResult(readPack(reader.result));
  reader.onerror = () => showPackResult({ error: "Couldn't open that file." });
  reader.readAsText(file);
}
function onPackText() {
  const text = document.getElementById('pack-text').value;
  if (text.trim()) document.getElementById('pack-file-name').textContent = 'Choose the file you received';
  showPackResult(text.trim() ? readPack(text) : { error: '' });
}

function showPackResult(r) {
  const err = document.getElementById('pack-error');
  const preview = document.getElementById('pack-preview');
  const btn = document.getElementById('pack-import-btn');
  importedPack = r.pack || null;
  err.textContent = r.error || ''; err.hidden = !r.error;
  btn.disabled = !importedPack;
  if (!importedPack) { preview.innerHTML = ''; return; }
  const p = importedPack;
  const have = new Set(subjects.map(s => s.name.trim().toLowerCase()));
  const fresh = p.subjects.filter(s => !have.has(s.name.toLowerCase()));
  const known = p.subjects.filter(s => have.has(s.name.toLowerCase()));
  const lessons = p.slots.filter(t => !t.isBreak).length;
  const list = arr => escapeHTML(arr.slice(0, 6).map(s => s.name).join(', ')) + (arr.length > 6 ? ` +${arr.length - 6} more` : '');
  const semBits = [];
  if (p.semester.start) semBits.push(`semester start ${escapeHTML(fmtDate(p.semester.start))}`);
  if (p.semester.end) semBits.push(`last day ${escapeHTML(fmtDate(p.semester.end))}`);
  if (p.semester.target) semBits.push(`${p.semester.target}% target`);
  preview.innerHTML = `
    <ul class="pack-summary">
      ${fresh.length ? `<li>➕ <strong>${fresh.length} new subject${fresh.length !== 1 ? 's' : ''}</strong> (starting at 0 classes): ${list(fresh)}</li>` : ''}
      ${known.length ? `<li>✅ Already in your list, kept as they are: ${list(known)}</li>` : ''}
      ${p.slots.length ? `<li>🗓️ Weekly timetable with <strong>${lessons}</strong> class${lessons !== 1 ? 'es' : ''}${timetable.length ? ' — <strong>replaces your current timetable</strong>' : ''}</li>` : '<li>🗓️ No timetable in this file — yours stays as it is</li>'}
      ${p.slots.length && Object.keys(dailyPeriodLogs[getLocalDateString()] || {}).some(k => timetable.some(t => t.id === k)) ? '<li>⚠️ Classes you already marked today stay counted, but won\'t show in today\'s list after the switch</li>' : ''}
      ${p.skipped ? `<li>⚠️ ${p.skipped} timetable entr${p.skipped !== 1 ? 'ies' : 'y'} couldn't be read and will be skipped</li>` : ''}
    </ul>
    ${semBits.length ? `<label class="pack-check"><input type="checkbox" id="pack-use-sem" checked> Also use the ${semBits.join(' and ')} from the file</label>` : ''}`;
}

async function confirmImportPack() {
  const p = importedPack;
  if (!p || !currentUser) return;
  if (p.slots.length && timetable.length && !(await askDialog({ title: 'Replace your timetable?', message: 'Your current weekly timetable will be swapped for the imported one. Your attendance numbers stay as they are.', ok: 'Replace it', cat: 'cat-mail' }))) return;
  const btn = document.getElementById('pack-import-btn');
  btn.disabled = true; btn.textContent = 'Importing…';
  try {
    // 1. Subjects: reuse ones you already have (by name), add the rest at 0 classes
    const ids = [];
    let added = 0;
    for (const s of p.subjects) {
      let mine = subjects.find(x => x.name.trim().toLowerCase() === s.name.toLowerCase());
      if (mine) {
        // Fill only what's missing; never touch attendance or settings already there
        const fill = {};
        if (!mine.perWeek && s.perWeek) fill.perWeek = s.perWeek;
        if (!mine.semTotal && s.semTotal) fill.semTotal = s.semTotal;
        if (Object.keys(fill).length) {
          Object.assign(mine, fill);
          await updateSubject(mine.id, { name: mine.name, code: mine.code || '', total: mine.total, present: mine.present, perWeek: mine.perWeek, target: mine.target, semTotal: mine.semTotal, mode: mine.mode });
        }
      } else {
        const ok = await addSubject({ name: s.name, code: s.code || s.name.slice(0, 2).toUpperCase() + '101', total: 0, present: 0, perWeek: s.perWeek, target: s.target, semTotal: s.semTotal, mode: 'exact' });
        if (!ok) throw new Error(`Couldn't add ${s.name}`);
        mine = subjects[subjects.length - 1];
        added++;
      }
      ids.push(mine.id);
    }

    // 2. Timetable (fresh ids, linked to your own subjects)
    if (p.slots.length) {
      timetable = p.slots.map(t => ({
        id: newUuid(), day: t.day, period: t.period, startTime: t.start, endTime: t.end,
        subjectId: t.isBreak || t.subject === null ? null : ids[t.subject],
        subjectName: t.isBreak ? (t.name || 'Break') : (t.subject !== null ? subjects.find(x => x.id === ids[t.subject])?.name : t.name) || t.name,
        isBreak: t.isBreak, isUncertain: false,
      }));
      timetableMeta.showSunday = timetable.some(t => t.day === 7);
      await saveTimetableToStorageAndDB();
    }

    // 3. Semester settings
    if (document.getElementById('pack-use-sem')?.checked) {
      if (p.semester.start) semStart = p.semester.start;
      if (p.semester.end) semEnd = p.semester.end;
      if (Number.isInteger(p.semester.weeks) && p.semester.weeks >= 8 && p.semester.weeks <= 30) semWeeks = p.semester.weeks;
      if (p.semester.examDate) examDate = p.semester.examDate;
      if (p.semester.target) globalTarget = p.semester.target;
      savePrefs();
    }

    closeSharePack();
    renderAll();
    goPage('timetable');
    toast(`Imported ${added ? `${added} subject${added !== 1 ? 's' : ''}` : 'the class'}${p.slots.length ? ' and the timetable' : ''} ✓`);
  } catch (err) {
    console.error('Import failed:', err);
    toast(`Import stopped: ${err.message}`, 'err');
    renderAll();
  } finally {
    btn.disabled = false; btn.textContent = 'Import';
  }
}

// ══════════════════════════════════════════════════════
//  TIMETABLE SLOT EDIT / ADD MODAL
// ══════════════════════════════════════════════════════

let currentEditingSlot = null;

function openAddSlotModal(day = 1, period = 1) {
  currentEditingSlot = null;
  slotError('');
  document.getElementById('slot-modal-title').textContent = 'Add Class Slot 🕒';
  document.getElementById('slot-edit-id').value = '';
  document.getElementById('slot-day').value = day;
  document.getElementById('slot-period').value = period;
  document.getElementById('slot-type').value = 'subject';
  document.getElementById('slot-start-time').value = '';
  document.getElementById('slot-end-time').value = '';
  document.getElementById('slot-subject-name').value = '';
  document.getElementById('btn-delete-slot').style.display = 'none';

  populateSubjectDropdown();
  onSlotTypeChange('subject');
  document.getElementById('slot-edit-overlay').classList.add('show');
}

function openEditSlotModal(slotId) {
  const slot = timetable.find(s => s.id === slotId);
  if (!slot) return;

  currentEditingSlot = slot;
  slotError('');
  document.getElementById('slot-modal-title').textContent = 'Edit Class Slot 🕒';
  document.getElementById('slot-edit-id').value = slot.id;
  document.getElementById('slot-day').value = slot.day;
  document.getElementById('slot-period').value = slot.period;
  document.getElementById('slot-type').value = slot.isBreak ? 'break' : 'subject';
  document.getElementById('slot-start-time').value = slot.startTime || '';
  document.getElementById('slot-end-time').value = slot.endTime || '';
  document.getElementById('slot-subject-name').value = slot.subjectName || '';
  document.getElementById('btn-delete-slot').style.display = 'inline-block';

  populateSubjectDropdown(slot.subjectId);
  onSlotTypeChange(slot.isBreak ? 'break' : 'subject');
  document.getElementById('slot-edit-overlay').classList.add('show');
}

function closeSlotEditModal() {
  document.getElementById('slot-edit-overlay').classList.remove('show');
  currentEditingSlot = null;
}

function populateSubjectDropdown(selectedId = null) {
  const select = document.getElementById('slot-subject-select');
  if (!select) return;

  select.innerHTML = '<option value="">-- Choose Existing Subject --</option>' + 
    subjects.map(s => `<option value="${s.id}" ${s.id === selectedId ? 'selected' : ''}>${escapeHTML(s.name)} (${pct(s)}%)</option>`).join('');
}

function onSlotTypeChange(type) {
  const subjGroup = document.getElementById('slot-subject-group');
  if (subjGroup) {
    subjGroup.style.display = type === 'break' ? 'none' : 'block';
  }
}

function onSlotSubjectSelect(subjId) {
  if (!subjId) return;
  const s = subjects.find(x => x.id === subjId);
  if (s) {
    document.getElementById('slot-subject-name').value = s.name;
  }
}

function slotError(msg, inputId) {
  const el = document.getElementById('slot-error');
  if (el) { el.textContent = msg; el.hidden = !msg; }
  if (inputId) document.getElementById(inputId)?.focus();
}

async function saveSlotModal() {
  const day = parseInt(document.getElementById('slot-day').value) || 1;
  const period = Number(document.getElementById('slot-period').value);
  const type = document.getElementById('slot-type').value;
  const isBreak = type === 'break';
  const startTime = document.getElementById('slot-start-time').value.trim();
  const endTime = document.getElementById('slot-end-time').value.trim();
  const subjSelect = document.getElementById('slot-subject-select').value;
  const subjNameInput = document.getElementById('slot-subject-name').value.trim();
  const editingId = document.getElementById('slot-edit-id').value;

  if (!Number.isInteger(period) || period < 1 || period > 20) return slotError('Period must be a number from 1 to 20.', 'slot-period');
  if (startTime && endTime && endTime <= startTime) return slotError('The class has to end after it starts.', 'slot-end-time');
  if (!isBreak && !subjSelect && !subjNameInput) return slotError('Pick one of your subjects, or type the subject name.', 'slot-subject-select');
  const clash = timetable.find(x => x.id !== editingId && x.day === day && x.period === period);
  if (clash && !(await askDialog({ title: 'That period is taken', message: `${DAYS_MAP.find(d => d.num === day).name} period ${period} already has ${ttSlotLabel(clash)}. Keep both classes in that period?`, ok: 'Keep both', cancel: 'Go back', cat: 'cat-peek' }))) return;
  slotError('');

  let subjectName = isBreak ? 'Break' : (subjNameInput || 'Unassigned');
  let subjectId = isBreak ? null : (subjSelect || null);

  // If user typed a subject name that isn't mapped, check if matches existing
  if (!isBreak && !subjectId && subjNameInput) {
    const matched = subjects.find(s => s.name.toLowerCase() === subjNameInput.toLowerCase());
    if (matched) {
      subjectId = matched.id;
      subjectName = matched.name;
    }
  }

  const slotId = document.getElementById('slot-edit-id').value;

  if (slotId) {
    // Update existing
    const idx = timetable.findIndex(s => s.id === slotId);
    if (idx !== -1) {
      timetable[idx] = {
        ...timetable[idx],
        day,
        period,
        startTime,
        endTime,
        subjectId,
        subjectName,
        isBreak,
        isUncertain: false
      };
    }
  } else {
    // Add new slot
    timetable.push({
      id: 'tt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      day,
      period,
      startTime,
      endTime,
      subjectId,
      subjectName,
      isBreak,
      isUncertain: false
    });
  }

  const synced = await saveTimetableToStorageAndDB();
  closeSlotEditModal();
  renderTimetable();
  if (currPage === 'tracker') renderTracker();
  if (synced !== false) toast('Schedule updated ✓');
}

async function deleteCurrentSlot() {
  const slotId = document.getElementById('slot-edit-id').value;
  if (!slotId) return;

  timetable = timetable.filter(s => s.id !== slotId);
  const synced = await saveTimetableToStorageAndDB();
  closeSlotEditModal();
  renderTimetable();
  if (currPage === 'tracker') renderTracker();
  if (synced !== false) toast('Slot removed');
}

async function confirmClearTimetable() {
  if (!(await askDialog({ title: 'Clear the whole timetable?', message: 'Every class in your weekly schedule will be removed. Your attendance numbers stay as they are.', ok: 'Clear timetable', danger: true }))) return;
  timetable = [];
  saveTimetableToStorageAndDB();
  renderTimetable();
  if (currPage === 'tracker') renderTracker();
  toast('Timetable cleared');
}

// ══════════════════════════════════════════════════════
//  FEATURE 3: AUTOMATICALLY CALCULATE CLASSES PER WEEK
// ══════════════════════════════════════════════════════

function calculateWeeklyFrequencies() {
  const freqMap = {}; // subjectId/subjectName -> count

  subjects.forEach(s => {
    freqMap[s.id] = 0;
  });

  timetable.forEach(slot => {
    if (slot.isBreak) return;
    if (slot.subjectId && freqMap[slot.subjectId] !== undefined) {
      freqMap[slot.subjectId]++;
    } else if (slot.subjectName) {
      const match = subjects.find(s => s.name.toLowerCase() === slot.subjectName.toLowerCase());
      if (match && freqMap[match.id] !== undefined) {
        freqMap[match.id]++;
      }
    }
  });

  return freqMap;
}

function openSyncFrequenciesModal() {
  const modal = document.getElementById('sync-freq-overlay');
  const list = document.getElementById('sync-freq-list');
  if (!modal || !list) return;

  const frequencies = calculateWeeklyFrequencies();

  if (!subjects.length) {
    list.innerHTML = `<div class="empty" style="padding:20px"><p style="margin:0">No subjects found. Add subjects first.</p></div>`;
    modal.classList.add('show');
    return;
  }

  list.innerHTML = subjects.map(s => {
    const calculated = frequencies[s.id] || 0;
    const current = s.perWeek || 0;
    const isDiff = calculated !== current;

    return `
      <div class="sync-freq-row">
        <div style="min-width:0">
          <div class="sync-freq-name">${escapeHTML(s.name)}</div>
          <div class="sync-freq-cur">Currently ${current} / week</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
          <span class="sync-freq-badge">${calculated} / week</span>
          ${isDiff ? '<span class="status-pill info">Will change</span>' : '<span class="status-pill good">✓ Match</span>'}
        </div>
      </div>
    `;
  }).join('');

  modal.classList.add('show');
}

function closeSyncFrequenciesModal() {
  document.getElementById('sync-freq-overlay').classList.remove('show');
}

async function applyWeeklyFrequencies() {
  const frequencies = calculateWeeklyFrequencies();
  let updatedCount = 0;

  for (const s of subjects) {
    const calc = frequencies[s.id];
    if (calc !== undefined && calc !== s.perWeek) {
      s.perWeek = calc;
      await updateSubject(s.id, {
        name: s.name,
        code: s.code,
        total: s.total,
        present: s.present,
        perWeek: s.perWeek,
        target: s.target,
        semTotal: s.semTotal,
        mode: s.mode
      });
      updatedCount++;
    }
  }

  closeSyncFrequenciesModal();
  renderAll();
  toast(`Applied calculated weekly frequencies to ${updatedCount} subjects ✓`);
}

// ══════════════════════════════════════════════════════
//  FEATURE 4 & 5: DAILY TRACKER & EXCEPTIONS ENGINE
// ══════════════════════════════════════════════════════

if (!selectedTrackerDate) {
  selectedTrackerDate = getLocalDateString();
}

function navDate(offset) {
  const parts = selectedTrackerDate.split('-').map(Number);
  const curr = new Date(parts[0], parts[1] - 1, parts[2]);
  curr.setDate(curr.getDate() + offset);
  selectedTrackerDate = getLocalDateString(curr);
  renderTracker();
}

function onDateSelected(dateVal) {
  if (!dateVal) return;
  selectedTrackerDate = dateVal;
  renderTracker();
}

function resetToToday() {
  selectedTrackerDate = getLocalDateString();
  renderTracker();
}

async function toggleDateHoliday() {
  const date = selectedTrackerDate;
  if (dateExceptions[date] && dateExceptions[date].type === 'holiday') {
    delete dateExceptions[date];
    saveDateExceptionToDB(date, null);
    toast('Holiday removed for ' + date);
  } else {
    // A holiday doesn't count, so marks already made that day must be undone,
    // otherwise they stay in the totals while being hidden.
    const marked = Object.keys(dailyPeriodLogs[date] || {});
    const plan = getDayPlan(date);
    const parts = [];
    if (marked.length) parts.push(`${marked.length} marked class${marked.length !== 1 ? 'es' : ''}`);
    if (plan.makeups.length) parts.push(`${plan.makeups.length} makeup/planned class${plan.makeups.length !== 1 ? 'es' : ''}`);
    if (plan.follows) parts.push('the timetable swap');
    if (parts.length) {
      if (!(await askDialog({ title: 'Make it a holiday?', message: `This day has ${parts.join(' and ')}. A holiday doesn't count, so ${parts.length > 1 || marked.length + plan.makeups.length > 1 ? 'they' : 'it'} will be cleared and your totals adjusted.`, ok: 'Mark as holiday', cat: 'cat-beach' }))) return;
      if (!(await clearMarksForDate(date))) { toast('Could not clear marks for this day', 'err'); renderTracker(); return; }
    }
    dateExceptions[date] = { type: 'holiday', note: 'College Holiday' };
    saveDateExceptionToDB(date, 'holiday');
    toast('Marked as Holiday 🏖️');
  }
  renderTracker();
  renderNav();
}

// Remove every mark on a date and take it back out of the subject totals.
async function clearMarksForDate(date) {
  return removeMarks(date, Object.keys(dailyPeriodLogs[date] || {}));
}

// Delete marks (by entry id) on a date and take them out of the subject totals.
async function removeMarks(date, entryIds) {
  const logs = dailyPeriodLogs[date] || {};
  const deltas = new Map();
  let ok = true;
  for (const entryId of entryIds) {
    const log = logs[entryId];
    if (!log) continue;
    const { error } = await supabaseClient
      .from('daily_period_logs')
      .delete()
      .eq('user_id', currentUser.id)
      .eq('date', date)
      .eq('entry_id', entryId);
    if (error) { console.warn('Clear mark failed:', error); ok = false; break; }
    const subj = subjects.find(x => x.id === log.subjectId);
    if (subj && (log.status === 'p' || log.status === 'a')) {
      const d = deltas.get(subj) || [0, 0];
      deltas.set(subj, [d[0] - 1, d[1] - (log.status === 'p' ? 1 : 0)]);
    }
    delete logs[entryId];
    localStorage.setItem('bk_daily_period_logs_' + currentUser.id, JSON.stringify(dailyPeriodLogs));
  }
  // Save totals for every mark already removed, even if a later one failed
  for (const [subj, [dt, dp]] of deltas) await applySubjectDelta(subj, dt, dp);
  return ok;
}

// ══════════════════════════════════════════════════════
//  DAY PLANS — makeup classes, planned extra classes, swapped timetables
//  Stored per date in timetable_exceptions as type 'custom_day' with a JSON
//  note: { v, follows: 1-7|null, makeups: [{ id, subjectId, name, time, fromDate, fromEntry }] }
// ══════════════════════════════════════════════════════
function parseDayPlan(note) {
  let raw = {};
  try { raw = JSON.parse(note || '{}') || {}; } catch { raw = {}; }
  const follows = Number.isInteger(raw.follows) && raw.follows >= 1 && raw.follows <= 7 ? raw.follows : null;
  const makeups = (Array.isArray(raw.makeups) ? raw.makeups : [])
    .filter(m => m && typeof m.id === 'string' && /^[\w-]{1,40}$/.test(m.id))
    .map(m => ({
      id: m.id,
      subjectId: typeof m.subjectId === 'string' ? m.subjectId : null,
      name: String(m.name || 'Class').slice(0, 80),
      time: /^\d{2}:\d{2}$/.test(m.time || '') ? m.time : '',
      fromDate: DATE_RE.test(m.fromDate || '') ? m.fromDate : null,
      fromEntry: typeof m.fromEntry === 'string' ? m.fromEntry : null,
    }));
  return { follows, makeups };
}
function getDayPlan(date) {
  const ex = dateExceptions[date];
  const plan = ex?.type === 'custom_day' ? (ex.plan || parseDayPlan(ex.note)) : null;
  return { follows: plan?.follows || null, makeups: [...(plan?.makeups || [])] };
}
async function saveDayPlan(date, plan) {
  const clean = { v: 1, follows: plan.follows || null, makeups: plan.makeups || [] };
  const empty = !clean.follows && !clean.makeups.length;
  const note = JSON.stringify(clean);
  if (empty) delete dateExceptions[date];
  else dateExceptions[date] = { type: 'custom_day', note, plan: clean };
  if (!currentUser) return true;
  localStorage.setItem('bk_date_exceptions_' + currentUser.id, JSON.stringify(dateExceptions));
  const q = empty
    ? supabaseClient.from('timetable_exceptions').delete().eq('user_id', currentUser.id).eq('date', date)
    : supabaseClient.from('timetable_exceptions').upsert({ user_id: currentUser.id, date, type: 'custom_day', note }, { onConflict: 'user_id,date' });
  const { error } = await q;
  if (error) {
    console.warn('Day plan sync failed:', error);
    toast('Saved on this device, but cloud sync failed', 'err');
    return false;
  }
  return true;
}
function makeupId() { return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// Makeup and planned classes on a date, shaped like scheduled classes.
function getMakeupClassesForDate(dateStr) {
  return getDayPlan(dateStr).makeups.map((m, i) => {
    const key = 'makeup_' + m.id;
    const log = dailyPeriodLogs[dateStr]?.[key];
    return {
      slotId: key, day: 0, period: 90 + i, startTime: m.time, endTime: '',
      subjectId: m.subjectId, subjectName: subjects.find(x => x.id === m.subjectId)?.name || m.name,
      status: log ? log.status : null, isExtra: false, isMakeup: true, makeupId: m.id, fromDate: m.fromDate,
    };
  });
}
function getAllClassesForDate(dateStr) {
  return [...getScheduledClassesForDate(dateStr), ...getMakeupClassesForDate(dateStr), ...getExtraClassesForDate(dateStr)];
}

// Remove a makeup / planned class (and its mark, if it has one).
async function removeMakeup(date, id) {
  const plan = getDayPlan(date);
  const m = plan.makeups.find(x => x.id === id);
  if (!m) return;
  const key = 'makeup_' + id;
  if (dailyPeriodLogs[date]?.[key]) {
    if (!(await askDialog({ title: 'Remove this class?', message: "It's already marked, so the mark will be taken out of your totals too.", ok: 'Remove', danger: true }))) return;
    if (!(await removeMarks(date, [key]))) { toast('Could not remove the mark', 'err'); return; }
  }
  plan.makeups = plan.makeups.filter(x => x.id !== id);
  await saveDayPlan(date, plan);
  toast(m.fromDate ? 'Makeup class removed' : 'Planned class removed');
  renderTracker(); renderNav();
  if (currPage === 'home') renderHome();
}

// When a cancellation is undone, drop the makeup class it created (unless
// that makeup has already been marked).
async function removeLinkedMakeups(fromDate, fromEntry) {
  let removed = 0, kept = 0;
  for (const date of Object.keys(dateExceptions)) {
    const plan = getDayPlan(date);
    const linked = plan.makeups.filter(m => m.fromDate === fromDate && m.fromEntry === fromEntry);
    if (!linked.length) continue;
    const drop = linked.filter(m => !dailyPeriodLogs[date]?.['makeup_' + m.id]);
    kept += linked.length - drop.length;
    if (!drop.length) continue;
    plan.makeups = plan.makeups.filter(m => !drop.includes(m));
    await saveDayPlan(date, plan);
    removed += drop.length;
  }
  if (removed) toast(`Removed the makeup class${removed !== 1 ? 'es' : ''} for it`);
  else if (kept) toast('Its makeup class is already marked, so it stays');
}

// ── "Will it be taken another day?" ──
let reschedFor = null;
function openReschedule(ctx) {
  reschedFor = ctx;
  document.getElementById('resched-sub').innerHTML = `Will <strong>${escapeHTML(ctx.name)}</strong> be taken on another day? Some colleges hold a makeup class.`;
  document.getElementById('resched-pick').hidden = true;
  document.getElementById('resched-ask').hidden = false;
  document.getElementById('resched-save').hidden = true;
  document.getElementById('resched-error').hidden = true;
  document.getElementById('resched-date').value = '';
  document.getElementById('resched-time').value = ctx.time || '';
  document.getElementById('resched-overlay').classList.add('show');
}
function closeReschedule() {
  document.getElementById('resched-overlay').classList.remove('show');
  reschedFor = null;
}
function showReschedulePick() {
  document.getElementById('resched-pick').hidden = false;
  document.getElementById('resched-ask').hidden = true;
  document.getElementById('resched-save').hidden = false;
  document.getElementById('resched-date').focus();
}
async function confirmReschedule() {
  const ctx = reschedFor;
  if (!ctx) return closeReschedule();
  const date = document.getElementById('resched-date').value;
  const time = document.getElementById('resched-time').value;
  const err = document.getElementById('resched-error');
  const fail = msg => { err.textContent = msg; err.hidden = false; };
  if (!DATE_RE.test(date)) return fail('Pick the day the class will be taken.');
  if (dateExceptions[date]?.type === 'holiday') return fail('That day is marked as a holiday. Pick another day, or remove the holiday first.');
  const plan = getDayPlan(date);
  plan.makeups.push({ id: makeupId(), subjectId: ctx.subjectId || null, name: ctx.name, time, fromDate: ctx.date, fromEntry: ctx.slotId });
  await saveDayPlan(date, plan);
  closeReschedule();
  toast(`Makeup class added for ${fmtDate(date)}`);
  if (currPage === 'tracker') renderTracker();
  if (currPage === 'home') renderHome();
}

// ── "This day follows another day's timetable" ──
function openDaySwap() {
  const date = selectedTrackerDate;
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay() || 7;
  const plan = getDayPlan(date);
  const sel = document.getElementById('dayswap-select');
  sel.innerHTML = DAYS_MAP.map(x => `<option value="${x.num}">${x.num === dow ? `${x.name} (usual)` : `${x.name}'s timetable`}</option>`).join('');
  sel.value = String(plan.follows || dow);
  document.getElementById('dayswap-date').textContent = fmtDate(date);
  document.getElementById('dayswap-overlay').classList.add('show');
}
function closeDaySwap() { document.getElementById('dayswap-overlay').classList.remove('show'); }
async function confirmDaySwap() {
  const date = selectedTrackerDate;
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay() || 7;
  const pick = parseInt(document.getElementById('dayswap-select').value) || dow;
  const plan = getDayPlan(date);
  const follows = pick === dow ? null : pick;
  if ((plan.follows || null) === follows) return closeDaySwap();
  // Marks on the old schedule's classes would no longer show, so clear them first
  const markedScheduled = getScheduledClassesForDate(date).filter(c => c.status).map(c => c.slotId);
  if (markedScheduled.length) {
    if (!(await askDialog({ title: 'Switch the timetable?', message: `${markedScheduled.length} class${markedScheduled.length !== 1 ? 'es are' : ' is'} already marked on this day. Switching clears ${markedScheduled.length !== 1 ? 'those marks' : 'that mark'} and adjusts your totals.`, ok: 'Switch', cat: 'cat-calendar' }))) return;
    if (!(await removeMarks(date, markedScheduled))) { toast('Could not clear marks for this day', 'err'); return; }
  }
  plan.follows = follows;
  await saveDayPlan(date, plan);
  closeDaySwap();
  toast(follows ? `This day follows ${DAYS_MAP.find(x => x.num === follows).name}'s timetable` : 'Back to the usual timetable');
  renderTracker(); renderNav();
}

// A class only counts towards attendance when it's linked to one of your subjects
function isCountable(c) { return subjects.some(x => x.id === c.subjectId); }

// ── "Counted up to": the numbers typed in for a subject already include every
// class up to that day, so those classes can't be marked (or counted) again.
function isPreCounted(c, date) { const a = countedUpTo[c.subjectId]; return !!a && date <= a; }
function isMarkable(c, date) { return isCountable(c) && !isPreCounted(c, date); }
function setCountedUpTo(subjId, date) {
  if (date) countedUpTo[subjId] = date; else delete countedUpTo[subjId];
  savePrefs();
}
function dayOffset(n) { const d = new Date(); d.setDate(d.getDate() + n); return getLocalDateString(d); }
function hasClassToday(counts) { return !!counts[new Date().getDay() || 7]; }

// Get scheduled classes for a specific date (1=Monday ... 7=Sunday)
function getScheduledClassesForDate(dateStr) {
  const parts = dateStr.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  let dayOfWeek = d.getDay(); // 0 = Sunday, 1 = Monday ... 6 = Saturday
  dayOfWeek = dayOfWeek === 0 ? 7 : dayOfWeek; // Convert 0 (Sun) to 7
  dayOfWeek = getDayPlan(dateStr).follows || dayOfWeek; // "Saturday follows Monday's timetable"

  // Filter timetable slots for that day
  const slots = timetable.filter(s => s.day === dayOfWeek && !s.isBreak);

  // Map each slot with its attendance status for that date
  return slots.map(slot => {
    const periodLog = dailyPeriodLogs[dateStr] ? dailyPeriodLogs[dateStr][slot.id] : null;
    const legacyStatus = (slot.subjectId && trackerLog[dateStr]) ? trackerLog[dateStr][slot.subjectId] : null;

    const status = periodLog ? periodLog.status : (legacyStatus || null);

    return {
      slotId: slot.id,
      day: slot.day,
      period: slot.period,
      startTime: slot.startTime,
      endTime: slot.endTime,
      subjectId: slot.subjectId,
      subjectName: slot.subjectName,
      status: status, // 'p', 'a', 'cancelled' or null
      isExtra: false
    };
  }).sort((a, b) => a.period - b.period);
}

function getExtraClassesForDate(dateStr) {
  const extraClasses = [];
  if (dailyPeriodLogs[dateStr]) {
    Object.entries(dailyPeriodLogs[dateStr]).forEach(([key, log]) => {
      if (log.isExtra) {
        extraClasses.push({
          slotId: key,
          day: 0,
          period: log.periodIndex || 99,
          startTime: log.extraTime || '',
          endTime: '',
          subjectId: log.subjectId,
          subjectName: log.extraName || (subjects.find(s=>s.id===log.subjectId)?.name || 'Extra Class'),
          status: log.status,
          isExtra: true
        });
      }
    });
  }
  return extraClasses;
}

function renderTracker() {
  const dateInput = document.getElementById('tracker-date-input');
  const subtitle = document.getElementById('tracker-date-subtitle');
  const banner = document.getElementById('date-status-banner');
  const summaryBox = document.getElementById('daily-summary-card');
  const content = document.getElementById('tracker-content');
  const holidayBtn = document.getElementById('btn-toggle-holiday');

  if (!content) return;

  if (dateInput) dateInput.value = selectedTrackerDate;

  const todayStr = getLocalDateString();
  const isToday = selectedTrackerDate === todayStr;
  const isFuture = selectedTrackerDate > todayStr;
  const beforeSem = !!semStart && selectedTrackerDate < semStart;
  const lockPA = isFuture || beforeSem; // nothing to attend yet / semester hadn't started
  const dayPlan = getDayPlan(selectedTrackerDate);

  const parts = selectedTrackerDate.split('-').map(Number);
  const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
  const formattedDate = dateObj.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  if (subtitle) {
    subtitle.textContent = isToday ? `Today · ${formattedDate}` : formattedDate;
  }

  const isHoliday = dateExceptions[selectedTrackerDate]?.type === 'holiday';

  if (holidayBtn) {
    holidayBtn.textContent = isHoliday ? '❌ Remove Holiday' : '🏖️ Mark Day as Holiday';
    holidayBtn.style.color = isHoliday ? 'var(--danger)' : '';
  }

  // Render Date Status Banner
  if (banner) {
    if (isHoliday) {
      banner.className = 'date-status-banner holiday';
      banner.innerHTML = `${ic('umbrella')} <span><strong>College holiday</strong> — no classes are counted as absent today.</span>`;
      banner.style.display = 'flex';
    } else if (dayPlan.follows) {
      banner.className = 'date-status-banner today';
      banner.innerHTML = `${ic('zap')} <span><strong>Follows ${DAYS_MAP.find(x => x.num === dayPlan.follows).name}'s timetable</strong> on this day. <button class="link-btn" style="padding:0" onclick="openDaySwap()">Change</button></span>`;
      banner.style.display = 'flex';
    } else if (isToday) {
      banner.className = 'date-status-banner today';
      banner.innerHTML = `${ic('zap')} <span><strong>Today's classes</strong> — mark each period as you attend or bunk.</span>`;
      banner.style.display = 'flex';
    } else if (beforeSem) {
      banner.className = 'date-status-banner future';
      banner.innerHTML = `${ic('calendar')} <span><strong>Before the semester started</strong> (${escapeHTML(fmtDate(semStart))}) — nothing to mark here. <button class="link-btn" style="padding:0" onclick="openSemesterDialog()">Change dates</button></span>`;
      banner.style.display = 'flex';
    } else if (isFuture) {
      banner.className = 'date-status-banner future';
      banner.innerHTML = `${ic('calendar')} <span><strong>Upcoming day</strong> — present/absent unlock on the day. You can already mark a class cancelled or the day a holiday.</span>`;
      banner.style.display = 'flex';
    } else {
      banner.className = 'date-status-banner future';
      banner.innerHTML = `${ic('calendar')} <span>Viewing schedule for <strong>${formattedDate}</strong></span>`;
      banner.style.display = 'flex';
    }
  }

  // Timetable classes (or the day it follows), makeup/planned classes, extra classes
  const allClasses = getAllClassesForDate(selectedTrackerDate);

  // Daily Completion Stats
  // Classes not linked to a subject, or already inside numbers you typed in,
  // can't be marked, so they don't count as pending
  const countable = allClasses.filter(c => isMarkable(c, selectedTrackerDate));
  const totalCount = countable.length;
  const presentCount = countable.filter(c => c.status === 'p').length;
  const absentCount = countable.filter(c => c.status === 'a').length;
  const cancelledCount = countable.filter(c => c.status === 'cancelled').length;
  const markedCount = presentCount + absentCount + cancelledCount;
  const pendingCount = totalCount - markedCount;
  const progressPct = totalCount > 0 ? Math.round((markedCount / totalCount) * 100) : 0;

  if (summaryBox) {
    const allDone = pendingCount === 0 && totalCount > 0;
    const R = 46, C = 2 * Math.PI * R;
    const headline = isHoliday ? 'Holiday mode 🏖️'
      : totalCount === 0 ? 'Free day'
      : allDone ? 'All done for the day! 🎉'
      : markedCount === 0 ? 'Fresh day, fresh choices'
      : 'Keep going, almost there';
    summaryBox.innerHTML = `
      <div class="daily-summary-layout">
        <div class="day-ring" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progressPct}" aria-label="Classes marked">
          <svg viewBox="0 0 108 108" aria-hidden="true"><circle cx="54" cy="54" r="${R}" class="ring-bg"/><circle cx="54" cy="54" r="${R}" class="ring-fill" style="stroke:${allDone ? 'var(--good)' : 'var(--primary)'};stroke-dasharray:${C};stroke-dashoffset:${C - progressPct / 100 * C}"/></svg>
          <div class="day-ring-label"><strong>${progressPct}%</strong><span>marked</span></div>
        </div>
        <div class="daily-summary-main">
          <div class="daily-summary-head">${headline}</div>
          <div class="daily-completion-text"><span>${markedCount} of ${totalCount} classes marked</span></div>
          <div class="daily-summary-stats">
            <div class="daily-stat-box indigo"><span class="ds-icon">${ic('calendar','ic-sm')}</span><div><div class="daily-stat-val">${totalCount}</div><div class="daily-stat-lbl">Scheduled</div></div></div>
            <div class="daily-stat-box green"><span class="ds-icon">${ic('check','ic-sm')}</span><div><div class="daily-stat-val">${presentCount}</div><div class="daily-stat-lbl">Present</div></div></div>
            <div class="daily-stat-box pink"><span class="ds-icon">${ic('x','ic-sm')}</span><div><div class="daily-stat-val">${absentCount}</div><div class="daily-stat-lbl">Absent</div></div></div>
            <div class="daily-stat-box ${pendingCount === 0 ? 'green' : 'amber'}"><span class="ds-icon">${ic(pendingCount === 0 ? 'check' : 'clock','ic-sm')}</span><div><div class="daily-stat-val">${pendingCount}</div><div class="daily-stat-lbl">${pendingCount === 0 ? 'All done ✓' : 'Pending'}</div></div></div>
          </div>
        </div>
        <img class="daily-summary-illus" src="assets/${isHoliday ? 'cat-beach' : allDone ? 'cat-trophy' : totalCount === 0 ? 'cat-books' : markedCount === 0 ? (isToday ? 'cat-clock' : 'cat-peek') : 'cat-laptop'}.svg" alt="">
      </div>
    `;
  }

  // If holiday
  if (isHoliday) {
    content.innerHTML = `
      <div class="card empty">
        <img class="empty-illus" src="assets/cat-beach.svg" alt="">
        <h3>Enjoy your holiday! 🏖️</h3>
        <p>No classes scheduled for today. Attendance records are paused.</p>
      </div>
    `;
    renderRecentHistory();
    return;
  }

  // If no scheduled classes on this day
  if (!allClasses.length) {
    content.innerHTML = `
      <div class="card empty">
        <img class="empty-illus" src="assets/${timetable.length ? 'cat-books' : 'cat-peek'}.svg" alt="">
        <h3>No classes scheduled for ${dateObj.toLocaleDateString('en-IN', { weekday: 'long' })}</h3>
        <p>${timetable.length ? 'You have no timetable classes on this day.' : 'Set up your weekly timetable to see your daily classes automatically.'}</p>
        <div class="empty-actions">
          <button class="btn-pri" onclick="goPage('timetable')">${ic('grid','ic-sm')} Configure Timetable</button>
          <button class="btn-sec" onclick="openExtraClassModal()">${ic('plus','ic-sm')} Add Extra Class</button>
        </div>
      </div>
    `;
    renderRecentHistory();
    return;
  }

  // Render Daily Scheduled Class Cards
  content.innerHTML = allClasses.map((item, idx) => {
    const sIdx = subjects.findIndex(x => x.id === item.subjectId);
    const s = sIdx >= 0 ? subjects[sIdx] : null;
    const th = subjTheme(sIdx >= 0 ? sIdx : 0);
    const displayName = s ? s.name : item.subjectName;
    const timeDisplay = item.startTime ? (item.endTime ? `${item.startTime} - ${item.endTime}` : item.startTime) : '';

    let cardClass = 'daily-class-card';
    if (item.status === 'p') cardClass += ' marked-p';
    else if (item.status === 'a') cardClass += ' marked-a';
    else if (item.status === 'cancelled') cardClass += ' marked-c';

    return `
      <div class="${cardClass}">
        <span class="subj-icon dc-icon" style="background:${s ? th.bg : 'var(--surface2)'};color:${s ? th.c : 'var(--muted)'}" aria-hidden="true">${ic(subjIcon(displayName))}</span>
        <div class="daily-class-main">
          <div class="daily-class-meta">
            <span class="period-badge">${item.isExtra ? 'Extra' : item.isMakeup ? (item.fromDate ? 'Makeup' : 'Extra · planned') : `Period ${item.period}`}</span>
            ${item.isMakeup && item.fromDate ? `<span class="time-badge">for ${escapeHTML(fmtDate(item.fromDate))}</span>` : ''}
            ${timeDisplay ? `<span class="time-badge">${ic('clock','ic-sm')} ${escapeHTML(timeDisplay)}</span>` : ''}
            ${item.status === 'cancelled' ? '<span class="status-pill warn">Cancelled · no penalty</span>' : ''}
          </div>
          <div class="daily-class-name">${escapeHTML(displayName)}</div>
          ${s ? (hasClasses(s)
            ? `<div class="daily-class-stats"><span class="dc-bar"><span style="width:${Math.min(100, pct(s))}%;background:${subjFill(s)}"></span></span><strong style="color:${subjTextColor(s)}">${pct(s)}%</strong> <span>(${s.present}/${s.total}) · ${bunkable(s)} safe bunk${bunkable(s) !== 1 ? 's' : ''}</span></div>`
            : '<div class="daily-class-stats" style="color:var(--muted)">No classes counted yet</div>')
            : '<div class="daily-class-stats" style="color:var(--muted)">Not linked to a subject</div>'}
        </div>
        ${s && isPreCounted(item, selectedTrackerDate) ? `<div class="tracker-link"><span class="counted-note" title="You entered ${escapeHTML(s.name)}'s numbers counting classes up to ${escapeHTML(fmtDate(countedUpTo[s.id]))}">${ic('check','ic-sm')} Already in the numbers you entered</span></div>` : !s && !item.isExtra ? `<div class="tracker-link">
          ${item.isMakeup
            ? `<button class="btn-sec btn-sm" onclick="removeMakeup('${selectedTrackerDate}', '${item.makeupId}')">${ic('x','ic-sm')} Remove</button>`
            : `<button class="btn-sec btn-sm" onclick="openEditSlotModal('${item.slotId}')" title="Pick which of your subjects this class is">${ic('pen','ic-sm')} Link to a subject</button>`}
        </div>` : `<div class="tracker-btns" role="group" aria-label="Attendance for ${escapeHTML(displayName)}">
          <button class="tbtn p ${item.status === 'p' ? 'on' : ''}" aria-pressed="${item.status === 'p'}" ${lockPA && item.status !== 'p' ? `disabled title="${beforeSem ? 'Before the semester started' : 'You can mark this once the day comes'}"` : ''} onclick="markPeriodAttendance('${item.slotId}', '${item.subjectId || ''}', 'p', ${item.period}, ${item.isExtra})">${ic('check','ic-sm')} Present</button>
          <button class="tbtn a ${item.status === 'a' ? 'on' : ''}" aria-pressed="${item.status === 'a'}" ${lockPA && item.status !== 'a' ? `disabled title="${beforeSem ? 'Before the semester started' : 'You can mark this once the day comes'}"` : ''} onclick="markPeriodAttendance('${item.slotId}', '${item.subjectId || ''}', 'a', ${item.period}, ${item.isExtra})">${ic('x','ic-sm')} Absent</button>
          <button class="tbtn c ${item.status === 'cancelled' ? 'on' : ''}" aria-pressed="${item.status === 'cancelled'}" title="Cancelled class does not count as absence" onclick="markPeriodAttendance('${item.slotId}', '${item.subjectId || ''}', 'cancelled', ${item.period}, ${item.isExtra})">${ic('ban','ic-sm')} Cancel</button>
          ${item.isMakeup ? `<button class="tbtn rm" title="Remove this class" aria-label="Remove this class" onclick="removeMakeup('${selectedTrackerDate}', '${item.makeupId}')">${ic('x','ic-sm')}</button>` : ''}
        </div>`}
      </div>
    `;
  }).join('');

  renderRecentHistory();
}

// ══════════════════════════════════════════════════════
//  ATTENDANCE MARKING & SUBJECT SYNC
// ══════════════════════════════════════════════════════

async function markPeriodAttendance(slotId, subjId, newStatus, periodIndex = 1, isExtra = false) {
  if (!currentUser) return;
  if (trackerLocked) return;
  trackerLocked = true;

  const date = selectedTrackerDate;
  // Already inside the numbers typed in for this subject: marking it would count it twice
  if (isPreCounted({ subjectId: subjId }, date)) {
    trackerLocked = false;
    toast('Already counted in the numbers you entered for this subject', 'err');
    return;
  }
  if (semStart && date < semStart && (newStatus === 'p' || newStatus === 'a') && dailyPeriodLogs[date]?.[slotId]?.status !== newStatus) {
    trackerLocked = false;
    toast('That day is before the semester started', 'err');
    return;
  }
  // A class can't be attended or missed before its day (cancelling ahead is fine)
  if (date > getLocalDateString() && (newStatus === 'p' || newStatus === 'a') && dailyPeriodLogs[date]?.[slotId]?.status !== newStatus) {
    trackerLocked = false;
    toast('You can mark this once the day comes', 'err');
    return;
  }
  if (!dailyPeriodLogs[date]) dailyPeriodLogs[date] = {};

  // Start from what's saved, not what this tab remembers: the class may have
  // been marked on your phone or in another tab since this page loaded.
  let prevEntry = dailyPeriodLogs[date][slotId];
  const seenStatus = prevEntry ? prevEntry.status : null; // what the screen showed
  try {
    const { data, error } = await supabaseClient.from('daily_period_logs').select('*')
      .eq('user_id', currentUser.id).eq('date', date).eq('entry_id', slotId).limit(1);
    if (!error) {
      const row = data && data[0];
      prevEntry = row ? { ...(prevEntry || {}), status: row.status, subjectId: row.subject_id } : null;
      if (prevEntry) dailyPeriodLogs[date][slotId] = prevEntry; else delete dailyPeriodLogs[date][slotId];
    }
  } catch (e) { /* offline: fall back to what this tab knows */ }
  const prevStatus = prevEntry ? prevEntry.status : null;
  // Already marked this way somewhere else: just show it, don't toggle it off
  if (prevStatus === newStatus && seenStatus !== newStatus) {
    trackerLocked = false;
    await refreshData();
    renderTracker();
    toast('Already marked on another device — updated');
    return;
  }

  const s = subjects.find(x => x.id === subjId);
  // Undo the earlier mark on the subject it was counted for (the slot's
  // subject may have been changed since then).
  const prevSubj = prevEntry ? subjects.find(x => x.id === prevEntry.subjectId) : null;

  try {
    let finalStatus = newStatus;

    // Toggle off if clicked the same status button
    if (prevStatus === newStatus) {
      finalStatus = null;

      const { error } = await supabaseClient
        .from('daily_period_logs')
        .delete()
        .eq('user_id', currentUser.id)
        .eq('date', date)
        .eq('entry_id', slotId);
      if (error) throw error;
      delete dailyPeriodLogs[date][slotId];

    } else {
      const { error } = await supabaseClient
        .from('daily_period_logs')
        .upsert({
          user_id: currentUser.id,
          date: date,
          entry_id: slotId,
          subject_id: subjId || null,
          period_index: periodIndex,
          status: newStatus
        }, {
          onConflict: 'user_id,date,entry_id'
        });
      if (error) throw error;
      // Keep extra-class details (name, time) when its status changes
      dailyPeriodLogs[date][slotId] = {
        ...(prevEntry || {}),
        status: newStatus,
        subjectId: subjId,
        periodIndex: periodIndex,
        isExtra: isExtra
      };
    }

    // Recalculate totals without double counting: remove the old mark, add the new one
    const deltas = new Map();
    const add = (subj, dt, dp) => { if (!subj) return; const d = deltas.get(subj) || [0, 0]; deltas.set(subj, [d[0] + dt, d[1] + dp]); };
    if (prevStatus === 'p') add(prevSubj, -1, -1); else if (prevStatus === 'a') add(prevSubj, -1, 0);
    if (finalStatus === 'p') add(s, 1, 1); else if (finalStatus === 'a') add(s, 1, 0);
    for (const [subj, [dt, dp]] of deltas) await applySubjectDelta(subj, dt, dp);

    // Save to local cache
    localStorage.setItem('bk_daily_period_logs_' + currentUser.id, JSON.stringify(dailyPeriodLogs));

    renderNav();
    renderTracker();
    if (currPage === 'home') renderHome();

    if (finalStatus === 'p') toast(`${s ? s.name : 'Class'}: ✓ Present`);
    else if (finalStatus === 'a') toast(`${s ? s.name : 'Class'}: ✗ Absent`, 'err');
    else if (finalStatus === 'cancelled') toast(`${s ? s.name : 'Class'}: Cancelled (No penalty)`);
    else toast('Attendance unmarked');

    // Cancelled → it may be taken another day; un-cancelled → drop that makeup
    if (prevStatus === 'cancelled' && finalStatus !== 'cancelled') {
      await removeLinkedMakeups(date, slotId);
    } else if (finalStatus === 'cancelled' && !isExtra) {
      const item = getAllClassesForDate(date).find(c => c.slotId === slotId);
      openReschedule({ date, slotId, subjectId: subjId || null, name: s ? s.name : (item?.subjectName || 'This class'), time: item?.startTime || '' });
    }

  } catch (err) {
    console.error('Error marking attendance:', err);
    toast('Failed to record attendance', 'err');
  } finally {
    trackerLocked = false;
  }
}

// ══════════════════════════════════════════════════════
//  EXTRA CLASS MODAL
// ══════════════════════════════════════════════════════

function openExtraClassModal() {
  const select = document.getElementById('extra-subject-select');
  const dateLbl = document.getElementById('extra-class-date-label');
  if (!select) return;

  if (dateLbl) {
    dateLbl.textContent = `Schedule an extra class for ${selectedTrackerDate}`;
  }

  select.innerHTML = subjects.map(s => `<option value="${s.id}">${escapeHTML(s.name)}</option>`).join('');
  document.getElementById('extra-class-time').value = '';
  document.getElementById('extra-class-overlay').classList.add('show');
}

function closeExtraClassModal() {
  document.getElementById('extra-class-overlay').classList.remove('show');
}

async function confirmAddExtraClass() {
  const subjId = document.getElementById('extra-subject-select').value;
  const timeNote = document.getElementById('extra-class-time').value.trim();
  const s = subjects.find(x => x.id === subjId);

  if (!subjId || !s) {
    toast('Please select a subject', 'err');
    return;
  }

  const extraId = 'extra_' + Date.now();
  const date = selectedTrackerDate;

  // A future day can't be attended yet: add it as a planned class to mark on the day
  if (date > getLocalDateString()) {
    const plan = getDayPlan(date);
    plan.makeups.push({ id: makeupId(), subjectId: subjId, name: s.name, time: /^\d{2}:\d{2}$/.test(timeNote) ? timeNote : '', fromDate: null, fromEntry: null });
    await saveDayPlan(date, plan);
    closeExtraClassModal();
    renderTracker();
    toast(`Extra ${s.name} class planned for ${fmtDate(date)}`);
    return;
  }

  // Record the class first; only count it once it's saved.
  const { error } = await supabaseClient
    .from('daily_period_logs')
    .upsert({
      user_id: currentUser.id,
      date: date,
      entry_id: extraId,
      subject_id: subjId,
      period_index: 99,
      status: 'p'
    }, { onConflict: 'user_id,date,entry_id' });
  if (error) {
    console.warn('DB upsert error for extra class:', error);
    toast('Could not add the extra class', 'err');
    return;
  }

  if (!dailyPeriodLogs[date]) dailyPeriodLogs[date] = {};
  dailyPeriodLogs[date][extraId] = {
    status: 'p', // default to present when adding extra class
    subjectId: subjId,
    periodIndex: 99,
    isExtra: true,
    extraName: s.name,
    extraTime: timeNote
  };
  localStorage.setItem('bk_daily_period_logs_' + currentUser.id, JSON.stringify(dailyPeriodLogs));

  // Increment subject total & present (on top of what's saved right now)
  await applySubjectDelta(s, 1, 1);

  closeExtraClassModal();
  renderNav();
  renderTracker();
  toast(`Extra class added for ${s.name} ✓`);
}

// ══════════════════════════════════════════════════════
//  RECENT HISTORY
// ══════════════════════════════════════════════════════

function renderRecentHistory() {
  const container = document.getElementById('recent-history-list');
  if (!container) return;

  const dates = Object.keys(dailyPeriodLogs).sort().reverse().slice(0, 7);

  if (!dates.length) {
    container.innerHTML = '<div style="color:var(--text2);font-size:.875rem;padding:6px 0">No attendance history logged yet.</div>';
    return;
  }

  container.innerHTML = dates.map(d => {
    const logs = dailyPeriodLogs[d] || {};
    const p = Object.values(logs).filter(v => v.status === 'p').length;
    const a = Object.values(logs).filter(v => v.status === 'a').length;
    const c = Object.values(logs).filter(v => v.status === 'cancelled').length;

    const parts = d.split('-').map(Number);
    const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
    const lbl = dateObj.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' });

    return `
      <button class="hist-row" onclick="onDateSelected('${d}')" title="View this day">
        <span class="hist-cal" aria-hidden="true"><b>${dateObj.getDate()}</b><i>${dateObj.toLocaleDateString('en-IN', { month: 'short' })}</i></span>
        <span class="hist-date">${dateObj.toLocaleDateString('en-IN', { weekday: 'long' })} ${dateExceptions[d]?.type === 'holiday' ? '🏖️' : ''}</span>
        <span class="hist-chip p">✓ ${p}</span>
        <span class="hist-chip a">✗ ${a}</span>
        ${c > 0 ? `<span class="hist-chip c">⊘ ${c}</span>` : ''}
        ${ic('chevron-right','ic-sm')}
      </button>
    `;
  }).join('');
}

// ══════════════════════════════════════════════════════
//  STORAGE & DB PERSISTENCE HELPERS
// ══════════════════════════════════════════════════════

// Every slot gets a permanent UUID before it is saved, and the database row
// keeps that id. Attendance marks are stored against the slot id, so marks
// stay attached to their class across saves and reloads.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function newUuid() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
let pendingEntryRenames = []; // [oldId, newId] pairs whose marks still need moving in the DB
function ensureTimetableIds() {
  timetable.forEach(slot => {
    if (UUID_RE.test(String(slot.id))) return;
    const oldId = String(slot.id), newId = newUuid();
    slot.id = newId;
    let moved = false;
    Object.values(dailyPeriodLogs).forEach(day => {
      if (day[oldId]) { day[newId] = { ...day[oldId], entryId: newId }; delete day[oldId]; moved = true; }
    });
    if (moved) pendingEntryRenames.push([oldId, newId]);
  });
  if (pendingEntryRenames.length && currentUser) {
    localStorage.setItem('bk_daily_period_logs_' + currentUser.id, JSON.stringify(dailyPeriodLogs));
  }
}

// DB syncs run one at a time so they can't interleave. Calls made while a sync
// is still waiting to start share it; it reads the latest timetable when it runs.
let ttSyncChain = Promise.resolve();
let ttSyncWaiting = null;
function saveTimetableToStorageAndDB() {
  ensureTimetableIds();
  if (currentUser) {
    localStorage.setItem('bk_timetable_' + currentUser.id, JSON.stringify(timetable));
  }
  if (!currentUser) return Promise.resolve();
  if (ttSyncWaiting) return ttSyncWaiting;
  ttSyncWaiting = ttSyncChain.then(() => { ttSyncWaiting = null; return syncTimetableToDB(); });
  ttSyncChain = ttSyncWaiting;
  return ttSyncWaiting;
}

async function syncTimetableToDB() {
  if (!currentUser) return;

  try {
    // 1. Ensure master timetable record
    let ttId = timetableMeta.id;
    if (!ttId) {
      const { data: ttRes } = await supabaseClient
        .from('timetables')
        .insert([{ user_id: currentUser.id, title: 'Weekly Timetable' }])
        .select();
      if (ttRes && ttRes[0]) {
        ttId = ttRes[0].id;
        timetableMeta.id = ttId;
      }
    }

    if (!ttId) throw new Error('No timetable record');

    // 2. Move marks made against temporary slot ids over to their new ids
    while (pendingEntryRenames.length) {
      const [oldId, newId] = pendingEntryRenames[0];
      const { error } = await supabaseClient
        .from('daily_period_logs')
        .update({ entry_id: newId })
        .eq('user_id', currentUser.id)
        .eq('entry_id', oldId);
      if (error) throw error;
      pendingEntryRenames.shift();
    }

    // 3. Write the current slots (insert new, update existing). A subject that
    //    was deleted can't be referenced, so such slots keep only their name.
    const known = new Set(subjects.map(x => x.id));
    const payload = timetable.map(s => ({
      id: s.id,
      timetable_id: ttId,
      user_id: currentUser.id,
      day_of_week: s.day,
      period_index: s.period,
      start_time: s.startTime || '',
      end_time: s.endTime || '',
      subject_id: known.has(s.subjectId) ? s.subjectId : null,
      subject_name: s.subjectName || 'Unassigned',
      is_break: s.isBreak || false
    }));
    if (payload.length) {
      const { error } = await supabaseClient.from('timetable_entries').upsert(payload, { onConflict: 'id' });
      if (error) throw error;
    }

    // 4. Only after that succeeds, remove rows for slots that no longer exist
    const { data: rows, error: selError } = await supabaseClient
      .from('timetable_entries')
      .select('id')
      .eq('user_id', currentUser.id);
    if (selError) throw selError;
    const keep = new Set(payload.map(r => r.id));
    const stale = (rows || []).map(r => r.id).filter(id => !keep.has(id));
    if (stale.length) {
      const { error } = await supabaseClient
        .from('timetable_entries')
        .delete()
        .eq('user_id', currentUser.id)
        .in('id', stale);
      if (error) throw error;
    }
    return true;
  } catch (err) {
    console.warn('Timetable database sync warning:', err.message);
    toast('Timetable saved on this device, but cloud sync failed', 'err');
    return false;
  }
}

async function saveDateExceptionToDB(date, type) {
  if (currentUser) {
    localStorage.setItem('bk_date_exceptions_' + currentUser.id, JSON.stringify(dateExceptions));
  }
  if (!currentUser) return;

  try {
    if (!type) {
      await supabaseClient
        .from('timetable_exceptions')
        .delete()
        .eq('user_id', currentUser.id)
        .eq('date', date);
    } else {
      await supabaseClient
        .from('timetable_exceptions')
        .upsert({
          user_id: currentUser.id,
          date: date,
          type: type,
          note: 'College Holiday'
        }, {
          onConflict: 'user_id,date'
        });
    }
  } catch (err) {
    console.warn('Exception sync warning:', err.message);
  }
}