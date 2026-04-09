import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/react-router')) return 'vendor'
          if (id.includes('@tanstack')) return 'query'
          if (id.includes('recharts') || id.includes('d3-')) return 'charts'
          if (id.includes('@hello-pangea')) return 'dnd'
          if (id.includes('react-hook-form') || id.includes('@hookform') || id.includes('/zod/')) return 'forms'
          if (id.includes('lucide-react')) return 'icons'
          if (id.includes('date-fns') || id.includes('/clsx/') || id.includes('tailwind-merge') || id.includes('/zustand/')) return 'utils'
        },
      },
    },
  },
})
