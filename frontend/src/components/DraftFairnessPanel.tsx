import { useQuery } from '@tanstack/react-query'
import { Alert, Box, CircularProgress, Paper, Typography } from '@mui/material'
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline'
import WarningAmber from '@mui/icons-material/WarningAmber'
import { DraftFairnessImpact, DraftSchedule, FairnessMember, api } from '../api'
import { lensLabels } from '../lib/labels'

function impactLabel(before: number, after: number) {
  const change = Math.round((Math.abs(before) - Math.abs(after)) * 100) / 100
  if (Math.abs(change) < 0.05) return 'bez istotnej zmiany'
  if (change > 0) return `bliżej równowagi o ${change}`
  if (change < 0) return `dalej od równowagi o ${Math.abs(change)}`
  if (before === after) return 'saldo bez zmiany'
  return 'ta sama odległość, druga strona bilansu'
}

function ImpactCell({ before, after }: {
  before: FairnessMember['primary']
  after: FairnessMember['primary']
}) {
  const improves = Math.abs(after.deviation) < Math.abs(before.deviation)
  const worsens = Math.abs(after.deviation) > Math.abs(before.deviation)
  return (
    <Box className="impact-cell">
      <Typography className="date-code">{before.deviation} → {after.deviation}</Typography>
      <Typography color={improves ? 'success.main' : worsens ? 'warning.main' : 'text.secondary'}>
        {impactLabel(before.deviation, after.deviation)}
      </Typography>
    </Box>
  )
}

function LensCell({ before, after, eligible = true }: {
  before: FairnessMember['primary']
  after: FairnessMember['primary']
  eligible?: boolean
}) {
  return eligible
    ? <ImpactCell before={before} after={after} />
    : <Typography color="text.secondary">nie pełni tej roli</Typography>
}

export function DraftFairnessPanel({ result }: { result: DraftSchedule }) {
  const impact = useQuery<DraftFairnessImpact>({
    queryKey: ['draft-fairness-impact', result.id, result.version],
    queryFn: () => api.draftFairnessImpact(result.id, result.version),
  })
  // D1: with an anchor the 11-19 count follows the anchor role and the column
  // hides; only `independent` shows it as a lens balanced on its own.
  const lateShiftBalanced = impact.data?.late_shift_balanced !== false
  const criterionMembers = impact.data?.projected_members.filter((item) => item.in_criterion !== false) ?? []
  const formerMembers = impact.data?.projected_members.filter((item) => item.in_criterion === false) ?? []
  const memberRows = (members: FairnessMember[]) => members.map((after) => {
    const before = impact.data?.baseline_members.find(
      (item) => item.member_id === after.member_id,
    ) ?? after
    return (
      <tr key={after.member_id}>
        <th scope="row" className="member-column">{after.display_name}</th>
        <td><LensCell before={before.primary} after={after.primary} eligible={after.eligible_days.primary > 0} /></td>
        <td><LensCell before={before.secondary} after={after.secondary} eligible={after.eligible_days.secondary > 0} /></td>
        {lateShiftBalanced && <td><LensCell before={before.late_shift} after={after.late_shift} eligible={after.eligible_days.late_shift > 0} /></td>}
        <td><ImpactCell before={before.weekends} after={after.weekends} /></td>
        <td><ImpactCell before={before.holidays} after={after.holidays} /></td>
      </tr>
    )
  })
  return (
    <Box className="draft-impact">
      <Box>
        <Typography variant="h2">Wpływ szkicu na sprawiedliwość</Typography>
        <Typography color="text.secondary">
          Saldo przed zakresem → prognozowane saldo po tej wersji szkicu. Każda korekta
          macierzy automatycznie odświeża wynik.
        </Typography>
      </Box>
      {impact.isLoading && <CircularProgress size={24} aria-label="Przeliczanie fairness" />}
      {impact.error && <Alert severity="error">{impact.error.message}</Alert>}
      {impact.data && !impact.data.criterion_met && impact.data.acceptance_floor != null && (
        <Alert severity="warning">
          Kryterium {impact.data.criterion_points} punktów jest nieosiągalne przy zastanym
          długu historycznym. Najniższa osiągalna rozpiętość to {impact.data.acceptance_floor}{' '}
          punktów - przyczyną jest zastana nierówność, nie jakość generowania.
        </Alert>
      )}
      {impact.data && (
        <Box
          className="criterion-summary"
          aria-label="Podsumowanie kryterium odbioru"
          sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
        >
          <Typography variant="subtitle2">
            Kryterium odbioru: rozpiętość ≤ {impact.data.criterion_points} pkt na soczewce
          </Typography>
          <Box
            component="ul"
            className="criterion-list"
            sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}
          >
            {impact.data.spreads.map((item) => (
              <Box
                component="li"
                key={item.lens}
                sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
              >
                {item.meets_criterion
                  ? <CheckCircleOutline fontSize="small" color="success" />
                  : <WarningAmber fontSize="small" color="warning" />}
                <Typography color={item.meets_criterion ? 'text.secondary' : 'warning.main'}>
                  {lensLabels[item.lens] ?? item.lens}: {item.before} → {item.after}
                  {' · '}{item.meets_criterion ? 'spełnia' : 'nie spełnia'}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      )}
      {impact.data && (
        <Paper variant="outlined" className="calendar-scroll" tabIndex={0}>
          <table className="calendar-matrix impact-table">
            <thead>
              <tr>
                <th scope="col" className="member-column">Osoba</th>
                <th scope="col">PRIMARY</th>
                <th scope="col">SECONDARY</th>
                {lateShiftBalanced && <th scope="col">11–19</th>}
                <th scope="col">Weekendy</th>
                <th scope="col">Święta</th>
              </tr>
            </thead>
            <tbody>
              {memberRows(criterionMembers)}
              {formerMembers.length > 0 && (
                <tr className="fairness-group-row">
                  <th scope="rowgroup" colSpan={lateShiftBalanced ? 6 : 5}>Poza rotacją</th>
                </tr>
              )}
              {memberRows(formerMembers)}
            </tbody>
          </table>
        </Paper>
      )}
    </Box>
  )
}
