import { createRequire } from "node:module";
const require = createRequire(new URL("../../wealthfolio/package.json", import.meta.url));
const { defineConfig } = require("@playwright/test");

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.mjs",
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  reporter: "list",
  outputDir: "./test-results",
  use: {
    browserName: "chromium",
    channel: "chrome",
    headless: true,
    trace: "retain-on-failure",
    actionTimeout: 15_000,
  },
});
