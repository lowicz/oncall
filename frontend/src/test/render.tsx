import { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import 'dayjs/locale/pl'
import { render } from '@testing-library/react'
import { theme } from '../theme'

/** Renders a screen with the same providers the real shell supplies. */
export function renderScreen(ui: ReactNode, { route = '/' }: { route?: string } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <ThemeProvider theme={theme} defaultMode="dark">
      <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="pl">
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
        </QueryClientProvider>
      </LocalizationProvider>
    </ThemeProvider>,
  )
}
