# Roadmap & Backlog

Working notes moved out of `readme.md`. These are ideas and known rough edges, not commitments.

## Shipped

Tournament Tracker · Deck building (with Paragon support) · Spotlight Mode · YTG Add to Cart ·
Min Price · Cube improvements · Jayden Mode · Official Deck Checks · Goldfish practice ·
Spoiler page · Official upcoming tournaments · Tournament deck publishing · Card-specific rulings ·
Card groupings · AoD calculations · Print match slips · QR code tournament join · Deck linking

## Short term

- Fallow audit: https://github.com/fallow-rs/fallow
- Pre-bake duplicate card groups at build time (static JSON) instead of fetching from Supabase at
  runtime — eliminates cold-start connection pressure on deckcheck

## Long term

- Deck versioning
- Wishlist
- Metagame snapshot
- Teaching new players how to play
- Animations in goldfish/play mode
- Cube builder
- Deck upvoting
- Offline installable app on phone (PWA with offline capabilities)

## Play mode

- Save game, load game, invite to game
- Battle phase/zone could be better

## Forge improvements

- Improve delete dialog box
- Deleting a card leads to 404 page
- Brigade boxes off color
- Clicking on a card should let the user edit that place easily
- Cactus copyright and artist not visible; artist not editable
- Lost Soul: no identifier pill
- Prebuilt template starters for each card type — start with card type, *then* prompt for ability,
  instead of having ability be its own step
- GE doesn't add icon box
- Hero/GE should have special handling: hero icon on the left, enhancement icon on the right
- Curse/Covenant will need the same handling
- Artifact not showing icon
- Clarify what "mark as placeholder" means
- When creating a set, offer default targets (ask for number of cards, have them approve initial
  card type targets)
- The target UI needs work
- Forge deckbuilding UI differs from the deckbuilder everyone is used to — unify them
- Navigation within Forge is nonexistent
- Some dropdowns don't handle dark mode at `/forge/play/decks/new`
- Artwork loading for playtest cards is rough
- Cards can have "playtesting" status but not actually be playtestable
