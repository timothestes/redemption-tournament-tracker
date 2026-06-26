import { createContext, useContext } from "react";
import type { SeedData } from "@/lib/nationals/types";

export const SeedContext = createContext<SeedData | null>(null);

export function useSeed(): SeedData {
  const ctx = useContext(SeedContext);
  if (!ctx) throw new Error("useSeed must be used inside SeedContext.Provider");
  return ctx;
}
