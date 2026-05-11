import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // @mujoco/mujoco resolves its .wasm via `new URL('mujoco.wasm', import.meta.url)`.
  // Skip esbuild pre-bundling so that relative URL stays accurate at runtime.
  optimizeDeps: {
    exclude: ['@mujoco/mujoco'],
  },
  assetsInclude: ['**/*.wasm'],
  server: {
    fs: {
      allow: ['..'],
    },
  },
})
