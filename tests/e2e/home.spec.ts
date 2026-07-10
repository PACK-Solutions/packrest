import { test, expect } from "@playwright/test";
import { gotoReady, HEADING } from "../support/helpers";

// Without Tauri the spec store is empty, so the home page always shows its
// "no specs loaded" empty state — the canonical first-run experience.
test.describe("Home — empty state", () => {
  test("renders the no-specs card with a link to settings", async ({ page }) => {
    await gotoReady(page, "/", HEADING.home);

    await expect(
      page.getByRole("heading", { name: "Aucune spec OpenAPI chargée" }),
    ).toBeVisible();

    const settingsLink = page
      .getByRole("main")
      .getByRole("link", { name: "Paramètres" });
    await expect(settingsLink).toHaveAttribute("href", "/settings");
    await settingsLink.click();
    await expect(page.getByRole("heading", { name: HEADING.settings })).toBeVisible();
  });
});
