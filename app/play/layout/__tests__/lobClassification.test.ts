import { describe, it, expect } from 'vitest';
import { splitLobCards } from '../lobClassification';

const soul = (id: bigint, equippedTo: bigint = 0n) => ({
  id,
  equippedToInstanceId: equippedTo,
  cardType: 'Lost Soul',
});
const site = (id: bigint, equippedTo: bigint = 0n) => ({
  id,
  equippedToInstanceId: equippedTo,
  cardType: 'Site',
});

describe('splitLobCards', () => {
  it('splits a normal soul + attached site into host + accessory', () => {
    const cards = [soul(1n), site(2n, 1n), soul(3n)];
    const { hosts, accessoriesByHost } = splitLobCards(cards);
    expect(hosts.map(c => c.id)).toEqual([1n, 3n]);
    expect(accessoriesByHost.get(1n)?.map(c => c.id)).toEqual([2n]);
  });

  it('a Lost Soul with a stale equippedToInstanceId still renders as a host', () => {
    // Regression: a soul carrying a bogus attachment must never be tucked
    // behind another card (it rendered hidden below the opponent LOB strip).
    const cards = [soul(1n), soul(2n, 1n)];
    const { hosts, accessoriesByHost } = splitLobCards(cards);
    expect(hosts.map(c => c.id)).toEqual([1n, 2n]);
    expect(accessoriesByHost.size).toBe(0);
  });

  it('an accessory whose host is missing falls back to a host slot', () => {
    // Orphaned site (host rescued/moved with a stale attachment left behind)
    // must occupy its own slot instead of vanishing from the strip.
    const cards = [site(5n, 999n), soul(6n)];
    const { hosts, accessoriesByHost } = splitLobCards(cards);
    expect(hosts.map(c => c.id)).toEqual([5n, 6n]);
    expect(accessoriesByHost.size).toBe(0);
  });

  it('an accessory attached to another accessory falls back to a host slot', () => {
    const cards = [soul(1n), site(2n, 1n), site(3n, 2n)];
    const { hosts, accessoriesByHost } = splitLobCards(cards);
    expect(hosts.map(c => c.id)).toEqual([1n, 3n]);
    expect(accessoriesByHost.get(1n)?.map(c => c.id)).toEqual([2n]);
  });

  it('preserves input order for hosts and per-host accessories', () => {
    const cards = [soul(3n), site(4n, 3n), soul(1n), site(5n, 3n), soul(2n)];
    const { hosts, accessoriesByHost } = splitLobCards(cards);
    expect(hosts.map(c => c.id)).toEqual([3n, 1n, 2n]);
    expect(accessoriesByHost.get(3n)?.map(c => c.id)).toEqual([4n, 5n]);
  });
});
