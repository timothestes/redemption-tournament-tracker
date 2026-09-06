import { postByline, postExcerpt, type PublicPost } from "./queries";

// Same fallback as utils/email.ts: prod sets NEXT_PUBLIC_SITE_URL.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://redemptionccg.app").replace(/\/$/, "");

const ESC: Record<string, string> = { "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" };

export function escapeXml(s: string): string {
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").replace(/[<>&'"]/g, (c) => ESC[c]);
}

/** RSS 2.0 document for the given published posts, newest first as given. */
export function buildRss(posts: PublicPost[], site: string): string {
  const items = posts
    .map((p) => {
      const url = `${site}/articles/${p.slug}`;
      const lines = [
        "  <item>",
        `    <title>${escapeXml(p.title)}</title>`,
        `    <link>${escapeXml(url)}</link>`,
        `    <guid isPermaLink="true">${escapeXml(url)}</guid>`,
      ];
      if (p.published_at) lines.push(`    <pubDate>${new Date(p.published_at).toUTCString()}</pubDate>`);
      lines.push(
        `    <dc:creator>${escapeXml(postByline(p))}</dc:creator>`,
        `    <description>${escapeXml(postExcerpt(p))}</description>`,
        "  </item>",
      );
      return lines.join("\n");
    })
    .join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">',
    "<channel>",
    "  <title>RedemptionCCG App Articles</title>",
    `  <link>${escapeXml(site)}/articles</link>`,
    `  <atom:link href="${escapeXml(site)}/articles/feed.xml" rel="self" type="application/rss+xml" />`,
    "  <description>Strategy, deck techs, tournament reports and news for Redemption CCG.</description>",
    "  <language>en-us</language>",
    items,
    "</channel>",
    "</rss>",
    "",
  ].join("\n");
}
