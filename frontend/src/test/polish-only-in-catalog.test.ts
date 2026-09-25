/**
 * Every Polish word the interface shows lives in `src/i18n/pl/`.
 *
 * A screen that still spelled a Polish word itself would show it to English
 * readers too, so the source tree outside the Polish catalog is scanned for
 * Polish letters. Comments are stripped first: an English comment may quote
 * a Polish example.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// Vitest's root is frontend/ (vite.config.ts).
const sourceRoot = join(process.cwd(), 'src')
const POLISH = /[ąęłńóśżźćĄĘŁŃÓŚŻŹĆ]/

/** Source files that spell Polish letters on purpose, with the reason. */
const ALLOWED: Record<string, string> = {
  'components/CommandPalette.tsx': 'the date parser accepts a Polish month name typed by hand',
}

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      yield* sourceFiles(path)
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      yield path
    }
  }
}

const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')

const scanned = () =>
  [...sourceFiles(sourceRoot)]
    .map((path) => relative(sourceRoot, path))
    .filter((path) => !path.startsWith('i18n/pl/') && !path.startsWith('test/'))

describe('the Polish catalog', () => {
  it('is the only place the interface spells Polish', () => {
    const offenders = scanned().filter(
      (path) => !(path in ALLOWED) && POLISH.test(withoutComments(readFileSync(join(sourceRoot, path), 'utf8'))),
    )
    expect(offenders).toEqual([])
  })

  it('has an allowlist naming only files that still need it', () => {
    const stale = Object.keys(ALLOWED).filter(
      (path) => !POLISH.test(withoutComments(readFileSync(join(sourceRoot, path), 'utf8'))),
    )
    expect(stale).toEqual([])
  })
})
