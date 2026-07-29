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
    // Wait for the redirect OFF the sign-in page rather than for a specific
    // landing route. signInAction's destination has moved twice already
    // (/tracker/tournaments -> /decklist/community, #82), and pinning it here
    // silently broke every repair spec at the fixture. Each spec navigates to
    // the page it actually needs, so all this has to prove is that auth stuck.
    await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), {
      timeout: 15_000,
    });
    // …then let that redirect finish landing. signInAction's redirect is a
    // server-action redirect, so the URL flips as soon as the router accepts it
    // while the document navigation is still in flight — and under load (a cold
    // compile of the landing route) a spec's own goto() fired in that window
    // dies with "Navigation ... is interrupted by another navigation".
    // Sample until the location holds still, then wait for the load event.
    for (let i = 0; i < 40; i++) {
      const before = page.url();
      await page.waitForTimeout(250);
      if (page.url() === before) break;
    }
    await page.waitForLoadState("load");
    await use(seed);
    await cleanupTournament(seed);
  },
});

export { expect } from "@playwright/test";
