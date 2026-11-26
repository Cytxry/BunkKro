// Runs on the BunkKro website. Keeps the website's login and the extension's in step:
//  - the website's login (supabase-js keeps it in localStorage) goes to the extension;
//  - if the extension holds a newer login of the same user (the popup refreshed it while the site was closed),
//    it is written back before the website starts, so the website doesn't use a refresh token that has already
//    been used (Supabase would then end the login on both).
// Tokens are never logged.

const KEY = 'sb-mvlyeygitnnuksuxmcsy-auth-token';
let lastSent; // undefined until the first check, null once cleared

function siteSession() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || 'null');
    const s = p?.currentSession || p?.session || p;
    return s && s.access_token ? s : null;
  } catch (e) { return null; }
}

// at document_start: hand a newer login back before the website's own script reads it
chrome.runtime.sendMessage({ type: 'GET_SESSION' }, (ext) => {
  if (chrome.runtime.lastError || !ext?.access_token) return;
  const site = siteSession();
  if (site && site.user?.id === ext.user?.id && (Number(ext.expires_at) || 0) > (Number(site.expires_at) || 0)) {
    try { localStorage.setItem(KEY, JSON.stringify(ext)); } catch (e) { /* storage blocked */ }
  }
});

function checkSession() {
  const session = siteSession();
  if (!session) {
    // logged out on the site (the key is gone): drop the extension's copy too
    if (localStorage.getItem(KEY) === null && lastSent !== null) {
      chrome.runtime.sendMessage({ type: 'CLEAR_SESSION' }, () => { if (!chrome.runtime.lastError) lastSent = null; });
    }
    return;
  }
  const fingerprint = session.access_token.slice(-24);
  if (lastSent === fingerprint) return;
  chrome.runtime.sendMessage({ type: 'SET_SESSION', session }, () => {
    if (!chrome.runtime.lastError) lastSent = fingerprint;
  });
}

setTimeout(checkSession, 1000);
setInterval(checkSession, 2000);
