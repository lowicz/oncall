import { useState } from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useLocation, useNavigate } from 'react-router-dom'
import { renderScreen } from '../test/render'
import { useUnsavedChanges } from './useUnsavedChanges'

function Harness() {
  const [dirty, setDirty] = useState(false)
  const [localResult, setLocalResult] = useState('kept')
  const navigate = useNavigate()
  const location = useLocation()
  const guard = useUnsavedChanges(dirty)
  return (
    <>
      <label><input type="checkbox" checked={dirty} onChange={(event) => setDirty(event.target.checked)} />dirty</label>
      <button type="button" onClick={() => guard.requestAction(() => setLocalResult('discarded'))}>local action</button>
      <button type="button" onClick={() => navigate('/next')}>navigate</button>
      <button type="button" onClick={guard.discard}>discard directly</button>
      <output>{localResult}</output>
      <output aria-label="path">{location.pathname}</output>
      {guard.open && (
        <div role="dialog" aria-label="Unsaved">
          <button type="button" onClick={guard.cancel}>stay</button>
          <button type="button" onClick={guard.discard}>discard</button>
        </div>
      )}
    </>
  )
}

describe('useUnsavedChanges', () => {
  it('runs local actions immediately while clean and only after confirmation while dirty', () => {
    renderScreen(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'discard directly' }))
    fireEvent.click(screen.getByRole('button', { name: 'local action' }))
    expect(screen.getByText('discarded')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'local action' }))
    expect(screen.getByRole('dialog', { name: 'Unsaved' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'stay' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'local action' }))
    fireEvent.click(screen.getByRole('button', { name: 'discard' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('blocks route changes until they are cancelled or confirmed', () => {
    renderScreen(<Harness />)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'navigate' }))
    expect(screen.getByRole('dialog', { name: 'Unsaved' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'path' })).toHaveTextContent('/')
    fireEvent.click(screen.getByRole('button', { name: 'stay' }))
    expect(screen.getByRole('button', { name: 'navigate' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'navigate' }))
    fireEvent.click(screen.getByRole('button', { name: 'discard' }))
    expect(screen.getByRole('status', { name: 'path' })).toHaveTextContent('/next')
  })

  it('asks the browser to keep a dirty page on reload', () => {
    renderScreen(<Harness />)
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)

    fireEvent.click(screen.getByRole('checkbox'))
    const dirty = new Event('beforeunload', { cancelable: true })
    const preventDefault = vi.spyOn(dirty, 'preventDefault')
    window.dispatchEvent(dirty)
    expect(preventDefault).toHaveBeenCalled()
    expect(dirty.defaultPrevented).toBe(true)
  })
})
