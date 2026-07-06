"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Globe } from "lucide-react";
import { setSetPrivacy } from "@/app/forge/lib/sets";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";

export default function SetPrivacyPanel({ setId, isPrivate }: { setId: string; isPrivate: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply(next: boolean) {
    setBusy(true);
    setError(null);
    const r = await setSetPrivacy(setId, next);
    setBusy(false);
    if (r.ok === false) { setError(r.error); return; }
    router.refresh();
  }

  return (
    <div className="rounded-md border p-3 text-sm">
      <p className="mb-1 flex items-center gap-1.5 font-medium">
        {isPrivate ? <Lock size={14} aria-hidden /> : <Globe size={14} aria-hidden />}
        {isPrivate ? "Private set" : "Visible to all elders"}
      </p>
      <p className="mb-2 text-xs text-muted-foreground">
        {isPrivate
          ? "Only superadmins and the designers listed below can see or edit this set."
          : "Every elder can see and design in this set."}
      </p>
      {isPrivate ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => apply(false)}
          className="rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
        >
          Make visible to all elders
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirmOpen(true)}
          className="rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
        >
          Make private
        </button>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <ConfirmationDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={() => apply(true)}
        title="Make this set private?"
        description="Other elders will lose access to this set unless you add them as designers below. Superadmins keep access."
        confirmLabel="Make private"
      />
    </div>
  );
}
