import { test, expect } from "@playwright/test";
import { gotoReady, HEADING } from "../support/helpers";

// Visual regression baselines per route × theme × project (viewport). Baselines
// are OS/font dependent — commit the set generated on your dev OS and regenerate
// with `npm run test:update-snapshots` after intentional UI changes.
const ROUTES = [
  ["home", "/", HEADING.home],
  ["settings", "/settings", HEADING.settings],
  ["help", "/help", HEADING.help],
] as const;

const THEMES = ["light", "dark"] as const;

test.describe("Visual snapshots", () => {
  for (const [name, path, heading] of ROUTES) {
    for (const scheme of THEMES) {
      test(`${name} — ${scheme}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await gotoReady(page, path, heading);
        // Let fonts settle before capturing.
        await page.evaluate(() => document.fonts.ready);
        await expect(page).toHaveScreenshot(`${name}-${scheme}.png`, {
          fullPage: true,
        });
      });
    }
  }
});
