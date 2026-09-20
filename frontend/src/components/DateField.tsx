import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { Box, CircularProgress, IconButton, InputAdornment, Popover, TextField } from '@mui/material'
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined'
import dayjs from 'dayjs'

/**
 * A date input that always reads DD-MM-YYYY, typed or picked from a calendar.
 *
 * The native `<input type="date">` renders in the *browser's* locale, not the
 * page's, so the same Polish screen showed MM/DD/YYYY on an en-US machine and
 * DD.MM.YYYY on a Polish one. The value stays ISO (`YYYY-MM-DD`) on the wire,
 * which is what every endpoint expects.
 *
 * The text field is the source of truth for typing; the calendar button opens
 * a Polish month grid (DateCalendarPanel, loaded on demand) and reports the
 * day clicked through the very same `onChange`, so typing a date and picking
 * one end in the same code path - and in the same form submission.
 */
export const DATE_FORMAT = 'DD-MM-YYYY'

const DateCalendarPanel = lazy(() => import('./DateCalendarPanel'))

const displayDate = (value: string) => value ? dayjs(value).format(DATE_FORMAT) : ''

const parseDate = (raw: string): string | null => {
  const digits = raw.replace(/\D/g, '')
  if (digits.length !== 8) return null
  const day = digits.slice(0, 2)
  const month = digits.slice(2, 4)
  const year = digits.slice(4)
  const iso = `${year}-${month}-${day}`
  const parsed = dayjs(iso)
  return parsed.isValid() && parsed.format('YYYY-MM-DD') === iso ? iso : null
}

export function DateField({ label, value, onChange, id, required, disabled, minDate, maxDate }: {
  label: string
  value: string
  onChange: (value: string) => void
  id: string
  required?: boolean
  disabled?: boolean
  minDate?: string
  maxDate?: string
}) {
  const [draft, setDraft] = useState(displayDate(value))
  const [calendarOpen, setCalendarOpen] = useState(false)
  const anchor = useRef<HTMLDivElement | null>(null)
  const complete = draft.replace(/\D/g, '').length === 8
  const invalid = complete && parseDate(draft) === null
  useEffect(() => setDraft(displayDate(value)), [value])
  return (
    <>
      <TextField
        ref={anchor}
        label={label}
        value={draft}
        disabled={disabled}
        required={required}
        error={invalid}
        helperText={invalid ? 'Nieprawidłowa data' : 'Format: DD-MM-RRRR'}
        id={id}
        name={id}
        placeholder="DD-MM-RRRR"
        slotProps={{
          htmlInput: { inputMode: 'numeric', maxLength: 10 },
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  aria-label="Wybierz datę"
                  edge="end"
                  size="small"
                  disabled={disabled}
                  onClick={() => setCalendarOpen(true)}
                >
                  <CalendarMonthOutlined fontSize="small" />
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
        onChange={(event) => {
          const raw = event.target.value
          setDraft(raw)
          const parsed = parseDate(raw)
          if (!parsed) return
          if (minDate && parsed < minDate) return
          if (maxDate && parsed > maxDate) return
          onChange(parsed)
        }}
      />
      <Popover
        open={calendarOpen}
        anchorEl={anchor.current}
        onClose={() => setCalendarOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { 'aria-label': `Kalendarz: ${label}` } }}
      >
        <Suspense
          fallback={(
            <Box className="date-calendar-loading">
              <CircularProgress size={24} aria-label="Wczytywanie kalendarza" />
            </Box>
          )}
        >
          <DateCalendarPanel
            value={value}
            minDate={minDate}
            maxDate={maxDate}
            onPick={(picked) => {
              setCalendarOpen(false)
              onChange(picked)
            }}
          />
        </Suspense>
      </Popover>
    </>
  )
}
