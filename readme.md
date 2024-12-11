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

## Overview

This project aims to develop a sophisticated and visually appealing web application for managing and tracking tournament brackets. The frontend of the application will be built using the Next.js framework, providing a sleek, user-friendly interface with a comprehensive dashboard that allows users to create and join tournaments effortlessly. For more complex backend tasks, a Flask API will be utilized, with data stored in a PostgreSQL database hosted by Supabase. Key features include:

- **Authentication System**: Secure login and registration managed by Supabase, ensuring user data protection and privacy.
- **Tournament Management**: A dedicated section for hosts to oversee multiple tournaments, access participant details, and monitor progress seamlessly.
- **Dynamic Brackets**: Interactive tournament brackets that automatically update as matches are played, providing real-time insights.
- **Join Tournaments**: A unique code-based system enabling users to join specific tournaments easily, using a random sequence of 4-5 characters.
- **Engaging Design**: A thoughtfully chosen color scheme and typography to enhance clarity and user engagement throughout the app.

## Features

- **Match Display**: Clear and organized presentation of match pairings, tournament rounds, and the final winner.
- **User Experience**: Consistent design elements to intuitively guide users through the app.
- **Editable Match Results**: Allow tournament hosts to correct match results in case of reporting errors.

## Match Result Tracking

Each match result will record the following details:

1. **Player Points**: The number of points earned by each player.
2. **Opponent Points**: The number of points earned by the opponent.
3. **Point Differential**: The difference between the player's and opponent's points, known as the differential.

## Proposed SQL Database Schema

```sql
create table users (
  id bigint primary key generated always as identity,
  username text not null,
  email text unique not null,
  password_hash text not null,
  created_at timestamp with time zone default now()
);

create table tournaments (
  id bigint primary key generated always as identity,
  name text not null,
  host_id bigint references users (id) on delete cascade,
  code text unique not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table participants (
  id bigint primary key generated always as identity,
  tournament_id bigint references tournaments (id) on delete cascade,
  user_id bigint references users (id) on delete cascade,
  joined_at timestamp with time zone default now(),
  place int
);

create table matches (
  id bigint primary key generated always as identity,
  tournament_id bigint references tournaments (id) on delete cascade,
  round int not null,
  player1_id bigint references participants (id) on delete cascade,
  player2_id bigint references participants (id) on delete cascade,
  player1_score int not null default 0,
  player2_score int not null default 0,
  differential int generated always as (player1_points - player2_points) stored,
  winner_id bigint references participants (id) on delete cascade,
  updated_at timestamp with time zone default now(),
  is_tie boolean default false
);

# Row-level security policies to be implemented
```
