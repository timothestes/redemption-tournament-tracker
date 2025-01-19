export function suggestNumberOfRounds(participantCount: number): number {
  if (participantCount <= 0) return 0;
  if (participantCount <= 4) return Math.max(3, participantCount - 1);
  
  // Calculate recommended Swiss rounds based on participant count
  if (participantCount <= 8) return 3;
  if (participantCount <= 16) return 4;
  if (participantCount <= 32) return 5;
  if (participantCount <= 64) return 6;
  if (participantCount <= 128) return 7;
  if (participantCount <= 212) return 8;
  if (participantCount <= 385) return 9;
  
  // For any larger tournaments, use logarithmic scaling
  return Math.ceil(Math.log2(participantCount));
}
