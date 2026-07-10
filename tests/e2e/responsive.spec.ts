import { test, expect } from "@playwright/test";
import { gotoReady, HEADING, expectNoHorizontalOverflow } from "../support/helpers";

test.describe("Responsive — mobile", () => {
  test.beforeEach(async ({ viewport }) => {
    test.skip(!viewport || viewport.width >= 768, "Mobile layout only");
  });

  test("sidebar collapses into the hamburger sheet", async ({ page }) => {
    await gotoReady(page, "/help", HEADING.help);

    const hamburger = page.getByRole("button", { name: "Ouvrir le menu" });
    await expect(hamburger).toBeVisible();
    // The persistent desktop sidebar is display:hidden below md.
    await expect(page.locator("aside")).toBeHidden();

    await hamburger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("link", { name: "Aide & diagnostic" })).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Import Bruno" })).toBeVisible();
  });
});

test.describe("Responsive — desktop", () => {
  test.beforeEach(async ({ viewport }) => {
    test.skip(!viewport || viewport.width < 768, "Desktop layout only");
  });

  test("sidebar is visible and the hamburger is hidden", async ({ page }) => {
    await gotoReady(page, "/help", HEADING.help);
    await expect(page.locator("aside")).toBeVisible();
    await expect(page.getByRole("button", { name: "Ouvrir le menu" })).toBeHidden();
  });
});

// Runs on every project (desktop + mobile viewports) — no horizontal scroll.
test.describe("Responsive — no horizontal overflow", () => {
  for (const [name, path, heading] of [
    ["home", "/", HEADING.home],
    ["settings", "/settings", HEADING.settings],
    ["help", "/help", HEADING.help],
    ["collections", "/collections", HEADING.collections],
  ] as const) {
    test(`${name} does not overflow horizontally`, async ({ page }) => {
      await gotoReady(page, path, heading);
      await expectNoHorizontalOverflow(page);
    });
  }
});
