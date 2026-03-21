# Deck Check API

Validates a Redemption CCG deck against official Type 1 and Type 2 deck building rules (v1.3).

**Base URL:** `https://<your-domain>/api/deckcheck`
**Method:** `POST`
**Content-Type:** `application/json`

## Authentication

External API consumers must include a Bearer token:

```
Authorization: Bearer <DECKCHECK_API_TOKEN>
```

The token is configured via the `DECKCHECK_API_TOKEN` environment variable on the host Vercel project. Same-origin browser requests skip auth.

## Request

### Option A: Validate by deck ID

```json
{
  "deckId": "uuid-of-saved-deck"
}
```

Fetches the deck and its cards from the database, then validates.

### Option B: Validate by card list

```json
{
  "cards": [
    { "name": "Captain of the Host", "set": "PoC", "quantity": 1 },
    { "name": "Lost Soul (L)", "set": "Starter", "quantity": 1 }
  ],
  "reserve": [
    { "name": "Angel at the Tomb", "set": "Apostles", "quantity": 1 }
  ],
  "format": "Type 1"
}
```

| Field    | Type              | Required | Default    | Description                          |
|----------|-------------------|----------|------------|--------------------------------------|
| cards    | DeckCheckCard[]   | yes      | —          | Main deck cards                      |
| reserve  | DeckCheckCard[]   | no       | []         | Reserve/sideboard cards              |
| format   | string            | no       | "Type 1"   | Deck format: `"Type 1"` or `"Type 2"` |

### Option C: Validate by raw decklist text

```json
{
  "decklist": "1\tCaptain of the Host\n7\tLost Soul (L)\n\nReserve:\n1\tAngel at the Tomb",
  "decklist_type": "type_1"
}
```

| Field         | Type   | Required | Default    | Description                                          |
|---------------|--------|----------|------------|------------------------------------------------------|
| decklist      | string | yes      | —          | Raw decklist text (`quantity\tname` per line, `Reserve:` separator) |
| decklist_type | string | no       | "type_1"   | `"type_1"` or `"type_2"` (maps to format internally) |

This is useful when the caller only has the raw text (e.g., pasted by the user) and no deck ID or structured card list. The API parses the text server-side.

### DeckCheckCard

| Field    | Type   | Required | Description                     |
|----------|--------|----------|---------------------------------|
| name     | string | yes      | Card name as it appears in the card database |
| set      | string | yes      | Set code or name (e.g., "PoC", "Apostles") |
| quantity | number | yes      | Number of copies                |
| imgFile  | string | no       | Image file identifier           |

## Response

```json
{
  "valid": false,
  "format": "Type 1",
  "issues": [
    {
      "type": "error",
      "rule": "t1-banned-card",
      "message": "\"Daniel\" (Cloud of Witnesses) is banned in Type 1.",
      "cards": ["Daniel"]
    },
    {
      "type": "warning",
      "rule": "card-not-found",
      "message": "\"Some Card\" (SomeSet) was not found in the card database.",
      "cards": ["Some Card"]
    }
  ],
  "stats": {
    "mainDeckSize": 50,
    "reserveSize": 5,
    "totalCards": 55,
    "lostSoulCount": 7,
    "requiredLostSouls": 7,
    "dominantCount": 3,
    "siteCityCount": 2
  }
}
```

### Issue Types

| type    | Meaning                                    |
|---------|--------------------------------------------|
| error   | Deck is illegal — must fix to be tournament-legal |
| warning | Non-blocking — card not found, etc.        |
| info    | Informational                              |

### Rule IDs

| Rule ID                      | Description                                        |
|------------------------------|----------------------------------------------------|
| `t1-deck-size`               | Main deck must be 50–154 cards                     |
| `t1-lost-soul-count`         | Lost Soul count must match chart exactly            |
| `t1-reserve-size`            | Reserve must be 0–10 cards                         |
| `t1-reserve-contents`        | No Dominants or Lost Souls in reserve              |
| `t1-dominant-limit`          | Dominants cannot exceed Lost Soul count             |
| `t1-dominant-unique`         | Max 1 copy of each Dominant                        |
| `t1-mutual-exclusion`        | New Jerusalem/Second Coming and Son of God/Chariot of Fire pairs |
| `t1-quantity-multi-brigade`  | Multi-brigade cards limited to 1 copy              |
| `t1-quantity-ls-ability`     | Lost Souls with special ability limited to 1 copy  |
| `t1-quantity-special-ability` | Cards with special ability: 1 per 50 cards         |
| `t1-quantity-vanilla`        | Vanilla single-brigade Heroes/ECs/Enhancements: max 3 |
| `t1-sites-cities`            | Sites + Cities cannot exceed Lost Soul count        |
| `t1-banned-card`             | Card is on the banned list                         |
| `t1-special-card`            | Card has a custom quantity exception               |
| `card-not-found`             | Card was not found in the database (warning only)  |

#### Type 2 Rule IDs

| Rule ID                          | Description                                              |
|----------------------------------|----------------------------------------------------------|
| `t2-deck-size`                   | Main deck must be 100--252 cards                         |
| `t2-lost-soul-count`            | Lost Soul count must match T2 formula                    |
| `t2-reserve-size`               | Reserve must be 0--15 cards                              |
| `t2-quantity-3plus-brigade`     | 3+ brigade cards limited to 1 copy                       |
| `t2-quantity-2-brigade`         | 2-brigade cards limited to 2 copies                      |
| `t2-quantity-ls-ability`        | Lost Souls with special ability limited to 2 copies      |
| `t2-quantity-sa-site-city`      | SA Sites/Cities with 1 brigade limited to 2 copies       |
| `t2-quantity-artifact-fortress` | Artifacts/Fortresses/Covenants/Curses (1 brigade) limited to 3 |
| `t2-quantity-character-enhancement` | Characters/Enhancements (1 brigade) limited to 4    |
| `t2-quantity-vanilla-site`      | Non-SA Sites/Cities (1 brigade) limited to 4 copies      |
| `t2-good-evil-balance`          | Good and Evil card counts must be equal                   |

T2 decks also use several shared rules from T1: `t1-reserve-contents`, `t1-dominant-limit`, `t1-dominant-unique`, `t1-mutual-exclusion`, `t1-sites-cities`, `t1-banned-card`, and `t1-special-card`.

> **Note on `t2-good-evil-balance`:** This rule checks that Good and Evil card counts are equal in the main deck and reserve independently. All cards count by their alignment. Dual-alignment cards are resolved as follows: Neutral+Good = Good, Neutral+Evil = Evil, Good+Evil = Neutral. Cards with Neutral alignment (including Lost Souls) don't affect the balance. Brigade counts are deduplicated (e.g., "Crimson/Orange/Orange" = 2 unique brigades).

## Error Responses

| Status | Body                                                    | Cause                        |
|--------|---------------------------------------------------------|------------------------------|
| 400    | `{ "error": "Invalid JSON in request body" }`           | Malformed JSON               |
| 400    | `{ "error": "Request must include either 'deckId' or 'cards'" }` | Missing required fields |
| 401    | `{ "error": "Unauthorized — provide a valid Bearer token" }` | Missing/invalid auth token |
| 404    | `{ "error": "Deck not found" }`                         | Invalid deck ID              |
| 500    | `{ "error": "Internal server error during deck check" }` | Unexpected failure          |

## Example: cURL

```bash
curl -X POST https://your-domain.com/api/deckcheck \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-token" \
  -d '{
    "cards": [
      { "name": "Captain of the Host", "set": "PoC", "quantity": 1 },
      { "name": "Lost Soul (L)", "set": "Starter", "quantity": 7 }
    ],
    "reserve": [],
    "format": "Type 1"
  }'
```

## Example: JavaScript/TypeScript

```typescript
const response = await fetch("https://your-domain.com/api/deckcheck", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${process.env.DECKCHECK_API_TOKEN}`,
  },
  body: JSON.stringify({
    cards: [
      { name: "Captain of the Host", set: "PoC", quantity: 1 },
      { name: "Lost Soul (L)", set: "Starter", quantity: 7 },
    ],
    reserve: [],
    format: "Type 1",
  }),
});

const result = await response.json();

if (result.valid) {
  console.log("Deck is tournament-legal!");
} else {
  console.log("Issues found:");
  result.issues
    .filter((i: { type: string }) => i.type === "error")
    .forEach((i: { message: string }) => console.log(`  - ${i.message}`));
}
```

## Setup for Cross-Project Access

1. Generate a secret token (e.g., `openssl rand -hex 32`)
2. Add `DECKCHECK_API_TOKEN=<token>` to the tournament tracker's Vercel environment variables
3. Add the same token to the consuming project's environment
4. Use Bearer auth in all requests from the consuming project

## Downstream API Integration

The tournament tracker sends legality results directly to the downstream PDF/image generation API. The downstream API does **not** need to call the deckcheck endpoint itself.

### What the downstream API receives

Both `POST /v1/generate-decklist` and `POST /v1/generate-decklist-image` now receive an optional `is_legal` field in the request body:

```json
{
  "decklist": "1\tCaptain of the Host\n7\tLost Soul (L)\n...",
  "decklist_type": "type_1",
  "name": "Player Name",
  "event": "Nationals 2026",
  "is_legal": true,
  "deck_id": "uuid-or-omitted"
}
```

| Field         | Type            | Always present | Description |
|---------------|-----------------|----------------|-------------|
| `decklist`    | string          | Yes            | Raw decklist text |
| `decklist_type` | string        | Yes            | `"type_1"`, `"type_2"`, or `"paragon"` |
| `is_legal`    | boolean or null | No             | `true` = tournament legal, `false` = illegal, omitted = unknown |
| `deck_id`     | string          | No             | UUID of saved deck (omitted for unsaved/pasted decks) |

### How `is_legal` is determined

- **From the deckbuilder** (GeneratePDFModal / GenerateDeckImageModal): The deckcheck result is already available on the client. `is_legal` is passed directly — no API call needed.
- **From the standalone generate page** (`/decklist/generate`): Before calling the downstream API, the page calls `POST /api/deckcheck` with either the `deckId` (if a saved deck was loaded) or the raw `decklist` text (Option C). The result's `valid` field is sent as `is_legal`.
- **If deckcheck fails or is unavailable**: `is_legal` is omitted from the payload.

### What the downstream API should do

```python
is_legal = request_data.get("is_legal")  # True, False, or None

if is_legal is True:
    render_legality_badge("Legal", color="green")
elif is_legal is False:
    render_legality_badge("Not Legal", color="red")
else:
    # No legality data — skip the badge
    pass
```

The downstream API does not need to call the deckcheck endpoint. It simply reads the `is_legal` boolean from the request.

### Deckcheck API (for direct use)

If the downstream API needs to perform its own validation (e.g., for a different workflow), it can still call the deckcheck endpoint directly:

```python
import requests

DECKCHECK_BASE_URL = "https://redemptionccg.app"
DECKCHECK_API_TOKEN = "<your-token>"

def check_deck_legality(deck_id: str) -> dict:
    response = requests.post(
        f"{DECKCHECK_BASE_URL}/api/deckcheck",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {DECKCHECK_API_TOKEN}",
        },
        json={"deckId": deck_id},
    )
    response.raise_for_status()
    return response.json()
```

### Allowed origins

CORS is configured for the following origins:

- `localhost:3000`
- `localhost:5000`
- `redemption-tournament-tracker.vercel.app`
- `redemptionccg.app`

Server-to-server calls (e.g., from the Python API) are not subject to CORS and only need a valid Bearer token.

## Rules Reference

Based on [Deck Building Rules v1.3](https://landofredemption.com/wp-content/uploads/2026/03/Deck_Building_Rules_1.3.pdf) published 3/13/2026 by Cactus Game Design.
