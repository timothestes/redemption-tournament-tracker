export function suggestNumberOfRounds(participantCount: number): number {
  if (participantCount <= 0) return 0;
  
  // Calculate recommended Swiss rounds based on participant count
  if (participantCount <= 4) {
    return Math.max(3, participantCount - 1); // Ensure at least 3 rounds
  } else if (participantCount <= 16) {
    return 4;
  } else if (participantCount <= 24) {
    return 5;
  } else if (participantCount <= 30) {
    return 6;
  } else {
    return Math.ceil(Math.log2(participantCount));
  }
}
