import { test, expect } from "@playwright/test";
import { gotoReady, HEADING } from "../support/helpers";

// Settings is fully interactive without Tauri: env + credentials persist to
// localStorage; only the sync/release/update actions are Tauri-gated.
test.describe("Settings page", () => {
  test("renders the three sections", async ({ page }) => {
    await gotoReady(page, "/settings", HEADING.settings);
    await expect(page.getByRole("heading", { name: "Mises à jour" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Sources des contrats/ })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Environnement . authentification/ }),
    ).toBeVisible();
  });

  test("selecting an environment and saving persists across reload", async ({ page }) => {
    await gotoReady(page, "/settings", HEADING.settings);

    await page.getByRole("button", { name: /Recette \(Gravitee\)/ }).click();
    await page
      .getByRole("button", { name: /Enregistrer l'environnement et les identifiants/ })
      .click();

    await expect(page.getByText("Paramètres enregistrés")).toBeVisible();
    await expect(page.getByText("Enregistré", { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: HEADING.settings })).toBeVisible();
    // The topbar env badge reflects the persisted choice.
    await expect(
      page.getByRole("button", { name: /Environnement actif : Recette/ }),
    ).toBeVisible();
  });

  test("save-path button is disabled while the local path is empty", async ({ page }) => {
    await gotoReady(page, "/settings", HEADING.settings);
    await expect(
      page.getByRole("button", { name: "Enregistrer le chemin" }),
    ).toBeDisabled();
  });
});
