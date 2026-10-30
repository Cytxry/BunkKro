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
  if (!confirm('Are you sure you want to logout?')) return;
  
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
  'Attend today so future you can nap guilt-free.',
  'A bunk saved is a bunk earned.',
  'The front row has the best Wi-Fi. Allegedly.',
  'Proxy is temporary. Attendance records are forever.',
  'Spend bunks like snacks: slowly, and only on the good days.',
  'Monday you shows up so Friday you can vanish.',
  'Never bunk the class right before the exam. Trust.',
  'Two quiet weeks of attending = one peaceful bunk.',
];

function dailyPick(list, offset = 0) {
  const d = new Date();
  const dayIndex = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
  return list[(dayIndex + offset) % list.length];
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
function pctStatus(p, tgt) {
  tgt = tgt ?? globalTarget;
  if (p >= tgt) return { cls: 'good', label: 'On track' };
  if (p >= tgt - 15) return { cls: 'warn', label: 'Below target' };
  return { cls: 'danger', label: 'At risk' };
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
//  SIDEBAR
// ══════════════════════════════════════════════════════
function toggleSidebar() {
  const open = document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('mob-menu')?.setAttribute('aria-expanded', String(open));
}
function renderNav() {
  document.getElementById('global-target').value = globalTarget;
  document.getElementById('nav-subjects').innerHTML = subjects.map((s, i) => {
    const p = pct(s), tgt = getTarget(s), risk = p < tgt;
    const active = currPage === 'subject' && currSubjId === s.id ? ' active' : '';
    const st = pctStatus(p, tgt).cls;
    return `<button class="nav-item${active}" id="nav-s-${s.id}" onclick="goPage('subject','${s.id}')">
      <span class="nav-dot" style="background:${subjTheme(i).c}"></span>
      <span class="nav-text">${escapeHTML(s.name)}</span>
      <span class="${risk ? 'nav-risk' : 'nav-safe'} nav-pct ${st}">${p}%</span>
    </button>`;
  }).join('');
  renderWisdom();
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
  document.getElementById('home-sub').textContent = now.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

  closeAllPopovers();
  renderHomeToday();
  renderStreak();

  if (!subjects.length) {
    document.getElementById('stats-grid').innerHTML = '';
    document.getElementById('verdict-wrap').innerHTML = '';
    document.getElementById('subject-cards').innerHTML = `
      <div class="empty">
        <img class="empty-illus" src="assets/cat-peek.svg" alt="">
        <h3>No subjects yet</h3>
        <p>Add your subjects to find out if you're cooked.</p>
        <button class="btn-pri" onclick="openAddModal()">${ic('plus','ic-sm')} Add Subject</button>
      </div>`;
    document.getElementById('bar-chart').innerHTML = '<div class="empty" style="padding:20px;width:100%"><p style="margin:0">Your class history will show up here.</p></div>';
    document.getElementById('quick-view').innerHTML = '<div class="empty" style="padding:20px"><p style="margin:0">Nothing to glance at yet.</p></div>';
    return;
  }
 
  const total = subjects.reduce((a,s)=>a+s.total,0);
  const present = subjects.reduce((a,s)=>a+s.present,0);
  const ov = attPct(present, total);
  const safeBunks = subjects.reduce((a,s)=>a+bunkable(s),0);
  const atRisk = subjects.filter(s=>pct(s)<getTarget(s));
  const bestBunk = [...subjects].sort((a,b)=>bunkable(b)-bunkable(a))[0];
  const hasBest = bestBunk && bunkable(bestBunk) > 0;
  const ovCls = pctStatus(ov, globalTarget).cls;

  document.getElementById('stats-grid').innerHTML = `
    <div class="sc tone-${ovCls === 'good' ? 'green' : ovCls === 'warn' ? 'amber' : 'pink'}">
      <div class="sc-top"><span class="sc-chip ${ovCls === 'good' ? 'green' : ovCls === 'warn' ? 'amber' : 'pink'}">${ic('trend','ic-sm')}</span><span class="sc-lbl">Overall attendance</span><span class="sc-chip soft indigo sc-end">${ic('chart','ic-sm')}</span></div>
      <div class="sc-val" style="color:${pctTextColor(ov)}">${ov}<span class="unit">%</span></div>
      <div class="sc-sub">target: ${globalTarget}% · ${present}/${total} classes</div>
    </div>
    <button class="sc tone-green" id="safe-card" onclick="openSafeBunks()" aria-haspopup="dialog">
      <span class="sc-top"><span class="sc-chip green">${ic('coffee','ic-sm')}</span><span class="sc-lbl">Safe bunks</span><span class="sc-go">${ic('chevron-right','ic-sm')}</span></span>
      <span class="sc-val" style="color:${safeBunks>0?'var(--good)':'var(--danger)'}">${safeBunks}</span>
      <span class="sc-sub">${safeBunks>0?'go ahead, skip something':'you are cooked. attend.'}</span>
    </button>
    <button class="sc tone-pink" onclick="openCooked()" title="Open Am I Cooked?">
      <span class="sc-top"><span class="sc-chip pink">${ic('alert','ic-sm')}</span><span class="sc-lbl">At risk</span><span class="sc-go">${ic('chevron-right','ic-sm')}</span></span>
      <span class="sc-val" style="color:${atRisk.length>0?'var(--danger)':'var(--good)'}">${atRisk.length}</span>
      <span class="sc-sub sc-clip">${atRisk.length>0?escapeHTML(atRisk.map(s=>s.name).join(', ')):'all subjects safe ✓'}</span>
    </button>
    <${hasBest ? `button onclick="goPage('subject','${bestBunk.id}')"` : 'div'} class="sc tone-blue">
      <span class="sc-top"><span class="sc-chip blue">${ic('star','ic-sm')}</span><span class="sc-lbl">Best to bunk</span>${hasBest ? `<span class="sc-go">${ic('chevron-right','ic-sm')}</span>` : ''}</span>
      <span class="sc-val sc-val-text" title="${hasBest ? escapeHTML(bestBunk.name) : ''}">${hasBest ? escapeHTML(bestBunk.name) : '—'}</span>
      <span class="sc-sub">${hasBest ? bunkable(bestBunk)+' bunk'+(bunkable(bestBunk)!==1?'s':'')+' left' : 'nowhere is safe rn'}</span>
    </${hasBest ? 'button' : 'div'}>
  `;
 
  renderVerdictCard(ov, atRisk, safeBunks);
 
  document.getElementById('subject-cards').innerHTML = subjects.map((s,i) => {
    const p = pct(s), tgt = getTarget(s), bk = bunkable(s);
    const risk = p < tgt;
    const st = pctStatus(p, tgt);
    return `<button class="subj-card ${risk?'at-risk':'safe-zone'}" onclick="goPage('subject','${s.id}')">
      <span class="subj-avatar" style="background:${subjTheme(i).c}" aria-hidden="true">${escapeHTML((s.name || '?').trim().charAt(0))}</span>
      <span class="subj-card-main">
        <span class="subj-card-name">${escapeHTML(s.name)}</span>
        <span class="subj-card-roast">${getRoast(p, tgt, subjRoastSeed(s))}</span>
        <span class="subj-bar"><span class="subj-bar-fill" style="width:${Math.min(100,p)}%;background:${pctColor(p, tgt)}"></span><span class="subj-bar-target" style="left:${Math.min(100,tgt)}%" title="Target ${tgt}%"></span></span>
      </span>
      <span class="subj-card-right">
        <span class="subj-card-pct" style="color:${pctTextColor(p, tgt)}">${p}%</span>
        <span class="status-pill ${st.cls}">${st.label}</span>
        <span class="subj-card-bunk">${bk>0?`${bk} bunk${bk!==1?'s':''} left`:(risk?(isFinite(needed(s))?`need ${needed(s)} more`:'can\'t reach target'):'0 bunks left')}</span>
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
 
  document.getElementById('quick-view').innerHTML = subjects.map((s,i) => {
    const p = pct(s), tgt = getTarget(s);
    return `<button class="qv-row" onclick="goPage('subject','${s.id}')">
      <span class="qv-dot" style="background:${subjTheme(i).c}"></span>
      <span class="qv-name">${escapeHTML(s.name)}</span>
      <span class="qv-bar"><span style="width:${Math.min(100,p)}%;background:${pctColor(p, tgt)}"></span></span>
      <span class="qv-pct" style="color:${pctTextColor(p, tgt)}">${p}%</span>
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
  const flip = below < ph + 20 && above > below;
  pop.classList.toggle('above', flip);
  pop.style.left = (leftVp - h.left) + 'px';
  pop.style.top = (flip ? a.top - h.top - ph - 10 : a.bottom - h.top + 10) + 'px';
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
  if (total > 5) { title = `${total} safe bunks. Go touch grass.`; cls = 'var(--good)'; cat = 'cat-happy'; }
  else if (total > 0) { title = `${total} safe bunk${total !== 1 ? 's' : ''}. Spend wisely.`; cls = 'var(--warn)'; cat = 'cat-laptop'; }
  else { title = 'Zero safe bunks. Attend.'; cls = 'var(--danger)'; cat = 'cat-worried'; }

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

// ── Check-in history ──
// Existing storage only keeps `streak` + `lastCheck`. By construction of checkIn(),
// a streak of N means N consecutive check-ins ending on lastCheck, so that range is
// exact history. New check-ins are appended from here on (dates are UTC keys, as in checkIn).
function utcDayKey(d) { return d.toISOString().split('T')[0]; }
function shiftDayKey(key, n) { const d = new Date(key + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return utcDayKey(d); }
function getCheckinHistory() {
  let hist = null;
  try { hist = JSON.parse(localStorage.getItem('bk_checkins') || 'null'); } catch (e) { hist = null; }
  if (!Array.isArray(hist)) {
    hist = [];
    if (lastCheck && streak > 0) for (let i = 0; i < streak; i++) hist.push(shiftDayKey(lastCheck, -i));
    try { localStorage.setItem('bk_checkins', JSON.stringify(hist)); } catch (e) {}
  }
  return [...new Set(hist.filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)))].sort();
}
function recordCheckin(key) {
  const hist = getCheckinHistory();
  if (!hist.includes(key)) hist.push(key);
  try { localStorage.setItem('bk_checkins', JSON.stringify(hist.sort())); } catch (e) {}
}
function activeStreak() {
  const today = utcDayKey(new Date());
  return (lastCheck === today || lastCheck === shiftDayKey(today, -1)) ? streak : 0;
}
function bestStreak(hist) {
  let best = 0, run = 0, prev = null;
  hist.forEach(k => { run = prev && shiftDayKey(prev, 1) === k ? run + 1 : 1; best = Math.max(best, run); prev = k; });
  return Math.max(best, activeStreak());
}

let calMonth = null; // { y, m }
function openStreakCalendar(e) {
  if (e && e.target.closest('.checkin-btn')) return;
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
    cells += `<span class="cal-cell${hit ? ' hit' : ''}${isToday ? ' today' : ''}" ${hit ? `title="Checked in"` : ''}>${hit ? `<span class="cal-flame" aria-hidden="true">${ic('fire-solid')}</span>` : ''}<span class="cal-d">${d}</span>${hit ? '<span class="sr-only">checked in</span>' : ''}</span>`;
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
    <div class="cal-grid" role="grid" aria-label="${monthName} check-ins">
      ${['M','T','W','T','F','S','S'].map(w => `<span class="cal-wd">${w}</span>`).join('')}
      ${cells}
    </div>
    ${hist.length ? '' : '<p class="pop-meta">No check-ins recorded yet — tap “Check in” to start your streak.</p>'}
    <div class="pop-foot"><span>Current <strong>${cur}</strong></span><span>Best <strong>${best}</strong></span><span>This month <strong>${monthCount}</strong></span></div>
  `;
}

// Read-only list of today's schedule; marking happens on Daily Classes.
function renderHomeToday() {
  const box = document.getElementById('home-today');
  if (!box) return;
  const todayStr = getLocalDateString();

  if (dateExceptions[todayStr]?.type === 'holiday') {
    box.innerHTML = `<div class="today-note"><img src="assets/cat-books.svg" alt=""><div><strong>Holiday today 🏖️</strong><br>No classes count today. Enjoy!</div></div>`;
    return;
  }

  const classes = [...getScheduledClassesForDate(todayStr), ...getExtraClassesForDate(todayStr)];

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
  const marked = classes.filter(c => STATES[c.status]).length;
  const shown = classes.slice(0, 6);
  box.innerHTML = `<div class="tl-progress"><span class="tl-progress-bar"><span style="width:${Math.round(marked / classes.length * 100)}%"></span></span><span>${marked}/${classes.length} marked</span></div>
  <ol class="timeline">${shown.map(c => {
    const s = subjects.find(x => x.id === c.subjectId);
    const name = s ? s.name : c.subjectName;
    const time = c.startTime ? (c.endTime ? `${c.startTime} – ${c.endTime}` : c.startTime) : (c.isExtra ? 'Extra class' : `Period ${c.period}`);
    const st = STATES[c.status];
    return `<li class="tl-row ${st ? 'is-' + st.cls : 'is-pending'}">
      <span class="tl-dot" aria-hidden="true">${st && st.icon ? ic(st.icon, 'ic-xs') : ''}</span>
      <span class="tl-body"><span class="tl-name">${escapeHTML(name)}</span><span class="tl-time">${escapeHTML(time)}${c.isExtra && c.startTime ? ' · Extra' : ''}</span></span>
      <span class="tl-state">${st ? st.label : 'Not marked'}</span>
    </li>`;
  }).join('')}</ol>${classes.length > shown.length ? `<div class="today-more">+${classes.length - shown.length} more</div>` : ''}`;
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
      <img class="verdict-illus" src="assets/${cls === 'cooked' ? 'cat-worried' : cls === 'safe' ? 'cat-happy' : 'cat-books'}.svg" alt="">
      <span class="verdict-tap">Am I Cooked? ${ic('arrow-right','ic-sm')}</span>
    </button>`;
}
 
// ══════════════════════════════════════════════════════
//  STREAK
// ══════════════════════════════════════════════════════
function renderStreak() {
  const today = new Date().toISOString().split('T')[0];
  const checked = lastCheck === today;
  const examDays = daysUntil(examDate);
  const cur = activeStreak();
  closePopover('streak-pop', false);

  document.getElementById('streak-row').innerHTML = `
    <div class="streak-card" id="streak-card" role="button" tabindex="0" aria-haspopup="dialog" aria-expanded="false" aria-controls="streak-pop"
         aria-label="View your check-in calendar" onclick="openStreakCalendar(event)" onkeydown="if((event.key==='Enter'||event.key===' ')&&event.target===this){event.preventDefault();openStreakCalendar(event)}">
      <div class="streak-icon" aria-hidden="true">🔥</div>
      <div class="streak-info">
        <div class="streak-num">${cur}<small>day streak</small></div>
        <div class="streak-lbl">${examDate ? `🎓 Exam in <strong style="color:${examDays<=7?'var(--danger)':'inherit'}">${examDays}</strong> days · ` : ''}<span class="streak-link">View calendar</span></div>
      </div>
      <button class="checkin-btn ${checked?'checked':''}" ${checked ? 'disabled' : 'onclick="event.stopPropagation(); checkIn()"'}>
        ${checked ? '✓ Checked in' : 'Check in 👀'}
      </button>
    </div>
  `;
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

function checkIn() {
  const today = new Date().toISOString().split('T')[0];
  if (lastCheck !== today) {
    const yesterday = new Date(Date.now()-864e5).toISOString().split('T')[0];
    getCheckinHistory(); // seed from the pre-existing streak before it changes
    streak = lastCheck === yesterday ? streak + 1 : 1;
    lastCheck = today;
    savePrefs();
    recordCheckin(today);
    renderStreak();
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
  const ov = attPct(present, total);
  const atRisk = subjects.filter(s=>pct(s)<getTarget(s));
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
  if (ckCat) ckCat.src = `assets/${atRisk.length > 0 ? 'cat-worried' : (safeBunks > 5 ? 'cat-happy' : 'cat-books')}.svg`;
  document.getElementById('ck-verdict').innerHTML = `<span style="${cls}">${verdict}</span>`;
  document.getElementById('ck-msg').textContent = msg;
  document.getElementById('ck-breakdown').innerHTML = subjects.map((s,i) => {
    const p = pct(s), tgt = getTarget(s), bk = bunkable(s), col = pctColor(p, tgt);
    const status = p >= tgt ? (bk > 3 ? '😎 safe' : '🤏 tight') : (isFinite(needed(s)) ? `💀 -${needed(s)} needed` : '💀 out of reach');
    return `<div class="cooked-row">
      <span class="cooked-dot" style="background:${subjTheme(i).c}"></span>
      <span class="subj-n">${escapeHTML(s.name)}</span>
      <span class="subj-p" style="color:${pctTextColor(p, tgt)}">${p}%</span>
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
  document.getElementById('sp-roast').textContent = getRoast(p, tgt, subjRoastSeed(s));
  document.getElementById('mode-label').innerHTML = s.mode==='estimate'
    ? `<span class="mode-tag est">📡 Estimated</span>`
    : `<span class="mode-tag exact">🎯 Exact</span>`;
 
  // Circle
  const r = 64, circ = 2*Math.PI*r;
  const fill = document.getElementById('circ-fill');
  fill.style.stroke = col;
  fill.style.strokeDasharray = circ;
  fill.style.strokeDashoffset = circ - Math.min(100, p)/100*circ;
  document.getElementById('circ-pct').textContent = p + '%';
  document.getElementById('circ-pct').style.color = pctTextColor(p, tgt);

  // Subject theme (decorative)
  const th = subjTheme(subjects.indexOf(s));
  const spIcon = document.getElementById('sp-icon');
  if (spIcon) { spIcon.innerHTML = ic(subjIcon(s.name)); spIcon.style.background = th.bg; spIcon.style.color = th.c; }
  const spCat = document.getElementById('sp-cat');
  if (spCat) spCat.src = `assets/${p >= tgt ? (bk > 3 ? 'cat-happy' : 'cat-laptop') : 'cat-worried'}.svg`;
  const hero = document.getElementById('sp-hero');
  if (hero) hero.style.setProperty('--hero-tint', th.bg);

  // Chips
  document.getElementById('sp-chips').innerHTML = `
    <div class="chip indigo"><label>${ic('calendar','ic-sm')} Total</label><div class="cv">${s.total}</div></div>
    <div class="chip green"><label>${ic('check','ic-sm')} Present</label><div class="cv">${s.present}</div></div>
    <div class="chip pink"><label>${ic('x','ic-sm')} Absent</label><div class="cv">${s.total-s.present}</div></div>
    <div class="chip amber"><label>${ic('target','ic-sm')} Target</label><div class="cv">${tgt}%</div></div>
  `;
 
  // Advice
  let pills = '', advText = '';
  if (p >= tgt && bk > 0) {
    pills = Array.from({length:Math.min(bk,5)},(_,j)=>`<span class="pill">Skip ${j+1}</span>`).join('');
    if (bk>5) pills += `<span class="pill">+${bk-5} more</span>`;
    const wk = s.perWeek > 0 ? ` (~${(bk/s.perWeek).toFixed(1)} weeks worth)` : '';
    advText = `You can skip <strong>${bk} more class${bk!==1?'es':''}</strong> in ${escapeHTML(s.name)} before hitting ${tgt}%${wk}. Space them out — don\'t bunk 2 in a row.`;
  } else if (p < tgt) {
    pills = `<span class="pill d">💀 Below ${tgt}%</span>`;
    const wk = s.perWeek > 0 ? ` That's about ${Math.ceil(nd/s.perWeek)} weeks of showing up.` : '';
    advText = isFinite(nd)
      ? `You need <strong>${nd} consecutive classes</strong> just to reach ${tgt}%.${wk} No bunks. None. Zero. Go.`
      : `A ${tgt}% target can't be reached once a class is missed. Try a lower target for this subject.`;
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
      <input type="text" id="inp-subject-name" placeholder="e.g. Mathematics" value="${escapeHTML(s.name)}">
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
    const absent = Math.max(0, parseInt(document.getElementById('inp-est-absent').value)||0);
    const tRaw = document.getElementById('inp-est-target').value;
    const newSem = document.getElementById('inp-semstart').value;
    if (newSem) { semStart = newSem; savePrefs(); }

    const semTotalRaw = document.getElementById('inp-est-semtotal').value;
    const semTotalVal = semTotalRaw ? (Math.max(0, parseInt(semTotalRaw)) || null) : null;

    const total = estimateTotal(pw);

    s.total = total; 
    s.present = Math.max(0, total-absent);
    s.perWeek = pw; 
    s.target = tRaw ? Math.max(1,Math.min(100,parseInt(tRaw)||globalTarget)) : null;
    s.semTotal = semTotalVal;
    s.mode = 'estimate';

  } else {
    const t = Math.max(0, parseInt(document.getElementById('inp-total').value)||0);
    const pr = Math.max(0, parseInt(document.getElementById('inp-present').value)||0);
    const pw = Math.max(0, parseInt(document.getElementById('inp-perweek').value)||0);
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
    <strong style="color:var(--text);font-size:1rem">${escapeHTML(s.name)}</strong><br>
    <span style="font-weight:600;color:${pctTextColor(p,tgt)}">${p}% attendance</span><br>
    <span style="font-size:.8125rem;color:var(--text2);margin-top:8px;display:inline-block">This will also delete all tracker history for this subject.</span>
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
  const projPct = attPct(s.present, projTotal);
  const drop = _sp - projPct;
  const safe = projPct >= tgt;
  const bk_now = Math.max(0, Math.floor(s.present*100/tgt) - s.total);
 
  if (plan === 0) {
    const remaining = (s.semTotal && s.semTotal > s.total) ? s.semTotal - s.total : null;
    let h = bk_now > 0
      ? 'Can safely skip <strong>' + bk_now + '</strong> more.' + (pw>0 ? ' ~' + (bk_now/pw).toFixed(1) + ' weeks worth.' : '')
      : 'Zero safe bunks. Right at the limit.';
    if (remaining !== null) {
      const projEndTotal = s.total + remaining;
      const projEndPct = attPct(s.present, projEndTotal);
      h += ' If you attend all <strong>' + remaining + '</strong> remaining classes, you end the semester at <strong style="color:' + pctTextColor(projEndPct, tgt) + '">' + projEndPct + '%</strong>.';
    }
    document.getElementById('sim-result').innerHTML = '<div class="adv-text" style="color:var(--muted)">' + h + '</div>';
    return;
  }
 
  const wkCtx = pw > 0 ? ` (${(plan/pw).toFixed(1)}w)` : '';
  const extraNd = safe ? 0 : needed({total:projTotal,present:s.present}, tgt);
  const recovCtx = !safe && !isFinite(extraNd) ? ` A ${tgt}% target can't be recovered after a bunk.`
    : !safe && extraNd > 0
    ? pw > 0 ? ` Need <strong>${extraNd} straight classes</strong> to recover — ~${Math.ceil(extraNd/pw)} weeks.`
             : ` Need <strong>${extraNd} consecutive</strong> to recover.`
    : '';
 
  const reaction = getSimReaction(plan, bk_now, safe, projPct, tgt, subjRoastSeed(s));
 
  // End-of-semester projection if semTotal is set
  let eosCtx = '';
  if (s.semTotal && s.semTotal > s.total) {
    const remainAfterBunks = Math.max(0, s.semTotal - s.total - plan);
    const eosTotal = s.total + plan + remainAfterBunks;
    const eosPct = attPct(s.present, eosTotal);
    eosCtx = ' End of sem: <strong style="color:' + pctTextColor(eosPct, tgt) + '">' + eosPct + '%</strong>.';
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
    const target = tRaw ? Math.max(1, Math.min(100, parseInt(tRaw) || globalTarget)) : null;

    let total, present, perWeek, mode;
    let semTotalAdd = null;

    if (addMode === 'estimate') {
      perWeek = Math.max(1, parseInt(document.getElementById('as-pw').value) || 3);
      const missed = Math.max(0, parseInt(document.getElementById('as-missed').value) || 0);
      
      // ✅ ADDED: Get semester start date from modal
      const modalSemStart = document.getElementById('as-semstart').value;
      
      // ✅ ADDED: Save to localStorage if provided
      if (modalSemStart) {
        localStorage.setItem('bk_sem_start', modalSemStart);
        semStart = modalSemStart; // Update global variable
      }
      
      const stRaw = document.getElementById('as-semtotal').value;
      semTotalAdd = stRaw ? (Math.max(0, parseInt(stRaw)) || null) : null;
      
      // ✅ FIXED: Calculate total AFTER setting semStart
      total = estimateTotal(perWeek);
      present = Math.max(0, total - missed);
      mode = 'estimate';
      
      // ✅ ADDED: Debug logging
      console.log('Estimate Mode - Missed:', missed, 'Total:', total, 'Present:', present, 'PerWeek:', perWeek);

    } else {
      total = Math.max(0, parseInt(document.getElementById('as-total').value) || 0);
      present = Math.max(0, parseInt(document.getElementById('as-present').value) || 0);
      perWeek = Math.max(0, parseInt(document.getElementById('as-perweek').value) || 3);
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
document.getElementById('safe-overlay').addEventListener('click', e => { if(e.target===e.currentTarget) closeSafeBunks(); });
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

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
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

  const subjName = prompt('Create new subject in BunkKro:', rawName || 'New Subject');
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
        <img class="empty-illus" src="assets/cat-happy.svg" alt="">
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
        <p>Upload your timetable screenshot above, or add class periods by hand.</p>
        <button class="btn-pri" onclick="openAddSlotModal(1, 1)">${ic('plus','ic-sm')} Add first class</button>
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
    if (marked.length) {
      if (!confirm(`${marked.length} class${marked.length !== 1 ? 'es are' : ' is'} already marked on this day. Marking it a holiday will clear ${marked.length !== 1 ? 'those marks' : 'that mark'}. Continue?`)) return;
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
  const logs = dailyPeriodLogs[date] || {};
  const touched = new Set();
  let ok = true;
  for (const [entryId, log] of Object.entries(logs)) {
    const { error } = await supabaseClient
      .from('daily_period_logs')
      .delete()
      .eq('user_id', currentUser.id)
      .eq('date', date)
      .eq('entry_id', entryId);
    if (error) { console.warn('Clear mark failed:', error); ok = false; break; }
    const subj = subjects.find(x => x.id === log.subjectId);
    if (subj && (log.status === 'p' || log.status === 'a')) {
      subj.total = Math.max(0, subj.total - 1);
      if (log.status === 'p') subj.present = Math.max(0, subj.present - 1);
      touched.add(subj);
    }
    delete logs[entryId];
    localStorage.setItem('bk_daily_period_logs_' + currentUser.id, JSON.stringify(dailyPeriodLogs));
  }
  // Save totals for every mark already removed, even if a later one failed
  for (const subj of touched) await updateSubject(subj.id, { total: subj.total, present: subj.present });
  return ok;
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
    } else if (isToday) {
      banner.className = 'date-status-banner today';
      banner.innerHTML = `${ic('zap')} <span><strong>Today's classes</strong> — mark each period as you attend or bunk.</span>`;
      banner.style.display = 'flex';
    } else {
      banner.className = 'date-status-banner future';
      banner.innerHTML = `${ic('calendar')} <span>Viewing schedule for <strong>${formattedDate}</strong></span>`;
      banner.style.display = 'flex';
    }
  }

  // Get scheduled timetable classes for this day
  const scheduledClasses = getScheduledClassesForDate(selectedTrackerDate);

  // Include any extra ad-hoc classes logged for this date
  const extraClasses = getExtraClassesForDate(selectedTrackerDate);

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
        <img class="daily-summary-illus" src="assets/${isHoliday ? 'cat-books' : allDone ? 'cat-happy' : totalCount === 0 ? 'cat-books' : markedCount === 0 ? 'cat-peek' : 'cat-laptop'}.svg" alt="">
      </div>
    `;
  }

  // If holiday
  if (isHoliday) {
    content.innerHTML = `
      <div class="card empty">
        <img class="empty-illus" src="assets/cat-books.svg" alt="">
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
            <span class="period-badge">${item.isExtra ? 'Extra' : `Period ${item.period}`}</span>
            ${timeDisplay ? `<span class="time-badge">${ic('clock','ic-sm')} ${escapeHTML(timeDisplay)}</span>` : ''}
            ${item.status === 'cancelled' ? '<span class="status-pill warn">Cancelled · no penalty</span>' : ''}
          </div>
          <div class="daily-class-name">${escapeHTML(displayName)}</div>
          ${s ? `<div class="daily-class-stats"><span class="dc-bar"><span style="width:${Math.min(100, pct(s))}%;background:${pctColor(pct(s))}"></span></span><strong style="color:${pctTextColor(pct(s))}">${pct(s)}%</strong> <span>(${s.present}/${s.total}) · ${bunkable(s)} safe bunks</span></div>` : '<div class="daily-class-stats" style="color:var(--muted)">Unmapped subject</div>'}
        </div>
        <div class="tracker-btns" role="group" aria-label="Attendance for ${escapeHTML(displayName)}">
          <button class="tbtn p ${item.status === 'p' ? 'on' : ''}" aria-pressed="${item.status === 'p'}" onclick="markPeriodAttendance('${item.slotId}', '${item.subjectId || ''}', 'p', ${item.period}, ${item.isExtra})">${ic('check','ic-sm')} Present</button>
          <button class="tbtn a ${item.status === 'a' ? 'on' : ''}" aria-pressed="${item.status === 'a'}" onclick="markPeriodAttendance('${item.slotId}', '${item.subjectId || ''}', 'a', ${item.period}, ${item.isExtra})">${ic('x','ic-sm')} Absent</button>
          <button class="tbtn c ${item.status === 'cancelled' ? 'on' : ''}" aria-pressed="${item.status === 'cancelled'}" title="Cancelled class does not count as absence" onclick="markPeriodAttendance('${item.slotId}', '${item.subjectId || ''}', 'cancelled', ${item.period}, ${item.isExtra})">${ic('ban','ic-sm')} Cancel</button>
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
    const touched = new Set();
    if (prevSubj && (prevStatus === 'p' || prevStatus === 'a')) {
      prevSubj.total = Math.max(0, prevSubj.total - 1);
      if (prevStatus === 'p') prevSubj.present = Math.max(0, prevSubj.present - 1);
      touched.add(prevSubj);
    }
    if (s && (finalStatus === 'p' || finalStatus === 'a')) {
      s.total += 1;
      if (finalStatus === 'p') s.present += 1;
      touched.add(s);
    }
    for (const subj of touched) await updateSubject(subj.id, { total: subj.total, present: subj.present });

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

  // Increment subject total & present
  s.total += 1;
  s.present += 1;
  await updateSubject(s.id, { total: s.total, present: s.present });

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