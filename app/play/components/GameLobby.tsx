'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { loadDeckForGame } from '../actions';

interface Deck {
  id: string;
  name: string;
  format: string | null;
}

interface GameLobbyProps {
  decks: Deck[];
  userId: string;
  displayName: string;
}

const FORMAT_OPTIONS = ['Type 1', 'Type 2', 'Paragon'];

export function GameLobby({ decks, userId, displayName }: GameLobbyProps) {
  const router = useRouter();

  // Create game state
  const [createDeckId, setCreateDeckId] = useState(decks[0]?.id || '');
  const [createFormat, setCreateFormat] = useState(
    decks[0]?.format || FORMAT_OPTIONS[0]
  );
  const [createDisplayName, setCreateDisplayName] = useState(displayName);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Join game state
  const [joinCode, setJoinCode] = useState('');
  const [joinDeckId, setJoinDeckId] = useState(decks[0]?.id || '');
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Spectate state
  const [spectateCode, setSpectateCode] = useState('');

  function handleCreateDeckChange(deckId: string) {
    setCreateDeckId(deckId);
    const deck = decks.find((d) => d.id === deckId);
    if (deck?.format) {
      setCreateFormat(deck.format);
    }
  }

  async function handleCreateGame() {
    if (!createDeckId) {
      setCreateError('Please select a deck.');
      return;
    }
    setIsCreating(true);
    setCreateError(null);
    try {
      const { deck, deckData } = await loadDeckForGame(createDeckId);
      const gameCode = Math.random().toString(36).slice(2, 6).toUpperCase();
      sessionStorage.setItem(
        `game_${gameCode}`,
        JSON.stringify({
          role: 'host',
          displayName: createDisplayName,
          format: createFormat,
          deck,
          deckData,
        })
      );
      router.push(`/play/${gameCode}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create game.');
      setIsCreating(false);
    }
  }

  async function handleJoinGame() {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 4) {
      setJoinError('Game code must be 4 characters.');
      return;
    }
    if (!joinDeckId) {
      setJoinError('Please select a deck.');
      return;
    }
    setIsJoining(true);
    setJoinError(null);
    try {
      const { deck, deckData } = await loadDeckForGame(joinDeckId);
      sessionStorage.setItem(
        `game_${code}`,
        JSON.stringify({
          role: 'guest',
          displayName,
          deck,
          deckData,
        })
      );
      router.push(`/play/${code}`);
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : 'Failed to load deck.');
      setIsJoining(false);
    }
  }

  function handleSpectate() {
    const code = spectateCode.trim().toUpperCase();
    if (code.length !== 4) return;
    router.push(`/play/spectate/${code}`);
  }

  const selectClass =
    'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div className="flex flex-col gap-6">
      {/* Create Game */}
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4">Create Game</h2>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-deck">Deck</Label>
            {decks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No saved decks found.{' '}
                <a href="/decklist/card-search" className="underline">
                  Build a deck
                </a>{' '}
                first.
              </p>
            ) : (
              <select
                id="create-deck"
                value={createDeckId}
                onChange={(e) => handleCreateDeckChange(e.target.value)}
                className={selectClass}
              >
                {decks.map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deck.name}
                    {deck.format ? ` (${deck.format})` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-format">Format</Label>
            <select
              id="create-format"
              value={createFormat}
              onChange={(e) => setCreateFormat(e.target.value)}
              className={selectClass}
            >
              {FORMAT_OPTIONS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-name">Display Name</Label>
            <Input
              id="create-name"
              value={createDisplayName}
              onChange={(e) => setCreateDisplayName(e.target.value)}
              maxLength={32}
            />
          </div>

          {createError && (
            <p className="text-sm text-destructive">{createError}</p>
          )}

          <Button
            onClick={handleCreateGame}
            disabled={isCreating || decks.length === 0}
          >
            {isCreating ? 'Loading deck...' : 'Create Game'}
          </Button>
        </div>
      </section>

      {/* Join Game */}
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4">Join Game</h2>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="join-code">Game Code</Label>
            <Input
              id="join-code"
              value={joinCode}
              onChange={(e) =>
                setJoinCode(e.target.value.toUpperCase().slice(0, 4))
              }
              placeholder="ABCD"
              maxLength={4}
              className="uppercase tracking-widest font-mono"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="join-deck">Deck</Label>
            {decks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No saved decks found.
              </p>
            ) : (
              <select
                id="join-deck"
                value={joinDeckId}
                onChange={(e) => setJoinDeckId(e.target.value)}
                className={selectClass}
              >
                {decks.map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deck.name}
                    {deck.format ? ` (${deck.format})` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {joinError && (
            <p className="text-sm text-destructive">{joinError}</p>
          )}

          <Button
            onClick={handleJoinGame}
            disabled={isJoining || joinCode.length !== 4 || decks.length === 0}
          >
            {isJoining ? 'Loading deck...' : 'Join Game'}
          </Button>
        </div>
      </section>

      {/* Spectate */}
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4">Spectate</h2>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="spectate-code">Game Code</Label>
            <Input
              id="spectate-code"
              value={spectateCode}
              onChange={(e) =>
                setSpectateCode(e.target.value.toUpperCase().slice(0, 4))
              }
              placeholder="ABCD"
              maxLength={4}
              className="uppercase tracking-widest font-mono"
            />
          </div>

          <Button
            variant="outline"
            onClick={handleSpectate}
            disabled={spectateCode.trim().length !== 4}
          >
            Watch Game
          </Button>
        </div>
      </section>
    </div>
  );
}
