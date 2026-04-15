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

# Backlog

# Podcast

## Implemented features:
Spotlight Mode
YTG Add to Cart
Min Price
Cube Improvements
Jayden Mode
Official Deck Checks
Spoiler
Upcoming Tournaments
Tournament Deck Publishing
Card-specific rulings
Card groupings
AoD calculations

## How can you help?
- spoilers
- ruling questions
- publishing decks
- reporting bugs
- suggesting features

## Bugs
Ending tournament early bug
CA State T1 bug
jayden mode tournament
redemptionccg app logo (Top nav) takes a while to load in 
bright green in dark mode needs dimming

## short term
add aod button

## long term
Pre-bake duplicate card groups at build time (static JSON) instead of fetching from Supabase at runtime — eliminates cold-start connection pressure on deckcheck
add maybeboard
add animations to goldfish/play mode
Collection Tracker
Cube builder
add wishlist
Teaching new players how to play
misc tournament tracker improvements
Joining a tournament via QR code
metagame snapshot
tournament tracker mobile ux support
Deck upvoting
Offline intallable app on phone (Progressive Web app with offline capabilities)
Fallow audit: https://github.com/fallow-rs/fallow


# play features
probably improve right click top/bottom/random menu?
start of game takes a bit to load
create system where cards can have custom abilities coded
add ability to use meek tokens
save game, load game, invite to game?
add paragon to online play?
add text notes?


Ghost cards... from exchange option
I don't have reveal reserve option




"draw multiple cards" needs to be say "how many exactly
needs undo button
look at top card feature
taking cards from reveal feature is buggy
site in souls don't really work right now
add equip feature?
battle phase/zone could be better
dragging group of cards doens't preserve card order (again)
logs should show what counters are getting added to
when drawing souls, sometimes it not super obvious you drew a soul
hunter soul: jhendrix6426 moved a card to top of their deck. Should be shown what went into the deck
Wonder if there is a chat + log view? idk
shuffling multiple cards into deck does one at a time
allow search deck a bit high up...
can't discard random cards from a reserve
adding counters to opponent's cards isn't working
revealing opponent's deck doesn't give you the options that are normally available to deck search options