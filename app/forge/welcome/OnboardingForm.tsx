"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { setProfile } from "@/app/forge/lib/members";

export default function OnboardingForm() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAvatar(file: File) {
    const supabase = createClient();
    const fileName = `forge-${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage.from("avatars").upload(fileName, file);
    if (upErr) return setError("Avatar upload failed");
    const {
      data: { publicUrl },
    } = supabase.storage.from("avatars").getPublicUrl(fileName);
    setAvatarUrl(publicUrl);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await setProfile({ displayName, avatarUrl });
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "Could not save");
    router.push("/forge");
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4">
      <label className="block text-sm font-medium">
        Display name
        <input
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={60}
          required
        />
      </label>
      <label className="block text-sm font-medium">
        Avatar (optional)
        <input
          type="file"
          accept="image/*"
          className="mt-1 block w-full text-sm"
          onChange={(e) => e.target.files?.[0] && handleAvatar(e.target.files[0])}
        />
      </label>
      {avatarUrl && <img src={avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" />}
      {error && <p className="text-sm text-red-500">{error}</p>}
      <button
        type="submit"
        disabled={busy || !displayName.trim()}
        className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
      >
        {busy ? "Saving…" : "Enter the Forge"}
      </button>
    </form>
  );
}
