import { useQuery } from '@tanstack/react-query'
import { Alert, Box, CircularProgress, Paper, Typography } from '@mui/material'
import { AssignmentRole, FairnessMember, SwapImpactMember, api } from '../api'
import { formatDay } from '../lib/dates'

function delta(before: number, after: number) {
  const change = Math.round((after - before) * 100) / 100
  if (change === 0) return null
  return change > 0 ? `+${change}` : String(change)
}

function Side({ side, direction }: { side: SwapImpactMember; direction: string }) {
  const categories: Array<[string, keyof Pick<FairnessMember,
    'primary' | 'secondary' | 'late_shift' | 'weekends' | 'holidays'>]> = [
    ['PRIMARY', 'primary'],
    ['SECONDARY', 'secondary'],
    ['11–19', 'late_shift'],
    ['Weekendy', 'weekends'],
    ['Święta', 'holidays'],
  ]
  return (
    <Box className="impact-side">
      <Typography variant="h2">{side.display_name}</Typography>
      <Typography color="text.secondary" className="impact-direction">{direction} dyżur</Typography>
      <Box className="impact-rows">
        {categories.map(([label, key]) => {
          const before = side.before[key]
          const after = side.after[key]
          const moved = delta(before.actual, after.actual)
          const closer = Math.abs(after.deviation) < Math.abs(before.deviation)
          const further = Math.abs(after.deviation) > Math.abs(before.deviation)
          if (!moved) return null
          return (
            <Box className="impact-row" key={key}>
              <Typography className="role-label">{label}</Typography>
              <Box className="impact-row-detail">
                <Typography className="date-code">odchylenie {before.deviation} → {after.deviation}</Typography>
                <Typography variant="caption" color="text.secondary">punkty {before.actual} → {after.actual} ({moved})</Typography>
                <Typography color={closer ? 'success.main' : further ? 'warning.main' : 'text.secondary'}>
                  {closer
                    ? 'bliżej równowagi'
                    : further
                      ? 'dalej od równowagi'
                      : 'saldo bez zmiany'}
                </Typography>
              </Box>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

/**
 * Points preview before the change is committed, as archive/docs/PLAN.md §4 requires.
 * The projection is read-only; nothing is written until the swap is created or
 * the coordinator confirms the override.
 *
 * `mode` only swaps the wording of the two sides: a swap is something the
 * on-call person `oddaje` (chooses to hand over), a coordinator override is
 * something they `tracą` (it is done to them).
 */
export function SwapImpactPreview({ serviceDate, role, replacementId, mode = 'swap' }: {
  serviceDate: string
  role: AssignmentRole
  replacementId: string
  mode?: 'swap' | 'override'
}) {
  const impact = useQuery({
    queryKey: ['swap-impact', serviceDate, role, replacementId],
    queryFn: () => api.swapImpact(serviceDate, role, replacementId),
    enabled: Boolean(serviceDate && role && replacementId),
  })
  const fromDirection = mode === 'override' ? 'traci' : 'oddaje'

  if (impact.isLoading) {
    return <CircularProgress size={22} aria-label="Przeliczanie wpływu zamiany" />
  }
  if (impact.error) return <Alert severity="error">{impact.error.message}</Alert>
  if (!impact.data) return null

  return (
    <Paper variant="outlined" className="impact-preview">
      <Typography className="eyebrow">[WPŁYW NA BILANS]</Typography>
      <Typography color="text.secondary">
        {formatDay(impact.data.service_date)} to {impact.data.points === 2 ? '2 punkty (2X)' : '1 punkt'}.
        Okno {impact.data.window_start} - {impact.data.window_end}.
      </Typography>
      <Box className="impact-sides">
        <Side side={impact.data.requester} direction={fromDirection} />
        <Side side={impact.data.replacement} direction="przejmuje" />
      </Box>
      {(impact.data.warnings?.length ?? 0) > 0 && (
        <Alert severity="warning">
          <Typography variant="subtitle2">Ostrzeżenia przed decyzją</Typography>
          <ul>
            {impact.data.warnings?.map((warning, index) => (
              <li key={`${warning.rule}-${index}`}>{warning.message} ({warning.member_name})</li>
            ))}
          </ul>
        </Alert>
      )}
    </Paper>
  )
}
