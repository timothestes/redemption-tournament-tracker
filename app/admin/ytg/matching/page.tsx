export const metadata = { title: "YTG Store — Matching" };

// WS-0 skeleton. WS-2 (deterministic matching + review queue) replaces
// this file wholesale — nothing else in the shell needs to change.
export default function MatchingPage() {
  return (
    <div className="rounded-lg bg-card px-6 py-16 text-center">
      <h2 className="text-lg font-semibold mb-1">Matching</h2>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">
        The matching dashboard and keyboard-driven review queue are coming
        soon. Cards will match to store products by SKU first, with fuzzy
        passes as fallback.
      </p>
    </div>
  );
}
