# Article card mentions and deck embeds — design

**Date:** 2026-09-07
**Status:** implemented 2026-09-07 on `feat/article-card-deck-embeds`; the PR is the review gate
**Builds on:** `2026-09-05-articles-design.md` (markdown storage, `ArticleBody` as the one renderer)

## Goal

Let posters reference Redemption cards and decks inside an article with as little
ceremony as a link, and give readers something richer than a link:

- A **card mention** renders the card name inline; hovering shows the card image
  (desktop) and tapping opens a full-screen view (mobile and desktop).
- A **deck embed** renders the deck inline as an interactive card grid grouped
  by type, with tap-to-enlarge and prev/next, plus a link to the full deck page.

Both must work on phones. Both must degrade to readable text where they cannot
render (RSS description, excerpt, a deck that went private).

## Author-facing syntax

| What | Markdown | How it gets there |
|---|---|---|
| Card mention | `[[Son of God]]` | Toolbar **Card** button → search → pick, or type `[[` in the body to open the same picker. Hand-typing the whole thing also works. |
| Deck embed | The deck's URL alone on its own paragraph: `https://landofredemption.com/decklist/<uuid>` (relative `/decklist/<uuid>` also accepted) | Toolbar **Deck** button → pick one of your decks, or paste any deck link. |

Design choices:

- **Wiki-style `[[ ]]`** is the most recognisable "reference a thing" syntax,
  never collides with CommonMark (a bare `[x]` with no definition is literal
  text, which the remark probe confirmed), and stays readable as plain text in
  the feed and in editors that don't know about it.
- **Deck by URL** mirrors the existing YouTube rule exactly: a paragraph that is
  only a recognised link becomes an embed. Posters already copy that URL from
  the deck builder's Share dialog. No new ID scheme.
- A mention's **text is what the author typed**; only the image is looked up.
  An exact printing name (`Son of God (Promo)`) resolves to that printing's
  identity; a plain name resolves to the canonical printing chosen by
  `representativeCard()` (currently-legal, shortest name).
- The card name inside `[[ ]]` may not contain `[`, `]` or a newline.

## Rendering pipeline

`ArticleBody` is shared by the server article page and the client editor
preview, and the card database (2.9 MB JSON) and Supabase must stay off the
client. So resolution happens **outside** the renderer and is handed in:

```
markdown ──► resolveArticleRefs(markdown)  (server only)
                 │  cards: name → { name, imgFile }   via lib/cards/lookup + cardIdentity
                 │  decks: uuid → DeckEmbedData | null via lib/api/cache.loadPublicDeckDetail
                 ▼
          <ArticleBody markdown refs />
                 │  remarkCardMentions: text "[[X]]" → <card-mention name="X">
                 │  p override: sole /decklist/<uuid> link → <DeckEmbed>
                 ▼
          <CardMention>  <DeckEmbed>      ("use client", small)
```

- **Article page** (`app/articles/[slug]/page.tsx`, server, ISR 1h): awaits
  `resolveArticleRefs(post.body_md)` and passes `refs`. Deck detail comes from
  the already-cached `loadPublicDeckDetail` (tag `public-deck:<id>`, 1h), which
  reads through the anon client so **only unlisted/public decks resolve** and
  no `view_count` write happens per render.
- **Editor preview** (client): `PostEditor` debounces the body and calls the
  poster-gated server action `resolveArticleRefsAction(markdown)`; the preview
  re-renders with the same `ArticleBody`. A request counter drops stale
  responses. Until refs arrive, mentions render as plain text and deck URLs as
  links, then upgrade in place.
- **`refs` absent** (unit tests, any future caller): mentions render as plain
  text, deck URLs stay links. Nothing breaks without resolution.
- **Draft mode** (`draft` prop, editor preview only): an unresolved mention gets
  a wavy underline and a title "No card named …" so the author notices a typo.
  Readers never see this.

### `[[ ]]` parsing

`remarkCardMentions` walks mdast `text` nodes only, so mentions inside code
spans and fenced blocks are left alone, while mentions inside emphasis, links,
headings and list items work. Each match becomes
`{ type: "cardMention", data: { hName: "card-mention", hProperties: { name } } }`,
which `mdast-util-to-hast` turns into a `<card-mention>` element and
react-markdown routes to the `CardMention` component via `components`.

### Deck URL detection

`deckIdFromUrl(href)` accepts a path of exactly `/decklist/<uuid>` when the URL
is relative or its host ends in `landofredemption.com`, `redemptionccg.app`,
`localhost`, `127.0.0.1` or `.vercel.app`. Anything else is an ordinary link.

## Components

### `CardMention` (`app/articles/components/CardMention.tsx`, client)

Props: `{ name: string; imgFile?: string | null; draft?: boolean }`.

- Renders a `<button type="button">` (phrasing content — valid inside `<p>`)
  styled as the name with a dotted underline; hover/focus moves the underline
  to the accent colour. Green is reserved for hover/active per the design
  memory, so nothing is green at rest.
- **Pointer devices:** mouseenter (150 ms intent delay) shows a fixed-position
  portal preview, 240 px wide, above the anchor when there is room, otherwise
  below, clamped to the viewport; hidden on mouseleave, scroll, or Escape.
- **Touch devices** (`useInputMode() === "touch"`): no hover path. The button
  gets the ChatPanel strike-zone trick (6 px vertical padding with a matching
  negative margin) so the tap target grows without changing line height.
- **Click / Enter / Space on any device:** opens `CardEnlargeModal` with the
  full card and its name. This is also the keyboard path.
- No `imgFile` → plain `<span>` of the name (plus the draft wavy underline).

### `DeckEmbed` (`app/articles/components/DeckEmbed.tsx`, client)

Props: `{ id: string; deck: DeckEmbedData | null }`.

`DeckEmbedData` (`lib/decks/embed.ts`):

```ts
interface DeckEmbedCard { name: string; set: string | null; imgFile: string | null; quantity: number; type: string }
interface DeckEmbedGroup { label: string; count: number; cards: DeckEmbedCard[] }
interface DeckEmbedData {
  id: string; name: string; format: string | null; username: string | null;
  cardCount: number; reserveCount: number;
  groups: DeckEmbedGroup[];   // main deck, canonical type order
  reserve: DeckEmbedCard[];   // sorted, may be empty
}
```

- Wrapper is `not-prose` so prose margins don't leak in. Header: kicker
  (format · N cards · by username), deck name linking to `/decklist/<id>`, and
  an "Open deck" link. Body: one section per group with a small label and
  count, then a grid of `CardTile`s (`grid-cols-4 sm:grid-cols-6 md:grid-cols-8`)
  so a phone shows four tiles across, a desktop article column eight. Reserve
  is its own section after the main deck.
- Tapping a tile opens `CardEnlargeModal` with prev/next over the flat main +
  reserve list (arrows on desktop, swipe on mobile, arrow keys everywhere).
- `deck === null` (private, deleted, or bad id): a muted bordered box —
  "This deck isn't available. It may be private or deleted." — with the link
  still present. The same box appears in the editor preview, which is how a
  poster learns their deck needs to be unlisted.

### Grouping (`lib/decks/typeGroups.ts` + `lib/decks/embed.ts`)

`prettifyTypeName`, `getGroupKey`, `getGroupDisplayName` move out of
`app/decklist/[deckId]/client.tsx` into `lib/decks/typeGroups.ts` unchanged;
the deck page imports them from there. `buildDeckEmbed(payload, findCard)`
enriches each card with its type via `findCard(name, set, imgFile)`, groups
main-zone cards with `getGroupKey`, sorts inside groups with
`compareCardsByType` and orders groups with `compareTypeGroups` — the same
order readers see on the deck page. Maybeboard cards are excluded, as
everywhere else.

## Editor

- `MarkdownToolbar` gains **Card** (`WalletCards`) and **Deck** (`Layers`).
- `CardPicker` (dialog): search input (autofocus), results from
  `searchCardsAction(q)` — up to 12 rows, one per card identity, each with a
  thumbnail, the name and the set; Enter picks the highlighted row, arrows move.
  Picking replaces the trigger range with `[[Name]] `.
  - Opened by the toolbar with the current selection as the initial query
    (selected text becomes the mention).
  - Opened by typing `[[` at the caret. Dismissing leaves the typed `[[` alone.
- `DeckPicker` (dialog): `listMyDecksForEmbedAction()` lists the poster's decks
  (name, format, card count, visibility badge, newest first) with a filter box,
  plus a "paste a deck link" field for anyone's public deck. Picking a
  **private** deck asks "Make this deck unlisted so readers can see it?" and,
  on confirm, calls the existing `setDeckVisibilityAction(id, "unlisted")`
  before inserting. Insert = the absolute URL on its own paragraph via
  `insertBlock`, so it round-trips with what the Share dialog produces.
- Both dialogs use the existing hand-rolled `Dialog`, which already caps height
  and scrolls its body on phones.

## Server actions (`app/admin/posts/actions.ts`, all `requirePoster()`)

- `searchCardsAction(q)` → `{ cards: { name, imgFile, set }[] }` from
  `lib/cards/search.ts`: normalised (lowercase, straight apostrophes) prefix
  matches first, then substring, deduped by identity key, representative
  printing's image.
- `listMyDecksForEmbedAction()` → the poster's own decks, `visibility` included.
- `resolveArticleRefsAction(markdown)` → `ArticleRefs` for the preview. Body
  capped at the same limit the editor already enforces; mentions capped at 200
  and decks at 10 per resolve so a pathological draft cannot fan out.

## Degradation

- `excerptFromMarkdown` strips `[[`/`]]` and keeps the name; deck URLs were
  already dropped with every other bare URL. RSS descriptions therefore read
  naturally.
- Raw HTML is still escaped (no `rehype-raw`); the only new element is produced
  by the remark plugin from text, and its one property is a plain string
  rendered as React text.

## Testing

- Unit (vitest, pure): `extractCardMentions`, `deckIdFromUrl`, excerpt
  stripping, `remarkCardMentions` (via `ArticleBody` + `renderToStaticMarkup`:
  mention → element, code span untouched, unresolved → text, deck paragraph →
  embed with refs / link without), `buildDeckEmbed` grouping and ordering,
  `searchCardNames` prefix-first and dedupe, `resolveCardRefs` against the real
  card index.
- Manual: dev server in the worktree, Playwright at desktop and 390 px widths:
  article with two mentions and one embed; hover preview; tap → enlarge with
  swipe; editor `[[` trigger, both pickers, private-deck confirm; preview
  upgrades after resolve.

## Out of scope

- Inline caret-anchored autocomplete (the picker is a dialog).
- A public card page for mentions to link to.
- Deck list/text view toggle, price or legality inside the embed.
- Embedding decks the reader cannot see (no signed links).
