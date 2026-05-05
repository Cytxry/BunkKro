console.log("🔥 BACKGROUND FILE LOADED");

// ══════════════════════════════════════════════════════
//  CLEAN BACKGROUND SERVICE WORKER
// ══════════════════════════════════════════════════════

console.log('[BunkKro Background] Started');

let cachedSession = null;

// Load session on startup
chrome.storage.local.get('bk_session', (res) => {
  if (res.bk_session) {
    cachedSession = res.bk_session;
    console.log('[Background] ✅ Loaded session from storage');
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Background] Received:', request);

  // 🔥 SAVE SESSION
  if (request.type === 'SET_SESSION') {
    cachedSession = request.session;

    chrome.storage.local.set({ bk_session: request.session }, () => {
      console.log('[Background] ✅ Session stored');
      sendResponse({ ok: true });
    });

    return true;
  }

  // 🔥 GET SESSION
  if (request.type === 'GET_SESSION') {
    if (cachedSession) {
      console.log('[Background] Returning cached session');
      sendResponse(cachedSession);
    } else {
      chrome.storage.local.get('bk_session', (res) => {
        console.log('[Background] From storage:', res.bk_session ? 'FOUND' : 'NULL');
        sendResponse(res.bk_session || null);
      });
    }
    return true;
  }

  // 🔥 CLEAR
  if (request.type === 'CLEAR_SESSION') {
    cachedSession = null;

    chrome.storage.local.remove('bk_session', () => {
      console.log('[Background] Session cleared');
      sendResponse({ ok: true });
    });

    return true;
  }
});