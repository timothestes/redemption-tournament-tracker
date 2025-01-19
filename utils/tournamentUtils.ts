export function suggestNumberOfRounds(participantCount: number): number {
  if (participantCount <= 0) return 0;
  
  // Calculate the minimum number of rounds needed
  // Using log base 2 and rounding up
  return Math.ceil(Math.log2(participantCount));
}
