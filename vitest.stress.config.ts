import { defineConfig } from 'vitest/config'

// The stress test: every MEI sample file through the reader. Separate from
// `npm run test:run` because it needs the downloaded samples (`npm run samples`)
// and takes a minute; the everyday tests must run offline in seconds.
export default defineConfig({
  test: {
    globals: true,
    // Plain Node: the stress test makes its own simulated browser per file.
    environment: 'node',
    include: ['stress/**/*.stress.ts'],
    testTimeout: 600_000,
  },
})
