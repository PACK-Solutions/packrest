import { test, expect } from "@playwright/test";
import { gotoReady, HEADING } from "../support/helpers";

// The Bruno import UI is client-side (fflate), so its empty/upload state renders
// in a plain browser. Actual matching needs synced specs (Tauri) and is skipped.
test.describe("Collections — Bruno import UI", () => {
  test("renders the empty import state with an upload control", async ({ page }) => {
    await gotoReady(page, "/collections", HEADING.collections);

    await expect(
      page.getByRole("heading", { name: "Importer une collection Bruno" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Importer un fichier Bruno" }),
    ).toBeVisible();
    // The file input is intentionally hidden and triggered by the button.
    await expect(page.locator('input[type="file"]')).toHaveCount(1);
    await expect(page.locator('input[type="file"]')).toHaveAttribute("accept", /zip/);
  });
});
