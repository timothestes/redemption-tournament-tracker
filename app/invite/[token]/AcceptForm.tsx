"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { redeemInvite } from "@/app/forge/lib/members";

export default function AcceptForm({ token }: { token: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const agreed = text.trim().toLowerCase() === "i agree";

  async function accept() {
    setBusy(true);
    setFailed(false);
    const r = await redeemInvite(token, text);
    setBusy(false);
    if (r.ok) router.push("/forge/welcome");
    else setFailed(true);
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl" style={{ fontFamily: "Cinzel, serif" }}>
        Accept your Forge invite
      </h1>
      <div className="mt-4 rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Before you enter — an unofficial NDA</p>
        <p className="mt-2">
          The Forge holds unreleased, confidential card designs. By accepting, you agree not to
          share, screenshot, post, or otherwise disclose any unreleased card content — names, art,
          abilities, anything — outside the Forge until it is officially published.
        </p>
      </div>
      <label className="mt-4 block text-sm font-medium">
        Type <span className="font-semibold">I agree</span> to continue
        <input
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="I agree"
          autoComplete="off"
        />
      </label>
      {failed && (
        <p className="mt-3 text-sm text-muted-foreground">
          This invite link is invalid, expired, or already used. Ask whoever invited you for a fresh link.
        </p>
      )}
      <button
        onClick={accept}
        disabled={!agreed || busy}
        className="mt-4 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
      >
        {busy ? "Entering…" : "Accept & enter the Forge"}
      </button>
    </main>
  );
}
