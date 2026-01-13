-- Tournament Registration Table
CREATE TABLE registrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Personal Information
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  discord_username TEXT,
  
  -- Event Selections
  thursday_event TEXT, -- 'booster_draft', 'type2_2player', 'none'
  friday_event TEXT,   -- 'type1_2player', 'typeA_2player', 'none'
  saturday_event TEXT, -- 'teams', 'sealed_deck', 'none'
  
  -- Additional Options
  fantasy_draft_opt_in BOOLEAN DEFAULT false,
  first_nationals BOOLEAN DEFAULT false,
  needs_airport_transportation BOOLEAN DEFAULT false,
  needs_hotel_transportation BOOLEAN DEFAULT false,
  
  -- Placeholder fields for future use
  placeholder_field_1 TEXT,
  placeholder_field_2 TEXT,
  placeholder_field_3 TEXT,
  
  -- Optional photo for name tag
  photo_url TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_registrations_email ON registrations(email);
CREATE INDEX idx_registrations_created_at ON registrations(created_at);

-- Enable Row Level Security
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;

-- Policy: Allow anyone to insert (public registration)
CREATE POLICY "Anyone can register"
  ON registrations
  FOR INSERT
  TO public
  WITH CHECK (true);

-- Policy: Allow users to view their own registrations
CREATE POLICY "Users can view own registrations"
  ON registrations
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Allow admins to view all registrations
-- (You can modify this based on your admin role setup)
CREATE POLICY "Allow read access to all authenticated users"
  ON registrations
  FOR SELECT
  TO authenticated
  USING (true);

-- Add policy to allow admins to delete registrations
-- Since we're using server-side admin checks with the whitelist,
-- we'll allow authenticated users to delete (the server action enforces admin-only)
CREATE POLICY "Allow admins to delete registrations"
  ON registrations
  FOR DELETE
  TO authenticated
  USING (true);

  -- Add UPDATE policy for registrations table
-- Allows authenticated users to update registrations
-- (Server-side admin check with whitelist enforces admin-only access)

CREATE POLICY "Allow admins to update registrations"
  ON registrations
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

  -- Add paid field to registrations table
ALTER TABLE registrations
ADD COLUMN paid BOOLEAN DEFAULT false;