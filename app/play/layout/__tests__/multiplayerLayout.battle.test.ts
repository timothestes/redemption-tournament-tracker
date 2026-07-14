import { describe, it, expect } from 'vitest';
import { calculateMultiplayerLayout } from '../multiplayerLayout';

const CASES = [
  { w: 1920, h: 1080 }, { w: 1440, h: 1080 }, // Standard / Narrow
];
describe('battle layout invariants', () => {
  for (const { w, h } of CASES) for (const vk of ['player','spectator'] as const) {
    it(`midline pinned + sidebar idle-keyed @${w} ${vk}`, () => {
      const idle = calculateMultiplayerLayout(w, h, 'T1', vk, false);
      const battle = calculateMultiplayerLayout(w, h, 'T1', vk, true);
      const idleCenter = idle.zones.divider.y + idle.zones.divider.height / 2;
      const band = battle.zones.battle!;
      expect(Math.abs(band.y + band.height / 2 - idleCenter)).toBeLessThanOrEqual(2);
      expect(battle.sidebar).toEqual(idle.sidebar);           // piles never move
      expect(battle.pileCard).toEqual(idle.pileCard);          // piles never resize
      expect(battle.zones.playerHand.y + battle.zones.playerHand.height).toBe(h); // rows fill stage
      expect(battle.zones.opponentLob.height).toBe(idle.zones.opponentLob.height); // LoBs untouched
    });
  }
  it('paragon battle band sits below shared LoB, taken equally from territories', () => {
    const idle = calculateMultiplayerLayout(1920, 1080, 'Paragon', 'player', false);
    const battle = calculateMultiplayerLayout(1920, 1080, 'Paragon', 'player', true);
    expect(battle.zones.battle!.y).toBeGreaterThanOrEqual(battle.zones.sharedLob!.y + battle.zones.sharedLob!.height - 1);
    const oppShrink = idle.zones.opponentTerritory.height - battle.zones.opponentTerritory.height;
    const plShrink = idle.zones.playerTerritory.height - battle.zones.playerTerritory.height;
    expect(Math.abs(oppShrink - plShrink)).toBeLessThanOrEqual(2);
  });
});
