import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  TextField,
  Typography,
} from '@mui/material'
import { AssignmentRole, CalendarData, DraftSchedule, api } from '../api'
import { availabilityLabels, cellLabel, roleLabels, shortRoleLabels } from '../lib/labels'
import { availabilityCodes, monthGroups, startsWeek } from '../lib/calendar'
import { formatDate } from '../lib/dates'

/** Kept in sync with .calendar-matrix in styles.css. */
const MEMBER_COL = 150
const DAY_COL = 44

export function DraftScheduleMatrix({ result, onChange }: {
  result: DraftSchedule
  onChange: (value: DraftSchedule) => void
}) {
  const [selected, setSelected] = useState<{
    member: CalendarData['members'][number]
    day: CalendarData['days'][number]
  } | null>(null)
  const [selectedRole, setSelectedRole] = useState<AssignmentRole>('primary')
  const metadata = useQuery({
    queryKey: ['draft-matrix-metadata', result.starts_on, result.ends_on],
    queryFn: () => api.calendar(result.starts_on, result.ends_on),
  })
  const fairness = useQuery({
    queryKey: ['draft-fairness-impact', result.id, result.version],
    queryFn: () => api.draftFairnessImpact(result.id, result.version),
  })
  const override = useMutation({
    mutationFn: api.overrideDraft,
    onSuccess: (value) => {
      onChange(value)
      setSelected(null)
    },
  })
  const selectedAssignment = selected
    ? result.assignments.find(
      (item) => item.service_date === selected.day.service_date && item.role === selectedRole,
    )
    : undefined
  // Coordinator corrections need the same preference markers the team calendar
  // shows: assigning somebody who cannot or prefers not to is the main manual
  // fix, and it has to be visible before the API rejects it.
  const availabilityOf = (memberId: string, serviceDate: string) =>
    metadata.data?.availability.find(
      (item) => item.member_id === memberId
        && item.starts_on <= serviceDate
        && item.ends_on >= serviceDate,
    )
  const selectedAvailability = selected
    ? availabilityOf(selected.member.id, selected.day.service_date)
    : undefined
  const selectedBalance = selected
    ? fairness.data?.projected_members.find((item) => item.member_id === selected.member.id)
    : undefined
  const selectedCategory = selectedBalance?.[selectedRole]
  const correctionPoints = selectedRole === 'late_shift' ? 1 : selected?.day.is_day_off ? 2 : 1
  const editable = result.status === 'draft'
  // The draft may predate the availability entry, so the solver never saw it.
  // The backend counts the same list for the 409 on „Przekaż do akceptacji";
  // showing it here is what turns that rejection into something actionable.
  const conflicts = result.unavailability_conflicts ?? []
  const conflictPeople = new Set(conflicts.map((item) => item.assignee_name)).size

  return (
    <Box className="draft-matrix">
      <Typography color="text.secondary">
        Kliknij komórkę osoby i dnia, aby skorygować pojedynczy przydział w szkicu.
        Pozostałe dni nie zostaną przeliczone. Oznaczenia N, W i C pokazują zgłoszoną
        dostępność i preferencje, więc widać, kogo można obsadzić przy poprawce.
      </Typography>
      {metadata.isLoading && <CircularProgress size={24} aria-label="Ładowanie macierzy szkicu" />}
      {(metadata.error || override.error) && (
        <Alert severity="error">{metadata.error?.message ?? override.error?.message}</Alert>
      )}
      {conflicts.length > 0 && (
        <Alert severity="error">
          {conflictPeople === 1
            ? '1 osoba ma dyżur w dniu zgłoszonej niedostępności'
            : `${conflictPeople} osób ma dyżur w dniu zgłoszonej niedostępności`}
          {': '}
          {conflicts.slice(0, 5).map((item) => (
            `${item.assignee_name} - ${formatDate(item.service_date)} (${roleLabels[item.role]})`
          )).join(' · ')}
          {conflicts.length > 5 ? ` i ${conflicts.length - 5} więcej` : ''}.
          {editable
            ? ' Popraw te komórki korektą w macierzy poniżej albo wygeneruj szkic ponownie.'
            : ' Szkic nie jest już edytowalny; wygeneruj go ponownie.'}
        </Alert>
      )}
      {metadata.data && (
        <Box className="calendar-legend" aria-label="Legenda oznaczeń">
          <span><b className="calendar-duty duty-primary">P</b> primary</span>
          <span><b className="calendar-duty duty-secondary">S</b> secondary</span>
          <span><b className="calendar-duty duty-late_shift">11–19</b> zmiana 11–19</span>
          <span><b className="calendar-state state-unavailable">N</b> nie mogę</span>
          <span><b className="calendar-state">W</b> wolę nie</span>
          <span><b className="calendar-state state-prefer">C</b> chętnie wezmę</span>
          <span><b className="calendar-event-key" /> wydarzenie</span>
        </Box>
      )}
      {metadata.data && (
        <Paper variant="outlined" className="calendar-scroll">
          <table
            className="calendar-matrix matrix-grid"
            style={{ width: MEMBER_COL + DAY_COL * metadata.data.days.length }}
          >
            <colgroup>
              <col style={{ width: MEMBER_COL }} />
              {metadata.data.days.map((day) => (
                <col key={day.service_date} style={{ width: DAY_COL }} />
              ))}
            </colgroup>
            <caption className="visually-hidden">
              Szkic grafiku. Osoby w wierszach, dni w kolumnach.
            </caption>
            <thead>
              <tr className="month-row">
                <th scope="col" className="member-column" />
                {monthGroups(metadata.data.days).map((month) => (
                  <th key={month.key} scope="col" colSpan={month.span} className="month-cell">
                    <span className="month-label">
                      {/* A span this narrow has no room for "sie 2026" without
                          spilling into the next column (QA7-L08) - the bare
                          abbreviation still says which month this is. */}
                      {month.span >= 5
                        ? month.label
                        : month.span < 3
                          ? month.shortLabel.split(' ')[0]
                          : month.shortLabel}
                    </span>
                  </th>
                ))}
              </tr>
              <tr className="day-row">
                <th scope="col" className="member-column">Osoba</th>
                {metadata.data.days.map((day) => (
                  <th
                    key={day.service_date}
                    scope="col"
                    className={[
                      day.is_day_off ? 'day-off' : '',
                      startsWeek(day) ? 'week-start' : '',
                      day.events.length ? 'has-event' : '',
                      day.events[0] ? `event-${day.events[0].color}` : '',
                    ].filter(Boolean).join(' ')}
                    title={[day.holiday_name, ...day.events.map((event) => event.title)]
                      .filter(Boolean).join(' · ') || undefined}
                  >
                    <span>{day.weekday}</span>
                    <strong>{day.service_date.slice(8)}</strong>
                    {day.is_day_off && <small>{day.holiday_name ? 'św.' : '2X'}</small>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metadata.data.members.map((member) => (
                <tr key={member.id}>
                  <th scope="row" className="member-column">{member.display_name}</th>
                  {metadata.data.days.map((day) => {
                    const assignments = result.assignments.filter(
                      (item) => item.service_date === day.service_date
                        && item.assignee_name === member.display_name,
                    )
                    const availability = availabilityOf(member.id, day.service_date)
                    return (
                      <td
                        key={day.service_date}
                        className={[
                          day.is_day_off ? 'day-off' : '',
                          startsWeek(day) ? 'week-start' : '',
                          day.events.length ? 'has-event' : '',
                          day.events[0] ? `event-${day.events[0].color}` : '',
                        ].filter(Boolean).join(' ')}
                      >
                        <button
                          type="button"
                          className="calendar-cell"
                          disabled={!editable}
                          onClick={() => {
                            setSelected({ member, day })
                            setSelectedRole(assignments[0]?.role ?? 'primary')
                          }}
                          aria-label={cellLabel(
                            member.display_name,
                            day,
                            assignments.map((assignment) => [
                              roleLabels[assignment.role],
                              assignment.is_override ? 'korekta' : '',
                            ].filter(Boolean).join(' ')),
                            availability?.kind,
                          )}
                        >
                          {assignments.map((assignment) => (
                            <span className={`calendar-duty duty-${assignment.role}`} key={assignment.role}>
                              {shortRoleLabels[assignment.role]}
                              {assignment.is_override && <sup>K</sup>}
                            </span>
                          ))}
                          {availability && (
                            <span className={`calendar-state state-${availability.kind}`}>
                              {availabilityCodes[availability.kind]}
                            </span>
                          )}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Paper>
      )}
      <Dialog open={Boolean(selected)} onClose={() => setSelected(null)} fullWidth maxWidth="xs">
        <DialogTitle>{selected?.member.display_name} · {selected ? formatDate(selected.day.service_date) : ''}</DialogTitle>
        <DialogContent className="calendar-dialog-content">
          {selected?.day.is_day_off && (
            <Alert severity="info">Dzień wolny / 2X - zmiana 11–19 nie występuje.</Alert>
          )}
          {selectedAvailability && (
            <Alert severity={selectedAvailability.kind === 'unavailable' ? 'warning' : 'info'}>
              {selected?.member.display_name}: {availabilityLabels[selectedAvailability.kind]}
              {selectedAvailability.kind === 'unavailable' && ' - przydział zostanie odrzucony'}
              {selectedAvailability.note ? ` (${selectedAvailability.note})` : ''}
            </Alert>
          )}
          <TextField
            select
            fullWidth
            label="Rola do zmiany"
            value={selectedRole}
            onChange={(event) => setSelectedRole(event.target.value as AssignmentRole)}
          >
            {(Object.keys(roleLabels) as AssignmentRole[])
              .filter((item) => item !== 'late_shift' || !selected?.day.is_day_off)
              .map((item) => <MenuItem key={item} value={item}>{roleLabels[item]}</MenuItem>)}
          </TextField>
          <Typography color="text.secondary">
            Obecnie: {selectedAssignment?.assignee_name ?? 'brak przydziału'}
          </Typography>
          {selectedBalance && selectedCategory && selectedAssignment
            && selectedAssignment.assignee_name !== selected?.member.display_name && (
            <Alert severity="info">
              Bilans {roleLabels[selectedRole]} osoby {selectedBalance.display_name}:{' '}
              {selectedCategory.deviation} →{' '}
              {Math.round((selectedCategory.deviation + correctionPoints) * 100) / 100}
              {' '}({correctionPoints > 1 ? '+2 punkty za dzień 2X' : '+1 punkt'}).
            </Alert>
          )}
          {override.error && <Alert severity="error">{override.error.message}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelected(null)}>Anuluj</Button>
          {selected && (
            <Button
              variant="contained"
              disabled={!selectedAssignment
                || selectedAssignment.assignee_name === selected.member.display_name
                || selectedAvailability?.kind === 'unavailable'
                || override.isPending}
              onClick={() => override.mutate({
                id: result.id,
                expected_version: result.version,
                service_date: selected.day.service_date,
                role: selectedRole,
                replacement_member_id: selected.member.id,
              })}
            >{override.isPending ? 'Zapisuję…' : 'Przypisz w szkicu'}</Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  )
}
