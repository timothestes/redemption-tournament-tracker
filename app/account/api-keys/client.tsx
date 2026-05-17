"use client";

import { useState, useTransition } from "react";
import { createApiKeyAction, revokeApiKeyAction } from "./actions";

export type ApiKeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

function maskedPrefix(p: string) {
  return `rtt_${p}…`;
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

async function copyToClipboard(value: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // fall through to manual fallback
    }
  }
  return false;
}

export function ApiKeysClient({ initialKeys }: { initialKeys: ApiKeyRow[] }) {
  const [keys, setKeys] = useState(initialKeys);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [newlyCreated, setNewlyCreated] = useState<{ fullKey: string; name: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const result = await createApiKeyAction(name);
      if (result.ok === false) {
        setError(result.error);
        return;
      }
      setName("");
      setShowCreate(false);
      setNewlyCreated({ fullKey: result.fullKey, name: result.name });
      setKeys((prev) => [
        {
          id: "pending",
          name: result.name,
          keyPrefix: result.prefix,
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
          revokedAt: null,
        },
        ...prev,
      ]);
    });
  }

  function handleRevoke(id: string) {
    if (!confirm("Revoke this API key? Active integrations using it will stop working.")) return;
    startTransition(async () => {
      const result = await revokeApiKeyAction(id);
      if (result.ok) {
        setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, revokedAt: new Date().toISOString() } : k)));
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            setShowCreate(true);
            setError(null);
          }}
          className="inline-flex h-9 items-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
          disabled={pending}
        >
          Create new key
        </button>
      </div>

      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-2">Name</th>
            <th>Prefix</th>
            <th>Created</th>
            <th>Last used</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {keys.length === 0 && (
            <tr>
              <td colSpan={6} className="py-6 text-center text-muted-foreground">
                No keys yet.
              </td>
            </tr>
          )}
          {keys.map((k) => (
            <tr key={k.id} className="border-t">
              <td className="py-2">{k.name}</td>
              <td className="font-mono">{maskedPrefix(k.keyPrefix)}</td>
              <td>{formatDate(k.createdAt)}</td>
              <td>{formatDate(k.lastUsedAt)}</td>
              <td>{k.revokedAt ? "Revoked" : "Active"}</td>
              <td className="text-right">
                {!k.revokedAt && (
                  <button
                    type="button"
                    onClick={() => handleRevoke(k.id)}
                    disabled={pending}
                    className="text-red-600 hover:underline"
                  >
                    Revoke
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showCreate && (
        <div className="rounded-md border bg-muted/30 p-4">
          <label className="mb-2 block text-sm font-medium">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. My Discord bot"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            maxLength={64}
          />
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={handleCreate}
              disabled={pending}
              className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCreate(false);
                setError(null);
                setName("");
              }}
              className="rounded-md border px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {newlyCreated && <RevealModal {...newlyCreated} onDismiss={() => setNewlyCreated(null)} />}
    </div>
  );
}

function RevealModal({
  fullKey,
  name,
  onDismiss,
}: {
  fullKey: string;
  name: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const ok = await copyToClipboard(fullKey);
    if (ok) {
      setCopied(true);
      return;
    }
    const input = document.getElementById("api-key-fallback") as HTMLInputElement | null;
    if (input) {
      input.focus();
      input.select();
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-lg rounded-md border bg-background p-6">
        <h2 className="mb-2 text-lg font-semibold">Copy your new key</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          This is the only time <strong>{name}</strong>'s full key will be displayed. If you
          dismiss this dialog without copying it, you will need to revoke and create a new one.
        </p>
        <input
          id="api-key-fallback"
          type="text"
          readOnly
          value={fullKey}
          className="w-full rounded-md border bg-muted px-3 py-2 font-mono text-sm"
          onFocus={(e) => e.currentTarget.select()}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" onClick={onDismiss} className="rounded-md border px-4 py-2 text-sm">
            I've copied it
          </button>
        </div>
      </div>
    </div>
  );
}
