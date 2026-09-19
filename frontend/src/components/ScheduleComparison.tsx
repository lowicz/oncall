import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Box, Button, MenuItem, Paper, TextField, Typography } from '@mui/material'
import { ScheduleSummary, api } from '../api'
import { rotationLabels } from '../lib/labels'

export function ScheduleComparison({ drafts }: { drafts: ScheduleSummary[] }) {
  const daily = drafts.filter((item) => item.rotation_mode === 'daily')
  const weekly = drafts.filter((item) => item.rotation_mode === 'weekly')
  const [leftId, setLeftId] = useState('')
  const [rightId, setRightId] = useState('')
  const [requested, setRequested] = useState<[string, string] | null>(null)
  const comparison = useQuery({
    queryKey: ['schedule-comparison', requested],
    queryFn: () => api.compareSchedules(requested![0], requested![1]),
    enabled: Boolean(requested),
  })
  return (
    <Paper variant="outlined" sx={{ p: 2, display: 'grid', gap: 2 }}>
      <Box>
        <Typography variant="h2">Porównaj wariant dzienny i tygodniowy</Typography>
        <Typography color="text.secondary">Warianty muszą obejmować ten sam zakres dat.</Typography>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { md: '1fr 1fr auto' }, gap: 1 }}>
        <TextField select label="Wariant dzienny" value={leftId} onChange={(e) => setLeftId(e.target.value)}>
          {daily.map((item) => <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>)}
        </TextField>
        <TextField select label="Wariant tygodniowy" value={rightId} onChange={(e) => setRightId(e.target.value)}>
          {weekly.map((item) => <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>)}
        </TextField>
        <Button variant="outlined" disabled={!leftId || !rightId} onClick={() => setRequested([leftId, rightId])}>Porównaj</Button>
      </Box>
      {comparison.error && <Alert severity="error">{comparison.error.message}</Alert>}
      {comparison.data && (
        <Box className="calendar-scroll">
          <table className="calendar-matrix fairness-table">
            <thead><tr><th>Metryka</th>{comparison.data.variants.map((item) => <th key={item.id}>{rotationLabels[item.rotation_mode]}</th>)}</tr></thead>
            <tbody>
              {[
                ['Przydziały', 'assignment_count'],
                ['Zmiany osoby dzień po dniu', 'handovers'],
                ['Najdłuższa seria dni', 'max_consecutive_days'],
                ['Rozpiętość obciążenia', 'load_spread'],
                ['Korekty ręczne', 'override_count'],
              ].map(([label, key]) => (
                <tr key={key}><th>{label}</th>{comparison.data!.variants.map((item) => <td key={item.id}>{item[key as keyof typeof item]}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </Box>
      )}
    </Paper>
  )
}
