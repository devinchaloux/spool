import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

// `npm run dev` serves the demo (index.html → demo/main.tsx).
// `npm run build` builds the library from src/index.ts; the demo is not part of it.
export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: path.resolve(import.meta.dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'mei-piano-roll',
    },
    rollupOptions: {
      // React comes from the page that embeds the roll, never from this bundle:
      // two copies of React on one page break hooks.
      // smplr (the sample player) is a normal dependency: installed alongside,
      // and still loaded only when a sampled sound is chosen (a dynamic import).
      external: ['react', 'react-dom', 'react/jsx-runtime', 'smplr'],
    },
  },
  test: {
    globals: true,
    // Plain Node by default; a file that needs a DOM (the MEI reader uses the
    // browser's XML parser) says so on its first line:  // @vitest-environment jsdom
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'demo/**/*.test.ts'],
  },
})
