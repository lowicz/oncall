import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(join(process.cwd(), 'src', path), 'utf8')

describe('accessible descriptions', () => {
  it('does not leave the reviewed facts in title-only attributes', () => {
    expect(source('screens/Mine.tsx')).not.toContain('title={entry?.note')
    expect(source('components/CalendarMatrix.tsx')).toContain('aria-label={[formatWeekday(day.service_date)')
    expect(source('components/DraftScheduleMatrix.tsx')).toContain('aria-label={[formatWeekday(day.service_date)')
    expect(source('ui/Status.tsx')).toContain('aria-description={title}')
  })
})
