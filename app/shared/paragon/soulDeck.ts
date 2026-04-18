// app/shared/paragon/soulDeck.ts

export interface ParagonSoulDef {
  identifier: string;   // 'paragon-soul-01' .. 'paragon-soul-21'
  cardName: string;     // 'Lost Soul 01' .. 'Lost Soul 21'
  cardImgFile: string;  // '/paragon-souls/Lost Soul 01.png' etc.
  cardSet: 'ParagonSoul';
  type: 'Lost Soul';
  alignment: 'Evil';
  brigade: '';
  strength: '';
  toughness: '';
  specialAbility: '';
  reference: '';
}

export const SOUL_DECK_BACK_IMG = '/paragon-souls/Lost Soul Back.png';

function buildSoul(n: number): ParagonSoulDef {
  const padded = String(n).padStart(2, '0');
  return {
    identifier: `paragon-soul-${padded}`,
    cardName: `Lost Soul ${padded}`,
    cardImgFile: `/paragon-souls/Lost Soul ${padded}.png`,
    cardSet: 'ParagonSoul',
    type: 'Lost Soul',
    alignment: 'Evil',
    brigade: '',
    strength: '',
    toughness: '',
    specialAbility: '',
    reference: '',
  };
}

export const PARAGON_SOULS: readonly ParagonSoulDef[] = Array.from(
  { length: 21 },
  (_, i) => buildSoul(i + 1)
) as readonly ParagonSoulDef[];
