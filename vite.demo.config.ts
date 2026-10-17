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
  build: {
    outDir: 'dist-demo',
    // Two pages: the studio (index.html) and the player alone, for other
    // sites to put in an iframe (embed.html, served at /embed).
    rollupOptions: { input: { main: 'index.html', embed: 'embed.html' } },
    // Verovio's chunk is about 8 MB (2.4 MB compressed); it loads only when a
    // file needs it, so its size is expected.
    chunkSizeWarningLimit: 9000,
  },
})
