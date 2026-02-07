import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        content: 'src/chrome/content.ts',
        background: 'src/chrome/background.ts'
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    }
  },
  server: {
    proxy: {
      "/generate-text": "http://localhost:3001",
      "/msg": "http://localhost:8787",
      "/ping": "http://localhost:8787"
    }
  }
})
