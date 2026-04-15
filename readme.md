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
site in souls don't really work right now
add equip feature?
battle phase/zone could be better


Subagent Tasks for Multiplayer mode:
- reveal reserve function seems buggy. Not able to close it. Also feels awkward right click happens to open reserve and also the right click menu at the same time. Maybe right click doesn't need to reveal the reserve and instead just show the menu?
- in the logs , we are seeing a lot of "draw multiple cards". This needs to be say how many cards exactly were drawn. And would it be possible to show in the logs to the player that drew the cards what the cards were but hide this information from the opponent? Seems hard to do but would be amazinng. Also would want to indicate somehow that the opponent can't see the thing you are seeing in the logs for this scenario.
- this mode needs undo button, just like golfish mode. Entire subagent development needed to spec this out and implement it.
- we have reveal top N cards, but we don't have look at top card feature. The look feature would kinda be like the reveal feature, but instead wouldn't reveal the information to ALL players. Got it?
- When I open up the reveal feature. Trying to drag cards out of it normally is buggy. Can you have it behave more like a normal modal?
- annoying but where dragging group of cards around sometimes doesn't preserve card order. some recent bug fix attempts were made but the problem wasn't solved completely. This is high priority fix
- logs should show what counters are getting added to. It shows counter was added but it doesn't say to what
- when drawing souls, sometimes it not super obvious you drew a soul because it gets automatically placed in land of bondage. We need to add something to goldifh and multiplayer mode that would help draw attention to the fact a soul was drawn and placed in land of bondage. Maybe any time a card is moved to land of bondage, it could have an animated effect happen? Idk.
- user dragged a lost soul card from their land of bondage to their deck. it said: jhendrix6426 moved a card to top of their deck. Should be shown what went into the deck, instead of just "a card"
- For users who want to see chat + logs all in one place, what can we do to make it less annoying for them? Add a "combine" option to see them both together?
- shuffling multiple cards into deck does one at a time. For example I selected 6 cards from my hand as a group and right clicked shuffle into deck. It proceeded to shuffle one at a time, but we could optimize here
- the allow search deck prompt toast is  a bit high up... can we try to have it more in the center like where the territory break is?
- can't discard random cards from a reserve. We need to be able to randomly discard cards from a reserve via a right click menu.
- adding counters to opponent's cards isn't working 100% correctly. When right click opp's card and adding/removing a counter, the UI isn't updating right away.
- revealing opponent's deck doesn't give you the options that are normally available to deck search options. I want al lthe same options to appear as if searching my own deck. Can we just have the oppponent's deck search popup be more like the existing search my deck popup? Why are they different?
- deck and reserve modals could be draggable? For example, if the user opens up the reserve modal, they should be able to drag it around on the screen using a typicall windows bar feature that people are familiar with
- add timer at the top, next to the scores. Start the timer once the game begins. If someone is searching a deck zone, pause the time. Reset the time for play agains. Add an option in the gear icon menu at the bottom left to hide the timer. Timer should also reset if a player has reloaded their deck
- add leave open feature for discard pile and reserve modal pop ups. Just like the deck pop up feature,
- load deck feature doesn't show up for gear icon when someone has conceded I believe. It should be available at all times.