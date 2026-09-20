import { AssignmentRole, CalendarData } from '../api'
import { availabilityLabels, roleLabels } from '../lib/labels'
import { formatDate, warsawDate } from '../lib/dates'
import { CoverageGap } from '../lib/calendar'
import { AvailabilityMark, RoleMark, Tag, cx } from '../ui'

const ORDER: AssignmentRole[] = ['primary', 'secondary', 'late_shift']

/**
 * Day-by-day alternative to the people-by-days matrix.
 *
 * A 30-column grid can only be scrolled sideways on a phone; reading one day
 * at a time is how the schedule is actually consulted there.
 */
export function CalendarDayList({ data, displayName, gaps, onSelectDay, selectedDate }: {
  data: CalendarData
  displayName: string
  gaps: CoverageGap[]
  onSelectDay: (day: CalendarData['days'][number], role: AssignmentRole) => void
  selectedDate?: string | null
}) {
  const today = warsawDate()
  const gapsByDate = new Map(gaps.map((gap) => [gap.service_date, gap.missing]))
  const me = data.members.find((member) => member.display_name === displayName)

  return (
    <div className="panel" role="list" aria-label="Grafik dzień po dniu">
      {data.days.map((day) => {
        const missing = gapsByDate.get(day.service_date) ?? []
        const mine = me && data.availability.find(
          (item) => item.member_id === me.id
            && item.starts_on <= day.service_date
            && item.ends_on >= day.service_date,
        )
        return (
          <div
            role="listitem"
            key={day.service_date}
            className={cx(
              'dayrow',
              day.is_day_off && 'dayrow-we',
              day.service_date === today && 'dayrow-td',
              missing.length > 0 && day.published && 'dayrow-gap',
              selectedDate === day.service_date && 'dayrow-sel',
            )}
          >
            <div className="dayrow-dt">
              {day.weekday}
              <b>{day.service_date.slice(8)}</b>
              {day.service_date.slice(5, 7)}
            </div>
            <div className="dayrow-rs">
              {ORDER.map((role) => {
                const assignment = data.assignments.find(
                  (item) => item.service_date === day.service_date && item.role === role,
                )
                if (!assignment && role === 'late_shift' && day.is_day_off) return null
                const you = assignment?.assignee_name === displayName
                return (
                  <button
                    type="button"
                    key={role}
                    className="dayrow-role"
                    onClick={() => onSelectDay(day, role)}
                    aria-label={`${roleLabels[role]}, ${day.weekday} ${formatDate(day.service_date)}, ${assignment?.assignee_name ?? 'brak obsady'}`}
                  >
                    <RoleMark role={role} change={assignment?.change_kind} />
                    <span className={cx(you && 'dayrow-you', !assignment && 'muted')}>
                      {assignment?.assignee_name ?? 'brak obsady'}
                    </span>
                  </button>
                )
              })}
              {(day.is_day_off || day.events.length > 0 || mine) && (
                <div className="row small" style={{ gap: 6 }}>
                  {day.is_day_off && <Tag tone="late">{day.holiday_name ?? '2X'}</Tag>}
                  {day.events.map((event) => (
                    <Tag key={event.id}><i className="event-swatch" style={{ background: `var(--ev-${event.color})` }} />{event.title}</Tag>
                  ))}
                  {mine && <AvailabilityMark kind={mine.kind} withLabel />}
                </div>
              )}
            </div>
            <div className="dayrow-aside">
              {missing.length > 0 && day.published && (
                <Tag tone="bad">brak: {missing.map((role) => roleLabels[role]).join(', ')}</Tag>
              )}
              {!day.published && <Tag>poza publikacją</Tag>}
              {mine && <span className="sr-only">Twoja dostępność: {availabilityLabels[mine.kind]}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
