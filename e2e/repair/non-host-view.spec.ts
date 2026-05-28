import { test, expect } from "../fixtures";
import { admin, adminAvailable } from "../seed";

test("non-host player sees no host affordances but sees amended badge", async ({ page, seeded }) => {
  if (!adminAvailable) test.skip();

  // Create a non-host user.
  const otherEmail = `other-${Date.now()}@e2e.test`;
  const otherPassword = "Testpass12345";
  await admin!.auth.admin.createUser({ email: otherEmail, password: otherPassword, email_confirm: true });

  // First, the host repairs a round-1 result so we have an amended badge to verify.
  // Use the service-role client to insert a match_edits row that simulates a repair.
  // (Direct insert is faster than UI flow and the badge fetch reads from match_edits_public.)
  const matches = await admin!.from("matches").select("id").eq("tournament_id", seeded.tournamentId).eq("round", 1).limit(1);
  const matchId = matches.data![0].id;
  await admin!.from("match_edits").insert({
    match_id: matchId,
    tournament_id: seeded.tournamentId,
    round: 1,
    old_player1_score: 5, old_player2_score: 0,
    new_player1_score: 5, new_player2_score: 3,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    edited_by: ((await admin!.auth.admin.listUsers()).data as any).users.find((u: { id: string; email?: string }) => u.email === seeded.hostEmail)!.id,
  });

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

  // Amended badge IS visible — switch to participants tab to see standings.
  await page.getByRole("tab", { name: /participants/i }).click();
  await expect(page.getByRole("status").filter({ hasText: /^amended$/i }).first()).toBeVisible({ timeout: 5_000 });

  // Cleanup other user.
  const usersResult = await admin!.auth.admin.listUsers();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allUsers = (usersResult.data as any).users as Array<{ id: string; email?: string }>;
  const other = allUsers.find(u => u.email === otherEmail);
  if (other) await admin!.auth.admin.deleteUser(other.id);
});
