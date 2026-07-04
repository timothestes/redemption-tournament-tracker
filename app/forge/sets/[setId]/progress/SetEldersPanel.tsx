"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addSetElder, removeSetElder, type SetElder } from "@/app/forge/lib/sets";

type MemberOpt = { userId: string; displayName: string | null };

export default function SetEldersPanel({ setId, elders, addable }: { setId: string; elders: SetElder[]; addable: MemberOpt[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (r.ok) router.refresh(); else alert(r.error);
  };
  return (
    <div className="rounded-md border p-3 text-sm">
      <p className="mb-2 font-medium">Designers</p>
      <ul className="space-y-1">
        {elders.map((e) => (
          <li key={e.userId} className="flex items-center justify-between">
            <span>{e.displayName ?? e.userId}</span>
            {elders.length > 1 && (
              <button disabled={busy} onClick={() => run(() => removeSetElder(setId, e.userId))} className="text-xs text-destructive hover:underline">remove</button>
            )}
          </li>
        ))}
      </ul>
      {addable.length > 0 && (
        <select disabled={busy} defaultValue="" onChange={(e) => e.target.value && run(() => addSetElder(setId, e.target.value))} className="mt-2 rounded-md border bg-background px-2 py-1 text-xs">
          <option value="" disabled>Add a designer…</option>
          {addable.map((m) => <option key={m.userId} value={m.userId}>{m.displayName ?? m.userId}</option>)}
        </select>
      )}
    </div>
  );
}
