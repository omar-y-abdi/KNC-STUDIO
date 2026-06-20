import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

// Hardened production build:
//  - no sourcemaps shipped (the "obscured" ceiling: minify + mangle, honestly stated)
//  - terser compress+mangle, comments stripped, console/debugger dropped
//  - opaque hashed asset names
//  - everything bundled from pinned local deps (no CDN, no runtime third-party)
export default defineConfig({
  plugins: [preact()],
  build: {
    target: 'es2022',
    sourcemap: false,
    minify: 'terser',
    cssMinify: true,
    terserOptions: {
      compress: { passes: 2, drop_console: true, drop_debugger: true },
      mangle: true,
      format: { comments: false },
    },
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[hash].js',
        chunkFileNames: 'assets/[hash].js',
        assetFileNames: 'assets/[hash][extname]',
      },
    },
  },
})
