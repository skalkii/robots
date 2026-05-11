import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // @mujoco/mujoco resolves its .wasm via `new URL('mujoco.wasm', import.meta.url)`.
  // Skip esbuild pre-bundling so that relative URL stays accurate at runtime.
  optimizeDeps: {
    exclude: ['@mujoco/mujoco'],
    // Pre-bundle the OrbitControls addon together with `three` so we don't end
    // up with two copies of three.js (which makes THREE warn at runtime).
    include: ['three', 'three/addons/controls/OrbitControls.js'],
  },
  resolve: {
    dedupe: ['three'],
  },
  assetsInclude: ['**/*.wasm'],
  server: {
    fs: {
      allow: ['..'],
    },
  },
})
