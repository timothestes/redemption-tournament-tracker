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