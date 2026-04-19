import { describe, it, expect } from 'vitest';
import { buildParagonEntries } from '../paragonEntries';

describe('buildParagonEntries', () => {
  it('returns empty array when no players have paragons', () => {
    const result = buildParagonEntries({
      players: [
        { id: 'p1', displayName: 'Alice', paragonName: null, isSelf: true },
        { id: 'p2', displayName: 'Bob', paragonName: null, isSelf: false },
      ],
    });
    expect(result).toEqual([]);
  });

  it('filters out players with null paragonName', () => {
    const result = buildParagonEntries({
      players: [
        { id: 'p1', displayName: 'Alice', paragonName: 'David', isSelf: true },
        { id: 'p2', displayName: 'Bob', paragonName: null, isSelf: false },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].playerId).toBe('p1');
  });

  it('renames the local player displayName to "You"', () => {
    const result = buildParagonEntries({
      players: [
        { id: 'p1', displayName: 'Alice', paragonName: 'David', isSelf: true },
        { id: 'p2', displayName: 'Bob', paragonName: 'Esther', isSelf: false },
      ],
    });
    expect(result[0].displayName).toBe('You');
    expect(result[1].displayName).toBe('Bob');
  });

  it('builds the paragon image URL using the public/paragons convention', () => {
    const result = buildParagonEntries({
      players: [{ id: 'p1', displayName: 'Alice', paragonName: 'David', isSelf: true }],
    });
    expect(result[0].imageUrl).toBe('/paragons/Paragon David.png');
    expect(result[0].paragonName).toBe('David');
  });

  it('preserves input player order', () => {
    const result = buildParagonEntries({
      players: [
        { id: 'p2', displayName: 'Bob', paragonName: 'Esther', isSelf: false },
        { id: 'p1', displayName: 'Alice', paragonName: 'David', isSelf: true },
      ],
    });
    expect(result.map((e) => e.playerId)).toEqual(['p2', 'p1']);
  });

  it('treats empty string paragonName as absent', () => {
    const result = buildParagonEntries({
      players: [
        { id: 'p1', displayName: 'Alice', paragonName: '', isSelf: true },
      ],
    });
    expect(result).toEqual([]);
  });
});
