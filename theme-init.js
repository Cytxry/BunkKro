// Dark theme before the first paint (was an inline script; an external file needs no CSP exception)
try { if (localStorage.getItem('bk_theme') === 'dark') document.documentElement.dataset.theme = 'dark'; } catch (e) { /* private mode */ }
