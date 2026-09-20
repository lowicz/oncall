import { Box, Chip, Paper, Typography } from '@mui/material'
import { AssignmentRole, CalendarData } from '../api'
import { availabilityLabels, roleLabels } from '../lib/labels'
import { formatDate, formatDay } from '../lib/dates'
import { CoverageGap } from '../lib/calendar'

const ORDER: AssignmentRole[] = ['primary', 'secondary', 'late_shift']

/**
 * Day-by-day alternative to the people-by-days matrix.
 *
 * archive/docs/PLAN.md §6 asks for a responsive small-screen mode. A 30-column grid can
 * only be scrolled sideways on a phone; reading one day at a time is how the
 * schedule is actually consulted there.
 */
export function CalendarDayList({ data, displayName, gaps, onSelectDay }: {
  data: CalendarData
  displayName: string
  gaps: CoverageGap[]
  onSelectDay: (day: CalendarData['days'][number], role: AssignmentRole) => void
}) {
  const gapsByDate = new Map(gaps.map((gap) => [gap.service_date, gap.missing]))

  return (
    <Box className="day-list">
      {data.days.map((day) => {
        const missing = gapsByDate.get(day.service_date) ?? []
        const mine = data.availability.find(
          (item) => item.starts_on <= day.service_date
            && item.ends_on >= day.service_date
            && data.members.some(
              (member) => member.id === item.member_id && member.display_name === displayName,
            ),
        )
        return (
          <Paper
            variant="outlined"
            key={day.service_date}
            className={`day-card${day.is_day_off ? ' is-day-off' : ''}${missing.length ? ' has-gap' : ''}`}
          >
            <Box className="day-card-head">
              <Typography className="day-card-date">{formatDay(day.service_date)}</Typography>
              {day.is_day_off && (
                <Chip size="small" variant="outlined" label={day.holiday_name ?? '2X'} />
              )}
              {day.events.map((event) => (
                <Chip
                  key={event.id}
                  size="small"
                  label={event.title}
                  className={`calendar-event-chip event-${event.color}`}
                />
              ))}
              {missing.length > 0 && (
                <Chip
                  size="small"
                  color="warning"
                  label={`brak: ${missing.map((role) => roleLabels[role]).join(', ')}`}
                />
              )}
            </Box>
            <Box className="day-card-roles">
              {ORDER.map((role) => {
                const assignment = data.assignments.find(
                  (item) => item.service_date === day.service_date && item.role === role,
                )
                if (!assignment && role === 'late_shift' && day.is_day_off) return null
                return (
                  <button
                    type="button"
                    key={role}
                    className="day-role"
                    onClick={() => onSelectDay(day, role)}
                    aria-label={`${roleLabels[role]}, ${day.weekday} ${formatDate(day.service_date)}, ${assignment?.assignee_name ?? 'brak przydziału'}`}
                  >
                    <span className={`day-role-tag duty-${role}`}>{roleLabels[role]}</span>
                    <span className="day-role-name">
                      {assignment?.assignee_name ?? 'brak przydziału'}
                    </span>
                    {assignment?.change_kind === 'swap' && <span className="day-role-mark">zamiana</span>}
                    {assignment?.change_kind === 'manual_override' && (
                      <span className="day-role-mark">korekta</span>
                    )}
                  </button>
                )
              })}
            </Box>
            {mine && (
              <Typography className={`day-card-availability state-${mine.kind}`}>
                Twoja dostępność: {availabilityLabels[mine.kind]}
              </Typography>
            )}
          </Paper>
        )
      })}
    </Box>
  )
}
