// Pure URL helper for SpacetimeDB's HTTP API. The token itself is read only
// inside server actions — never import process.env here.
export function stdbHttpBase(wsHost: string): string {
  return wsHost
    .replace(/^ws:\/\//, "http://")
    .replace(/^wss:\/\//, "https://")
    .replace(/\/+$/, "");
}
