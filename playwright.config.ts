import { defineConfig, devices } from '@playwright/test';

/**
 * Single-project Chromium config. Boots the Vite dev server, opens a
 * headless tab, and runs the spec files under `e2e/`. The webServer block
 * starts (or reuses) the dev server depending on CI vs local.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  // Boot + WASM download can run long on a cold cache; give each test a
  // generous budget.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://127.0.0.1:5173',
    ...devices['Desktop Chrome'],
    reducedMotion: 'reduce',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  reporter: [['list']],
});
