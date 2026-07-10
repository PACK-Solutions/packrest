import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoReady, HEADING } from "../support/helpers";

// Automated accessibility pass with axe-core. This is the primary UI/UX
// *issue-detection* mechanism: we fail on serious/critical violations so real
// gaps surface. Full violation details are attached to the HTML report.
const ROUTES = [
  ["home", "/", HEADING.home],
  ["settings", "/settings", HEADING.settings],
  ["help", "/help", HEADING.help],
  ["collections", "/collections", HEADING.collections],
] as const;

const THEMES = ["light", "dark"] as const;

test.describe("Accessibility (axe-core)", () => {
  for (const [name, path, heading] of ROUTES) {
    for (const scheme of THEMES) {
      test(`${name} — ${scheme} — no serious/critical violations`, async ({ page }, testInfo) => {
        await page.emulateMedia({ colorScheme: scheme });
        await gotoReady(page, path, heading);

        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();

        await testInfo.attach(`axe-${name}-${scheme}.json`, {
          body: JSON.stringify(results.violations, null, 2),
          contentType: "application/json",
        });

        const blocking = results.violations.filter(
          (v) => v.impact === "serious" || v.impact === "critical",
        );
        const summary = blocking
          .map((v) => `${v.id} (${v.impact}) ×${v.nodes.length} — ${v.help}`)
          .join("\n");
        expect(blocking, `serious/critical a11y violations:\n${summary}`).toEqual([]);
      });
    }
  }
});
