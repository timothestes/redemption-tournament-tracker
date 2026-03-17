import Anthropic from '@anthropic-ai/sdk';
import { ParsedListing } from './schema';

const SYSTEM_PROMPT = `You are a structured data extraction system. You parse tournament listings from the Redemption card game website into JSON.

IMPORTANT RULES:
- Extract EVERY tournament listing on the page
- Dates MUST be in YYYY-MM-DD format
- State should be the 2-letter US state code (e.g., "CA", "TX")
- For multi-day events, set both start_date and end_date
- Confidence is 0-1: use 1.0 for clearly parsed listings, lower for ambiguous ones
- For formats, extract each game format and its entry fee separately
- title should be "{City}, {State} {Tournament Type}" (e.g., "Arcadia, CA Local (Open)")
- If a field is not present, use null
- Return ONLY valid JSON, no markdown fences or explanation

OUTPUT SCHEMA (JSON array):
[
  {
    "title": "string",
    "tournament_type": "string | null (e.g., 'Local (Open)', 'District', 'State')",
    "start_date": "YYYY-MM-DD",
    "end_date": "YYYY-MM-DD | null",
    "start_time": "string | null (e.g., '10:00 AM')",
    "city": "string",
    "state": "string (2-letter code)",
    "venue_name": "string | null",
    "venue_address": "string | null",
    "host_name": "string | null",
    "host_email": "string | null",
    "formats": [{"format": "string", "entry_fee": "string | null"}],
    "door_fee": "string | null",
    "description": "string | null (any extra info like special rules or notes)",
    "confidence": 0.0-1.0
  }
]`;

let client: Anthropic | null = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

/**
 * Parse raw page text into structured tournament listings using Claude Haiku.
 * Uses temperature 0 for deterministic extraction.
 */
export async function parseListingsWithLLM(pageText: string): Promise<ParsedListing[]> {
  const response = await getClient().messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8192,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Parse all tournament listings from this page content into the JSON schema specified. Today's date is ${new Date().toISOString().split('T')[0]}.\n\n---\n\n${pageText}`,
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  // Strip markdown fences if present (defensive)
  const cleaned = text.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error('[sync-listings] Failed to parse LLM JSON output:', text.slice(0, 500));
    throw new Error(`LLM returned invalid JSON: ${(e as Error).message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('LLM output is not an array');
  }

  return parsed as ParsedListing[];
}
