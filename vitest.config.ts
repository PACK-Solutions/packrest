import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Unit tests for pure logic (schema normalization, value extraction). React
// component rendering stays in the Playwright e2e suite.
export default defineConfig({
  resolve: {
    alias: { "@": resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
