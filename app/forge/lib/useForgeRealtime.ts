"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { ensureRealtimeAuth } from "@/app/forge/lib/realtime";

export type ForgePresenceMeta = {
  userId: string;
  displayName: string | null;
  editing: boolean;
};

// Debounced router.refresh() on every 'change' broadcast for `topic`.
// A no-op when topic is null (e.g. a setless private card).
export function useForgeRefresh(topic: string | null): void {
  const router = useRouter();
  useEffect(() => {
    if (!topic) return;
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ping = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 250);
    };
    (async () => {
      await ensureRealtimeAuth(supabase);
      if (cancelled) return;
      channel = supabase
        .channel(topic, { config: { private: true } })
        .on("broadcast", { event: "change" }, ping)
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (channel) supabase.removeChannel(channel);
    };
  }, [topic, router]);
}

// One card channel: presence (who's here / editing) + 'change' -> debounced refresh.
// `setEditing` re-tracks the local member's presence so others see the collision state.
export function useForgeCardChannel(
  topic: string | null,
  me: ForgePresenceMeta,
): { others: ForgePresenceMeta[]; setEditing: (v: boolean) => void } {
  const router = useRouter();
  const [others, setOthers] = useState<ForgePresenceMeta[]>([]);
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);
  const editingRef = useRef<boolean>(me.editing);

  // Depend on primitive fields, not the `me` object identity (which changes each render).
  const { userId, displayName } = me;

  useEffect(() => {
    if (!topic) return;
    const supabase = createClient();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ping = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 250);
    };
    (async () => {
      await ensureRealtimeAuth(supabase);
      if (cancelled) return;
      const ch = supabase.channel(topic, {
        config: { private: true, presence: { key: userId } },
      });
      ch.on("broadcast", { event: "change" }, ping);
      ch.on("presence", { event: "sync" }, () => {
        const state = ch.presenceState() as Record<string, ForgePresenceMeta[]>;
        const list = Object.entries(state)
          .filter(([key]) => key !== userId)
          .flatMap(([, metas]) => metas);
        setOthers(list);
      });
      ch.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await ch.track({ userId, displayName, editing: editingRef.current });
        }
      });
      channelRef.current = ch;
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    };
  }, [topic, userId, displayName, router]);

  const setEditing = useCallback(
    (v: boolean) => {
      editingRef.current = v;
      const ch = channelRef.current;
      if (ch) void ch.track({ userId, displayName, editing: v });
    },
    [userId, displayName],
  );

  return { others, setEditing };
}
