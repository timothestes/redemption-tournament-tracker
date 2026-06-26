"use client";

import { HiX } from "react-icons/hi";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody } from "@/components/ui/dialog";

interface DataCoverageModalProps {
  open: boolean;
  onClose: () => void;
}

const FULL_DATA_ROWS: Array<[string, string]> = [
  ["T1 2-Player", "2003–present (all years)"],
  ["T2 2-Player", "2004–present (missing 2019)"],
  ["Sealed", "2003–present (missing 2004)"],
  ["Booster Draft (2P)", "2005–present (missing 2015)"],
  ["Teams", "2010–present (missing 2014)"],
  ["Type A", "2005–present (missing several years due to insufficient participation)"],
  ["T1 Multiplayer", "2004–2021 (missing 2015; retired after 2021)"],
  ["T2 Multiplayer", "2004–2021 (missing 2015; retired after 2021)"],
  ["Booster Draft (Multi)", "2005–2017 (missing 2015; retired after 2017)"],
];

export function DataCoverageModal({ open, onClose }: DataCoverageModalProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="lg" className="max-w-xl">
        <DialogHeader className="relative">
          <DialogTitle>Data Coverage Details</DialogTitle>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 text-muted-foreground hover:text-foreground transition-colors"
          >
            <HiX className="h-4 w-4" />
          </button>
        </DialogHeader>
        <DialogBody className="space-y-5 text-sm leading-relaxed text-muted-foreground">
          <section className="space-y-2">
            <h3 className="font-semibold text-foreground">Full Standings (2003–present)</h3>
            <p>
              Complete player standings are available from 2003 through the present for most
              formats. The following formats have full data for the years listed:
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-2.5 py-1.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">
                      Format
                    </th>
                    <th className="px-2.5 py-1.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">
                      Full Data Available
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {FULL_DATA_ROWS.map(([fmt, coverage]) => (
                    <tr key={fmt} className="border-b border-border/60">
                      <td className="px-2.5 py-1.5 text-foreground">{fmt}</td>
                      <td className="px-2.5 py-1.5">{coverage}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold text-foreground">Early Years (1995–2002)</h3>
            <p>
              Records from 1995–2002 are incomplete — only some top-3 placings were preserved from
              this era. These years are excluded from Avg Placement and Soul Differential metrics,
              but top-3 finishes <em>are</em> counted in Podium Finishes (marked with * in
              Appearances). No match-level W/L data exists for these years.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold text-foreground">Match Records (W/L)</h3>
            <p>
              Head-to-head match records for 2-player formats cover 2003 through the present.
              Multiplayer W/L records cover 2005–2021 for T1 &amp; T2 Multiplayer and 2005–2017 for
              Booster Draft (Multi), sourced from tournament spreadsheets and software exports.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold text-foreground">Win % Calculations</h3>
            <p>
              Draws are excluded from Win % — only decisive games (W+L) are counted in the
              denominator. Multiplayer Win % is calculated separately from 2-Player Win % and not
              combined.
            </p>
          </section>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
