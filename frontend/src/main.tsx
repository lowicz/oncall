import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
// Self-hosted: an internal application must not fetch fonts from a third-party CDN.
import '@fontsource-variable/inter-tight'
import '@fontsource-variable/jetbrains-mono'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { createQueryClient } from './session'
import { applyPreferences } from './theme'
import { applyLanguage } from './i18n'
import { ToastProvider, TooltipProvider } from './ui'
import './tokens.css'
import './styles.css'

applyPreferences()
applyLanguage()

const queryClient = createQueryClient()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ToastProvider>
          <BrowserRouter>
            <ErrorBoundary scope="app">
              <App />
            </ErrorBoundary>
          </BrowserRouter>
        </ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
