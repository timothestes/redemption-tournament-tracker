-- Tournament listings scraped from Cactus Game Design website
CREATE TABLE tournament_listings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Parsed fields
  title TEXT NOT NULL,
  tournament_type TEXT,
  start_date DATE NOT NULL,
  end_date DATE,
  start_time TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  venue_name TEXT,
  venue_address TEXT,
  host_name TEXT,
  host_email TEXT,
  formats JSONB DEFAULT '[]'::jsonb,
  door_fee TEXT,
  description TEXT,

  -- Pipeline metadata
  raw_text TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  parsed_at TIMESTAMPTZ DEFAULT now(),
  confidence FLOAT DEFAULT 1.0,
  needs_review BOOLEAN DEFAULT false,

  -- Integration
  linked_tournament_id UUID REFERENCES tournaments(id) ON DELETE SET NULL,

  -- Status
  status TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'past', 'cancelled', 'removed')),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Dedup: one listing per city+state+date+type combo
  -- (same city can host multiple tournament types on the same date)
  UNIQUE (city, state, start_date, tournament_type)
);

-- Index for calendar queries
CREATE INDEX idx_tournament_listings_start_date ON tournament_listings (start_date);
CREATE INDEX idx_tournament_listings_status ON tournament_listings (status);

-- Public read access, no auth required for viewing upcoming events
ALTER TABLE tournament_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view upcoming listings"
  ON tournament_listings FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage listings"
  ON tournament_listings FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
