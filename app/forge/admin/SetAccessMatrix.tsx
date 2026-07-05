"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { grantSet, revokeSet } from "@/app/forge/lib/sets";
import { grantKey, buildGrantKeySet } from "@/app/forge/lib/setAccess";

type Playtester = { userId: string; displayName: string | null };

export default function SetAccessMatrix({
  playtesters,
  sets,
  grants,
}: {
  playtesters: Playtester[];
  sets: { id: string; name: string }[];
  grants: { setId: string; userId: string }[];
}) {
  const [granted, setGranted] = useState<Set<string>>(() => buildGrantKeySet(grants));
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [msg, setMsg] = useState<string | null>(null);

  async function toggle(userId: string, setId: string) {
    const key = grantKey(userId, setId);
    if (pending.has(key)) return;
    const wasGranted = granted.has(key);
    setMsg(null);
    // Optimistic flip.
    setGranted((prev) => {
      const next = new Set(prev);
      if (wasGranted) next.delete(key);
      else next.add(key);
      return next;
    });
    setPending((prev) => new Set(prev).add(key));

    const r = wasGranted ? await revokeSet(setId, userId) : await grantSet(setId, userId);

    setPending((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    if (r.ok === false) {
      // Revert on failure.
      setGranted((prev) => {
        const next = new Set(prev);
        if (wasGranted) next.add(key);
        else next.delete(key);
        return next;
      });
      setMsg(r.error);
    }
  }

  return (
    <section>
      <h2 className="text-lg font-medium">Set access</h2>
      <p className="text-sm text-muted-foreground">
        Which playtesters can view each set&apos;s playtest cards. Toggle to grant or revoke.
      </p>
      {sets.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No sets yet.</p>
      ) : playtesters.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No playtesters yet.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-3 font-normal">Playtester</th>
                {sets.map((s) => (
                  <th key={s.id} className="px-3 py-1 text-center font-normal">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {playtesters.map((p) => (
                <tr key={p.userId} className="border-t">
                  <td className="py-2 pr-3">
                    {p.displayName ?? <span className="text-muted-foreground">—</span>}
                  </td>
                  {sets.map((s) => {
                    const key = grantKey(p.userId, s.id);
                    return (
                      <td key={s.id} className="px-3 py-2 text-center">
                        <Checkbox
                          className="align-middle disabled:cursor-wait"
                          checked={granted.has(key)}
                          disabled={pending.has(key)}
                          onCheckedChange={() => toggle(p.userId, s.id)}
                          aria-label={`Grant ${p.displayName ?? "playtester"} access to ${s.name}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {msg && (
        <p aria-live="polite" className="mt-2 text-sm">
          {msg}
        </p>
      )}
    </section>
  );
}
