"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";
import ToastNotification from "@/components/ui/toast-notification";
import ArticleBody from "@/app/articles/components/ArticleBody";
import { EMPTY_REFS, type ArticleRefs } from "@/app/articles/lib/refTypes";
import { slugify, youtubeId } from "@/app/articles/lib/markdown";
import {
  createDraftAction,
  updatePostAction,
  publishPostAction,
  unpublishPostAction,
  deletePostAction,
  listTagsAction,
  resolveArticleRefsAction,
  type PostRow,
} from "../actions";
import { ACCEPT, type UploadKind } from "../lib/media";
import { uploadPostMedia } from "../lib/uploadMedia";
import { insertBlock, prefixLines, replaceOnce, wrapSelection, type EditResult } from "../lib/textarea";
import { MAX_EXCERPT, MAX_TITLE } from "../lib/validate";
import MarkdownToolbar, { type ToolbarAction } from "./MarkdownToolbar";
import TagInput from "./TagInput";
import CardPicker from "./CardPicker";
import DeckPicker from "./DeckPicker";

type Toast = { message: string; type: "success" | "error" } | null;
type Busy = null | "save" | "publish" | "unpublish" | "delete";

const LABEL = "block text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground";

// One editor for /admin/posts/new (initial = null) and /admin/posts/[id].
// The draft row is created lazily by ensureId() on the first save or upload;
// the URL is then rewritten in place with history.replaceState so the
// component keeps its state (a router.replace would remount it).
export default function PostEditor({ initial }: { initial: PostRow | null }) {
  const router = useRouter();
  const [id, setId] = useState<string | null>(initial?.id ?? null);
  const [status, setStatus] = useState<"draft" | "published">(initial?.status ?? "draft");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(initial !== null);
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [excerpt, setExcerpt] = useState(initial?.excerpt ?? "");
  const [cover, setCover] = useState<string | null>(initial?.cover_image_url ?? null);
  const [body, setBody] = useState(initial?.body_md ?? "");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  // Card picker: opened by the toolbar (the selection becomes the query) or
  // by typing "[[" (the two brackets are the range the pick replaces).
  const [cardPicker, setCardPicker] = useState<{ open: boolean; query: string; from: number; to: number }>({
    open: false,
    query: "",
    from: 0,
    to: 0,
  });
  const [deckPickerOpen, setDeckPickerOpen] = useState(false);
  // Resolved card mentions and deck embeds for the preview — the same
  // resolution the public page runs (app/articles/lib/refs.ts).
  const [refs, setRefs] = useState<ArticleRefs>(EMPTY_REFS);
  const refsSeq = useRef(0);

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const idRef = useRef<string | null>(id);
  // Coalesces concurrent ensureId() callers (e.g. picking an image and
  // clicking Save before the first createDraftAction round trip lands) onto
  // a single in-flight draft-creation promise so we never insert two rows.
  const creatingRef = useRef<Promise<{ id: string; slug: string } | null> | null>(null);
  // Bumped by every field change. save() snapshots it before the request and
  // only echoes the server's tags/slug back if nothing changed in flight.
  const editVersion = useRef(0);
  // ensureId() resolves asynchronously and is memoized, so it must read the
  // CURRENT slug state rather than whatever was captured when it was built.
  const slugRef = useRef(slug);
  const slugTouchedRef = useRef(slugTouched);
  slugRef.current = slug;
  slugTouchedRef.current = slugTouched;
  // The slug createDraftAction actually assigned, which may be suffixed
  // ("hello-2") when the derived one was already taken. onTitle clears it
  // whenever it re-derives the slug locally so it can never go stale.
  const serverSlugRef = useRef<string | null>(null);

  useEffect(() => {
    listTagsAction()
      .then((r) => {
        if (r.success !== false) setSuggestions(r.tags);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  useEffect(() => {
    if (!body.includes("[[") && !body.includes("/decklist/")) {
      setRefs(EMPTY_REFS);
      return;
    }
    const id = ++refsSeq.current;
    const t = window.setTimeout(async () => {
      try {
        const r = await resolveArticleRefsAction(body);
        if (id === refsSeq.current && r.success !== false) setRefs(r.refs);
      } catch {
        // The preview keeps the last good refs; the next edit retries.
      }
    }, 600);
    return () => window.clearTimeout(t);
  }, [body]);

  const fail = (message: string) => setToast({ message, type: "error" });

  const onTitle = (v: string) => {
    setTitle(v);
    // Once published the slug field is disabled (slugTouched can never flip
    // true), so this must not re-derive after publish or it silently poisons
    // the locked slug on the next save.
    if (status === "draft" && !slugTouched) {
      setSlug(slugify(v));
      serverSlugRef.current = null;
    }
    editVersion.current += 1;
    setDirty(true);
  };

  // Resolves the draft's id and its SERVER slug. createDraftAction may
  // suffix the slug on collision (e.g. "hello-2"), or fill in a derived slug
  // that came out empty (a CJK/emoji-only title), so the row's slug can
  // differ from the client-derived one still sitting in state. Reconciling
  // here rather than in save() means EVERY entry point gets it — the media
  // and cover pickers create the draft too, and a picker-created draft whose
  // slug was never reconciled made the next save fail with "That slug is
  // already taken" (or the slug regex, for the empty case).
  const ensureId = useCallback((): Promise<{ id: string; slug: string } | null> => {
    if (idRef.current) return Promise.resolve({ id: idRef.current, slug: serverSlugRef.current ?? slugRef.current });
    if (creatingRef.current) return creatingRef.current;
    const promise = (async (): Promise<{ id: string; slug: string } | null> => {
      try {
        const r = await createDraftAction({ title });
        if (r.success === false) {
          fail(r.error);
          return null;
        }
        idRef.current = r.post.id;
        setId(r.post.id);
        serverSlugRef.current = r.post.slug;
        // Lock the server's slug in when it differs, so a later title edit
        // doesn't re-derive the one that just collided.
        if (!slugTouchedRef.current) {
          setSlug(r.post.slug);
          if (r.post.slug !== slugRef.current) setSlugTouched(true);
        }
        window.history.replaceState(null, "", `/admin/posts/${r.post.id}`);
        return { id: r.post.id, slug: r.post.slug };
      } finally {
        creatingRef.current = null;
      }
    })();
    creatingRef.current = promise;
    return promise;
  }, [title]);

  const selection = () => {
    const el = bodyRef.current;
    return { start: el?.selectionStart ?? body.length, end: el?.selectionEnd ?? body.length };
  };

  const applyEdit = (res: EditResult) => {
    setBody(res.value);
    editVersion.current += 1;
    setDirty(true);
    requestAnimationFrame(() => {
      const el = bodyRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(res.selectionStart, res.selectionEnd);
    });
  };

  const onToolbar = (action: ToolbarAction) => {
    const sel = selection();
    switch (action) {
      case "bold":
        return applyEdit(wrapSelection(body, sel, "**"));
      case "italic":
        return applyEdit(wrapSelection(body, sel, "_"));
      case "heading":
        return applyEdit(prefixLines(body, sel, "## "));
      case "quote":
        return applyEdit(prefixLines(body, sel, "> "));
      case "list":
        return applyEdit(prefixLines(body, sel, "- "));
      case "link": {
        const url = window.prompt("Link URL");
        if (!url) return;
        return applyEdit(wrapSelection(body, sel, "[", `](${url.trim()})`, "link text"));
      }
      case "youtube": {
        const url = window.prompt("YouTube URL");
        if (!url) return;
        if (!youtubeId(url)) return fail("That doesn't look like a YouTube URL");
        return applyEdit(insertBlock(body, sel, url.trim()));
      }
      case "card":
        return setCardPicker({ open: true, query: body.slice(sel.start, sel.end).trim(), from: sel.start, to: sel.end });
      case "deck":
        return setDeckPickerOpen(true);
      case "image":
        return imageInput.current?.click();
      case "audio":
        return audioInput.current?.click();
    }
  };

  const refocusBody = () => {
    requestAnimationFrame(() => bodyRef.current?.focus());
  };

  const onPickCard = (name: string) => {
    const { from, to } = cardPicker;
    const text = `[[${name}]]`;
    const caret = from + text.length;
    setCardPicker((p) => ({ ...p, open: false }));
    applyEdit({ value: body.slice(0, from) + text + body.slice(to), selectionStart: caret, selectionEnd: caret });
  };

  const onPickDeck = (url: string) => {
    setDeckPickerOpen(false);
    applyEdit(insertBlock(body, selection(), url));
  };

  const onPickMedia = async (kind: UploadKind, files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    let postId: string;
    try {
      const draft = await ensureId();
      if (!draft) return;
      postId = draft.id;
    } catch {
      fail("Something went wrong. Check your connection and try again.");
      return;
    }
    const placeholder = kind === "image" ? `![Uploading ${file.name}…]()` : `[Uploading ${file.name}…]()`;
    setBody((b) => insertBlock(b, selection(), placeholder).value);
    editVersion.current += 1;
    setDirty(true);
    setUploading(true);
    try {
      const { url } = await uploadPostMedia(postId, file, kind);
      const label = file.name.replace(/\.[^.]+$/, "");
      const md = kind === "image" ? `![${label}](${url})` : `[${label}](${url})`;
      setBody((b) => replaceOnce(b, placeholder, md));
      editVersion.current += 1;
    } catch (e) {
      setBody((b) => replaceOnce(b, placeholder, ""));
      editVersion.current += 1;
      fail(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const onPickCover = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    let postId: string;
    try {
      const draft = await ensureId();
      if (!draft) return;
      postId = draft.id;
    } catch {
      fail("Something went wrong. Check your connection and try again.");
      return;
    }
    setUploading(true);
    try {
      const { url } = await uploadPostMedia(postId, file, "image");
      setCover(url);
      editVersion.current += 1;
      setDirty(true);
    } catch (e) {
      fail(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const save = async (): Promise<boolean> => {
    setBusy("save");
    const v = editVersion.current;
    try {
      const draft = await ensureId();
      if (!draft) return false;
      // On the very first save, ensureId() may have just created the draft
      // with a server-suffixed slug (title collision) that differs from the
      // client-derived one still in state — send the server's slug instead,
      // and lock it in so a later title edit doesn't re-derive the collision.
      let patchSlug = slug;
      if (!slugTouched) {
        patchSlug = draft.slug;
        setSlug(draft.slug);
        if (draft.slug !== slug) setSlugTouched(true);
      }
      const r = await updatePostAction(draft.id, {
        title,
        slug: patchSlug,
        excerpt: excerpt || null,
        body_md: body,
        cover_image_url: cover,
        tags,
      });
      if (r.success === false) {
        fail(r.error);
        return false;
      }
      // Only echo the server's tags/slug and clear dirty if nothing changed
      // while the request was in flight — otherwise we'd stomp a newer edit
      // and falsely tell the poster there's nothing left to save.
      if (editVersion.current === v) {
        setTags(r.post.tags);
        setSlug(r.post.slug);
        setDirty(false);
      }
      return true;
    } catch {
      fail("Something went wrong. Check your connection and try again.");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const onSave = async () => {
    if (await save()) setToast({ message: status === "published" ? "Updated" : "Draft saved", type: "success" });
  };

  const onPublish = async () => {
    if (!(await save())) return;
    setBusy("publish");
    try {
      const r = await publishPostAction(idRef.current!);
      if (r.success === false) return fail(r.error);
      setStatus("published");
      setToast({ message: "Published", type: "success" });
    } catch {
      fail("Something went wrong. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  const onUnpublish = async () => {
    setBusy("unpublish");
    try {
      const r = await unpublishPostAction(idRef.current!);
      if (r.success === false) return fail(r.error);
      setStatus("draft");
      setToast({ message: "Unpublished", type: "success" });
    } catch {
      fail("Something went wrong. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async () => {
    setBusy("delete");
    try {
      const r = await deletePostAction(idRef.current!);
      if (r.success === false) return fail(r.error);
      setDirty(false);
      router.push("/admin/posts");
    } catch {
      fail("Something went wrong. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  const locked = busy !== null || uploading;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/admin/posts" className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground">
            ← Posts
          </Link>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider ${
              status === "published" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
            }`}
          >
            {status}
          </span>
          {uploading ? (
            <span className="text-xs text-muted-foreground">Uploading…</span>
          ) : dirty ? (
            <span className="text-xs text-muted-foreground">Unsaved changes</span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {status === "published" && (
            <Button asChild variant="outline" className="min-h-11">
              <a href={`/articles/${slug}`} target="_blank" rel="noreferrer">
                View
              </a>
            </Button>
          )}
          <Button variant="outline" className="min-h-11" onClick={onSave} disabled={locked}>
            {status === "published" ? "Update" : "Save draft"}
          </Button>
          {status === "draft" ? (
            <Button className="min-h-11" onClick={onPublish} disabled={locked}>
              Publish
            </Button>
          ) : (
            <Button variant="outline" className="min-h-11" onClick={onUnpublish} disabled={locked}>
              Unpublish
            </Button>
          )}
          {id && (
            <Button variant="destructive" className="min-h-11" onClick={() => setConfirmDelete(true)} disabled={locked}>
              Delete
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Input
            value={title}
            onChange={(e) => onTitle(e.target.value)}
            placeholder="Title"
            maxLength={MAX_TITLE}
            aria-label="Title"
            className="h-12 text-lg font-semibold"
          />

          <div className="rounded-md bg-card">
            <div role="tablist" aria-label="Editor view" className="flex lg:hidden">
              {(["write", "preview"] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  type="button"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={`min-h-11 px-4 text-sm capitalize ${
                    tab === t ? "font-semibold text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="grid lg:grid-cols-2">
              <div className={tab === "write" ? "" : "hidden lg:block"}>
                <MarkdownToolbar onAction={onToolbar} disabled={locked} />
                <textarea
                  ref={bodyRef}
                  value={body}
                  onChange={(e) => {
                    const v = e.target.value;
                    setBody(v);
                    editVersion.current += 1;
                    setDirty(true);
                    // Typing "[[" opens the card picker; the pick replaces the brackets.
                    const caret = e.target.selectionStart;
                    if (caret >= 2 && v.slice(caret - 2, caret) === "[[" && v[caret - 3] !== "[" && v[caret] !== "[") {
                      setCardPicker({ open: true, query: "", from: caret - 2, to: caret });
                    }
                  }}
                  placeholder="Write in markdown… Type [[ to mention a card."
                  aria-label="Body"
                  spellCheck
                  className="min-h-[50vh] w-full resize-y bg-transparent p-3 font-mono text-sm leading-relaxed outline-none lg:min-h-[70vh]"
                />
              </div>
              <div className={`${tab === "preview" ? "" : "hidden lg:block"} rounded-b-md bg-muted/20 p-4 lg:rounded-r-md`}>
                {body.trim() ? (
                  <ArticleBody markdown={body} refs={refs} draft />
                ) : (
                  <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <label className={LABEL}>
            Slug
            <Input
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase());
                editVersion.current += 1;
                setDirty(true);
              }}
              disabled={status === "published"}
              className="mt-1 h-12 font-mono text-sm normal-case tracking-normal"
            />
            {status === "published" && <span className="mt-1 block normal-case tracking-normal">Locked after publishing</span>}
          </label>

          <div>
            <span className={LABEL}>Tags</span>
            <div className="mt-1">
              <TagInput
                value={tags}
                onChange={(t) => {
                  setTags(t);
                  editVersion.current += 1;
                  setDirty(true);
                }}
                suggestions={suggestions}
                disabled={locked}
              />
            </div>
          </div>

          <div>
            <span className={LABEL}>Cover image</span>
            {cover ? (
              <div className="mt-1 space-y-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={cover} alt="" className="w-full rounded-md object-cover" style={{ aspectRatio: "16 / 9" }} />
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  onClick={() => {
                    setCover(null);
                    editVersion.current += 1;
                    setDirty(true);
                  }}
                  disabled={locked}
                >
                  Remove cover
                </Button>
              </div>
            ) : (
              <Button variant="outline" className="mt-1 min-h-11" onClick={() => coverInput.current?.click()} disabled={locked}>
                Upload cover
              </Button>
            )}
          </div>

          <label className={LABEL}>
            Excerpt
            <textarea
              value={excerpt}
              onChange={(e) => {
                setExcerpt(e.target.value);
                editVersion.current += 1;
                setDirty(true);
              }}
              maxLength={MAX_EXCERPT}
              rows={4}
              placeholder="Optional. Defaults to the first 200 characters of the post."
              className="mt-1 w-full rounded-md bg-muted/40 p-2 text-sm normal-case tracking-normal text-foreground outline-none"
            />
          </label>
        </aside>
      </div>

      <input
        ref={imageInput}
        type="file"
        accept={ACCEPT.image}
        className="hidden"
        onChange={(e) => {
          void onPickMedia("image", e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={audioInput}
        type="file"
        accept={ACCEPT.audio}
        className="hidden"
        onChange={(e) => {
          void onPickMedia("audio", e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={coverInput}
        type="file"
        accept={ACCEPT.image}
        className="hidden"
        onChange={(e) => {
          void onPickCover(e.target.files);
          e.target.value = "";
        }}
      />

      <CardPicker
        open={cardPicker.open}
        initialQuery={cardPicker.query}
        onPick={onPickCard}
        onClose={() => {
          setCardPicker((p) => ({ ...p, open: false }));
          refocusBody();
        }}
      />
      <DeckPicker
        open={deckPickerOpen}
        onPick={onPickDeck}
        onClose={() => {
          setDeckPickerOpen(false);
          refocusBody();
        }}
      />
      <ConfirmationDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        onConfirm={onDelete}
        title="Delete this post?"
        description="This removes the post and its uploaded media. It cannot be undone."
        confirmLabel="Delete"
      />
      <ToastNotification
        show={toast !== null}
        message={toast?.message ?? ""}
        type={toast?.type}
        onClose={() => setToast(null)}
      />
    </div>
  );
}
