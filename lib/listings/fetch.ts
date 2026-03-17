const CACTUS_URL = 'https://www.cactusgamedesign.com/redemption/tournaments/';

/**
 * Fetch the Cactus Game Design tournaments page and extract text content.
 * Strips HTML tags and normalizes whitespace for LLM consumption.
 */
export async function fetchTournamentPageText(): Promise<string> {
  const response = await fetch(CACTUS_URL, {
    headers: {
      'User-Agent': 'RedemptionTournamentTracker/1.0 (tournament-calendar-sync)',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Cactus page: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();

  // The page uses Beaver Builder with entry-content wrapping everything.
  // Rather than trying to isolate a specific div (fragile with nested layouts),
  // we use the OG description + the full body, stripping nav/header/footer noise.
  // The LLM is resilient to surrounding noise — we just need the tournament text in there.

  // Try to get content between the site-content wrapper and footer
  const bodyMatch = html.match(/<div[^>]*class="[^"]*site-content[^"]*"[^>]*>([\s\S]*)/i);
  let contentHtml = bodyMatch ? bodyMatch[1] : html;

  // Cut off at footer if present
  const footerIdx = contentHtml.search(/<footer/i);
  if (footerIdx > 0) {
    contentHtml = contentHtml.slice(0, footerIdx);
  }

  // Strip HTML to plain text
  const text = contentHtml
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&#?\w+;/g, '') // remaining entities
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (text.length < 100) {
    throw new Error('Fetched page content is suspiciously short — site may have changed structure');
  }

  return text;
}
