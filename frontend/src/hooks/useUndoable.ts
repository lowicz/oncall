import { useCallback } from 'react'
import { UndoableOptions, undoable } from '../lib/undo'
import { useMessages } from '../i18n'
import { useToast } from '../ui'
import { usePublicConfig } from './usePublicConfig'

/** The server's default Undo window, for the moment before `/api/v1/config` has arrived. */
const DEFAULT_WINDOW_SECONDS = 10

/**
 * `undoable()` with what every screen passes alike: the toast, "Cofnij", the
 * server's Undo window and a failed inverse reported as an error toast.
 */
export function useUndoable() {
  const toast = useToast()
  const config = usePublicConfig()
  const { common } = useMessages()
  const windowSeconds = config.data?.undo_window_seconds ?? DEFAULT_WINDOW_SECONDS
  return useCallback(
    <Result,>(options: Pick<UndoableOptions<Result>, 'execute' | 'undo' | 'message'>) => undoable({
      ...options,
      toast,
      undoLabel: common.undo,
      windowSeconds,
      onUndoError: (error) => toast.error(common.undoFailed, { description: error instanceof Error ? error.message : undefined }),
    }),
    [toast, common, windowSeconds],
  )
}
