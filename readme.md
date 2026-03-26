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

## short term

## long term
add maybeboard
add animations to goldfish mode
Collection Tracker
add wishlist
Teaching new players how to play
Comprehensive Deck Legality Validation (Type 1 complete with 14 rules and 206 tests; Type 2 in progress)
misc tournament tracker improvements
Joining a tournament via QR code
metagame snapshot
tournament tracker mobile ux support
Deck upvoting
Offline intallable app on phone (Progressive Web app with offline capabilities)

## Bugs:
Right click on discard pile card menu hidden below preview loupe. Please fix this

Can't drag opponents territory cards around. We should be able to do this I think.

Opponent's reserve preview is thinner than the normal reserve modal. They should look the same.
Opponent's reserve doesn't have a request flow. Its hidden information, so it should Zone Search Request.

Opponents can hover face down cards in play and see what they are. Opponents shouldn't be able to see what face down cards are.

Reserve sorting isn't a thing yet. Check out how goldfish mode sorts the reserve (I think its by type). We want the reserve to be sorted each time we open it.

Lost soul type filtering isn't working in search deck modal. Seems like only name filtering is working in deck search modal. Compare with goldfish mode and make sure it has the same functionality.

Visual issues with territory names and counts. For example, LAND OF BONDAGE text collides into the box containing the number of souls in land of bondage. These issues also apply to the territory lables.

Visual issues with deck/reserve card placeholders compared the relative size of the zone. See how tiny the deck icon is compared to the size of the deck zone? Perhaps we could resize the side zones to accomodate single piles and have people click on the zones if they want to inspect the contents. Could free up more territory space

Can't drag the top card of my or my opponents discard pile into play

On some dimensions, the bottom menu covers up the hand. I don't know if this is a big probem that we need to try and solve for though.

When rolling die, if having a long user name, the die roll that's rendered on the right hand side gets cutoff