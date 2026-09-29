/**
 * The web image starts from one nginx release,
 * `nginxinc/nginx-unprivileged:<major>.<minor>.<patch>-alpine` (Dockerfile), and
 * Renovate keeps it current through the nginx custom manager and the
 * `nginx-unprivileged` datasource in renovate.json5. These checks run offline
 * against the same files Renovate reads: the Dockerfile names exactly one such
 * tag, the manager finds it and nothing else, the datasource's transform turns
 * a Docker Hub tag list into exact releases with their push dates, and the
 * value Renovate writes back leaves the tag exact.
 */
import { readFileSync } from 'node:fs'
import { matchesGlob, resolve } from 'node:path'
import JSON5 from 'json5'
import jsonata from 'jsonata'
import { describe, expect, it } from 'vitest'

const read = (name) => readFileSync(resolve(process.cwd(), name), 'utf8')
const dockerfile = read('Dockerfile')
const renovate = JSON5.parse(read('../renovate.json5'))

const IMAGE = 'nginxinc/nginx-unprivileged'
const DOCKERFILE_PATH = 'frontend/Dockerfile'
const EXACT_RELEASE = /^:\d+\.\d+\.\d+-alpine$/

// What follows the image name on each FROM line that uses it: `:<tag>`,
// `@<digest>`, both, or nothing (Docker's implicit `latest`).
function nginxReferences(text) {
  const from = /^FROM\s+(?:--\S+\s+)*(?:docker\.io\/)?nginxinc\/nginx-unprivileged(\S*)/gm
  return [...text.matchAll(from)].map((match) => match[1])
}

function withNginxReference(reference) {
  return dockerfile.replace(/(^FROM\s+nginxinc\/nginx-unprivileged)\S*/m, `$1${reference}`)
}

// Renovate reads a `/.../` managerFilePatterns entry as a regular expression.
function patternMatches(pattern, path) {
  const regex = /^\/(.*)\/$/.exec(pattern)
  return regex !== null && new RegExp(regex[1]).test(path)
}

const manager = renovate.customManagers.find((entry) => entry.depNameTemplate === IMAGE)

// Every match of the manager's matchStrings in a file, as Renovate's regex
// manager extracts them: the full match and the captured version.
function extract(text) {
  return manager.matchStrings.flatMap((source) =>
    [...text.matchAll(new RegExp(source, 'g'))].map((match) => ({
      replaceString: match[0],
      currentValue: match.groups.currentValue,
    })),
  )
}

const pinned = nginxReferences(dockerfile)[0] ?? ''
const pinnedVersion = /^:(.+)-alpine$/.exec(pinned)?.[1]

describe('nginx base image pin', () => {
  it('names nginx once, as one exact -alpine release', () => {
    expect(nginxReferences(dockerfile)).toEqual([pinned])
    expect(pinned).toMatch(EXACT_RELEASE)
  })

  it.each([
    ':1.31-alpine',
    ':1-alpine',
    ':alpine',
    ':mainline-alpine',
    ':stable-alpine',
    ':latest',
    '',
    ':1.31.6',
    ':1.31.6-alpine3.24',
    ':1.31.6-alpine-slim',
    ':1.31.6-alpine@sha256:26b0bf6fbf07297983cb341998d79c831508787de26627dd2a112321b9c3a4af',
  ])('rejects %j, which Renovate would not maintain', (reference) => {
    const text = withNginxReference(reference)
    expect(nginxReferences(text)).toEqual([reference])
    expect(reference).not.toMatch(EXACT_RELEASE)
    expect(extract(text)).toEqual([])
  })
})

describe('Renovate discovers the pinned release', () => {
  it('reads the Dockerfile with the nginx custom manager', () => {
    expect(manager).toBeDefined()
    expect(renovate.enabledManagers).toContain('custom.regex')
    expect(renovate.ignorePaths.some((glob) => matchesGlob(DOCKERFILE_PATH, glob))).toBe(false)
    expect(manager.managerFilePatterns.some((pattern) => patternMatches(pattern, DOCKERFILE_PATH))).toBe(true)
    expect(manager.datasourceTemplate).toBe('custom.nginx-unprivileged')
    expect(manager.versioningTemplate).toBe('semver')
    expect(extract(dockerfile).map((dep) => dep.currentValue)).toEqual([pinnedVersion])
  })

  it('keeps the dockerfile manager from reading the same line undated', () => {
    const disabled = renovate.packageRules.find(
      (rule) => rule.enabled === false && rule.matchManagers?.includes('dockerfile'),
    )
    expect(disabled.matchDepNames).toContain(IMAGE)
  })

  it('proposes minor and patch releases in the weekly base image pull request', () => {
    const group = renovate.packageRules.find((rule) => rule.matchDepNames?.includes(IMAGE) && rule.groupName)
    expect(group).toMatchObject({ groupName: 'container base images', matchUpdateTypes: ['minor', 'patch'] })
  })
})

describe('Renovate updates the pin to another exact release', () => {
  const datasource = renovate.customDatasources['nginx-unprivileged']
  const tag = (name, pushed) => ({ name, tag_last_pushed: pushed, last_updated: pushed })
  const transform = (results) =>
    jsonata(datasource.transformTemplates[0]).evaluate({ count: results.length, results })

  it('asks Docker Hub for the newest -alpine tags on one anonymous page', () => {
    const url = new URL(datasource.defaultRegistryUrlTemplate)
    expect(url.origin + url.pathname).toBe(`https://hub.docker.com/v2/repositories/${IMAGE}/tags`)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      page_size: '100',
      ordering: 'last_updated',
      name: '-alpine',
    })
  })

  it('offers only exact -alpine releases, dated by their push', async () => {
    const result = await transform([
      tag('1.31.7-alpine', '2026-10-12T04:03:51.978516Z'),
      tag('1.31.7-alpine3.24', '2026-10-12T04:03:54.639022Z'),
      tag('1.31.7-alpine-slim', '2026-10-12T02:30:00.478132Z'),
      tag('1.31-alpine', '2026-10-12T04:03:57.384451Z'),
      tag('1-alpine', '2026-10-12T04:04:02.664321Z'),
      tag('mainline-alpine', '2026-10-12T04:04:08.098934Z'),
      tag('stable-alpine', '2026-10-12T03:06:20.002531Z'),
      tag('1.30.6-alpine', '2026-10-12T03:06:18.002531Z'),
      tag('1.31.7', '2026-10-12T03:02:19.891227Z'),
    ])
    expect(result).toEqual({
      releases: [
        { version: '1.31.7', releaseTimestamp: '2026-10-12T04:03:51.978516Z' },
        { version: '1.30.6', releaseTimestamp: '2026-10-12T03:06:18.002531Z' },
      ],
      sourceUrl: 'https://github.com/nginx/docker-nginx-unprivileged',
    })
  })

  it('returns a list even when the page holds a single release', async () => {
    const result = await transform([tag('1.31.7-alpine', '2026-10-12T04:03:51.978516Z')])
    expect(result.releases).toEqual([{ version: '1.31.7', releaseTimestamp: '2026-10-12T04:03:51.978516Z' }])
  })

  it('writes the new version back as an exact -alpine tag', () => {
    const [dep] = extract(dockerfile)
    const updated = dockerfile.replace(
      dep.replaceString,
      dep.replaceString.replace(dep.currentValue, '1.33.0'),
    )
    expect(nginxReferences(updated)).toEqual([':1.33.0-alpine'])
  })
})
