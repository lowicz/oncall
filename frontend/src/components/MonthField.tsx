import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import dayjs, { Dayjs } from 'dayjs'
import 'dayjs/locale/pl'

// Split out of DateField.tsx (QA7-L17): this is the only caller of
// `@mui/x-date-pickers` left in the app, and DateField.tsx is imported
// eagerly by screens well outside the admin report panel that is this
// component's only user. It carries its own `LocalizationProvider` (moved
// out of `main.tsx`, which no longer needs it) so the whole dependency stays
// inside this lazy-loaded chunk instead of the main bundle.

/** "wrzesień 2026", never "September 2026". */
export function MonthField({ label, value, onChange, id }: {
  label: string
  value: string
  onChange: (value: string) => void
  id: string
}) {
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="pl">
      <DatePicker
        label={label}
        views={['year', 'month']}
        openTo="month"
        format="MM-YYYY"
        value={value ? dayjs(`${value}-01`) : null}
        onChange={(next: Dayjs | null) => {
          if (next && next.isValid()) onChange(next.format('YYYY-MM'))
        }}
        slotProps={{ textField: { id, name: id } }}
      />
    </LocalizationProvider>
  )
}
