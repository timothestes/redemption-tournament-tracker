-- Add overnight stay columns to registrations table
-- This allows tracking if participants plan to stay overnight at the venue

-- Add boolean column for whether they plan to stay overnight
ALTER TABLE registrations
ADD COLUMN IF NOT EXISTS staying_overnight BOOLEAN DEFAULT false;

-- Add array column for which nights they plan to stay
-- Values can be: 'wednesday', 'thursday', 'friday', 'saturday'
ALTER TABLE registrations
ADD COLUMN IF NOT EXISTS overnight_stay_nights TEXT[] DEFAULT '{}';

-- Add index for filtering by overnight stay
CREATE INDEX IF NOT EXISTS idx_registrations_staying_overnight ON registrations(staying_overnight);

-- Add comment for documentation
COMMENT ON COLUMN registrations.staying_overnight IS 'Whether the participant plans to stay overnight at the venue';
COMMENT ON COLUMN registrations.overnight_stay_nights IS 'Array of nights they plan to stay: wednesday, thursday, friday, saturday';
