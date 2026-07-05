import { test, expect, type Page } from "@playwright/test";
import { adminAvailable, seedForgeMember, cleanupForgeMember, type SeededForgeMember } from "./forgeSeed";

test.describe("forge playtest lobby", () => {
  test.skip(!adminAvailable, "requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL");

  async function signIn(page: Page, seed: SeededForgeMember) {
    await page.goto("/sign-in");
    await page.getByLabel(/email/i).fill(seed.email);
    await page.getByLabel(/password/i).fill(seed.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 15_000 });
    // Let the post-login redirect finish rendering before tests navigate away.
    await page.waitForLoadState("load");
  }

  // The post-login page can fire a late client-side navigation that interrupts
  // the first goto after sign-in (seen on chromium-mobile) — retry once.
  async function gotoSettled(page: Page, path: string) {
    try {
      await page.goto(path);
    } catch {
      await page.goto(path);
    }
  }

  test("anonymous visitors get a 404", async ({ page }) => {
    const resp = await page.goto("/forge/play/games");
    expect(resp?.status()).toBe(404);
  });

  test("member sees the lobby", async ({ page }) => {
    const seed = await seedForgeMember("playtester");
    try {
      await signIn(page, seed);
      await gotoSettled(page, "/forge/play/games");
      await expect(page.getByRole("heading", { name: "Playtest games", exact: true })).toBeVisible();
    } finally {
      await cleanupForgeMember(seed);
    }
  });
});
