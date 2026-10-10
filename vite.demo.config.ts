import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Builds the demo page (index.html → demo/main.tsx) as a static site, for
// hosting on Vercel. `npm run build` is different: it builds the library that
// other sites install.
export default defineConfig({
  plugins: [react()],
  // The demo's own public folder, not the default one at the root, so the
  // library build never copies the sampled instruments into the package.
  publicDir: 'demo/public',
  build: { outDir: 'dist-demo' },
})
