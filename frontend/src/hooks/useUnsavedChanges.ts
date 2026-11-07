import { useCallback, useState } from 'react'
import { createPath, useBeforeUnload, useBlocker } from 'react-router-dom'

/**
 * Protects unfinished form work from route changes, reloads and local actions
 * such as opening another row. The caller owns the confirmation copy and UI;
 * `onDiscard` throws the edits away when the screen stays mounted.
 */
export function useUnsavedChanges(dirty: boolean, onDiscard?: () => void) {
  const blocker = useBlocker(useCallback(({ currentLocation, nextLocation }) => (
    dirty && createPath(currentLocation) !== createPath(nextLocation)
  ), [dirty]))
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)

  useBeforeUnload(useCallback((event) => {
    if (!dirty) return
    event.preventDefault()
    event.returnValue = ''
  }, [dirty]), { capture: true })

  const requestAction = (action: () => void) => {
    if (dirty) setPendingAction(() => action)
    else action()
  }

  const cancel = () => {
    setPendingAction(null)
    if (blocker.state === 'blocked') blocker.reset()
  }

  const discard = () => {
    onDiscard?.()
    if (blocker.state === 'blocked') {
      blocker.proceed()
      return
    }
    const action = pendingAction
    setPendingAction(null)
    action?.()
  }

  return {
    open: blocker.state === 'blocked' || pendingAction !== null,
    requestAction,
    cancel,
    discard,
  }
}
