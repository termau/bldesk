// Applies the saved theme before first paint (ThemeContext.tsx keeps it afterwards).
// A file rather than an inline script, because the build CSP allows script only from the app itself.
;(function () {
  var saved = null
  try {
    saved = localStorage.getItem('bldesk_theme')
  } catch (e) {}
  var dark = saved === 'dark' || (saved !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  var meta = document.querySelector('meta[name="color-scheme"]')
  if (meta) meta.setAttribute('content', dark ? 'dark' : 'light')
})()
