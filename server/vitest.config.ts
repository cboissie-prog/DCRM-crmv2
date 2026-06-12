import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: './tests/global-setup.ts',
    setupFiles: ['./tests/setup-env.ts'],
    fileParallelism: false,
    testTimeout: 15000,
    // Run tests sequentially — SQLite, single DB
    singleFork: true,
  },
})
