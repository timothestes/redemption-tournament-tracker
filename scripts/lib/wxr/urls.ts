const SITE = "https?:\\/\\/(?:www\\.)?landofredemption\\.com";
const FILE_RE = new RegExp(`^${SITE}(\\/(?:wp-content\\/uploads|podcasts)\\/[^?#]+)`, "i");
const POST_RE = new RegExp(`^${SITE}\\/([a-z0-9-]+)\\/?(#.*)?$`, "i");
export const SPONSORS_PAGE_ID_RE = new RegExp(`^${SITE}\\/\\?page_id=11455$`, "i");
const SPONSORS_URL = "https://landofredemption.com/our-sponsors/";
const ATTR_RE = /\b(src|href)=("|')([^"']*)\2/g;

export function siteFilePath(url: string): string | null {
  const m = url.trim().match(FILE_RE);
  if (!m) return null;
  return m[1].replace(/(?:\s|%20)+$/i, "");
}
export const blobPathname = (sitePath: string) => `wp${decodeURIComponent(sitePath)}`;
export const mirrorUrl = (base: string, pathname: string) =>
  `${base.replace(/\/$/, "")}/${pathname.split("/").map(encodeURIComponent).join("/")}`;

export function collectSiteFiles(html: string, featured: string | null): string[] {
  const out: string[] = [];
  const add = (u: string | null) => { const p = u && siteFilePath(u); if (p && !out.includes(p)) out.push(p); };
  for (const m of html.matchAll(ATTR_RE)) add(m[3]);
  add(featured);
  return out;
}

export interface RewriteOptions { mirror: (sitePath: string) => string | null; slugMap: Map<string, string> }

export function rewriteUrls(html: string, { mirror, slugMap }: RewriteOptions): string {
  return html.replace(ATTR_RE, (whole, name: string, q: string, value: string) => {
    const file = siteFilePath(value);
    if (file) { const u = mirror(file); return u ? `${name}=${q}${u}${q}` : whole; }
    if (SPONSORS_PAGE_ID_RE.test(value.trim())) return `${name}=${q}${SPONSORS_URL}${q}`;
    const post = value.trim().match(POST_RE);
    if (post && slugMap.has(post[1])) return `${name}=${q}/articles/${slugMap.get(post[1])}${post[2] ?? ""}${q}`;
    return whole;
  });
}
