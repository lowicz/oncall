// Apply the colour scheme before first paint so the page never flashes the
// other theme. Dark is the default; "system" follows the OS. Kept in step with
// src/theme.ts, which owns the same keys after load.
//
// External (not inline) so the page can ship a strict Content-Security-Policy
// with `script-src 'self'` and no inline-script allowance. Referenced from
// index.html as a render-blocking script in <head>, so it still runs before the
// first paint. Served verbatim from public/ by Vite and by nginx.
;(function () {
  var scheme = 'dark'
  try {
    var mode = localStorage.getItem('oncall-theme') || 'dark'
    scheme =
      mode === 'system'
        ? window.matchMedia('(prefers-color-scheme: light)').matches
          ? 'light'
          : 'dark'
        : mode === 'light'
          ? 'light'
          : 'dark'
    if (localStorage.getItem('oncall-density') === 'compact') {
      document.documentElement.setAttribute('data-density', 'compact')
    }
  } catch (error) {}
  document.documentElement.setAttribute('data-theme', scheme)
  if (scheme === 'light') {
    var meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', '#eef1f5')
  }
})()
