import { ReactNode } from 'react'
import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import { cx } from './cx'

export interface TabItem<T extends string> {
  value: T
  label: ReactNode
  count?: number
  disabled?: boolean
}

/** Underlined tabs in a section heading: inbox filters, lenses, panel sections. */
export function Tabs<T extends string>({ value, onChange, items, label, children, className }: {
  value: T
  onChange: (value: T) => void
  items: TabItem<T>[]
  label: string
  children?: ReactNode
  className?: string
}) {
  return (
    <BaseTabs.Root value={value} onValueChange={(next) => onChange(next as T)} className={cx('tabs', className)}>
      <BaseTabs.List className="tabs-list" aria-label={label}>
        {items.map((item) => (
          <BaseTabs.Tab key={item.value} value={item.value} className="tab" disabled={item.disabled}>
            {item.label}
            {item.count !== undefined && <span className="tab-count">{item.count}</span>}
          </BaseTabs.Tab>
        ))}
        <BaseTabs.Indicator className="tabs-indicator" />
      </BaseTabs.List>
      {children}
    </BaseTabs.Root>
  )
}

export function TabPanel<T extends string>({ value, children, className }: { value: T; children: ReactNode; className?: string }) {
  return <BaseTabs.Panel value={value} className={cx('tab-panel', className)}>{children}</BaseTabs.Panel>
}
