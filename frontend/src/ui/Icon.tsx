import { cx } from './cx'

/**
 * The interface's own icon set: 1.8-px strokes on a 24-px grid, drawn inline
 * so no icon font or icon package is downloaded. Names are what the icon
 * means, not what it looks like.
 */
const PATHS: Record<string, string> = {
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  calendar: 'M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 10h18M8 2v4M16 2v4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  people: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM3 20a6 6 0 0 1 12 0M13 19a5 5 0 0 1 8 0',
  swap: 'M4 7h13l-3-3M20 17H7l3 3',
  wand: 'M4 20l6-6M14 4l6 6-9 9H5v-6z',
  chart: 'M3 20h18M6 16V9M12 16V5M18 16v-7',
  report: 'M4 4h16v16H4zM4 10h16M10 4v16',
  upload: 'M12 15V3M6 9l6-6 6 6M4 21h16',
  download: 'M12 3v12M6 9l6 6 6-6M4 21h16',
  event: 'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v13H3zM3 11h18M9 15h6',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  audit: 'M12 3l9 4-9 4-9-4zM3 12l9 4 9-4M3 17l9 4 9-4',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M12 3a9 9 0 1 0 9 9c-5 0-9-4-9-9z',
  monitor: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8 21h8M12 17v4',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-up': 'M6 15l6-6 6 6',
  'chevron-left': 'M15 6l-6 6 6 6',
  'chevron-right': 'M9 6l6 6-6 6',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5 9-10',
  alert: 'M12 3l10 18H2zM12 10v4M12 17h.01',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  external: 'M14 4h6v6M20 4l-9 9M19 14v6H4V5h6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.4 3h-4l-.4 2.6a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L5.9 11a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6a7 7 0 0 0 .1-1z',
  logout: 'M10 4H5v16h5M14 8l4 4-4 4M18 12H9',
  doc: 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h6M9 16h6',
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  sms: 'M4 4h16v11H9l-5 4z',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
}

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 16, className, title }: {
  name: IconName
  size?: number
  className?: string
  /** Set when the icon carries meaning on its own; otherwise it is decorative. */
  title?: string
}) {
  const d = PATHS[name]
  return (
    <svg
      className={cx('icon', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title && <title>{title}</title>}
      <path d={d} />
    </svg>
  )
}

/** The product mark: a signal-coloured square with "E/". Same drawing as the
 *  favicon so the tab and the rail agree. */
export function Mark({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <svg className={cx('mark', className)} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="14" fill="var(--sig)" />
      <path fill="var(--sig-ink)" d="M12 16h20v6H19v7h11v6H19v7h13v6H12z" />
      <path fill="var(--sig-ink)" d="M44 16h7L42 48h-7z" />
    </svg>
  )
}
