console.log('[Content] Loaded');

let lastSessionSent = null;

setInterval(checkSession, 2000);
setTimeout(checkSession, 1000);

function checkSession() {
  try {
    const key = 'sb-mvlyeygitnnuksuxmcsy-auth-token';
    const raw = localStorage.getItem(key);

    if (!raw) return;

    const parsed = JSON.parse(raw);

    const session =
      parsed?.currentSession ||
      parsed?.session ||
      parsed;

    if (!session || !session.access_token) return;

    const fingerprint = session.access_token.slice(0, 20);

    // ✅ prevent duplicate sends
    if (lastSessionSent === fingerprint) return;

    console.log('[Content] ✅ Sending session');

    chrome.runtime.sendMessage(
      {
        type: "SET_SESSION",
        session: session
      },
      (res) => {
        if (chrome.runtime.lastError) {
          console.error("[Content] ❌ Error:", chrome.runtime.lastError.message);
        } else {
          console.log("[Content] ✅ Sent to background");
          lastSessionSent = fingerprint; // 🔥 IMPORTANT FIX
        }
      }
    );

  } catch (e) {
    console.error('[Content] Error:', e);
  }
}