import { useQuery } from '@tanstack/react-query'
import { Alert, Box, CircularProgress, Paper, Typography } from '@mui/material'
import { AssignmentRole, UserRole, api } from '../api'
import { warsawDate } from '../lib/dates'
import { DutyCard } from '../components/DutyCard'
import { CalendarMatrix } from '../components/CalendarMatrix'

export function DutyScreen({ role, displayName, hasTeamMember }: {
  role: UserRole
  displayName: string
  hasTeamMember: boolean
}) {
  const schedule = useQuery({ queryKey: ['published-schedule'], queryFn: api.publishedSchedule })
  const today = warsawDate()
  const current = schedule.data?.current ?? []
  // Not `Boolean(schedule.data?.id)`: imported history is stored as a
  // superseded schedule and fills `id` too, so the eyebrow used to say
  // „[OPUBLIKOWANY]" over a range nobody had published (MED5-01).
  const hasPublishedSchedule = schedule.data?.is_published ?? false
  const byRole = (value: AssignmentRole) => current.find((item) => item.role === value)

  return (
    <>
      <Box>
        <Typography className="eyebrow">
          {hasPublishedSchedule ? '[OPUBLIKOWANY]' : '[BRAK PUBLIKACJI]'} · {today}
        </Typography>
        {role === 'viewer' && <Typography className="role-label">[TYLKO DO ODCZYTU]</Typography>}
        <Typography variant="h1">Kto jest teraz?</Typography>
      </Box>
      {schedule.isLoading && <CircularProgress aria-label="Ładowanie grafiku" />}
      {schedule.error && <Alert severity="error">{schedule.error.message}</Alert>}
      {!schedule.isLoading && !schedule.error && current.length === 0 && (
        <Alert severity="info">Grafik na ten okres nie został jeszcze opublikowany.</Alert>
      )}
      <Box className="duty-grid">
        <DutyCard role="primary" duty={byRole('primary')} />
        <DutyCard role="secondary" duty={byRole('secondary')} />
        <DutyCard
          role="late_shift"
          duty={byRole('late_shift')}
          todayDayOff={schedule.data?.today_is_day_off}
          holidayName={schedule.data?.today_holiday_name}
        />
      </Box>
      <CalendarMatrix role={role} displayName={displayName} />
      <Paper variant="outlined" className="readonly-note">
        <Typography className="role-label">[STATUS GRAFIKU]</Typography>
        <Typography color="text.secondary">
          {!hasPublishedSchedule
            ? 'Grafik na ten okres nie został jeszcze opublikowany.'
            : role === 'viewer'
            ? 'Widzisz wyłącznie zatwierdzony harmonogram. Preferencje, urlopy i rozliczenia zespołu są prywatne.'
            : role === 'coordinator' || role === 'admin'
              ? 'To jest opublikowana wersja harmonogramu. Kliknij komórkę macierzy, żeby zmienić obsadę albo zobaczyć szczegóły dnia.'
              : hasTeamMember
                ? 'To jest opublikowana wersja harmonogramu. Twoje preferencje znajdziesz w zakładce „Moje”.'
                : 'To jest opublikowana wersja harmonogramu.'}
        </Typography>
      </Paper>
    </>
  )
}
