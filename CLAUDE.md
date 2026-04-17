# Redemption Tournament Tracker

Web app for Redemption CCG tournaments, deck building, and event registration.

## Tech Stack

Next.js 15 (App Router), React 19, TypeScript, Supabase (PostgreSQL + Auth), Tailwind CSS + shadcn/ui + Flowbite React, Vercel Blob (card images), Resend (email), SpacetimeDB (multiplayer game state), deployed on Vercel.

## Key Conventions

- **Supabase clients**: Server components/actions use `utils/supabase/server.ts`, client components use `utils/supabase/client.ts`. Never import server client in `"use client"` files.
- **Auth**: Supabase Auth + PostgreSQL role `registration_admin` for admin access. RLS enabled on all tables.
- **Server actions**: Located in `app/*/actions.ts` with `"use server"` directive. Deck actions are in `app/decklist/actions.ts`.
- **Migrations**: `supabase/migrations/` with numeric prefix (e.g., `001_create_deck_tables.sql`). Run via Supabase MCP or directly.
- **Styling**: Tailwind utilities first, dark mode via `next-themes`, `cn()` from `lib/utils.ts`.

## Dev Commands

```bash
npm run dev              # Dev server at localhost:3000
npm run build            # Production build
make update-paragons     # Download latest Paragon CSV and regenerate TypeScript
make update-cards        # Download latest carddata.txt and regenerate TypeScript
```

## Key References

| Topic | Location |
|-------|----------|
| DB schema | `prompt_context/context.md` |
| Pairing algorithm | `prompt_context/algorithm.md` + `utils/tournament/pairingUtilsV2.ts` |
| Deck rules | `prompt_context/redemption_deck_rules.md` |
| Paragon format | `prompt_context/paragon_format.md` |
| Deck validation | `app/decklist/card-search/utils/deckValidation.ts` |
| Deck state | `app/decklist/card-search/hooks/useDeckState.ts` |
| Card data access | `lib/cards/lookup.ts` — canonical `CARDS` / `findCard` / `CardData`. Backed by generated `lib/cards/generated/cardData.ts`; regen with `make update-cards`. |
| Nationals config | `app/config/nationals.ts` |
| Official REG (v11) | landofredemption.com/wp-content/uploads/2026/03/REG_PDF_11.0.0.pdf |
| Official ORDIR (v7) | landofredemption.com/wp-content/uploads/2026/03/ORDIR_PDF_7.0.0.pdf |
| Deck Building Rules (v1.3) | landofredemption.com/wp-content/uploads/2026/03/Deck_Building_Rules_1.3.pdf |
| Design system | `prompt_context/design_system.md` |
| Goldfish mode | `prompt_context/goldfish_practice_mode.md` |
| Goldfish design system | `prompt_context/goldfish_design_system.md` |
| Multiplayer design spec | `docs/superpowers/specs/2026-03-23-multiplayer-spacetimedb-design.md` |
| SpacetimeDB SDK rules | `spacetimedb/CLAUDE.md` — **READ THIS before writing any SpacetimeDB code.** Contains critical SDK gotchas, hallucinated API warnings, and correct patterns. |

## Design Context

### Users
Competitive and casual Redemption CCG players who need to build decks, register for tournaments, and track events. They come with intent — searching cards, tweaking decklists, checking pairings mid-round. Mobile usage is high (players at tables checking standings on their phones). The job: get tournament and deck tasks done quickly with zero friction.

### Brand Personality
**Clean, serious, professional.** This is a tool for players who take their game seriously. No whimsy, no clutter — every element earns its place. The interface should feel like a sharp, well-built instrument.

### Aesthetic Direction
- **Visual tone:** Data-dense and functional, inspired by Moxfield/Archidekt. Information-forward with clear hierarchy. Neutral palette (current grayscale HSL tokens) with purposeful accent color for actions and states.
- **Typography:** Geist Sans for UI, Cinzel for display/headers where biblical gravitas is needed. Prioritize legibility at small sizes on mobile.
- **Theme:** Light and dark mode (system default). Light mode is near-white with subtle background imagery; dark mode is rich and immersive.
- **Anti-references:** Avoid overly flashy game UIs (Hearthstone-style heavy textures), generic Bootstrap looks, or cluttered dashboards. No gratuitous animation or decoration.

### Design Principles
1. **Function over form** — Every UI element must serve a clear purpose. Data density is a feature, not a bug. Optimize for task completion speed.
2. **Mobile-first** — Design for phone screens at tournament tables first, then scale up. Touch targets, readable text, and one-handed operation matter.
3. **Quiet confidence** — The interface should feel professional and restrained. Use subtle motion (Framer Motion, GSAP) to reinforce interactions, not to decorate.
4. **Clarity at a glance** — Players glance at screens mid-game. Information hierarchy, contrast, and scannability are critical. Use whitespace and typography to guide the eye.
5. **Consistency** — Use shadcn/ui components and Tailwind design tokens uniformly. New UI should feel like it belongs with existing UI.
