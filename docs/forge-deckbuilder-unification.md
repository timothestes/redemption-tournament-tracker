# Forge ↔ main deck builder — unification design

**Question:** make the Forge use the main player-facing deck builder instead of its bespoke
one, in a way that's best to maintain long-term.
**Decision owner:** Tim. **Investigated by:** two independent subagents (both converged on the
same architecture — strong signal). **Status:** ✅ implemented on branch `forge-deckbuilder-unification`
(phases 0→3b, commits `1149d8f`→`65ff578`). Plan + per-phase notes:
`docs/superpowers/plans/2026-06-26-forge-deckbuilder-unification.md`.

**Deferred (known, non-blocking):**
- Loaded forge cards fall back to a minimal `Card` (type `"Unknown"`) for deck-panel
  grouping/deckcheck — art + save/load round-trip are correct (image seam keys on
  `imgFile`); full fidelity needs the optional `mapLoadedCard` persistence seam.
- The hidden image preloaders fire a wasted 404 for forge `imgFile`s (`forge:<id>`).
- Live forge save/load round-trip still wants a manual pass in a forge-authenticated
  session (CI can't auth as a forge member).

---

## Decision (TL;DR)

**Parameterize the *existing* main builder via a `DeckBuilderConfig` React context with four
injection seams — `pool`, `renderThumb`, `persistence`, `features/formats` — and make the Forge a
*configuration* of it, not a fork.** Do **not** rewrite the builder headless, and do **not** keep two
builders. The Forge's parallel UI (~385 lines) collapses to a ~40-line config object; every
player-facing feature (filters, spotlight, drag-drop, quantity steppers, legality checklist) is
written once and both surfaces inherit it forever.

Why not the alternatives:
- **Headless rewrite (shared core + two wrappers):** churns a ~7,700-line *working, player-facing*
  builder on a security boundary to serve one small private consumer. Asymmetric — adapt the small
  thing to the big thing's seams, don't re-platform the big thing.
- **Keep the fork:** exactly the indefinite two-builder maintenance cost you want gone.

## Why this is cheap: the builder is already mostly seamed

The Forge already reuses the main `Card`/`DeckCard`/`DeckZone` types and `validateDeck` **unchanged**,
and `DeckBuilderPanel.tsx` is **pure presentation driven by props** — it takes `deck` + ~26 mutation
callbacks + `allCards`, and does *not* import `ALL_CARDS` or call `useDeckState` itself
(props interface ~`DeckBuilderPanel.tsx:105-186`). Persistence is *already* injected at the panel
boundary. Only three things are hardwired to the public world:

1. **Pool source** — `client.tsx:17` imports `ALL_CARDS`; loaded into state ~`client.tsx:870-871`.
2. **Card image rendering** — `CardImage.tsx`/`useCardImageUrl` used at ~17 call sites across 7 files;
   builds `…/card-images/<imgFile>.jpg`, which 404s for a Forge card (`imgFile=""`, `dataLine="forge:<id>"`).
   This is the deepest, riskiest coupling.
3. **Persistence** — `useDeckState.ts:4` imports `saveDeckAction`/`loadDeckByIdAction` (the `decks`
   table); Forge persists JSONB entries to `forge_decks`.

## The four seams (one context)

```ts
// app/decklist/card-search/builderConfig.tsx  (lives under decklist/, MAY use next/image)
interface DeckBuilderConfig {
  pool: Card[];                                   // public: ALL_CARDS ; forge: [...forgeCards, ...ALL_CARDS]
  renderThumb: (card: Card) => ReactNode;         // THE key seam (image abstraction)
  persistence: { load(id): Promise<Deck>; save(deck, name?): Promise<{id}>; delete?(id): Promise<void> };
  features?: { import?; share?; tags?; tournament?; localStoragePersist? };  // off for Forge
  formats?: string[];
}
const Ctx = createContext<DeckBuilderConfig>(/* public defaults */);
export const useBuilderConfig = () => useContext(Ctx);
```

Context (not prop-threading) because `renderThumb` is needed at ~17-46 leaf call sites — a
`useBuilderConfig()` read at each leaf is far less noisy than threading a prop through all of them.

### Seam 2 is the hard one — and the security boundary

The `next/image` ban under `app/forge/**` is an **enforced CI test** (`__tests__/forge-no-next-image.test.ts`,
a static string scan run in `npm test`) — because private Blob art shares the storage domain that
`next.config.js` wildcards, so `<Image>` could CDN-cache a public optimized variant of *secret* art.

Seam solution (keeps the test green and never optimizes secret art):
- The **default** `renderThumb` (today's `CardImage` → `next/image`) lives under `app/decklist/` — legal.
- The **Forge** `renderThumb` is the existing `MixedThumb` (`PoolSearch.tsx:15-26`): forge cards →
  `ForgeCardPreview` (plain `<img>` via the `/forge/api/art/<id>` proxy), public cards → the default.
- The Forge wrapper file imports the shared builder but **contains no `next/image` string**, so the
  static scan stays green. (`CardImage.tsx:49` already sets `unoptimized` for `/api/` URLs — same sanctioned pattern.)

## File-by-file plan

- **New** `app/decklist/card-search/builderConfig.tsx` — the context + public-default config.
- **`CardImage.tsx`** — keep the `next/image` body as the *default* `renderThumb`; leaf components call
  `useBuilderConfig().renderThumb(card)` (or a tiny `<DeckCardThumb card/>`) instead of importing `CardImage`.
- **`useDeckState.ts`** — replace the static `saveDeckAction`/`loadDeckByIdAction` import with
  `config.persistence`; gate the `localStorage` autosave behind `features.localStoragePersist`.
- **`client.tsx`** — extract body into `<DeckBuilderRoot config>`; replace `ALL_CARDS` (`:17`, `:870-871`)
  with `config.pool`; gate import/export, tournament `deckcheck`, share-links, tags behind `features`.
- **Public wrapper** (`app/decklist/card-search/page.tsx`) — pass today's values (all features on).
- **Forge wrapper** (`app/forge/play/decks/[deckId]/DeckBuilder.tsx`) — pass mixed pool + `MixedThumb`
  renderer + a `forge_decks` persistence adapter (wrapping `saveForgeDeck`/`getForgeDeck` +
  `entriesFromDeckCards`/`hydrateEntries`), features trimmed.
- **Delete** (Phase 3): `PoolSearch.tsx`, `DeckPanel.tsx`, `useForgeDeckState.ts`.
- **Keep**: every pure adapter (`deckAdapter.ts`, `deckSerialize.ts`, `deckPool.ts`, `deckTypes.ts`,
  `forgeDecks.ts`) — they *become* the Forge config's implementation.

## Phased rollout (the live public builder works at every step)

0. **Introduce the seams; public passes today's values → zero behavior change.** Pure
   inversion-of-control. Verify `/decklist/card-search` is behavior-identical + tests green. Safest first step.
1. **Migrate the ~17 image call sites** to the thumb seam (default = current `CardImage`). Pure refactor;
   gate on a visual diff of the search grid + existing tests.
2. **Lift persistence** into the injected adapter behind the public default. Existing save/load tests cover it.
3. **Point the Forge route at the unified builder** with the Forge config; delete the bespoke Forge UI.

## Risks & mitigations
- **Guardrail regression** — keep `next/image` out of any `app/forge/**` file; extend the scan test to
  also assert the Forge wrapper renders forge cards via `ForgeCardPreview`.
- **`localStorage` cross-talk** — the shared `STORAGE_KEY` would bleed a public draft into Forge; gate
  `localStoragePersist` off for Forge (Forge decks are RLS-scoped, not browser drafts).
- **Feature creep** — import/export, tournament deck-check, public share-links, tags pull in
  `decks`-table actions + a public token format with no Forge-UUID notion; `features` flags must
  hard-disable these, asserted in CI.
- **Scope on a security boundary** — keep Phase 0 strictly mechanical so the diff is auditable.

## Recommendation on execution
This is a multi-phase refactor of a working, player-facing builder on a security boundary, so it
should land as a **reviewed, phased change** (PR per phase), not a blind overnight blast. Phase 0 is
safe and mechanical — a good place to start the moment you greenlight it.
</content>
