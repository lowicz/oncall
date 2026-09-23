import { ReactNode } from 'react'
import { useBranding, useDocumentTitle } from '../hooks/useBranding'
import { Mark } from '../ui'
import { docsHref } from '../lib/nav'

/** The frame around the screens shown before a session exists: the mark, a
 *  headline, a card, and the small print. */
export function AuthFrame({ title, sub, children, screen }: {
  title: ReactNode
  sub?: ReactNode
  children: ReactNode
  screen: string
}) {
  const branding = useBranding()
  useDocumentTitle(screen, branding.name)
  return (
    <div className="login">
      <div className="login-box">
        <Mark size={40} />
        <div>
          <h1 className="login-title">{title}</h1>
          <p className="login-sub">
            {branding.name}
            {branding.subtitle && <> · {branding.subtitle}</>}
            {sub && <> · {sub}</>}
          </p>
        </div>
        {children}
        <div className="login-foot">
          <a href={docsHref}>Dokumentacja</a>
        </div>
      </div>
    </div>
  )
}
