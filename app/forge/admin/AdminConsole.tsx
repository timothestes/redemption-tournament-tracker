"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ForgeRole } from "@/app/forge/lib/auth";
import { mintInvite, changeRole, removeMember } from "@/app/forge/lib/members";
import SetAccessMatrix from "./SetAccessMatrix";

type Member = { user_id: string; role: ForgeRole; display_name: string | null; created_at: string };
type Invite = { id: string; role: ForgeRole; email: string | null; expires_at: string; used_at: string | null };

// Roles this caller may grant/manage (mirrors forge_role_outranks server-side).
function grantable(caller: ForgeRole): ForgeRole[] {
  if (caller === "superadmin") return ["elder", "playtester"];
  if (caller === "elder") return ["playtester"];
  return [];
}

export default function AdminConsole({
  callerRole,
  members,
  invites,
  sets,
  grants,
}: {
  callerRole: ForgeRole;
  members: Member[];
  invites: Invite[];
  sets: { id: string; name: string }[];
  grants: { setId: string; userId: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [inviteRole, setInviteRole] = useState<ForgeRole>(grantable(callerRole)[0] ?? "playtester");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteSetIds, setInviteSetIds] = useState<string[]>([]);
  const canManage = new Set(grantable(callerRole));
  const playtesters = members
    .filter((m) => m.role === "playtester")
    .map((m) => ({ userId: m.user_id, displayName: m.display_name }));

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setMsg(null);
    startTransition(async () => {
      const r = await fn();
      setMsg(r.ok ? okMsg : r.error ?? "Failed");
      if (r.ok) router.refresh();
    });
  }

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setInviteUrl(null);
    const r = await mintInvite({ role: inviteRole, email: inviteEmail || null, setIds: inviteSetIds });
    if (r.ok === false) return setMsg(r.error);
    setInviteUrl(r.url);
    setMsg(inviteEmail ? "Invite emailed." : "Invite link created.");
    router.refresh();
  }

  return (
    <div className="mt-6 space-y-8 [.jayden_&]:rounded-lg [.jayden_&]:border [.jayden_&]:border-primary/20 [.jayden_&]:bg-card/80 [.jayden_&]:backdrop-blur-sm [.jayden_&]:p-6">
      <section>
        <h2 className="text-lg font-medium">Invite a member</h2>
        <form onSubmit={submitInvite} className="mt-2 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            Role
            <select
              className="mt-1 block rounded-md border bg-background px-2 py-1.5 text-sm"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as ForgeRole)}
            >
              {grantable(callerRole).map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Email (optional)
            <input
              type="email"
              className="mt-1 block rounded-md border bg-background px-2 py-1.5 text-sm"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="name@example.com"
            />
          </label>
          {inviteRole === "playtester" && sets.length > 0 && (
            <label className="text-sm">
              Sets (grants access)
              <select
                multiple
                className="mt-1 block min-w-40 rounded-md border bg-background px-2 py-1.5 text-sm"
                value={inviteSetIds}
                onChange={(e) => setInviteSetIds(Array.from(e.target.selectedOptions, (o) => o.value))}
              >
                {sets.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
          )}
          <button className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground" disabled={pending}>
            Send invite
          </button>
        </form>
        {inviteUrl && (
          <p className="mt-2 break-all text-xs text-muted-foreground">
            Link: <code>{inviteUrl}</code>
          </p>
        )}
      </section>

      <section>
        <h2 className="text-lg font-medium">Members ({members.length})</h2>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1">Name</th><th>Role</th><th></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const editable = canManage.has(m.role);
              return (
                <tr key={m.user_id} className="border-t">
                  <td className="py-2">{m.display_name ?? <span className="text-muted-foreground">—</span>}</td>
                  <td>
                    {editable ? (
                      <select
                        className="rounded border bg-background px-1.5 py-1 text-xs"
                        defaultValue={m.role}
                        onChange={(e) => run(() => changeRole(m.user_id, e.target.value as ForgeRole), "Role updated")}
                        disabled={pending}
                      >
                        {grantable(callerRole).map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    ) : (
                      m.role
                    )}
                  </td>
                  <td className="text-right">
                    {editable && (
                      <button
                        className="text-xs text-red-500 hover:underline"
                        onClick={() => run(() => removeMember(m.user_id), "Member removed")}
                        disabled={pending}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <SetAccessMatrix playtesters={playtesters} sets={sets} grants={grants} />

      <section>
        <h2 className="text-lg font-medium">Pending invites</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {invites.filter((i) => !i.used_at).map((i) => (
            <li key={i.id} className="text-muted-foreground">
              {i.role} · {i.email ?? "link-only"} · expires {new Date(i.expires_at).toLocaleDateString()}
            </li>
          ))}
          {invites.filter((i) => !i.used_at).length === 0 && (
            <li className="text-muted-foreground">None.</li>
          )}
        </ul>
      </section>

      {msg && <p aria-live="polite" className="text-sm">{msg}</p>}
    </div>
  );
}
