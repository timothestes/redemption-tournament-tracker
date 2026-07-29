import { test, expect } from "../fixtures";
import { admin, adminAvailable } from "../seed";
import type { Page } from "@playwright/test";
import {
  ADMIN_MENU_TRIGGER,
  EDIT_HISTORY,
  editHistory,
  editPastResult,
  editResultPencil,
  gotoRounds,
  MENU_EDIT_PAST_RESULT,
  navigate,
} from "./helpers";

// NOTE ON PREMISE. The original spec assumed a signed-in non-host could browse
// the tournament page and simply be shown fewer controls. That isn't what the
// product does: RLS on `tournaments` (and on matches / participants / rounds /
// match_edits) is `auth.uid() = host_id`, with no participant or public read
// policy, so /tracker/tournaments/[id] renders "Tournament not found" for
// anyone who isn't the host. The assertions below test THAT — which is the
// stronger guarantee anyway — rather than pretending the page loads.

const PASSWORD = "Testpass12345";

async function createNonHost(): Promise<string> {
  const email = `other-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@e2e.test`;
  await admin!.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  return email;
}

async function deleteUser(email: string): Promise<void> {
  const usersResult = await admin!.auth.admin.listUsers();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allUsers = (usersResult.data as any).users as Array<{ id: string; email?: string }>;
  const user = allUsers.find((u) => u.email === email);
  if (user) await admin!.auth.admin.deleteUser(user.id);
}

/** Replace the host session in this browser with a signed-in non-host. */
async function signInAs(page: Page, email: string): Promise<void> {
  await navigate(page, "/sign-in");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), {
    timeout: 15_000,
  });
}

test("a non-host gets none of the host's result-editing surface", async ({
  page,
  seeded,
}) => {
  test.skip(!adminAvailable, "requires SUPABASE_SERVICE_ROLE_KEY");
  const otherEmail = await createNonHost();

  try {
    // Establish the affordances FIRST, as the host. Without this the absence
    // assertions below pass just as happily against stale selectors — which is
    // exactly how this spec "passed" for the whole time it tested nothing.
    await gotoRounds(page, seeded.tournamentId, 1);
    await expect(editResultPencil(page, "Alice", "Bob")).toBeVisible();
    await expect(page.getByRole("button", { name: ADMIN_MENU_TRIGGER })).toBeVisible();

    // Leave an audit trail too, so the non-host checks below are about
    // permission rather than about there being nothing to hide.
    await editPastResult(page, {
      p1: "Alice", p2: "Bob", p2Score: 3, reason: "host eyes only",
    });
    await expect(editHistory(page)).toBeVisible();

    await signInAs(page, otherEmail);
    await navigate(page, `/tracker/tournaments/${seeded.tournamentId}`);

    // The tournament itself is unreachable, so the whole host surface is too.
    await expect(
      page.getByRole("heading", { name: /tournament not found/i }),
    ).toBeVisible();
    await expect(page.getByRole("tablist")).toHaveCount(0);

    await expect(editResultPencil(page, "Alice", "Bob")).toHaveCount(0);
    await expect(editResultPencil(page, "Carol", "Dave")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^edit score:/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: ADMIN_MENU_TRIGGER })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: MENU_EDIT_PAST_RESULT })).toHaveCount(0);
    await expect(page.getByRole("menu")).toHaveCount(0);

    // Neither the audit trail nor the reason the host typed leaks.
    await expect(page.getByText(EDIT_HISTORY)).toHaveCount(0);
    await expect(page.getByText("host eyes only")).toHaveCount(0);
  } finally {
    await deleteUser(otherEmail);
  }
});

test("a signed-out visitor never reaches the page at all", async ({ page, seeded }) => {
  test.skip(!adminAvailable, "requires SUPABASE_SERVICE_ROLE_KEY");

  // The `seeded` fixture signs the host in; drop that session.
  await page.context().clearCookies();
  await navigate(page, `/tracker/tournaments/${seeded.tournamentId}`);

  // /tracker is a protected prefix, so this bounces to sign-in before the
  // tournament page (and its host controls) is ever rendered.
  await expect(page).toHaveURL(/\/sign-in\?/);
  await expect(editResultPencil(page, "Alice", "Bob")).toHaveCount(0);
  await expect(page.getByRole("button", { name: ADMIN_MENU_TRIGGER })).toHaveCount(0);
  await expect(page.getByText(EDIT_HISTORY)).toHaveCount(0);
});
