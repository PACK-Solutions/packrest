import { defineConfig, devices } from "@playwright/test";

// PackRest is a Tauri desktop app whose frontend is a Next.js static export.
// These tests exercise the *no-Tauri* surface — the UI reachable in a plain
// browser, where `isTauri()` is false and the spec store is empty. We test the
// built static export (`out/`, served statically) rather than `next dev`: it
// matches what the Tauri webview actually loads and keeps the Next dev overlay
// out of visual snapshots.
const PORT = 3001;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["html", { open: "never" }], ["list"]],

  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      animations: "disabled",
      caret: "hide",
    },
  },

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      // Pixel 7 ≈ 412px wide — below the md (768px) breakpoint, so the sidebar
      // collapses into the hamburger Sheet.
      name: "chromium-mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],

  // Build the static export, then serve it. The build is slow on a cold run,
  // hence the generous timeout. Locally we reuse an already-running server.
  webServer: {
    command: "npm run build && npm run test:serve",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
