const BLOCK =
  "p|div|ul|ol|li|h[1-6]|blockquote|table|thead|tbody|tfoot|tr|td|th|figure|pre|hr|section|article|iframe|object|dl|dt|dd|address|form|fieldset";
const OPEN = new RegExp(`(<(?:${BLOCK})\\b[^>]*>)`, "gi");
const CLOSE = new RegExp(`(</(?:${BLOCK})>)`, "gi");
const STARTS_BLOCK = new RegExp(`^<\\/?(?:${BLOCK})\\b`, "i");
const TOKEN = "\u0000PRE";

/** Classic-editor content is stored without <p>; WordPress adds them at render time. */
export function wpautop(input: string): string {
  if (!input.trim()) return "";
  const pres: string[] = [];
  const s = input
    .replace(/\r\n?/g, "\n")
    .replace(/<pre\b[\s\S]*?<\/pre>/gi, (m) => {
      pres.push(m);
      return `${TOKEN}${pres.length - 1}\u0000`;
    })
    .replace(OPEN, "\n\n$1")
    .replace(CLOSE, "$1\n\n");
  const chunks = s.split(/\n{2,}/).map((c) => c.trim()).filter(Boolean);
  const out = chunks.map((c) => {
    if (STARTS_BLOCK.test(c) || c.startsWith(TOKEN) || c.startsWith("<!--")) return c;
    return `<p>${c.replace(/\n/g, "<br />\n")}</p>`;
  });
  return out.join("\n\n").replace(/\u0000PRE(\d+)\u0000/g, (_m, i) => pres[Number(i)]);
}
