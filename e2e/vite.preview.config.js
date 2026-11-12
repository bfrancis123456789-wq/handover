// `vite preview` for the CSP check: the production build with the headers from
// public/_headers, proxied to the local Supabase stack like the e2e dev server.
import { defineConfig, mergeConfig } from 'vite'
import { readFileSync } from 'node:fs'
import e2e from './vite.e2e.config.js'

const headers = JSON.parse(readFileSync(new URL('./.preview-headers.json', import.meta.url), 'utf8'))
delete headers['Strict-Transport-Security'] // not meaningful on http://localhost

export default mergeConfig(e2e, defineConfig({
  preview: { headers, proxy: e2e.server.proxy },
}))
