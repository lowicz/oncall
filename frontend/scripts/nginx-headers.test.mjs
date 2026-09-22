/**
 * The nginx presets ship the security headers issue #29 asked for. Rather than
 * grep the config text, this parses each preset into a semantic model and
 * asserts the EFFECTIVE response headers nginx would emit, honouring add_header
 * inheritance: a location that declares any add_header of its own (directly or
 * through an include) does not inherit the server-level add_headers, so every
 * such location re-includes the shared snippet. The SPA's inline-script handling
 * is checked against a parsed DOM: the theme bootstrap is an external script, so
 * the strict `script-src 'self'` CSP needs no inline allowance.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Parser from '@webantic/nginx-config-parser'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

const read = (name) => readFileSync(resolve(process.cwd(), name), 'utf8')
const parser = new Parser()

const SNIPPET_INCLUDE = '/etc/nginx/security-headers.conf'
const snippetRaw = asArray(parser.toJSON(read('nginx-security-headers.conf')).add_header)

function asArray(value) {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

// Parse one `add_header <name> <value> [always]` directive into a header.
function parseHeader(directive) {
  let rest = directive.trim()
  const always = / always$/.test(rest)
  if (always) rest = rest.slice(0, -' always'.length).trim()
  const space = rest.indexOf(' ')
  const name = rest.slice(0, space)
  let value = rest.slice(space + 1).trim()
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
  return { name, value, always }
}

// The add_header directives a block contributes itself: its own directives plus
// anything the shared snippet include pulls in. An empty result means the block
// inherits its parent's headers.
function contributed(block) {
  if (!block) return []
  const fromInclude = asArray(block.include).flatMap((inc) =>
    inc === SNIPPET_INCLUDE ? snippetRaw : [],
  )
  return [...fromInclude, ...asArray(block.add_header)]
}

// Effective headers for a location: its own contribution wins outright, else it
// inherits the server's (nginx add_header inheritance is all-or-nothing).
function effectiveHeaders(location, server) {
  const own = contributed(location)
  const raw = own.length ? own : contributed(server)
  return raw.map(parseHeader)
}

function parseCsp(value) {
  const directives = {}
  for (const part of value.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean)
    if (tokens.length) directives[tokens[0]] = tokens.slice(1)
  }
  return directives
}

const serverBlocks = (parsed) => asArray(parsed.server)
const contentServer = (parsed) =>
  serverBlocks(parsed).find((s) => Object.keys(s).some((k) => k.startsWith('location ')))
const locationBlock = (server, path) => server[`location ${path}`]

const presets = [
  { name: 'http (plain-HTTP preset)', parsed: parser.toJSON(read('nginx.http.conf')), tls: false },
  { name: 'https (TLS preset)', parsed: parser.toJSON(read('nginx.https.conf')), tls: true },
]

// Where a browser lands: the SPA shell, the docs, the proxied API and calendar.
const responsePaths = ['/', '/docs/', '/api/', '/calendar/']

describe.each(presets)('nginx security headers - $name', ({ parsed, tls }) => {
  const server = contentServer(parsed)

  it('hides the nginx version on every server block', () => {
    for (const block of serverBlocks(parsed)) expect(block.server_tokens).toBe('off')
  })

  it.each(responsePaths)('%s sends the common security headers, always', (path) => {
    const headers = effectiveHeaders(locationBlock(server, path), server)
    const byName = (name) => headers.find((h) => h.name === name)
    for (const name of [
      'X-Content-Type-Options',
      'X-Frame-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'Content-Security-Policy',
    ]) {
      const header = byName(name)
      expect(header, `${path} is missing ${name}`).toBeTruthy()
      expect(header.always, `${path} ${name} is not marked always`).toBe(true)
    }
    expect(byName('X-Content-Type-Options').value).toBe('nosniff')
    expect(byName('X-Frame-Options').value).toBe('DENY')
  })

  it.each(responsePaths)('%s CSP blocks framing and plugins, and only /docs/ relaxes script-src', (path) => {
    const headers = effectiveHeaders(locationBlock(server, path), server)
    const csp = parseCsp(headers.find((h) => h.name === 'Content-Security-Policy').value)
    expect(csp['frame-ancestors']).toEqual(["'none'"])
    expect(csp['object-src']).toEqual(["'none'"])
    if (path === '/docs/') {
      expect(csp['script-src']).toContain("'self'")
      expect(csp['script-src']).toContain("'unsafe-inline'")
    } else {
      expect(csp['script-src']).toEqual(["'self'"])
    }
  })

  it('the docs CSP relaxes script-src and nothing else', () => {
    const app = parseCsp(
      effectiveHeaders(locationBlock(server, '/'), server).find(
        (h) => h.name === 'Content-Security-Policy',
      ).value,
    )
    const docs = parseCsp(
      effectiveHeaders(locationBlock(server, '/docs/'), server).find(
        (h) => h.name === 'Content-Security-Policy',
      ).value,
    )
    expect(Object.keys(docs).sort()).toEqual(Object.keys(app).sort())
    for (const name of Object.keys(app)) {
      if (name === 'script-src') continue
      expect(docs[name], `docs ${name} differs from the app CSP`).toEqual(app[name])
    }
    expect(docs['script-src']).toEqual([...app['script-src'], "'unsafe-inline'"])
  })

  it('HSTS is present exactly when the content server is TLS (listen ... ssl)', () => {
    expect(/\sssl\b/.test(String(server.listen))).toBe(tls)
    const hsts = effectiveHeaders(locationBlock(server, '/'), server).find(
      (h) => h.name === 'Strict-Transport-Security',
    )
    if (tls) {
      expect(hsts).toBeTruthy()
      expect(hsts.always).toBe(true)
      expect(hsts.value).toMatch(/max-age=\d+/)
    } else {
      expect(hsts).toBeFalsy()
    }
  })
})

// nginx runs as uid 101 without any capability (frontend/Dockerfile,
// docker-compose.yml), so it can bind no port below 1024, and Compose maps the
// host ports onto exactly these two.
describe.each(presets)('nginx runs unprivileged - $name', ({ parsed, tls }) => {
  const listenPorts = serverBlocks(parsed).flatMap((block) =>
    asArray(block.listen).map((listen) => Number(listen.trim().split(/\s+/)[0].split(':').pop())),
  )

  it('listens on 8080, and on 8443 for TLS', () => {
    expect([...new Set(listenPorts)].sort((a, b) => a - b)).toEqual(tls ? [8080, 8443] : [8080])
  })

  it('keeps the container port out of the redirects it makes itself', () => {
    expect(contentServer(parsed).absolute_redirect).toBe('off')
  })
})

describe('SPA index.html keeps the CSP strict', () => {
  const scripts = [...new JSDOM(read('index.html')).window.document.querySelectorAll('script')]

  it('serves no inline script: every <script> is external with an empty body', () => {
    expect(scripts.length).toBeGreaterThan(0)
    for (const script of scripts) {
      expect(script.getAttribute('src')).toBeTruthy()
      expect(script.textContent.trim()).toBe('')
    }
  })

  it('loads the external theme bootstrap', () => {
    expect(scripts.some((s) => s.getAttribute('src') === '/theme-init.js')).toBe(true)
  })
})
