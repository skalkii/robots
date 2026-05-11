/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: true,
  },
  // @mujoco/mujoco resolves its .wasm via `new URL('mujoco.wasm', import.meta.url)`.
  // Skip esbuild pre-bundling so that relative URL stays accurate at runtime.
  optimizeDeps: {
    exclude: ['@mujoco/mujoco'],
    include: ['three', 'three/addons/controls/OrbitControls.js'],
  },
  resolve: {
    dedupe: ['three'],
  },
  assetsInclude: ['**/*.wasm'],
  build: {
    // Bigger ceiling because the WASM is intentionally one large chunk.
    chunkSizeWarningLimit: 1024,
    rolldownOptions: {
      output: {
        // Pull the two heaviest dependencies into their own chunks so the
        // app shell can load and start fetching the WASM in parallel.
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'react';
          if (id.includes('node_modules/@mujoco')) return 'mujoco';
        },
      },
    },
  },
  server: {
    fs: {
      allow: ['..'],
    },
  },
})
