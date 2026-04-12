import Link from 'next/link';

export const metadata = {
  title: 'Practice Mode | RedemptionCCG',
  description: 'Practice your Redemption deck in goldfish mode',
};

export default function GoldfishEntryPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0d0905] px-4">
      <div
        className="w-full max-w-lg rounded-lg border p-8"
        style={{
          background: '#1e1610',
          borderColor: 'var(--gf-border)',
        }}
      >
        <h1
          className="text-2xl font-bold mb-2 text-center font-cinzel"
          style={{ color: 'var(--gf-text-bright)' }}
        >
          Practice Mode
        </h1>
        <p className="text-center mb-6" style={{ color: 'var(--gf-text)' }}>
          Load a deck from the community or paste a deck list to start practicing.
        </p>

        <div className="flex flex-col gap-4">
          <Link
            href="/decklist/community"
            className="block text-center py-3 px-4 rounded font-medium transition-colors"
            style={{
              background: 'var(--gf-bg)',
              color: 'var(--gf-text-bright)',
              border: '1px solid var(--gf-border)',
            }}
          >
            Browse Community Decks
          </Link>

          <div className="text-center text-sm" style={{ color: 'var(--gf-text-dim)' }}>
            or open a deck directly at <code className="text-xs">/goldfish/[deckId]</code>
          </div>
        </div>
      </div>
    </div>
  );
}
