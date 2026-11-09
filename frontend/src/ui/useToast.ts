import { ReactNode, useCallback, useMemo } from 'react'
import { Toast as BaseToast } from '@base-ui/react/toast'

export type Tone = 'ok' | 'warn' | 'bad' | 'info'

export interface ToastOptions {
  description?: ReactNode
  action?: { label: string; onClick: () => void }
  timeout?: number
  /** When the action expires: the toast counts down to `at`, and at `at` it
   *  drops the action and shows `expired` in place of its description, even
   *  while hover or focus keeps it open. */
  until?: { at: number; expired: ReactNode }
}

export type ToastApi = ReturnType<typeof useToast>

/** What a toast carries beside its words: how long its action lasts, drawn as a bar. */
export interface ToastData {
  countdownMs?: number
}

export function useToast() {
  const manager = BaseToast.useToastManager()
  const show = useCallback((tone: Tone, title: ReactNode, options?: ToastOptions) => {
    const until = options?.until
    const id = manager.add<ToastData>({
      type: tone,
      data: until ? { countdownMs: Math.max(1, until.at - Date.now()) } : undefined,
      title,
      description: options?.description,
      timeout: until ? Math.max(1, until.at - Date.now()) : options?.timeout,
      actionProps: options?.action ? { children: options.action.label, onClick: options.action.onClick } : undefined,
    })
    if (until) setTimeout(() => manager.update(id, (toast) => {
      const root = toast.ref?.current
      if (root?.contains(document.activeElement)) root.querySelector<HTMLElement>('.ib')?.focus()
      return { description: until.expired, actionProps: undefined, data: undefined }
    }), until.at - Date.now())
    return id
  }, [manager])
  return useMemo(() => ({
    success: (title: ReactNode, options?: ToastOptions) => show('ok', title, options),
    warn: (title: ReactNode, options?: ToastOptions) => show('warn', title, options),
    error: (title: ReactNode, options?: ToastOptions) => show('bad', title, { timeout: 10000, ...options }),
    info: (title: ReactNode, options?: ToastOptions) => show('info', title, options),
    close: manager.close,
  }), [manager.close, show])
}
