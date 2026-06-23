"use client";
import type { ForgeCardFull } from "@/app/forge/lib/cards";
import type { DesignCard } from "@/app/forge/lib/designCard";

export default function FullModeForm(_props: {
  card: ForgeCardFull;
  snapshot: DesignCard;
  update: (patch: Partial<DesignCard>) => void;
}) {
  return <p className="text-sm text-muted-foreground">Full mode — fields land in Task 9.</p>;
}
