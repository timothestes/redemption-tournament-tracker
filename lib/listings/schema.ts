/** Schema for parsed tournament listings from LLM output */

export interface TournamentFormat {
  format: string;
  entry_fee: string | null;
}

export interface ParsedListing {
  title: string;
  tournament_type: string | null;
  start_date: string; // YYYY-MM-DD
  end_date: string | null; // YYYY-MM-DD
  start_time: string | null;
  city: string;
  state: string;
  venue_name: string | null;
  venue_address: string | null;
  host_name: string | null;
  host_email: string | null;
  formats: TournamentFormat[];
  door_fee: string | null;
  description: string | null;
  confidence: number; // 0-1
}

export interface ParseResult {
  listings: ParsedListing[];
  raw_text: string;
}

/**
 * Validate a parsed listing has the minimum required fields.
 * Returns an array of error messages (empty = valid).
 */
export function validateListing(listing: ParsedListing): string[] {
  const errors: string[] = [];

  if (!listing.title?.trim()) errors.push('missing title');
  if (!listing.city?.trim()) errors.push('missing city');
  if (!listing.state?.trim()) errors.push('missing state');
  if (!listing.start_date?.match(/^\d{4}-\d{2}-\d{2}$/)) {
    errors.push(`invalid start_date: ${listing.start_date}`);
  }
  if (listing.end_date && !listing.end_date.match(/^\d{4}-\d{2}-\d{2}$/)) {
    errors.push(`invalid end_date: ${listing.end_date}`);
  }
  if (typeof listing.confidence !== 'number' || listing.confidence < 0 || listing.confidence > 1) {
    errors.push(`invalid confidence: ${listing.confidence}`);
  }

  return errors;
}
