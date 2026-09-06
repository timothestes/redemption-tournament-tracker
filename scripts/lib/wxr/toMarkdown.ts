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

// Turndown only escapes text/URLs it converts itself from real text nodes. These rules
// interpolate raw DOM text and attribute values by hand, so they must escape it themselves.
const mdText = (s: string) => s.replace(/\\/g, "\\\\").replace(/[\[\]*_`]/g, "\\$&");
const mdUrl = (u: string) => {
  const opens = (u.match(/\(/g) ?? []).length;
  const closes = (u.match(/\)/g) ?? []).length;
  return /[\s<>]/.test(u) || opens !== closes ? `<${u}>` : u;
};

const image = (img: Element) => `![${mdText(attr(img, "alt"))}](${mdUrl(attr(img, "src"))})`;

function figureMarkdown(el: HTMLElement): string {
  const img = el.querySelector("img[src]");
  if (!img) return "";
  const a = img.parentElement && img.parentElement.nodeName === "A" ? attr(img.parentElement, "href") : "";
  const cap = el.querySelector("figcaption")?.textContent?.trim();
  const core = a && a !== attr(img, "src") ? `[${image(img)}](${mdUrl(a)})` : image(img);
  return block(cap ? `${core}\n*${mdText(cap)}*` : core);
}

export function htmlToMarkdown(html: string): MarkdownResult {
  const removedIframes: string[] = [];
  const td = new TurndownService({
    headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-",
    emDelimiter: "*", strongDelimiter: "**", hr: "---",
  });
  td.use(gfm);
  td.remove(["script", "style"]);

  // addRule unshifts, so the rule added LAST wins when multiple filters match the same element.
  td.addRule("hashLink", { filter: (n) => n.nodeName === "A" && attr(n, "href") === "#", replacement: (c) => c });
  td.addRule("imgNoSrc", { filter: (n) => n.nodeName === "IMG" && !attr(n, "src"), replacement: () => "" });
  td.addRule("h1", { filter: "h1", replacement: (c) => block(`## ${c.trim()}`) });
  td.addRule("bareUrlParagraph", {
    // A classic-editor post embeds a video/link by putting a bare URL on its own paragraph
    // (or, once shortcodes are expanded, a self-linked <a>). Turndown's normal text/link
    // escaping would mangle underscores in the URL (breaking embeds), so emit it verbatim.
    filter: (n) => {
      if (n.nodeName !== "P") return false;
      const text = n.textContent?.trim() ?? "";
      if (!/^https?:\/\/\S+$/.test(text)) return false;
      const children = Array.from(n.children);
      if (!children.every((c) => c.nodeName === "A" || c.nodeName === "BR")) return false;
      return children.filter((c) => c.nodeName === "A").length <= 1;
    },
    replacement: (_c, n) => block(n.textContent!.trim()),
  });
  td.addRule("pdfObject", { filter: "object", replacement: () => "" });
  td.addRule("iframe", {
    filter: "iframe",
    replacement: (_c, n) => {
      const src = attr(n, "src");
      const m = src.match(YT);
      if (m) return block(`https://www.youtube.com/watch?v=${m[1]}`);
      if (src) removedIframes.push(src);
      return "";
    },
  });
  td.addRule("button", {
    filter: (n) => n.nodeName === "DIV" && has(n, "wp-block-button"),
    replacement: (_c, n) => {
      const a = n.querySelector("a[href]");
      return a ? block(`[${mdText(a.textContent!.trim())}](${mdUrl(attr(a, "href"))})`) : "";
    },
  });
  td.addRule("fileBlock", {
    filter: (n) => n.nodeName === "DIV" && has(n, "wp-block-file"),
    replacement: (_c, n) => {
      const a = Array.from(n.querySelectorAll("a[href]")).find((x) => !x.classList.contains("wp-block-file__button"));
      if (!a) return "";
      const href = attr(a, "href");
      return block(`[${mdText(a.textContent!.trim() || fileName(href))}](${mdUrl(href)})`);
    },
  });
  td.addRule("accordionIcon", { filter: (n) => has(n, "wp-block-getwid-accordion__icon"), replacement: () => "" });
  td.addRule("accordionTitle", { filter: (n) => has(n, "wp-block-getwid-accordion__header-title"), replacement: (c) => block(`### ${c.trim()}`) });
  td.addRule("audio", {
    filter: (n) => n.nodeName === "AUDIO" && !!attr(n, "src"),
    replacement: (_c, n) => {
      const src = attr(n, "src");
      return block(`[${mdText(fileName(src))}](${mdUrl(src)})`);
    },
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
      return block(`[${mdText(fileName(src))}](${mdUrl(src)})${cap ? `\n*${mdText(cap)}*` : ""}`);
    },
  });
  td.addRule("embedWrapper", {
    filter: (n) => (n.nodeName === "FIGURE" && has(n, "wp-block-embed")) || (n.nodeName === "DIV" && has(n, "wp-block-embed__wrapper")),
    replacement: (c, n) => {
      // The URL lives in the .wp-block-embed__wrapper element's own (raw) text. Fall back to
      // the figure's own text when there is no wrapper div, and to the already-processed
      // children (`c`) when the wrapper holds an <iframe> instead of bare text, so the iframe
      // rule's output (a watch URL, or "" with the src reported) flows through untouched.
      const wrapper = has(n, "wp-block-embed__wrapper") ? n : n.querySelector(".wp-block-embed__wrapper");
      const rawText = (wrapper ?? n).textContent!.trim();
      const url = rawText || c.trim();
      if (!url) return "";
      const cap = n.nodeName === "FIGURE" ? n.querySelector("figcaption")?.textContent?.trim() : undefined;
      // The caption is its own paragraph AFTER the URL — never glued to it.
      return cap ? `${block(url)}*${mdText(cap)}*\n\n` : block(url);
    },
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
  const externalImageHosts = new Set<string>();
  for (const u of images) {
    if (u.startsWith(mirrorBase)) continue;
    if (u.startsWith("//")) {
      try { externalImageHosts.add(new URL(`https:${u}`).host); } catch { /* unparseable, skip */ }
    } else if (u.startsWith("/")) {
      externalImageHosts.add("(relative)");
    } else if (/^https?:/i.test(u)) {
      try { externalImageHosts.add(new URL(u).host); } catch { /* unparseable, skip */ }
    }
  }
  return { images: images.length, links, embeds, residualHtml, residualMarkers, externalImageHosts: [...externalImageHosts] };
}
