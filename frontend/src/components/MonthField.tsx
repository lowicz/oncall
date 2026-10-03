import { Field, Input } from '../ui'

/** A month field (YYYY-MM in and out) on the browser's native month input. */
export function MonthField({ label, value, onChange, id }: {
  label: string
  value: string
  onChange: (value: string) => void
  id: string
}) {
  return (
    <Field label={label} id={id}>
      {({ id: fieldId, describedBy }) => (
        <Input
          id={fieldId}
          name={fieldId}
          type="month"
          mono
          value={value}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  )
}
