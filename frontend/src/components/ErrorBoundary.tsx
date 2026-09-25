import { Component, ErrorInfo, ReactNode } from 'react'
import { Button, Icon } from '../ui'
import { messages } from '../i18n'

interface State { error: Error | null }

/**
 * The last line of defence against a rendering error. Without it React
 * unmounts the whole tree and the person is left with an empty dark page and
 * no way back; with it the shell stays where it can (the boundary wraps the
 * screen, not the rail) and the fallback names the error and offers a reload.
 * The words are read when the fallback renders (a class component has no
 * hooks), which is fine: the language cannot change on a page that crashed.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; scope?: 'app' | 'screen' }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const t = messages().common
    return (
      <div className="page" role="alert">
        <div className="empty empty-error panel">
          <Icon name="alert" size={28} />
          <p className="empty-title">{this.props.scope === 'app' ? t.appCrashed : t.screenCrashed}</p>
          <p className="empty-desc">
            {t.crashExplanation}
          </p>
          <div className="empty-action">
            <Button variant="primary" size="sm" icon="refresh" onClick={() => window.location.reload()}>{t.reloadPage}</Button>
            <Button size="sm" onClick={() => this.setState({ error: null })}>{t.retry}</Button>
          </div>
          <p className="empty-code">{error.name}: {error.message}</p>
        </div>
      </div>
    )
  }
}
