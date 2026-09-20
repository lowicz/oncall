import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
// Self-hosted: an internal application must not fetch fonts from a third-party CDN.
import '@fontsource-variable/inter-tight'
import '@fontsource-variable/jetbrains-mono'
import { App } from './App'
import { applyPreferences } from './theme'
import { ToastProvider, TooltipProvider } from './ui'
import './tokens.css'
import './styles.css'

applyPreferences()

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ToastProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
