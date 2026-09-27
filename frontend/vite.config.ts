import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// The product runs on Europe/Warsaw time: every date is formatted in that zone
// (`warsawDate()`), and the "until" countdown in the now-strip is built from
// local-time Dates. Pin the test runner to the same zone so the snapshots and
// the time maths are deterministic on any machine, not just a Warsaw laptop
// (CI runs in UTC, which shifted the countdown by the CEST offset).
process.env.TZ = 'Europe/Warsaw'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
  build: {
    rollupOptions: {
      output: {
        // QA7-L17: one bundle with no splitting at all. Lazy-loading the
        // admin screens and the generator (App.tsx) already carves their own
        // code out; this carves the large, rarely-changing vendor libraries
        // into their own cacheable chunks so what is left in the main chunk
        // is this app's own eagerly-loaded code.
        manualChunks(id) {
          const match = /node_modules\/(@[^/]+\/[^/]+|[^/]+)\//.exec(id)
          if (!match) return undefined
          const pkg = match[1]
          if (pkg.startsWith('@base-ui/')) return 'ui-vendor'
          if (pkg === 'react' || pkg === 'react-dom' || pkg === 'scheduler') return 'react-vendor'
          return 'vendor'
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // `npm test -- --coverage` (CI) writes coverage/lcov.info for SonarCloud.
    // Paths in it are relative to the repository root, where the scan runs.
    // Every line and branch of the application is exercised, and the
    // thresholds keep it so. The translation catalogs are data, excluded here
    // as in sonar-project.properties: the Polish baseline reads the Polish
    // strings, and the English arrows mirror them key for key.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/i18n/pl/**', 'src/i18n/en/**'],
      reporter: ['text-summary', ['lcov', { projectRoot: '..' }]],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
})
