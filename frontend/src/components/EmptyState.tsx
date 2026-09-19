import { ReactNode } from 'react'
import { Box, Typography } from '@mui/material'

/**
 * A designed empty state instead of a lone grey sentence.
 *
 * Says what the list is for, why it is empty, and what to do next where there
 * is something to do.
 */
export function EmptyState({ title, description, action }: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <Box className="empty-state">
      <Typography className="empty-title">{title}</Typography>
      {description && (
        <Typography color="text.secondary" className="empty-description">{description}</Typography>
      )}
      {action && <Box className="empty-action">{action}</Box>}
    </Box>
  )
}
