/**
 * The nginx presets ship the security headers issue #29 asked for. Asserted on
 * the config files themselves (a running nginx is not available in CI), plus
 * the SPA's inline-script handling: the theme bootstrap is an external script,
 * so the strict `script-src 'self'` CSP does not need an inline allowance.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (name) => readFileSync(resolve(process.cwd(), name), 'utf8')

const snippet = read('nginx-security-headers.conf')
const http = read('nginx.http.conf')
const https = read('nginx.https.conf')
const indexHtml = read('index.html')

describe('nginx security headers', () => {
  it('the shared snippet sets the common headers, always', () => {
    for (const directive of [
      'add_header X-Content-Type-Options "nosniff" always;',
      'add_header X-Frame-Options "DENY" always;',
      'add_header Referrer-Policy',
      'add_header Permissions-Policy',
    ]) {
      expect(snippet).toContain(directive)
    }
    // Every add_header in the snippet is marked always (sent on errors too).
    for (const line of snippet.split('\n')) {
      if (line.trim().startsWith('add_header')) expect(line).toMatch(/always;\s*$/)
    }
  })

  for (const [name, conf] of [
    ['http', http],
    ['https', https],
  ]) {
    it(`the ${name} preset includes the snippet and hides the version`, () => {
      expect(conf).toContain('include /etc/nginx/security-headers.conf;')
      expect(conf).toContain('server_tokens off;')
    })

    it(`the ${name} preset ships a strict Content-Security-Policy`, () => {
      expect(conf).toMatch(/add_header Content-Security-Policy ".*script-src 'self'/)
      expect(conf).toMatch(/add_header Content-Security-Policy ".*frame-ancestors 'none'/)
      expect(conf).toMatch(/add_header Content-Security-Policy ".*object-src 'none'/)
      // The app CSP (served at `/` and inherited by /api) forbids inline script.
      expect(conf).toMatch(
        /location \/ \{[^}]*script-src 'self'; style-src[^}]*\}/s,
      )
    })
  }

  it('HSTS is on the TLS preset only', () => {
    expect(https).toMatch(/add_header Strict-Transport-Security ".*max-age=\d+.*" always;/)
    expect(http).not.toContain('Strict-Transport-Security')
  })

  it('the SPA bootstrap is external, so no inline script is served', () => {
    expect(indexHtml).toContain('<script src="/theme-init.js"></script>')
    // No inline <script> body: every <script> tag carries a src.
    const inlineScript = /<script(?![^>]*\bsrc=)[^>]*>[^<]*\S[^<]*<\/script>/
    expect(indexHtml).not.toMatch(inlineScript)
  })
})
