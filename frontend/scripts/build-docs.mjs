#!/usr/bin/env node
/**
 * Renders docs/*.md into static HTML pages.
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
 * Every link the pages emit is relative to the page (`toRoot`), so the site
 * works under any base path (`/docs/` in the image, `/oncall/` on Pages).
 *
 * It is also the documentation's own check, and fails the build on:
 *   - a .md file missing from docs/toc.json, or listed there but absent,
 *   - a page with no `# ` title,
 *   - a link that leaves the documentation tree (it would 404 once served),
 *   - a `#anchor` that matches no heading on the target page.
 *
 * Options:
 *   --site                standalone site mode (see above)
 *   --out <dir>           output directory, relative to frontend/ (default
 *                         public/docs); never the app, docs or repo root
 *   --robots <content>    robots meta (default noindex,nofollow in both modes)
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

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const docsRoot = resolve(appRoot, '../docs')
const templateRoot = join(appRoot, 'docs-template')

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
    robots: 'noindex,nofollow',
    repoUrl: '',
    version: '',
  }
  const withValue = { '--out': 'out', '--robots': 'robots', '--repo-url': 'repoUrl', '--version': 'version' }
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

async function markdownFiles(dir, prefix = '') {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? posix.join(prefix, entry.name) : entry.name
    if (entry.isDirectory()) found.push(...(await markdownFiles(join(dir, entry.name), rel)))
    else if (entry.name.endsWith('.md')) found.push(rel)
  }
  return found.sort()
}

/**
 * GitHub-compatible heading slug, so an anchor written against the Markdown
 * source resolves the same way in the rendered page.
 */
const slugify = (text) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')

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
function renderPage({ markdown, mdPath, pages, headings }) {
  const pageDir = posix.dirname(mdPath)
  const slugs = new Map()
  const depth = pageDir === '.' ? 0 : pageDir.split('/').length
  const toRoot = '../'.repeat(depth)

  const uniqueSlug = (text) => {
    const base = slugify(text) || 'sekcja'
    const seen = slugs.get(base) ?? 0
    slugs.set(base, seen + 1)
    return seen === 0 ? base : `${base}-${seen}`
  }

  const resolveLink = (href) => {
    if (/^(https?:|mailto:|tel:)/.test(href)) return href
    if (href.startsWith('#')) {
      const anchor = decodeURIComponent(href.slice(1))
      if (!headings.get(mdPath).has(anchor)) {
        fail(`${mdPath}: link to "${href}" matches no heading on this page`)
      }
      return href
    }
    const [path, anchor] = href.split('#')
    if (!path.endsWith('.md')) {
      fail(
        `${mdPath}: link to "${href}" leaves the documentation tree. ` +
          'Rendered pages are served on their own; reference repository files as code, not as links.',
      )
    }
    const target = posix.normalize(posix.join(pageDir, path))
    if (!pages.has(target)) fail(`${mdPath}: link to "${href}" points at no documentation page`)
    if (anchor && !headings.get(target).has(decodeURIComponent(anchor))) {
      fail(`${mdPath}: link to "${href}" matches no heading in ${target}`)
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

  return { html: instance.parse(markdown), toRoot }
}

/** Headings of a page, collected before rendering so links can be checked. */
function headingSlugs(markdown) {
  const slugs = new Set()
  const counts = new Map()
  let inFence = false
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence
    if (inFence) continue
    const match = /^(#{1,6})\s+(.*?)\s*$/.exec(line)
    if (!match) continue
    // Inline markup does not reach the slug: `**x**` and `` `x` `` are x.
    const plain = match[2].replace(/[`*_]/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    const base = slugify(plain) || 'sekcja'
    const seen = counts.get(base) ?? 0
    counts.set(base, seen + 1)
    slugs.add(seen === 0 ? base : `${base}-${seen}`)
  }
  return slugs
}

const titleOf = (markdown, mdPath) => {
  const match = /^#\s+(.+?)\s*$/m.exec(markdown)
  if (!match) fail(`${mdPath}: no "# " title on the page`)
  return match[1]
}

/* -------------------------------------------------------------- template -- */

/**
 * Where the top bar leads. In the image the pages sit under /docs/, so the
 * application root is one level above the documentation root, and it is
 * written relative to the page so the same markup works under the Vite dev
 * server. A standalone site has no application: the wordmark goes home and
 * the action link, if any, goes to the repository.
 */
function topbarLinks({ site, toRoot, repoUrl }) {
  if (!site) {
    const appRootHref = `${toRoot}../`
    return {
      wordmark: appRootHref,
      action: `<a class="topbar-link" href="${appRootHref}">Wróć do aplikacji</a>`,
    }
  }
  return {
    wordmark: `${toRoot}index.html`,
    action: repoUrl ? `<a class="topbar-link" href="${escapeHtml(repoUrl)}">Repozytorium</a>` : '',
  }
}

function layout({ title, siteTitle, bodyHtml, nav, toRoot, prev, next, options }) {
  const pager = [
    prev
      ? `<a class="pager-prev" href="${toRoot}${htmlPath(prev.path)}">` +
        `<span>Poprzednia</span>${escapeHtml(prev.title)}</a>`
      : '',
    next
      ? `<a class="pager-next" href="${toRoot}${htmlPath(next.path)}">` +
        `<span>Następna</span>${escapeHtml(next.title)}</a>`
      : '',
  ].join('\n      ')
  const links = topbarLinks({ site: options.site, toRoot, repoUrl: options.repoUrl })
  const footer =
    options.site && options.version
      ? `\n        <p class="site-footer">${escapeHtml(siteTitle)} · wersja ${escapeHtml(options.version)}</p>`
      : ''

  return `<!doctype html>
<html lang="pl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#08131f" />
    <meta name="robots" content="${escapeHtml(options.robots)}" />
    <title>${escapeHtml(title === siteTitle ? title : `${title} · ${siteTitle}`)}</title>
    <script>
      // Identical to index.html: apply the colour scheme before first paint and
      // read it from the same storage key, so the choice made in the
      // application carries over to the documentation and back.
      (function () {
        var scheme = 'dark'
        try {
          var mode = localStorage.getItem('mui-mode') || 'dark'
          scheme =
            mode === 'system'
              ? window.matchMedia('(prefers-color-scheme: dark)').matches
                ? 'dark'
                : 'light'
              : mode
        } catch (error) {}
        document.documentElement.setAttribute('data-mui-color-scheme', scheme)
      })()
    </script>
    <link rel="stylesheet" href="${toRoot}assets/fonts.css" />
    <link rel="stylesheet" href="${toRoot}assets/docs.css" />
  </head>
  <body>
    <header class="topbar">
      <a class="wordmark" href="${links.wordmark}">E<span>/</span> ON-CALL</a>
      <span class="topbar-title">[DOKUMENTACJA]</span>
      <div class="topbar-actions">
        <button class="theme-toggle" type="button" id="theme-toggle" aria-label="Przełącz motyw">
          Motyw
        </button>
        ${links.action}
      </div>
    </header>

    <div class="shell">
      <details class="sidebar" id="sidebar" open>
        <summary class="sidebar-toggle">Spis treści</summary>
        <nav class="sidebar-body" aria-label="Spis treści dokumentacji">
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

        <nav class="pager" aria-label="Sąsiednie strony">
          ${pager}
        </nav>${footer}
      </div>
    </div>

    <script>
      document.getElementById('theme-toggle').addEventListener('click', function () {
        var root = document.documentElement
        var next = root.getAttribute('data-mui-color-scheme') === 'dark' ? 'light' : 'dark'
        root.setAttribute('data-mui-color-scheme', next)
        try {
          localStorage.setItem('mui-mode', next)
        } catch (error) {}
      })
    </script>
  </body>
</html>
`
}

function navigation({ toc, pageTitles, currentPath, toRoot }) {
  const item = (path) => {
    const current = path === currentPath ? ' aria-current="page"' : ''
    return (
      `            <li><a href="${toRoot}${htmlPath(path)}"${current}>` +
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
 * documentation is Polish, so only latin and latin-ext are copied; the rest
 * would be a megabyte of woff2 no reader of these pages ever requests.
 */
const SUBSETS = /-(latin|latin-ext)-/

async function buildFonts(outRoot) {
  const sources = [
    { css: 'node_modules/@fontsource-variable/inter/index.css', dir: 'node_modules/@fontsource-variable/inter/files' },
    { css: 'node_modules/@fontsource/ibm-plex-mono/400.css', dir: 'node_modules/@fontsource/ibm-plex-mono/files' },
    { css: 'node_modules/@fontsource/ibm-plex-mono/600.css', dir: 'node_modules/@fontsource/ibm-plex-mono/files' },
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

async function main() {
  const options = parseOptions(process.argv.slice(2))
  const outRoot = outputRoot(options.out)

  const toc = JSON.parse(await readFile(join(docsRoot, 'toc.json'), 'utf8'))
  const listed = [toc.home, ...toc.sections.flatMap((section) => section.pages)]
  const onDisk = await markdownFiles(docsRoot)

  const missing = listed.filter((path) => !onDisk.includes(path))
  if (missing.length > 0) fail(`toc.json lists pages that do not exist: ${missing.join(', ')}`)
  const unlisted = onDisk.filter((path) => !listed.includes(path))
  if (unlisted.length > 0) {
    fail(`not listed in docs/toc.json: ${unlisted.join(', ')}. Add them, or they ship unreachable.`)
  }

  const pages = new Set(listed)
  const sources = new Map()
  const headings = new Map()
  const pageTitles = new Map()
  for (const path of listed) {
    const markdown = await readFile(join(docsRoot, path), 'utf8')
    sources.set(path, markdown)
    headings.set(path, headingSlugs(markdown))
    pageTitles.set(path, titleOf(markdown, path))
  }

  await rm(outRoot, { recursive: true, force: true })
  await mkdir(outRoot, { recursive: true })

  const order = listed.map((path) => ({ path, title: pageTitles.get(path) }))

  for (const [index, path] of listed.entries()) {
    const { html, toRoot } = renderPage({
      markdown: sources.get(path),
      mdPath: path,
      pages,
      headings,
    })
    const page = layout({
      title: pageTitles.get(path),
      siteTitle: toc.title,
      bodyHtml: html,
      nav: navigation({ toc, pageTitles, currentPath: path, toRoot }),
      toRoot,
      prev: order[index - 1],
      next: order[index + 1],
      options,
    })
    const outPath = join(outRoot, htmlPath(path))
    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(outPath, page)
  }

  await mkdir(join(outRoot, 'assets'), { recursive: true })
  await copyFile(join(templateRoot, 'docs.css'), join(outRoot, 'assets/docs.css'))
  const fontCount = await buildFonts(outRoot)
  // GitHub Pages runs Jekyll over the artifact unless told not to, and Jekyll
  // would drop nothing here but does not need to run at all.
  if (options.site) await writeFile(join(outRoot, '.nojekyll'), '')

  console.log(
    `build-docs: ${listed.length} pages + ${fontCount} font files -> ` +
      `${relative(appRoot, outRoot)}${options.site ? ' (site)' : ''}`,
  )
}

await main()
