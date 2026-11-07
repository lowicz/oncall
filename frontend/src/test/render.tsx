import { ReactNode, createContext, useContext } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { ToastProvider, TooltipProvider } from '../ui'

const RoutedContent = createContext<ReactNode>(null)

// Test-only route element; hot reload is irrelevant in Vitest.
// eslint-disable-next-line react-refresh/only-export-components
function TestRoute() {
  return <>{useContext(RoutedContent)}</>
}

/** Renders a screen with the same providers the real shell supplies. */
export function renderScreen(ui: ReactNode, { route = '/' }: { route?: string } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const router = createMemoryRouter(
    [{ path: '*', element: <TestRoute /> }],
    { initialEntries: [route] },
  )
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ToastProvider>
            <RoutedContent.Provider value={children}>
              <RouterProvider router={router} />
            </RoutedContent.Provider>
          </ToastProvider>
        </TooltipProvider>
      </QueryClientProvider>
    )
  }
  const view = render(ui, { wrapper: Providers })
  return { ...view, queryClient }
}
