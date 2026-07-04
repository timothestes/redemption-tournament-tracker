"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ADMIN_PERMISSIONS, ADMIN_PERMISSION_KEYS } from "./lib/permissions";
import {
  removeAdmin,
  searchUsers,
  setAdminPermissions,
  type AdminRow,
  type UserHit,
} from "./actions";
import { changeRole, removeMember } from "@/app/forge/lib/members";

export type ForgeMemberRow = {
  user_id: string;
  role: "superadmin" | "elder" | "playtester";
  display_name: string | null;
  created_at: string;
};

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

export default function PermissionsPortal({
  initialAdmins,
  forgeMembers,
  selfId,
}: {
  initialAdmins: AdminRow[];
  forgeMembers: ForgeMemberRow[];
  selfId: string;
}) {
  const router = useRouter();
  const [admins, setAdmins] = useState<AdminRow[]>(initialAdmins);
  const [edits, setEdits] = useState<Record<string, string[]>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Add-admin search
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<UserHit[]>([]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      const results = await searchUsers(q);
      setHits(results);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const rowPerms = (row: AdminRow): string[] => edits[row.user_id] ?? row.permissions;
  const isDirty = (row: AdminRow): boolean =>
    edits[row.user_id] !== undefined && !sameSet(edits[row.user_id], row.permissions);

  const toggle = (row: AdminRow, key: string) => {
    const current = rowPerms(row);
    const next = current.includes(key)
      ? current.filter((k) => k !== key)
      : [...current, key];
    setEdits((e) => ({ ...e, [row.user_id]: next }));
  };

  const save = async (row: AdminRow) => {
    setBusyId(row.user_id);
    setError(null);
    // Save writes exactly the checked catalog keys; unknown strings are dropped
    // (the row shows a warning chip beforehand so the drop is never silent).
    const next = rowPerms(row).filter((k) => ADMIN_PERMISSION_KEYS.includes(k));
    const r = await setAdminPermissions(row.user_id, next);
    if (r.ok === false) {
      setError(r.error ?? "Save failed");
    } else {
      setAdmins((rows) =>
        rows.map((a) => (a.user_id === row.user_id ? { ...a, permissions: next } : a))
      );
      setEdits((e) => {
        const { [row.user_id]: _, ...rest } = e;
        return rest;
      });
    }
    setBusyId(null);
  };

  const remove = async (row: AdminRow) => {
    const warning =
      row.user_id === selfId
        ? "This is YOUR admin row — removing it drops your own page permissions (the portal itself stays accessible). Remove?"
        : `Remove all admin permissions for ${row.username ?? row.email ?? row.user_id}?`;
    if (!window.confirm(warning)) return;
    setBusyId(row.user_id);
    setError(null);
    const r = await removeAdmin(row.user_id);
    if (r.ok === false) {
      setError(r.error ?? "Remove failed");
    } else {
      setAdmins((rows) => rows.filter((a) => a.user_id !== row.user_id));
    }
    setBusyId(null);
  };

  const addAdmin = (hit: UserHit) => {
    setQuery("");
    setHits([]);
    if (admins.some((a) => a.user_id === hit.user_id)) return;
    setAdmins((rows) => [
      ...rows,
      {
        user_id: hit.user_id,
        username: hit.username,
        email: hit.email,
        permissions: [],
        created_at: "",
      },
    ]);
    setEdits((e) => ({ ...e, [hit.user_id]: [] }));
  };

  // Forge section --------------------------------------------------------------
  const [forgeBusyId, setForgeBusyId] = useState<string | null>(null);

  const changeForgeRole = async (m: ForgeMemberRow, newRole: "elder" | "playtester") => {
    setForgeBusyId(m.user_id);
    setError(null);
    const r = await changeRole(m.user_id, newRole);
    if (r.ok === false) setError(r.error ?? "Role change failed");
    router.refresh();
    setForgeBusyId(null);
  };

  const removeForgeMember = async (m: ForgeMemberRow) => {
    if (
      !window.confirm(
        `Remove ${m.display_name ?? m.user_id} from the Forge? Their cards are reassigned per Forge rules.`
      )
    )
      return;
    setForgeBusyId(m.user_id);
    setError(null);
    const r = await removeMember(m.user_id);
    if (r.ok === false) setError(r.error ?? "Remove failed");
    router.refresh();
    setForgeBusyId(null);
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 space-y-10">
      <header>
        <h1 className="text-2xl font-semibold">Permissions</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Superuser portal — manage app admins and Forge member roles.
        </p>
      </header>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/40 dark:border-red-900 px-4 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* App admins ---------------------------------------------------------- */}
      <section className="space-y-4">
        <h2 className="text-lg font-medium">App admins</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left">
                <th className="px-3 py-2 font-medium">User</th>
                {ADMIN_PERMISSIONS.map((p) => (
                  <th key={p.key} className="px-2 py-2 font-medium text-center whitespace-nowrap">
                    {p.label}
                  </th>
                ))}
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {admins.map((row) => {
                const unknown = row.permissions.filter(
                  (k) => !ADMIN_PERMISSION_KEYS.includes(k)
                );
                return (
                  <tr key={row.user_id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.username ?? "(no username)"}</div>
                      <div className="text-xs text-muted-foreground">{row.email}</div>
                      {unknown.length > 0 && (
                        <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                          unknown: {unknown.join(", ")} (dropped on save)
                        </div>
                      )}
                    </td>
                    {ADMIN_PERMISSIONS.map((p) => (
                      <td key={p.key} className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary"
                          checked={rowPerms(row).includes(p.key)}
                          onChange={() => toggle(row, p.key)}
                          disabled={busyId === row.user_id}
                          aria-label={`${p.label} for ${row.username ?? row.email}`}
                        />
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => save(row)}
                        disabled={!isDirty(row) || busyId === row.user_id}
                        className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => remove(row)}
                        disabled={busyId === row.user_id}
                        className="ml-2 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-red-600 hover:border-red-300"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
              {admins.length === 0 && (
                <tr>
                  <td
                    colSpan={ADMIN_PERMISSIONS.length + 2}
                    className="px-3 py-6 text-center text-muted-foreground"
                  >
                    No admins.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Add admin */}
        <div className="max-w-md space-y-2">
          <label className="text-sm font-medium" htmlFor="admin-search">
            Add admin
          </label>
          <input
            id="admin-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by username or email…"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          {hits.length > 0 && (
            <ul className="rounded-md border border-border divide-y divide-border">
              {hits.map((h) => (
                <li key={h.user_id}>
                  <button
                    onClick={() => addAdmin(h)}
                    disabled={h.is_admin}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                  >
                    <span>
                      <span className="font-medium">{h.username ?? "(no username)"}</span>{" "}
                      <span className="text-muted-foreground">{h.email}</span>
                    </span>
                    {h.is_admin && (
                      <span className="text-xs text-muted-foreground">already admin</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Forge members ------------------------------------------------------- */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Forge members</h2>
          <Link
            href="/forge/admin"
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Invites &amp; set grants → Forge admin
          </Link>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left">
                <th className="px-3 py-2 font-medium">Member</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {forgeMembers.map((m) => (
                <tr key={m.user_id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium">{m.display_name ?? "(no name)"}</td>
                  <td className="px-3 py-2">
                    {m.role === "superadmin" ? (
                      <span className="rounded-full border border-border px-2 py-0.5 text-xs">
                        superadmin (locked)
                      </span>
                    ) : (
                      <select
                        value={m.role}
                        onChange={(e) =>
                          changeForgeRole(m, e.target.value as "elder" | "playtester")
                        }
                        disabled={forgeBusyId === m.user_id}
                        className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                      >
                        <option value="elder">elder</option>
                        <option value="playtester">playtester</option>
                      </select>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {m.role !== "superadmin" && (
                      <button
                        onClick={() => removeForgeMember(m)}
                        disabled={forgeBusyId === m.user_id}
                        className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-red-600 hover:border-red-300"
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {forgeMembers.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                    No Forge members.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
