'use client';

// Polyfill Promise.withResolvers for browsers that lack ES2024 support
// (Safari < 17.4, Chrome < 119, Firefox < 121).
// The SpacetimeDB SDK uses this internally in callReducer / callProcedure.
if (typeof Promise.withResolvers === 'undefined') {
  (Promise as any).withResolvers = function <T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: any) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

import { useCallback, useMemo, useState } from 'react';
import { DbConnection } from '@/lib/spacetimedb/module_bindings';
import type { Identity } from 'spacetimedb';

const SPACETIMEDB_HOST = process.env.NEXT_PUBLIC_SPACETIMEDB_HOST || 'ws://localhost:3000';
const SPACETIMEDB_DB_NAME = process.env.NEXT_PUBLIC_SPACETIMEDB_DB_NAME || 'redemption-multiplayer';
const TOKEN_KEY = 'spacetimedb_token';

export function useSpacetimeConnection() {
  const [isConnected, setIsConnected] = useState(false);

  const onConnect = useCallback((_c: DbConnection, _id: Identity, token: string) => {
    localStorage.setItem(TOKEN_KEY, token);
    setIsConnected(true);
  }, []);

  // Track the live-WS flag here too — the wrapper owns retry orchestration,
  // but consumers of this hook (GameInner, GameLobby) read `isConnected`
  // directly. Without our own onDisconnect, that flag would stick at `true`
  // after the first connect and never flip back. The SDK's EventEmitter
  // dedupes by callback identity (see EventEmitter.on at
  // node_modules/spacetimedb/src/sdk/event_emitter.ts:5-12), so the wrapper
  // attaching its own onDisconnect to the same builder doesn't conflict.
  // (Despite what the docstring on DbConnectionBuilder.onDisconnect claims,
  // the implementation does not throw on duplicate calls.)
  const onDisconnect = useCallback(() => {
    setIsConnected(false);
  }, []);

  // Factory: called fresh on every wrapper retry, so .withToken reads the
  // current localStorage value. The SDK's withToken() captures at builder
  // construction (see node_modules/spacetimedb/src/sdk/db_connection_builder.ts),
  // so a single memoized builder freezes the page-load token forever — bad
  // for reconnects after a 60s JWT expiry.
  //
  // onConnectError is intentionally NOT registered here — the wrapper owns
  // the retry/error UX and surfacing an error from this hook would risk
  // anyone gating on it from unmounting the wrapper (the original bug).
  const createBuilder = useCallback(
    () =>
      DbConnection.builder()
        .withUri(SPACETIMEDB_HOST)
        .withDatabaseName(SPACETIMEDB_DB_NAME)
        .withToken(
          (typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null) || undefined,
        )
        .onConnect(onConnect)
        .onDisconnect(onDisconnect),
    [onConnect, onDisconnect],
  );

  // Kept for GameLobby's pre-game SpacetimeProvider — the lobby has no
  // reset wrapper and uses a one-shot builder. `error` is a no-op shim
  // for backwards compatibility with the lobby's connError display.
  const connectionBuilder = useMemo(() => createBuilder(), [createBuilder]);

  return { createBuilder, connectionBuilder, isConnected, error: null as string | null };
}
