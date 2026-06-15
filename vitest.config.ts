// vitest.config.ts
// Minimal Vitest setup. Excludes Supabase Edge Functions and the
// untracked root copy of the AI function. Path alias mirrors tsconfig.

import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: [
      'node_modules/**',
      '.next/**',
      'supabase/functions/**',
      'pokeprices-chat-edge-function.ts',
      'scripts/**',
      'seo/**',
    ],
    // No network: any test that hits the wire should fail fast.
    testTimeout: 5000,
    hookTimeout: 5000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
