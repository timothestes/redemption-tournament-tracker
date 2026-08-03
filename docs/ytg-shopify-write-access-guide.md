# Granting Write Access for the Set Importer — YTG Store Owner Guide

A walk-through for adding the `write_products` permission to the existing
RedemptionCCG.app integration on `your-turn-games.myshopify.com`. Written to be
read together over a call. About 5–10 minutes.

## What we're asking for, in plain terms

The integration that already reads your singles prices needs one additional
permission — **write products** — so it can create the new-set listings for you
(one product per card, with image and price attached).

Reassurances up front:

- **Everything imports as a hidden Draft** by default. Nothing appears in the
  store until you publish it (there's an "active" option, but it's off unless
  you turn it on per import).
- The permission covers **products only** (products, variants, collections).
  It cannot touch orders, customers, payments, payouts, or store settings.
- **Inventory is untouched** — the importer doesn't track or change stock.
- **No new passwords or secrets to send.** The app keeps its existing
  credentials; you're only widening what those credentials may do.
- You can **revoke it at any time** (remove the permission or the app).

Current state, verified via the API: the app has exactly one permission today —
`read_products`. We're adding `write_products` (which includes read).

## Before you start

- Log in as the **store owner** account (staff accounts may lack access to the
  app-development area).
- The app to modify is the custom app used for the price sync — its API key
  (Client ID) starts with `773…`. If more than one app is listed, check the
  key's first characters against that.

## Part 1 — Open the app's settings

The app was set up with Shopify's newer app system, so its settings most likely
live in Shopify's **Dev Dashboard** rather than the store admin itself.

1. Go to **https://dev.shopify.com** and sign in with the same account you use
   for the store. (Alternative route: Shopify admin → **Settings** → **Apps and
   sales channels** → **Develop apps** → the button that sends you to the Dev
   Dashboard.)
2. Open **Apps** and click the price-sync app.

> **If the app isn't listed in the Dev Dashboard**, it's an older-style custom
> app managed inside the store admin — skip to "Fallback: older-style app"
> below. Same result, shorter path.

## Part 2 — Add the write-products permission

In the Dev Dashboard, permissions ("access scopes") are part of the app's
configuration and ship as a new **version** of the app:

1. Open the app's **Versions** (or configuration) tab.
2. Find the **Admin API access scopes** section.
3. Add **`write_products`**. Depending on the screen, this is either a
   checkbox under a *Products* heading or a search box — if it's a search box,
   type `write_products` and select it. Leave `read_products` as is.
4. Save / **Release** the new version. (Releasing an app version here is just
   Shopify's way of saving a settings change — it doesn't touch your store
   theme or anything shopper-facing.)

## Part 3 — Approve the new permission on the store

Shopify does not silently widen an installed app's permissions — the store has
to approve the addition once:

1. Go back to your **store admin** → **Settings** → **Apps and sales
   channels**, and open the app's entry. If Shopify wants approval, you'll see
   a banner or button describing the new permission — click **Update / Approve**.
2. If no prompt appears there, return to the Dev Dashboard app page and look
   for an **Installs** section — re-running **Install** for
   `your-turn-games` presents the same approval screen (it re-authorizes;
   it doesn't create a duplicate app).

The approval screen should list *"Modify products"* (or `write_products`) as
the only change. That's the expected ask — if it lists anything more
(orders, customers, etc.), stop and tell me before approving.

## Fallback — older-style app (only if Part 1 found it in the store admin)

1. Shopify admin → **Settings** → **Apps and sales channels** → **Develop
   apps** → click the app.
2. **Configuration** tab → **Admin API integration** → **Edit**.
3. Under **Products**, tick **write_products** (Read and write).
4. **Save**. No reinstall or new token is needed; the change applies to the
   existing credentials.

## Part 4 — Tell me, and I'll confirm from my side

Nothing to copy or send. Once you've approved, I run a 30-second check that
asks Shopify what the app's credentials are now allowed to do — I'm looking
for `write_products` to appear next to `read_products`. I'll confirm on the
spot.

## What happens next

1. We pick **one cheap card** and import just it, as a Draft, while you watch.
2. You open it in your admin: right title, right image, right price, hidden
   from the storefront. Publish it or delete it — your call.
3. When you're happy, we do a full set the same way: you review the Draft
   products in bulk and publish when ready.

## Undo / revocation

- Remove the permission the same way it was added (edit scopes back to
  read-only), or uninstall the app from **Settings → Apps and sales
  channels** — either immediately cuts off write access.
- Rotating the app's client secret (Dev Dashboard → app → Settings →
  Credentials) also invalidates the integration's access entirely.
