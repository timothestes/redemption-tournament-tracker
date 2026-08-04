export const metadata = { title: "YTG Store — Decks" };

// WS-0 skeleton. WS-3 (deck products + pull-contents wizard) replaces
// this file wholesale — nothing else in the shell needs to change.
export default function DecksPage() {
  return (
    <div className="rounded-lg bg-card px-6 py-16 text-center">
      <h2 className="text-lg font-semibold mb-1">Decks</h2>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">
        Deck product tooling is coming soon. Preconstructed deck contents
        will link to real decklists, with per-card inventory decrements on
        sale.
      </p>
    </div>
  );
}
