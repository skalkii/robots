import { test, expect } from '@playwright/test';

test.describe('humanoid sim — smoke', () => {
  test('boots, renders the canvas, and shows actuator count in HUD', async ({ page }) => {
    await page.goto('/');

    // Wait for the boot pipeline to reach the "ready" state — the HUD only
    // shows the geom/body/actuator counts after `MujocoSim.load()` resolves.
    const info = page.locator('.hud .info');
    await expect(info).toContainText('actuators:', { timeout: 30_000 });

    // The 3D canvas should be mounted and have non-zero dimensions.
    const canvas = page.locator('canvas.viewport');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(100);
    expect(box?.height ?? 0).toBeGreaterThan(100);
  });

  test('mock chat dispatches a tool call from "raise your right arm"', async ({ page }) => {
    await page.goto('/');
    // Force the mock provider and clear any persisted state from a prior run.
    await page.evaluate(() => {
      localStorage.setItem('robots.agent.provider', 'mock');
      localStorage.removeItem('robots.agent.transcript');
      localStorage.removeItem('robots.agent.history');
    });
    await page.reload();

    // Wait for sim ready (chat panel only renders once `control` is non-null).
    await expect(page.locator('.hud .info')).toContainText('actuators:', { timeout: 30_000 });

    const composer = page.locator('.chat-input input[type="text"]');
    await expect(composer).toBeVisible();
    await composer.fill('raise your right arm');
    await page.locator('.chat-input button[type="submit"]').click();

    // Mock agent responds synchronously; the tool trace lists `raise_arm`.
    const trace = page.locator('.tool-trace');
    await expect(trace).toContainText('raise_arm');
    await expect(trace).toContainText('right');
  });
});
