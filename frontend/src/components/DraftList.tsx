import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ScheduleSummary, api } from '../api'
import { useMessages } from '../i18n'
import { rotationLabels, scheduleStatusLabels } from '../lib/labels'
import { formatDate } from '../lib/dates'
import { Button, EmptyState, ErrorState, IconButton, List, ListRow, LoadingBlock, StatusBadge, StatusTone } from '../ui'

const statusTone: Record<ScheduleSummary['status'], StatusTone> = {
  draft: 'draft',
  proposed: 'prop',
  published: 'pub',
  superseded: 'muted',
}

/** Abandoned drafts accumulate, so only the newest few are shown by default. */
const VISIBLE_DRAFTS = 4

/**
 * Drafts and proposals that already exist. The generator used to open on an
 * empty form with the previous result held only in component state, so a
 * reload lost the work permanently.
 */
export function DraftList({ activeId, onOpen, onDelete, deleting }: {
  activeId?: string
  onOpen: (id: string) => void
  onDelete: (item: ScheduleSummary) => void
  deleting?: boolean
}) {
  const t = useMessages().generator.drafts
  const drafts = useQuery({ queryKey: ['draft-schedules'], queryFn: api.draftSchedules })
  const [showAll, setShowAll] = useState(false)
  const all = drafts.data ?? []
  const visible = showAll ? all : all.slice(0, VISIBLE_DRAFTS)

  return (
    <>
      {drafts.isLoading && <LoadingBlock label={t.loading} rows={2} />}
      {drafts.error && <ErrorState error={drafts.error} onRetry={() => drafts.refetch()} />}
      {drafts.data?.length === 0 && (
        <EmptyState compact icon="wand" title={t.empty} description={t.emptyHint} />
      )}
      {all.length > 0 && (
        <List className="panel">
          {visible.map((item) => (
            <ListRow
              key={item.id}
              highlight={item.id === activeId}
              aside={(
                <>
                  <StatusBadge tone={statusTone[item.status]}>{scheduleStatusLabels()[item.status]}</StatusBadge>
                  <Button size="sm" variant={item.id === activeId ? 'primary' : 'default'} onClick={() => onOpen(item.id)} aria-pressed={item.id === activeId}>
                    {item.id === activeId ? t.opened : t.open}
                  </Button>
                  <IconButton
                    size="sm"
                    icon="trash"
                    label={t.delete(formatDate(item.starts_on), formatDate(item.ends_on))}
                    disabled={deleting}
                    onClick={() => onDelete(item)}
                  />
                </>
              )}
            >
              <b>{item.name}</b>
              <small>
                {t.summary(formatDate(item.starts_on), formatDate(item.ends_on), rotationLabels()[item.rotation_mode], item.version, item.assignment_count)}
                {item.created_at ? t.createdOn(formatDate(item.created_at)) : ''}
              </small>
            </ListRow>
          ))}
          {all.length > VISIBLE_DRAFTS && (
            <div className="list-row" style={{ justifyContent: 'center' }}>
              <Button size="sm" variant="ghost" onClick={() => setShowAll(!showAll)}>
                {showAll ? t.showFewer : t.showAll(all.length)}
              </Button>
            </div>
          )}
        </List>
      )}
    </>
  )
}
