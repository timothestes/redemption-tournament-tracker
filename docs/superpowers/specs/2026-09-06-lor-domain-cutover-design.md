# Land of Redemption Domain Cutover (Track 1) — Design

**Date:** 2026-09-06
**Status:** Approved design, pending implementation plan
**Depends on:** Articles (`2026-09-05-articles-design.md`), WXR import (`2026-09-06-wxr-import-design.md`), PR #359 (PDFs on Blob), PR #360 (first redirect layer)

## Goal

Move landofredemption.com off SiteGround and onto the tracker's Vercel project with **landofredemption.com as the canonical domain**, preserving the site's existing Google equity (#6 for "Redemption CCG", 11 years of backlinks). redemptionccg.app becomes a 308 alias. Every URL WordPress ever exposed either lands on equivalent content or returns an honest 404 — never a blanket redirect to the home page (Google scores that as a soft 404).

## Decisions (made 2026-09-06 with Tim)

1. **Canonical domain: landofredemption.com.** Same-host path redirects are treated by Google as a site restructure, not a domain move — no Change-of-Address settling period, every backlink stays one hop from content. Vercel supports this natively: both domains on the project, landofredemption.com serves, redemptionccg.app set to per-domain 308 redirect (path + query preserved). Reversible dashboard change.
2. **Site name: "Land of Redemption".** Metadata only — title template `%s | Land of Redemption`, home title close to the one already ranking. The app UI (nav, in-app copy) keeps saying RedemptionCCG App.
3. **Real home page at `/`**, lean: hero + intro + latest articles + link cards. The root currently 307s to `/decklist/community`, leaving the brand query nothing to land on.
4. **Redirect implementation: hybrid** (approach C). DB lookups where the mapping is per-row data (post slugs via `posts.source_url`, short links via a new `posts.wp_post_id`); static rules/generated maps where it's fixed (pages, categories, feeds, sitemaps). WP *pages* worth keeping are imported as articles, which gives them `source_url` rows — the already-shipped `app/[wpSlug]` route then redirects them with zero new code.
5. **Tags and author archives 404.** WP `post_tag` terms were never imported (`scripts/lib/wxr/parse.ts` keeps only `domain="category"`), and articles has no author filter. 1,182 thin tag pages + author archives return 404 rather than soft-404 redirects.

## Current state (verified 2026-09-06)

- PR #360 shipped and live: `app/[wpSlug]/page.tsx` (post-slug 308 via `source_url`, 404 on miss) + static rules for `/wp-content/uploads/*` and `/podcasts/*` (→ Blob `wp/...` mirror), `/feed`, `/our-sponsors`, `/paragon`, `/rankings`.
- `app/layout.tsx`: `metadataBase` from `VERCEL_URL` (a deployment URL), title "RedemptionCCG App", no canonical tags, no JSON-LD anywhere.
- `app/sitemap.ts`: base from `VERCEL_PROJECT_PRODUCTION_URL`; lists decks + spoilers + statics, **no articles**.
- `app/articles/lib/rss.ts` and `utils/email.ts`: already read `NEXT_PUBLIC_SITE_URL` (currently `https://redemptionccg.app`) — they flip with the env var.
- `lib/api/cache.ts` has `SITE_URL = "https://landofredemption.com"` — wrong today, becomes correct after cutover; leave as is.
- `public/robots.txt`: static, no `Sitemap:` line.
- All 1,286 posts have `source_url`; 1,275 are exactly `https://landofredemption.com/<slug>/`, 11 differ (why the DB lookup, not a slug regex).
- WordPress still serves `wp-sitemap.xml` (posts, pages, categories, tags, post-format, users sub-sitemaps) — the URL inventory source.
- DNS zone snapshot in main checkout `tmp/dns-snapshot-2026-09-05.txt`; Resend DKIM (`resend._domainkey`) + `send` SPF/MX live only in SiteGround's zone today.

## 1. Redirect surface completion

New code, all in the tracker app (runs on whichever host serves it):

| WP URL shape | Handling |
|---|---|
| `/?p=<id>`, `/?page_id=<id>` | `app/page.tsx`: before rendering home, if `p` or `page_id` param present, look up `posts.wp_post_id`; hit → 308 `/articles/<slug>`; miss → `notFound()` |
| `/?cat=<id>` | Same handler: look up the generated category map by WP term id → 308 `/articles?tag=<name>`; miss → `notFound()` |
| `/category/<slug>/` | New `app/category/[slug]/page.tsx`: generated map slug → tag name → 308 `/articles?tag=<name>`; miss → 404 |
| `/category/<slug>/feed/` | Static rule → `/articles/feed.xml` (covers the dead podcast feed) |
| `/comments/feed/` | Static rule → `/articles/feed.xml` |
| `/wp-sitemap.xml`, `/wp-sitemap-*.xml`, `/sitemap_index.xml` | Static rules → `/sitemap.xml` |
| `/tag/<x>/`, `/author/<x>/` (+ their feeds) | Deliberate 404 — two-segment paths match no route (single-segment `app/[wpSlug]` doesn't apply), so Next's natural 404 serves them. No code; confirmed by the verification script |
| `/<post-slug>/` | Already shipped (`app/[wpSlug]`) |
| `/wp-content/uploads/*`, `/podcasts/*`, `/feed` | Already shipped |
| `/wp-admin`, `/wp-login.php`, `/xmlrpc.php` | 404 (no rule; bots) |

**Data:**
- **Migration 097:** `alter table posts add column wp_post_id integer unique;` backfilled by `scripts/backfill-wp-post-ids.ts` (service role, one-off) matching WXR `wp:post_id` → `source_url`. Imported pages (section 2) get theirs at import time.
- **Generated map:** `scripts/generate-wp-redirects.ts` reads the WXR and writes `lib/wp/categoryMap.ts` — `{ [wpSlug]: tagName }` for the 51 categories plus `{ [wpTermId]: tagName }` for `?cat=`. Checked in (the WXR lives only in gitignored `tmp/`); regeneration is a dev-only command documented in the script header.

## 2. WordPress page dispositions (all 36)

**Group A — already redirected or pattern-mapped (no import):**

| WP page | Destination |
|---|---|
| `/our-sponsors/` | `/sponsors` (shipped) |
| `/paragon/` | `/resources#paragon` (shipped) |
| `/rankings/` | `/tournaments/rnrs-points` (shipped) |
| `/resources/`, `/resources-old/` | `/resources` (new static rules) |
| `/spoilers/` | `/spoilers` (new static rule) |
| `/deck-lists/` | `/decklist/community` (new static rule) |
| `/articles/` | same path exists natively — nothing to do |
| `/home-2/` | `/` (new static rule) |

**Group B — imported as articles** via a new `--pages` mode on `scripts/import-wxr.ts` (same converter pipeline, sets `source_url` + `wp_post_id`, so `app/[wpSlug]` redirects them automatically). Published pages only, with their original dates:

about-us, about-redemption, formats, hello-im-new, retailers, set-releases, nationals-2024-data, installing-lackey-with-redemption-plugin, israels-inheritance-draft-breakdown, israels-inheritance-israels-rebellion-with-roots-draft-breakdown, terms-of-service, privacy-policy, zachthejambis-card-viewer, and the 10 `2015-national-tournament-*-deck` pages. (23 pages.)

- terms-of-service / privacy-policy as articles is a stopgap; proper `/terms` + `/privacy` routes are deferred, out of scope here.
- zachthejambis-card-viewer: import if the body converts to real markdown; if it's an embed shell, drop to Group C.
- After import, repoint the two in-app hardcoded links: Lackey guide in `app/decklist/components/DeckSourcePicker.tsx`, Nats-2026 page link in `app/register/page.tsx` (verify the target — if it pointed at a page not in this list, leave for the cutover checklist).

**Group C — deliberate 404:** `/activity/` (BuddyPress, 9 rows ever), `/access-restricted/`, and the two drafts (`/redemption-resources/`, `/the-deck-database/`, never public).

## 3. Site identity & metadata

`app/layout.tsx`:

```ts
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || defaultUrl;
export const metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Land of Redemption – Redemption CCG Strategy, Deck Building, and Tournaments",
    template: "%s | Land of Redemption",
  },
  description: "Deck builder, tournament tracker, articles, and rulings for the Redemption collectible card game.",
};
```

- Sweep pages that hand-append a site name to their titles so nothing renders doubled.
- `app/articles/[slug]/page.tsx`: add `alternates: { canonical: /articles/${slug} }` and an `application/ld+json` Article script (headline, `author_name`, `datePublished`/`dateModified`, cover image when present).
- Canonicals elsewhere come free via `metadataBase` + per-page paths; add explicit `alternates.canonical` only to the indexed surfaces robots.txt allows (home, /articles, /decklist/community, /rulings, /resources, /sponsors, /spoilers, /tournaments).
- Update the stale comment atop `next.config.js` claiming redemptionccg.app stays canonical.

## 4. Home page

`app/page.tsx` becomes a real server-rendered page. **Must keep the existing `?code=` / `?error=` password-reset param redirects verbatim, first**, then the `?p=`/`?page_id=`/`?cat=` legacy handling (section 1), then render:

- Hero: dark panel (both themes) with the LoR wordmark, one-line tagline, H1 text "Land of Redemption" for crawlers (wordmark is an `<img>` with alt, H1 is real text — visually arranged, not duplicated).
- Two-sentence intro naming Redemption CCG (the content signal the old home carried).
- Latest 5 articles via `loadPublishedPosts({ page: 1 })`, reusing `PostCard`.
- Link cards: Deck Builder, Tournaments, Rulings, Resources, Play Online.
- Home metadata: absolute title (skip the template) matching the layout default.
- `/decklist/community` remains untouched; nothing else moves.

## 5. Sitemap & robots

- `app/sitemap.ts`: base from `NEXT_PUBLIC_SITE_URL` (fall back to current chain); add `/articles` and every published post (`/articles/<slug>`, `lastModified` from `updated_at`, priority 0.6). ~1,300 entries is well under the 50k limit.
- `public/robots.txt`: add `Sitemap: https://landofredemption.com/sitemap.xml` (write the literal prod URL; robots.txt is static).

## 6. Branding assets

Source: `tmp/lor-icon.webp` in the main checkout (900×244 wordmark — white "LAND OF REDEMPTION", red slash through the R, transparent bg, dark-background asset; 11 KB).

- Check it in as `public/brand/lor-wordmark.webp`; used by the home hero (dark panel guarantees contrast in both themes).
- Generate `app/opengraph-image.png` (1200×630, wordmark centered on near-black) with a one-off sharp script — becomes the site-wide default OG/Twitter card; article pages with cover images keep overriding it.
- Optional (Tim can veto at review): derive a square favicon — red-slash-R mark on a dark rounded tile — replacing `app/favicon.ico`/`app/icon.png`. If vetoed, current favicon stays.
- Nav/wordmark in the app UI: **unchanged**.
- Open item: no light-background variant of the wordmark exists; not needed for this scope (hero panel is dark), but request one from Tim before any light-surface use.

## 7. Cutover runbook (ops — Tim executes, in order)

Gates before DNS work: sections 1–6 merged and deployed; verification script (section 8) green against production on redemptionccg.app.

1. **Search Console:** locate the landofredemption.com property (Site Kit created one; find which Google account), export the Pages report — the hand-check list.
2. **Mailboxes:** check SiteGround Site Tools → Email for active @landofredemption.com mailboxes (52 WP users use such addresses). Decide keep-nowhere/forwarding before the flip. Gate item.
3. **Vercel:** add landofredemption.com + www to the project (not primary yet).
4. **DNS:** recreate the full zone in Vercel DNS from `tmp/dns-snapshot-2026-09-05.txt` with apex/www A records still pointing at SiteGround (35.215.119.229). Critical: `resend._domainkey` TXT, `send` SPF TXT + MX, `_dmarc`. Skip SiteGround-service records (mail/autoconfig/autodiscover/ftp) unless mailboxes are kept.
5. **Nameservers:** flip at GoDaddy → Vercel NS. Zero-downtime (site still serves from SiteGround). Wait for propagation; confirm Resend still sends (send a test email through the tracker).
6. **The flip:** point apex + www at Vercel; set landofredemption.com as the project's primary domain; set `NEXT_PUBLIC_SITE_URL=https://landofredemption.com` (Production env) and redeploy; set redemptionccg.app (+ www) to 308-redirect-to-primary mode.
7. **Verify:** run the verification script against `https://landofredemption.com`; hand-check the Search Console Pages export; confirm `/sitemap.xml`, `/articles/feed.xml`, auth flows (Supabase cookies are per-host — every signed-in user re-logs-in once; expected, announce it).
8. **Search Console:** submit the new sitemap on the landofredemption.com property. Keep the redemptionccg.app property; do NOT use Change of Address (this is not a domain move for Google — content stays on landofredemption.com).
9. **Monitor 2–4 weeks** (coverage + top queries), then cancel SiteGround hosting. Registration stays at GoDaddy (out of scope). Redirects are permanent — never remove them.

## 8. Verification

- `scripts/data/lor-url-inventory.json`: checked-in snapshot of every URL from the live `wp-sitemap.xml` sub-sitemaps (capture during implementation, while WordPress is still up) plus representative `?p=`/`?page_id=`/`?cat=` ids, each annotated with expected outcome: `200` (possibly via ≤3-hop redirect chain) or `404` (tags, authors, Group C).
- `scripts/verify-lor-redirects.ts --base <url>`: fetches each inventory entry against the base host, follows redirects (max 3 hops), asserts the expected outcome, prints a failure table. Runnable pre-cutover (against redemptionccg.app / a preview deploy) and post-cutover (against landofredemption.com). No test framework needed — exit code + table.
- Unit tests: category map generation (spot-check known slugs), `wp_post_id` backfill idempotency, home page legacy-param handling (`?p=` hit, miss, `?code=` still wins).

## Out of scope

WordPress comments (1,144 — dropped), BuddyPress, mailbox hosting/migration, domain registration transfer from GoDaddy, proper `/terms`+`/privacy` routes, a light-mode wordmark variant, importing WP tags, any Change-of-Address filing.
