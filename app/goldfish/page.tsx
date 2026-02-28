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
          borderColor: '#6b4e27',
        }}
      >
        <h1
          className="text-2xl font-bold mb-2 text-center font-cinzel"
          style={{ color: '#e8d5a3' }}
        >
          Practice Mode
        </h1>
        <p className="text-center mb-6" style={{ color: '#c9b99a' }}>
          Load a deck from the community or paste a deck list to start practicing.
        </p>

        <div className="flex flex-col gap-4">
          <Link
            href="/decklist/community"
            className="block text-center py-3 px-4 rounded font-medium transition-colors"
            style={{
              background: '#2a1f12',
              color: '#e8d5a3',
              border: '1px solid #6b4e27',
            }}
          >
            Browse Community Decks
          </Link>

          <div className="text-center text-sm" style={{ color: '#8b6532' }}>
            or open a deck directly at <code className="text-xs">/goldfish/[deckId]</code>
          </div>
        </div>
      </div>
    </div>
  );
}
