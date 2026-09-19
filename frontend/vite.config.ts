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
        // QA7-L17: one 917 KB bundle with no splitting at all. Lazy-loading
        // the admin screens and the generator (App.tsx) already carves their
        // own code out; this carves the handful of large, rarely-changing
        // vendor libraries into their own cacheable chunks so what is left
        // in the main chunk is this app's own eagerly-loaded code.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@mui/x-date-pickers')) return 'date-pickers'
          if (id.includes('@mui/icons-material')) return 'mui-icons'
          if (id.includes('@mui') || id.includes('@emotion')) return 'mui-vendor'
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) {
            return 'react-vendor'
          }
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
