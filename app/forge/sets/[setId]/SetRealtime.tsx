"use client";

import { useForgeRefresh } from "@/app/forge/lib/useForgeRealtime";
import { forgeSetTopic } from "@/app/forge/lib/realtime";

// Mounted in the set layout: one subscription drives live review badges (nav tab),
// notes, and progress across every set tab via debounced router.refresh().
export default function SetRealtime({ setId }: { setId: string }) {
  useForgeRefresh(forgeSetTopic(setId));
  return null;
}
