import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  MenuItem, Stack, TextField, Typography,
} from '@mui/material'
import { AssignmentRole, TeamMember, api } from '../api'
import { formatDate } from '../lib/dates'
import { roleLabels } from '../lib/labels'

export function OffboardingDialog({ open, member, activeUntil, onClose, onDone }: {
  open: boolean
  member: TeamMember
  activeUntil: string
  onClose: () => void
  onDone: () => void
}) {
  const ranges = useMemo(() => {
    const start = new Date(`${activeUntil}T12:00:00`)
    if (Number.isNaN(start.getTime())) return []
    start.setDate(start.getDate() + 1)
    return Array.from({ length: 5 }, (_, index) => {
      const from = new Date(start)
      from.setDate(from.getDate() + index * 90)
      const to = new Date(from)
      to.setDate(to.getDate() + 89)
      return [from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)] as const
    })
  }, [activeUntil])
  const calendar = useQuery({
    queryKey: ['offboarding', member.id, activeUntil],
    queryFn: async () => {
      const pages = await Promise.all(ranges.map(([from, to]) => api.calendar(from, to)))
      return {
        assignments: pages.flatMap((page) => page.assignments),
        members: pages[0]?.members ?? [],
        availability: pages.flatMap((page) => page.availability),
      }
    },
    enabled: open && Boolean(activeUntil),
  })
  const duties = (calendar.data?.assignments ?? []).filter(
    (item) => item.member_id === member.id && item.service_date > activeUntil,
  )
  const [replacements, setReplacements] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState(false)
  const key = (day: string, role: AssignmentRole) => `${day}:${role}`
  const candidates = (day: string, role: AssignmentRole) => {
    const roleLoad = new Map<string, number>()
    for (const duty of calendar.data?.assignments ?? []) {
      if (duty.role === role && duty.member_id) {
        roleLoad.set(duty.member_id, (roleLoad.get(duty.member_id) ?? 0) + 1)
      }
    }
    return (calendar.data?.members ?? []).filter((candidate) => candidate.id !== member.id &&
      candidate.eligibility?.some((period) => period.role === role
        && period.starts_on <= day && (!period.ends_on || period.ends_on >= day)) &&
      !(calendar.data?.availability ?? []).some((entry) => entry.member_id === candidate.id
        && entry.kind === 'unavailable' && entry.starts_on <= day && entry.ends_on >= day))
      .sort((left, right) => (roleLoad.get(left.id) ?? 0) - (roleLoad.get(right.id) ?? 0)
        || left.display_name.localeCompare(right.display_name, 'pl'))
  }
  const submit = useMutation({
    mutationFn: async () => {
      const groups = duties.reduce((result, item) => {
        result.set(item.schedule_id, [...(result.get(item.schedule_id) ?? []), item])
        return result
      }, new Map<string, typeof duties>())
      for (const [scheduleId, group] of groups) {
        await api.batchOverride({
          schedule_id: scheduleId,
          expected_version: group[0].schedule_version,
          assignments: group.map((item) => ({
            service_date: item.service_date,
            role: item.role,
            replacement_member_id: replacements[key(item.service_date, item.role)],
          })),
          reason: `Zakończenie rotacji ${member.display_name}`,
        })
      }
      for (const period of member.eligibility) {
        if (period.starts_on > activeUntil) await api.deleteEligibility(period.id)
        else if (!period.ends_on || period.ends_on > activeUntil) {
          await api.updateEligibility({ id: period.id, input: { ends_on: activeUntil } })
        }
      }
      return api.updateTeamMember({ id: member.id, input: { active_until: activeUntil } })
    },
    onSuccess: onDone,
  })
  const complete = duties.every((item) => replacements[key(item.service_date, item.role)])
  return <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
    <DialogTitle>Zakończenie rotacji: {member.display_name}</DialogTitle>
    <DialogContent>
      <Typography sx={{ mb: 2 }}>Dyżury po {formatDate(activeUntil)}: {duties.length}</Typography>
      {calendar.error && <Alert severity="error">{calendar.error.message}</Alert>}
      {submit.error && <Alert severity="error">{submit.error.message}</Alert>}
      {confirming && <Alert severity="warning">
        Potwierdź przepisanie {duties.length} dyżurów i zakończenie wszystkich uprawnień
        tej osoby z dniem {formatDate(activeUntil)}.
      </Alert>}
      <Stack gap={1}>
        {duties.map((item) => <TextField
          select
          key={key(item.service_date, item.role)}
          label={`${formatDate(item.service_date)} · ${roleLabels[item.role]}`}
          value={replacements[key(item.service_date, item.role)] ?? ''}
          onChange={(event) => setReplacements((current) => ({
            ...current, [key(item.service_date, item.role)]: event.target.value,
          }))}
        >
          {candidates(item.service_date, item.role).map((candidate) =>
            <MenuItem key={candidate.id} value={candidate.id}>{candidate.display_name}</MenuItem>)}
        </TextField>)}
      </Stack>
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose}>Anuluj</Button>
      <Button variant="contained" disabled={calendar.isLoading || !complete || submit.isPending}
        onClick={() => confirming ? submit.mutate() : setConfirming(true)}>
        {confirming ? 'Potwierdź zakończenie rotacji' : 'Przepisz dyżury i zakończ rotację'}
      </Button>
    </DialogActions>
  </Dialog>
}
