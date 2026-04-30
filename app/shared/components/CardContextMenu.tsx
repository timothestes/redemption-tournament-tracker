'use client';

import { useEffect, useRef, useMemo, useState } from 'react';
import { GameCard, ZoneId, ZONE_LABELS, COUNTER_COLORS, CounterColorId } from '../../goldfish/types';
import { GameActions } from '@/app/shared/types/gameActions';
import { getAbilitiesForCard, abilityLabel } from '@/lib/cards/cardAbilities';

const MOVE_TARGETS: ZoneId[] = [
  'territory',
  'discard', 'reserve',
];

const LOST_SOUL_EXCLUDED_TARGETS: ZoneId[] = ['territory', 'discard', 'reserve'];

function isLostSoul(card: GameCard): boolean {
  return card.type === 'LS' || card.type === 'Lost Soul' || card.type.toLowerCase().includes('lost soul');
}

interface CardContextMenuProps {
  card: GameCard;
  x: number;
  y: number;
  actions: GameActions;
  onClose: () => void;
  onExchange?: (cardIds: string[]) => void;
  /** Invoked when the user clicks "Unequip" on an attached weapon. Only renders the menu
   *  entry when this handler is provided AND card.equippedTo is set. */
  onDetach?: (cardInstanceId: string) => void;
  /** Invoked when the user clicks "Add text note" / "Edit note". When omitted, the
   *  menu entry is not rendered (used to gate the action to card owners). */
  onEditNote?: (card: GameCard) => void;
  /** Invoked when the user clicks "Surrender" on a Lost Soul in their own (or
   *  the shared Paragon) Land of Bondage. Sends the soul to the opponent's
   *  Land of Redemption. Multiplayer-only — goldfish leaves this undefined and
   *  the menu entry is suppressed. */
  onSurrender?: (cardInstanceId: string) => void;
  /** Invoked when the user clicks "Rescue" on a Lost Soul in the opponent's
   *  (or the shared Paragon) Land of Bondage. Sends the soul to the local
   *  player's Land of Redemption. Multiplayer-only. */
  onRescue?: (cardInstanceId: string) => void;
  /** Live zone state for reading updated card data (counters, etc.) */
  zones?: Record<ZoneId, GameCard[]>;
  /** When true, the whole-hand reveal is active — suppress the per-card
   *  "Reveal for 30s" entry as redundant. Optional; defaults to false. */
  isHandRevealed?: boolean;
}

export function CardContextMenu({ card: initialCard, x, y, actions, onClose, onExchange, onDetach, onEditNote, onSurrender, onRescue, zones, isHandRevealed }: CardContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; ready: boolean }>({ left: x, top: y, ready: false });

  // Read live card data so counters update while menu is open
  const card = useMemo(() => {
    if (!zones) return initialCard;
    for (const zoneId of Object.keys(zones) as ZoneId[]) {
      const found = (zones[zoneId] ?? []).find(c => c.instanceId === initialCard.instanceId);
      if (found) return found;
    }
    return initialCard;
  }, [zones, initialCard]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  // Measure after mount, compute final position, then reveal
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const parent = menu.offsetParent as HTMLElement | null;
    const parentRect = parent?.getBoundingClientRect() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };

    let left = x;
    let top = y;

    if (left + rect.width > parentRect.width) {
      left = Math.max(0, parentRect.width - rect.width - 8);
    }
    if (top + rect.height > parentRect.height) {
      top = Math.max(8, parentRect.height - rect.height - 8);
    }

    setPos({ left, top, ready: true });
  }, [x, y]);

  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    left: pos.left,
    top: pos.top,
    background: 'var(--gf-bg)',
    border: '1px solid var(--gf-border)',
    borderRadius: 6,
    padding: '4px 0',
    zIndex: 900,
    maxHeight: '80vh',
    overflowY: 'auto',
    boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
    whiteSpace: 'nowrap',
    visibility: pos.ready ? 'visible' : 'hidden',
  };

  const itemStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '6px 14px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--gf-text)',
    fontSize: 13,
    textAlign: 'left',
    fontFamily: 'var(--font-cinzel), Georgia, serif',
  };

  const separatorStyle: React.CSSProperties = {
    height: 1,
    background: 'var(--gf-border)',
    margin: '4px 8px',
    opacity: 0.5,
  };

  const labelStyle: React.CSSProperties = {
    ...itemStyle,
    color: 'var(--gf-text-dim)',
    fontSize: 10,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    cursor: 'default',
    padding: '4px 16px 2px',
  };

  const doAction = (fn: () => void) => {
    fn();
    onClose();
  };

  // Get count for a given color
  const getCount = (colorId: CounterColorId): number => {
    const c = card.counters.find(c => c.color === colorId);
    return c?.count ?? 0;
  };

  // Per-card abilities from the CARD_ABILITIES registry. Keyed by cardName
  // (includes the set suffix, e.g., "Two Possessed (GoC)") — the identifier
  // field is a taxonomy descriptor, not a stable lookup key.
  const abilities = getAbilitiesForCard(card.cardName);
  // Only the local player (player1) can fire abilities on their own cards. The
  // server enforces this too, but hiding the menu items avoids a confusing
  // click-then-fail flow when right-clicking opponent cards in multiplayer.
  // Goldfish is single-player so every card is owned by player1 — no change there.
  const isOwnedByLocalPlayer = card.ownerId === 'player1';
  // Only allow abilities to fire when the source card is actually in play.
  // Cards in hand/deck/reserve/discard/banish can't trigger in-play effects.
  // "In play" means Territory, Land of Bondage, or Land of Redemption — heroes
  // rest in LoR between battles, so omitting it blocks most Hero-source cards.
  const ABILITY_SOURCE_ZONES: ReadonlyArray<ZoneId> = ['territory', 'land-of-bondage', 'land-of-redemption'];
  const isInAbilityZone = ABILITY_SOURCE_ZONES.includes(card.zone);
  const hasAbilities =
    abilities.length > 0 && typeof actions.executeCardAbility === 'function';
  const canExecuteAbilities = hasAbilities && isOwnedByLocalPlayer && isInAbilityZone;

  // Per-card hand reveal — gated to local player's own hand cards and
  // suppressed when the whole hand is already publicly revealed.
  const canRevealInHand =
    card.zone === 'hand' &&
    isOwnedByLocalPlayer &&
    !isHandRevealed &&
    typeof actions.revealCardInHand === 'function';

  const nowForReveal = Date.now();
  const isActivelyRevealed =
    typeof card.revealUntil === 'number' && card.revealUntil > nowForReveal;
  const secondsRemaining = isActivelyRevealed
    ? Math.max(0, Math.ceil((card.revealUntil! - nowForReveal) / 1000))
    : 0;

  // Lost Soul tokens get a simplified menu (rescue is the actual game mechanic).
  // Other tokens fall through to the normal menu — server-side cleanup deletes
  // them when they leave territory.
  if (card.isToken && isLostSoul(card)) {
    return (
      <div ref={menuRef} style={menuStyle} onContextMenu={(e) => e.preventDefault()}>
        <div style={labelStyle}>{card.cardName}</div>
        <button
          style={itemStyle}
          onClick={() => doAction(() => actions.moveCard(card.instanceId, 'land-of-redemption'))}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          Rescue to L.O.R.
        </button>
        {actions.removeOpponentToken && (
          <>
            <div style={separatorStyle} />
            <button
              style={{ ...itemStyle, color: '#8b4a4a' }}
              onClick={() => doAction(() => actions.removeOpponentToken!(card.instanceId))}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              Remove Token
            </button>
          </>
        )}
      </div>
    );
  }

  // Lost Soul rescue/surrender buttons — non-token Lost Souls in a Land of
  // Bondage. Surrender applies to your own LoB or the shared Paragon LoB.
  // Rescue applies to the opponent's LoB or the shared Paragon LoB. Handlers
  // are multiplayer-only; goldfish leaves them undefined so the buttons hide.
  const isNonTokenLostSoulInLob =
    !card.isToken && isLostSoul(card) && card.zone === 'land-of-bondage';
  const canSurrender =
    isNonTokenLostSoulInLob &&
    !!onSurrender &&
    (card.ownerId === 'player1' || card.ownerId === 'shared');
  const canRescue =
    isNonTokenLostSoulInLob &&
    !!onRescue &&
    (card.ownerId === 'player2' || card.ownerId === 'shared');

  return (
    <div ref={menuRef} style={menuStyle} onContextMenu={(e) => e.preventDefault()}>

      {(canSurrender || canRescue) && (
        <>
          {canRescue && (
            <button
              style={itemStyle}
              onClick={() => doAction(() => onRescue!(card.instanceId))}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              Rescue
            </button>
          )}
          {canSurrender && (
            <button
              style={itemStyle}
              onClick={() => doAction(() => onSurrender!(card.instanceId))}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              Surrender
            </button>
          )}
          <div style={separatorStyle} />
        </>
      )}

      {/* Card abilities from CARD_ABILITIES registry. Rendered disabled when
          the local player doesn't own the card, or when the card isn't in a
          valid source zone — the server would reject these anyway. */}
      {hasAbilities && (
        <>
          {abilities.map((ability, index) => {
            const disabled = !canExecuteAbilities;
            return (
              <button
                key={index}
                disabled={disabled}
                title={disabled && !isOwnedByLocalPlayer ? "You don't control this card" : undefined}
                style={{
                  ...itemStyle,
                  opacity: disabled ? 0.4 : 1,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                }}
                onClick={() => {
                  if (disabled) return;
                  actions.executeCardAbility?.(card.instanceId, index);
                  onClose();
                }}
                onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'var(--gf-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                {abilityLabel(ability)}
              </button>
            );
          })}
          <div style={separatorStyle} />
        </>
      )}

      {canRevealInHand && (
        <>
          <button
            style={itemStyle}
            onClick={() => doAction(() => actions.revealCardInHand!(card.instanceId))}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            {isActivelyRevealed
              ? `Reveal for 30s (${secondsRemaining}s left — reset)`
              : 'Reveal for 30s'}
          </button>
          <div style={separatorStyle} />
        </>
      )}

      {/* Counter swatches — territory and land-of-bondage always; land-of-redemption only when counters already exist */}
      {(card.zone === 'territory' || card.zone === 'land-of-bondage' || (card.zone === 'land-of-redemption' && card.counters.some(c => c.count > 0))) && (
        <>
          <div style={labelStyle}>Counters</div>
          <div style={{ display: 'flex', gap: 6, padding: '4px 16px 2px', alignItems: 'center' }}>
            {COUNTER_COLORS.filter(c => c.id === 'red' || c.id === 'green' || c.id === 'blue').map((color) => {
              const count = getCount(color.id);
              return (
                <button
                  key={color.id}
                  title={`${color.label}${count > 0 ? ` (${count})` : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.addCounter(card.instanceId, color.id);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (count > 0) actions.removeCounter(card.instanceId, color.id);
                  }}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: color.hex,
                    border: count > 0 ? '2px solid rgba(255,255,255,0.8)' : '2px solid rgba(255,255,255,0.2)',
                    cursor: 'pointer',
                    transition: 'transform 0.1s, border-color 0.1s',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: 11,
                    fontWeight: 'bold',
                    position: 'relative',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.15)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                >
                  {count > 0 ? count : ''}
                </button>
              );
            })}
            {card.counters.some(c => c.count > 0) && (
              <button
                title="Clear all counters"
                aria-label="Clear all counters"
                onClick={(e) => {
                  e.stopPropagation();
                  card.counters.forEach(c => {
                    for (let i = 0; i < c.count; i++) {
                      actions.removeCounter(card.instanceId, c.color);
                    }
                  });
                }}
                style={{
                  width: 22,
                  height: 22,
                  marginLeft: 2,
                  borderRadius: '50%',
                  background: 'transparent',
                  border: '1px solid var(--gf-border)',
                  cursor: 'pointer',
                  transition: 'transform 0.1s, border-color 0.1s, color 0.1s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--gf-text-dim)',
                  fontSize: 12,
                  lineHeight: 1,
                  padding: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.15)';
                  e.currentTarget.style.color = 'var(--gf-text)';
                  e.currentTarget.style.borderColor = 'var(--gf-text-dim)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.color = 'var(--gf-text-dim)';
                  e.currentTarget.style.borderColor = 'var(--gf-border)';
                }}
              >
                ×
              </button>
            )}
          </div>
          <div style={{ padding: '0 16px 4px', fontSize: 9, color: 'var(--gf-border)', fontFamily: 'var(--font-cinzel), Georgia, serif' }}>
            Left-click +1 · Right-click -1
          </div>
        </>
      )}

      <button
        style={itemStyle}
        onClick={() => doAction(() => card.isMeek ? actions.unmeekCard(card.instanceId) : actions.meekCard(card.instanceId))}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        {card.isMeek ? 'Unmeek' : 'Make Meek'}
      </button>

      <button
        style={itemStyle}
        onClick={() => doAction(() => actions.flipCard(card.instanceId))}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        {card.isFlipped ? 'Turn Face-Up' : 'Turn Face-Down'}
      </button>

      {card.equippedTo && onDetach && (
        <button
          style={itemStyle}
          onClick={() => doAction(() => onDetach(card.instanceId))}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          Unequip
        </button>
      )}

      {onEditNote && (
        <>
          <button
            style={itemStyle}
            onClick={() => doAction(() => onEditNote(card))}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            {card.notes
              ? `Edit note: "${card.notes.length > 20 ? card.notes.slice(0, 20) + '…' : card.notes}"`
              : 'Add text note'}
          </button>
          <button
            style={itemStyle}
            onClick={() => doAction(() => actions.setNote(card.instanceId, 'Negated'))}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            Negated
          </button>
          {card.notes && (
            <button
              style={itemStyle}
              onClick={() => doAction(() => actions.setNote(card.instanceId, ''))}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              Clear note
            </button>
          )}
        </>
      )}

      <div style={separatorStyle} />

      {/* Zone targets */}
      <div style={labelStyle}>Move to...</div>
      {MOVE_TARGETS
        .filter(z => z !== card.zone)
        .filter(z => !isLostSoul(card) || !LOST_SOUL_EXCLUDED_TARGETS.includes(z))
        .map(zoneId => (
          <button
            key={zoneId}
            style={itemStyle}
            onClick={() => doAction(() => actions.moveCard(card.instanceId, zoneId))}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            {ZONE_LABELS[zoneId]}
          </button>
        ))}

      <div style={separatorStyle} />
      <div style={labelStyle}>Deck...</div>

      {/* Deck actions */}
      {actions.moveCardToTopOfDeck && (
        <button
          style={itemStyle}
          onClick={() => doAction(() => actions.moveCardToTopOfDeck!(card.instanceId))}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          Top of Deck
        </button>
      )}
      {actions.moveCardToBottomOfDeck && (
        <button
          style={itemStyle}
          onClick={() => doAction(() => actions.moveCardToBottomOfDeck!(card.instanceId))}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          Bottom of Deck
        </button>
      )}
      <button
        style={itemStyle}
        onClick={() => doAction(() => actions.shuffleCardIntoDeck(card.instanceId))}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        Shuffle into Deck
      </button>
      {onExchange && card.zone !== 'deck' && (
        <button
          style={itemStyle}
          onClick={() => { onClose(); onExchange([card.instanceId]); }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          Exchange with Deck
        </button>
      )}
    </div>
  );
}
