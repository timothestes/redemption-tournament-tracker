import type { ParagonEntry } from '../types/paragonEntry';

interface ParagonEntriesInput {
  players: Array<{
    id: string;
    displayName: string;
    paragonName: string | null;
    isSelf: boolean;
  }>;
}

export function buildParagonEntries(input: ParagonEntriesInput): ParagonEntry[] {
  return input.players
    .filter((p) => p.paragonName && p.paragonName.length > 0)
    .map((p) => ({
      playerId: p.id,
      displayName: p.isSelf ? 'You' : p.displayName,
      paragonName: p.paragonName!,
      imageUrl: `/paragons/Paragon ${p.paragonName}.png`,
      isSelf: p.isSelf,
    }));
}
