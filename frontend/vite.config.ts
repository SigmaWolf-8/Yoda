import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The Tauri CLI exports TAURI_ENV_* into every hook it runs, so this is set
// during `cargo tauri dev` / `cargo tauri build` and unset in a plain
// `npm run dev`.
const isTauri = !!process.env.TAURI_ENV_PLATFORM

// The backend port. Must agree with BIND_PORT in .env.local — the Tauri shell
// passes that value straight to the sidecar.
const backendPort = process.env.BIND_PORT || '3000'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  // Tauri swallows Vite's screen clearing otherwise, hiding the sidecar logs.
  clearScreen: !isTauri,
  // Expose TAURI_ENV_* to client code alongside the usual VITE_ prefix.
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  server: {
    port: 5173,
    // Fail loudly instead of silently moving to 5174 — tauri.conf.json's
    // devUrl points at 5173 and would otherwise load a blank window.
    strictPort: true,
    // The Replit preview is a proxied iframe, so requests arrive with a
    // foreign Host header; Tauri's dev window is likewise not "localhost".
    allowedHosts: true,
    proxy: {
      '/api': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `ws://localhost:${backendPort}`,
        ws: true,
      },
    },
  },
})
