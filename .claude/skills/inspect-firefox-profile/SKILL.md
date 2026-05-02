---
name: inspect-firefox-profile
description: Inspect a Firefox Profiler JSON export — overview, hot functions, long markers, network requests, marker types — without loading the whole 20+ MB blob into context. Use when the user shares a `.json` / `.json.gz` profile from profiler.firefox.com or has one open in the workspace (e.g. `Firefox 2026-MM-DD HH.MM profile.json`) and wants to know what was slow, what was hot on the main thread, what triggered jank, or which network requests were involved.
argument-hint: [path-to-profile]
allowed-tools: Bash, Read
---

# Inspect Firefox Performance Profile

The user shared a Firefox Profiler JSON export (or has one open in VS Code).
**Do not** read the JSON file directly with `Read` — they're typically 10–100+ MB
with single 20+ million-character lines that will blow your context budget.

Use [scripts/inspect-firefox-profile.py](../../../scripts/inspect-firefox-profile.py)
instead. It parses the profile (preprocessed format, shared tables) and emits
small, agent-friendly tables (or `--json` for piping to `jq`).

## When to use this skill

Strong triggers:

- A file named `*profile*.json` or `*profile*.json.gz` is open or referenced.
- The user mentions "Firefox profile", "perf profile", "profiler.firefox.com",
  "performance recording", or shares a profile share URL and asks what's slow.
- The user is investigating jank, long tasks, hot functions, GC pauses, layout
  thrash, or slow page loads in this app.

Skip this skill if the user is asking about Chrome DevTools profiles, Node
`--prof` output, or `clinic.js` flame graphs — those use different schemas.

## Quick start

```bash
# Auto-detect newest *profile*.json in the repo root
python3 scripts/inspect-firefox-profile.py summary

# Or point at a specific file (also accepts .json.gz)
python3 scripts/inspect-firefox-profile.py \
  --profile "Firefox 2026-05-01 18.56 profile.json" summary
```

The path can also be set via `INSPECT_PROFILE=...` so subsequent calls don't
need `--profile`.

## Triage workflow

Walk these in order. Each command is small (~25 rows) and read-only.

### 1. Orient yourself

```bash
python3 scripts/inspect-firefox-profile.py summary
python3 scripts/inspect-firefox-profile.py threads
python3 scripts/inspect-firefox-profile.py pages --url-max 80
```

You'll see the profile's duration, threads (`GeckoMain` for parent vs `tab`
processes are usually the interesting ones), and which URLs were recorded.

### 2. Where did time go?

```bash
# Sample-time breakdown by category (Idle, JavaScript, Layout, GC/CC, etc.)
python3 scripts/inspect-firefox-profile.py categories

# Top functions by own-time on the GeckoMain threads (default)
python3 scripts/inspect-firefox-profile.py hot-functions --top 30

# Or restrict to the content-process tab thread (use index from `threads`)
python3 scripts/inspect-firefox-profile.py hot-functions --thread 3 --top 30

# Filter to user code by name
python3 scripts/inspect-firefox-profile.py hot-functions \
  --pattern 'pairing|deck|getImageData' --top 20
```

Use `--metric total` for inclusive time (the function plus everything it called)
when chasing call-tree hotspots; default `own` is leaf attribution.

### 3. What blocked the main thread?

```bash
# Markers ≥ 50 ms on GeckoMain threads
python3 scripts/inspect-firefox-profile.py long-markers --min-ms 50 --top 30

# Group all markers by name to see where wall-time accumulates
python3 scripts/inspect-firefox-profile.py marker-types --top 30

# Drill in on layout/paint
python3 scripts/inspect-firefox-profile.py marker-types --pattern '^(Reflow|Styles|Paint|Composite|RefreshDriver)'
```

Common interesting marker names: `Reflow`, `Styles`, `Paint`, `Composite`,
`GCMajor`, `GCSlice`, `CCSlice`, `RefreshObserver`, `JS::EvaluateScript`,
`Runnable`, `IPC`.

### 4. Why is the call tree shaped that way?

```bash
# Top dedup'd leaf stacks
python3 scripts/inspect-firefox-profile.py hot-stacks --top 15 --stack-depth 10
```

This is the closest to "self-time flame graph" output you can get from text.

### 5. Network

```bash
python3 scripts/inspect-firefox-profile.py network --top 50 --url-max 100
```

**Caveat:** Firefox sometimes ships profiles with empty `URI` fields (the
recorder strips URLs by default unless the user flips "Include URLs" in
about:profiling). When that happens you'll only see the network marker IDs and
durations — that's normal, not a script bug. If the user wants URL-level
detail, ask them to re-record with `Include URLs` enabled and share again.

## Useful flags (cheat sheet)

- `--thread <name|index>` — repeatable. Default selects every `GeckoMain`
  thread; pass an index from `threads` (e.g. `--thread 3`) to focus.
- `--process-type default|tab|gpu` — narrow further (parent vs content vs gpu).
- `--top N` — table size; default 25.
- `--pattern '...'` — regex (case-insensitive). Add `--substring` for literal.
- `--json` — emit JSON instead of a table. Pipe to `jq`:
  ```bash
  python3 scripts/inspect-firefox-profile.py hot-functions --json \
    | jq '.threads[0].rows[:5]'
  ```

## Things to know about Firefox profiles

- **Sample interval is 1 ms** in this profile, so each sample ≈ 1 ms of wall
  time on that thread. Reported "time" is sample-count × interval.
- **Idle time dominates** — long sequences of `__psynch_cvwait` are the thread
  parked waiting for work, not a bug. Filter it out by category breakdown
  (`Idle` row) or by ignoring `__psynch_cvwait` in `hot-functions` output.
- **Categories are sparse** in the frame table; this script walks up the stack
  to find a non-null category, matching the profiler.firefox.com frontend.
- **`tab` process** is where app code runs (Isolated Web Content). The `default`
  process is the browser chrome. For app perf questions, focus on the `tab`
  thread.
- **Strings and tables are shared** at the top level (`shared.stringArray` etc.)
  in modern preprocessed profiles — the script handles both layouts.

## Reporting back

When summarizing findings to the user:

1. State the profile span and which thread you focused on.
2. Lead with the dominant category and the top 3–5 hot functions or markers.
3. Tie hot stacks back to source files when `resource` columns hint at which
   bundle/module they came from.
4. Surface long markers (>= 100 ms on the main thread) — those are user-visible
   stalls.
5. If the user asked "why is X slow?", answer that question — don't dump the
   entire output. The tables are wide; pick the rows that matter.
