"use client";

import { createContext, useContext } from "react";

// Lets the review column reach the editor's autosave. `review` is built in the server
// component and passed to StudioEditor as an element, so it cannot receive callbacks as
// props — context is the only channel.
//
// Why it exists: the editor autosaves 700ms after a keystroke, and the suggestion/proposal
// RPCs build their new snapshot from the SERVER's copy of the working draft. Apply or
// Accept inside that window, and the debounce lands afterwards and overwrites the result —
// with the comment already marked resolved and no record the suggestion was ever applied.
// Anything in the review column that writes the snapshot server-side must flush first.
export type StudioSync = {
  /** Write any pending local edit now, and resolve once the server has it.
   *  `ok: false` means the save FAILED, so the server still holds the previous
   *  snapshot — a caller that goes on to build from it would produce exactly the
   *  stale write this flush exists to prevent. Callers must bail. */
  flushPending: () => Promise<{ ok: boolean }>;
};

const StudioSyncContext = createContext<StudioSync>({ flushPending: async () => ({ ok: true }) });

export const StudioSyncProvider = StudioSyncContext.Provider;

export function useStudioSync(): StudioSync {
  return useContext(StudioSyncContext);
}
