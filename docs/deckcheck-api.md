# Deck Check API

Validates a Redemption CCG deck against official Type 1 deck building rules (v1.3).

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
| format   | string            | no       | "Type 1"   | Deck format (only "Type 1" supported currently) |

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

## Rules Reference

Based on [Deck Building Rules v1.3](https://landofredemption.com/wp-content/uploads/2026/03/Deck_Building_Rules_1.3.pdf) published 3/13/2026 by Cactus Game Design.
