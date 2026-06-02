import { test as base } from "@playwright/test";
import { seedTournamentWithCompletedRound1, cleanupTournament, adminAvailable, type SeededTournament } from "./seed";

interface Fixtures {
  seeded: SeededTournament;
}

export const test = base.extend<Fixtures>({
  seeded: async ({ page }, use) => {
    if (!adminAvailable) {
      throw new Error("E2E seed fixture requires SUPABASE_SERVICE_ROLE_KEY (and NEXT_PUBLIC_SUPABASE_URL). Set these env vars to run E2E tests.");
    }
    const seed = await seedTournamentWithCompletedRound1();
    // Login as host via UI.
    await page.goto("/sign-in");
    await page.getByLabel(/email/i).fill(seed.hostEmail);
    await page.getByLabel(/password/i).fill(seed.hostPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    // Wait for redirect.
    await page.waitForURL(/.*\/tracker.*|.*\/$/, { timeout: 10_000 });
    await use(seed);
    await cleanupTournament(seed);
  },
});

export { expect } from "@playwright/test";
