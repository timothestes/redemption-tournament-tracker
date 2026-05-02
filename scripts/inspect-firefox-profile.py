#!/usr/bin/env python3
"""
inspect-firefox-profile.py — agent-friendly inspector for Firefox Profiler JSON.

Reads a profile exported from https://profiler.firefox.com (preprocessed format,
shared tables) and answers common questions: what was the main thread doing,
which functions/markers ate time, which network requests ran, etc.

USAGE
  scripts/inspect-firefox-profile.py [--profile PATH] <command> [options]

  PATH defaults to env var INSPECT_PROFILE, or the newest matching
  '*profile*.json[.gz]' file in the repo root if neither is set.

COMMANDS
  summary               High-level overview (default if no command given).
  threads               One row per thread: pid/tid, samples, markers.
  pages                 Pages (URLs) recorded in the profile.
  categories            Sample-time breakdown by category, per thread.
  hot-functions         Top N functions by own- or total-time.
  hot-stacks            Top N leaf stacks by sample weight.
  long-markers          Markers whose duration >= --min-ms.
  marker-types          Marker counts and total duration by name.
  network               Network request markers (URL, status, duration).
  search-functions      Find functions by name substring or regex.

COMMON OPTIONS
  --thread NAME|INDEX   Restrict to thread(s); repeatable. Matches name
                        case-insensitively (e.g. 'GeckoMain') or the index
                        printed by `threads`. Default: GeckoMain threads only.
  --process-type T      Restrict to a processType (default, tab, gpu, ...).
  --top N               Limit results (default 25).
  --min-ms N            Threshold for long-markers (default 50).
  --metric own|total    For hot-functions (default own).
  --pattern STR         Regex (default) for search-functions / marker-types.
  --substring           Treat --pattern as a literal substring, not regex.
  --json                Emit JSON instead of text tables (for piping to jq).

EXAMPLES
  # quick triage — what is heavy in this profile?
  scripts/inspect-firefox-profile.py summary
  scripts/inspect-firefox-profile.py hot-functions --thread 'GeckoMain' --top 30
  scripts/inspect-firefox-profile.py long-markers --min-ms 100
  scripts/inspect-firefox-profile.py network --top 50
  scripts/inspect-firefox-profile.py hot-stacks --thread 3 --top 20

  # zero in on suspect code
  scripts/inspect-firefox-profile.py search-functions --pattern 'pairing|deck'
  scripts/inspect-firefox-profile.py marker-types --pattern '^Style|^Reflow'

  # JSON for downstream tools
  scripts/inspect-firefox-profile.py hot-functions --json | jq '.rows[0]'
"""
import argparse
import codecs
import gzip
import io
import json
import os
import re
import sys
from collections import defaultdict
from glob import glob
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

# Profiles + this script's docstring contain non-ASCII characters (em dashes,
# arrows, µ). Make stdout/stderr UTF-8 even when launched in environments where
# Python defaults to ASCII (e.g. cron, some CI shells, system Python 3.6).
def _force_utf8_stream(stream):
    enc = getattr(stream, "encoding", None) or ""
    if enc.lower().replace("-", "") in ("utf8", "utf"):
        return stream
    reconfigure = getattr(stream, "reconfigure", None)
    if reconfigure:
        try:
            reconfigure(encoding="utf-8", errors="replace")
            return stream
        except Exception:
            pass
    try:
        return codecs.getwriter("utf-8")(stream.buffer, errors="replace")
    except Exception:
        return stream

sys.stdout = _force_utf8_stream(sys.stdout)
sys.stderr = _force_utf8_stream(sys.stderr)


# ---------- profile loading ---------------------------------------------------

def _open_text(path: str):
    if path.endswith(".gz"):
        return io.TextIOWrapper(gzip.open(path, "rb"), encoding="utf-8")
    return io.open(path, "r", encoding="utf-8")


def load_profile(path: str) -> Dict[str, Any]:
    with _open_text(path) as f:
        data = json.load(f)
    if "threads" not in data or "meta" not in data:
        raise SystemExit(
            "{0}: not a Firefox Profiler JSON (missing 'threads'/'meta')".format(path)
        )
    return data


def default_profile_path() -> Optional[str]:
    env = os.environ.get("INSPECT_PROFILE")
    if env:
        return env
    candidates: List[str] = []
    for pattern in ("*profile*.json", "*profile*.json.gz", "*Profile*.json"):
        candidates.extend(glob(pattern))
    if not candidates:
        return None
    candidates.sort(key=lambda p: os.path.getmtime(p), reverse=True)
    return candidates[0]


# ---------- shared accessors --------------------------------------------------

class Profile:
    """Thin convenience wrapper. Resolves shared vs per-thread tables."""

    def __init__(self, raw: Dict[str, Any]) -> None:
        self.raw = raw
        self.meta = raw["meta"]
        self.shared = raw.get("shared") or {}
        self.string_array: List[str] = (
            self.shared.get("stringArray") or raw.get("stringArray") or []
        )
        self.stack_table = self.shared.get("stackTable") or {}
        self.frame_table = self.shared.get("frameTable") or {}
        self.func_table = self.shared.get("funcTable") or {}
        self.resource_table = self.shared.get("resourceTable") or {}
        self.categories = [c.get("name", "?") for c in self.meta.get("categories", [])]
        self.interval_ms: float = float(self.meta.get("interval") or 1.0)
        self.duration_ms: float = float(
            (self.meta.get("profilingEndTime") or 0)
            - (self.meta.get("profilingStartTime") or 0)
        )

    def s(self, idx: Optional[int]) -> str:
        if idx is None or idx < 0:
            return ""
        try:
            return self.string_array[idx]
        except IndexError:
            return "<bad-string {0}>".format(idx)

    def category(self, idx: Optional[int]) -> str:
        if idx is None or idx < 0 or idx >= len(self.categories):
            return "?"
        return self.categories[idx]

    # threads/pages helpers -----------------------------------------------------

    def threads(self) -> List[Dict[str, Any]]:
        return self.raw.get("threads", [])

    def thread_label(self, t: Dict[str, Any]) -> str:
        bits = [str(t.get("name") or "?")]
        if t.get("processType"):
            bits.append("[" + str(t["processType"]) + "]")
        if t.get("processName"):
            bits.append("(" + str(t["processName"]) + ")")
        bits.append("pid={0}".format(t.get("pid")))
        return " ".join(bits)

    def pages(self) -> List[Dict[str, Any]]:
        return self.raw.get("pages", []) or []

    # frame/func resolution -----------------------------------------------------

    def frame_func(self, frame_idx: int) -> int:
        return self.frame_table["func"][frame_idx]

    def frame_category(self, frame_idx: int) -> int:
        cat = self.frame_table.get("category")
        if cat is None:
            return -1
        v = cat[frame_idx]
        return -1 if v is None else int(v)

    def func_name(self, func_idx: int) -> str:
        return self.s(self.func_table["name"][func_idx])

    def func_resource_name(self, func_idx: int) -> str:
        res_arr = self.func_table.get("resource")
        if not res_arr:
            return ""
        ridx = res_arr[func_idx]
        if ridx is None or ridx < 0:
            return ""
        names = self.resource_table.get("name") or []
        if ridx >= len(names):
            return ""
        return self.s(names[ridx])

    def func_is_js(self, func_idx: int) -> bool:
        arr = self.func_table.get("isJS")
        return bool(arr[func_idx]) if arr else False

    def stack_frame(self, stack_idx: int) -> int:
        return self.stack_table["frame"][stack_idx]

    def stack_prefix(self, stack_idx: int) -> Optional[int]:
        return self.stack_table["prefix"][stack_idx]

    def stack_to_funcs(self, stack_idx: Optional[int]) -> List[int]:
        """Return func indices for a stack, leaf-first."""
        out: List[int] = []
        cur = stack_idx
        while cur is not None and cur >= 0:
            f = self.stack_frame(cur)
            out.append(self.frame_func(f))
            cur = self.stack_prefix(cur)
        return out


# ---------- thread filtering --------------------------------------------------

def select_threads(
    p: Profile, names: Sequence[str], process_type: Optional[str]
) -> List[Tuple[int, Dict[str, Any]]]:
    indexed = list(enumerate(p.threads()))
    if process_type:
        indexed = [(i, t) for i, t in indexed if t.get("processType") == process_type]

    if not names:
        # Default: focus on GeckoMain threads. They're usually what matters.
        indexed = [(i, t) for i, t in indexed if (t.get("name") or "") == "GeckoMain"]
        return indexed

    selected: List[Tuple[int, Dict[str, Any]]] = []
    seen = set()
    by_index = {i: t for i, t in indexed}
    for token in names:
        if token.isdigit():
            i = int(token)
            if i in by_index and i not in seen:
                selected.append((i, by_index[i]))
                seen.add(i)
            continue
        token_lower = token.lower()
        for i, t in indexed:
            if i in seen:
                continue
            if token_lower in (t.get("name") or "").lower():
                selected.append((i, t))
                seen.add(i)
    return selected


# ---------- text formatting ---------------------------------------------------

def fmt_ms(ms: float) -> str:
    if ms >= 1000:
        return "{0:.2f} s".format(ms / 1000.0)
    if ms >= 1:
        return "{0:.1f} ms".format(ms)
    if ms <= 0:
        return "0"
    return "{0:.2f} ms".format(ms)


def render_table(
    headers: Sequence[str],
    rows: Sequence[Sequence[Any]],
    aligns: Optional[Sequence[str]] = None,
    max_col: int = 80,
) -> str:
    if not rows:
        return "(no rows)"
    aligns = aligns or ["<"] * len(headers)
    str_rows = [[("" if c is None else str(c)) for c in r] for r in rows]
    str_rows = [[c[: max_col - 1] + "…" if len(c) > max_col else c for c in r] for r in str_rows]
    widths = [len(h) for h in headers]
    for r in str_rows:
        for i, c in enumerate(r):
            if len(c) > widths[i]:
                widths[i] = len(c)
    fmt = "  ".join("{{:{align}{width}}}".format(align=aligns[i], width=widths[i]) for i in range(len(headers)))
    out = [fmt.format(*headers), fmt.format(*("-" * w for w in widths))]
    for r in str_rows:
        out.append(fmt.format(*r))
    return "\n".join(out)


def emit(args, payload: Dict[str, Any], text: str) -> None:
    if args.json:
        json.dump(payload, sys.stdout, indent=2, default=str, ensure_ascii=False)
        sys.stdout.write("\n")
    else:
        sys.stdout.write(text)
        sys.stdout.write("\n")


# ---------- commands ----------------------------------------------------------

def cmd_summary(p: Profile, args) -> None:
    meta = p.meta
    threads = p.threads()
    rows = []
    total_samples = 0
    total_markers = 0
    for i, t in enumerate(threads):
        s_len = (t.get("samples") or {}).get("length") or 0
        m_len = (t.get("markers") or {}).get("length") or 0
        total_samples += s_len
        total_markers += m_len
        rows.append([
            i,
            t.get("name"),
            t.get("processType"),
            t.get("pid"),
            t.get("tid"),
            s_len,
            m_len,
        ])

    text_lines = []
    text_lines.append("Profile: {0}".format(args.profile))
    text_lines.append(
        "  product={0}  platform={1}  oscpu={2}".format(
            meta.get("product"), meta.get("platform"), meta.get("oscpu")
        )
    )
    text_lines.append(
        "  duration={0}  interval={1}ms  preprocessedVersion={2}".format(
            fmt_ms(p.duration_ms),
            meta.get("interval"),
            meta.get("preprocessedProfileVersion"),
        )
    )
    text_lines.append(
        "  threads={0}  pages={1}  libs={2}  counters={3}".format(
            len(threads),
            len(p.pages()),
            len(p.raw.get("libs") or []),
            len(p.raw.get("counters") or []),
        )
    )
    text_lines.append(
        "  totals: samples={0}  markers={1}".format(total_samples, total_markers)
    )
    text_lines.append("")
    text_lines.append("Threads:")
    text_lines.append(
        render_table(
            ["#", "name", "processType", "pid", "tid", "samples", "markers"],
            rows,
            aligns=["<", "<", "<", "<", "<", ">", ">"],
        )
    )

    payload = {
        "profile": args.profile,
        "product": meta.get("product"),
        "platform": meta.get("platform"),
        "oscpu": meta.get("oscpu"),
        "durationMs": p.duration_ms,
        "intervalMs": meta.get("interval"),
        "preprocessedProfileVersion": meta.get("preprocessedProfileVersion"),
        "threads": [
            {
                "index": r[0],
                "name": r[1],
                "processType": r[2],
                "pid": r[3],
                "tid": r[4],
                "samples": r[5],
                "markers": r[6],
            }
            for r in rows
        ],
        "totals": {"samples": total_samples, "markers": total_markers},
        "pages": len(p.pages()),
    }
    emit(args, payload, "\n".join(text_lines))


def cmd_threads(p: Profile, args) -> None:
    rows = []
    for i, t in enumerate(p.threads()):
        rows.append([
            i,
            t.get("name"),
            t.get("processType"),
            t.get("processName") or "",
            t.get("pid"),
            t.get("tid"),
            (t.get("samples") or {}).get("length") or 0,
            (t.get("markers") or {}).get("length") or 0,
        ])
    text = render_table(
        ["#", "name", "processType", "processName", "pid", "tid", "samples", "markers"],
        rows,
        aligns=["<", "<", "<", "<", "<", "<", ">", ">"],
    )
    emit(
        args,
        {"threads": [
            {"index": r[0], "name": r[1], "processType": r[2], "processName": r[3],
             "pid": r[4], "tid": r[5], "samples": r[6], "markers": r[7]}
            for r in rows
        ]},
        text,
    )


def cmd_pages(p: Profile, args) -> None:
    rows = []
    for pg in p.pages():
        rows.append([
            pg.get("tabID"),
            pg.get("innerWindowID"),
            pg.get("embedderInnerWindowID") or "",
            pg.get("isPrivateBrowsing", False),
            (pg.get("url") or "")[: args.url_max],
        ])
    text = render_table(
        ["tabID", "innerWindowID", "embedderID", "private", "url"],
        rows,
        aligns=["<", "<", "<", "<", "<"],
        max_col=args.url_max + 4,
    )
    emit(args, {"pages": p.pages()}, text)


def cmd_categories(p: Profile, args) -> None:
    selected = select_threads(p, args.thread, args.process_type)
    out_threads = []
    text_blocks = []
    for thread_index, thread in selected:
        samples = thread.get("samples") or {}
        stack_arr: List[Optional[int]] = samples.get("stack") or []
        weight_per_sample = p.interval_ms
        cat_totals: Dict[str, float] = defaultdict(float)
        idle_cat = -1
        try:
            idle_cat = p.categories.index("Idle")
        except ValueError:
            pass
        idle_total = 0.0
        for s_idx in stack_arr:
            if s_idx is None or s_idx < 0:
                cat_totals["(no stack)"] += weight_per_sample
                continue
            # Categories are sparse in the frame table — walk up the stack
            # until we find a frame with a non-null category, matching the
            # Firefox Profiler frontend's behavior.
            cat_idx = -1
            cur = s_idx
            while cur is not None and cur >= 0:
                cat_idx = p.frame_category(p.stack_frame(cur))
                if cat_idx >= 0:
                    break
                cur = p.stack_prefix(cur)
            name = p.category(cat_idx) if cat_idx >= 0 else "(uncategorized)"
            cat_totals[name] += weight_per_sample
            if cat_idx == idle_cat:
                idle_total += weight_per_sample
        rows = sorted(cat_totals.items(), key=lambda kv: -kv[1])
        rows = [(k, v, 100.0 * v / max(1.0, sum(cat_totals.values()))) for k, v in rows]
        rows = rows[: args.top]
        rendered = render_table(
            ["category", "time", "%"],
            [(k, fmt_ms(v), "{0:.1f}".format(pct)) for k, v, pct in rows],
            aligns=["<", ">", ">"],
        )
        text_blocks.append(
            "Thread {0} — {1}\n{2}".format(thread_index, p.thread_label(thread), rendered)
        )
        out_threads.append({
            "index": thread_index,
            "label": p.thread_label(thread),
            "categories": [{"name": k, "ms": v, "pct": pct} for k, v, pct in rows],
            "idleMs": idle_total,
        })

    emit(args, {"threads": out_threads}, "\n\n".join(text_blocks))


def cmd_hot_functions(p: Profile, args) -> None:
    selected = select_threads(p, args.thread, args.process_type)
    pattern = _compile_pattern(args.pattern, args.substring) if args.pattern else None
    out_threads = []
    text_blocks = []
    for thread_index, thread in selected:
        samples = thread.get("samples") or {}
        stack_arr: List[Optional[int]] = samples.get("stack") or []
        weight = p.interval_ms
        own: Dict[int, float] = defaultdict(float)
        total: Dict[int, float] = defaultdict(float)
        for s_idx in stack_arr:
            if s_idx is None or s_idx < 0:
                continue
            funcs = p.stack_to_funcs(s_idx)
            if not funcs:
                continue
            own[funcs[0]] += weight
            seen = set()
            for f in funcs:
                if f in seen:
                    continue
                seen.add(f)
                total[f] += weight

        metric = own if args.metric == "own" else total
        ranked = sorted(metric.items(), key=lambda kv: -kv[1])

        rows = []
        rows_json = []
        kept = 0
        for func_idx, val in ranked:
            name = p.func_name(func_idx) or "(anonymous)"
            res = p.func_resource_name(func_idx)
            if pattern and not pattern.search(name) and not pattern.search(res):
                continue
            rows.append([
                fmt_ms(val),
                fmt_ms(own.get(func_idx, 0.0)),
                fmt_ms(total.get(func_idx, 0.0)),
                "JS" if p.func_is_js(func_idx) else "native",
                name,
                res,
            ])
            rows_json.append({
                "function": name,
                "resource": res,
                "ownMs": own.get(func_idx, 0.0),
                "totalMs": total.get(func_idx, 0.0),
                "isJS": p.func_is_js(func_idx),
            })
            kept += 1
            if kept >= args.top:
                break

        text_blocks.append(
            "Thread {0} — {1}  (metric={2})\n{3}".format(
                thread_index, p.thread_label(thread), args.metric,
                render_table(
                    [args.metric, "own", "total", "kind", "function", "resource"],
                    rows,
                    aligns=[">", ">", ">", "<", "<", "<"],
                ),
            )
        )
        out_threads.append({
            "index": thread_index,
            "label": p.thread_label(thread),
            "metric": args.metric,
            "rows": rows_json,
        })

    emit(args, {"threads": out_threads}, "\n\n".join(text_blocks))


def cmd_hot_stacks(p: Profile, args) -> None:
    selected = select_threads(p, args.thread, args.process_type)
    out_threads = []
    text_blocks = []
    for thread_index, thread in selected:
        samples = thread.get("samples") or {}
        stack_arr: List[Optional[int]] = samples.get("stack") or []
        weight = p.interval_ms
        counts: Dict[int, int] = defaultdict(int)
        for s_idx in stack_arr:
            if s_idx is None or s_idx < 0:
                continue
            counts[s_idx] += 1
        ranked = sorted(counts.items(), key=lambda kv: -kv[1])[: args.top]

        rows = []
        rows_json = []
        for stack_idx, n in ranked:
            funcs = p.stack_to_funcs(stack_idx)
            names = [p.func_name(f) or "(anonymous)" for f in funcs]
            depth = len(names)
            display = " ← ".join(names[: args.stack_depth])
            if depth > args.stack_depth:
                display += " ← …(+{0})".format(depth - args.stack_depth)
            rows.append([fmt_ms(n * weight), n, depth, display])
            rows_json.append({
                "samples": n,
                "ms": n * weight,
                "depth": depth,
                "frames": names,
            })
        text_blocks.append(
            "Thread {0} — {1}\n{2}".format(
                thread_index,
                p.thread_label(thread),
                render_table(
                    ["time", "samples", "depth", "stack (leaf ← root)"],
                    rows,
                    aligns=[">", ">", ">", "<"],
                    max_col=200,
                ),
            )
        )
        out_threads.append({
            "index": thread_index,
            "label": p.thread_label(thread),
            "rows": rows_json,
        })
    emit(args, {"threads": out_threads}, "\n\n".join(text_blocks))


def cmd_long_markers(p: Profile, args) -> None:
    selected = select_threads(p, args.thread, args.process_type)
    pattern = _compile_pattern(args.pattern, args.substring) if args.pattern else None
    rows_json: List[Dict[str, Any]] = []
    rows_text: List[List[Any]] = []

    for thread_index, thread in selected:
        markers = thread.get("markers") or {}
        names = markers.get("name") or []
        cats = markers.get("category") or []
        starts = markers.get("startTime") or []
        ends = markers.get("endTime") or []
        phases = markers.get("phase") or []
        datas = markers.get("data") or []
        n = markers.get("length") or len(names)
        for i in range(n):
            phase = phases[i] if i < len(phases) else 0
            if phase != 1:
                continue  # only interval markers have a duration
            start = starts[i] or 0
            end = ends[i] or 0
            dur = end - start
            if dur < args.min_ms:
                continue
            name = p.s(names[i])
            if pattern and not pattern.search(name):
                continue
            payload = datas[i] if i < len(datas) else None
            data_type = (payload or {}).get("type", "") if isinstance(payload, dict) else ""
            rows_text.append([
                fmt_ms(dur),
                "{0:.1f}".format(start),
                p.category(cats[i] if i < len(cats) else -1),
                name,
                data_type,
                thread_index,
            ])
            rows_json.append({
                "thread": thread_index,
                "name": name,
                "durationMs": dur,
                "startMs": start,
                "endMs": end,
                "category": p.category(cats[i] if i < len(cats) else -1),
                "dataType": data_type,
                "data": payload if args.include_data else None,
            })

    rows_json.sort(key=lambda r: -r["durationMs"])
    rows_text = []
    for r in rows_json[: args.top]:
        rows_text.append([
            fmt_ms(r["durationMs"]),
            "{0:.1f}".format(r["startMs"]),
            r["category"],
            r["name"],
            r["dataType"],
            r["thread"],
        ])

    text = render_table(
        ["duration", "startMs", "category", "name", "dataType", "thread"],
        rows_text,
        aligns=[">", ">", "<", "<", "<", ">"],
        max_col=120,
    )
    emit(args, {"rows": rows_json[: args.top], "minMs": args.min_ms}, text)


def cmd_marker_types(p: Profile, args) -> None:
    selected = select_threads(p, args.thread, args.process_type)
    pattern = _compile_pattern(args.pattern, args.substring) if args.pattern else None
    counts: Dict[str, int] = defaultdict(int)
    durations: Dict[str, float] = defaultdict(float)
    for _, thread in selected:
        markers = thread.get("markers") or {}
        names = markers.get("name") or []
        starts = markers.get("startTime") or []
        ends = markers.get("endTime") or []
        phases = markers.get("phase") or []
        n = markers.get("length") or len(names)
        for i in range(n):
            name = p.s(names[i])
            if pattern and not pattern.search(name):
                continue
            counts[name] += 1
            if i < len(phases) and phases[i] == 1:
                durations[name] += max(0.0, (ends[i] or 0) - (starts[i] or 0))
    rows = []
    for name in sorted(counts.keys(), key=lambda k: -durations.get(k, 0.0) - counts[k] * 1e-6):
        rows.append([counts[name], fmt_ms(durations.get(name, 0.0)), name])
    rows = rows[: args.top]
    text = render_table(["count", "totalDur", "name"], rows, aligns=[">", ">", "<"], max_col=160)
    emit(
        args,
        {"rows": [{"name": r[2], "count": r[0], "totalMs": durations[r[2]]} for r in rows]},
        text,
    )


def cmd_network(p: Profile, args) -> None:
    selected = select_threads(p, args.thread, args.process_type)
    rows_json: List[Dict[str, Any]] = []
    for thread_index, thread in selected:
        markers = thread.get("markers") or {}
        names = markers.get("name") or []
        starts = markers.get("startTime") or []
        ends = markers.get("endTime") or []
        phases = markers.get("phase") or []
        datas = markers.get("data") or []
        n = markers.get("length") or len(names)
        for i in range(n):
            payload = datas[i] if i < len(datas) else None
            if not isinstance(payload, dict) or payload.get("type") != "Network":
                continue
            start = starts[i] or 0
            end = ends[i] or 0
            dur = (end - start) if (i < len(phases) and phases[i] == 1) else 0.0
            url = payload.get("URI") or payload.get("uri") or payload.get("url") or ""
            rows_json.append({
                "thread": thread_index,
                "name": p.s(names[i]),
                "url": url,
                "status": payload.get("status"),
                "httpVersion": payload.get("httpVersion"),
                "redirectType": payload.get("redirectType"),
                "contentType": payload.get("contentType"),
                "responseStatus": payload.get("responseStatus"),
                "count": payload.get("count"),
                "startMs": start,
                "endMs": end,
                "durationMs": dur,
                "id": payload.get("id"),
                "pri": payload.get("pri"),
            })
    rows_json.sort(key=lambda r: -r["durationMs"])
    rows_json = rows_json[: args.top]
    rows_text = []
    for r in rows_json:
        rows_text.append([
            fmt_ms(r["durationMs"]),
            r["status"] or "",
            r["name"],
            (r["url"] or "")[: args.url_max],
        ])
    text = render_table(
        ["duration", "status", "phase", "url"],
        rows_text,
        aligns=[">", "<", "<", "<"],
        max_col=args.url_max + 4,
    )
    emit(args, {"rows": rows_json}, text)


def cmd_search_functions(p: Profile, args) -> None:
    if not args.pattern:
        raise SystemExit("--pattern is required for search-functions")
    pattern = _compile_pattern(args.pattern, args.substring)
    funcs = p.func_table
    n = funcs.get("length") or 0
    rows_json: List[Dict[str, Any]] = []
    for i in range(n):
        name = p.func_name(i)
        res = p.func_resource_name(i)
        if pattern.search(name) or (res and pattern.search(res)):
            rows_json.append({
                "func": i,
                "name": name,
                "resource": res,
                "isJS": p.func_is_js(i),
                "lineNumber": (funcs.get("lineNumber") or [None])[i] if funcs.get("lineNumber") else None,
            })
        if len(rows_json) >= args.top:
            break
    rows_text = [[r["func"], "JS" if r["isJS"] else "native", r["name"], r["resource"]] for r in rows_json]
    text = render_table(
        ["funcIdx", "kind", "name", "resource"],
        rows_text,
        aligns=[">", "<", "<", "<"],
        max_col=140,
    )
    emit(args, {"rows": rows_json}, text)


# ---------- helpers -----------------------------------------------------------

def _compile_pattern(pattern: str, substring: bool) -> "re.Pattern[str]":
    if substring:
        return re.compile(re.escape(pattern), re.IGNORECASE)
    try:
        return re.compile(pattern, re.IGNORECASE)
    except re.error as exc:
        raise SystemExit("invalid --pattern regex: {0}".format(exc))


# ---------- CLI ---------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Inspect Firefox Profiler JSON exports.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__.split("EXAMPLES", 1)[1].strip() if "EXAMPLES" in __doc__ else "",
    )
    parser.add_argument(
        "--profile",
        help="Path to *.json or *.json.gz. Defaults to $INSPECT_PROFILE or newest *profile*.json* in CWD.",
    )
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of text tables.")
    sub = parser.add_subparsers(dest="command")

    def common_filters(sp: argparse.ArgumentParser) -> None:
        sp.add_argument("--thread", action="append", default=[],
                        help="Restrict to thread NAME (substring) or INDEX. Repeatable. "
                             "Default: all GeckoMain threads.")
        sp.add_argument("--process-type", default=None,
                        help="Restrict to processType (e.g. default, tab, gpu).")
        sp.add_argument("--top", type=int, default=25)

    sp = sub.add_parser("summary", help="High-level overview (default).")

    sp = sub.add_parser("threads", help="List all threads.")

    sp = sub.add_parser("pages", help="List recorded pages.")
    sp.add_argument("--url-max", type=int, default=120)

    sp = sub.add_parser("categories", help="Sample-time breakdown by category.")
    common_filters(sp)

    sp = sub.add_parser("hot-functions", help="Top functions by own- or total-time.")
    common_filters(sp)
    sp.add_argument("--metric", choices=["own", "total"], default="own")
    sp.add_argument("--pattern", default=None, help="Regex (or --substring) filter on function/resource name.")
    sp.add_argument("--substring", action="store_true")

    sp = sub.add_parser("hot-stacks", help="Top stacks by sample weight.")
    common_filters(sp)
    sp.add_argument("--stack-depth", type=int, default=8, help="Frames shown per stack (default 8).")

    sp = sub.add_parser("long-markers", help="Markers with duration >= --min-ms.")
    common_filters(sp)
    sp.add_argument("--min-ms", type=float, default=50.0)
    sp.add_argument("--pattern", default=None)
    sp.add_argument("--substring", action="store_true")
    sp.add_argument("--include-data", action="store_true",
                    help="Include marker data payloads in --json output.")

    sp = sub.add_parser("marker-types", help="Group markers by name.")
    common_filters(sp)
    sp.add_argument("--pattern", default=None)
    sp.add_argument("--substring", action="store_true")

    sp = sub.add_parser("network", help="Network request markers.")
    common_filters(sp)
    sp.add_argument("--url-max", type=int, default=100)

    sp = sub.add_parser("search-functions", help="Search the function table.")
    sp.add_argument("--pattern", required=True)
    sp.add_argument("--substring", action="store_true")
    sp.add_argument("--top", type=int, default=50)

    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.command:
        args.command = "summary"

    if not args.profile:
        args.profile = default_profile_path()
        if not args.profile:
            sys.stderr.write(
                "error: no --profile given and no INSPECT_PROFILE env or *profile*.json file found\n"
            )
            return 2

    raw = load_profile(args.profile)
    p = Profile(raw)

    handler = {
        "summary": cmd_summary,
        "threads": cmd_threads,
        "pages": cmd_pages,
        "categories": cmd_categories,
        "hot-functions": cmd_hot_functions,
        "hot-stacks": cmd_hot_stacks,
        "long-markers": cmd_long_markers,
        "marker-types": cmd_marker_types,
        "network": cmd_network,
        "search-functions": cmd_search_functions,
    }[args.command]
    handler(p, args)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BrokenPipeError:
        # piping into `head` is the common case for agents
        sys.exit(0)
