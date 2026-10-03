import { Field, Input } from '../ui'

/**
 * A date field: the browser's own picker on a native input. Values are ISO
 * dates in and out, which is also what the API speaks, so no conversion layer
 * sits between the field and the request.
 */
export function DateField({ label, value, onChange, id, required, disabled, minDate, hint }: {
  label: string
  value: string
  onChange: (value: string) => void
  id: string
  required?: boolean
  disabled?: boolean
  minDate?: string
  hint?: string
}) {
  return (
    <Field label={label} id={id} required={required} hint={hint}>
      {({ id: fieldId, describedBy }) => (
        <Input
          id={fieldId}
          name={fieldId}
          type="date"
          mono
          value={value}
          min={minDate}
          required={required}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  )
}
