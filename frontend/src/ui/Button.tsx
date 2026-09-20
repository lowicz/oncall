import { ButtonHTMLAttributes, ReactNode, forwardRef } from 'react'
import { Link, LinkProps } from 'react-router-dom'
import { cx } from './cx'
import { Icon, IconName } from './Icon'

export type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger'
export type ButtonSize = 'md' | 'sm'

interface ButtonOwnProps {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Shows a spinner and disables the button while an action is pending. */
  loading?: boolean
  icon?: IconName
  /** Stretches the button to its container: phone action rows. */
  block?: boolean
}

export type ButtonProps = ButtonOwnProps & ButtonHTMLAttributes<HTMLButtonElement>

function classes({ variant = 'default', size = 'md', block }: ButtonOwnProps, extra?: string) {
  return cx(
    'btn',
    variant === 'primary' && 'btn-pri',
    variant === 'ghost' && 'btn-ghost',
    variant === 'danger' && 'btn-danger',
    size === 'sm' && 'btn-sm',
    block && 'btn-block',
    extra,
  )
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, loading, icon, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={classes({ variant, size, block }, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  )
})

/** A square icon-only button; `label` is what a screen reader and the tooltip say. */
export const IconButton = forwardRef<HTMLButtonElement, {
  label: string
  icon: IconName
  size?: ButtonSize
  active?: boolean
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>>(function IconButton(
  { label, icon, size = 'md', active, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('ib', size === 'sm' && 'ib-sm', active && 'ib-on', className)}
      aria-label={label}
      title={label}
      aria-pressed={active}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  )
})

/** Router link styled as a button. */
export function LinkButton({ variant, size, block, icon, className, children, ...rest }:
  ButtonOwnProps & LinkProps & { children?: ReactNode }) {
  return (
    <Link className={classes({ variant, size, block }, className)} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </Link>
  )
}

/** Plain anchor styled as a button: documentation, downloads, ICS. */
export function AnchorButton({ variant, size, block, icon, className, children, ...rest }:
  ButtonOwnProps & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className={classes({ variant, size, block }, className)} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </a>
  )
}

export function Spinner({ label }: { label?: string }) {
  return <span className="spinner" role={label ? 'status' : undefined} aria-label={label} />
}
