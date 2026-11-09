// Where BunkKro AI (the Python timetable reader) runs.
//   ''  -> only on this computer (http://127.0.0.1:8765), for local development: nothing changes on the live site.
//   'https://ai.example.com' -> a hosted reader (server.py with BUNKKRO_HOSTED=1): every signed-in student can use
//      it, and the site sends their login token to it (and only to it). Also add the address to connect-src in
//      vercel.json's Content-Security-Policy.
window.BUNKKRO_AI_URL = window.BUNKKRO_AI_URL || '';
