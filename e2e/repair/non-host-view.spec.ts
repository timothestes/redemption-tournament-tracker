import { test, expect } from "../fixtures";
import { admin, adminAvailable } from "../seed";

test("non-host player sees no host affordances", async ({ page, seeded }) => {
  if (!adminAvailable) test.skip();

  // Create a non-host user.
  const otherEmail = `other-${Date.now()}@e2e.test`;
  const otherPassword = "Testpass12345";
  await admin!.auth.admin.createUser({ email: otherEmail, password: otherPassword, email_confirm: true });

  // Log out the host fixture, log in as the non-host.
  await page.goto("/sign-in");
  await page.getByLabel(/email/i).fill(otherEmail);
  await page.getByLabel(/password/i).fill(otherPassword);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/.*/);

  await page.goto(`/tracker/tournaments/${seeded.tournamentId}`);

  // No host affordances visible.
  await expect(page.getByRole("button", { name: /repair past result/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /repair result for/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^re-pair current round$/i })).toHaveCount(0);
  await expect(page.getByText(/audit log/i)).toHaveCount(0);

  // Cleanup other user.
  const usersResult = await admin!.auth.admin.listUsers();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allUsers = (usersResult.data as any).users as Array<{ id: string; email?: string }>;
  const other = allUsers.find(u => u.email === otherEmail);
  if (other) await admin!.auth.admin.deleteUser(other.id);
});
