import { describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { useUrlParams } from './useUrlParams'

function Probe() {
  const [params, setParams] = useUrlParams()
  return (
    <>
      <output>{params.toString()}</output>
      <button type="button" onClick={() => setParams({ zoom: '8' })}>zoom</button>
      <button type="button" onClick={() => setParams({ od: '2026-11-15' })}>forward</button>
      <button type="button" onClick={() => setParams({ zoom: null })}>reset</button>
    </>
  )
}

const renderAt = (entry: string) => {
  const router = createMemoryRouter([{ path: '/grafik', element: <Probe /> }], { initialEntries: [entry] })
  render(<RouterProvider router={router} />)
  return router
}

describe('useUrlParams', () => {
  it('keeps both of two changes made before the router renders the first', async () => {
    renderAt('/grafik?tylko=z-dyzurem')
    // Both clicks in one task: the router has not committed the zoom when
    // the second click reads the query.
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'zoom' }))
      fireEvent.click(screen.getByRole('button', { name: 'forward' }))
    })
    await waitFor(() => expect(new URLSearchParams(screen.getByRole('status').textContent!)).toEqual(
      new URLSearchParams('tylko=z-dyzurem&zoom=8&od=2026-11-15'),
    ))
  })

  it('starts from the address shown once another navigation lands on the same one', async () => {
    const router = renderAt('/grafik')
    fireEvent.click(screen.getByRole('button', { name: 'zoom' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('zoom=8'))
    // The side navigation's plain link back to the screen drops the zoom.
    await act(() => router.navigate('/grafik'))
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    fireEvent.click(screen.getByRole('button', { name: 'forward' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('od=2026-11-15'))
    expect(screen.getByRole('status')).not.toHaveTextContent('zoom')
  })

  it('removes a parameter set to null and replaces the history entry', async () => {
    const router = renderAt('/grafik?zoom=8&od=2026-11-15')
    fireEvent.click(screen.getByRole('button', { name: 'reset' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^od=2026-11-15$/))
    expect(router.state.historyAction).toBe('REPLACE')
  })
})
