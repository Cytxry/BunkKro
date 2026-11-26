// Theme before the first paint (was an inline script; an external file needs no CSP exception).
// bk_theme: 'light' | 'dark' | 'system' (follows the device; settings.js keeps it in step when the device changes)
try {
  const t = localStorage.getItem('bk_theme');
  if (t === 'dark' || (t === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.dataset.theme = 'dark';
} catch (e) { /* private mode */ }
