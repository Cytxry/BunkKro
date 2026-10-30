const SUPABASE_URL = 'https://mvlyeygitnnuksuxmcsy.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_OrUBxAQ1tk1wqI6HQ7SIPA_bYwohXlf';
const APP_URL = 'https://bunkkro.vercel.app';

let supabaseClient;
let currentUser = null;
let subjects = [];
let timetableEntries = [];
let dailyPeriodLogs = {};
let globalSession = null;
let todayException = null; // holiday / makeup classes / swapped timetable for today

function escapeHTML(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Rounded down, like the web app: 74.6% must not read as a met 75% target.
function attPct(present, total) { return total > 0 ? Math.floor(present * 100 / total) : 0; }

function getLocalDateString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  console.log('Extension popup loaded');
  
  // Setup button handlers
  document.getElementById('open-app').addEventListener('click', () => {
    chrome.tabs.create({ url: APP_URL });
  });
  
  document.getElementById('open-login').addEventListener('click', () => {
    chrome.tabs.create({ url: APP_URL });
  });
  
  // Initialize Supabase
  try {
    if (typeof supabase === 'undefined') {
      throw new Error('Supabase library not loaded');
    }
    
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log('Supabase initialized');
    
    await loadData();
  } catch (error) {
    console.error('Initialization error:', error);
    showError();
  }
});

async function loadData() {
  try {
    show('loading');

    const session = await getSession();
    globalSession = session;

    if (!session || !session.user) {
      console.log('No active session found');
      show('not-logged-in');
      return;
    }

    // Set session in Supabase client
    await supabaseClient.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token
    });

    currentUser = session.user;
    console.log('User logged in:', currentUser.id);

    // 1. Load subjects
    const { data: subjectsData, error: subjectsError } = await supabaseClient
      .from('subjects')
      .select('*')
      .eq('user_id', currentUser.id);

    if (subjectsError) throw subjectsError;
    subjects = subjectsData || [];

    // 2. Load timetable entries
    const { data: ttData, error: ttError } = await supabaseClient
      .from('timetable_entries')
      .select('*')
      .eq('user_id', currentUser.id);

    timetableEntries = ttData || [];

    // 3. Load today's attendance logs
    const today = getLocalDateString();
    
    dailyPeriodLogs = {};
    const { data: logsData, error: logsError } = await supabaseClient
      .from('daily_period_logs')
      .select('*')
      .eq('user_id', currentUser.id)
      .eq('date', today);

    const { data: exData } = await supabaseClient
      .from('timetable_exceptions')
      .select('*')
      .eq('user_id', currentUser.id)
      .eq('date', today);
    todayException = (exData && exData[0]) || null;

    if (!logsError && logsData) {
      logsData.forEach(row => {
        const key = row.entry_id || row.subject_id;
        dailyPeriodLogs[key] = row.status;
      });
    }

    renderTodayClasses();
    show('content');

  } catch (error) {
    console.error('Load error:', error);
    showError();
  }
}

function getTodayDayOfWeek() {
  const d = new Date();
  const day = d.getDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
  return day === 0 ? 7 : day;
}

// Same format the web app writes: { follows: 1-7|null, makeups: [{ id, subjectId, name, time }] }
function todayPlan() {
  if (!todayException || todayException.type !== 'custom_day') return { follows: null, makeups: [] };
  let raw = {};
  try { raw = JSON.parse(todayException.note || '{}') || {}; } catch { raw = {}; }
  const follows = Number.isInteger(raw.follows) && raw.follows >= 1 && raw.follows <= 7 ? raw.follows : null;
  const makeups = (Array.isArray(raw.makeups) ? raw.makeups : []).filter(m => m && typeof m.id === 'string' && /^[\w-]{1,40}$/.test(m.id));
  return { follows, makeups };
}

function renderTodayClasses() {
  const list = document.getElementById('subjects-list');
  const subText = document.getElementById('today-sub-text');
  const summaryStats = document.getElementById('summary-stats');
  const summaryPct = document.getElementById('summary-pct');
  const summaryFill = document.getElementById('summary-fill');

  const plan = todayPlan();
  const todayDay = plan.follows || getTodayDayOfWeek();
  const isHoliday = todayException?.type === 'holiday';
  const d = new Date();
  const dayName = d.toLocaleDateString('en-IN', { weekday: 'long' });

  // Filter timetable for today
  let todayClasses = isHoliday ? [] : timetableEntries
    .filter(s => s.day_of_week === todayDay && !s.is_break)
    .sort((a, b) => a.period_index - b.period_index);
  if (!isHoliday) {
    plan.makeups.forEach(m => todayClasses.push({
      id: 'makeup_' + m.id, day_of_week: todayDay, period_index: 'M', makeup: true,
      start_time: /^\d{2}:\d{2}$/.test(m.time || '') ? m.time : '', end_time: '',
      subject_id: typeof m.subjectId === 'string' ? m.subjectId : null, subject_name: String(m.name || 'Class'), is_break: false
    }));
  }

  // Only users without any timetable get the "all subjects" fallback; with a
  // timetable, an empty day really has no classes.
  const isFallback = todayClasses.length === 0 && timetableEntries.length === 0 && !isHoliday;
  if (isFallback && subjects.length > 0) {
    todayClasses = subjects.map((s, i) => ({
      id: s.id,
      day_of_week: todayDay,
      period_index: i + 1,
      start_time: '',
      end_time: '',
      subject_id: s.id,
      subject_name: s.name,
      is_break: false
    }));
  }

  const totalClasses = todayClasses.length;
  subText.textContent = `${dayName} · ${totalClasses} class${totalClasses !== 1 ? 'es' : ''}`;

  if (totalClasses === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <img src="img/cat-books.svg" alt="" style="width:140px;margin:0 auto 6px;display:block">
        <h3>${isHoliday ? 'Holiday today 🏖️' : 'No classes scheduled today'}</h3>
        <p style="font-size:12px;color:#5E6375">Open the full app to upload your timetable or view upcoming days.</p>
      </div>
    `;
    summaryStats.textContent = '0 scheduled';
    summaryPct.textContent = '100%';
    summaryFill.style.width = '100%';
    return;
  }

  // Calculate completion
  let markedCount = 0;
  todayClasses.forEach(c => {
    const st = dailyPeriodLogs[c.id];
    if (st) markedCount++;
  });

  const completionPct = Math.round((markedCount / totalClasses) * 100);
  summaryStats.textContent = `${markedCount} of ${totalClasses} marked`;
  summaryPct.textContent = `${completionPct}%`;
  summaryFill.style.width = `${completionPct}%`;

  list.innerHTML = todayClasses.map(c => {
    const s = subjects.find(x => x.id === c.subject_id);
    const displayName = s ? s.name : c.subject_name;
    const pct = s ? attPct(s.present, s.total) : 0;
    const target = s ? (s.target || 75) : 75;
    const pctClass = pct >= target ? 'safe' : pct >= target - 15 ? 'warn' : 'danger';
    const status = dailyPeriodLogs[c.id] || null;
    const timeDisplay = c.start_time ? (c.end_time ? `${c.start_time} - ${c.end_time}` : c.start_time) : '';

    let itemClass = 'class-item';
    if (status === 'p') itemClass += ' marked-p';
    else if (status === 'a') itemClass += ' marked-a';
    else if (status === 'cancelled') itemClass += ' marked-c';

    return `
      <div class="${itemClass}">
        <div class="class-header">
          <span class="class-name">${escapeHTML(displayName)}</span>
          ${s ? `<span class="class-pct ${pctClass}">${pct}%</span>` : ''}
        </div>
        <div class="period-meta">
          <span class="badge-pnum">${c.makeup ? 'Makeup' : 'P' + c.period_index}</span>
          ${timeDisplay ? `<span>🕒 ${escapeHTML(timeDisplay)}</span>` : ''}
          ${s ? `<span>${s.present}/${s.total} attended</span>` : ''}
        </div>
        <div class="tracker-btns">
          <button class="present ${status === 'p' ? 'active' : ''}" data-entry="${c.id}" data-subject="${c.subject_id || ''}" data-period="${c.makeup ? 90 : c.period_index}" data-status="p">
            ${status === 'p' ? '✓ Present' : 'Present'}
          </button>
          <button class="absent ${status === 'a' ? 'active' : ''}" data-entry="${c.id}" data-subject="${c.subject_id || ''}" data-period="${c.makeup ? 90 : c.period_index}" data-status="a">
            ${status === 'a' ? '✗ Absent' : 'Absent'}
          </button>
          <button class="cancel ${status === 'cancelled' ? 'active' : ''}" data-entry="${c.id}" data-subject="${c.subject_id || ''}" data-period="${c.makeup ? 90 : c.period_index}" data-status="cancelled" title="Cancelled (No absence penalty)">
            ${status === 'cancelled' ? '🚫' : 'Cancel'}
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Add click handlers
  document.querySelectorAll('.tracker-btns button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const entryId = e.currentTarget.dataset.entry;
      const subjId = e.currentTarget.dataset.subject;
      const period = parseInt(e.currentTarget.dataset.period) || 1;
      const status = e.currentTarget.dataset.status;
      markPeriodAttendance(entryId, subjId, status, period);
    });
  });
}

let marking = false; // ignore clicks while a mark is being saved (no double counting)
async function markPeriodAttendance(entryId, subjId, newStatus, periodIndex) {
  if (!currentUser || !globalSession) {
    alert('Session expired. Please open the app and login again.');
    return;
  }
  if (marking) return;
  marking = true;

  const today = getLocalDateString();
  const s = subjects.find(x => x.id === subjId);
  const prevStatus = dailyPeriodLogs[entryId] || null;

  try {
    let finalStatus = newStatus;

    if (prevStatus === newStatus) {
      // Toggle off
      finalStatus = null;

      const { error } = await supabaseClient
        .from('daily_period_logs')
        .delete()
        .eq('user_id', currentUser.id)
        .eq('date', today)
        .eq('entry_id', entryId);
      if (error) throw error;
      delete dailyPeriodLogs[entryId];

    } else {
      // Set new
      const { error } = await supabaseClient
        .from('daily_period_logs')
        .upsert({
          user_id: currentUser.id,
          date: today,
          entry_id: entryId,
          subject_id: subjId || null,
          period_index: periodIndex,
          status: newStatus
        }, {
          onConflict: 'user_id,date,entry_id'
        });
      if (error) throw error;
      dailyPeriodLogs[entryId] = newStatus;
    }

    // Sync subject numbers
    if (s) {
      if (prevStatus === 'p') {
        s.present = Math.max(0, s.present - 1);
        s.total = Math.max(0, s.total - 1);
      } else if (prevStatus === 'a') {
        s.total = Math.max(0, s.total - 1);
      }

      if (finalStatus === 'p') {
        s.present += 1;
        s.total += 1;
      } else if (finalStatus === 'a') {
        s.total += 1;
      }

      await supabaseClient
        .from('subjects')
        .update({ total: s.total, present: s.present })
        .eq('id', s.id)
        .eq('user_id', currentUser.id);
    }

    renderTodayClasses();

  } catch (err) {
    console.error('Mark attendance error:', err);
    alert('Failed to update attendance: ' + err.message);
  } finally {
    marking = false;
  }
}

function show(section) {
  ['loading', 'error', 'not-logged-in', 'content'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById(section);
  if (target) target.style.display = section === 'content' ? 'block' : 'flex';
}

function showError() {
  show('error');
}

function getSession() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_SESSION' }, (res) => {
      console.log("[Popup] Session received:", res);
      resolve(res);
    });
  });
}