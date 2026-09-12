"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CardData } from "@/lib/cards/lookup";
import { cardNameKey } from "@/lib/cards/nameKey";
import { ALIAS_MAX_LENGTH } from "./lib/aliasShared";
import { validateAlias } from "./lib/validateAlias";
import { saveCardAlias, deleteCardAlias, type AliasRow } from "./actions";

/**
 * Aliases for the selected card: the short names people say ("LAFS") that
 * `[[mentions]]` in articles and deck descriptions should resolve to this
 * printing.
 *
 * Aliases are global — one alias names exactly one card — so this takes the
 * whole table, not just this card's rows: it needs to be able to say which
 * other card already claimed the name someone just typed.
 *
 * CatalogClient remounts this per card, so a half-typed draft and its error
 * never carry over to the next card the curator selects.
 */
export default function AliasEditor({
  card,
  aliases,
  pending,
  onChange,
}: {
  card: CardData;
  aliases: AliasRow[];
  /** Loose keys of aliases the running deploy does not serve yet. */
  pending: ReadonlySet<string>;
  onChange: (next: AliasRow[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mine = aliases.filter((a) => a.card_name === card.name && a.set_code === card.set);

  // Local pre-flight so a duplicate reads as a sentence before the round-trip;
  // the server action re-reads the table and re-validates regardless.
  const check = draft.trim() ? validateAlias(draft, aliases.map((a) => a.alias)) : null;
  const localError = check && check.ok === false ? check.error : null;
  const claimedBy = localError ? aliases.find((a) => cardNameKey(a.alias) === cardNameKey(draft)) : undefined;

  async function add() {
    setBusy(true);
    setError(null);
    const result = await saveCardAlias(card.name, card.set, draft);
    setBusy(false);
    if (result.ok === false) {
      setError(result.error);
      return;
    }
    setDraft("");
    onChange([...aliases, result.alias]);
  }

  async function remove(row: AliasRow) {
    setBusy(true);
    setError(null);
    const result = await deleteCardAlias(row.id);
    setBusy(false);
    if (result.ok === false) {
      setError(result.error);
      return;
    }
    onChange(aliases.filter((a) => a.id !== row.id));
  }

  return (
    <div className="space-y-2 rounded-md border border-border px-3 py-3">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Aliases</p>

      {mine.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No aliases yet. One here makes <code className="font-mono">[[that name]]</code> resolve to this printing.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {mine.map((row) => {
            const notYetLive = pending.has(cardNameKey(row.alias));
            return (
              <li key={row.id}>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm ${
                    notYetLive ? "bg-accent text-accent-foreground" : "bg-muted text-foreground"
                  }`}
                  title={
                    notYetLive
                      ? "Saved, but the deployed catalog does not serve it yet — see the Pending tab"
                      : "Live in the deployed catalog"
                  }
                >
                  <span className="font-mono">{row.alias}</span>
                  {notYetLive && <span className="text-[10px] uppercase tracking-wider">pending</span>}
                  <button
                    type="button"
                    onClick={() => remove(row)}
                    disabled={busy}
                    aria-label={`Remove alias ${row.alias}`}
                    title={`Remove alias ${row.alias}`}
                    // The chip is small and sits in a wrapping row; padding the
                    // glyph to 44px would wreck the layout. An invisible overlay
                    // grows the strike zone instead — the trick CardMention uses
                    // for the same problem mid-sentence.
                    className="relative text-muted-foreground transition-colors before:absolute before:-inset-3 before:content-[''] hover:text-destructive disabled:opacity-50"
                  >
                    &times;
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <Input
          value={draft}
          maxLength={ALIAS_MAX_LENGTH}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim() && !busy && !localError) {
              e.preventDefault();
              void add();
            }
          }}
          placeholder="Short name, e.g. LAFS"
          aria-label="New alias"
        />
        <Button onClick={add} disabled={busy || !draft.trim() || localError !== null}>
          {busy ? "Saving..." : "Add"}
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : localError ? (
        <p className="text-sm text-destructive">
          {localError}
          {claimedBy && ` — ${claimedBy.card_name} (${claimedBy.set_code})`}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          A new alias is live after <code className="font-mono">make pull-card-overrides</code>, a commit and a deploy.
        </p>
      )}
    </div>
  );
}
