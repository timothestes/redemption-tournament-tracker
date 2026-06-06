---
name: improve-area
description: >
  Use when the user wants to substantially improve, upgrade, redesign, or build
  a "v2" of an EXISTING feature or area of the app (e.g. "make spotlight mode
  better", "improve the mobile deck drawer", "the pairings view needs work") and
  wants a thorough, multi-perspective pass rather than a quick one-off edit.
  Triggers: "improve X", "make X better", "v2 of X", "polish/redesign X", "what
  could be better about X". Not for tiny tweaks or brand-new features from scratch.
---

# Improve an Area

Runs a structured, multi-agent improvement pass on an existing area of the app:
inspect it live → ideate from 3 perspectives → synthesize a prioritized spec →
implement the high-value subset → independently review. You stay the coordinator.

## When to use

- The user wants a *thorough* improvement of something that already exists.
- The area is visible/interactive (a page, panel, mode, flow) you can drive in a browser.

**When NOT to use:** trivial edits (just make them), brand-new features with no
existing surface (use `superpowers:brainstorming` first), or pure backend/logic
with no UI to inspect (skip the Playwright step; the pipeline still works).

## The procedure

### 1. Scope the area
Identify the route and key files. `grep` for the feature name; read the main
component(s) and how they're wired. If the area is ambiguous, ask the user which
route/feature they mean before proceeding.

### 2. Inspect it live (Playwright) — YOU do this, not the subagents
The Playwright browser is a **singleton**, so the coordinator inspects once and
hands findings to the agents (parallel agents would fight over one browser).
- Ensure the dev server is up (`curl -s -o /dev/null -w "%{http_code}" localhost:3000`;
  if down, `npm run dev` in the background and wait for "Ready").
- Navigate to the area, drive it through its real states (empty / active / edge),
  and `browser_take_screenshot` each meaningful state.
- **Save screenshots to `/tmp/<area>-review/`** (NOT the repo root — they must not
  get committed). `Read` them yourself to confirm what you're seeing.

### 3. Write the context brief
A single markdown string the agents all share. Include:
- **What it is + who uses it** (the real job-to-be-done).
- **Current behavior**, verified from the live inspection.
- **Observed v1 limitations** (seeds for ideation, not an exhaustive list).
- **Key files** with line ranges for state/wiring.
- **Available data/props** (what fields exist — agents must not invent APIs).
- **Project conventions** from CLAUDE.md + memory (design tokens, no
  `focus:ring-2`/`focus:ring-ring` on controls, surgical changes, simplicity-first).
- **Screenshot paths** (`/tmp/...`) — agents `Read` these.

### 4. Run the pipeline
Invoke the bundled workflow, passing the brief as `args`:

```
Workflow({
  scriptPath: ".claude/skills/improve-area/pipeline.workflow.js",
  args: {
    area: "Spotlight mode",
    context: "<the full brief from step 3>",
    implement: true            // false = stop at the spec, no code changes
    // lenses: [...]            // optional: override the 3 default lenses
  }
})
```
It runs: **3 ideation agents** (UX/workflow, visual design, functionality —
distinct lenses so they don't converge) → **1 synthesizer** (prioritizes into
mustHave / niceToHave / deferred, scoped surgical) → **1 implementer** (real
edits + `tsc --noEmit`, no full build) → **2 reviewers** (correctness + design/
conventions, checked against the real `git diff`). Returns `{spec, implementation,
reviews}`. It runs in the background; you're notified on completion.

### 5. Verify live yourself, then report
**Do not trust the reviewers' verdicts alone.** After it lands, reload the area in
Playwright and confirm the changes actually render and behave. Then give the user
a consolidated report: the spec summary, what landed, reviewer verdicts/issues,
your live-verification result, and the deferred ideas worth a future pass.

## Notes

- **Coordinator role:** you own steps 1-3 and 5; the workflow owns ideate→review.
- **Tune the lenses** via `args.lenses` (`[{key, prompt}]`) when an area needs
  domain-specific perspectives (e.g. a "broadcast/OBS workflow" lens for streaming
  overlays). Defaults are generic and fine for most areas.
- **Ideas-only mode:** pass `implement: false` when the user wants recommendations
  to review before any code changes.
- **Scope discipline:** the prompts enforce surgical, simplicity-first changes; if
  the user wants something bigger, say so in the brief and raise the mustHave bar.
```
