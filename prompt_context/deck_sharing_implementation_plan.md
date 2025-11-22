# Public Deck Sharing - Bare Bones Implementation Plan

## Overview
Simple link sharing for decks. Make a deck public, get a shareable link, anyone can view it.

**Current State:** Database already has `is_public` boolean with RLS policies configured.

---

## Phase 1: Core Sharing Features (MVP)

### 1.1 Make Deck Public/Private Toggle
**Location:** Deck builder & My Decks page

**Files to modify:**
- `app/decklist/actions.ts` - Add action to toggle deck public status
- `app/decklist/my-decks/client.tsx` - Add toggle UI in dropdown menu
- `app/decklist/card-search/[components]` - Add toggle in deck settings

**Implementation:**
```typescript
// New action
export async function toggleDeckPublicAction(deckId: string, isPublic: boolean) {
  // Verify ownership
  // Update is_public field
  // Revalidate paths
}
```

**UI Elements:**
- Toggle switch or checkbox in deck dropdown menu
- Visual indicator (badge/icon) showing public/private status
- Confirmation modal when making deck public (explain implications)

---

### 1.2 Public Deck URL & Sharing
**Location:** New route for viewing public decks

**New files to create:**
- `app/decklist/public/[deckId]/page.tsx` - Server component for public deck view
- `app/decklist/public/[deckId]/client.tsx` - Client component for interaction
- `app/decklist/actions.ts` - Add `loadPublicDeckAction(deckId)`

**Features:**
- Read-only deck view (similar to PDF layout but interactive)
- Show deck creator's name (fetch from auth.users)
- "Copy to My Decks" button (duplicate deck to user's library)
- Share button with copy link functionality

**URL Structure:**
```
/decklist/public/[deckId]
```

**Metadata:**
- Open Graph tags for social sharing
- Deck name, description, card count in preview

---

## Implementation Tasks

### Must Have (Link Sharing Only)
- [ ] Toggle deck public/private in My Decks dropdown
- [ ] Public deck view page at `/decklist/public/[deckId]`
- [ ] Share link button (copy URL to clipboard)
- [ ] "Copy to My Library" button on public deck view

### Future (Community Features)
- Community browse page
- Filtering & sorting
- User profiles
- Tags
- Comments & ratings
- Collections
- Everything else

---

## Notes

- Database already configured with `is_public` field and RLS policies ✅
- No migrations needed
- Keep it simple

