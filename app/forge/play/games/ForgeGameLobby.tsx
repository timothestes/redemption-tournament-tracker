"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTable } from "spacetimedb/react";
import { tables } from "@/lib/spacetimedb/module_bindings";
import { useSpacetimeConnection } from "@/app/play/hooks/useSpacetimeConnection";
import { SpacetimeProvider } from "@/app/play/lib/spacetimedb-provider";
import type { ForgeDeckSummary } from "@/app/forge/lib/deckTypes";

interface Props { decks: ForgeDeckSummary[]; displayName: string; userId: string }

function LobbyInner({ decks, displayName, userId }: Props) {
  const router = useRouter();
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(decks[0]?.id ?? null);
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const selected = decks.find((d) => d.id === selectedDeckId) ?? null;

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
        <p className="text-sm text-muted-foreground">Private games with your Forge decks. Only members you share a code with (or listed below) can play.</p>
      </div>
      {error && <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">{error}</div>}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Your deck</h2>
        {decks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Forge decks yet — build one first.</p>
        ) : (
          <select
            className="w-full rounded-md border bg-background p-2 text-sm"
            value={selectedDeckId ?? ""}
            onChange={(e) => setSelectedDeckId(e.target.value)}
          >
            {decks.map((d) => (
              <option key={d.id} value={d.id}>{d.name} — {d.format || "Type 1"} ({d.cardCount})</option>
            ))}
          </select>
        )}
      </section>
      <section className="grid gap-3 sm:grid-cols-2">
        <button onClick={handleCreate} disabled={!selected} className="rounded-lg border p-4 text-left hover:bg-muted/50 disabled:opacity-50">
          <div className="font-medium">Host a game</div>
          <div className="text-sm text-muted-foreground">Get a code to share with another playtester.</div>
        </button>
        <div className="rounded-lg border p-4">
          <div className="font-medium">Join by code</div>
          <div className="mt-2 flex gap-2">
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              maxLength={4}
              placeholder="CODE"
              className="w-24 rounded-md border bg-background p-2 text-sm uppercase tracking-widest"
            />
            <button onClick={() => handleJoin(joinCode)} disabled={!selected || joinCode.trim().length !== 4} className="rounded-md border px-3 text-sm hover:bg-muted/50 disabled:opacity-50">Join</button>
          </div>
        </div>
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Open playtest games</h2>
        {openGames.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody is waiting right now.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {openGames.map((g) => (
              <li key={String(g.id)} className="flex items-center justify-between gap-2 p-3">
                <div>
                  <div className="text-sm font-medium">{g.createdByName || "Playtester"}</div>
                  <div className="text-xs text-muted-foreground">{g.format} · code {g.code}</div>
                </div>
                <button onClick={() => handleJoin(g.code)} disabled={!selected} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted/50 disabled:opacity-50">Join</button>
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
