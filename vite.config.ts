import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          const normalized = id.replaceAll('\\\\', '/')
          if (normalized.includes('/node_modules/@uiw/')) return 'editor-ui'
          if (normalized.includes('/node_modules/@codemirror/state/') || normalized.includes('/node_modules/@codemirror/view/')) return 'editor-core'
          if (normalized.includes('/node_modules/@codemirror/')) return 'editor-extensions'
          if (normalized.includes('/node_modules/react-markdown/') || normalized.includes('/node_modules/remark-gfm/')) return 'markdown-vendor'
          if (normalized.includes('/node_modules/lucide-react/')) return 'icons-vendor'
          if (normalized.includes('/node_modules/react-dom/') || normalized.includes('/node_modules/react/')) return 'react-vendor'
          return undefined
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_'],
})
