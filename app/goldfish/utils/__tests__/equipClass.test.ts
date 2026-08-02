import { describe, it, expect } from 'vitest';
import { gameCardIsWarrior, gameCardIsWeapon } from '../equipClass';

// The equip hit-test used to resolve Warrior/Weapon class purely through
// `findCard()` against the public card index. Forge cards are never in that
// index, so every Forge card read as "not a Warrior" and could neither host
// nor be a weapon (bug: forge "Red Dragon", class Warrior, refused weapons).
// `cardClass` is the Forge-resolved class and, when present, is authoritative.

const base = { cardName: '', cardSet: '', cardImgFile: '' };

describe('gameCardIsWarrior', () => {
  it('uses the forge-resolved class when present', () => {
    expect(gameCardIsWarrior({ ...base, cardName: 'Red Dragon', cardSet: 'Forge', cardClass: 'Warrior' })).toBe(true);
  });

  it('is false for a forge card whose class is empty', () => {
    expect(gameCardIsWarrior({ ...base, cardName: 'Red Dragon', cardSet: 'Forge', cardClass: '' })).toBe(false);
  });

  it('never falls back to a same-named public card when the class is known', () => {
    // A forge card named exactly like a public Warrior must not inherit the
    // public card's class — forge data is the only truth for forge cards.
    // 'Goliath (LoC)' is Warrior-class in the public index.
    expect(gameCardIsWarrior({ ...base, cardName: 'Goliath (LoC)', cardSet: 'Forge', cardClass: '' })).toBe(false);
  });

  it('falls back to the public card index for non-forge cards', () => {
    expect(gameCardIsWarrior({ ...base, cardName: 'Red Dragon (RoJ)', cardSet: 'RoJ' })).toBe(true);
    expect(gameCardIsWarrior({ ...base, cardName: 'Red Dragon (L)', cardSet: 'Main' })).toBe(false);
  });

  it('handles compound forge classes', () => {
    expect(gameCardIsWarrior({ ...base, cardClass: 'Warrior/Weapon' })).toBe(true);
  });

  it('is false for an unknown card with no class', () => {
    expect(gameCardIsWarrior({ ...base, cardName: 'Not A Real Card' })).toBe(false);
  });
});

describe('gameCardIsWeapon', () => {
  it('uses the forge-resolved class when present', () => {
    expect(gameCardIsWeapon({ ...base, cardName: 'Sword of the Spirit', cardSet: 'Forge', cardClass: 'Weapon' })).toBe(true);
    expect(gameCardIsWeapon({ ...base, cardName: 'Red Dragon', cardSet: 'Forge', cardClass: 'Warrior' })).toBe(false);
  });

  it('falls back to the public card index for non-forge cards', () => {
    expect(gameCardIsWeapon({ ...base, cardName: "Abishai's Spear", cardSet: 'Ki' })).toBe(true);
    expect(gameCardIsWeapon({ ...base, cardName: 'Red Dragon (RoJ)', cardSet: 'RoJ' })).toBe(false);
  });
});
