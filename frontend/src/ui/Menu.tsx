import { ReactElement, ReactNode } from 'react'
import { Menu as BaseMenu } from '@base-ui/react/menu'
import { Link } from 'react-router-dom'
import { cx } from './cx'

/** A dropdown of actions: the account menu, row actions. */
export function Menu({ trigger, children, align = 'end', className }: {
  trigger: ReactElement
  children: ReactNode
  align?: 'start' | 'center' | 'end'
  className?: string
}) {
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner align={align} sideOffset={6} className="pop-positioner">
          <BaseMenu.Popup className={cx('menu', className)}>{children}</BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  )
}

export function MenuItem({ children, onClick, disabled, tone, closeOnClick = true }: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  tone?: 'danger'
  closeOnClick?: boolean
}) {
  return (
    <BaseMenu.Item
      className={cx('menu-item', tone === 'danger' && 'menu-danger')}
      onClick={onClick}
      disabled={disabled}
      closeOnClick={closeOnClick}
    >
      {children}
    </BaseMenu.Item>
  )
}

export function MenuLink({ to, children, external }: { to: string; children: ReactNode; external?: boolean }) {
  return (
    <BaseMenu.LinkItem
      className="menu-item"
      render={external ? <a href={to} /> : <Link to={to} />}
    >
      {children}
    </BaseMenu.LinkItem>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <BaseMenu.GroupLabel className="menu-label">{children}</BaseMenu.GroupLabel>
}

export function MenuGroup({ children }: { children: ReactNode }) {
  return <BaseMenu.Group className="menu-group">{children}</BaseMenu.Group>
}

export function MenuSeparator() {
  return <BaseMenu.Separator className="menu-sep" />
}
