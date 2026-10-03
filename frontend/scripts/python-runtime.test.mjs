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

function matchesPath(pattern, path) {
  const body = /^\/(.*)\/$/.exec(pattern)?.[1]
  return body !== undefined && new RegExp(body).test(path)
}

function extract(path) {
  expect(manager.managerFilePatterns.some((pattern) => matchesPath(pattern, path))).toBe(true)
  return manager.matchStrings.flatMap((source) =>
    [...read(path).matchAll(new RegExp(source, 'g'))].map((match) => match.groups.currentValue),
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
  it('reads one exact patch version from CI, the image, and both badge fields', () => {
    expect(manager.datasourceTemplate).toBe('custom.python-releases')
    expect(manager.versioningTemplate).toBe('python')
    expect(extract('.github/workflows/ci.yml')).toEqual(['3.14.8'])
    expect(extract('backend/Dockerfile')).toEqual(['3.14.8'])
    expect(extract('README.md')).toEqual(['3.14.8', '3.14.8'])

    const interpreter = config.packageRules.find(
      (rule) => rule.matchManagers?.includes('pep621') && rule.matchDepTypes?.includes('requires-python'),
    )
    expect(interpreter.overrideDatasource).toBe('custom.python-releases')
    expect(interpreter.rangeStrategy).toBe('update-lockfile')
  })

  it('looks up dated stable releases from python.org and rejects preview and unpublished versions', async () => {
    expect(datasource.defaultRegistryUrlTemplate).toBe('https://www.python.org/api/v2/downloads/release/')
    const result = await jsonata(datasource.transformTemplates[0]).evaluate([
      pythonRelease('3.14.7', '2026-08-05T12:40:32Z'),
      pythonRelease('3.14.8', '2026-09-30T21:32:03Z'),
      pythonRelease('3.15.0rc3', '2026-10-02T20:49:02Z', true),
      pythonRelease('3.14.9', '2026-10-02T20:49:02Z', false, false),
    ])
    expect(result.releases).toEqual([
      { version: '3.14.7', releaseTimestamp: '2026-08-05T12:40:32Z' },
      { version: '3.14.8', releaseTimestamp: '2026-09-30T21:32:03Z' },
    ])
  })

  it('holds a young Python patch, then proposes it without approval after three days', async () => {
    const result = await jsonata(datasource.transformTemplates[0]).evaluate([
      pythonRelease('3.14.8', '2026-09-30T21:32:03Z'),
    ])
    const patch = result.releases[0]
    const ageMs = Number.parseInt(config.minimumReleaseAge, 10) * 24 * 60 * 60 * 1000
    const readyAt = Date.parse(patch.releaseTimestamp) + ageMs
    expect(config.internalChecksFilter).toBe('strict')
    expect(Date.parse('2026-10-02T21:32:03Z')).toBeLessThan(readyAt)
    expect(Date.parse('2026-10-04T21:32:03Z')).toBeGreaterThan(readyAt)

    const group = config.packageRules.find((rule) => rule.matchDepNames?.includes('python') && rule.groupName)
    const patchRule = config.packageRules.find(
      (rule) => rule.matchDepNames?.includes('python') && rule.matchUpdateTypes?.includes('patch'),
    )
    const approvalRule = config.packageRules.find(
      (rule) => rule.matchDepNames?.includes('python') && rule.dependencyDashboardApproval === true,
    )
    expect(group.separateMinorPatch).toBe(true)
    expect(patchRule.dependencyDashboardApproval).toBe(false)
    expect(approvalRule).toBeDefined()
  })
})
