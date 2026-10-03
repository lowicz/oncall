import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { loadRealStylesheet } from '../test/stylesheet'
import { Menu, MenuItem, MenuLink, MenuRadioGroup, MenuSeparator } from './Menu'

function AccountMenu({ onRemove }: { onRemove: () => void }) {
  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>('dark')
  return (
    <Menu trigger={<button type="button">Konto</button>} className="account" align="start">
      <MenuLink to="/wiecej">Ustawienia</MenuLink>
      <MenuLink to="/docs/" external>Dokumentacja</MenuLink>
      <MenuSeparator />
      <MenuRadioGroup
        label="Motyw"
        value={theme}
        onChange={setTheme}
        options={[
          { value: 'dark', label: 'Ciemny' },
          { value: 'light', label: 'Jasny' },
          { value: 'system', label: 'Systemowy', disabled: true },
        ]}
      />
      <MenuItem onClick={onRemove}>Usuń konto</MenuItem>
      <MenuItem disabled>Niedostępne</MenuItem>
    </Menu>
  )
}

function renderMenu() {
  const onRemove = vi.fn()
  render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<AccountMenu onRemove={onRemove} />} />
        <Route path="/wiecej" element={<h1>Więcej</h1>} />
      </Routes>
    </MemoryRouter>,
  )
  return { onRemove }
}

async function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Konto' }))
  return screen.findByRole('menu')
}

describe('Menu', () => {
  it('opens from its trigger with items, links and a separator', async () => {
    renderMenu()
    const menu = await open()
    expect(menu).toHaveClass('menu', 'account')
    expect(within(menu).getByText('Motyw')).toHaveClass('menu-label')
    expect(within(menu).getByRole('menuitem', { name: 'Dokumentacja' })).toHaveAttribute('href', '/docs/')
    expect(within(menu).getByRole('menuitem', { name: 'Ustawienia' })).toHaveAttribute('href', '/wiecej')
    expect(within(menu).getByRole('separator')).toHaveClass('menu-sep')
    expect(within(menu).getByRole('menuitem', { name: 'Usuń konto' })).toHaveClass('menu-item')
    expect(within(menu).getByRole('menuitem', { name: 'Niedostępne' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('runs an item and closes', async () => {
    const { onRemove } = renderMenu()
    const menu = await open()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Usuń konto' }))
    expect(onRemove).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })

  it('picks one choice and stays open so its effect can be seen', async () => {
    renderMenu()
    const menu = await open()
    const group = within(menu).getByRole('group', { name: 'Motyw' })
    expect(within(group).getByRole('menuitemradio', { name: 'Ciemny' })).toHaveAttribute('aria-checked', 'true')
    expect(within(group).getByRole('menuitemradio', { name: 'Systemowy' })).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(within(group).getByRole('menuitemradio', { name: 'Jasny' }))
    await waitFor(() =>
      expect(within(screen.getByRole('menu')).getByRole('menuitemradio', { name: 'Jasny' }))
        .toHaveAttribute('aria-checked', 'true'))
    expect(within(screen.getByRole('menu')).getByRole('menuitemradio', { name: 'Ciemny' }))
      .toHaveAttribute('aria-checked', 'false')
  })

  it('spaces the choices of a group the way the real stylesheet does', async () => {
    loadRealStylesheet()
    renderMenu()
    const menu = await open()
    const group = within(menu).getByRole('group', { name: 'Motyw' })
    const painted = getComputedStyle(group)
    expect([painted.display, painted.gap]).toEqual(['grid', '2px'])
  })

  it('follows an internal link through the router', async () => {
    renderMenu()
    const menu = await open()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Ustawienia' }))
    expect(await screen.findByRole('heading', { name: 'Więcej' })).toBeInTheDocument()
  })
})
