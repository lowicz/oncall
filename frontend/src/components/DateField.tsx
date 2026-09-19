import { useEffect, useState } from 'react'
import { TextField } from '@mui/material'
import dayjs from 'dayjs'

/**
 * A date input that always reads DD-MM-YYYY.
 *
 * The native `<input type="date">` renders in the *browser's* locale, not the
 * page's, so the same Polish screen showed MM/DD/YYYY on an en-US machine and
 * DD.MM.YYYY on a Polish one. The value stays ISO (`YYYY-MM-DD`) on the wire,
 * which is what every endpoint expects.
 */
export const DATE_FORMAT = 'DD-MM-YYYY'

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
  const complete = draft.replace(/\D/g, '').length === 8
  const invalid = complete && parseDate(draft) === null
  useEffect(() => setDraft(displayDate(value)), [value])
  return (
    <TextField
      label={label}
      value={draft}
      disabled={disabled}
      required={required}
      error={invalid}
      helperText={invalid ? 'Nieprawidłowa data' : 'Format: DD-MM-RRRR'}
      id={id}
      name={id}
      placeholder="DD-MM-RRRR"
      inputProps={{ inputMode: 'numeric', maxLength: 10 }}
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
  )
}
