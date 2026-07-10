import { test, expect } from "@playwright/test";
import { gotoReady, HEADING } from "../support/helpers";

// The desktop sidebar (`<aside>`) is `hidden md:flex`, so these assertions only
// hold on the desktop project. Mobile navigation is covered in responsive.spec.
test.describe("App shell — desktop navigation", () => {
  test.beforeEach(async ({ viewport }) => {
    test.skip(!viewport || viewport.width < 768, "Desktop sidebar layout only");
    // nothing else — each test navigates itself
  });

  test("brand link returns home", async ({ page }) => {
    await gotoReady(page, "/help", HEADING.help);
    await page.getByRole("link", { name: "PackRest", exact: true }).click();
    await expect(page).toHaveURL(/\/$|\/index/);
    await expect(page.getByRole("heading", { name: HEADING.home })).toBeVisible();
  });

  test("Outils links navigate to their pages", async ({ page }) => {
    await gotoReady(page, "/", HEADING.home);
    const nav = page.getByRole("navigation");

    await nav.getByRole("link", { name: "Import Bruno" }).click();
    await expect(page.getByRole("heading", { name: HEADING.collections })).toBeVisible();

    await nav.getByRole("link", { name: "Aide & diagnostic" }).click();
    await expect(page.getByRole("heading", { name: HEADING.help })).toBeVisible();

    // Two "Paramètres" links live in the nav (APIs empty-state + Outils);
    // the Outils one is last in DOM order.
    await nav.getByRole("link", { name: "Paramètres", exact: true }).last().click();
    await expect(page.getByRole("heading", { name: HEADING.settings })).toBeVisible();
  });

  test("active route is highlighted in the sidebar", async ({ page }) => {
    await gotoReady(page, "/collections", HEADING.collections);
    const active = page.getByRole("navigation").getByRole("link", { name: "Import Bruno" });
    await expect(active).toHaveClass(/bg-sidebar-accent/);
  });

  test("sidebar shows the no-specs empty state and version footer", async ({ page }) => {
    await gotoReady(page, "/", HEADING.home);
    await expect(page.getByText("Aucune spec trouvée", { exact: false })).toBeVisible();
    await expect(page.getByText(/PackRest v\d/)).toBeVisible();
  });
});
