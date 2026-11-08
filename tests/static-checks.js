// Release checks that need no browser (run by CI on every push):  node tests/static-checks.js
//   1. no inline JavaScript: no on*= handler attributes and no inline <script> in the site's pages or templates
//      (the Content-Security-Policy refuses them; actions.js is the only way markup calls code)
//   2. every external script is pinned to an exact version and carries an integrity hash
//   3. the enforced CSP never allows 'unsafe-inline' or 'unsafe-eval' for scripts
//   4. no secret in any tracked file or in the git history: Supabase secret / service-role keys, private keys,
//      common API key shapes (the public sb_publishable_ key is allowed: it is meant to be in the page)
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let failed = 0;
const check = (name, problems) => {
  if (problems.length) failed++;
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${name}${problems.length ? '\n     ' + problems.slice(0, 10).join('\n     ') : ''}`);
};

// the site's own files: what the deployed page loads (.vercelignore leaves the developer pages out)
const SITE = ['index.html', 'bunkke.js', 'ai-bridge.js', 'ai-confirm.js', 'actions.js', 'guide.js', 'fx.js', 'clock.js',
  'timetable-scanner.js', 'day-order.js', 'theme-init.js'];

// 1. inline JavaScript
const inline = [];
for (const f of SITE) {
  const s = read(f);
  for (const m of s.matchAll(/<[a-z][^>]*\son[a-z]+\s*=\s*["'][^"']*["']/gi)) inline.push(`${f}: ${m[0].slice(0, 90)}`);
  if (f.endsWith('.html')) for (const m of s.matchAll(/<script(?![^>]*\ssrc=)[^>]*>/gi)) inline.push(`${f}: inline ${m[0]}`);
  for (const m of s.matchAll(/javascript:/gi)) inline.push(`${f}: "javascript:" URL at ${m.index}`);
}
check('no inline handlers, inline scripts or javascript: URLs', inline);

// 2. external scripts: exact versions, integrity hashes
const ext = [];
const html = read('index.html');
for (const m of html.matchAll(/<script[^>]*\ssrc="(https?:[^"]+)"[^>]*>/gi)) {
  if (!/integrity="sha(256|384|512)-/.test(m[0])) ext.push(`no integrity: ${m[1]}`);
  if (!/@\d+\.\d+\.\d+/.test(m[1])) ext.push(`not an exact version: ${m[1]}`);
  if (!/crossorigin=/.test(m[0])) ext.push(`no crossorigin: ${m[1]}`);
}
for (const f of SITE.filter(x => x.endsWith('.js'))) {
  for (const m of read(f).matchAll(/src:\s*'(https:\/\/cdn[^']+)',\s*\n?\s*integrity:\s*'([^']*)'/g)) {
    if (!/^sha(256|384|512)-/.test(m[2])) ext.push(`${f}: no integrity for ${m[1]}`);
    if (!/@\d+\.\d+\.\d+/.test(m[1])) ext.push(`${f}: not an exact version: ${m[1]}`);
  }
  for (const m of read(f).matchAll(/https:\/\/(?:cdn\.jsdelivr\.net|unpkg\.com|docs\.opencv\.org)\/[^\s'"`]+/g)) {
    if (!/@\d+\.\d+\.\d+/.test(m[0])) ext.push(`${f}: unpinned URL ${m[0]}`);
  }
}
check('external scripts pinned and hash-checked', ext);

// 3. the policy
const csp = [];
const vercel = JSON.parse(read('vercel.json'));
const hdrs = vercel.headers.flatMap(h => h.headers);
const policy = hdrs.find(h => h.key === 'Content-Security-Policy');
if (!policy) csp.push('no enforced Content-Security-Policy header');
else {
  const script = (policy.value.match(/script-src([^;]*)/) || [])[1] || '';
  if (/'unsafe-inline'/.test(script)) csp.push("script-src allows 'unsafe-inline'");
  if (/'unsafe-eval'/.test(script)) csp.push("script-src allows 'unsafe-eval'");
  if (!/object-src 'none'/.test(policy.value)) csp.push("no object-src 'none'");
  if (!/frame-ancestors 'none'/.test(policy.value)) csp.push("no frame-ancestors 'none'");
}
for (const k of ['X-Content-Type-Options', 'Referrer-Policy']) if (!hdrs.some(h => h.key === k)) csp.push(`no ${k} header`);
check('enforced CSP without unsafe script sources', csp);

// 4. secrets, in every tracked file and in the whole history
const SECRET = [
  [/sb_secret_[A-Za-z0-9_-]{10,}/, 'Supabase secret key'],
  [/-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/, 'private key'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
  [/gh[pousr]_[A-Za-z0-9]{36,}/, 'GitHub token'],
  [/sk-[A-Za-z0-9]{32,}/, 'API secret key'],
  [/AIza[0-9A-Za-z_-]{35}/, 'Google API key'],
];
const secrets = [];
const jwtRole = tok => { try { return JSON.parse(Buffer.from(tok.split('.')[1], 'base64').toString()).role; } catch (e) { return null; } };
const scan = (where, text) => {
  for (const [re, what] of SECRET) if (re.test(text)) secrets.push(`${what} in ${where}`);
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) {
    if (jwtRole(m[0]) === 'service_role') secrets.push(`Supabase service-role key in ${where}`);
  }
};
let files = [];
try { files = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean); } catch (e) { /* not a checkout */ }
for (const f of files) {
  if (/\.(png|jpe?g|gif|ico|pdf|woff2?|ttf)$/i.test(f)) continue;
  try { scan(f, read(f)); } catch (e) { /* binary or gone */ }
}
try {
  const history = execSync('git log -p --all --no-color -- . ":(exclude)*.png" ":(exclude)*.jpg" ":(exclude)*.pdf"',
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  scan('git history', history);
} catch (e) { secrets.push('could not read the git history: ' + e.message.slice(0, 80)); }
check(`no secrets (${files.length} files and the git history)`, [...new Set(secrets)]);

console.log(failed ? `\n${failed} check(s) failed` : '\nall passed');
process.exitCode = failed ? 1 : 0;
