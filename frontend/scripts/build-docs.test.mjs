/**
 * The renderer as a black box: run it the way `npm run build` and the Pages
 * workflow do, then read what it wrote.
 *
 * The first case pins the bug that made a standalone site impossible: the
 * top bar linked to `/`, which is the application root inside the image but
 * the account root on GitHub Pages (`/oncall/` is the site). Every link the
 * pages emit has to be relative to the page.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

// Vitest's root is frontend/ (vite.config.ts); jsdom rewrites import.meta.url,
// so the script is located from there rather than from this file.
const script = resolve(process.cwd(), 'scripts/build-docs.mjs')
const scratch = mkdtempSync(join(tmpdir(), 'build-docs-'))
const toc = JSON.parse(readFileSync(resolve(process.cwd(), '../docs/toc.json'), 'utf8'))
const pageCount = 1 + toc.sections.reduce((count, section) => count + section.pages.length, 0)

const render = (...args) =>
  execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', stdio: 'pipe' })

const page = (dir, path) => readFileSync(join(dir, path), 'utf8')

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

describe('build-docs.mjs', () => {
  it('renders a standalone site with only page-relative links', () => {
    const out = join(scratch, 'site')
    const log = render('--site', '--out', out, '--version', 'test-1', '--repo-url', 'https://example.test/repo')

    expect(log).toMatch(new RegExp(`${pageCount} pages .* \\(site\\)`))
    expect(existsSync(join(out, '.nojekyll'))).toBe(true)

    const home = page(out, 'index.html')
    const nested = page(out, 'produkt/generator.html')
    for (const html of [home, nested]) {
      expect(html).not.toMatch(/href="\//)
      expect(html).toContain('<meta name="robots" content="noindex,nofollow" />')
      expect(html).not.toContain('Wróć do aplikacji')
      expect(html).toContain('href="https://example.test/repo">Repozytorium</a>')
      expect(html).toContain('wersja test-1')
    }
    expect(home).toContain('<a class="wordmark" href="index.html">')
    expect(nested).toContain('<a class="wordmark" href="../index.html">')
    expect(nested).toContain('href="../assets/docs.css"')
  })

  it('links the in-app copy back to the application one level above /docs/', () => {
    const out = join(scratch, 'app')
    render('--out', out)

    const home = page(out, 'index.html')
    const nested = page(out, 'uzytkownik/dyzury.html')
    expect(home).not.toMatch(/href="\//)
    expect(home).toContain('<a class="wordmark" href="../">')
    expect(home).toContain('href="../">Wróć do aplikacji</a>')
    expect(nested).toContain('href="../../">Wróć do aplikacji</a>')
    expect(existsSync(join(out, '.nojekyll'))).toBe(false)
    expect(home).not.toContain('site-footer')
  })

  it('renders the Polish pages exactly as before', () => {
    // The whole page, chrome and prose: a change here is a change to what a
    // Polish reader sees. An intended one updates the file with `vitest -u`.
    const out = join(scratch, 'baseline')
    render('--out', out)
    expect(page(out, 'index.html')).toMatchFileSnapshot('__snapshots__/docs-pl-index.html')
    expect(page(out, 'uzytkownik/dyzury.html')).toMatchFileSnapshot('__snapshots__/docs-pl-uzytkownik-dyzury.html')
  })

  it('refuses to empty a directory that holds the sources', () => {
    for (const out of ['.', '..', '../docs', 'docs-template']) {
      expect(() => render('--site', '--out', out)).toThrow(/contains the sources/)
    }
  })
})
