import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { MONTHS_SHORT } from '../lib/dates'
import { Access, docsHref, visibleFor, allNav } from '../lib/nav'
import { Icon, IconName, cx } from '../ui'
import { ThemeMode, themeModeLabels, useThemeMode } from '../theme'

interface Item {
  id: string
  group: string
  label: string
  hint?: string
  icon: IconName
  run: () => void
}

function isoDay(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1) return null
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (day > daysInMonth) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** "2026-09-24", "24-09-2026", "24 wrz" or "24.09" as an ISO date, or null. */
export function parseDayQuery(query: string, today = new Date()): string | null {
  const text = query.trim().toLowerCase()
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (match) return isoDay(Number(match[1]), Number(match[2]), Number(match[3]))
  match = /^(\d{1,2})[-.](\d{1,2})(?:[-.](\d{4}))?$/.exec(text)
  if (match) {
    const year = match[3] ? Number(match[3]) : today.getFullYear()
    return isoDay(year, Number(match[2]), Number(match[1]))
  }
  match = /^(\d{1,2})\s+([a-ząćęłńóśźż]{3})[a-ząćęłńóśźż]*(?:\s+(\d{4}))?$/.exec(text)
  if (match) {
    const month = MONTHS_SHORT.indexOf(match[2])
    if (month < 0) return null
    const year = match[3] ? Number(match[3]) : today.getFullYear()
    return isoDay(year, month + 1, Number(match[1]))
  }
  return null
}

/**
 * Ctrl K: screens, people, a day, a few actions. Typing a person jumps to
 * their row in the schedule; typing a date opens that day. The list is
 * keyboard-first: arrows move, Enter runs, Escape closes.
 */
export function CommandPalette({ open, onOpenChange, access, onLogout }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  access: Access
  onLogout: () => void
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const [, setThemeMode] = useThemeMode()
  const schedule = useQuery({ queryKey: ['published-schedule'], queryFn: api.publishedSchedule, enabled: open })

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
    }
  }, [open])

  const people = useMemo(() => {
    const names = new Set<string>()
    for (const assignment of schedule.data?.assignments ?? []) names.add(assignment.assignee_name)
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'pl'))
  }, [schedule.data])

  const items = useMemo<Item[]>(() => {
    const close = () => onOpenChange(false)
    const list: Item[] = []
    const day = parseDayQuery(query)
    if (day) {
      list.push({ id: `day-${day}`, group: 'Dzień', label: `Otwórz ${day}`, hint: 'grafik, inspektor dnia', icon: 'calendar', run: () => { close(); navigate(`/grafik?dzien=${day}`) } })
    }
    const q = query.trim().toLowerCase()
    for (const item of visibleFor(allNav, access)) {
      if (!q || item.label.toLowerCase().includes(q)) {
        list.push({ id: `nav-${item.path}`, group: 'Ekrany', label: item.label, icon: item.icon, run: () => { close(); navigate(item.path) } })
      }
    }
    for (const name of people) {
      if (q && name.toLowerCase().includes(q)) {
        list.push({ id: `person-${name}`, group: 'Osoby', label: name, hint: 'pokaż w grafiku', icon: 'user', run: () => { close(); navigate(`/grafik?osoba=${encodeURIComponent(name)}`) } })
      }
    }
    const actions: Item[] = [
      ...(['dark', 'light', 'system'] as ThemeMode[]).map((mode) => ({
        id: `theme-${mode}`, group: 'Akcje', label: `Motyw: ${themeModeLabels[mode].toLowerCase()}`, icon: (mode === 'dark' ? 'moon' : mode === 'light' ? 'sun' : 'monitor') as IconName, run: () => { setThemeMode(mode); close() },
      })),
      { id: 'docs', group: 'Akcje', label: 'Dokumentacja', icon: 'doc', run: () => { close(); window.location.assign(docsHref) } },
      { id: 'logout', group: 'Akcje', label: 'Wyloguj', icon: 'logout', run: () => { close(); onLogout() } },
    ]
    for (const action of actions) {
      if (!q || action.label.toLowerCase().includes(q) || q.startsWith('>')) list.push(action)
    }
    return list
  }, [query, access, people, navigate, onOpenChange, setThemeMode, onLogout])

  const clamped = Math.min(active, Math.max(0, items.length - 1))

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((current) => Math.min(current + 1, items.length - 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((current) => Math.max(current - 1, 0)) }
    else if (event.key === 'Enter') { event.preventDefault(); items[clamped]?.run() }
  }

  let lastGroup = ''
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange} modal>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="dialog-backdrop" />
        <BaseDialog.Popup className="pal-popup" aria-label="Paleta poleceń" initialFocus={inputRef}>
          <div className="pal-in">
            <Icon name="search" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => { setQuery(event.target.value); setActive(0) }}
              onKeyDown={onKeyDown}
              placeholder="Osoba, dzień (24 wrz, 2026-09-24), ekran, akcja…"
              aria-label="Szukaj"
              role="combobox"
              aria-expanded="true"
              aria-controls="pal-list"
              aria-activedescendant={items[clamped] ? `pal-${items[clamped].id}` : undefined}
              autoComplete="off"
            />
            <span className="kbd">Esc</span>
          </div>
          <ul className="pal-list" id="pal-list" role="listbox" aria-label="Wyniki">
            {items.length === 0 && <li className="pal-empty">Nic nie pasuje. Wpisz nazwisko, datę albo nazwę ekranu.</li>}
            {items.map((item, index) => {
              const showGroup = item.group !== lastGroup
              lastGroup = item.group
              return (
                <li key={item.id} role="presentation">
                  {showGroup && <div className="pal-grp" aria-hidden="true">{item.group}</div>}
                  <div
                    id={`pal-${item.id}`}
                    role="option"
                    aria-selected={index === clamped}
                    className={cx('pal-it')}
                    onMouseEnter={() => setActive(index)}
                    onClick={item.run}
                  >
                    <Icon name={item.icon} />
                    <span>{item.label}</span>
                    {item.hint && <span className="pal-t">{item.hint}</span>}
                  </div>
                </li>
              )
            })}
          </ul>
          <div className="pal-foot">
            <span><span className="kbd">↑↓</span> wybór</span>
            <span><span className="kbd">↵</span> otwórz</span>
            <span><span className="kbd">Esc</span> zamknij</span>
          </div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
