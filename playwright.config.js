"use strict";

const fs = require("node:fs");
const { defineConfig } = require("@playwright/test");

const systemChromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  ?? (fs.existsSync("/snap/bin/chromium") ? "/snap/bin/chromium" : null);

module.exports = defineConfig({
  expect: { timeout: 5000 },
  fullyParallel: false,
  outputDir: "test-results/simulator",
  projects: [
    { name: "mobile-375", use: { browserName: "chromium", viewport: { height: 667, width: 375 } } },
    { name: "mobile-390", use: { browserName: "chromium", viewport: { height: 844, width: 390 } } },
    { name: "tablet-768", use: { browserName: "chromium", viewport: { height: 1024, width: 768 } } },
    { name: "desktop-1440", use: { browserName: "chromium", viewport: { height: 900, width: 1440 } } },
  ],
  reporter: [["list"]],
  testDir: "tests/e2e",
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    launchOptions: {
      args: ["--no-sandbox"],
      ...(systemChromium ? { executablePath: systemChromium } : {}),
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev --workspace web/simulator -- --host 127.0.0.1 --port 4173",
    reuseExistingServer: true,
    timeout: 30000,
    url: "http://127.0.0.1:4173",
  },
});
