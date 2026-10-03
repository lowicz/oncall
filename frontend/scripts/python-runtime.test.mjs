import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import JSON5 from 'json5'
import jsonata from 'jsonata'
import { describe, expect, it } from 'vitest'

const root = resolve(process.cwd(), '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const config = JSON5.parse(read('renovate.json5'))
const manager = config.customManagers.find((entry) => entry.depNameTemplate === 'python')
const datasource = config.customDatasources['python-releases']
const paths = ['.github/workflows/ci.yml', 'backend/Dockerfile', 'README.md']

function matchesPath(pattern, path) {
  const body = /^\/(.*)\/$/.exec(pattern)?.[1]
  return body !== undefined && new RegExp(body).test(path)
}

function extractedVersions(path, contents) {
  if (!manager.managerFilePatterns.some((pattern) => matchesPath(pattern, path))) return []
  return manager.matchStrings.flatMap((source) =>
    [...contents.matchAll(new RegExp(source, 'g'))].map((match) => match.groups.currentValue),
  )
}

function updatedContents(path, contents, version) {
  if (!manager.managerFilePatterns.some((pattern) => matchesPath(pattern, path))) return contents
  return manager.matchStrings.reduce(
    (result, source) => result.replace(new RegExp(source, 'g'), (match, ...args) =>
      match.replace(args.at(-1).currentValue, version)),
    contents,
  )
}

function pythonRelease(name, releaseDate, preRelease = false, published = true) {
  return {
    name: `Python ${name}`,
    release_date: releaseDate,
    pre_release: preRelease,
    is_published: published,
  }
}

describe('Renovate Python runtime updates', () => {
  it('holds a young patch and updates every managed reference once it matures', async () => {
    expect(manager.datasourceTemplate).toBe('custom.python-releases')
    expect(manager.versioningTemplate).toBe('python')
    expect(datasource.defaultRegistryUrlTemplate).toBe('https://www.python.org/api/v2/downloads/release/')

    const originals = Object.fromEntries(paths.map((path) => [path, read(path)]))
    const [current] = extractedVersions('backend/Dockerfile', originals['backend/Dockerfile'])
    expect(current).toMatch(/^\d+\.\d+\.\d+$/)
    expect(paths.flatMap((path) => extractedVersions(path, originals[path]))).toEqual(Array(4).fill(current))

    const [major, minor, patch] = current.split('.').map(Number)
    const next = `${major}.${minor}.${patch + 1}`
    const unpublished = `${major}.${minor}.${patch + 2}`
    const releases = await jsonata(datasource.transformTemplates[0]).evaluate([
      pythonRelease(current, '2026-08-05T12:40:32Z'),
      pythonRelease(next, '2026-09-30T21:32:03Z'),
      pythonRelease(`${next}rc1`, '2026-09-29T21:32:03Z', true),
      pythonRelease(unpublished, '2026-09-28T21:32:03Z', false, false),
    ])
    expect(releases.releases).toEqual([
      { version: current, releaseTimestamp: '2026-08-05T12:40:32Z' },
      { version: next, releaseTimestamp: '2026-09-30T21:32:03Z' },
    ])

    const interpreter = config.packageRules.find(
      (rule) => rule.matchManagers?.includes('pep621') && rule.matchDepTypes?.includes('requires-python'),
    )
    expect(interpreter.overrideDatasource).toBe(manager.datasourceTemplate)
    expect(interpreter.rangeStrategy).toBe('update-lockfile')

    const group = config.packageRules.find((rule) => rule.matchDepNames?.includes('python') && rule.groupName)
    expect(group.separateMinorPatch).toBe(true)
    const patchRules = config.packageRules.filter(
      (rule) => rule.matchDepNames?.includes('python') &&
        (!rule.matchUpdateTypes || rule.matchUpdateTypes.includes('patch')),
    )
    const approval = patchRules.map((rule) => rule.dependencyDashboardApproval).filter((value) => value !== undefined).at(-1)
    expect(approval).toBe(false)
    expect(patchRules.map((rule) => rule.minimumReleaseAgeBehaviour).filter(Boolean)).toEqual([])
    expect(config.internalChecksFilter).toBe('strict')
    expect(config.minimumReleaseAge).toBe('3 days')

    const candidate = releases.releases.find((release) => release.version === next)
    const age = Number.parseInt(config.minimumReleaseAge, 10) * 24 * 60 * 60 * 1000
    const proposeAt = (now) => {
      if (approval || Date.parse(now) - Date.parse(candidate.releaseTimestamp) < age) return null
      return Object.fromEntries(paths.map((path) => [path, updatedContents(path, originals[path], next)]))
    }

    expect(proposeAt('2026-10-02T21:32:03Z')).toBeNull()
    const update = proposeAt('2026-10-04T21:32:03Z')
    expect(update).not.toBeNull()
    for (const path of paths) expect(update[path]).not.toBe(originals[path])
    expect(paths.flatMap((path) => extractedVersions(path, update[path]))).toEqual(Array(4).fill(next))
  })
})
