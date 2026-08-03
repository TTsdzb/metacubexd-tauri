import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['shim/__tests__/**/*.spec.ts'],
  },
})
