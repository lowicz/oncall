import { createTheme } from '@mui/material/styles'

// Fonts are self-hosted through @fontsource; the variable Inter build registers
// itself as 'Inter Variable', so that exact name has to lead the stack.
const sansStack = [
  '"Inter Variable"',
  'Inter',
  'system-ui',
  '-apple-system',
  'BlinkMacSystemFont',
  '"Segoe UI"',
  'sans-serif',
].join(', ')

export const theme = createTheme({
  // With both light and dark schemes MUI would default to the 'media' selector,
  // which ignores defaultMode. The attribute selector keeps dark the default.
  cssVariables: { colorSchemeSelector: 'data-mui-color-scheme' },
  colorSchemes: {
    dark: {
      palette: {
        // White on #3a8dde is only 3.47:1 and fails WCAG AA. The blue stays as the
        // accent (focus rings and the calendar tokens are built on it) and contained
        // buttons take dark text instead, which reaches 5.38:1.
        primary: { main: '#3a8dde', contrastText: '#08131f' },
        background: { default: '#08131f', paper: '#0e1c2b' },
        text: { primary: '#edf5fc', secondary: '#94a9bc' },
      },
    },
    light: {
      palette: {
        primary: { main: '#005ea8', contrastText: '#ffffff' },
        // MUI's default warning (#ed6c02) is 3.1:1 on white and fails AA for
        // body text; the criterion verdict „nie spełnia" on the fairness
        // screen is exactly that. This one reaches 5.9:1 and still reads amber.
        warning: { main: '#a04e00', contrastText: '#ffffff' },
        background: { default: '#f4f7fa', paper: '#ffffff' },
        text: { primary: '#122232', secondary: '#526779' },
      },
    },
  },
  typography: {
    fontFamily: sansStack,
    h1: { fontSize: '1.75rem', fontWeight: 650, letterSpacing: '-0.025em' },
    h2: { fontSize: '1.1rem', fontWeight: 650 },
    button: { textTransform: 'none', fontWeight: 650 },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
  },
})
