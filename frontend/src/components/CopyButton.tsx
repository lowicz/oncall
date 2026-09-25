import { useState } from 'react'
import { Button, ButtonProps } from '../ui'
import { useMessages } from '../i18n'

export function CopyButton({ value, label, ...rest }: { value: string; label?: string } & Omit<ButtonProps, 'onClick' | 'children'>) {
  const t = useMessages()
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
      {copied ? t.common.copied : label ?? t.common.copy}
    </Button>
  )
}
