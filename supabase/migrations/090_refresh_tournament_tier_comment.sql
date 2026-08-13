-- Comment-only. 085 enumerated the six levels that existed when the column was
-- added; the 2026 Host Guide (v26.0.0) collapsed Local (Open), Local (Closed)
-- and District into Seasonal, leaving four. The column stays free text — old
-- rows keep the level they were sanctioned under, and normalizeTier still
-- resolves the retired names for listings that predate the change.

comment on column public.tournaments.tier is
  'Sanctioning tier: Seasonal | State | Regional | National. Rows created before the 2026 Host Guide may hold the retired Local (Open) | Local (Closed) | District. Null = unspecified. Canonical list in utils/tournament/tiers.ts.';
