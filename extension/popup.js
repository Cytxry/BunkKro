const SUPABASE_URL = 'https://mvlyeygitnnuksuxmcsy.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_OrUBxAQ1tk1wqI6HQ7SIPA_bYwohXlf';
const APP_URL = 'https://bunkkro.vercel.app';

let supabaseClient;
let currentUser = null;
let subjects = [];
let trackerLog = {};
let globalSession = null;

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

    // Load subjects
    const { data: subjectsData, error: subjectsError } = await supabaseClient
      .from('subjects')
      .select('*')
      .eq('user_id', currentUser.id);

    if (subjectsError) throw subjectsError;

    subjects = subjectsData || [];
    
    // Load today's tracker log
    const today = new Date().toISOString().split('T')[0];
    const { data: trackerData, error: trackerError } = await supabaseClient
      .from('tracker_logs')
      .select('*')
      .eq('user_id', currentUser.id)
      .eq('date', today);
    
    if (trackerError) throw trackerError;
    
    // Build tracker log map
    trackerLog = {};
    (trackerData || []).forEach(log => {
      trackerLog[log.subject_id] = log.status;
    });

    renderSubjects();
    show('content');

  } catch (error) {
    console.error('Load error:', error);
    showError();
  }
}

function renderSubjects() {
  const list = document.getElementById('subjects-list');
  
  if (!subjects.length) {
    list.innerHTML = `
      <div class="empty-state">
        <h3>No subjects yet</h3>
        <p>Add subjects in the app first</p>
      </div>
    `;
    return;
  }
  
  const today = new Date().toISOString().split('T')[0];
  
  list.innerHTML = subjects.map(s => {
    const pct = s.total > 0 ? Math.round((s.present / s.total) * 100) : 0;
    const target = s.target || 75;
    const pctClass = pct >= target ? 'safe' : pct >= target - 15 ? 'warn' : 'danger';
    const status = trackerLog[s.id] || null;
    
    return `
      <div class="subject-item">
        <div class="subject-header">
          <span class="subject-name">${s.name}</span>
          <span class="subject-pct ${pctClass}">${pct}%</span>
        </div>
        <div class="tracker-btns">
          <button class="present ${status === 'p' ? 'active' : ''}" data-id="${s.id}" data-status="p">
            ${status === 'p' ? '✓ Present' : 'Present'}
          </button>
          <button class="absent ${status === 'a' ? 'active' : ''}" data-id="${s.id}" data-status="a">
            ${status === 'a' ? '✗ Absent' : 'Absent'}
          </button>
        </div>
      </div>
    `;
  }).join('');
  
  // Add event listeners
  document.querySelectorAll('.tracker-btns button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const subjId = e.target.dataset.id;
      const status = e.target.dataset.status;
      markAttendance(subjId, status);
    });
  });
}

async function markAttendance(subjId, status) {
  if (!currentUser || !globalSession) {
    alert('Session expired. Please open the app and login again.');
    return;
  }
  
  const today = new Date().toISOString().split('T')[0];
  const s = subjects.find(x => x.id === subjId);
  if (!s) return;
  
  const prev = trackerLog[subjId];
  
  try {
    // Toggle off if same status
    if (prev === status) {
      delete trackerLog[subjId];
      
      const { error: deleteError } = await supabaseClient
        .from('tracker_logs')
        .delete()
        .eq('user_id', currentUser.id)
        .eq('date', today)
        .eq('subject_id', subjId);
      
      if (deleteError) throw deleteError;
      
      if (prev === 'p') s.present = Math.max(0, s.present - 1);
      s.total = Math.max(0, s.total - 1);
      
    } else {
      // Update counts
      if (prev === 'p') s.present = Math.max(0, s.present - 1);
      if (prev) s.total = Math.max(0, s.total - 1);
      
      trackerLog[subjId] = status;
      s.total += 1;
      if (status === 'p') s.present += 1;
      
      const { error: upsertError } = await supabaseClient
        .from('tracker_logs')
        .upsert({
          user_id: currentUser.id,
          date: today,
          subject_id: subjId,
          status: status
        }, {
          onConflict: 'user_id,date,subject_id'
        });
      
      if (upsertError) throw upsertError;
    }
    
    // Update subject
    const { error: updateError } = await supabaseClient
      .from('subjects')
      .update({
        total: s.total,
        present: s.present
      })
      .eq('id', subjId)
      .eq('user_id', currentUser.id);
    
    if (updateError) throw updateError;
    
    renderSubjects();
    
  } catch (error) {
    console.error('Mark attendance error:', error);
    alert('Failed to update attendance: ' + error.message);
  }
}

function show(section) {
  ['loading', 'error', 'not-logged-in', 'content'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  document.getElementById(section).style.display = section === 'content' ? 'block' : 'flex';
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