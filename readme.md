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

## short term
add aod button

## long term
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
probably improve right click top/bottom/random menu
card placement mismatches? hard to replicate
start of game takes a bit to load
add feature for t1 reserve access
redemptionccg app logo takes a while to load in 
create system where cards can have custom abilities coded
