import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Tooltip,
  Typography,
} from '@mui/material'
import DeleteOutline from '@mui/icons-material/DeleteOutline'
import { ScheduleSummary, api } from '../api'
import { rotationLabels, scheduleStatusLabels } from '../lib/labels'
import { formatDate, formatDay } from '../lib/dates'

const statusColor: Record<ScheduleSummary['status'], 'default' | 'info' | 'success'> = {
  draft: 'default',
  proposed: 'info',
  published: 'success',
  superseded: 'default',
}

/**
 * Drafts and proposals that already exist.
 *
 * The generator used to open on an empty form with the previous result held only
 * in component state, so a reload lost the work permanently.
 */
const VISIBLE_DRAFTS = 4

export function DraftList({ activeId, onOpen, onDelete, deleting }: {
  activeId?: string
  onOpen: (id: string) => void
  onDelete: (item: ScheduleSummary) => void
  deleting?: boolean
}) {
  const drafts = useQuery({ queryKey: ['draft-schedules'], queryFn: api.draftSchedules })
  const [showAll, setShowAll] = useState(false)
  const all = drafts.data ?? []
  // Abandoned drafts accumulate, so only the newest few are shown by default.
  const visible = showAll ? all : all.slice(0, VISIBLE_DRAFTS)

  return (
    <Box className="draft-list-section">
      <Typography variant="h2">Szkice</Typography>
      {drafts.isLoading && <CircularProgress size={24} aria-label="Ładowanie szkiców" />}
      {drafts.error && <Alert severity="error">{drafts.error.message}</Alert>}
      {drafts.data?.length === 0 && (
        <Alert severity="info">
          Brak szkiców. Utwórz nowy, wybierając zakres dat poniżej.
        </Alert>
      )}
      {all.length > 0 && (
        <Paper variant="outlined" className="draft-list">
          {visible.map((item) => (
            <Box
              className={`draft-list-row${item.id === activeId ? ' is-active' : ''}`}
              key={item.id}
            >
              <Box className="grow">
                <Typography className="date-code">
                  {formatDay(item.starts_on)} - {formatDay(item.ends_on)}
                </Typography>
                <Typography>{item.name}</Typography>
                <Typography color="text.secondary" className="draft-list-meta">
                  {rotationLabels[item.rotation_mode]} · wersja {item.version}
                  {' · '}{item.assignment_count} przydziałów
                  {item.created_at ? ` · utworzony ${formatDate(item.created_at)}` : ''}
                </Typography>
              </Box>
              <Chip
                size="small"
                label={scheduleStatusLabels[item.status]}
                color={statusColor[item.status]}
                variant={item.status === 'draft' ? 'outlined' : 'filled'}
              />
              <Button
                size="small"
                variant={item.id === activeId ? 'contained' : 'outlined'}
                onClick={() => onOpen(item.id)}
              >
                {item.id === activeId ? 'Otwarty' : 'Otwórz'}
              </Button>
              <Tooltip title="Usuń szkic">
                <span>
                  <IconButton
                    size="small"
                    aria-label={`Usuń szkic ${formatDate(item.starts_on)} - ${formatDate(item.ends_on)}`}
                    disabled={deleting}
                    onClick={() => onDelete(item)}
                  >
                    <DeleteOutline fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          ))}
          {all.length > VISIBLE_DRAFTS && (
            <Button className="draft-list-more" onClick={() => setShowAll(!showAll)}>
              {showAll
                ? 'Pokaż mniej'
                : `Pokaż wszystkie (${all.length})`}
            </Button>
          )}
        </Paper>
      )}
    </Box>
  )
}
