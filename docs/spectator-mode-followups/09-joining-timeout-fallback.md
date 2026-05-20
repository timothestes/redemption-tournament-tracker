# 09 — No 12s timeout fallback in `joining` on spectator route

**Priority:** High
**Effort:** S
**Status:** TODO

## Problem

The spectator route has zero `setTimeout` calls. The player route has a 12-second fallback that transitions to an error state if the phase-1 subscription never applies — spectator was missed.

If the phase-1 subscription never applies (cellular jitter, server hiccup, slow network), the spectator sees the loading spinner forever with no recovery short of refresh.

## Why it matters

**Mobile tournament use case directly hits this.** CLAUDE.md: "mobile usage is high — players at tables checking standings on their phones." Convention center cellular is notoriously bad. Reviewer B upgraded Medium → High specifically because the target use case amplifies this.

## Code references

- [app/play/spectate/[code]/client.tsx](../../app/play/spectate/[code]/client.tsx) — spectator client (no `setTimeout` anywhere)
- [app/play/[code]/client.tsx:643-650](../../app/play/[code]/client.tsx#L643-L650) — player route's 12s fallback pattern (copy-target)

## Fix sketch

Port the player route's pattern verbatim. In the `joining` lifecycle state, set a 12s timeout; on expiry, transition to `'error'` with a retry CTA.

Pseudo-shape:

```ts
useEffect(() => {
  if (lifecycle !== 'joining') return;
  const t = setTimeout(() => {
    setLifecycle('error');
    setErrorMessage('Took too long to connect — try again.');
  }, 12000);
  return () => clearTimeout(t);
}, [lifecycle]);
```

## Notes

- Pair with [05](05-reconnect-didcallreducer.md) — both are about graceful recovery from mobile network issues. Together they replace force-refresh recovery with explicit retry UX.
- The fallback duration (12s) matches the player route by convention; revisit if it feels too slow/fast.
