import type { Root, Parent, Text, RootContent } from "mdast";
import { CARD_MENTION_RE, parseMention } from "./markdown";

// Turns `[[Card Name]]` inside text nodes into a `card-mention` element that
// ArticleBody maps to <CardMention>. Only `text` nodes are touched, so code
// spans and fenced blocks keep their brackets; link text is skipped too, since
// a button inside an anchor is invalid HTML.

interface CardMentionNode {
  type: "cardMention";
  data: { hName: "card-mention"; hProperties: { name: string; label: string } };
  children: never[];
}

const SKIP = new Set(["link", "linkReference", "inlineCode", "code"]);

function split(text: Text): RootContent[] | null {
  const value = text.value;
  if (!value.includes("[[")) return null;
  const out: RootContent[] = [];
  let last = 0;
  for (const m of value.matchAll(CARD_MENTION_RE)) {
    const { target, label } = parseMention(m[1]);
    if (!target) continue;
    if (m.index! > last) out.push({ type: "text", value: value.slice(last, m.index) });
    const node: CardMentionNode = {
      type: "cardMention",
      data: { hName: "card-mention", hProperties: { name: target, label } },
      children: [],
    };
    out.push(node as unknown as RootContent);
    last = m.index! + m[0].length;
  }
  if (out.length === 0) return null;
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

function visit(parent: Parent): void {
  const next: RootContent[] = [];
  let changed = false;
  for (const child of parent.children) {
    if (child.type === "text") {
      const parts = split(child);
      if (parts) {
        next.push(...parts);
        changed = true;
        continue;
      }
    } else if ("children" in child && !SKIP.has(child.type)) {
      visit(child as Parent);
    }
    next.push(child);
  }
  if (changed) parent.children = next;
}

export default function remarkCardMentions() {
  return (tree: Root) => {
    visit(tree);
  };
}
