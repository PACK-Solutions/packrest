import { test, expect, type Page } from "@playwright/test";
import { gotoReady, HEADING } from "../support/helpers";

const UUID_V4 = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

const PERSON_ID = "11111111-1111-4111-8111-111111111111";
const CONTRACT_ID = "22222222-2222-4222-8222-222222222222";

// Outside Tauri the ID collector persists to localStorage, so stored ids can be
// planted before the app boots (lib/id-collector.ts reads them at startup).
async function seedIdCollector(page: Page, { created = true } = {}) {
  const now = Date.now();
  const createdIds = {
    person: [
      {
        id: PERSON_ID,
        apiId: "person",
        operationId: "createIndividual",
        method: "POST",
        label: "Créer une personne",
        name: "Martin Léa",
        origin: "parcours",
        createdAt: now,
      },
    ],
    contract: [
      {
        id: CONTRACT_ID,
        apiId: "contract",
        operationId: "createContract",
        method: "POST",
        label: "Créer un contrat",
        createdAt: now,
      },
    ],
  };
  const seen = (apiId: string, operationId: string, id: string, label: string) => ({
    [`${apiId}::${operationId}`]: [
      { id, label, apiId, operationId, operationLabel: operationId, seenAt: now },
    ],
  });
  const seenIds = {
    ...seen("product", "listProducts", "33333333-3333-4333-8333-333333333333", "Épargne"),
    ...seen("person", "listIndividuals", PERSON_ID, "Martin Léa"),
  };
  await page.addInitScript(
    ([c, s]) => {
      if (c) localStorage.setItem("packrest.collected-ids", c);
      localStorage.setItem("packrest.seen-ids", s);
    },
    [created ? JSON.stringify(createdIds) : "", JSON.stringify(seenIds)],
  );
}

async function stored(page: Page, key: string): Promise<Record<string, unknown>> {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), key);
}

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

  test("ID collector lists created ids with their name and origin", async ({ page }) => {
    await seedIdCollector(page);
    await gotoReady(page, "/help", HEADING.help);
    const trigger = page.getByRole("button", { name: "Collecteur d'IDs" });
    await expect(trigger).toContainText("2");
    await trigger.click();

    const panel = page.getByRole("dialog");
    await expect(panel.getByText("Les 5 dernières ressources créées par API.")).toBeVisible();
    await expect(panel.getByText("Créer une personne · Martin Léa")).toBeVisible();
    await expect(panel.getByText("Parcours", { exact: true })).toHaveCount(1);
    await expect(panel.getByText(PERSON_ID)).toBeVisible();
    await expect(panel.getByText(CONTRACT_ID)).toBeVisible();
  });

  test("ID collector clears one API's created and seen ids", async ({ page }) => {
    await seedIdCollector(page);
    await gotoReady(page, "/help", HEADING.help);
    await page.getByRole("button", { name: "Collecteur d'IDs" }).click();
    await page.getByRole("button", { name: "Vider person" }).click();

    await expect(page.getByRole("dialog").getByText(PERSON_ID)).toHaveCount(0);
    await expect(page.getByRole("dialog").getByText(CONTRACT_ID)).toBeVisible();
    expect(Object.keys(await stored(page, "packrest.seen-ids"))).toEqual([
      "product::listProducts",
    ]);
  });

  test("ID collector offers « Tout vider » while only seen ids remain", async ({ page }) => {
    await seedIdCollector(page, { created: false });
    await gotoReady(page, "/help", HEADING.help);
    await page.getByRole("button", { name: "Collecteur d'IDs" }).click();

    const panel = page.getByRole("dialog");
    await expect(panel.getByText("Aucune ressource créée.", { exact: false })).toBeVisible();
    await panel.getByRole("button", { name: "Tout vider" }).click();
    await expect(panel.getByText("Aucun id collecté pour l'instant", { exact: false })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Tout vider" })).toHaveCount(0);
    expect(await stored(page, "packrest.seen-ids")).toEqual({});
  });

  test("environment switcher exposes an accessible label and options", async ({ page }) => {
    await gotoReady(page, "/help", HEADING.help);
    const badge = page.getByRole("button", { name: /Environnement actif :/ });
    await expect(badge).toBeVisible();
    await badge.click();
    await expect(page.getByRole("menuitemradio", { name: /Dev \(Gravitee\)/ })).toBeVisible();
    await expect(page.getByRole("menuitemradio", { name: /Recette \(Gravitee\)/ })).toBeVisible();
    // Custom envs are opt-in (created in Settings), so a fresh app lists only
    // the two built-in presets.
  });
});
