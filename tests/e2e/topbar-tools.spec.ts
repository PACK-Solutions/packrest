import { test, expect } from "@playwright/test";
import { gotoReady, HEADING } from "../support/helpers";

const UUID_V4 = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

// Topbar tools are localStorage/crypto-backed and work fully without Tauri.
test.describe("Topbar tools", () => {
  // The copy action needs clipboard access to produce the success toast.
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("UUID generator mints, regenerates and copies", async ({ page }) => {
    await gotoReady(page, "/help", HEADING.help);
    await page.getByRole("button", { name: "Générateur d'UUID" }).click();

    const menu = page.getByRole("menu");
    await expect(menu.getByText("UUID v4")).toBeVisible();
    const field = menu.locator("div.font-mono").first();
    const first = (await field.textContent())?.trim() ?? "";
    expect(first).toMatch(UUID_V4);

    await menu.getByRole("button", { name: "Régénérer" }).click();
    const second = (await field.textContent())?.trim() ?? "";
    expect(second).toMatch(UUID_V4);
    expect(second).not.toBe(first);

    await menu.getByRole("button", { name: "Copier" }).click();
    await expect(page.getByText("UUID copié")).toBeVisible();
  });

  test("ID collector opens to its empty state", async ({ page }) => {
    await gotoReady(page, "/help", HEADING.help);
    await page.getByRole("button", { name: "Collecteur d'IDs" }).click();
    await expect(page.getByText("Aucun id collecté pour l'instant", { exact: false })).toBeVisible();
  });

  test("environment switcher exposes an accessible label and options", async ({ page }) => {
    await gotoReady(page, "/help", HEADING.help);
    const badge = page.getByRole("button", { name: /Environnement actif :/ });
    await expect(badge).toBeVisible();
    await badge.click();
    await expect(page.getByRole("menuitemradio", { name: /Dev \(Gravitee\)/ })).toBeVisible();
    await expect(page.getByRole("menuitemradio", { name: /Recette \(Gravitee\)/ })).toBeVisible();
    await expect(page.getByRole("menuitemradio", { name: "Personnalisé" })).toBeVisible();
  });
});
