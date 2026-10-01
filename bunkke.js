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
    supabaseClient.auth.onAuthStateChange((event, session) => {
      console.log('Auth change:', event, session);

      if (session) {
        currentUser = session.user;

        // ✅ SAVE SESSION
        localStorage.setItem('sb-session', JSON.stringify(session));

        console.log("✅ Stored session from listener");

        showApp();
      } else {
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
        dailyPeriodLogs[row.date][key] = {
          status: row.status,
          subjectId: row.subject_id,
          periodIndex: row.period_index || 1,
          entryId: row.entry_id
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
          note: row.note || ''
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
  if (!confirm('Are you sure you want to logout?')) return;
  
  try {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
    
    console.log('✅ Logged out successfully');
    currentUser = null;
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
}

async function showApp() {
  document.getElementById('auth-overlay').classList.remove('show');
  document.getElementById('logout-btn').style.display = 'block';
  selectedTrackerDate = getLocalDateString();
  await loadSubjects();
  await loadTimetable();
  await loadDailyPeriodLogs();
  await loadDateExceptions();
  await loadTracker();
  renderAll();
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

const COLORS = ['#c8f135','#ff6b35','#4fc3f7','#ce93d8','#80cbc4','#ffb74d','#f06292','#aed581'];
 
const ROASTS = {
  god: [
    'Attendance merchant fr 🧾',
    'Front row energy. Respect.',
    'Sir\'s favorite. Admitted.',
    'Locked in. No thoughts, all attendance.',
    'Attendance so high it\'s embarrassing.',
  ],
  safe: [
    'Solid. Bunk approved. 😎',
    'Chilling in the safe zone.',
    'Attendance secured. Barely.',
    'Not cooked. Yet.',
    'Massive W but don\'t get cocky.',
  ],
  medium: [
    'Walking on thin ice rn.',
    'Living dangerously. Bold.',
    'One slip and it\'s wraps.',
    'The audacity to consider bunking.',
    'Risky ahh move incoming.',
  ],
  low: [
    'Attendance on life support. 💀',
    'Bro attends through screenshots.',
    'Faculty knows you by your absence.',
    'Academic comeback loading... slowly.',
    'Sir definitely hates you probably.',
  ],
  cooked: [
    'Hall ticket in danger. Not joking.',
    'Parents will hear lore soon.',
    'Respawn recommended.',
    'Cooked beyond recognition. 🔥',
    'Bro you are finished.',
  ]
};
 
const SIM_REACTIONS = {
  safe_in_limit: ['Still chilling 😎', 'Green light, bestie.', 'Locked in.', 'W move actually.'],
  safe_over_limit: ['Greedy ahh', 'Playing dangerous games.', 'Bold of you.', 'You sure about this?'],
  warn: ['Risky ahh move 💀', 'One more and you\'re cooked.', 'Sir is watching.', 'This is a warning.'],
  cooked: ['Academic terrorism detected.', 'Bro loves consequences.', 'Hall ticket crying rn.', 'Cooked. Done. Finished. 💀']
};
 
const TOAST_MSGS = {
  save: ['Numbers updated.', 'Damage updated.', 'Data secured.', 'Numbers don\'t lie.'],
  delete: ['Subject yeeted.', 'Gone. Forgotten.'],
  add: ['Subject added.', 'New victim added.']
};
 
function randFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randToast(type) { return randFrom(TOAST_MSGS[type] || ['Done.']); }
 
// ══════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════
let globalTarget = parseInt(localStorage.getItem('bk_global_target') || '75');
let semStart = localStorage.getItem('bk_sem_start') || '';
let examDate = localStorage.getItem('bk_exam_date') || '';
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
  localStorage.setItem('bk_streak', streak);
  localStorage.setItem('bk_last_check', lastCheck);
}
 
// ══════════════════════════════════════════════════════
//  MATH UTILS
// ══════════════════════════════════════════════════════
function pct(s) { return s.total > 0 ? Math.round(s.present / s.total * 100) : 0; }
function getTarget(s) { return s?.target || globalTarget; }
function bunkable(s) { return Math.max(0, Math.floor(s.present / getTarget(s) * 100) - s.total); }
function needed(s, tgt) {
  const t = tgt ?? getTarget(s);
  if (pct(s) >= t) return 0;
  return Math.max(0, Math.ceil((t / 100 * s.total - s.present) / (1 - t / 100)));
}
function pctColor(p, tgt) {
  tgt = tgt ?? globalTarget;
  if (p >= tgt) return '#c8f135';
  if (p >= tgt - 15) return '#ffb830';
  return '#ff4060';
}
function weeksFromStart() {
  if (!semStart) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(semStart)) / 864e5 / 7));
}
function estimateTotal(pw) {
  return Math.round(weeksFromStart() * (pw || 0));
}
function daysUntil(d) {
  if (!d) return null;
  return Math.ceil((new Date(d) - Date.now()) / 864e5);
}
 
// ══════════════════════════════════════════════════════
//  ROAST ENGINE
// ══════════════════════════════════════════════════════
function getRoast(p, tgt) {
  tgt = tgt ?? globalTarget;
  if (p >= tgt + 15) return randFrom(ROASTS.god);
  if (p >= tgt) return randFrom(ROASTS.safe);
  if (p >= tgt - 10) return randFrom(ROASTS.medium);
  if (p >= tgt - 20) return randFrom(ROASTS.low);
  return randFrom(ROASTS.cooked);
}
function getSimReaction(planBunks, bunkableNow, safe, projPct, tgt) {
  if (!safe) return randFrom(SIM_REACTIONS.cooked);
  if (projPct - tgt <= 2) return randFrom(SIM_REACTIONS.warn);
  if (planBunks > bunkableNow) return randFrom(SIM_REACTIONS.safe_over_limit);
  return randFrom(SIM_REACTIONS.safe_in_limit);
}
 
// ══════════════════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════════════════
function toast(msg, type = 'ok') {
  const t = document.getElementById('toast');
  t.innerHTML = `<span>${type === 'ok' ? '✓' : '✕'}</span> ${msg}`;
  t.className = `toast show ${type}`;
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2600);
}
 
// ══════════════════════════════════════════════════════
//  SIDEBAR
// ══════════════════════════════════════════════════════
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }
function renderNav() {
  document.getElementById('global-target').value = globalTarget;
  document.getElementById('nav-subjects').innerHTML = subjects.map((s, i) => {
    const p = pct(s), tgt = getTarget(s), risk = p < tgt;
    return `<div class="nav-item" id="nav-s-${s.id}" onclick="goPage('subject','${s.id}')">
      <div class="nav-dot" style="background:${COLORS[i%COLORS.length]}"></div>
      ${s.name}
      <span class="${risk ? 'nav-risk' : 'nav-safe'}">${p}%</span>
    </div>`;
  }).join('');
}

function updateGlobalTarget(v) {
  globalTarget = Math.max(1, Math.min(100, parseInt(v)||75));
  document.getElementById('global-target').value = globalTarget;
  localStorage.setItem('bk_global_target', globalTarget);
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
}
 
// ══════════════════════════════════════════════════════
//  HOME
// ══════════════════════════════════════════════════════
function renderHome() {
  const now = new Date();
  const hr = now.getHours();
  const greetings = ['Rise and Shine 🌅','Morning 🌤️','Afternoon 🌞','Evening ✨'];
  const gi = hr < 6 ? 0 : hr < 12 ? 1 : hr < 18 ? 2 : 3;
  document.getElementById('home-head').textContent = greetings[gi];
  document.getElementById('home-sub').textContent = now.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
 
  if (!subjects.length) {
    document.getElementById('stats-grid').innerHTML = '';
    document.getElementById('verdict-wrap').innerHTML = '';
    document.getElementById('streak-row').innerHTML = '';
    document.getElementById('subject-cards').innerHTML = `
      <div class="empty">
        <div class="empty-icon">😶</div>
        <h3>No subjects yet.</h3>
        <p>Add your subjects to find out if you're cooked.</p>
        <button class="btn-pri" onclick="openAddModal()">+ Add Subject</button>
      </div>`;
    document.getElementById('bar-chart').innerHTML = '';
    document.getElementById('quick-view').innerHTML = '';
    return;
  }
 
  const total = subjects.reduce((a,s)=>a+s.total,0);
  const present = subjects.reduce((a,s)=>a+s.present,0);
  const ov = total > 0 ? Math.round(present/total*100) : 0;
  const safeBunks = subjects.reduce((a,s)=>a+bunkable(s),0);
  const atRisk = subjects.filter(s=>pct(s)<getTarget(s));
  const bestBunk = [...subjects].sort((a,b)=>bunkable(b)-bunkable(a))[0];
 
  // Stats
  document.getElementById('stats-grid').innerHTML = `
    <div class="sc ${ov < globalTarget ? 'red' : 'glow'}">
      <span class="sc-lbl">Overall</span>
      <div class="sc-val" style="color:${pctColor(ov)}">${ov}<span class="unit">%</span></div>
      <div class="sc-sub">target: ${globalTarget}%</div>
    </div>
    <div class="sc ${safeBunks===0?'red':''}">
      <span class="sc-lbl">Safe Bunks</span>
      <div class="sc-val" style="color:${safeBunks>0?'var(--accent)':'var(--danger)'}">${safeBunks}</div>
      <div class="sc-sub">${safeBunks>0?'go ahead, skip something':'you are cooked. attend.'}</div>
    </div>
    <div class="sc ${atRisk.length>0?'red':''}">
      <span class="sc-lbl">At Risk</span>
      <div class="sc-val" style="color:${atRisk.length>0?'var(--danger)':'var(--accent)'}">${atRisk.length}</div>
      <div class="sc-sub">${atRisk.length>0?atRisk.map(s=>s.name).join(', '):'all subjects safe ✓'}</div>
    </div>
    <div class="sc blue">
      <span class="sc-lbl">Best to Bunk</span>
      <div class="sc-val" style="color:#4fc3f7;font-size:1.1rem;padding-top:4px">${bestBunk && bunkable(bestBunk)>0 ? bestBunk.name : '—'}</div>
      <div class="sc-sub">${bestBunk && bunkable(bestBunk)>0 ? bunkable(bestBunk)+' bunks left' : 'nowhere is safe rn'}</div>
    </div>
  `;
 
  // Verdict card
  renderVerdictCard(ov, atRisk, safeBunks);
 
  // Streak
  renderStreak();
 
  // Subject cards
  document.getElementById('subject-cards').innerHTML = subjects.map((s,i) => {
    const p = pct(s), tgt = getTarget(s), bk = bunkable(s), col = pctColor(p, tgt);
    const risk = p < tgt;
    const roast = getRoast(p, tgt);
    return `<div class="subj-card ${risk?'at-risk':'safe-zone'}" onclick="goPage('subject','${s.id}')">
      <div class="subj-card-accent" style="background:${COLORS[i%COLORS.length]}"></div>
      <div class="subj-card-main">
        <div class="subj-card-name">${s.name}</div>
        <div class="subj-card-roast">${roast}</div>
        <div class="subj-bar"><div class="subj-bar-fill" style="width:${p}%;background:${col}"></div></div>
      </div>
      <div class="subj-card-right">
        <div class="subj-card-pct" style="color:${col}">${p}%</div>
        <div class="subj-card-bunk">${bk>0?`${bk} bunks left`:`need ${needed(s)} more`}</div>
      </div>
    </div>`;
  }).join('');
 
  // Bar chart
  const maxV = Math.max(...subjects.map(s=>s.total), 1);
  document.getElementById('bar-chart').innerHTML = subjects.map((s,i) => {
    const ph = Math.round(s.present/maxV*100);
    const ah = Math.round((s.total-s.present)/maxV*100);
    return `<div class="bg" onclick="goPage('subject','${s.id}')">
      <div class="bw"><div class="b p" style="height:${ph}px"></div><div class="b a" style="height:${ah}px"></div></div>
      <div class="bl">${s.name.slice(0,4)}</div>
    </div>`;
  }).join('');
 
  // Quick view
  document.getElementById('quick-view').innerHTML = subjects.map((s,i) => {
    const p = pct(s), tgt = getTarget(s), col = pctColor(p, tgt);
    const cls = p>=tgt?'pct-safe':p>=tgt-15?'pct-warn':'pct-danger';
    return `<div style="display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:7px;cursor:pointer;transition:background .15s" onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''" onclick="goPage('subject','${s.id}')">
      <div style="width:8px;height:8px;border-radius:2px;background:${COLORS[i%COLORS.length]};flex-shrink:0"></div>
      <span style="flex:1;font-size:.76rem">${s.name}</span>
      <div style="width:60px;height:3px;background:var(--border2);border-radius:2px;overflow:hidden"><div style="height:100%;width:${p}%;background:${col};border-radius:2px"></div></div>
      <span style="font-size:.7rem;font-family:'Syne',sans-serif;font-weight:700;color:${col};min-width:32px;text-align:right">${p}%</span>
    </div>`;
  }).join('');
}
 
function renderVerdictCard(ov, atRisk, safeBunks) {
  let cls, emoji, title, sub;
  if (atRisk.length === 0 && safeBunks > 5) {
    cls='safe'; emoji='😎'; title='Locked in. Safe to bunk.';
    sub = `${safeBunks} total bunks available. You're chilling. ${randFrom(['Massive W.','Solid.','Attendance merchant vibes.'])}`;
  } else if (atRisk.length === 0 && safeBunks > 0) {
    cls='warn'; emoji='🤏'; title=`${safeBunks} bunk${safeBunks!==1?'s':''} left. Play it smart.`;
    sub = randFrom(['Walking on thin ice.','Don\'t get greedy.','One wrong move and you\'re cooked.']);
  } else if (atRisk.length === 0) {
    cls='warn'; emoji='🫠'; title='No safe bunks. Attend everything.';
    sub = 'You\'re right at the edge. Do NOT skip anything.';
  } else {
    cls='cooked'; emoji='💀'; title='Bro you are cooked.';
    sub = `${atRisk.map(s=>s.name).join(', ')} below target. ${randFrom(['Respawn recommended.','Academic terrorism.','Hall ticket trembling.'])}`;
  }
  document.getElementById('verdict-wrap').innerHTML = `
    <div class="verdict-card ${cls}" onclick="openCooked()">
      <div class="verdict-emoji">${emoji}</div>
      <div class="verdict-title">${title}</div>
      <div class="verdict-sub">${sub}</div>
      <span class="verdict-tap">Am I Cooked? →</span>
    </div>`;
}
 
// ══════════════════════════════════════════════════════
//  STREAK
// ══════════════════════════════════════════════════════
function renderStreak() {
  const today = new Date().toISOString().split('T')[0];
  const checked = lastCheck === today;
  const examDays = daysUntil(examDate);
 
  document.getElementById('streak-row').innerHTML = `
    <div class="streak-card">
      <div class="streak-icon">🔥</div>
      <div>
        <div class="streak-num">${streak}</div>
        <div class="streak-lbl">Day Streak</div>
        <div class="streak-sub">${streak>0 ? 'checked in ' + streak + ' day' + (streak!==1?'s':'') + ' straight' : 'start your streak today'}</div>
      </div>
    </div>
    <div class="streak-card" style="flex-direction:column;align-items:flex-start;gap:8px">
      <div style="font-size:.7rem;color:var(--text2)">${checked?'✓ Checked in today':'Check in before you bunk'}</div>
      ${examDate ? `<div style="font-size:.68rem;color:var(--muted)">🎓 Exam in <strong style="color:${examDays<=7?'var(--danger)':'var(--text)'}">${examDays}</strong> days</div>` : ''}
      <button class="checkin-btn ${checked?'checked':''}" onclick="${checked?'':'checkIn()'}">
        ${checked ? '✓ Checked in today' : 'Check in — Am I Cooked?'}
      </button>
    </div>
  `;
}
 
function checkIn() {
  const today = new Date().toISOString().split('T')[0];
  if (lastCheck !== today) {
    const yesterday = new Date(Date.now()-864e5).toISOString().split('T')[0];
    streak = lastCheck === yesterday ? streak + 1 : 1;
    lastCheck = today;
    savePrefs();
  }
  openCooked();
}
 
// ══════════════════════════════════════════════════════
//  AM I COOKED MODAL
// ══════════════════════════════════════════════════════
function openCooked() {
  if (!subjects.length) { toast('Add subjects first', 'err'); return; }
  const total = subjects.reduce((a,s)=>a+s.total,0);
  const present = subjects.reduce((a,s)=>a+s.present,0);
  const ov = total > 0 ? Math.round(present/total*100) : 0;
  const atRisk = subjects.filter(s=>pct(s)<getTarget(s));
  const safeBunks = subjects.reduce((a,s)=>a+bunkable(s),0);
 
  let emoji, verdict, msg, cls;
  if (atRisk.length === 0 && ov >= globalTarget + 10 && safeBunks > 5) {
    emoji='😎'; verdict='Nah you\'re chilling.'; cls='color:var(--accent)';
    msg = `${ov}% overall. ${safeBunks} bunks available. ${randFrom(ROASTS.god)} ${randFrom(ROASTS.safe)}`;
  } else if (atRisk.length === 0 && safeBunks > 0) {
    emoji='🤏'; verdict='Safe. But don\'t get greedy.'; cls='color:var(--warn)';
    msg = `${ov}% overall. Only ${safeBunks} safe bunks left. ${randFrom(ROASTS.medium)}`;
  } else if (atRisk.length === 0) {
    emoji='😬'; verdict='One absence away from disaster.'; cls='color:var(--warn)';
    msg = `${ov}% overall. Zero bunks available. ${randFrom(ROASTS.medium)}`;
  } else if (atRisk.length <= subjects.length / 2) {
    emoji='💀'; verdict='Partially cooked.'; cls='color:var(--danger)';
    msg = `${atRisk.length} subject${atRisk.length>1?'s':''} below target. ${randFrom(ROASTS.low)}`;
  } else {
    emoji='🔥'; verdict='Cooked beyond recognition.'; cls='color:var(--danger)';
    msg = `${atRisk.length} subjects in the danger zone. ${randFrom(ROASTS.cooked)}`;
  }
 
  document.getElementById('ck-emoji').textContent = emoji;
  document.getElementById('ck-verdict').innerHTML = `<span style="${cls}">${verdict}</span>`;
  document.getElementById('ck-msg').textContent = msg;
  document.getElementById('ck-breakdown').innerHTML = subjects.map((s,i) => {
    const p = pct(s), tgt = getTarget(s), bk = bunkable(s), col = pctColor(p, tgt);
    const status = p >= tgt ? (bk > 3 ? '😎 safe' : '🤏 tight') : `💀 -${needed(s)} needed`;
    return `<div class="cooked-row">
      <div style="width:8px;height:8px;border-radius:2px;background:${COLORS[i%COLORS.length]};flex-shrink:0"></div>
      <span class="subj-n">${s.name}</span>
      <span class="subj-p" style="color:${col}">${p}%</span>
      <span style="font-size:.65rem;color:var(--text2)">${status}</span>
    </div>`;
  }).join('');
 
  document.getElementById('cooked-overlay').classList.add('show');
}
function closeCooked() { document.getElementById('cooked-overlay').classList.remove('show'); }
function shareVerdict() {
  const total = subjects.reduce((a,s)=>a+s.total,0);
  const present = subjects.reduce((a,s)=>a+s.present,0);
  const ov = total > 0 ? Math.round(present/total*100) : 0;
  const safeBunks = subjects.reduce((a,s)=>a+bunkable(s),0);
  const atRisk = subjects.filter(s=>pct(s)<getTarget(s)).length;
  const text = `📊 BunkKro Report\nOverall: ${ov}%\nSafe Bunks: ${safeBunks}\nAt Risk: ${atRisk} subject${atRisk!==1?'s':''}\n${ov >= globalTarget ? '😎 Not cooked. Yet.' : '💀 Send help.'}\n\nbunkkro.app`;
  if (navigator.share) { navigator.share({ text }); }
  else if (navigator.clipboard) { navigator.clipboard.writeText(text); toast('Copied to clipboard. Paste and flex.'); }
  else { toast('Share manually: ' + text.slice(0,50) + '...'); }
}
 
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
  document.getElementById('sp-roast').textContent = getRoast(p, tgt);
  document.getElementById('mode-label').innerHTML = s.mode==='estimate'
    ? `<span class="mode-tag est">📡 Estimated</span>`
    : `<span class="mode-tag exact">🎯 Exact</span>`;
 
  // Circle
  const r = 64, circ = 2*Math.PI*r;
  const fill = document.getElementById('circ-fill');
  fill.style.stroke = col;
  fill.style.strokeDasharray = circ;
  fill.style.strokeDashoffset = circ - p/100*circ;
  document.getElementById('circ-pct').textContent = p + '%';
  document.getElementById('circ-pct').style.color = col;
 
  // Chips
  document.getElementById('sp-chips').innerHTML = `
    <div class="chip"><label>Total</label><div class="cv">${s.total}</div></div>
    <div class="chip"><label>Present</label><div class="cv" style="color:var(--accent)">${s.present}</div></div>
    <div class="chip"><label>Absent</label><div class="cv" style="color:var(--danger)">${s.total-s.present}</div></div>
    <div class="chip"><label>Target</label><div class="cv" style="color:var(--orange)">${tgt}%</div></div>
  `;
 
  // Advice
  let pills = '', advText = '';
  if (p >= tgt && bk > 0) {
    pills = Array.from({length:Math.min(bk,5)},(_,j)=>`<span class="pill">Skip ${j+1}</span>`).join('');
    if (bk>5) pills += `<span class="pill">+${bk-5} more</span>`;
    const wk = s.perWeek > 0 ? ` (~${(bk/s.perWeek).toFixed(1)} weeks worth)` : '';
    advText = `You can skip <strong>${bk} more class${bk!==1?'es':''}</strong> in ${s.name} before hitting ${tgt}%${wk}. Space them out — don\'t bunk 2 in a row.`;
  } else if (p < tgt) {
    pills = `<span class="pill d">💀 Below ${tgt}%</span>`;
    const wk = s.perWeek > 0 ? ` That's about ${Math.ceil(nd/s.perWeek)} weeks of showing up.` : '';
    advText = `You need <strong>${nd} consecutive classes</strong> just to reach ${tgt}%.${wk} No bunks. None. Zero. Go.`;
  } else {
    pills = `<span class="pill w">⚠️ Exactly at ${tgt}%</span>`;
    advText = `Literally one absence away from danger. Attend <strong>3–4 more</strong> to build buffer before even thinking about bunking.`;
  }
  document.getElementById('adv-pills').innerHTML = pills;
  document.getElementById('adv-text').innerHTML = advText;
 
  // Simulator
  initSim(s, tgt, p, preserveSim);
 
  // Edit form
  editMode = s.mode || 'exact';
  fillEditForm(s);
}
 
function fillEditForm(s) {
  const isEst = editMode === 'estimate';
  
  // ✨ ADDED: Clear any existing name field first
  const existingNameField = document.getElementById('edit-name-field');
  if (existingNameField) existingNameField.remove();
  
  // ✨ ADDED: Insert editable name field
  const editCardTitle = document.querySelector('.edit-card h4');
  const nameFieldHTML = `
    <div class="field" id="edit-name-field" style="margin-bottom:14px;margin-top:14px">
      <label>Subject Name</label>
      <input type="text" id="inp-subject-name" placeholder="e.g. Mathematics" value="${s.name}">
    </div>
  `;
  if (editCardTitle) {
  editCardTitle.insertAdjacentHTML('afterend', nameFieldHTML);
  }
  
  // Rest of the form
  document.getElementById('form-exact').style.display = isEst ? 'none' : 'grid';
  document.getElementById('form-est').style.display = isEst ? 'block' : 'none';
  if (!isEst) {
    document.getElementById('inp-total').value = s.total;
    document.getElementById('inp-present').value = s.present;
    document.getElementById('inp-absent').value = s.total - s.present;
    document.getElementById('inp-perweek').value = s.perWeek || '';
    document.getElementById('inp-target').value = s.target || '';
    document.getElementById('inp-total').oninput = document.getElementById('inp-present').oninput = () => {
      const t = parseInt(document.getElementById('inp-total').value)||0;
      const pr = parseInt(document.getElementById('inp-present').value)||0;
      document.getElementById('inp-absent').value = Math.max(0, t-pr);
    };
  } else {
    document.getElementById('inp-semstart').value = semStart;
    document.getElementById('inp-est-pw').value = s.perWeek || '';
    document.getElementById('inp-est-absent').value = s.total - s.present;
    document.getElementById('inp-est-target').value = s.target || '';
    document.getElementById('inp-est-semtotal').value = s.semTotal || '';
    // live calc note
    updateEstNote(s);
    document.getElementById('inp-semstart').oninput =
    document.getElementById('inp-est-pw').oninput = () => updateEstNote();
  }
}
 
function toggleMode() {
  editMode = editMode === 'exact' ? 'estimate' : 'exact';
  const s = subjects.find(x=>x.id===currSubjId);
  if (s) { s.mode = editMode; fillEditForm(s); }
}
 
 
// ══════════════════════════════════════════════════════
//  ESTIMATED NOTE HELPER
// ══════════════════════════════════════════════════════
function updateEstNote(s) {
  const el = document.getElementById('est-calc-note');
  if (!el) return;
  const pw = parseInt(document.getElementById('inp-est-pw')?.value) || (s ? s.perWeek : 0) || 0;
  const newSem = document.getElementById('inp-semstart')?.value || semStart;
  const wks = newSem ? Math.max(0, Math.floor((Date.now() - new Date(newSem)) / 864e5 / 7)) : weeksFromStart();
  const conducted = Math.round(wks * pw);
  const semTotalV = parseInt(document.getElementById('inp-est-semtotal')?.value) || (s ? s.semTotal : null);
  const remaining = semTotalV && semTotalV > conducted ? semTotalV - conducted : null;
  let note = '📡 Estimated — ';
  if (pw > 0 && wks > 0) {
    note += `~${conducted} classes conducted so far (${wks} weeks × ${pw}/week).`;
    if (remaining !== null) note += ` <strong>${remaining} classes remaining</strong> this semester.`;
    else note += ' Set "Total Classes This Semester" to see remaining classes.';
  } else {
    note += 'Set semester start date and classes/week to auto-calculate.';
  }
  el.innerHTML = note;
}
 
async function saveSubject() {
  const s = subjects.find(x=>x.id===currSubjId);
  if (!s) {
    toast('Subject not found. Refreshing...', 'err');
    await loadSubjects(); // ✅ RELOAD
    goPage('home'); // ✅ REDIRECT
    return;
  }

   const saveBtn = document.querySelector('.edit-card .save-btn');
    saveBtn.disabled = true; 
    saveBtn.textContent = 'Saving...'; 
  
  const newName = document.getElementById('inp-subject-name')?.value.trim();
    if (!newName) {
          toast('Subject name cannot be empty', 'err');
          saveBtn.disabled = false;
         saveBtn.textContent = 'Save';
           return;
          }
  if (newName && newName !== s.name) {
    s.name = newName;
    document.getElementById('sp-title').textContent = newName;
    document.getElementById('sp-name').textContent = newName;
  }
  
  if (editMode === 'estimate') {
    const pw = Math.max(1, parseInt(document.getElementById('inp-est-pw').value)||s.perWeek||3);
    const absent = parseInt(document.getElementById('inp-est-absent').value)||0;
    const tRaw = document.getElementById('inp-est-target').value;
    const newSem = document.getElementById('inp-semstart').value;
    if (newSem) { semStart = newSem; savePrefs(); }

    const semTotalRaw = document.getElementById('inp-est-semtotal').value;
    const semTotalVal = semTotalRaw ? parseInt(semTotalRaw) : null;

    const total = estimateTotal(pw);

    s.total = total; 
    s.present = Math.max(0, total-absent);
    s.perWeek = pw; 
    s.target = tRaw ? Math.max(1,Math.min(100,parseInt(tRaw))) : null;
    s.semTotal = semTotalVal;
    s.mode = 'estimate';

  } else {
    const t = parseInt(document.getElementById('inp-total').value)||0;
    const pr = parseInt(document.getElementById('inp-present').value)||0;
    const pw = parseInt(document.getElementById('inp-perweek').value)||0;
    const tRaw = document.getElementById('inp-target').value;

    s.total = t; 
    s.present = Math.min(pr,t);
    s.perWeek = pw; 
    s.target = tRaw ? Math.max(1,Math.min(100,parseInt(tRaw)||globalTarget)) : null;
    s.mode = 'exact';
  }
  
  // ✅ FIXED: send correctly mapped fields
  const success = await updateSubject(currSubjId, {
    name: s.name,
    code: s.code || '',
    total: s.total,
    present: s.present,
    perWeek: s.perWeek,
    target: s.target,
    semTotal: s.semTotal,
    mode: s.mode
  });
  
  if (success) {
    const sv = document.getElementById('sim-input')?.value||0;
    renderSubject(currSubjId, true);
    renderNav();
    if (document.getElementById('sim-input')) { 
      document.getElementById('sim-input').value = sv; 
      updateSim(); 
    }
    toast(randToast('save'));
  }
    saveBtn.disabled = false;
  saveBtn.textContent = 'Save';
}
 
async function deleteSubject() {
  const s = subjects.find(x=>x.id===currSubjId);
  if (!s) return;
  
  const p = pct(s);
  const tgt = getTarget(s);
  document.getElementById('delete-msg').innerHTML = `
    <strong style="color:var(--accent)">${s.name}</strong><br>
    <span style="font-size:.72rem;color:${pctColor(p,tgt)}">${p}% attendance</span><br>
    <span style="font-size:.68rem;color:var(--muted);margin-top:8px;display:inline-block">This will also delete all tracker history for this subject.</span>
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
    
    // Delete subject
    const success = await deleteSubjectFromDB(subjId);
    
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
  const tgt = _st, pw = s.perWeek||0;
  const plan = Math.max(0, parseInt(document.getElementById('sim-input').value)||0);
  const projTotal = s.total + plan;
  const projPct = projTotal > 0 ? Math.round(s.present/projTotal*100) : 0;
  const drop = _sp - projPct;
  const safe = projPct >= tgt;
  const bk_now = Math.max(0, Math.floor(s.present/tgt*100) - s.total);
 
  if (plan === 0) {
    const remaining = (s.semTotal && s.semTotal > s.total) ? s.semTotal - s.total : null;
    let h = bk_now > 0
      ? 'Can safely skip <strong>' + bk_now + '</strong> more.' + (pw>0 ? ' ~' + (bk_now/pw).toFixed(1) + ' weeks worth.' : '')
      : 'Zero safe bunks. Right at the limit.';
    if (remaining !== null) {
      const projEndTotal = s.total + remaining;
      const projEndPct = projEndTotal > 0 ? Math.round(s.present / projEndTotal * 100) : 0;
      h += ' If you attend all <strong>' + remaining + '</strong> remaining classes, you end the semester at <strong style="color:' + pctColor(projEndPct, tgt) + '">' + projEndPct + '%</strong>.';
    }
    document.getElementById('sim-result').innerHTML = '<div class="adv-text" style="color:var(--muted)">' + h + '</div>';
    return;
  }
 
  const wkCtx = pw > 0 ? ` (${(plan/pw).toFixed(1)}w)` : '';
  const extraNd = safe ? 0 : needed({total:projTotal,present:s.present}, tgt);
  const recovCtx = !safe && extraNd > 0
    ? pw > 0 ? ` Need <strong>${extraNd} straight classes</strong> to recover — ~${Math.ceil(extraNd/pw)} weeks.`
             : ` Need <strong>${extraNd} consecutive</strong> to recover.`
    : '';
 
  const reaction = getSimReaction(plan, bk_now, safe, projPct, tgt);
 
  // End-of-semester projection if semTotal is set
  let eosCtx = '';
  if (s.semTotal && s.semTotal > s.total) {
    const remainAfterBunks = Math.max(0, s.semTotal - s.total - plan);
    const eosTotal = s.total + plan + remainAfterBunks;
    const eosPct = eosTotal > 0 ? Math.round(s.present / eosTotal * 100) : 0;
    eosCtx = ' End of sem: <strong style="color:' + pctColor(eosPct, tgt) + '">' + eosPct + '%</strong>.';
  }
 
  let icon, verdict;
  if (safe && plan <= bk_now) {
    icon = '✅'; verdict = '<strong style="color:var(--accent)">' + _sp + '% → ' + projPct + '%</strong> — above ' + tgt + '%' + wkCtx + '. ' + reaction + eosCtx;
  } else if (safe) {
    icon = '⚠️'; verdict = '<strong style="color:var(--warn)">' + _sp + '% → ' + projPct + '%</strong> — above ' + tgt + '%' + wkCtx + ' but ' + (plan-bk_now) + ' over limit. ' + reaction + eosCtx;
  } else {
    icon = '🚨'; verdict = '<strong style="color:var(--danger)">' + _sp + '% → ' + projPct + '%</strong> — <strong>' + Math.abs(drop) + '%</strong> below ' + tgt + '%' + wkCtx + '.' + recovCtx + ' ' + reaction + eosCtx;
  }
 
  const bw = Math.min(100,projPct), cw = Math.min(100,_sp);
  const tgtPos = Math.min(tgt, 97);
  document.getElementById('sim-result').innerHTML = `
    <div class="sim-bar-wrap">
      <div class="sim-bar">
        <div class="sim-cur" style="width:${cw}%"></div>
        <div class="sim-proj" style="width:${bw}%;background:${pctColor(projPct,tgt)}"></div>
        <div class="sim-line" style="left:${tgtPos}%"></div>
        <div class="sim-pct" style="color:${pctColor(projPct,tgt)}">${projPct}%</div>
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
    const today = new Date().toISOString().split('T')[0];
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
      <input type="text" placeholder="Subject name" value="${name}">
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

    const pw = parseInt(f.pw)||3;
    const target = f.target ? Math.max(1,Math.min(100,parseInt(f.target))) : null;
    const semTotalOb = f.semtotal ? parseInt(f.semtotal) : null;

    let total, present;
    
    if (obMode === 'estimate') {
      const absent = parseInt(f.absent)||0;
      total = estimateTotal(pw);
      present = Math.max(0, total-absent);
    } else {
      total = parseInt(f.total)||0;
      present = parseInt(f.present)||0;
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
  document.getElementById('add-overlay').classList.add('show'); 
  selAddMode('estimate');
  
  // ✅ ADDED: Pre-fill semester start date if available
  const savedSemStart = localStorage.getItem('bk_sem_start') || semStart;
  if (savedSemStart) {
    const semStartField = document.getElementById('as-semstart');
    if (semStartField) semStartField.value = savedSemStart;
  }
}
function closeAddModal() { document.getElementById('add-overlay').classList.remove('show'); }
function selAddMode(m) {
  addMode = m;
  
  // Update selected state
  ['exact', 'estimate'].forEach(x => {
    const el = document.getElementById(`add-opt-${x}`);
    if (el) el.classList.toggle('sel', x === m);
  });
  
  // Toggle field visibility
  document.getElementById('add-exact-fields').style.display = m === 'exact' ? 'block' : 'none';
  document.getElementById('add-est-fields').style.display = m === 'estimate' ? 'block' : 'none';
}

async function confirmAdd() {
  const submitBtn = document.querySelector('#add-overlay .btn-pri');

  // 🔒 Prevent spam clicks
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Adding...';
  }

  try {
    const name = document.getElementById('as-name').value.trim();

    if (!name) {
      toast('Subject name required', 'err');
      return;
    }

    const tRaw = document.getElementById('as-target').value;
    const target = tRaw ? Math.max(1, Math.min(100, parseInt(tRaw))) : null;

    let total, present, perWeek, mode;
    let semTotalAdd = null;

    if (addMode === 'estimate') {
      perWeek = parseInt(document.getElementById('as-pw').value) || 3;
      const missed = parseInt(document.getElementById('as-missed').value) || 0;
      
      // ✅ ADDED: Get semester start date from modal
      const modalSemStart = document.getElementById('as-semstart').value;
      
      // ✅ ADDED: Save to localStorage if provided
      if (modalSemStart) {
        localStorage.setItem('bk_sem_start', modalSemStart);
        semStart = modalSemStart; // Update global variable
      }
      
      const stRaw = document.getElementById('as-semtotal').value;
      semTotalAdd = stRaw ? parseInt(stRaw) : null;
      
      // ✅ FIXED: Calculate total AFTER setting semStart
      total = estimateTotal(perWeek);
      present = Math.max(0, total - missed);
      mode = 'estimate';
      
      // ✅ ADDED: Debug logging
      console.log('Estimate Mode - Missed:', missed, 'Total:', total, 'Present:', present, 'PerWeek:', perWeek);

    } else {
      total = parseInt(document.getElementById('as-total').value) || 0;
      present = parseInt(document.getElementById('as-present').value) || 0;
      perWeek = parseInt(document.getElementById('as-perweek').value) || 3;
      mode = 'exact';
      
      console.log('Exact Mode - Total:', total, 'Present:', present);
    }

    const newSubject = {
      name,
      code: name.slice(0, 2).toUpperCase() + '101',
      total,
      present: Math.min(present, total),
      perWeek,
      target,
      semTotal: semTotalAdd,
      mode
    };

    const success = await addSubject(newSubject);

    if (success) {
      closeAddModal();
      toast(randToast('add'));

      // ✅ Safe reset all fields
      const ids = [
        'as-name',
        'as-total',
        'as-present',
        'as-perweek',
        'as-pw',
        'as-missed',
        'as-target',
        'as-semtotal',
        'as-semstart' // ✅ ADDED
      ];

      ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });

      // ✅ FIXED: Force re-render to show updated data
      renderAll();
    }

  } catch (err) {
    console.error('Add subject error:', err);
    toast('Something went wrong', 'err');

  } finally {
    // 🔓 Always re-enable button
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Add Subject';
    }
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
['ob-overlay','add-overlay','delete-overlay','slot-edit-overlay','sync-freq-overlay','extra-class-overlay','tt-confirm-overlay'].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('click', e => {
      if (e.target === e.currentTarget) {
        e.currentTarget.classList.remove('show');
      }
    });
  }
});

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
//  FEATURE 1 & 2: SMART TIMETABLE OCR & SCANNING
// ══════════════════════════════════════════════════════

let pendingOCRFile = null;
let currentScannedImageBlob = null;

function handleTimetableFileUpload(file) {
  if (!file) return;

  const validTypes = ['image/png', 'image/jpeg', 'image/jpg'];
  if (!validTypes.includes(file.type)) {
    toast('Please upload a valid PNG or JPG image', 'err');
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

function closeTtConfirmModal() {
  document.getElementById('tt-confirm-overlay').classList.remove('show');
  pendingOCRFile = null;
}

function confirmProceedScan() {
  closeTtConfirmModal();
  if (pendingOCRFile) {
    processTimetableImage(pendingOCRFile);
    pendingOCRFile = null;
  }
}

async function processTimetableImage(file) {
  currentScannedImageBlob = file;

  // Show preview
  const previewBox = document.getElementById('tt-preview-box');
  const previewImg = document.getElementById('tt-scanned-preview-img');
  const progressBox = document.getElementById('ocr-progress-box');
  const progressBar = document.getElementById('ocr-bar-fill');
  const statusText = document.getElementById('ocr-status-text');
  const detailsText = document.getElementById('ocr-details');

  const reader = new FileReader();
  reader.onload = async (e) => {
    if (previewImg) previewImg.src = e.target.result;
    if (previewBox) previewBox.style.display = 'block';

    if (progressBox) progressBox.style.display = 'block';
    if (progressBar) progressBar.style.width = '10%';
    if (statusText) statusText.textContent = 'Initializing OCR Scanner...';
    if (detailsText) detailsText.textContent = 'Preparing image data for local recognition...';

    await runTesseractScan(e.target.result);
  };
  reader.readAsDataURL(file);
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

async function runTesseractScan(imageSrc) {
  const progressBox = document.getElementById('ocr-progress-box');
  const progressBar = document.getElementById('ocr-bar-fill');
  const statusText = document.getElementById('ocr-status-text');
  const detailsText = document.getElementById('ocr-details');

  try {
    if (!window.Tesseract) {
      throw new Error('Tesseract OCR engine is loading or unavailable. Please check your connection.');
    }

    if (statusText) statusText.textContent = 'Reading timetable structure...';

    const result = await Tesseract.recognize(imageSrc, 'eng', {
      logger: m => {
        if (m.status === 'recognizing text') {
          const pct = Math.round(m.progress * 100);
          if (progressBar) progressBar.style.width = `${pct}%`;
          if (statusText) statusText.textContent = `Scanning timetable... ${pct}%`;
          if (detailsText) detailsText.textContent = `Recognizing periods and subject codes (${pct}% complete)`;
        }
      }
    });

    if (progressBar) progressBar.style.width = '100%';
    if (statusText) statusText.textContent = '✓ Timetable Scanned Successfully!';
    if (detailsText) detailsText.textContent = 'Review detected schedule below. Tap any slot to edit.';

    setTimeout(() => {
      if (progressBox) progressBox.style.display = 'none';
    }, 1800);

    // Parse extracted OCR text
    parseOCRResultToSchedule(result.data);
    toast('Timetable extracted! Review and adjust below.');

  } catch (err) {
    console.error('OCR Error:', err);
    if (progressBox) progressBox.style.display = 'none';
    toast('Failed to scan image: ' + err.message, 'err');
  }
}

// Intelligent parser: identifies days, periods, times, breaks, subject codes
function parseOCRResultToSchedule(ocrData) {
  const text = ocrData.text || '';
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  console.log('OCR Extracted Lines:', lines);

  const dayKeywords = [
    { day: 1, name: 'Monday', regex: /\b(mon|monday)\b/i },
    { day: 2, name: 'Tuesday', regex: /\b(tue|tues|tuesday)\b/i },
    { day: 3, name: 'Wednesday', regex: /\b(wed|wednes|wednesday)\b/i },
    { day: 4, name: 'Thursday', regex: /\b(thu|thur|thurs|thursday)\b/i },
    { day: 5, name: 'Friday', regex: /\b(fri|friday)\b/i },
    { day: 6, name: 'Saturday', regex: /\b(sat|saturday)\b/i },
    { day: 7, name: 'Sunday', regex: /\b(sun|sunday)\b/i }
  ];

  const extractedSlots = [];
  let currentDay = 1;
  let currentPeriod = 1;

  // Extract common period times if present (e.g. 09:00 - 10:00, 10:15 - 11:15)
  const timeRegex = /(\d{1,2}[:.]\d{2})\s*(?:-|to)\s*(\d{1,2}[:.]\d{2})/i;
  const periodTimes = [];

  lines.forEach(line => {
    const tm = line.match(timeRegex);
    if (tm && periodTimes.length < 8) {
      periodTimes.push({
        start: tm[1].replace('.', ':'),
        end: tm[2].replace('.', ':')
      });
    }
  });

  // Line-by-line parsing
  lines.forEach(line => {
    // Check if line specifies a day
    const matchedDay = dayKeywords.find(d => d.regex.test(line));
    if (matchedDay) {
      currentDay = matchedDay.day;
      currentPeriod = 1;
      // Strip the day keyword from line to see if subjects follow
      line = line.replace(matchedDay.regex, '').trim();
      if (!line) return;
    }

    // Check for lunch / break
    if (/\b(lunch|break|recess|interval|tiffin)\b/i.test(line)) {
      extractedSlots.push({
        id: 'tt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        day: currentDay,
        period: currentPeriod++,
        startTime: '',
        endTime: '',
        subjectId: null,
        subjectName: 'Lunch / Break',
        isBreak: true,
        isUncertain: false
      });
      return;
    }

    // Split line by separators (| , ; tabs or multiple spaces)
    const tokens = line.split(/[|;,]|\s{2,}/).map(t => t.trim()).filter(t => t.length > 1);

    tokens.forEach(tok => {
      // Ignore pure timestamps or headers
      if (timeRegex.test(tok) || /^(period|time|day|hour|sem|room)\b/i.test(tok)) return;

      // Check for break token
      if (/\b(lunch|break|free|recess)\b/i.test(tok)) {
        extractedSlots.push({
          id: 'tt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
          day: currentDay,
          period: currentPeriod++,
          startTime: '',
          endTime: '',
          subjectId: null,
          subjectName: 'Break',
          isBreak: true,
          isUncertain: false
        });
        return;
      }

      // Check if token matches an existing subject
      const cleanToken = tok.replace(/[^a-zA-Z0-9\s-]/g, '').trim();
      if (!cleanToken) return;

      let matchedSubj = subjects.find(s => 
        s.name.toLowerCase() === cleanToken.toLowerCase() ||
        (s.code && s.code.toLowerCase() === cleanToken.toLowerCase())
      );

      // Substring fuzzy match
      if (!matchedSubj) {
        matchedSubj = subjects.find(s => 
          cleanToken.toLowerCase().includes(s.name.toLowerCase()) || 
          s.name.toLowerCase().includes(cleanToken.toLowerCase())
        );
      }

      const pTime = periodTimes[currentPeriod - 1] || { start: '', end: '' };

      extractedSlots.push({
        id: 'tt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        day: currentDay,
        period: currentPeriod++,
        startTime: pTime.start || '',
        endTime: pTime.end || '',
        subjectId: matchedSubj ? matchedSubj.id : null,
        subjectName: matchedSubj ? matchedSubj.name : cleanToken,
        isBreak: false,
        isUncertain: !matchedSubj // Highlight for review if not matched to existing subject
      });
    });
  });

  // Fallback: If OCR produced very few slots, generate a standard template
  if (extractedSlots.length === 0) {
    dayKeywords.slice(0, 5).forEach(d => {
      for (let p = 1; p <= 4; p++) {
        const defaultSubj = subjects[(p - 1) % (subjects.length || 1)];
        extractedSlots.push({
          id: 'tt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
          day: d.day,
          period: p,
          startTime: '',
          endTime: '',
          subjectId: defaultSubj ? defaultSubj.id : null,
          subjectName: defaultSubj ? defaultSubj.name : `Period ${p}`,
          isBreak: false,
          isUncertain: true
        });
      }
    });
  }

  timetable = extractedSlots;
  saveTimetableToStorageAndDB();
  renderTimetable();
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

function renderTimetable() {
  const container = document.getElementById('tt-grid-wrap');
  const badge = document.getElementById('tt-stats-badge');
  const sundayBtn = document.getElementById('btn-toggle-sunday');

  if (!container) return;

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
      <div class="empty" style="padding:32px 10px">
        <div class="empty-icon">📅</div>
        <h3>No weekly schedule configured yet</h3>
        <p>Upload your timetable screenshot above or add class periods manually.</p>
        <button class="btn-pri" onclick="openAddSlotModal(1, 1)">+ Add First Class</button>
      </div>
    `;
    return;
  }

  // Render weekly grid table
  let html = `
    <table class="tt-table">
      <thead>
        <tr>
          <th style="width:110px">Day</th>
          <th>Scheduled Periods & Subjects</th>
        </tr>
      </thead>
      <tbody>
  `;

  activeDays.forEach(dayInfo => {
    const daySlots = timetable
      .filter(s => s.day === dayInfo.num)
      .sort((a, b) => a.period - b.period);

    html += `
      <tr>
        <td class="tt-day-cell">
          <div style="font-family:'Syne',sans-serif;font-weight:700;color:var(--accent);font-size:.85rem">${dayInfo.name}</div>
          <div style="font-size:.6rem;color:var(--muted);margin-top:2px">${daySlots.filter(s=>!s.isBreak).length} classes</div>
        </td>
        <td>
          <div class="tt-slots-col">
            ${daySlots.map(slot => {
              const matchedSubj = subjects.find(s => s.id === slot.subjectId);
              const displayName = matchedSubj ? matchedSubj.name : slot.subjectName;
              const timeDisplay = slot.startTime ? (slot.endTime ? `${slot.startTime} - ${slot.endTime}` : slot.startTime) : '';

              if (slot.isBreak) {
                return `
                  <div class="tt-slot-card break" onclick="openEditSlotModal('${slot.id}')">
                    <div class="tt-slot-top">
                      <span class="tt-slot-pnum">P${slot.period}</span>
                      <span class="tt-slot-time">${timeDisplay || 'Break'}</span>
                    </div>
                    <div class="tt-slot-name">☕ ${slot.subjectName}</div>
                  </div>
                `;
              }

              return `
                <div class="tt-slot-card ${slot.isUncertain ? 'uncertain' : ''}" onclick="openEditSlotModal('${slot.id}')" title="Click to edit">
                  <div class="tt-slot-top">
                    <span class="tt-slot-pnum">Period ${slot.period}</span>
                    <span class="tt-slot-time">${timeDisplay}</span>
                  </div>
                  <div class="tt-slot-name">${displayName}</div>
                  ${slot.isUncertain ? '<div style="color:var(--warn);font-size:.56rem;margin-top:3px">⚠️ Review subject</div>' : ''}
                  ${matchedSubj ? `<div class="tt-slot-subjtag">✓ Mapped to ${matchedSubj.name}</div>` : ''}
                </div>
              `;
            }).join('')}
            <button class="tt-add-slot-btn" onclick="openAddSlotModal(${dayInfo.num}, ${(daySlots.length ? Math.max(...daySlots.map(s=>s.period)) + 1 : 1)})">+ Add Class</button>
          </div>
        </td>
      </tr>
    `;
  });

  html += `</tbody></table>`;
  container.innerHTML = html;
}

function toggleSundayDisplay() {
  timetableMeta.showSunday = !timetableMeta.showSunday;
  renderTimetable();
}

// ══════════════════════════════════════════════════════
//  TIMETABLE SLOT EDIT / ADD MODAL
// ══════════════════════════════════════════════════════

let currentEditingSlot = null;

function openAddSlotModal(day = 1, period = 1) {
  currentEditingSlot = null;
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
    subjects.map(s => `<option value="${s.id}" ${s.id === selectedId ? 'selected' : ''}>${s.name} (${pct(s)}%)</option>`).join('');
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

async function saveSlotModal() {
  const day = parseInt(document.getElementById('slot-day').value) || 1;
  const period = parseInt(document.getElementById('slot-period').value) || 1;
  const type = document.getElementById('slot-type').value;
  const isBreak = type === 'break';
  const startTime = document.getElementById('slot-start-time').value.trim();
  const endTime = document.getElementById('slot-end-time').value.trim();
  const subjSelect = document.getElementById('slot-subject-select').value;
  const subjNameInput = document.getElementById('slot-subject-name').value.trim();

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

  await saveTimetableToStorageAndDB();
  closeSlotEditModal();
  renderTimetable();
  if (currPage === 'tracker') renderTracker();
  toast('Schedule updated ✓');
}

async function deleteCurrentSlot() {
  const slotId = document.getElementById('slot-edit-id').value;
  if (!slotId) return;

  timetable = timetable.filter(s => s.id !== slotId);
  await saveTimetableToStorageAndDB();
  closeSlotEditModal();
  renderTimetable();
  if (currPage === 'tracker') renderTracker();
  toast('Slot removed');
}

function confirmClearTimetable() {
  if (!confirm('Are you sure you want to clear your entire weekly schedule?')) return;
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
    list.innerHTML = `<div style="text-align:center;padding:20px;color:var(--muted)">No subjects found. Add subjects first.</div>`;
    modal.classList.add('show');
    return;
  }

  list.innerHTML = subjects.map(s => {
    const calculated = frequencies[s.id] || 0;
    const current = s.perWeek || 0;
    const isDiff = calculated !== current;

    return `
      <div class="sync-freq-row">
        <div>
          <strong style="font-size:.82rem">${s.name}</strong>
          <div style="font-size:.62rem;color:var(--muted)">Current setting: ${current} / week</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="sync-freq-badge">${calculated} / week</span>
          ${isDiff ? '<span style="font-size:.6rem;color:var(--accent)">⚡ Change</span>' : '<span style="font-size:.6rem;color:var(--muted)">✓ Match</span>'}
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

function toggleDateHoliday() {
  const date = selectedTrackerDate;
  if (dateExceptions[date] && dateExceptions[date].type === 'holiday') {
    delete dateExceptions[date];
    saveDateExceptionToDB(date, null);
    toast('Holiday removed for ' + date);
  } else {
    dateExceptions[date] = { type: 'holiday', note: 'College Holiday' };
    saveDateExceptionToDB(date, 'holiday');
    toast('Marked as Holiday 🏖️');
  }
  renderTracker();
}

// Get scheduled classes for a specific date (1=Monday ... 7=Sunday)
function getScheduledClassesForDate(dateStr) {
  const parts = dateStr.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  let dayOfWeek = d.getDay(); // 0 = Sunday, 1 = Monday ... 6 = Saturday
  dayOfWeek = dayOfWeek === 0 ? 7 : dayOfWeek; // Convert 0 (Sun) to 7

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
      banner.innerHTML = `🏖️ <strong>College Holiday</strong> — No classes are counted as absent today.`;
      banner.style.display = 'flex';
    } else if (isToday) {
      banner.className = 'date-status-banner today';
      banner.innerHTML = `⚡ <strong>Today's Classes</strong> — Mark each period as you attend or bunk.`;
      banner.style.display = 'flex';
    } else {
      banner.className = 'date-status-banner future';
      banner.innerHTML = `📅 Viewing schedule for <strong>${formattedDate}</strong>`;
      banner.style.display = 'flex';
    }
  }

  // Get scheduled timetable classes for this day
  const scheduledClasses = getScheduledClassesForDate(selectedTrackerDate);

  // Include any extra ad-hoc classes logged for this date
  const extraClasses = [];
  if (dailyPeriodLogs[selectedTrackerDate]) {
    Object.entries(dailyPeriodLogs[selectedTrackerDate]).forEach(([key, log]) => {
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

  const allClasses = [...scheduledClasses, ...extraClasses];

  // Daily Completion Stats
  const totalCount = allClasses.length;
  const presentCount = allClasses.filter(c => c.status === 'p').length;
  const absentCount = allClasses.filter(c => c.status === 'a').length;
  const cancelledCount = allClasses.filter(c => c.status === 'cancelled').length;
  const markedCount = presentCount + absentCount + cancelledCount;
  const pendingCount = totalCount - markedCount;
  const progressPct = totalCount > 0 ? Math.round((markedCount / totalCount) * 100) : 0;

  if (summaryBox) {
    summaryBox.innerHTML = `
      <div class="daily-summary-stats">
        <div class="daily-stat-box">
          <div class="daily-stat-val" style="color:var(--text)">${totalCount}</div>
          <div class="daily-stat-lbl">Scheduled</div>
        </div>
        <div class="daily-stat-box">
          <div class="daily-stat-val" style="color:var(--accent)">${presentCount}</div>
          <div class="daily-stat-lbl">Present</div>
        </div>
        <div class="daily-stat-box">
          <div class="daily-stat-val" style="color:var(--danger)">${absentCount}</div>
          <div class="daily-stat-lbl">Absent</div>
        </div>
        <div class="daily-stat-box">
          <div class="daily-stat-val" style="color:${pendingCount === 0 ? 'var(--accent)' : 'var(--warn)'}">${pendingCount}</div>
          <div class="daily-stat-lbl">${pendingCount === 0 ? 'All Done ✓' : 'Pending'}</div>
        </div>
      </div>
      <div class="daily-prog-track">
        <div class="daily-prog-fill" style="width:${progressPct}%"></div>
      </div>
      <div class="daily-completion-text">
        <span>${markedCount} of ${totalCount} classes marked</span>
        <span>${progressPct}% complete</span>
      </div>
    `;
  }

  // If holiday
  if (isHoliday) {
    content.innerHTML = `
      <div class="empty" style="padding:30px 10px">
        <div class="empty-icon">🏖️</div>
        <h3>Enjoy your holiday!</h3>
        <p>No classes scheduled for today. Attendance records are paused.</p>
      </div>
    `;
    renderRecentHistory();
    return;
  }

  // If no scheduled classes on this day
  if (!allClasses.length) {
    content.innerHTML = `
      <div class="empty" style="padding:32px 10px">
        <div class="empty-icon">😴</div>
        <h3>No classes scheduled for ${dateObj.toLocaleDateString('en-IN', { weekday: 'long' })}</h3>
        <p>${timetable.length ? 'You have no timetable classes on this day.' : 'Set up your weekly timetable to see your daily classes automatically.'}</p>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:10px">
          <button class="btn-pri" onclick="goPage('timetable')">Configure Timetable ⚡</button>
          <button class="btn-sec" onclick="openExtraClassModal()">+ Add Extra Class</button>
        </div>
      </div>
    `;
    renderRecentHistory();
    return;
  }

  // Render Daily Scheduled Class Cards
  content.innerHTML = allClasses.map((item, idx) => {
    const s = subjects.find(x => x.id === item.subjectId);
    const displayName = s ? s.name : item.subjectName;
    const timeDisplay = item.startTime ? (item.endTime ? `${item.startTime} - ${item.endTime}` : item.startTime) : '';

    let cardClass = 'daily-class-card';
    if (item.status === 'p') cardClass += ' marked-p';
    else if (item.status === 'a') cardClass += ' marked-a';
    else if (item.status === 'cancelled') cardClass += ' marked-c';

    return `
      <div class="${cardClass}">
        <div class="daily-class-main">
          <div class="daily-class-meta">
            <span class="period-badge">${item.isExtra ? 'EXTRA' : `PERIOD ${item.period}`}</span>
            ${timeDisplay ? `<span class="time-badge">🕒 ${timeDisplay}</span>` : ''}
            ${item.status === 'cancelled' ? '<span style="font-size:.6rem;color:var(--warn);font-weight:700">🚫 CANCELLED</span>' : ''}
          </div>
          <div class="daily-class-name">${displayName}</div>
          ${s ? `<div class="daily-class-stats">Attendance: <strong style="color:${pctColor(pct(s))}">${pct(s)}%</strong> (${s.present}/${s.total}) · ${bunkable(s)} safe bunks</div>` : '<div class="daily-class-stats" style="color:var(--muted)">Unmapped subject</div>'}
        </div>
        <div class="tracker-btns">
          <button class="tbtn p ${item.status === 'p' ? 'on' : ''}" onclick="markPeriodAttendance('${item.slotId}', '${item.subjectId || ''}', 'p', ${item.period}, ${item.isExtra})">Present</button>
          <button class="tbtn a ${item.status === 'a' ? 'on' : ''}" onclick="markPeriodAttendance('${item.slotId}', '${item.subjectId || ''}', 'a', ${item.period}, ${item.isExtra})">Absent</button>
          <button class="tbtn c ${item.status === 'cancelled' ? 'on' : ''}" title="Cancelled class does not count as absence" onclick="markPeriodAttendance('${item.slotId}', '${item.subjectId || ''}', 'cancelled', ${item.period}, ${item.isExtra})">Cancel</button>
        </div>
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
  if (!dailyPeriodLogs[date]) dailyPeriodLogs[date] = {};

  const prevEntry = dailyPeriodLogs[date][slotId];
  const prevStatus = prevEntry ? prevEntry.status : null;

  const s = subjects.find(x => x.id === subjId);

  try {
    let finalStatus = newStatus;

    // Toggle off if clicked the same status button
    if (prevStatus === newStatus) {
      finalStatus = null;
      delete dailyPeriodLogs[date][slotId];

      // Delete from DB
      await supabaseClient
        .from('daily_period_logs')
        .delete()
        .eq('user_id', currentUser.id)
        .eq('date', date)
        .eq('entry_id', slotId);

    } else {
      // Set new status
      dailyPeriodLogs[date][slotId] = {
        status: newStatus,
        subjectId: subjId,
        periodIndex: periodIndex,
        isExtra: isExtra
      };

      // Upsert to daily_period_logs
      await supabaseClient
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
    }

    // Accurately recalculate subject's total and present counts without double counting
    if (s) {
      if (prevStatus === 'p') {
        s.present = Math.max(0, s.present - 1);
        s.total = Math.max(0, s.total - 1);
      } else if (prevStatus === 'a') {
        s.total = Math.max(0, s.total - 1);
      } // 'cancelled' or null did not increment totals

      if (finalStatus === 'p') {
        s.present += 1;
        s.total += 1;
      } else if (finalStatus === 'a') {
        s.total += 1;
      } // 'cancelled' does not increment total or count as absence

      await updateSubject(s.id, { total: s.total, present: s.present });
    }

    // Save to local cache
    localStorage.setItem('bk_daily_period_logs_' + currentUser.id, JSON.stringify(dailyPeriodLogs));

    renderNav();
    renderTracker();
    if (currPage === 'home') renderHome();

    if (finalStatus === 'p') toast(`${s ? s.name : 'Class'}: ✓ Present`);
    else if (finalStatus === 'a') toast(`${s ? s.name : 'Class'}: ✗ Absent`, 'err');
    else if (finalStatus === 'cancelled') toast(`${s ? s.name : 'Class'}: Cancelled (No penalty)`);
    else toast('Attendance unmarked');

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

  select.innerHTML = subjects.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
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

  if (!dailyPeriodLogs[date]) dailyPeriodLogs[date] = {};

  dailyPeriodLogs[date][extraId] = {
    status: 'p', // default to present when adding extra class
    subjectId: subjId,
    periodIndex: 99,
    isExtra: true,
    extraName: s.name,
    extraTime: timeNote
  };

  // Increment subject total & present
  s.total += 1;
  s.present += 1;
  await updateSubject(s.id, { total: s.total, present: s.present });

  try {
    await supabaseClient
      .from('daily_period_logs')
      .upsert({
        user_id: currentUser.id,
        date: date,
        entry_id: extraId,
        subject_id: subjId,
        period_index: 99,
        status: 'p'
      });
  } catch (e) {
    console.warn('DB upsert error for extra class:', e);
  }

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
    container.innerHTML = '<div style="color:var(--muted);font-size:.72rem;padding:6px 0">No attendance history logged yet.</div>';
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
      <div class="hist-row" onclick="onDateSelected('${d}')" style="cursor:pointer" title="Click to view this day">
        <span style="flex:1;color:var(--text2)">${lbl} ${dateExceptions[d]?.type === 'holiday' ? '🏖️' : ''}</span>
        <span style="color:var(--accent);font-weight:700">✓ ${p}</span>
        <span style="color:var(--danger);font-weight:700">✗ ${a}</span>
        ${c > 0 ? `<span style="color:var(--warn);font-size:.65rem">🚫 ${c}</span>` : ''}
      </div>
    `;
  }).join('');
}

// ══════════════════════════════════════════════════════
//  STORAGE & DB PERSISTENCE HELPERS
// ══════════════════════════════════════════════════════

async function saveTimetableToStorageAndDB() {
  if (currentUser) {
    localStorage.setItem('bk_timetable_' + currentUser.id, JSON.stringify(timetable));
  }

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

    if (ttId) {
      // 2. Clear old entries
      await supabaseClient
        .from('timetable_entries')
        .delete()
        .eq('user_id', currentUser.id);

      // 3. Insert new entries
      if (timetable.length > 0) {
        const payload = timetable.map(s => ({
          timetable_id: ttId,
          user_id: currentUser.id,
          day_of_week: s.day,
          period_index: s.period,
          start_time: s.startTime || '',
          end_time: s.endTime || '',
          subject_id: s.subjectId || null,
          subject_name: s.subjectName || 'Unassigned',
          is_break: s.isBreak || false
        }));

        await supabaseClient.from('timetable_entries').insert(payload);
      }
    }
  } catch (err) {
    console.warn('Timetable database sync warning:', err.message);
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