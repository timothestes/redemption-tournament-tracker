import { test, expect, type Page } from "@playwright/test";
import { admin, adminAvailable } from "../seed";
import { deleteTestUser } from "../deleteUser";

// Full poster journey against the dev server: grant → write → upload → publish
// → public page → feed → unpublish → 404 → delete. Runs in both Playwright
// projects; the mobile one also proves the Write/Preview toggle and the
// Articles link in the hamburger menu.

const PASSWORD = "Testpass12345";
// 1x1 transparent PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

// The dev server compiles each route the first time it's hit and broadcasts a
// Fast Refresh "full reload" to whatever page is currently on screen; if that
// lands mid-navigation, Playwright sees our goto racing it and throws
// "interrupted by another navigation". Doesn't happen in production (no HMR)
// and doesn't happen once the route is warm, so a single retry clears it.
async function gotoStable(page: Page, url: string) {
  try {
    await page.goto(url);
  } catch (e) {
    if (e instanceof Error && /interrupted by another navigation/.test(e.message)) {
      await page.goto(url);
    } else {
      throw e;
    }
  }
}

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 15_000 });
  for (let i = 0; i < 40; i++) {
    const before = page.url();
    await page.waitForTimeout(250);
    if (page.url() === before) break;
  }
  await page.waitForLoadState("load");
}

test.describe("articles: poster publish flow", () => {
  test.skip(!adminAvailable, "needs SUPABASE_SERVICE_ROLE_KEY");
  let userId = "";
  let email = "";

  test.beforeEach(async () => {
    email = `poster-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@e2e.test`;
    const { data, error } = await admin!.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    userId = data.user.id;
    const { error: permErr } = await admin!.from("admin_users").insert({ user_id: userId, permissions: ["publish_posts"] });
    if (permErr) throw new Error(`grant: ${permErr.message}`);
  });

  test.afterEach(async () => {
    if (!userId) return;
    await admin!.from("admin_users").delete().eq("user_id", userId);
    const gone = await deleteTestUser(admin!, userId);
    expect(gone, "poster user leaked").toBe(true);
  });

  test("write, upload, publish, read, feed, unpublish, delete", async ({ page, isMobile }) => {
    await signIn(page, email);

    // The Articles link exists in whichever nav this viewport renders. The
    // hamburger button carries no accessible name (icon-only, no aria-label),
    // so it is targeted by its distinguishing Tailwind class instead of a role.
    if (isMobile) await page.locator("nav").locator('button[class*="lg:hidden"]').first().click();
    await expect(page.getByRole("link", { name: "Articles" }).first()).toBeVisible();

    await gotoStable(page, "/admin/posts/new");
    const title = `E2E article ${Date.now()}`;
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Body").fill("# Heading\n\nHello **world**.\n\nhttps://youtu.be/dQw4w9WgXcQ");

    // Image upload through the toolbar's hidden input.
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: "Upload image" }).click(),
    ]);
    await chooser.setFiles({ name: "pixel.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByLabel("Body")).toHaveValue(/!\[pixel\]\(https:\/\/.*blob\.vercel-storage\.com\/posts\//, {
      timeout: 30_000,
    });
    // The first upload created the draft and rewrote the URL in place.
    await expect(page).toHaveURL(/\/admin\/posts\/[0-9a-f-]{36}$/);

    if (isMobile) {
      await page.getByRole("tab", { name: "Preview" }).click();
      await expect(page.locator(".article-body iframe")).toHaveCount(1);
      await page.getByRole("tab", { name: "Write" }).click();
    }

    await page.getByRole("button", { name: "Publish" }).click();
    // The "Published" toast is a decorative, self-dismissing (~3.2s) client
    // notification, and the dev server's first-ever compile of a Server
    // Action mid-test can force a Fast Refresh full reload of the open admin
    // page (same class of race as gotoStable above) that wipes the toast's
    // React state before it paints — confirmed by hand: the post reliably
    // flips to published in the DB regardless. The Publish button turning
    // into "Unpublish" is the durable, equally-specific signal that the same
    // publish actually succeeded, so assert on that instead of the toast.
    await expect(page.getByRole("button", { name: "Unpublish" })).toBeVisible({ timeout: 30_000 });
    const editUrl = page.url();
    const slug = await page.getByLabel("Slug").inputValue();
    expect(slug).toMatch(/^e2e-article-\d+$/);

    // Public page: title, byline, image, embed. next/cache's unstable_cache
    // implements stale-while-revalidate on revalidateTag: the first read after
    // a write can still return the old (cached) value while it refreshes in
    // the background, so poll until the fresh copy is live rather than
    // asserting on the very next request.
    await expect
      .poll(async () => (await page.request.get(`/articles/${slug}`)).status(), { timeout: 15_000, intervals: [500] })
      .toBe(200);
    await gotoStable(page, `/articles/${slug}`);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.locator(".article-body img")).toHaveCount(1);
    await expect(page.locator(".article-body iframe[src*='youtube-nocookie.com/embed/dQw4w9WgXcQ']")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Edit" })).toBeVisible();

    // Feed lists it — same stale-while-revalidate window as above, so poll.
    await expect
      .poll(async () => (await page.request.get("/articles/feed.xml")).text(), { timeout: 15_000, intervals: [500] })
      .toContain(`/articles/${slug}`);
    const feed = await page.request.get("/articles/feed.xml");
    expect(feed.headers()["content-type"]).toContain("application/rss+xml");

    // Unpublish → public 404.
    await gotoStable(page, editUrl);
    await page.getByRole("button", { name: "Unpublish" }).click();
    // Same rationale as the Publish step above: assert the durable button
    // flip rather than the transient "Unpublished" toast.
    await expect(page.getByRole("button", { name: "Publish" })).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => (await page.request.get(`/articles/${slug}`)).status(), { timeout: 15_000, intervals: [500] })
      .toBe(404);

    // Delete (cleans the Blob prefix server-side).
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).last().click();
    await expect(page).toHaveURL(/\/admin\/posts$/);
    await expect(page.getByText(title)).toHaveCount(0);
  });
});
