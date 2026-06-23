"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCard, uploadArt, setPlaceholder, type ForgeCardRow } from "@/app/forge/lib/cards";

export default function ArtPanel({ cards }: { cards: ForgeCardRow[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function onCreate() {
    setError(null);
    const res = await createCard(title);
    if (res.ok === false) { setError(res.error); return; }
    setTitle("");
    refresh();
  }

  async function onUpload(cardId: string, file: File) {
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    const res = await uploadArt(cardId, fd);
    if (!res.ok) return setError(res.error ?? "Upload failed");
    refresh();
  }

  async function onTogglePlaceholder(card: ForgeCardRow) {
    setError(null);
    const res = await setPlaceholder(card.id, !card.working_art_is_placeholder);
    if (!res.ok) return setError(res.error ?? "Update failed");
    refresh();
  }

  return (
    <div className="mt-6 space-y-6">
      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New card title (optional)"
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
        />
        <button
          onClick={onCreate}
          disabled={pending}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          New card
        </button>
      </div>

      {cards.length === 0 && <p className="text-sm text-muted-foreground">No cards yet.</p>}

      <ul className="space-y-4">
        {cards.map((card) => (
          <li key={card.id} className="rounded-lg border p-4">
            <div className="flex items-start gap-4">
              <div className="relative h-40 w-28 shrink-0 overflow-hidden rounded-md border bg-muted">
                {card.working_art_key ? (
                  // Plain <img> ONLY — next/image is banned under app/forge (see guardrail test).
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/forge/api/art/${card.id}`}
                    alt={card.title ?? "card art"}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                    No art
                  </div>
                )}
                {card.working_art_is_placeholder && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40">
                    <span className="rotate-[-20deg] text-xs font-bold tracking-widest text-white">
                      PLACEHOLDER
                    </span>
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1 space-y-2">
                <p className="truncate font-medium">{card.title ?? "Untitled"}</p>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onUpload(card.id, f);
                    e.target.value = "";
                  }}
                  className="block w-full text-xs"
                />
                <div className="flex flex-wrap gap-3 text-sm">
                  <button onClick={() => onTogglePlaceholder(card)} className="text-emerald-600 hover:underline">
                    {card.working_art_is_placeholder ? "Unmark placeholder" : "Mark placeholder"}
                  </button>
                  {card.working_art_key && (
                    <a href={`/forge/api/art/${card.id}?download=1`} className="text-emerald-600 hover:underline">
                      Download original
                    </a>
                  )}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
