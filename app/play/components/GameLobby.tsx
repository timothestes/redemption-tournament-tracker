'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { loadDeckForGame, searchCommunityDecks } from '../actions';

type DeckOption = {
  id: string;
  name: string;
  format: string | null;
  card_count: number | null;
  username?: string | null;
};

interface GameLobbyProps {
  decks: { id: string; name: string; format: string | null; card_count: number | null }[];
  userId: string;
  displayName: string;
}

export function GameLobby({ decks, userId, displayName }: GameLobbyProps) {
  const router = useRouter();

  // Deck picker state
  const [selectedDeck, setSelectedDeck] = useState<DeckOption | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'my' | 'community'>('my');
  const [communityResults, setCommunityResults] = useState<DeckOption[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showPicker, setShowPicker] = useState(true);

  // Game state
  const [displayNameInput, setDisplayNameInput] = useState(displayName);
  const [gameCode, setGameCode] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Spectate state
  const [spectateCode, setSpectateCode] = useState('');

  // Debounce timer ref for community search
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Community search with debounce
  const doCommunitySearch = useCallback(async (query: string) => {
    if (query.length < 2) {
      setCommunityResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const results = await searchCommunityDecks(query);
      setCommunityResults(results);
    } catch {
      setCommunityResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab !== 'community') return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doCommunitySearch(searchQuery);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, activeTab, doCommunitySearch]);

  // Filter user's decks client-side
  const filteredMyDecks = decks.filter((d) =>
    d.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  function handleSelectDeck(deck: DeckOption) {
    setSelectedDeck(deck);
    setShowPicker(false);
    setError(null);
  }

  function handleChangeDeck() {
    setSelectedDeck(null);
    setShowPicker(true);
    setSearchQuery('');
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
      const code = Math.random().toString(36).slice(2, 6).toUpperCase();
      sessionStorage.setItem(
        `stdb_game_params_${code}`,
        JSON.stringify({
          role: 'create',
          deckId: selectedDeck.id,
          displayName: displayNameInput,
          supabaseUserId: userId,
          format: selectedDeck.format || 'Type 1',
          deckData: JSON.stringify(deckData),
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
    if (!selectedDeck) {
      setError('Please select a deck.');
      return;
    }
    setIsJoining(true);
    setError(null);
    try {
      const { deckData } = await loadDeckForGame(selectedDeck.id);
      sessionStorage.setItem(
        `stdb_game_params_${code}`,
        JSON.stringify({
          role: 'join',
          deckId: selectedDeck.id,
          displayName: displayNameInput,
          supabaseUserId: userId,
          deckData: JSON.stringify(deckData),
        })
      );
      router.push(`/play/${code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load deck.');
      setIsJoining(false);
    }
  }

  function handleSpectate() {
    const code = spectateCode.trim().toUpperCase();
    if (code.length !== 4) return;
    router.push(`/play/spectate/${code}`);
  }

  const resultsToShow: DeckOption[] = activeTab === 'my' ? filteredMyDecks : communityResults;

  return (
    <div className="flex flex-col gap-6">
      {/* Deck Selection */}
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4">Select Deck</h2>

        {decks.length === 0 && !selectedDeck && (
          <p className="text-sm text-muted-foreground mb-4">
            No saved decks found.{' '}
            <a href="/decklist/card-search" className="underline text-primary">
              Build a deck
            </a>{' '}
            first, or search community decks below.
          </p>
        )}

        {selectedDeck && !showPicker ? (
          <div className="flex items-center justify-between rounded-md border border-border bg-background px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="font-medium truncate">{selectedDeck.name}</span>
              {selectedDeck.format && (
                <Badge variant="secondary" className="shrink-0 text-xs">
                  {selectedDeck.format}
                </Badge>
              )}
              {selectedDeck.card_count != null && (
                <span className="text-xs text-muted-foreground shrink-0">
                  {selectedDeck.card_count} cards
                </span>
              )}
              {selectedDeck.username && (
                <span className="text-xs text-muted-foreground shrink-0">
                  by {selectedDeck.username}
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleChangeDeck}
              className="shrink-0 ml-2"
            >
              Change
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Search input */}
            <Input
              placeholder="Search your decks or community decks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="focus-visible:ring-0 focus-visible:border-primary"
            />

            {/* Tabs */}
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setActiveTab('my')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  activeTab === 'my'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                My Decks
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('community')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  activeTab === 'community'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                Community
              </button>
            </div>

            {/* Results list */}
            <div className="max-h-60 overflow-y-auto rounded-md border border-border bg-background">
              {activeTab === 'community' && isSearching && (
                <div className="px-4 py-3 text-sm text-muted-foreground">
                  Searching...
                </div>
              )}

              {activeTab === 'community' && !isSearching && searchQuery.length < 2 && (
                <div className="px-4 py-3 text-sm text-muted-foreground">
                  Type at least 2 characters to search community decks.
                </div>
              )}

              {activeTab === 'community' && !isSearching && searchQuery.length >= 2 && resultsToShow.length === 0 && (
                <div className="px-4 py-3 text-sm text-muted-foreground">
                  No community decks found.
                </div>
              )}

              {activeTab === 'my' && resultsToShow.length === 0 && (
                <div className="px-4 py-3 text-sm text-muted-foreground">
                  {searchQuery
                    ? 'No matching decks found.'
                    : 'No saved decks. Try the Community tab.'}
                </div>
              )}

              {resultsToShow.length > 0 && (
                <ul className="divide-y divide-border">
                  {resultsToShow.map((deck) => (
                    <li key={deck.id}>
                      <button
                        type="button"
                        onClick={() => handleSelectDeck(deck)}
                        className="w-full text-left px-4 py-3 hover:bg-muted transition-colors flex items-center gap-3"
                      >
                        <span className="font-medium truncate min-w-0 flex-1">
                          {deck.name}
                        </span>
                        {deck.format && (
                          <Badge variant="secondary" className="shrink-0 text-xs">
                            {deck.format}
                          </Badge>
                        )}
                        {deck.card_count != null && (
                          <span className="text-xs text-muted-foreground shrink-0">
                            {deck.card_count} cards
                          </span>
                        )}
                        {deck.username && (
                          <span className="text-xs text-muted-foreground shrink-0">
                            by {deck.username}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Display Name */}
      <section className="rounded-lg border border-border bg-card p-6">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="display-name">Display Name</Label>
          <Input
            id="display-name"
            value={displayNameInput}
            onChange={(e) => setDisplayNameInput(e.target.value)}
            maxLength={32}
            className="focus-visible:ring-0 focus-visible:border-primary"
          />
        </div>
      </section>

      {/* Create / Join */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Create Game */}
        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold mb-4">Create Game</h2>
          <div className="flex flex-col gap-3">
            {selectedDeck?.format && (
              <p className="text-sm text-muted-foreground">
                Format: <span className="text-foreground">{selectedDeck.format}</span>
              </p>
            )}
            <Button
              onClick={handleCreateGame}
              disabled={isCreating || !selectedDeck}
              className="w-full"
            >
              {isCreating ? 'Loading deck...' : 'Create Game'}
            </Button>
          </div>
        </section>

        {/* Join Game */}
        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold mb-4">Join Game</h2>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="join-code">Game Code</Label>
              <Input
                id="join-code"
                value={gameCode}
                onChange={(e) =>
                  setGameCode(e.target.value.toUpperCase().slice(0, 4))
                }
                placeholder="ABCD"
                maxLength={4}
                className="uppercase tracking-widest font-mono focus-visible:ring-0 focus-visible:border-primary"
              />
            </div>
            <Button
              onClick={handleJoinGame}
              disabled={isJoining || gameCode.length !== 4 || !selectedDeck}
              className="w-full"
            >
              {isJoining ? 'Loading deck...' : 'Join Game'}
            </Button>
          </div>
        </section>
      </div>

      {/* Error */}
      {error && (
        <p className="text-sm text-destructive text-center">{error}</p>
      )}

      {/* Spectate */}
      <section className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold shrink-0">Spectate</h2>
          <Input
            value={spectateCode}
            onChange={(e) =>
              setSpectateCode(e.target.value.toUpperCase().slice(0, 4))
            }
            placeholder="ABCD"
            maxLength={4}
            className="uppercase tracking-widest font-mono max-w-24 focus-visible:ring-0 focus-visible:border-primary"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleSpectate}
            disabled={spectateCode.trim().length !== 4}
          >
            Watch
          </Button>
        </div>
      </section>
    </div>
  );
}
