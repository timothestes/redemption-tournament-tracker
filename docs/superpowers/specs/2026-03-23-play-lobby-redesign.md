# Play Lobby Redesign — Unified Deck Picker

**Date:** 2026-03-23
**Status:** Draft
**Scope:** Redesign `/play` lobby page with searchable deck selection

---

## Problem Statement

The current play lobby uses native HTML `<select>` dropdowns for deck selection — one for creating a game, another for joining. There's no search, no deck previews, no access to community decks. The UX is functional but bare-bones.

---

## Design

### Unified Deck Selection

Replace both dropdowns with a single deck picker at the top of the page. The selected deck is shared between Create and Join flows.

**Deck picker component:**
- Search input with placeholder "Search your decks or community decks..."
- Two tabs below input: "My Decks" (default) | "Community"
- Results list shows: deck name, format badge (T1/T2/Paragon), card count
- My Decks tab: client-side filter of the user's decks (already fetched server-side)
- Community tab: server-side search via `loadPublicDecksAction({ search })` with 300ms debounce
- Clicking a deck selects it and collapses the picker
- Selected deck shows as a compact card: name + format badge + "Change" button

**Selected deck state:**
- Stored as `{ id: string; name: string; format: string | null }` in component state
- Passed to both Create and Join flows
- Format auto-populated from deck's format field

### Simplified Layout

```
┌─────────────────────────────────────────┐
│  PLAY ONLINE                            │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ 🔍 Search decks...              │    │
│  │ [My Decks] [Community]          │    │
│  │ ┌─────────────────────────┐     │    │
│  │ │ Deck Name (T1) · 50 cards│    │    │
│  │ │ Deck Name (T2) · 56 cards│    │    │
│  │ └─────────────────────────┘     │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Display Name: [____________]           │
│                                         │
│  ┌──────────────┐  ┌──────────────┐     │
│  │ CREATE GAME  │  │  JOIN GAME   │     │
│  │              │  │ Code: [____] │     │
│  │  [Create]    │  │  [Join]      │     │
│  └──────────────┘  └──────────────┘     │
│                                         │
│  Spectate: [Code] [Watch]               │
└─────────────────────────────────────────┘
```

### Key Changes

1. **Single deck picker** replaces two dropdowns — selected deck shared for create/join
2. **Searchable** — text input filters My Decks client-side, Community Decks server-side
3. **Community deck access** — players can pick any public deck to play with
4. **Format auto-detection** — format field auto-set from deck, still overridable
5. **Compact create/join** — side-by-side instead of stacked sections
6. **Display name** — moved above the action buttons, shared

---

## Files Affected

| File | Change |
|---|---|
| `app/play/page.tsx` | Fetch preview cards + card count alongside existing deck data |
| `app/play/actions.ts` | Add `searchCommunityDecks()` server action |
| `app/play/components/GameLobby.tsx` | Full rewrite — unified deck picker, simplified layout |

---

## Out of Scope

- Deck preview images (thumbnails) — would require fetching preview_card URLs and rendering; defer to later
- Goldfish mode integration from this page
- Deck legality indicators
