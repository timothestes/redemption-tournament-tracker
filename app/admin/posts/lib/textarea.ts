// Pure text-manipulation for the markdown toolbar. Every function returns the
// new value plus the selection the textarea should restore. No DOM here.

export interface Selection {
  start: number;
  end: number;
}

export interface EditResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/** Wrap the selection (or a placeholder) with `before`/`after`, keeping the inner text selected. */
export function wrapSelection(
  value: string,
  sel: Selection,
  before: string,
  after: string = before,
  placeholder = "text",
): EditResult {
  const inner = value.slice(sel.start, sel.end) || placeholder;
  const next = value.slice(0, sel.start) + before + inner + after + value.slice(sel.end);
  const start = sel.start + before.length;
  return { value: next, selectionStart: start, selectionEnd: start + inner.length };
}

/** Prefix every line the selection touches (heading, quote, list). Idempotent per line. */
export function prefixLines(value: string, sel: Selection, prefix: string): EditResult {
  const lineStart = value.lastIndexOf("\n", sel.start - 1) + 1;
  const nl = value.indexOf("\n", sel.end);
  const lineEnd = nl === -1 ? value.length : nl;
  const block = value.slice(lineStart, lineEnd);
  const prefixed = block
    .split("\n")
    .map((l) => (l.startsWith(prefix) ? l : prefix + l))
    .join("\n");
  const next = value.slice(0, lineStart) + prefixed + value.slice(lineEnd);
  const end = lineStart + prefixed.length;
  return { value: next, selectionStart: sel.start === sel.end ? end : lineStart, selectionEnd: end };
}

/** Insert a standalone block (YouTube URL, media placeholder) on its own paragraph. */
export function insertBlock(value: string, sel: Selection, block: string): EditResult {
  const before = value.slice(0, sel.start).replace(/\n+$/, (m) => m.slice(0, 2));
  const after = value.slice(sel.end).replace(/^\n+/, (m) => m.slice(0, 2));
  const pre = before.length === 0 ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const post = after.length === 0 ? "\n" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const inserted = pre + block + post;
  const caret = before.length + inserted.length;
  return { value: before + inserted + after, selectionStart: caret, selectionEnd: caret };
}

/** First-occurrence string replace without regex semantics in `needle`. */
export function replaceOnce(value: string, needle: string, replacement: string): string {
  const i = value.indexOf(needle);
  return i === -1 ? value : value.slice(0, i) + replacement + value.slice(i + needle.length);
}
