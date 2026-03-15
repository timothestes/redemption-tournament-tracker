-- Add iron_man_interest column to registrations table
ALTER TABLE registrations
ADD COLUMN iron_man_interest BOOLEAN NOT NULL DEFAULT false;

-- Set all existing registrations to false (already handled by DEFAULT)
UPDATE registrations SET iron_man_interest = false WHERE iron_man_interest IS NULL;
