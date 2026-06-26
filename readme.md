# Tournament Bracket Web App

## Getting Started

To run this project locally, follow these steps:

### Prerequisites

Ensure you have the following installed on your machine:

- Node.js (latest version recommended)
- npm (comes with Node.js)
- Python (for the Flask API)

### Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/timothestes/redemption-tournament-tracker
   cd redemption-tournament-tracker
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

### Running the Development Server

To start the Next.js development server, run:

```bash
npm run dev
```

This will start the server at `http://localhost:3000`.

### Building for Production

To build the project for production, use:

```bash
npm run build
```

### Starting the Production Server

After building, you can start the production server with:

```bash
npm run start
```

## Paragon Format

This project includes support for the Paragon format with 42 playable Paragons.

### Updating Paragon Data

Paragon data is synced from a Google Sheets source. To download the latest data:

```bash
make update-paragons
```

Or use the shorter alias:

```bash
make paragons
```

This command will:
1. Download the latest CSV data from Google Sheets
2. Parse and validate the data
3. Generate type-safe TypeScript definitions
4. Output a list of all 42 Paragons

### Paragon Images

Place Paragon card images in `public/paragons/` directory. See `public/paragons/README.md` for details on naming conventions and image specifications.

I'd like you to implement a new feature: the print match slips button.

It should go next to the "print round pairings" button.

Do you know what the concept of a match slip is?

Each player's name is clearly visible

It has a place to write each player's score

Then it has a place for each player to write their signature.

Do you think anything else should be included on a givne match slip

We will want to let the host print it out easily


## Implemented features:
Tournament Tracker
Deck building (with Paragon Support)
Spotlight Mode
YTG Add to Cart
Min Price
Cube Improvements
Jayden Mode
Official Deck Checks
Goldfish Feature
Spoiler Page
Official Upcoming Tournaments
Tournament Deck Publishing
Card-specific rulings
Card groupings
AoD calculations


## short term
Fallow audit: https://github.com/fallow-rs/fallow
Pre-bake duplicate card groups at build time (static JSON) instead of fetching from Supabase at runtime — eliminates cold-start connection pressure on deckcheck

## long term
add deck versioning
add wishlist
misc tournament tracker improvements
- Joining a tournament via QR code
- Linking your deck
metagame snapshot
Teaching new players how to play
add animations to goldfish/play mode
Cube builder
Deck upvoting
Offline intallable app on phone (Progressive Web app with offline capabilities)


# play features
save game, load game, invite to game?
battle phase/zone could be better




## Forge improvements

Improve delete dialog box
Deleting a card leads to 404 page
Brigade boxes off color
Clicking on card should let user edit that place easily
Cactus copyright and artist not visible
artist not editable
Lost soul
No identifier pill
Have prebuilt template starters for each card type. Start with card type THEN prompt for ability instead of having ability be its own
GE doesn't add icon box
Hero/GE should have special handling to make hero icon on the left and enhancement icon on the right
Curse/Covenant will need this handling
Artifact not showing icon
WTF is mark as placeholder...
When creating a set, have default targets (ask for number of cards, have them approve initial card type targets)
The target UI is crap
Deckbuilding UI is crap
UI to navigate forge is nonexistent
deckbuilding UI is diff than deckbuilding UI everyone is used to
some dropdowns don't have darkmode in mind at http://localhost:3000/forge/play/decks/new
artwork loading for playtest cards is ROUGH.
card has "playtesting" status but not able to be playtested. So dumb.
