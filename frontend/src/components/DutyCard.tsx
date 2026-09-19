import { Box, Chip, Link, Paper, Stack, Typography } from '@mui/material'
import { AssignmentRole, CurrentDuty } from '../api'
import { roleLabels } from '../lib/labels'
import { formatDay, relativeDay } from '../lib/dates'

/**
 * One role's duty right now.
 *
 * The card used to show only a name and the date, which is the least useful
 * part of the question during an incident: it could not say until when the
 * shift runs, who takes over, or how to reach the person.
 */
export function DutyCard({ duty, role, todayDayOff, holidayName }: {
  duty?: CurrentDuty
  role: AssignmentRole
  todayDayOff?: boolean
  holidayName?: string | null
}) {
  // The 11-19 shift does not exist on days off (PLAN.md §3), so an empty card
  // there means "not applicable", not "somebody forgot to staff it" (MED-01).
  const notApplicable = !duty && role === 'late_shift' && Boolean(todayDayOff)
  return (
    <Paper variant="outlined" className={`duty-card duty-${role}${notApplicable ? ' duty-na' : ''}`}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
        <Typography className="role-label">[{roleLabels[role]}]</Typography>
        {duty?.is_override && <Chip label="override" size="small" />}
      </Stack>

      <Typography className="assignee">
        {notApplicable
          ? `nie dotyczy: ${holidayName ? `święto - ${holidayName}` : 'dzień wolny'}`
          : duty?.assignee_name ?? 'Brak przydziału'}
      </Typography>

      {duty && !notApplicable ? (
        <Box className="duty-meta">
          <Typography className="duty-window">
            {duty.is_day_off
              ? 'całą dobę'
              : `${duty.coverage_starts_at}–${duty.coverage_ends_at}`}
            <span className="duty-window-day"> · {formatDay(duty.service_date)}</span>
          </Typography>

          {duty.contact_phone && (
            <Link href={`tel:${duty.contact_phone}`} className="duty-contact">
              {duty.contact_phone}
            </Link>
          )}

          {duty.contact_email && (
            <Link href={`mailto:${duty.contact_email}`} className="duty-contact">
              {duty.contact_email}
            </Link>
          )}

          {duty.next_assignee_name && duty.next_service_date && (
            <Typography color="text.secondary" className="duty-next">
              Następnie: {duty.next_assignee_name}
              {' '}({relativeDay(duty.next_service_date)})
            </Typography>
          )}
        </Box>
      ) : (
        <Typography color="text.secondary" className="date-code">-</Typography>
      )}
    </Paper>
  )
}
