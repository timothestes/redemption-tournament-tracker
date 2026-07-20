"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useTable } from "spacetimedb/react";
import { Button } from "@/components/ui/button";
import { tables } from "@/lib/spacetimedb/module_bindings";
import { useSpacetimeConnection } from "@/app/play/hooks/useSpacetimeConnection";
import { SpacetimeProvider } from "@/app/play/lib/spacetimedb-provider";
import { ForgeDeckPicker } from "./ForgeDeckPicker";
import type { ForgeDeckSummary, SharedForgeDeckSummary } from "@/app/forge/lib/deckTypes";

interface Props { decks: ForgeDeckSummary[]; sharedDecks: SharedForgeDeckSummary[]; displayName: string; userId: string; initialJoinCode?: string }

function LobbyInner({ decks, sharedDecks, displayName, userId, initialJoinCode }: Props) {
  const router = useRouter();
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(decks[0]?.id ?? sharedDecks[0]?.id ?? null);
  const [joinCode, setJoinCode] = useState(initialJoinCode ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  // Selection resolves across both your decks and shared decks; stash() only
  // needs id/name/format, which both summary shapes carry.
  const selected =
    decks.find((d) => d.id === selectedDeckId) ??
    sharedDecks.find((d) => d.id === selectedDeckId) ??
    null;

  const [forgeGames] = useTable(tables.ForgeGame);
  const [games] = useTable(tables.Game);
  const openGames = useMemo(() => {
    const forgeIds = new Set(forgeGames.map((f) => String(f.gameId)));
    return games
      .filter((g) => forgeIds.has(String(g.id)) && g.status === "waiting")
      .sort((a, b) => Number(b.createdAt.microsSinceUnixEpoch - a.createdAt.microsSinceUnixEpoch));
  }, [forgeGames, games]);

  function stash(code: string, role: "create" | "join") {
    if (!selected) { setError("Pick a deck first."); return false; }
    sessionStorage.setItem(
      `stdb_game_params_${code}`,
      JSON.stringify({
        role,
        deckId: selected.id,
        deckName: selected.name,
        displayName,
        supabaseUserId: userId,
        format: selected.format || "Type 1",
        paragon: null, // paragon comes from the forge deck server-side (sanitized) — Task 8 passes gameParams.paragon || ''
        isForge: true,
      }),
    );
    return true;
  }

  function handleCreate() {
    const code = Math.random().toString(36).slice(2, 6).toUpperCase();
    if (!stash(code, "create")) return;
    setIsCreating(true);
    router.push(`/play/${code}`);
  }

  function handleJoin(codeRaw: string) {
    const code = codeRaw.trim().toUpperCase();
    if (code.length !== 4) { setError("Game code must be 4 characters."); return; }
    if (!stash(code, "join")) return;
    router.push(`/play/${code}`);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <div>
        <h1 className="text-2xl font-semibold">Playtest games</h1>
        <p className="text-sm text-muted-foreground">Private games with Forge decks.</p>
      </div>
      {initialJoinCode && (
        <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
          You&apos;ve been invited to game{" "}
          <span className="font-mono font-semibold tracking-widest">{initialJoinCode}</span> — pick a
          deck and hit <span className="font-medium">Join</span> below.
        </div>
      )}
      {error && <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">{error}</div>}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Deck</h2>
        {decks.length === 0 && sharedDecks.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            No Forge decks yet.{" "}
            <Link
              href="/forge/play/decks/new"
              className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
            >
              Build one
            </Link>{" "}
            to start playtesting.
          </div>
        ) : (
          <ForgeDeckPicker
            decks={decks}
            sharedDecks={sharedDecks}
            selectedDeckId={selectedDeckId}
            onSelect={setSelectedDeckId}
          />
        )}
      </section>
      <section className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-lg border p-4 [.jayden_&]:bg-card/80 [.jayden_&]:backdrop-blur-sm [.jayden_&]:border-primary/20">
          <div className="font-medium">Host a game</div>
          <div className="text-sm text-muted-foreground">Get a code to share with another playtester.</div>
          <Button onClick={handleCreate} disabled={!selected || isCreating} className="mt-1 w-full">
            {isCreating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading deck…
              </>
            ) : (
              "Create game"
            )}
          </Button>
        </div>
        <div className="rounded-lg border p-4 [.jayden_&]:bg-card/80 [.jayden_&]:backdrop-blur-sm [.jayden_&]:border-primary/20">
          <div className="font-medium">Join by code</div>
          <div className="mt-2 flex gap-2">
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              maxLength={4}
              placeholder="CODE"
              className="w-24 rounded-md border bg-background p-2 text-sm uppercase tracking-widest"
            />
            <Button
              variant="outline"
              onClick={() => handleJoin(joinCode)}
              disabled={!selected || joinCode.trim().length !== 4}
              className="h-10 shrink-0 px-4"
            >
              Join
            </Button>
          </div>
        </div>
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Open playtest games</h2>
        {openGames.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody is waiting right now.</p>
        ) : (
          <ul className="max-w-md divide-y rounded-lg border [.jayden_&]:bg-card/80 [.jayden_&]:backdrop-blur-sm [.jayden_&]:border-primary/20">
            {openGames.map((g) => (
              <li key={String(g.id)} className="flex items-center justify-between gap-2 p-3">
                <div>
                  <div className="text-sm font-medium">{g.createdByName || "Playtester"}</div>
                  <div className="text-xs text-muted-foreground">{g.format} · code {g.code}</div>
                </div>
                <Button variant="outline" size="sm" onClick={() => handleJoin(g.code)} disabled={!selected}>
                  Join
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function ForgeGameLobby(props: Props) {
  const { connectionBuilder } = useSpacetimeConnection();
  return (
    <SpacetimeProvider connectionBuilder={connectionBuilder}>
      <LobbyInner {...props} />
    </SpacetimeProvider>
  );
}
