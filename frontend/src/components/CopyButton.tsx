import { useState } from 'react'
import { Button } from '@mui/material'

export function CopyButton({ value, label = 'Kopiuj' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="small"
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
