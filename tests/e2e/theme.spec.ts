import { test, expect } from "@playwright/test";
import { gotoReady, HEADING } from "../support/helpers";

// The theme toggle lives in the always-visible top bar, so this runs on both
// the desktop and mobile projects. next-themes writes a `.dark` class on <html>.
test.describe("Theme toggle", () => {
  test("toggling flips the html class and the button label", async ({ page }) => {
    await gotoReady(page, "/help", HEADING.help);
    const html = page.locator("html");
    const toggle = page.getByRole("button", { name: /Passer en thème/ });

    const startsDark = (await html.getAttribute("class"))?.includes("dark") ?? false;

    await toggle.click();
    if (startsDark) {
      await expect(html).not.toHaveClass(/dark/);
      await expect(page.getByRole("button", { name: "Passer en thème sombre" })).toBeVisible();
    } else {
      await expect(html).toHaveClass(/dark/);
      await expect(page.getByRole("button", { name: "Passer en thème clair" })).toBeVisible();
    }

    await toggle.click();
    if (startsDark) {
      await expect(html).toHaveClass(/dark/);
    } else {
      await expect(html).not.toHaveClass(/dark/);
    }
  });

  test.describe("with dark OS preference", () => {
    test.use({ colorScheme: "dark" });
    test("initial system preference resolves to the dark theme", async ({ page }) => {
      await gotoReady(page, "/help", HEADING.help);
      await expect(page.locator("html")).toHaveClass(/dark/);
    });
  });
});
