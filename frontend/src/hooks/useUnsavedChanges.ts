import { useCallback, useState } from 'react'
import { createPath, useBeforeUnload, useBlocker } from 'react-router-dom'

type PendingAction = (() => void) | null

/**
 * Protects unfinished form work from route changes, reloads and local actions
 * such as opening another row. The caller owns the confirmation copy and UI.
 */
export function useUnsavedChanges(dirty: boolean) {
  const blocker = useBlocker(useCallback(({ currentLocation, nextLocation }) => (
    dirty && createPath(currentLocation) !== createPath(nextLocation)
  ), [dirty]))
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)

  useBeforeUnload(useCallback((event) => {
    if (!dirty) return
    event.preventDefault()
    event.returnValue = ''
  }, [dirty]), { capture: true })

  const requestAction = useCallback((action: () => void) => {
    if (dirty) setPendingAction(() => action)
    else action()
  }, [dirty])

  const cancel = useCallback(() => {
    setPendingAction(null)
    if (blocker.state === 'blocked') blocker.reset()
  }, [blocker])

  const discard = useCallback(() => {
    if (blocker.state === 'blocked') {
      blocker.proceed()
      return
    }
    const action = pendingAction
    setPendingAction(null)
    action?.()
  }, [blocker, pendingAction])

  return {
    open: blocker.state === 'blocked' || pendingAction !== null,
    requestAction,
    cancel,
    discard,
  }
}
