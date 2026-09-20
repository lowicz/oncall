import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { DateCalendar } from '@mui/x-date-pickers/DateCalendar'
import dayjs, { Dayjs } from 'dayjs'
import 'dayjs/locale/pl'

// Loaded lazily by DateField, for the same reason MonthField.tsx exists
// (QA7-L17): `@mui/x-date-pickers` is the largest dependency in the app and
// DateField is imported eagerly by screens every role lands on. Keeping the
// month grid - and only the month grid - behind a dynamic import means the
// library is fetched when somebody actually opens a calendar, not on first
// paint. It carries its own `LocalizationProvider` so the whole dependency
// stays inside this chunk; `main.tsx` deliberately no longer has one.

/**
 * The month grid a DateField opens. Clicking a day reports it as ISO
 * (`YYYY-MM-DD`), which is what every endpoint and every DateField caller
 * expects; the Polish locale keeps weekday and month names translated.
 */
export default function DateCalendarPanel({ value, onPick, minDate, maxDate }: {
  value: string
  onPick: (value: string) => void
  minDate?: string
  maxDate?: string
}) {
  const selected = value ? dayjs(value) : null
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="pl">
      <DateCalendar
        value={selected?.isValid() ? selected : null}
        // `referenceDate` opens an empty field on the current month instead of
        // an arbitrary one, so the first click is never a month away.
        referenceDate={selected?.isValid() ? undefined : dayjs()}
        minDate={minDate ? dayjs(minDate) : undefined}
        maxDate={maxDate ? dayjs(maxDate) : undefined}
        onChange={(next: Dayjs | null) => {
          if (next && next.isValid()) onPick(next.format('YYYY-MM-DD'))
        }}
      />
    </LocalizationProvider>
  )
}
