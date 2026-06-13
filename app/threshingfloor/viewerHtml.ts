// Serialize a value as a JS literal safe to embed inside an inline <script>.
// Escapes the characters that could terminate the tag or inject markup.
export function escapeForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

// Inject the view-mode bootstrap before the outline's main <script> so the
// flag/data are set before that script runs.
export function buildViewerHtml(
  shellHtml: string,
  episode: string,
  data: Record<string, unknown>
): string {
  const payload = escapeForScript({ episode, data });
  const bootstrap = `<script>window.__TF_VIEW__ = ${payload};</script>\n`;
  return shellHtml.replace("<script>", bootstrap + "<script>");
}
