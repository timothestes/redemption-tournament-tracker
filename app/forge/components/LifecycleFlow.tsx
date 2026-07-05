import Link from "next/link";
import { Fragment } from "react";
import { cn } from "@/lib/utils";

// The path a card walks from a private sketch to a printed set. Each stage links
// to where that work happens; dots reuse the lifecycle color ramp (violet idea →
// neutral draft → amber playtest → green final) from lifecycleCopy.ts.
const STAGES = [
  { label: "Idea", desc: "Sketch it privately", href: "/forge/ideas", dot: "bg-violet-500 [.jayden_&]:bg-violet-400" },
  { label: "Draft", desc: "Add it to a set", href: "/forge/sets", dot: "bg-muted-foreground [.jayden_&]:bg-slate-300" },
  { label: "In playtest", desc: "Release for testing", href: "/forge/play", dot: "bg-amber-500 [.jayden_&]:bg-amber-400" },
  { label: "Final", desc: "Approved for print", href: "/forge/sets", dot: "bg-emerald-500 [.jayden_&]:bg-emerald-400" },
] as const;

function Arrow() {
  return (
    <div aria-hidden className="flex shrink-0 items-center justify-center self-center text-muted-foreground/50 [.jayden_&]:text-muted-foreground">
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 rotate-90 sm:rotate-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    </div>
  );
}

export function LifecycleFlow() {
  return (
    <section aria-label="How a card becomes a set">
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">From idea to set</h2>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        {STAGES.map((s, i) => (
          <Fragment key={s.label}>
            <Link
              href={s.href}
              className="group flex flex-1 items-start gap-3 rounded-lg border bg-card/60 p-4 shadow-sm transition-colors hover:bg-muted/50 hover:shadow [.jayden_&]:bg-card [.jayden_&]:bg-gradient-to-br [.jayden_&]:from-[hsla(0,80%,25%,0.15)] [.jayden_&]:via-[hsla(270,60%,20%,0.1)] [.jayden_&]:to-[hsla(230,80%,30%,0.15)] [.jayden_&]:border-primary/30"
            >
              <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", s.dot)} />
              <span className="min-w-0">
                <span className="block font-medium">{s.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{s.desc}</span>
              </span>
            </Link>
            {i < STAGES.length - 1 && <Arrow />}
          </Fragment>
        ))}
      </div>
    </section>
  );
}
