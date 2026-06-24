"use client";

import { useEffect, useMemo, useState } from "react";
import { LEVEL_LABELS } from "@/lib/rnrs/config";
import {
  buildPlayerProfile,
  displayName,
  getRegion,
  getState,
  normName,
} from "@/lib/rnrs/scoring";
import type { NormalizedData } from "@/lib/rnrs/types";

interface Props {
  data: NormalizedData;
  allNames: string[];
  initialName: string | null;
}

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-muted-foreground/50";

export default function RnrsPlayerLookup({ data, allNames, initialName }: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (initialName) {
      setSelected(initialName);
      setQuery(displayName(initialName));
      setOpen(false);
    }
  }, [initialName]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return allNames.filter((n) => normName(n).includes(q)).slice(0, 10);
  }, [query, allNames]);

  const profile = useMemo(
    () => (selected ? buildPlayerProfile(data, selected) : null),
    [data, selected],
  );

  const pick = (name: string) => {
    setSelected(name);
    setQuery(displayName(name));
    setOpen(false);
  };

  const initials = profile
    ? profile.displayName
        .split(" ")
        .filter(Boolean)
        .map((w) => w[0]?.toUpperCase())
        .slice(0, 2)
        .join("")
    : "";

  return (
    <div className="mx-auto max-w-2xl">
      <div className="relative">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search player name…"
            className={inputClass}
            aria-label="Search player name"
          />
          {(query || selected) && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setSelected(null);
                setOpen(false);
              }}
              className="shrink-0 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>

        {open && suggestions.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-card shadow-lg">
            {suggestions.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  onClick={() => pick(name)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
                >
                  <span>{displayName(name)}</span>
                  <span className="text-xs text-muted-foreground">
                    {[getState(name), getRegion(name)].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        {allNames.length} players across all seasons · type to search.
      </p>

      {selected && !profile && (
        <div className="mt-6 rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          No results found for <strong>{displayName(selected)}</strong>.
        </div>
      )}

      {profile && (
        <div className="mt-6 overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-center gap-4 border-b border-border bg-muted/40 p-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-lg font-bold text-primary">
              {initials}
            </div>
            <div className="min-w-0">
              <div className="text-lg font-semibold text-foreground">
                {profile.displayName}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {(profile.state || profile.region) && (
                  <span>
                    {[profile.state, profile.region].filter(Boolean).join(" · ")}
                  </span>
                )}
                <span>
                  {profile.seasonCount} season{profile.seasonCount !== 1 ? "s" : ""}
                </span>
                <span className="font-medium text-primary tabular-nums">
                  {profile.totalPts} total pts
                </span>
                <span>
                  {profile.formatCount} format{profile.formatCount !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-3 p-4">
            {profile.seasons.map((s) => (
              <div
                key={s.season}
                className="rounded-md border border-border bg-background/60 p-3"
              >
                <div className="mb-2 flex items-baseline justify-between border-b border-border pb-2 text-xs font-semibold text-muted-foreground">
                  <span>{s.season} Season</span>
                  <span className="tabular-nums text-primary">{s.total} pts</span>
                </div>
                <div className="space-y-1.5">
                  {s.formats.map((f) => (
                    <div
                      key={f.formatKey}
                      className="flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <span className="text-muted-foreground">{f.label}</span>
                      <span className="flex flex-wrap items-center justify-end gap-1.5">
                        {f.placings.map((p, i) => (
                          <span
                            key={i}
                            className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground"
                          >
                            {p.place} {LEVEL_LABELS[p.level]}
                            {p.count > 1 ? ` ×${p.count}` : ""}
                          </span>
                        ))}
                        <span className="tabular-nums font-semibold text-primary">
                          {f.total} pts
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
