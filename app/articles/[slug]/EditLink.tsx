"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";
import { getUserSafe } from "@/utils/supabase/getUserSafe";
import { useIsAdmin } from "@/hooks/useIsAdmin";

// The article page is cached for everyone, so anything per-viewer has to be
// decided in the browser. Shows "Edit" to the author (holding publish_posts)
// or the superuser; renders nothing for everyone else.
export default function EditLink({ postId, authorId }: { postId: string; authorId: string }) {
  const { isSuperuser, permissions, loading } = useIsAdmin();
  const supabase = useRef(createClient()).current;
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getUserSafe(supabase).then((u) => {
      if (alive) setUserId(u?.id ?? null);
    });
    return () => {
      alive = false;
    };
  }, [supabase]);

  if (loading) return null;
  const canEdit = isSuperuser || (userId !== null && userId === authorId && permissions.includes("publish_posts"));
  if (!canEdit) return null;
  return (
    <Link
      href={`/admin/posts/${postId}`}
      className="inline-flex min-h-9 items-center rounded-md border border-input px-3 text-sm hover:bg-muted"
    >
      Edit
    </Link>
  );
}
