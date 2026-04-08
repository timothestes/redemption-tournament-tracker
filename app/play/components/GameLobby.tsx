'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { getCardImageUrl } from '@/lib/card-images';
import { loadDeckForGame } from '../actions';
import { useSpacetimeConnection } from '../hooks/useSpacetimeConnection';
import { SpacetimeProvider } from '../lib/spacetimedb-provider';
import { DeckPickerModal } from './DeckPickerModal';
import { LobbyList } from './LobbyList';
import type { DeckOption } from './DeckPickerCard';

interface GameLobbyProps {
  decks: DeckOption[];
  userId: string;
  displayName: string;
}

export function GameLobby({ decks, userId, displayName }: GameLobbyProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Pre-fill game code from ?join=XXXX invite link
  const joinCode = searchParams.get('join')?.toUpperCase().slice(0, 4) ?? '';

  // Auto-select last-played deck (from localStorage), fall back to most recently edited
  const [selectedDeck, setSelectedDeck] = useState<DeckOption | null>(() => {
    if (decks.length === 0) return null;
    if (typeof window !== 'undefined') {
      const lastPlayedId = localStorage.getItem('lastPlayedDeckId');
      if (lastPlayedId) {
        const found = decks.find(d => d.id === lastPlayedId);
        if (found) return found;
      }
    }
    return decks[0];
  });
  const [pickerOpen, setPickerOpen] = useState(false);

  // Game state
  const [gameCode, setGameCode] = useState(joinCode);
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Spectate toggle
  const [isSpectate, setIsSpectate] = useState(false);

  // Show error from redirect (e.g. stale lobby join attempt)
  useEffect(() => {
    const lobbyError = sessionStorage.getItem('lobby_error');
    if (lobbyError) {
      setError(lobbyError);
      setActiveTab('lobby');
      sessionStorage.removeItem('lobby_error');
    }
  }, []);

  // Tab and lobby visibility state
  const [activeTab, setActiveTab] = useState<'create' | 'lobby'>('create');
  const [isPrivate, setIsPrivate] = useState(false);

  // SpacetimeDB connection for lobby
  const { connectionBuilder, error: connError } = useSpacetimeConnection();

  function handleSelectDeck(deck: DeckOption) {
    setSelectedDeck(deck);
    setPickerOpen(false);
    setError(null);
  }

  async function handleJoinFromLobby(code: string) {
    if (!selectedDeck) {
      setError('Please select a deck first.');
      return;
    }
    setGameCode(code);
    setIsJoining(true);
    setError(null);
    try {
      const { deckData } = await loadDeckForGame(selectedDeck.id);
      localStorage.setItem('lastPlayedDeckId', selectedDeck.id);
      sessionStorage.setItem(
        `stdb_game_params_${code}`,
        JSON.stringify({
          role: 'join',
          deckId: selectedDeck.id,
          deckName: selectedDeck.name,
          displayName,
          supabaseUserId: userId,
          format: selectedDeck.format || 'Type 1',
          paragon: selectedDeck.paragon || null,
          deckData: JSON.stringify(deckData),
        })
      );
      router.push(`/play/${code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load deck.');
      setIsJoining(false);
    }
  }

  async function handleCreateGame() {
    if (!selectedDeck) {
      setError('Please select a deck.');
      return;
    }
    setIsCreating(true);
    setError(null);
    try {
      const { deckData } = await loadDeckForGame(selectedDeck.id);
      localStorage.setItem('lastPlayedDeckId', selectedDeck.id);
      const code = Math.random().toString(36).slice(2, 6).toUpperCase();
      sessionStorage.setItem(
        `stdb_game_params_${code}`,
        JSON.stringify({
          role: 'create',
          deckId: selectedDeck.id,
          deckName: selectedDeck.name,
          displayName,
          supabaseUserId: userId,
          format: selectedDeck.format || 'Type 1',
          paragon: selectedDeck.paragon || null,
          deckData: JSON.stringify(deckData),
          isPublic: !isPrivate,
          lobbyMessage: '',
        })
      );
      router.push(`/play/${code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create game.');
      setIsCreating(false);
    }
  }

  async function handleJoinGame() {
    const code = gameCode.trim().toUpperCase();
    if (code.length !== 4) {
      setError('Game code must be 4 characters.');
      return;
    }
    if (isSpectate) {
      router.push(`/play/spectate/${code}`);
      return;
    }
    if (!selectedDeck) {
      setError('Please select a deck.');
      return;
    }
    setIsJoining(true);
    setError(null);
    try {
      const { deckData } = await loadDeckForGame(selectedDeck.id);
      localStorage.setItem('lastPlayedDeckId', selectedDeck.id);
      sessionStorage.setItem(
        `stdb_game_params_${code}`,
        JSON.stringify({
          role: 'join',
          deckId: selectedDeck.id,
          deckName: selectedDeck.name,
          displayName,
          supabaseUserId: userId,
          format: selectedDeck.format || 'Type 1',
          paragon: selectedDeck.paragon || null,
          deckData: JSON.stringify(deckData),
        })
      );
      router.push(`/play/${code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load deck.');
      setIsJoining(false);
    }
  }

  // Preview image helpers
  const img1Url = getCardImageUrl(selectedDeck?.preview_card_1);
  const img2Url = getCardImageUrl(selectedDeck?.preview_card_2);
  const hasPreview = img1Url || img2Url;
  const isParagon =
    selectedDeck?.format?.toLowerCase().includes('paragon') && selectedDeck?.paragon;

  return (
    <div className="flex flex-col gap-5">
      {/* Deck selection — matches community/my-decks card preview style */}
      <section className="rounded-lg border border-border bg-card overflow-hidden [.jayden_&]:border-primary/30 [.jayden_&]:bg-gradient-to-br [.jayden_&]:from-[hsla(0,80%,25%,0.15)] [.jayden_&]:via-[hsla(270,60%,20%,0.1)] [.jayden_&]:to-[hsla(230,80%,30%,0.15)]">
        {selectedDeck ? (
          <>
            {/* Card preview header — same style as community DeckCard */}
            {isParagon ? (
              <div className="h-32 overflow-hidden">
                <img
                  src={`/paragons/Paragon ${selectedDeck.paragon}.png`}
                  alt={selectedDeck.paragon!}
                  className="w-full h-full object-cover object-top"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
            ) : hasPreview ? (
              <div className="h-32 overflow-hidden bg-card flex items-center justify-center gap-1 px-2 py-2">
                {img1Url && (
                  <img src={img1Url} alt="" className="h-full object-contain rounded" />
                )}
                {img2Url && (
                  <img src={img2Url} alt="" className="h-full object-contain rounded" />
                )}
              </div>
            ) : (
              <div className="h-20 bg-muted flex items-center justify-center">
                <img
                  src="/gameplay/cardback.webp"
                  alt=""
                  className="h-14 w-auto object-contain rounded opacity-30"
                />
              </div>
            )}

            {/* Deck info + change button */}
            <div className="flex items-center justify-between px-5 py-3">
              <div className="flex flex-col min-w-0">
                <span className="font-semibold truncate text-base">{selectedDeck.name}</span>
                <div className="flex items-center gap-2 mt-0.5">
                  {selectedDeck.format && (
                    <Badge variant="secondary" className="text-xs">
                      {selectedDeck.format}
                    </Badge>
                  )}
                  {selectedDeck.card_count != null && (
                    <span className="text-xs text-muted-foreground">
                      {selectedDeck.card_count} cards
                    </span>
                  )}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPickerOpen(true)}
                className="shrink-0"
              >
                Change
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 py-6 px-5">
            <p className="text-sm text-muted-foreground">
              No saved decks.{' '}
              <a href="/decklist/card-search" className="underline text-primary">
                Build one
              </a>{' '}
              or pick from the community.
            </p>
            <Button
              variant="outline"
              onClick={() => setPickerOpen(true)}
            >
              Browse Decks
            </Button>
          </div>
        )}
      </section>

      {/* Deck Picker Modal */}
      <DeckPickerModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={handleSelectDeck}
        myDecks={decks}
        selectedDeckId={selectedDeck?.id}
      />

      {/* Tab navigation — only shown when NOT in invite link mode */}
      {!joinCode && (
        <div className="flex border-b border-border">
          <button
            onClick={() => setActiveTab('create')}
            className={`flex-1 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'create'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Create / Join
          </button>
          <button
            onClick={() => setActiveTab('lobby')}
            className={`flex-1 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'lobby'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Open Games
          </button>
        </div>
      )}

      {/* Actions — invite link mode shows join/spectate choice, normal mode shows tabbed content */}
      {joinCode ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground text-center">
            You&apos;ve been invited to game <span className="font-mono font-bold text-foreground">{joinCode}</span>
          </p>
          <div className="flex gap-2">
            <Button
              size="lg"
              onClick={handleJoinGame}
              disabled={isJoining || !selectedDeck}
              className="flex-1 h-12 text-base"
            >
              {isJoining ? 'Joining...' : 'Join as Player'}
            </Button>
            <div className="relative flex-1 group">
              <Button
                size="lg"
                variant="outline"
                disabled
                className="w-full h-12 text-base opacity-50 cursor-not-allowed"
              >
                Watch as Spectator
              </Button>
              <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs text-muted-foreground bg-popover border rounded px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                Coming soon
              </span>
            </div>
          </div>
          <a
            href="/play"
            className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors text-center"
          >
            Or create your own game
          </a>

          {/* Error */}
          {error && (
            <p className="text-sm text-destructive text-center">{error}</p>
          )}
        </div>
      ) : (
        <SpacetimeProvider connectionBuilder={connectionBuilder}>
          {activeTab === 'create' && (
            <>
              <div className="flex flex-col sm:flex-row items-stretch gap-3">
                <div className="sm:basis-0 sm:flex-1 flex flex-col gap-2.5">
                  <Button
                    size="lg"
                    onClick={handleCreateGame}
                    disabled={isCreating || !selectedDeck}
                    className="w-full h-12 text-base"
                  >
                    {isCreating ? 'Loading deck...' : 'Create Game'}
                  </Button>
                  {/* Private game toggle — visually belongs to Create Game */}
                  <div className="flex items-center gap-2.5 justify-center">
                    <label htmlFor="private-toggle" className="text-sm text-muted-foreground">
                      Private game
                    </label>
                    <button
                      id="private-toggle"
                      role="switch"
                      aria-checked={isPrivate}
                      onClick={() => setIsPrivate(!isPrivate)}
                      className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors ${
                        isPrivate ? 'bg-primary' : 'bg-muted'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          isPrivate ? 'translate-x-[22px]' : 'translate-x-[3px]'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* OR divider */}
                <div className="flex sm:flex-col items-center justify-center gap-2 sm:gap-1 py-1 sm:py-0 sm:px-2 shrink-0">
                  <div className="flex-1 h-px sm:h-auto sm:w-px bg-border sm:flex-1" />
                  <span className="text-xs text-muted-foreground tracking-widest">OR</span>
                  <div className="flex-1 h-px sm:h-auto sm:w-px bg-border sm:flex-1" />
                </div>

                <div className="sm:basis-0 sm:flex-1 flex flex-col gap-2.5">
                  <div className="flex gap-2">
                    <Input
                      value={gameCode}
                      onChange={(e) =>
                        setGameCode(e.target.value.toUpperCase().slice(0, 4))
                      }
                      placeholder="Game Code"
                      maxLength={4}
                      className="flex-1 uppercase tracking-widest font-mono text-center h-12 focus-visible:ring-0 focus-visible:border-primary"
                    />
                    <Button
                      size="lg"
                      variant="outline"
                      onClick={handleJoinGame}
                      disabled={isJoining || gameCode.length !== 4 || (!isSpectate && !selectedDeck)}
                      className="shrink-0 h-12 w-20"
                    >
                      {isJoining ? 'Joining...' : isSpectate ? 'Watch' : 'Join'}
                    </Button>
                  </div>
                  {/* Spectate toggle — disabled until spectator mode is ready */}
                  <div className="relative group flex items-center gap-2.5 justify-center opacity-50">
                    <label htmlFor="spectate-toggle" className="text-sm text-muted-foreground">
                      Spectate
                    </label>
                    <button
                      id="spectate-toggle"
                      role="switch"
                      aria-checked={false}
                      disabled
                      className="relative inline-flex h-6 w-10 items-center rounded-full transition-colors bg-muted cursor-not-allowed"
                    >
                      <span
                        className="inline-block h-4 w-4 transform rounded-full bg-white transition-transform translate-x-[3px]"
                      />
                    </button>
                    <span className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs text-muted-foreground bg-popover border rounded px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                      Coming soon
                    </span>
                  </div>
                </div>
              </div>

              {/* Error */}
              {error && (
                <p className="text-sm text-destructive text-center">{error}</p>
              )}

            </>
          )}

          {activeTab === 'lobby' && (
            connError ? (
              <div className="py-8 text-center">
                <p className="text-sm text-destructive mb-1">Could not connect to game server</p>
                <p className="text-xs text-muted-foreground">{connError}</p>
              </div>
            ) : (
              <>
                {error && (
                  <p className="text-sm text-destructive text-center mb-2">{error}</p>
                )}
                <LobbyList
                  selectedDeckId={selectedDeck?.id ?? null}
                  onJoinGame={handleJoinFromLobby}
                  onSwitchToCreate={() => setActiveTab('create')}
                />
              </>
            )
          )}
        </SpacetimeProvider>
      )}
    </div>
  );
}
