import { readFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";
import he from "he";

export interface WxrAuthor { login: string; email: string; displayName: string }
export interface WxrPost {
  wpId: string; title: string; link: string; slug: string; creator: string;
  content: string; excerpt: string; dateGmt: string; date: string; modifiedGmt: string;
  categories: string[]; thumbnailId: string | null;
}
export interface WxrExport {
  authors: WxrAuthor[]; posts: WxrPost[];
  attachments: Map<string, string>; blocks: Map<string, string>;
}

type Node = Record<string, unknown>;
// fast-xml-parser gives a string for text-only elements and { "#text", "@_attr" } when attributes exist.
const text = (v: unknown): string =>
  v == null ? "" : typeof v === "object" ? text((v as Node)["#text"]) : String(v);
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : v == null ? [] : [v as T]);
const clean = (s: string) => he.decode(s).replace(/\s+/g, " ").trim();

export function parseWxr(xml: string): WxrExport {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false, // keep "2016" a string
    trimValues: false,    // content whitespace is meaningful for classic posts
    isArray: (name) => ["item", "category", "wp:postmeta", "wp:author"].includes(name),
  });
  const doc = parser.parse(xml) as Node;
  const channel = (doc.rss as Node | undefined)?.channel;
  if (!channel || typeof channel !== "object") throw new Error("Not a WXR document: rss/channel missing");
  const ch = channel as Node;

  const authors: WxrAuthor[] = list<Node>(ch["wp:author"]).map((a) => ({
    login: text(a["wp:author_login"]).trim(),
    email: text(a["wp:author_email"]).trim().toLowerCase(),
    displayName: clean(text(a["wp:author_display_name"])),
  }));

  const posts: WxrPost[] = [];
  const attachments = new Map<string, string>();
  const blocks = new Map<string, string>();
  for (const it of list<Node>(ch.item)) {
    const type = text(it["wp:post_type"]).trim();
    const status = text(it["wp:status"]).trim();
    const wpId = text(it["wp:post_id"]).trim();
    if (type === "attachment") {
      const url = text(it["wp:attachment_url"]).trim();
      if (url) attachments.set(wpId, url);
      continue;
    }
    if (type === "wp_block") { blocks.set(wpId, text(it["content:encoded"])); continue; }
    if (type !== "post" || status !== "publish") continue;

    let thumbnailId: string | null = null;
    for (const m of list<Node>(it["wp:postmeta"])) {
      if (text(m["wp:meta_key"]).trim() === "_thumbnail_id") thumbnailId = text(m["wp:meta_value"]).trim() || null;
    }
    const categories = list<Node>(it.category)
      .filter((c) => c["@_domain"] === "category")
      .map((c) => clean(text(c)))
      .filter(Boolean);
    posts.push({
      wpId,
      title: clean(text(it.title)),
      link: text(it.link).trim(),
      slug: text(it["wp:post_name"]).trim(),
      creator: text(it["dc:creator"]).trim(),
      content: text(it["content:encoded"]),
      excerpt: text(it["excerpt:encoded"]),
      dateGmt: text(it["wp:post_date_gmt"]).trim(),
      date: text(it["wp:post_date"]).trim(),
      modifiedGmt: text(it["wp:post_modified_gmt"]).trim(),
      categories,
      thumbnailId,
    });
  }
  return { authors, posts, attachments, blocks };
}

export function readWxr(path: string): WxrExport {
  return parseWxr(readFileSync(path, "utf8"));
}
