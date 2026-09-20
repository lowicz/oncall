import { useState } from 'react'
import { Button, ButtonProps } from '../ui'

export function CopyButton({ value, label = 'Kopiuj', ...rest }: { value: string; label?: string } & Omit<ButtonProps, 'onClick' | 'children'>) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="sm"
      icon={copied ? 'check' : 'copy'}
      {...rest}
      onClick={async () => {
        await navigator.clipboard.writeText(value)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2000)
      }}
    >
      {copied ? 'Skopiowano' : label}
    </Button>
  )
}
