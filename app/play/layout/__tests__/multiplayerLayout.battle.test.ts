import { describe, it, expect } from 'vitest';
import { calculateMultiplayerLayout } from '../multiplayerLayout';

describe('calculateMultiplayerLayout with battleActive', () => {
  it('returns a fieldOfBattle zone when battleActive is true', () => {
    const layout = calculateMultiplayerLayout(1920, 1080, false, true);
    expect(layout.zones.fieldOfBattle).toBeDefined();
    expect(layout.zones.fieldOfBattle!.width).toBeGreaterThan(0);
    expect(layout.zones.fieldOfBattle!.height).toBeGreaterThan(0);
    expect(layout.zones.fieldOfBattle!.label).toBe('Field of Battle');
  });

  it('does not return fieldOfBattle zone when battleActive is false', () => {
    const layout = calculateMultiplayerLayout(1920, 1080, false, false);
    expect(layout.zones.fieldOfBattle).toBeUndefined();
  });

  it('compresses territories when battle is active', () => {
    const normal = calculateMultiplayerLayout(1920, 1080, false, false);
    const battle = calculateMultiplayerLayout(1920, 1080, false, true);
    expect(battle.zones.playerTerritory.height).toBeLessThan(normal.zones.playerTerritory.height);
    expect(battle.zones.opponentTerritory.height).toBeLessThan(normal.zones.opponentTerritory.height);
  });

  it('positions fieldOfBattle between opponent territory and player territory', () => {
    const layout = calculateMultiplayerLayout(1920, 1080, false, true);
    const fob = layout.zones.fieldOfBattle!;
    const oppTerritory = layout.zones.opponentTerritory;
    const playerTerritory = layout.zones.playerTerritory;
    expect(fob.y).toBeGreaterThanOrEqual(oppTerritory.y + oppTerritory.height - 5);
    expect(fob.y + fob.height).toBeLessThanOrEqual(playerTerritory.y + 5);
  });

  it('battle zone takes approximately 20% of stage height', () => {
    const layout = calculateMultiplayerLayout(1920, 1080, false, true);
    const ratio = layout.zones.fieldOfBattle!.height / 1080;
    expect(ratio).toBeGreaterThan(0.15);
    expect(ratio).toBeLessThan(0.25);
  });

  it('all zone heights still sum to stage height (battle mode)', () => {
    const layout = calculateMultiplayerLayout(1920, 1080, false, true);
    const z = layout.zones;
    const totalHeight =
      z.opponentHand.height +
      z.opponentLob.height +
      z.opponentTerritory.height +
      z.fieldOfBattle!.height +
      z.playerTerritory.height +
      z.playerLob.height +
      (1080 - z.playerHand.y);
    expect(totalHeight).toBeGreaterThan(1070);
    expect(totalHeight).toBeLessThan(1090);
  });

  it('works with narrow layout too', () => {
    const layout = calculateMultiplayerLayout(1440, 1080, false, true);
    expect(layout.zones.fieldOfBattle).toBeDefined();
    expect(layout.zones.fieldOfBattle!.height).toBeGreaterThan(0);
  });
});
