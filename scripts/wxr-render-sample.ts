/**
 * Render dry-run markdown through the real ArticleBody for eyeballing.
 * Usage: npx tsx scripts/wxr-render-sample.ts --slugs a,b,c   (reads scripts/output/wxr/posts/<slug>.md)
 * Writes scripts/output/wxr/render/<slug>.html
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import ArticleBody from "@/app/articles/components/ArticleBody";

// tsconfig.json says jsx: "preserve" (Next.js compiles it), so tsx falls back to the
// classic JSX runtime and the app's .tsx files call a global React.createElement.
(globalThis as unknown as { React: typeof React }).React = React;

const { values } = parseArgs({ options: { slugs: { type: "string" } } });
const slugs = (values.slugs ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (!slugs.length) { console.error("--slugs a,b,c required"); process.exit(1); }
const dir = join("scripts/output/wxr");
mkdirSync(join(dir, "render"), { recursive: true });
const CSS = `body{max-width:760px;margin:2rem auto;font:16px/1.6 system-ui;padding:0 1rem}img{max-width:100%}iframe{width:100%;aspect-ratio:16/9}pre{overflow:auto;background:#f4f4f4;padding:1rem}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:.25rem .5rem}`;
for (const slug of slugs) {
  const raw = readFileSync(join(dir, "posts", `${slug}.md`), "utf8");
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n\n/);
  const markdown = fm ? raw.slice(fm[0].length) : raw;
  const body = renderToStaticMarkup(React.createElement(ArticleBody, { markdown }));
  writeFileSync(join(dir, "render", `${slug}.html`), `<!doctype html><meta charset="utf-8"><title>${slug}</title><style>${CSS}</style><pre style="white-space:pre-wrap;font-size:12px">${(fm?.[1] ?? "").replace(/</g, "&lt;")}</pre>${body}`);
  console.log("rendered", join(dir, "render", `${slug}.html`));
}
