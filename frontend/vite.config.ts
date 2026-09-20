/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
  },
})
