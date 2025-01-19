export function suggestNumberOfRounds(participantCount: number): number {
  // suggestions come from the 2024 Hosting Guide
  if (participantCount <= 0) return 0;
  if (participantCount <= 2) return 1;
  if (participantCount <= 4) return 2;
  if (participantCount <= 8) return 3;
  if (participantCount <= 16) return 4;
  if (participantCount <= 32) return 5;
  if (participantCount <= 64) return 6;
  if (participantCount <= 128) return 7;
  if (participantCount > 128) return 8;
}
