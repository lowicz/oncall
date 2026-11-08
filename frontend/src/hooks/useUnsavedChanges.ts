import { useCallback, useRef, useState } from 'react'
import { createPath, useBeforeUnload, useBlocker } from 'react-router-dom'

// Set once the page is being left on purpose, e.g. after sign-out has ended
// the session: asking then could only strand the user on a dead screen.
let leaving = false

/** Leaves the page without the unsaved-changes prompt. */
export function leaveWithoutAsking(url: string) {
  leaving = true
  window.location.assign(url)
}

/**
 * Protects unfinished form work from route changes, reloads and local actions
 * such as opening another row. The caller owns the confirmation copy and UI;
 * `onDiscard` throws the edits away when the screen stays mounted.
 */
export function useUnsavedChanges(dirty: boolean, onDiscard?: () => void) {
  const unguarded = useRef(false)
  const blocker = useBlocker(useCallback(({ currentLocation, nextLocation }) => (
    dirty && !unguarded.current && createPath(currentLocation) !== createPath(nextLocation)
  ), [dirty]))
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)

  useBeforeUnload(useCallback((event) => {
    if (!dirty || leaving) return
    event.preventDefault()
    event.returnValue = ''
  }, [dirty]), { capture: true })

  const requestAction = (action: () => void) => {
    if (!dirty) {
      action()
      return
    }
    setPendingAction(() => action)
  }

  /** Runs a navigation the screen starts by itself, which the user never asked to confirm. */
  const bypass = (navigation: () => void) => {
    unguarded.current = true
    try {
      navigation()
    } finally {
      unguarded.current = false
    }
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
    bypass,
    cancel,
    discard,
  }
}
