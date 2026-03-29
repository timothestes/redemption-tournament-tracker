'use client';

import { useMemo, useState, useCallback } from 'react';
import { DbConnection } from '@/lib/spacetimedb/module_bindings';

const SPACETIMEDB_HOST = process.env.NEXT_PUBLIC_SPACETIMEDB_HOST || 'ws://localhost:3000';
const SPACETIMEDB_DB_NAME = process.env.NEXT_PUBLIC_SPACETIMEDB_DB_NAME || 'redemption-multiplayer';
const TOKEN_KEY = 'spacetimedb_token';

export function useSpacetimeConnection() {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onConnect = useCallback((_conn: DbConnection, _identity: any, token: string) => {
    console.log('[game-debug] onConnect — identity:', _identity?.toHexString?.());
    localStorage.setItem(TOKEN_KEY, token);
    setIsConnected(true);
    setError(null);
  }, []);

  const onDisconnect = useCallback(() => {
    console.log('[game-debug] onDisconnect fired');
    setIsConnected(false);
  }, []);

  const onConnectError = useCallback((e: any) => {
    console.log('[game-debug] onConnectError:', e?.message);
    setError(e?.message || 'Connection failed');
    setIsConnected(false);
  }, []);

  // CRITICAL: memoize to prevent reconnects on re-render
  const connectionBuilder = useMemo(
    () =>
      DbConnection.builder()
        .withUri(SPACETIMEDB_HOST)
        .withDatabaseName(SPACETIMEDB_DB_NAME)
        .withToken((typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null) || undefined)
        .onConnect(onConnect)
        .onDisconnect(onDisconnect)
        .onConnectError(onConnectError),
    [] // empty deps — create once
  );

  return { connectionBuilder, isConnected, error };
}
