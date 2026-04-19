export interface ParagonEntry {
  playerId: string;
  displayName: string;   // "You" for self, otherwise the player's displayName
  paragonName: string;   // e.g. "David"
  imageUrl: string;      // /paragons/Paragon ${paragonName}.png
  isSelf: boolean;
}
