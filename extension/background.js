// BunkKro background: keeps the login the website hands over (through content.js), so the popup can use it.
// Supabase refresh tokens work once: when the popup refreshes an expired login it saves the new one here, and
// content.js gives it back to the website. So a session is replaced only by a newer one of the same user
// (or by another user's login), never by an older copy. Sessions hold tokens: they are never logged.

let cachedSession = null;
chrome.storage.local.get('bk_session', (res) => { if (res.bk_session) cachedSession = res.bk_session; });

const userOf = s => s?.user?.id || null;
const expiry = s => Number(s?.expires_at) || 0;

function isNewer(next, prev) {
  if (!prev) return true;
  if (userOf(next) !== userOf(prev)) return true;          // someone else logged in
  return expiry(next) >= expiry(prev);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;               // only this extension's own pages and scripts

  if (request.type === 'SET_SESSION') {
    const s = request.session;
    if (!s?.access_token || !s?.refresh_token) { sendResponse({ ok: false }); return; }
    chrome.storage.local.get('bk_session', (res) => {
      const prev = res.bk_session || cachedSession;
      if (!isNewer(s, prev)) { sendResponse({ ok: true, kept: 'newer' }); return; }
      cachedSession = s;
      chrome.storage.local.set({ bk_session: s }, () => sendResponse({ ok: true }));
    });
    return true;
  }

  if (request.type === 'GET_SESSION') {
    if (cachedSession) { sendResponse(cachedSession); return; }
    chrome.storage.local.get('bk_session', (res) => sendResponse(res.bk_session || null));
    return true;
  }

  if (request.type === 'CLEAR_SESSION') {
    cachedSession = null;
    chrome.storage.local.remove('bk_session', () => sendResponse({ ok: true }));
    return true;
  }
});
