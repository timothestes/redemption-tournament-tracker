import { wpautop } from "./wpautop";

export interface PreprocessResult { html: string; classic: boolean; dropped: Record<string, number>; unknownRefs: string[] }

const DROP_BLOCKS = ["spacer", "wpdevart-countdown/countdown", "rss"];
const esc = (s: string) => s.replace(/[/\-.]/g, "\\$&");

export function preprocess(raw: string, blocks: Map<string, string>): PreprocessResult {
  const classic = !/<!-- wp:/.test(raw);
  const dropped: Record<string, number> = {};
  const unknownRefs: string[] = [];
  const bump = (k: string) => { dropped[k] = (dropped[k] ?? 0) + 1; };

  // 1) reusable blocks
  const inline = (s: string, depth: number): string =>
    s.replace(/<!-- wp:block \{"ref":(\d+)\} \/-->/g, (_m, ref: string) => {
      const body = blocks.get(ref);
      if (body == null) { unknownRefs.push(ref); return ""; }
      return depth < 5 ? inline(body, depth + 1) : "";
    });
  let html = inline(raw, 0);

  // 2) grimlock sections
  html = html.replace(/<!-- wp:grimlock\/section (\{[\s\S]*?\}) \/-->/g, (_m, json: string) => {
    let a: Record<string, unknown> = {};
    try { a = JSON.parse(json); } catch { bump("grimlock/section(bad-json)"); return ""; }
    const str = (k: string) => String(a[k] ?? "").trim();
    const title = str("title");
    const link = str("button_link");
    if (!link) return title ? `<p><strong>${title}</strong></p>` : "";
    const href = /^https?:\/\//i.test(link) ? link : `https://${link}`;
    const label = [title, str("subtitle"), str("button_text")].filter(Boolean).join(" — ");
    return `<p><a href="${href}">${label}</a></p>`;
  });

  // 3) dropped blocks
  for (const name of DROP_BLOCKS) {
    html = html.replace(new RegExp(`<!-- wp:${esc(name)}(?: \\{[^\\n]*?\\})? \\/-->\\n?`, "g"), () => { bump(name); return ""; });
    html = html.replace(new RegExp(`<!-- wp:${esc(name)}(?: \\{[^\\n]*?\\})? -->[\\s\\S]*?<!-- \\/wp:${esc(name)} -->\\n?`, "g"), () => { bump(name); return ""; });
  }
  html = html.replace(/<!-- wp:audio \/-->\n?/g, () => { bump("audio(empty)"); return ""; });

  // 4) shortcodes
  html = html.replace(/\[(youtube|embed)\]\s*(https?:\/\/\S+?)\s*\[\/\1\]/g, (_m, _t, url: string) => `<p><a href="${url}">${url}</a></p>`);
  html = html.replace(/\[caption\b[^\]]*\]([\s\S]*?)\[\/caption\]/g, (_m, inner: string) => {
    const img = inner.match(/<a\b[^>]*>\s*<img\b[^>]*>\s*<\/a>|<img\b[^>]*>/i)?.[0] ?? "";
    const cap = inner.replace(img, "").replace(/<[^>]+>/g, "").trim();
    return `<figure>${img}${cap ? `<figcaption>${cap}</figcaption>` : ""}</figure>`;
  });

  // 5) markers
  html = html.replace(/<!--more-->/g, "").replace(/<!-- \/?wp:[^>]*-->/g, "");

  // 6) classic content
  if (classic) html = wpautop(html);
  return { html, classic, dropped, unknownRefs };
}
