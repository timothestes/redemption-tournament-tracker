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
import { resolveLobbyPath } from '@/app/play/lib/lobbyPath';
import type { DbConnection, ErrorContext } from '@/lib/spacetimedb/module_bindings';
import type { Identity } from 'spacetimedb';
import type { ConnectionHealthKind } from '@/app/play/lib/connectionResetDecision';

// Exponential backoff in ms. After MAX_ATTEMPTS we surface the fatal
// "manual retry" screen — gives the user agency to wait it out (browser
// network came back) or bail to the lobby.
const BACKOFF_MS = [0, 500, 1_000, 2_000, 4_000, 8_000, 15_000, 30_000];
const MAX_ATTEMPTS = 8;

type ResetPhase = 'idle' | 'restarting';

// Structural type matching the SDK's DbConnectionBuilder shape we use.
// The SDK's EventEmitter dedupes by callback identity, so multiple
// onConnect/onDisconnect/onConnectError handlers on the same builder
// coexist — each unique callback fires. (The SDK docstring claims
// onDisconnect throws on duplicate calls, but the implementation does
// not — it just calls Set.add().) The hook attaches onConnect +
// onDisconnect for its own state tracking; this wrapper additionally
// attaches all three for retry orchestration.
type ConnectionBuilder = {
  onConnect: (cb: (conn: DbConnection, identity: Identity, token: string) => void) => ConnectionBuilder;
  onDisconnect: (cb: (ctx: any, err?: Error) => void) => ConnectionBuilder;
  onConnectError: (cb: (ctx: ErrorContext, err: Error) => void) => ConnectionBuilder;
};

export interface ConnectionResetContextValue {
  /**
   * Schedule a reconnect attempt. No-op if a retry is already in flight,
   * if we've given up after MAX_ATTEMPTS, or during the restart tick.
   * Returns whether the schedule actually happened.
   */
  triggerReset: (reason: string) => boolean;
  connectionHealth: ConnectionHealthKind;
  /** True once MAX_ATTEMPTS consecutive failures have occurred. */
  gaveUp: boolean;
  /** User-initiated retry — resets attempt counter and kicks one immediate attempt. */
  manualRetry: () => void;
}

const Ctx = createContext<ConnectionResetContextValue | null>(null);

export function useConnectionReset(): ConnectionResetContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error(
      'useConnectionReset must be called inside <SpacetimeConnectionResetWrapper>',
    );
  }
  return ctx;
}

interface Props {
  /**
   * Factory returning a fresh DbConnectionBuilder. Called once per retry,
   * so each attempt re-reads the latest token from localStorage.
   */
  createBuilder: () => ConnectionBuilder;
  children: ReactNode;
}

export function SpacetimeConnectionResetWrapper({ createBuilder, children }: Props) {
  const [providerInstanceId, setProviderInstanceId] = useState(0);
  // Initial phase is 'restarting' (not 'idle') so the existing setTimeout(0)
  // choreography defers the first SpacetimeProvider mount by one tick. This
  // lets any prior provider's pendingRelease (e.g. lobby → game navigation
  // in the same tab) actually fire BEFORE our retain(), guaranteeing a fresh
  // build with our callbacks. Without this, ConnectionManager.retain()
  // cache-hits the lobby's connection and discards our builder — the
  // wrapper's onConnect/onDisconnect/onConnectError never attach to the live
  // connection, and we silently miss disconnects.
  const [resetPhase, setResetPhase] = useState<ResetPhase>('restarting');
  const [connectionHealth, setConnectionHealth] = useState<ConnectionHealthKind>('dropped');
  const [gaveUp, setGaveUp] = useState(false);

  const attemptRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const resetPhaseRef = useRef(resetPhase);
  const gaveUpRef = useRef(gaveUp);
  useEffect(() => {
    resetPhaseRef.current = resetPhase;
  }, [resetPhase]);
  useEffect(() => {
    gaveUpRef.current = gaveUp;
  }, [gaveUp]);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  // Imperatively kick a remount cycle (preserves the 0ms-tick choreography
  // documented in the effect below — lets the SDK's pendingRelease run
  // before retain() so we don't get the cached dead connection back).
  const performReset = useCallback(() => {
    if (resetPhaseRef.current === 'restarting') return;
    setConnectionHealth('dropped');
    setResetPhase('restarting');
  }, []);

  const triggerReset = useCallback(
    (reason: string): boolean => {
      if (gaveUpRef.current) {
        console.log('[connection-reset] skip — gaveUp; reason:', reason);
        return false;
      }
      if (resetPhaseRef.current === 'restarting' || retryTimerRef.current !== null) {
        console.log('[connection-reset] skip — already in flight; reason:', reason);
        return false;
      }
      if (attemptRef.current >= MAX_ATTEMPTS) {
        console.warn(
          '[connection-reset] gave up after',
          attemptRef.current,
          'attempts; reason:',
          reason,
        );
        setGaveUp(true);
        return false;
      }
      const delay = BACKOFF_MS[Math.min(attemptRef.current, BACKOFF_MS.length - 1)];
      attemptRef.current += 1;
      console.log('[connection-reset] schedule retry', {
        attempt: attemptRef.current,
        delay,
        reason,
      });
      retryTimerRef.current = window.setTimeout(() => {
        // Close the race: flip phase to 'restarting' (via performReset)
        // BEFORE nulling the timer ref. Otherwise a concurrent triggerReset
        // (e.g. visibility resume firing in the same tick) sees both
        // resetPhase==='idle' AND retryTimerRef===null and schedules a
        // duplicate retry that burns an extra attempt slot.
        performReset();
        retryTimerRef.current = null;
      }, delay);
      return true;
    },
    [performReset],
  );

  // Stable ref for triggerReset so the SDK callbacks below don't capture
  // a stale closure.
  const triggerResetRef = useRef(triggerReset);
  useEffect(() => {
    triggerResetRef.current = triggerReset;
  }, [triggerReset]);

  const manualRetry = useCallback(() => {
    clearRetryTimer();
    attemptRef.current = 0;
    setGaveUp(false);
    performReset();
  }, [clearRetryTimer, performReset]);

  // Cleanup on unmount — prevents zombie retries after navigation away.
  useEffect(() => clearRetryTimer, [clearRetryTimer]);

  // Build the augmented builder fresh each remount so createBuilder()
  // re-reads the token (handles 60s JWT expiry between attempts).
  const augmentedBuilder = useMemo(
    () => {
      return createBuilder()
        .onConnect(() => {
          attemptRef.current = 0;
          clearRetryTimer();
          setConnectionHealth('live');
        })
        .onDisconnect((_ctx, err) => {
          // SDK disconnect that fires during our own remount tick is
          // benign — guard before mutating state or scheduling.
          if (resetPhaseRef.current === 'restarting') return;
          setConnectionHealth((prev) => (prev === 'down' ? 'down' : 'dropped'));
          triggerResetRef.current(`sdk onDisconnect${err ? `: ${err.message}` : ''}`);
        })
        .onConnectError((_ctx, err) => {
          // ErrorContext.event is typed `Error | undefined` (not a CloseEvent),
          // and the SDK discards WS close code/reason before emit (see
          // db_connection_impl.ts onclose handler). So this log captures
          // only what the SDK actually exposes: err.message + err.name.
          // If we ever need close codes for diagnostics, a vendored SDK
          // patch is the only path — tracked in
          // docs/superpowers/specs/2026-05-24-multiplayer-reconnect-followups.md.
          console.warn('[connection-reset] onConnectError', {
            message: err?.message,
            name: err?.name,
            attempt: attemptRef.current,
          });
          setConnectionHealth('down');
          triggerResetRef.current(`sdk onConnectError: ${err?.message ?? '<empty>'}`);
        });
    },
    // providerInstanceId in deps so each remount rebuilds with a fresh token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [createBuilder, providerInstanceId],
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
      setProviderInstanceId((n) => n + 1);
      setResetPhase('idle');
    }, 0);
    return () => window.clearTimeout(t);
  }, [resetPhase]);

  const ctxValue = useMemo<ConnectionResetContextValue>(
    () => ({ triggerReset, connectionHealth, gaveUp, manualRetry }),
    [triggerReset, connectionHealth, gaveUp, manualRetry],
  );

  const isProviderMounted = resetPhase === 'idle';

  return (
    <Ctx.Provider value={ctxValue}>
      {isProviderMounted && (
        <SpacetimeProvider
          key={providerInstanceId}
          connectionBuilder={augmentedBuilder as any}
        >
          {children}
        </SpacetimeProvider>
      )}
      {gaveUp && <FatalConnectionScreen onRetry={manualRetry} />}
    </Ctx.Provider>
  );
}

// Inline — single-use, no abstraction needed. Markup mirrors the old
// fatal screen from app/play/[code]/client.tsx so the look is preserved.
function FatalConnectionScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex min-h-screen items-center justify-center bg-background/95 backdrop-blur-sm px-4">
      <div className="rounded-lg border border-border bg-card/95 p-8 text-center max-w-sm">
        <div className="mb-4 flex justify-center">
          <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-muted-foreground"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
              />
            </svg>
          </div>
        </div>
        <p className="text-lg font-semibold font-cinzel mb-2">Connection lost</p>
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t reconnect after several attempts. Check your network and try again,
          or head back to the lobby.
        </p>
        <div className="mt-6 flex flex-col sm:flex-row gap-2 justify-center">
          <button
            onClick={onRetry}
            className="rounded-md border border-border bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Try again
          </button>
          <a
            href="/play"
            onClick={(e) => { e.preventDefault(); window.location.href = resolveLobbyPath(); }}
            className="rounded-md border border-border px-5 py-2.5 text-sm font-medium hover:bg-muted transition-colors"
          >
            Back to lobby
          </a>
        </div>
      </div>
    </div>
  );
}
