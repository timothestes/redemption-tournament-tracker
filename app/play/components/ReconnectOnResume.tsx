'use client';

import { useEffect, useRef } from 'react';
import { useSpacetimeDB } from 'spacetimedb/react';
import type { DbConnection } from '@/lib/spacetimedb/module_bindings';
import { useConnectionReset } from './SpacetimeConnectionResetWrapper';
import {
  shouldRequireResetWithoutPing,
  shouldRequirePingCheck,
} from '@/app/play/lib/connectionResetDecision';

const PING_TIMEOUT_MS = 5_000;

/**
 * Listens for visibilitychange / focus. On return-to-visible, decides
 * whether to ping the server, reset the connection, or do nothing.
 *
 * Must render inside <SpacetimeConnectionResetWrapper> (for triggerReset)
 * AND inside <SpacetimeProvider> (for getConnection().procedures.ping).
 */
export default function ReconnectOnResume() {
  const { triggerReset, connectionHealth } = useConnectionReset();
  const spacetimeCtx = useSpacetimeDB() as any;
  const lastHiddenAtRef = useRef<number | null>(null);
  // Stable refs so the effect below has empty deps (event listeners must
  // not be re-attached on every render).
  const triggerResetRef = useRef(triggerReset);
  const connectionHealthRef = useRef(connectionHealth);
  const getConnectionRef = useRef<() => DbConnection | null>(
    () => spacetimeCtx?.getConnection?.() ?? null
  );

  useEffect(() => {
    triggerResetRef.current = triggerReset;
  }, [triggerReset]);
  useEffect(() => {
    connectionHealthRef.current = connectionHealth;
  }, [connectionHealth]);
  useEffect(() => {
    getConnectionRef.current = () => spacetimeCtx?.getConnection?.() ?? null;
  }, [spacetimeCtx]);

  useEffect(() => {
    let cancelled = false;

    async function handleResume() {
      if (document.visibilityState !== 'visible') return;

      const hiddenDuration = lastHiddenAtRef.current
        ? Date.now() - lastHiddenAtRef.current
        : 0;
      lastHiddenAtRef.current = null;
      const kind = connectionHealthRef.current;

      // Path 1: connection isn't live → reset immediately.
      if (shouldRequireResetWithoutPing({ kind })) {
        triggerResetRef.current('visibility resume — connection not live');
        return;
      }

      // Path 2: connection is live but we were hidden long enough that a
      // silent zombie WS is plausible → ping to verify.
      if (!shouldRequirePingCheck({ kind, hiddenDurationMs: hiddenDuration })) {
        return; // tab was visible recently — trust the existing connection
      }

      const conn = getConnectionRef.current();
      if (!conn) {
        triggerResetRef.current('visibility resume — no connection available');
        return;
      }

      try {
        const pingResult = await Promise.race([
          (conn as any).procedures.ping({}) as Promise<string>,
          new Promise<null>(resolve =>
            setTimeout(() => resolve(null), PING_TIMEOUT_MS)
          ),
        ]);

        if (cancelled) return;

        if (pingResult !== 'pong') {
          triggerResetRef.current(
            pingResult === null
              ? 'visibility resume — ping timeout'
              : 'visibility resume — ping returned unexpected value'
          );
        }
        // Otherwise: ping succeeded; connection is verified live. Do nothing.
      } catch (err) {
        if (cancelled) return;
        triggerResetRef.current(
          `visibility resume — ping threw: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        lastHiddenAtRef.current = Date.now();
      } else {
        void handleResume();
      }
    }

    function handleFocus() {
      void handleResume();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  return null;
}
