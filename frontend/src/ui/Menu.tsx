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

/**
 * The heading of a group of items. Base UI ties it to the group through
 * context and throws when the label is rendered on its own, which is what
 * blanked the whole application when the account menu opened. So the label
 * is only ever exposed as part of `MenuGroup` / `MenuRadioGroup`.
 */
function GroupLabel({ children }: { children: ReactNode }) {
  return <BaseMenu.GroupLabel className="menu-label">{children}</BaseMenu.GroupLabel>
}

export function MenuGroup({ label, children }: { label?: ReactNode; children: ReactNode }) {
  return (
    <BaseMenu.Group className="menu-group">
      {label && <GroupLabel>{label}</GroupLabel>}
      {children}
    </BaseMenu.Group>
  )
}

/**
 * One choice out of a few, kept open after picking so the effect can be seen
 * (the theme, the matrix density). Announced as a radio group.
 */
export function MenuRadioGroup<T extends string>({ label, value, onChange, options }: {
  label: ReactNode
  value: T
  onChange: (value: T) => void
  options: Array<{ value: T; label: ReactNode; disabled?: boolean }>
}) {
  return (
    <BaseMenu.RadioGroup className="menu-group" value={value} onValueChange={(next) => onChange(next as T)}>
      <GroupLabel>{label}</GroupLabel>
      {options.map((option) => (
        <BaseMenu.RadioItem
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          closeOnClick={false}
          className="menu-item menu-radio"
        >
          <BaseMenu.RadioItemIndicator className="menu-check" keepMounted>
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
              <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </BaseMenu.RadioItemIndicator>
          {option.label}
        </BaseMenu.RadioItem>
      ))}
    </BaseMenu.RadioGroup>
  )
}

export function MenuSeparator() {
  return <BaseMenu.Separator className="menu-sep" />
}
