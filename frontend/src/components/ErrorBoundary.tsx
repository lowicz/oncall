import { Component, ErrorInfo, ReactNode } from 'react'
import { Button, Icon } from '../ui'

interface State { error: Error | null }

/**
 * The last line of defence against a rendering error. Without it React
 * unmounts the whole tree and the person is left with an empty dark page and
 * no way back; with it the shell stays where it can (the boundary wraps the
 * screen, not the rail) and the fallback names the error and offers a reload.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, State> {
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
    return (
      <div className="page" role="alert">
        <div className="empty empty-error panel">
          <Icon name="alert" size={28} />
          <p className="empty-title">{this.props.label ?? 'Ten ekran przestał działać'}</p>
          <p className="empty-desc">
            Wystąpił błąd w interfejsie, nie w danych. Odśwież stronę; jeśli błąd wróci, zgłoś go z kodem poniżej.
          </p>
          <div className="empty-action">
            <Button variant="primary" size="sm" icon="refresh" onClick={() => window.location.reload()}>Odśwież stronę</Button>
            <Button size="sm" onClick={() => this.setState({ error: null })}>Spróbuj ponownie</Button>
          </div>
          <p className="empty-code">{error.name}: {error.message}</p>
        </div>
      </div>
    )
  }
}
