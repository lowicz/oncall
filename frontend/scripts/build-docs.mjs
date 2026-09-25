#!/usr/bin/env node
/**
 * Renders docs/*.md into static HTML pages, in Polish and in English.
 *
 * Two outputs, one renderer, one source:
 *
 *   - default: frontend/public/docs/, which Vite copies verbatim into dist/,
 *     so the documentation ships inside the same nginx image as the SPA and
 *     is reachable at /docs/ in production and in `npm run dev` alike. The
 *     script is wired to `prebuild`, so `npm run build` can never ship stale
 *     pages.
 *   - `--site --out <dir>`: the same pages as a standalone site for GitHub
 *     Pages. Nothing is authored twice: the Markdown, toc.json, stylesheet,
 *     fonts and every check below are shared. Only the top bar differs: a
 *     site has no application to go back to, so the wordmark leads to the
 *     documentation home and the action link points at the repository.
 *
 * Two languages, one tree shape: docs/ holds the Polish pages, the default,
 * rendered at the root of the output exactly where they always were;
 * docs/en/ holds the English pages under the same relative paths, rendered
 * under en/. Each page links to its counterpart from the top bar, and the
 * chrome (top bar, contents, pager) speaks the page's language.
 *
 * Every link the pages emit is relative to the page (`toRoot`), so the site
 * works under any base path (`/docs/` in the image, `/oncall/` on Pages).
 *
 * It is also the documentation's own check, and fails the build on:
 *   - a .md file missing from the language's toc.json, or listed but absent,
 *   - a page with no `# ` title,
 *   - a link that leaves the documentation tree (it would 404 once served),
 *   - a `#anchor` that matches no heading on the target page,
 *   - an English tree that drifted from the Polish one: a page missing or
 *     added on one side, or a page whose headings differ in number or level.
 *
 * Options:
 *   --site                standalone site mode (see above)
 *   --out <dir>           output directory, relative to frontend/ (default
 *                         public/docs); never the app, docs or repo root
 *   --repo-url <url>      site mode: repository link in the top bar
 *   --version <text>      site mode: shown in the footer (default: none)
 *
 * The pages use the application's design tokens (docs-template/docs.css) and
 * its self-hosted fonts, which are extracted from the same @fontsource
 * packages src/main.tsx imports.
 */
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, parse, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Marked, Renderer } from 'marked'
import { slugify } from './heading-slug.mjs'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const docsRoot = resolve(appRoot, '../docs')
const templateRoot = join(appRoot, 'docs-template')

/**
 * The languages, the default first. `dir` is where a language's sources sit
 * under docs/ and where its pages land under the output root; the words are
 * the page chrome, kept here rather than in the application's catalogs
 * because the pages are rendered without it. `other` names the language the
 * top bar offers, in that language's own name, the one label never
 * translated.
 */
const LANGUAGES = [
  {
    code: 'pl',
    dir: '',
    other: 'English',
    words: {
      documentation: 'Dokumentacja',
      backToApp: 'Wróć do aplikacji',
      repository: 'Repozytorium',
      theme: 'Motyw',
      toggleTheme: 'Przełącz motyw',
      contents: 'Spis treści',
      contentsNav: 'Spis treści dokumentacji',
      adjacentPages: 'Sąsiednie strony',
      previous: 'Poprzednia',
      next: 'Następna',
      version: 'wersja',
      section: 'sekcja',
    },
  },
  {
    code: 'en',
    dir: 'en',
    other: 'Polski',
    words: {
      documentation: 'Documentation',
      backToApp: 'Back to the application',
      repository: 'Repository',
      theme: 'Theme',
      toggleTheme: 'Toggle theme',
      contents: 'Contents',
      contentsNav: 'Documentation contents',
      adjacentPages: 'Adjacent pages',
      previous: 'Previous',
      next: 'Next',
      version: 'version',
      section: 'section',
    },
  },
]

const fail = (message) => {
  console.error(`build-docs: ${message}`)
  process.exitCode = 1
  throw new Error(message)
}

/* --------------------------------------------------------------- options -- */

function parseOptions(argv) {
  const options = {
    site: false,
    out: 'public/docs',
    repoUrl: '',
    version: '',
  }
  const withValue = { '--out': 'out', '--repo-url': 'repoUrl', '--version': 'version' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--site') {
      options.site = true
    } else if (arg in withValue) {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) fail(`${arg} needs a value`)
      options[withValue[arg]] = value
      index += 1
    } else {
      fail(`unknown option ${arg}`)
    }
  }
  return options
}

/**
 * The output directory is emptied before rendering, so it must never be a
 * directory the sources live in or a parent of one.
 */
function outputRoot(out) {
  const outRoot = resolve(appRoot, out)
  const protectedRoots = [appRoot, docsRoot, templateRoot, resolve(appRoot, '..')]
  const covers = (root) => root === outRoot || root.startsWith(outRoot + sep)
  if (outRoot === parse(outRoot).root || protectedRoots.some(covers)) {
    fail(`refusing to render into ${outRoot}: it contains the sources`)
  }
  return outRoot
}

/* --------------------------------------------------------------- sources -- */

/** The .md files under `dir`, skipping the other languages' subtrees. */
async function markdownFiles(dir, skip, prefix = '') {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? posix.join(prefix, entry.name) : entry.name
    if (entry.isDirectory()) {
      if (!skip.has(rel)) found.push(...(await markdownFiles(join(dir, entry.name), skip, rel)))
    } else if (entry.name.endsWith('.md')) {
      found.push(rel)
    }
  }
  return found.sort()
}

const escapeHtml = (text) =>
  text.replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  )

/** `produkt/przeglad.md` -> `produkt/przeglad.html`. */
const htmlPath = (mdPath) => mdPath.replace(/\.md$/, '.html')

/* ------------------------------------------------------------- rendering -- */

/**
 * One `marked` instance per page: the renderer has to know which page it is
 * rendering to resolve that page's relative links.
 */
function renderPage({ markdown, mdPath, tree }) {
  const pageDir = posix.dirname(mdPath)
  const slugs = new Map()

  const uniqueSlug = (text) => {
    const base = slugify(text) || tree.language.words.section
    const seen = slugs.get(base) ?? 0
    slugs.set(base, seen + 1)
    return seen === 0 ? base : `${base}-${seen}`
  }

  const resolveLink = (href) => {
    if (/^(https?:|mailto:|tel:)/.test(href)) return href
    if (href.startsWith('#')) {
      const anchor = decodeURIComponent(href.slice(1))
      if (!tree.headings.get(mdPath).has(anchor)) {
        fail(`${tree.label(mdPath)}: link to "${href}" matches no heading on this page`)
      }
      return href
    }
    const [path, anchor] = href.split('#')
    if (!path.endsWith('.md')) {
      fail(
        `${tree.label(mdPath)}: link to "${href}" leaves the documentation tree. ` +
          'Rendered pages are served on their own; reference repository files as code, not as links.',
      )
    }
    const target = posix.normalize(posix.join(pageDir, path))
    if (!tree.pages.has(target)) {
      fail(`${tree.label(mdPath)}: link to "${href}" points at no documentation page`)
    }
    if (anchor && !tree.headings.get(target).has(decodeURIComponent(anchor))) {
      fail(`${tree.label(mdPath)}: link to "${href}" matches no heading in ${tree.label(target)}`)
    }
    const relPath = posix.relative(pageDir === '.' ? '' : pageDir, htmlPath(target))
    return anchor ? `${relPath}#${anchor}` : relPath
  }

  const instance = new Marked({ gfm: true })
  instance.use({
    renderer: {
      heading({ tokens, depth: level }) {
        const text = this.parser.parseInline(tokens)
        const plain = this.parser.parseInline(tokens, this.parser.textRenderer)
        return `<h${level} id="${escapeHtml(uniqueSlug(plain))}">${text}</h${level}>\n`
      },
      link({ tokens, href, title }) {
        const text = this.parser.parseInline(tokens)
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : ''
        return `<a href="${escapeHtml(resolveLink(href))}"${titleAttr}>${text}</a>`
      },
      // Wide tables scroll inside their own box rather than widening the page.
      table(token) {
        const rendered = Renderer.prototype.table.call(this, token)
        return `<div class="table-scroll">${rendered}</div>\n`
      },
    },
  })

  return instance.parse(markdown)
}

/** The headings of a page as (level, plain text), fences skipped. */
function headingsOf(markdown) {
  const found = []
  let inFence = false
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence
    if (inFence) continue
    const match = /^(#{1,6})\s+(.*?)\s*$/.exec(line)
    if (!match) continue
    // Inline markup does not reach the slug: `**x**` and `` `x` `` are x.
    const plain = match[2].replace(/[`*_]/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    found.push({ level: match[1].length, text: plain })
  }
  return found
}

/** Heading slugs of a page, collected before rendering so links can be checked. */
function headingSlugs(headings, fallback) {
  const slugs = new Set()
  const counts = new Map()
  for (const { text } of headings) {
    const base = slugify(text) || fallback
    const seen = counts.get(base) ?? 0
    counts.set(base, seen + 1)
    slugs.add(seen === 0 ? base : `${base}-${seen}`)
  }
  return slugs
}

const titleOf = (markdown, label) => {
  const match = /^#\s+(.+?)\s*$/m.exec(markdown)
  if (!match) fail(`${label}: no "# " title on the page`)
  return match[1]
}

/**
 * One language's sources, read and checked: the pages toc.json lists, in
 * order, with their titles and headings.
 */
async function loadTree(language) {
  const root = join(docsRoot, language.dir)
  const label = (path) => posix.join('docs', language.dir, path)
  const toc = JSON.parse(await readFile(join(root, 'toc.json'), 'utf8'))
  const listed = [toc.home, ...toc.sections.flatMap((section) => section.pages)]
  const skip = new Set(LANGUAGES.map((item) => item.dir).filter((dir) => dir && dir !== language.dir))
  const onDisk = await markdownFiles(root, skip)

  const missing = listed.filter((path) => !onDisk.includes(path))
  if (missing.length > 0) {
    fail(`${label('toc.json')} lists pages that do not exist: ${missing.join(', ')}`)
  }
  const unlisted = onDisk.filter((path) => !listed.includes(path))
  if (unlisted.length > 0) {
    fail(
      `not listed in ${label('toc.json')}: ${unlisted.join(', ')}. Add them, or they ship unreachable.`,
    )
  }

  const tree = {
    language,
    label,
    toc,
    listed,
    pages: new Set(listed),
    sources: new Map(),
    outline: new Map(),
    headings: new Map(),
    pageTitles: new Map(),
  }
  for (const path of listed) {
    const markdown = await readFile(join(root, path), 'utf8')
    const outline = headingsOf(markdown)
    tree.sources.set(path, markdown)
    tree.outline.set(path, outline)
    tree.headings.set(path, headingSlugs(outline, language.words.section))
    tree.pageTitles.set(path, titleOf(markdown, label(path)))
  }
  return tree
}

/**
 * A translation is the same document in other words: the same pages, in the
 * same order, with the same headings at the same levels. Anything else is a
 * page that was translated once and edited on one side since.
 */
function checkParity(reference, translation) {
  const pages = (tree) => tree.listed.join(' ')
  if (pages(reference) !== pages(translation)) {
    fail(
      `${translation.label('toc.json')} lists different pages than ${reference.label('toc.json')}: ` +
        'every page exists in every language, under the same path',
    )
  }
  const shape = (tree, path) => tree.outline.get(path).map((heading) => heading.level).join(',')
  for (const path of reference.listed) {
    const expected = shape(reference, path)
    const actual = shape(translation, path)
    if (expected !== actual) {
      fail(
        `${translation.label(path)}: headings differ from ${reference.label(path)} ` +
          `(levels ${expected} there, ${actual} here); a translation keeps the same sections`,
      )
    }
  }
}

/* -------------------------------------------------------------- template -- */

/**
 * Where the top bar leads. In the image the pages sit under /docs/, so the
 * application root is one level above the documentation root, and it is
 * written relative to the page so the same markup works under the Vite dev
 * server. A standalone site has no application: the wordmark goes home and
 * the action link, if any, goes to the repository.
 */
function topbarLinks({ site, toRoot, repoUrl, language }) {
  const { words } = language
  if (!site) {
    const appRootHref = `${toRoot}../`
    return {
      wordmark: appRootHref,
      action: `<a class="topbar-link" href="${appRootHref}">${words.backToApp}</a>`,
    }
  }
  return {
    wordmark: `${toRoot}${posix.join(language.dir, 'index.html')}`,
    action: repoUrl
      ? `<a class="topbar-link" href="${escapeHtml(repoUrl)}">${words.repository}</a>`
      : '',
  }
}

/** The same page in the other language, relative to this page. */
function languageLink({ path, language, toRoot }) {
  const other = LANGUAGES.find((item) => item !== language)
  const href = `${toRoot}${posix.join(other.dir, htmlPath(path))}`
  return (
    `<a class="topbar-link" href="${href}" lang="${other.code}" hreflang="${other.code}">` +
    `${language.other}</a>`
  )
}

/** The product mark (the same E/ as src/ui/Icon.tsx and public/favicon.svg). */
const MARK =
  '<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#1d4ed8"/>' +
  '<path fill="#fff" d="M12 16h20v6H19v7h11v6H19v7h13v6H12z"/><path fill="#fff" d="M44 16h7L42 48h-7z"/></svg>'

/**
 * Inside the image the pages sit next to the API, so the product name the
 * operator configured (ONCALL_APP_NAME) is one request away; the standalone
 * site has no API and keeps the default.
 */
function brandScript(site, toRoot) {
  if (site) return ''
  return `
      fetch('${toRoot}../api/v1/config', { credentials: 'same-origin' })
        .then(function (response) { return response.ok ? response.json() : null })
        .then(function (config) {
          if (config && config.app_name) {
            document.getElementById('brand-name').textContent = config.app_name
          }
        })
        .catch(function () {})`
}

function layout({ path, title, siteTitle, bodyHtml, nav, toRoot, prev, next, options, language }) {
  const { words } = language
  const pageHref = (target) => `${toRoot}${posix.join(language.dir, htmlPath(target.path))}`
  const pager = [
    prev
      ? `<a class="pager-prev" href="${pageHref(prev)}">` +
        `<span>${words.previous}</span>${escapeHtml(prev.title)}</a>`
      : '',
    next
      ? `<a class="pager-next" href="${pageHref(next)}">` +
        `<span>${words.next}</span>${escapeHtml(next.title)}</a>`
      : '',
  ].join('\n      ')
  const links = topbarLinks({ site: options.site, toRoot, repoUrl: options.repoUrl, language })
  const footer =
    options.site && options.version
      ? `\n        <p class="site-footer">${escapeHtml(siteTitle)} · ${words.version} ${escapeHtml(options.version)}</p>`
      : ''

  return `<!doctype html>
<html lang="${language.code}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#0b0e13" />
    <link rel="icon" href="${toRoot}assets/favicon.svg" type="image/svg+xml" />
    <meta name="robots" content="noindex,nofollow" />
    <title>${escapeHtml(title === siteTitle ? title : `${title} · ${siteTitle}`)}</title>
    <script>
      // Identical to index.html: apply the colour scheme before first paint and
      // read it from the same storage key, so the choice made in the
      // application carries over to the documentation and back.
      (function () {
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
        } catch (error) {}
        document.documentElement.setAttribute('data-theme', scheme)
      })()
    </script>
    <link rel="stylesheet" href="${toRoot}assets/fonts.css" />
    <link rel="stylesheet" href="${toRoot}assets/docs.css" />
  </head>
  <body>
    <header class="topbar">
      <a class="wordmark" href="${links.wordmark}">${MARK}<span id="brand-name">On-call</span></a>
      <span class="topbar-title">${words.documentation}</span>
      <div class="topbar-actions">
        ${languageLink({ path, language, toRoot })}
        <button class="theme-toggle" type="button" id="theme-toggle" aria-label="${words.toggleTheme}">
          ${words.theme}
        </button>
        ${links.action}
      </div>
    </header>

    <div class="shell">
      <details class="sidebar" id="sidebar" open>
        <summary class="sidebar-toggle">${words.contents}</summary>
        <nav class="sidebar-body" aria-label="${words.contentsNav}">
${nav}
        </nav>
      </details>
      <script>
        // Open in the markup, so a wide screen shows the contents with no
        // script at all; collapsed here on a narrow one, before first paint,
        // so a phone opens on the page it was sent to and not on a screenful
        // of links. The same breakpoint as the stylesheet's.
        (function () {
          var sidebar = document.getElementById('sidebar')
          var wide = window.matchMedia('(min-width: 901px)')
          var sync = function () {
            sidebar.open = wide.matches
          }
          sync()
          wide.addEventListener('change', sync)
        })()
      </script>

      <div class="column">
        <main class="content">
${bodyHtml}
        </main>

        <nav class="pager" aria-label="${words.adjacentPages}">
          ${pager}
        </nav>${footer}
      </div>
    </div>

    <script>
      document.getElementById('theme-toggle').addEventListener('click', function () {
        var root = document.documentElement
        var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'
        root.setAttribute('data-theme', next)
        try {
          localStorage.setItem('oncall-theme', next)
        } catch (error) {}
      })${brandScript(options.site, toRoot)}
    </script>
  </body>
</html>
`
}

function navigation({ tree, currentPath, toRoot }) {
  const { toc, pageTitles, language } = tree
  const item = (path) => {
    const current = path === currentPath ? ' aria-current="page"' : ''
    return (
      `            <li><a href="${toRoot}${posix.join(language.dir, htmlPath(path))}"${current}>` +
      `${escapeHtml(pageTitles.get(path))}</a></li>`
    )
  }
  const blocks = [
    `          <ul>\n${item(toc.home)}\n          </ul>`,
    ...toc.sections.map(
      (section) =>
        `          <h2>${escapeHtml(section.title)}</h2>\n` +
        `          <ul>\n${section.pages.map(item).join('\n')}\n          </ul>`,
    ),
  ]
  return blocks.join('\n')
}

/* ----------------------------------------------------------------- fonts -- */

/**
 * The @fontsource stylesheets cover every subset the family ships. The
 * documentation is Polish and English, so only latin and latin-ext are
 * copied; the rest would be a megabyte of woff2 no reader of these pages
 * ever requests.
 */
const SUBSETS = /-(latin|latin-ext)-/

async function buildFonts(outRoot) {
  const sources = [
    { css: 'node_modules/@fontsource-variable/inter-tight/index.css', dir: 'node_modules/@fontsource-variable/inter-tight/files' },
    { css: 'node_modules/@fontsource-variable/jetbrains-mono/index.css', dir: 'node_modules/@fontsource-variable/jetbrains-mono/files' },
  ]
  const faces = []
  const files = new Set()

  for (const source of sources) {
    const css = await readFile(join(appRoot, source.css), 'utf8')
    for (const face of css.split('@font-face').slice(1)) {
      const url = /url\(\.\/files\/([^)]+\.woff2)\)/.exec(face)
      if (!url || !SUBSETS.test(url[1]) || /italic/.test(url[1])) continue
      faces.push(`@font-face${face.slice(0, face.lastIndexOf('}') + 1)}`.replace('./files/', './fonts/'))
      files.add(join(appRoot, source.dir, url[1]))
    }
  }

  if (faces.length === 0) fail('no latin font faces found - is @fontsource installed?')

  await mkdir(join(outRoot, 'assets/fonts'), { recursive: true })
  for (const file of files) {
    await copyFile(file, join(outRoot, 'assets/fonts', posix.basename(file)))
  }
  await writeFile(
    join(outRoot, 'assets/fonts.css'),
    `/* Generated by scripts/build-docs.mjs from the @fontsource packages the\n` +
      ` * application itself imports. Latin and latin-ext only. */\n\n` +
      `${faces.join('\n\n')}\n`,
  )
  return files.size
}

/* ------------------------------------------------------------------ main -- */

async function renderTree(tree, outRoot, options) {
  const { language, listed } = tree
  const order = listed.map((path) => ({ path, title: tree.pageTitles.get(path) }))

  for (const [index, path] of listed.entries()) {
    const pageDir = posix.dirname(path)
    const depth = (pageDir === '.' ? 0 : pageDir.split('/').length) + (language.dir ? 1 : 0)
    const toRoot = '../'.repeat(depth)
    const page = layout({
      path,
      title: tree.pageTitles.get(path),
      siteTitle: tree.toc.title,
      bodyHtml: renderPage({ markdown: tree.sources.get(path), mdPath: path, tree }),
      nav: navigation({ tree, currentPath: path, toRoot }),
      toRoot,
      prev: order[index - 1],
      next: order[index + 1],
      options,
      language,
    })
    const outPath = join(outRoot, language.dir, htmlPath(path))
    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(outPath, page)
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  const outRoot = outputRoot(options.out)

  const trees = []
  for (const language of LANGUAGES) trees.push(await loadTree(language))
  const [reference, ...translations] = trees
  for (const translation of translations) checkParity(reference, translation)

  await rm(outRoot, { recursive: true, force: true })
  await mkdir(outRoot, { recursive: true })

  for (const tree of trees) await renderTree(tree, outRoot, options)

  await mkdir(join(outRoot, 'assets'), { recursive: true })
  await copyFile(join(templateRoot, 'docs.css'), join(outRoot, 'assets/docs.css'))
  await copyFile(join(appRoot, 'public/favicon.svg'), join(outRoot, 'assets/favicon.svg'))
  const fontCount = await buildFonts(outRoot)
  // GitHub Pages runs Jekyll over the artifact unless told not to, and Jekyll
  // would drop nothing here but does not need to run at all.
  if (options.site) await writeFile(join(outRoot, '.nojekyll'), '')

  console.log(
    `build-docs: ${reference.listed.length} pages in ${trees.length} languages + ${fontCount} font files -> ` +
      `${relative(appRoot, outRoot)}${options.site ? ' (site)' : ''}`,
  )
}

await main()
