"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSet, type ForgeSetSummary } from "@/app/forge/lib/sets";

export default function SetsIndex({ sets, canCreate }: { sets: ForgeSetSummary[]; canCreate: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const r = await createSet(name.trim());
    setBusy(false);
    if (r.ok) router.push(`/forge/sets/${r.id}/cards`);
    else alert(r.error);
  }

  return (
    <div className="mx-auto max-w-3xl p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Sets</h1>
        {canCreate && (
          <form onSubmit={onCreate} className="flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New set name…" className="rounded-md border bg-background px-3 py-1.5 text-sm" />
            <button disabled={busy} className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">Create</button>
          </form>
        )}
      </div>
      {sets.length === 0 ? (
        <div className="mx-auto mt-16 max-w-xs text-center">
          <div className="mx-auto mb-4 aspect-[750/1050] w-40 rounded-lg border-2 border-dashed" />
          <p className="text-sm text-muted-foreground">No sets yet. Create one to gather cards toward print.</p>
        </div>
      ) : (
        <ul className="divide-y rounded-md border">
          {sets.map((s) => (
            <li key={s.id}>
              <Link href={`/forge/sets/${s.id}/cards`} className="flex items-center justify-between p-3 hover:bg-muted/50">
                <span className="font-medium">{s.name}</span>
                <span className="text-sm text-muted-foreground">
                  {s.total}{s.targetTotal ? ` / ${s.targetTotal}` : ""} cards
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
