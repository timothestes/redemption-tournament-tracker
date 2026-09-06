import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

export interface MarkdownResult { markdown: string; removedIframes: string[] }
export interface MarkdownStats {
  images: number; links: number; embeds: number;
  residualHtml: string[]; residualMarkers: string[]; externalImageHosts: string[];
}

const YT = /youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{6,})/;
const has = (n: HTMLElement, cls: string) => !!n.classList && n.classList.contains(cls);
const attr = (n: Element, name: string) => n.getAttribute(name) ?? "";
const fileName = (url: string) => decodeURIComponent(url.split("?")[0].split("/").pop() || url);
const block = (s: string) => `\n\n${s}\n\n`;
const image = (img: Element) => `![${attr(img, "alt")}](${attr(img, "src")})`;

function figureMarkdown(el: HTMLElement): string {
  const img = el.querySelector("img[src]");
  if (!img) return "";
  const a = img.parentElement && img.parentElement.nodeName === "A" ? attr(img.parentElement, "href") : "";
  const cap = el.querySelector("figcaption")?.textContent?.trim();
  const core = a && a !== attr(img, "src") ? `[${image(img)}](${a})` : image(img);
  return block(cap ? `${core}\n*${cap}*` : core);
}

export function htmlToMarkdown(html: string): MarkdownResult {
  const removedIframes: string[] = [];
  const td = new TurndownService({
    headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-",
    emDelimiter: "*", strongDelimiter: "**", hr: "---",
  });
  td.use(gfm);
  td.remove(["script", "style"]);

  // General rules first; later addRule calls take precedence (see Turndown fact above).
  td.addRule("hashLink", { filter: (n) => n.nodeName === "A" && attr(n, "href") === "#", replacement: (c) => c });
  td.addRule("imgNoSrc", { filter: (n) => n.nodeName === "IMG" && !attr(n, "src"), replacement: () => "" });
  td.addRule("h1", { filter: "h1", replacement: (c) => block(`## ${c.trim()}`) });
  td.addRule("pdfObject", { filter: "object", replacement: () => "" });
  td.addRule("iframe", {
    filter: "iframe",
    replacement: (_c, n) => {
      const src = attr(n, "src");
      const m = src.match(YT);
      if (m) return block(`https://www.youtube.com/watch?v=${m[1]}`);
      removedIframes.push(src);
      return "";
    },
  });
  td.addRule("button", {
    filter: (n) => n.nodeName === "DIV" && has(n, "wp-block-button"),
    replacement: (_c, n) => { const a = n.querySelector("a[href]"); return a ? block(`[${a.textContent!.trim()}](${attr(a, "href")})`) : ""; },
  });
  td.addRule("fileBlock", {
    filter: (n) => n.nodeName === "DIV" && has(n, "wp-block-file"),
    replacement: (_c, n) => {
      const a = Array.from(n.querySelectorAll("a[href]")).find((x) => !x.classList.contains("wp-block-file__button"));
      return a ? block(`[${a.textContent!.trim() || fileName(attr(a, "href"))}](${attr(a, "href")})`) : "";
    },
  });
  td.addRule("accordionIcon", { filter: (n) => has(n, "wp-block-getwid-accordion__icon"), replacement: () => "" });
  td.addRule("accordionTitle", { filter: (n) => has(n, "wp-block-getwid-accordion__header-title"), replacement: (c) => block(`### ${c.trim()}`) });
  td.addRule("audio", {
    filter: (n) => n.nodeName === "AUDIO" && !!attr(n, "src"),
    replacement: (_c, n) => block(`[${fileName(attr(n, "src"))}](${attr(n, "src")})`),
  });
  td.addRule("figure", { filter: (n) => n.nodeName === "FIGURE" && !!n.querySelector("img[src]"), replacement: (_c, n) => figureMarkdown(n) });
  td.addRule("gallery", {
    filter: (n) => n.nodeName === "FIGURE" && has(n, "wp-block-gallery"),
    replacement: (_c, n) => block(Array.from(n.querySelectorAll("img[src]")).map(image).join("\n\n")),
  });
  td.addRule("audioFigure", {
    filter: (n) => n.nodeName === "FIGURE" && !!n.querySelector("audio[src]"),
    replacement: (_c, n) => {
      const src = attr(n.querySelector("audio[src]")!, "src");
      const cap = n.querySelector("figcaption")?.textContent?.trim();
      return block(`[${fileName(src)}](${src})${cap ? `\n*${cap}*` : ""}`);
    },
  });
  td.addRule("embedWrapper", {
    filter: (n) => (n.nodeName === "FIGURE" && has(n, "wp-block-embed")) || (n.nodeName === "DIV" && has(n, "wp-block-embed__wrapper")),
    replacement: (_c, n) => { const url = n.textContent!.trim(); return url ? block(url) : ""; },
  });

  const markdown = td.turndown(html).replace(/\n{3,}/g, "\n\n").trim();
  return { markdown, removedIframes };
}

export function measureMarkdown(md: string, mirrorBase: string): MarkdownStats {
  const noCode = md.replace(/```[\s\S]*?```/g, "");
  const images = [...noCode.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map((m) => m[1]);
  const links = (noCode.match(/(?<!!)\[[^\]]*\]\([^)\s]+/g) ?? []).length;
  const embeds = (noCode.match(/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\/\S+$/gm) ?? []).length;
  const residualHtml = [...new Set(noCode.match(/<[a-zA-Z][^>]*>/g) ?? [])];
  const residualMarkers = [...new Set(noCode.match(/<!-- \/?wp:|\[youtube\]|\[caption\b|\[embed\]/g) ?? [])];
  const externalImageHosts = [...new Set(images.filter((u) => /^https?:/i.test(u) && !u.startsWith(mirrorBase)).map((u) => new URL(u).host))];
  return { images: images.length, links, embeds, residualHtml, residualMarkers, externalImageHosts };
}
