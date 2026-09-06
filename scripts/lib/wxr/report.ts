import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ImportRow } from "./assemble";
import type { MarkdownStats } from "./toMarkdown";

export interface PostReport {
  slug: string; originalSlug: string; title: string; login: string; wpId: string; classic: boolean;
  stats: MarkdownStats & { droppedBlocks: Record<string, number>; unknownRefs: string[]; removedIframes: string[]; missingMedia: string[] };
  error?: string;
}
export interface Report {
  generatedAt: string; mode: string; totals: Record<string, number>;
  authors: { login: string; name: string; posts: number; email: string | null; resolved: string }[];
  slugChanges: { from: string; to: string }[];
  posts: PostReport[];
}

export function frontMatter(row: ImportRow): string {
  return [
    "---",
    `title: ${JSON.stringify(row.title)}`,
    `author_name: ${JSON.stringify(row.author_name)}`,
    `author_id: ${row.author_id ?? "null"}`,
    `published_at: ${row.published_at}`,
    `tags: ${JSON.stringify(row.tags)}`,
    `cover_image_url: ${row.cover_image_url ?? "null"}`,
    `source_url: ${row.source_url}`,
    "---",
    "", "",
  ].join("\n");
}

const problem = (p: PostReport) =>
  !!p.error || p.stats.residualHtml.length > 0 || p.stats.residualMarkers.length > 0 || p.stats.unknownRefs.length > 0 ||
  p.stats.removedIframes.length > 0 || p.stats.missingMedia.length > 0 || Object.keys(p.stats.droppedBlocks).length > 0;

export function writeReport(dir: string, report: Report): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2));
  const lines: string[] = [`# WXR import report (${report.mode}, ${report.generatedAt})`, ""];
  lines.push("## Totals", "", ...Object.entries(report.totals).map(([k, v]) => `- ${k}: ${v}`), "");
  lines.push("## Authors", "", "| login | name | posts | email | resolved |", "|---|---|---|---|---|");
  for (const a of report.authors) lines.push(`| ${a.login} | ${a.name} | ${a.posts} | ${a.email ?? ""} | ${a.resolved} |`);
  lines.push("", "## Slug changes", "", ...report.slugChanges.map((s) => `- ${s.from} → ${s.to}`), "");
  lines.push("## Posts needing a look", "", "| slug | issue |", "|---|---|");
  for (const p of report.posts.filter(problem)) {
    const issues: string[] = [];
    if (p.error) issues.push(`error: ${p.error}`);
    if (p.stats.residualHtml.length) issues.push(`html: ${p.stats.residualHtml.join(" ")}`);
    if (p.stats.residualMarkers.length) issues.push(`markers: ${p.stats.residualMarkers.join(" ")}`);
    if (p.stats.unknownRefs.length) issues.push(`unknown block refs: ${p.stats.unknownRefs.join(",")}`);
    if (p.stats.removedIframes.length) issues.push(`iframes removed: ${p.stats.removedIframes.join(" ")}`);
    if (p.stats.missingMedia.length) issues.push(`missing media: ${p.stats.missingMedia.join(" ")}`);
    for (const [k, v] of Object.entries(p.stats.droppedBlocks)) issues.push(`dropped ${k}×${v}`);
    lines.push(`| ${p.slug} | ${issues.join("; ").replace(/\|/g, "\\|")} |`);
  }
  writeFileSync(join(dir, "report.md"), lines.join("\n") + "\n");
}
