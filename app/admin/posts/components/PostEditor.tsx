"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";
import ToastNotification from "@/components/ui/toast-notification";
import ArticleBody from "@/app/articles/components/ArticleBody";
import { slugify, youtubeId } from "@/app/articles/lib/markdown";
import {
  createDraftAction,
  updatePostAction,
  publishPostAction,
  unpublishPostAction,
  deletePostAction,
  listTagsAction,
  type PostRow,
} from "../actions";
import { ACCEPT, type UploadKind } from "../lib/media";
import { uploadPostMedia } from "../lib/uploadMedia";
import { insertBlock, prefixLines, replaceOnce, wrapSelection, type EditResult } from "../lib/textarea";
import { MAX_EXCERPT, MAX_TITLE } from "../lib/validate";
import MarkdownToolbar, { type ToolbarAction } from "./MarkdownToolbar";
import TagInput from "./TagInput";

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

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const idRef = useRef<string | null>(id);

  useEffect(() => {
    listTagsAction().then((r) => {
      if (r.success !== false) setSuggestions(r.tags);
    });
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const fail = (message: string) => setToast({ message, type: "error" });

  const onTitle = (v: string) => {
    setTitle(v);
    if (!slugTouched) setSlug(slugify(v));
    setDirty(true);
  };

  const ensureId = useCallback(async (): Promise<string | null> => {
    if (idRef.current) return idRef.current;
    const r = await createDraftAction({ title });
    if (r.success === false) {
      fail(r.error);
      return null;
    }
    idRef.current = r.post.id;
    setId(r.post.id);
    setSlug((s) => s || r.post.slug);
    window.history.replaceState(null, "", `/admin/posts/${r.post.id}`);
    return r.post.id;
  }, [title]);

  const selection = () => {
    const el = bodyRef.current;
    return { start: el?.selectionStart ?? body.length, end: el?.selectionEnd ?? body.length };
  };

  const applyEdit = (res: EditResult) => {
    setBody(res.value);
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
      case "image":
        return imageInput.current?.click();
      case "audio":
        return audioInput.current?.click();
    }
  };

  const onPickMedia = async (kind: UploadKind, files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const postId = await ensureId();
    if (!postId) return;
    const placeholder = kind === "image" ? `![Uploading ${file.name}…]()` : `[Uploading ${file.name}…]()`;
    setBody((b) => insertBlock(b, selection(), placeholder).value);
    setDirty(true);
    setUploading(true);
    try {
      const { url } = await uploadPostMedia(postId, file, kind);
      const label = file.name.replace(/\.[^.]+$/, "");
      const md = kind === "image" ? `![${label}](${url})` : `[${label}](${url})`;
      setBody((b) => replaceOnce(b, placeholder, md));
    } catch (e) {
      setBody((b) => replaceOnce(b, placeholder, ""));
      fail(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const onPickCover = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const postId = await ensureId();
    if (!postId) return;
    setUploading(true);
    try {
      const { url } = await uploadPostMedia(postId, file, "image");
      setCover(url);
      setDirty(true);
    } catch (e) {
      fail(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const save = async (): Promise<boolean> => {
    setBusy("save");
    try {
      const postId = await ensureId();
      if (!postId) return false;
      const r = await updatePostAction(postId, {
        title,
        slug,
        excerpt: excerpt || null,
        body_md: body,
        cover_image_url: cover,
        tags,
      });
      if (r.success === false) {
        fail(r.error);
        return false;
      }
      setTags(r.post.tags);
      setSlug(r.post.slug);
      setDirty(false);
      return true;
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
                    setBody(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="Write in markdown…"
                  aria-label="Body"
                  spellCheck
                  className="min-h-[50vh] w-full resize-y bg-transparent p-3 font-mono text-sm leading-relaxed outline-none lg:min-h-[70vh]"
                />
              </div>
              <div className={`${tab === "preview" ? "" : "hidden lg:block"} rounded-b-md bg-muted/20 p-4 lg:rounded-r-md`}>
                {body.trim() ? (
                  <ArticleBody markdown={body} />
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
                setDirty(true);
              }}
              disabled={status === "published"}
              className="mt-1 font-mono text-sm normal-case tracking-normal"
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
