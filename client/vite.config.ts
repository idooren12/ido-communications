import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Large libraries get their own long-lived chunks, so an app deploy doesn't force
// users to re-download them, and pages that don't need them never load them.
// Only self-contained libraries go here: forcing a library that shares dependencies with
// the app (React, helpers) into a manual chunk makes the entry chunk import it eagerly.
const VENDOR_CHUNKS: Record<string, string> = {
  'maplibre-gl': 'vendor-maplibre',
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:3001'
    }
  },
  build: {
    // MapLibre alone is ~900 kB minified; it is isolated in vendor-maplibre and only
    // loaded on the LOS page.
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const match = id.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)
          return match ? VENDOR_CHUNKS[match[1]] : undefined
        },
      },
    },
  },
})
