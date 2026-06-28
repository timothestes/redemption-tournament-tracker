-- Saturday lunch is a Chick-fil-A sandwich with a pickle choice. The yes/no
-- captured by lunch_saturday isn't enough to place the order, so track whether
-- the registrant wants their sandwich without pickles. Only meaningful when
-- lunch_saturday = true; false means the default (with pickles).

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS lunch_saturday_no_pickles BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN registrations.lunch_saturday_no_pickles IS 'Saturday Chick-fil-A sandwich without pickles (only meaningful when lunch_saturday is true)';
