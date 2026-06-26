"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { grantSet, revokeSet, type SetGrant } from "@/app/forge/lib/sets";

export default function PlaytesterGrants({
  setId,
  grants,
  grantable,
}: {
  setId: string;
  grants: SetGrant[];
  grantable: { userId: string; displayName: string | null }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pick, setPick] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, okMsg: string) {
    setMsg(null);
    startTransition(async () => {
      const r = await fn();
      setMsg(r.ok === false ? r.error : okMsg);
      if (r.ok) router.refresh();
    });
  }

  return (
    <section className="mt-8">
      <h2 className="text-lg font-medium">Playtesters</h2>
      <p className="text-sm text-muted-foreground">Members who can view this set's approved cards.</p>
      <ul className="mt-2 space-y-1 text-sm">
        {grants.length === 0 && <li className="text-muted-foreground">None yet.</li>}
        {grants.map((g) => (
          <li key={g.userId} className="flex items-center justify-between border-t py-2">
            <span>{g.displayName ?? <span className="text-muted-foreground">—</span>}</span>
            <button
              className="text-xs text-red-500 hover:underline"
              onClick={() => run(() => revokeSet(setId, g.userId), "Access revoked")}
              disabled={pending}
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>
      {grantable.length > 0 && (
        <div className="mt-3 flex items-end gap-2">
          <label className="text-sm">
            Grant a playtester
            <select
              className="mt-1 block rounded-md border bg-background px-2 py-1.5 text-sm"
              value={pick}
              onChange={(e) => setPick(e.target.value)}
            >
              <option value="">Select…</option>
              {grantable.map((m) => (
                <option key={m.userId} value={m.userId}>{m.displayName ?? m.userId}</option>
              ))}
            </select>
          </label>
          <button
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
            disabled={pending || !pick}
            onClick={() => run(() => grantSet(setId, pick), "Access granted")}
          >
            Grant
          </button>
        </div>
      )}
      {msg && <p aria-live="polite" className="mt-2 text-sm">{msg}</p>}
    </section>
  );
}
