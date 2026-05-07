'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { SpacetimeProvider } from '@/app/play/lib/spacetimedb-provider';
import type { DbConnection, ErrorContext } from '@/lib/spacetimedb/module_bindings';
import type { Identity } from 'spacetimedb';
import type { ConnectionHealthKind } from '@/app/play/lib/connectionResetDecision';

// Cooldown floor: at most one reset per 2 seconds. Matches the community
// provider's RECONNECT_COOLDOWN_MS. Prevents pile-on when multiple events
// (onDisconnect + visibilitychange + watchdog) all want to reset in quick
// succession.
const RECONNECT_COOLDOWN_MS = 2_000;

type ResetPhase = 'idle' | 'restarting';

// Importing DbConnectionBuilder type is awkward because the SDK doesn't
// re-export it cleanly; use a structural type matching what
// useSpacetimeConnection().connectionBuilder returns.
type ConnectionBuilder = {
  onConnect: (cb: (conn: DbConnection, identity: Identity, token: string) => void) => ConnectionBuilder;
  onDisconnect: (cb: () => void) => ConnectionBuilder;
  onConnectError: (cb: (ctx: ErrorContext, err: Error) => void) => ConnectionBuilder;
};

export interface ConnectionResetContextValue {
  /**
   * Force a connection reset. No-op if a reset is already in flight or if
   * the cooldown floor has not elapsed since the last reset. Returns
   * whether the reset was actually triggered.
   */
  triggerReset: (reason: string) => boolean;
  /**
   * Current connection health, derived from SpacetimeDB SDK callbacks.
   * 'live' = onConnect fired most recently.
   * 'dropped' = onDisconnect fired or reset is in flight.
   * 'down' = onConnectError fired.
   */
  connectionHealth: ConnectionHealthKind;
}

const Ctx = createContext<ConnectionResetContextValue | null>(null);

export function useConnectionReset(): ConnectionResetContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error(
      'useConnectionReset must be called inside <SpacetimeConnectionResetWrapper>'
    );
  }
  return ctx;
}

interface Props {
  connectionBuilder: ConnectionBuilder;
  children: ReactNode;
}

export function SpacetimeConnectionResetWrapper({ connectionBuilder, children }: Props) {
  const [providerInstanceId, setProviderInstanceId] = useState(0);
  const [resetPhase, setResetPhase] = useState<ResetPhase>('idle');
  const [connectionHealth, setConnectionHealth] = useState<ConnectionHealthKind>('dropped');
  const lastReconnectAtRef = useRef(0);

  // Mirror resetPhase into a ref so callbacks captured in useMemo (which has
  // [connectionBuilder] as deps and won't re-create when resetPhase changes)
  // can read the current value rather than a stale closure.
  const resetPhaseRef = useRef(resetPhase);
  useEffect(() => {
    resetPhaseRef.current = resetPhase;
  }, [resetPhase]);

  const triggerReset = useCallback(
    (reason: string): boolean => {
      const now = Date.now();
      if (resetPhaseRef.current === 'restarting') {
        console.log('[connection-reset] skip — already restarting; reason:', reason);
        return false;
      }
      if (now - lastReconnectAtRef.current < RECONNECT_COOLDOWN_MS) {
        console.log('[connection-reset] skip — cooldown; reason:', reason);
        return false;
      }
      console.log('[connection-reset] triggering reset; reason:', reason);
      lastReconnectAtRef.current = now;
      setConnectionHealth('dropped');
      setResetPhase('restarting');
      return true;
    },
    []
  );

  // After the wrapper renders `null` (because resetPhase === 'restarting'),
  // schedule a setTimeout(0) that bumps the provider key and returns to
  // 'idle'. The setTimeout(0) is the critical part: it lets the SDK's own
  // setTimeout(0) cleanup run between unmount and remount. Without this
  // gap, ConnectionManager.retain() cancels its own pendingRelease and
  // returns the cached dead connection.
  useEffect(() => {
    if (resetPhase !== 'restarting') return;
    const t = window.setTimeout(() => {
      setProviderInstanceId(n => n + 1);
      setResetPhase('idle');
    }, 0);
    return () => window.clearTimeout(t);
  }, [resetPhase]);

  // Augment the passed-in connectionBuilder with our own lifecycle callbacks.
  // The SDK supports multiple subscribers per event, so the existing
  // useSpacetimeConnection callbacks (which set its own isConnected state)
  // continue to fire alongside ours.
  const augmentedBuilder = useMemo(
    () =>
      connectionBuilder
        .onConnect(() => {
          setConnectionHealth('live');
        })
        .onDisconnect(() => {
          // Early-return BEFORE touching state when a reset is already in
          // flight. Otherwise an SDK disconnect that fires during our own
          // null-tick remount would pollute connectionHealth and trigger a
          // second reset on top of the first.
          if (resetPhaseRef.current === 'restarting') return;
          setConnectionHealth(prev => (prev === 'down' ? 'down' : 'dropped'));
          triggerResetRef.current('sdk onDisconnect');
        })
        .onConnectError((_ctx: ErrorContext, err: Error) => {
          console.error('[connection-reset] onConnectError:', err.message);
          setConnectionHealth('down');
          triggerResetRef.current('sdk onConnectError');
        }),
    [connectionBuilder]
  );

  // Stable ref to triggerReset so the callbacks above can call the latest
  // version without invalidating augmentedBuilder.
  const triggerResetRef = useRef(triggerReset);
  useEffect(() => {
    triggerResetRef.current = triggerReset;
  }, [triggerReset]);

  const ctxValue = useMemo<ConnectionResetContextValue>(
    () => ({ triggerReset, connectionHealth }),
    [triggerReset, connectionHealth]
  );

  const isProviderMounted = resetPhase === 'idle';

  return (
    <Ctx.Provider value={ctxValue}>
      {isProviderMounted ? (
        <SpacetimeProvider key={providerInstanceId} connectionBuilder={augmentedBuilder as any}>
          {children}
        </SpacetimeProvider>
      ) : null}
    </Ctx.Provider>
  );
}
