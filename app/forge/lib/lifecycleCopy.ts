// Single source of truth for forge lifecycle copy + which statuses admit which
// action. Pure and isomorphic — imported by client components and server actions.
// Eligibility mirrors the guards in migration 052's RPCs; keep them in sync.

export const STATUS_LABEL: Record<string, string> = {
  private_idea: "Idea",
  draft: "Draft",
  playtesting: "In playtest",
  approved: "Final",
  archived: "Shelved",
};

export const STATUS_PATH = ["draft", "playtesting", "approved"] as const;

// Tinted pill classes per status — a quiet ramp along the lifecycle:
// neutral draft → amber in-playtest → green final; violet for pre-set ideas,
// dashed outline for shelved.
export const STATUS_BADGE_CLASS: Record<string, string> = {
  private_idea: "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400",
  draft: "border-border bg-muted/60 text-muted-foreground",
  playtesting: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  approved: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  archived: "border-dashed text-muted-foreground",
};

export type LifecycleAction =
  | "release"
  | "markFinal"
  | "reopen"
  | "shelve"
  | "restore"
  | "returnToIdeas"
  | "delete";

export const ACTION_LABEL: Record<LifecycleAction, string> = {
  release: "Release to playtest",
  markFinal: "Mark final",
  reopen: "Reopen testing",
  shelve: "Shelve",
  restore: "Restore",
  returnToIdeas: "Return to ideas",
  delete: "Delete",
};

// Past-tense verbs for bulk-result summaries ("Released 12 · 3 skipped · 0 failed").
export const BULK_DONE_VERB: Record<LifecycleAction, string> = {
  release: "Released",
  markFinal: "Marked final",
  reopen: "Reopened",
  shelve: "Shelved",
  restore: "Restored",
  returnToIdeas: "Returned",
  delete: "Deleted",
};

// A draft gets its first release; a playtesting card gets a new frozen version.
export function releaseLabel(status: string): string {
  return status === "draft" ? ACTION_LABEL.release : "Release update";
}

const ACTION_ELIGIBLE: Record<LifecycleAction, readonly string[]> = {
  release: ["draft", "playtesting"],
  markFinal: ["playtesting"],
  reopen: ["approved"],
  shelve: ["draft", "playtesting", "approved"],
  restore: ["archived"],
  returnToIdeas: ["draft", "playtesting", "approved", "archived"],
  delete: ["private_idea", "draft", "playtesting", "approved", "archived"],
};

export function isEligible(action: LifecycleAction, status: string): boolean {
  return ACTION_ELIGIBLE[action].includes(status);
}

export const CONFIRM_COPY = {
  releaseAll: {
    title: "Release all drafts?",
    description:
      "Releases every draft card matching the current filters. Playtesters will be able to see and build playtest decks with them.",
    confirmLabel: "Release all",
  },
  returnToIdeas: {
    title: "Return to ideas?",
    description:
      "Returns each card to its owner's private ideas. Released versions are retired and playtesters can no longer see the card.",
    confirmLabel: "Return to ideas",
  },
  delete: {
    title: "Delete permanently?",
    description:
      "This permanently removes the card and all of its versions. This cannot be undone.",
    confirmLabel: "Delete",
  },
} as const;
