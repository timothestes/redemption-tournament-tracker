-- Add lunch tracking to registrations (admin-entered from the separate lunch form).
-- Each eaten day adds to the client-computed Total Owed: Thu $8, Fri $8, Sat $11.
-- lunch_form_filled is informational only and is independent of whether the
-- person eats any day (some fill out the form but eat at the venue no day).

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS lunch_thursday    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lunch_friday      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lunch_saturday    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lunch_form_filled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN registrations.lunch_thursday    IS 'Eating lunch at venue Thursday (+$8)';
COMMENT ON COLUMN registrations.lunch_friday      IS 'Eating lunch at venue Friday (+$8)';
COMMENT ON COLUMN registrations.lunch_saturday    IS 'Eating lunch at venue Saturday (+$11)';
COMMENT ON COLUMN registrations.lunch_form_filled IS 'Person submitted the lunch form (informational; independent of eating any day)';
