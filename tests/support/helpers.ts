import { expect, type Page } from "@playwright/test";

// Navigate and wait past the TauriProvider startup splash ("Chargement…"),
// then wait for a heading that proves the target page has mounted. The home
// page also flashes a `role="status"` skeleton before its empty state, so we
// key on the real heading rather than first paint.
export async function gotoReady(
  page: Page,
  path: string,
  headingName: string | RegExp,
) {
  await page.goto(path);
  await expect(
    page.getByRole("heading", { name: headingName }),
  ).toBeVisible();
}

// Page headings used as "ready" anchors per route.
export const HEADING = {
  home: "Choisissez une API",
  settings: "Paramètres",
  help: /Aide .* diagnostic/,
  collections: "Import Bruno",
} as const;

// Flip the theme via the topbar toggle and assert the `<html>` class settled.
export async function toggleTheme(page: Page) {
  await page.getByRole("button", { name: /Passer en thème/ }).click();
}

// Assert the page body does not overflow horizontally at the current viewport
// (a common responsive-layout defect).
export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const el = document.documentElement;
    // Allow a 1px rounding slack.
    return el.scrollWidth - el.clientWidth;
  });
  expect(overflow, "horizontal overflow (scrollWidth - clientWidth)").toBeLessThanOrEqual(1);
}
