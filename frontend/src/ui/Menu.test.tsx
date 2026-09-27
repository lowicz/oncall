import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Menu, MenuGroup, MenuItem, MenuLink, MenuRadioGroup, MenuSeparator } from './Menu'

function AccountMenu({ onRemove, onKeep }: { onRemove: () => void; onKeep: () => void }) {
  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>('dark')
  return (
    <Menu trigger={<button type="button">Konto</button>} className="account" align="start">
      <MenuGroup label="Konto">
        <MenuLink to="/wiecej">Ustawienia</MenuLink>
        <MenuLink to="/docs/" external>Dokumentacja</MenuLink>
      </MenuGroup>
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
      <MenuGroup>
        <MenuItem onClick={onKeep} closeOnClick={false}>Zostaw otwarte</MenuItem>
        <MenuItem onClick={onRemove} tone="danger">Usuń konto</MenuItem>
        <MenuItem disabled>Niedostępne</MenuItem>
      </MenuGroup>
    </Menu>
  )
}

function renderMenu() {
  const onRemove = vi.fn()
  const onKeep = vi.fn()
  render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<AccountMenu onRemove={onRemove} onKeep={onKeep} />} />
        <Route path="/wiecej" element={<h1>Więcej</h1>} />
      </Routes>
    </MemoryRouter>,
  )
  return { onRemove, onKeep }
}

async function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Konto' }))
  return screen.findByRole('menu')
}

describe('Menu', () => {
  it('opens from its trigger with grouped items, links and a separator', async () => {
    renderMenu()
    const menu = await open()
    expect(menu).toHaveClass('menu', 'account')
    expect(within(menu).getAllByText('Konto')[0]).toHaveClass('menu-label')
    expect(within(menu).getByRole('menuitem', { name: 'Dokumentacja' })).toHaveAttribute('href', '/docs/')
    expect(within(menu).getByRole('menuitem', { name: 'Ustawienia' })).toHaveAttribute('href', '/wiecej')
    expect(within(menu).getByRole('separator')).toHaveClass('menu-sep')
    expect(within(menu).getByRole('menuitem', { name: 'Usuń konto' })).toHaveClass('menu-item', 'menu-danger')
    expect(within(menu).getByRole('menuitem', { name: 'Zostaw otwarte' })).not.toHaveClass('menu-danger')
    expect(within(menu).getByRole('menuitem', { name: 'Niedostępne' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('runs an item and closes, unless the item keeps it open', async () => {
    const { onRemove, onKeep } = renderMenu()
    let menu = await open()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Zostaw otwarte' }))
    expect(onKeep).toHaveBeenCalledOnce()
    expect(screen.getByRole('menu')).toBeInTheDocument()

    menu = screen.getByRole('menu')
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

  it('follows an internal link through the router', async () => {
    renderMenu()
    const menu = await open()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Ustawienia' }))
    expect(await screen.findByRole('heading', { name: 'Więcej' })).toBeInTheDocument()
  })
})
