// Where BunkKro AI (the Python timetable reader) runs.
//   On the website: the hosted reader on Modal (BunkKro-AI/deploy/modal_app.py, `modal deploy`). Every signed-in
//      student can use it, and the site sends their login token to it (and only to it). The address is also in
//      connect-src in vercel.json's Content-Security-Policy.
//   Opened from this computer (localhost, a file): the local reader at http://127.0.0.1:8765, as before.
//   To turn the hosted reader off, set HOSTED_AI to '' (students then get the in-browser scanner).
(function () {
  const HOSTED_AI = 'https://charanlol123--bunkkro-ai.us-east.modal.run';
  const local = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  window.BUNKKRO_AI_URL = window.BUNKKRO_AI_URL || (local ? '' : HOSTED_AI);
})();
