// Dev server for end-to-end tests: the app talks to its own origin, and this
// proxies each Supabase service to the local stack (functions to local Deno).
import { defineConfig, mergeConfig } from 'vite'
import base from '../vite.config.js'

const SUPABASE = 'http://127.0.0.1:54321'

export default mergeConfig(base, defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/functions/v1/shift-brief': { target: 'http://127.0.0.1:8000', rewrite: () => '/' },
      '/auth/v1': SUPABASE,
      '/rest/v1': SUPABASE,
      '/storage/v1': SUPABASE,
      '/realtime/v1': { target: SUPABASE, ws: true },
    },
  },
}))
