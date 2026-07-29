import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Seed helpers (e2e/*Seed.ts) run in the Playwright process and read
// process.env directly; `npm run dev` loads .env.local on its own.
loadEnv({ path: ".env.local", quiet: true });

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  // The default 30s doesn't cover a cold `next dev` route compile. The tracker
  // tournament page alone takes ~10s the first time it's hit, and a spec that
  // visits two uncompiled routes blows the budget before it asserts anything.
  timeout: 90_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "chromium-mobile", use: { ...devices["iPhone 12"] } },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
