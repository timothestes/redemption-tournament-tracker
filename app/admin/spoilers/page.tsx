"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import TopNav from "../../../components/top-nav";
import { useIsAdmin } from "../../../hooks/useIsAdmin";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import ConfirmationDialog from "../../../components/ui/confirmation-dialog";
import {
  createSpoilerAction,
  loadSpoilersAdminAction,
  loadSpoilerSetsAdminAction,
  updateSpoilerAction,
  deleteSpoilerAction,
  deleteSpoilersBulkAction,
  updateVisibilityBulkAction,
  toggleSetVisibilityAction,
  type Spoiler,
} from "./actions";

/* ------------------------------------------------------------------ */
/*  Image upload drop zone                                             */
/* ------------------------------------------------------------------ */

function ImageDropZone({
  onFilesSelected,
  disabled,
}: {
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (disabled) return;
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith("image/")
      );
      if (files.length) onFilesSelected(files);
    },
    [onFilesSelected, disabled]
  );

  // Clipboard paste support — lets admins copy an image and paste it in
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (disabled) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length) {
        e.preventDefault();
        onFilesSelected(imageFiles);
      }
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [onFilesSelected, disabled]);

  return (
    <div
      ref={zoneRef}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`
        border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors
        ${dragOver ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/50"}
        ${disabled ? "opacity-50 cursor-not-allowed" : ""}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length) onFilesSelected(files);
          e.target.value = "";
        }}
      />
      <svg
        className="mx-auto h-8 w-8 text-muted-foreground/60 mb-2"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M12 16v-8m0 0l-3 3m3-3l3 3M3 16.5V18a2.5 2.5 0 002.5 2.5h13A2.5 2.5 0 0021 18v-1.5M16.5 7.5L12 3 7.5 7.5"
        />
      </svg>
      <p className="text-sm text-muted-foreground">
        <span className="hidden sm:inline">Drop images here, paste from clipboard, or click to browse</span>
        <span className="sm:hidden">Tap to select images or paste from clipboard</span>
      </p>
      <p className="text-xs text-muted-foreground/60 mt-1">
        JPEG, PNG, WebP, GIF up to 10MB
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Staging row (pre-publish preview)                                  */
/* ------------------------------------------------------------------ */

interface StagedFile {
  file: File;
  preview: string;
  cardName: string;
  setName: string;
  setNumber: string;
  spoilDate: string;
  uploading: boolean;
  error?: string;
}

function StagingRow({
  item,
  index,
  existingSets,
  defaultSetName,
  onChange,
  onRemove,
}: {
  item: StagedFile;
  index: number;
  existingSets: string[];
  defaultSetName: string;
  onChange: (index: number, updates: Partial<StagedFile>) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-3">
      {/* Mobile: image + remove in a top row, fields below */}
      {/* Desktop: image, fields, remove all in one row */}
      <div className="flex items-start gap-3">
        {/* Thumbnail with hover preview */}
        <div className="relative group/thumb flex-shrink-0">
          <div className="w-14 h-[78px] sm:w-16 sm:h-[90px] rounded overflow-hidden bg-muted cursor-pointer">
            <img
              src={item.preview}
              alt="Preview"
              className="w-full h-full object-contain"
            />
          </div>
          {/* Enlarged preview on hover / focus */}
          <div className="hidden group-hover/thumb:block absolute left-0 top-0 z-30 -translate-y-2 translate-x-16 sm:translate-x-20 pointer-events-none">
            <div className="w-48 sm:w-64 rounded-lg overflow-hidden shadow-xl border border-border bg-card">
              <img
                src={item.preview}
                alt="Enlarged preview"
                className="w-full h-auto object-contain"
              />
            </div>
          </div>
        </div>

        {/* On mobile: card name + set name side by side to save vertical space */}
        {/* On desktop: 2-col grid with all 4 fields */}
        <div className="flex-1 grid grid-cols-2 gap-2">
          <Input
            placeholder="Card name"
            value={item.cardName}
            onChange={(e) => onChange(index, { cardName: e.target.value })}
            disabled={item.uploading}
            className="col-span-2 sm:col-span-1"
          />
          <div className="relative col-span-2 sm:col-span-1">
            <Input
              placeholder="Set name"
              value={item.setName}
              onChange={(e) => onChange(index, { setName: e.target.value })}
              list={`set-suggestions-${index}`}
              disabled={item.uploading}
            />
            <datalist id={`set-suggestions-${index}`}>
              {existingSets.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <Input
            placeholder="Set # (optional)"
            value={item.setNumber}
            onChange={(e) => onChange(index, { setNumber: e.target.value })}
            disabled={item.uploading}
          />
          <Input
            type="date"
            value={item.spoilDate}
            onChange={(e) => onChange(index, { spoilDate: e.target.value })}
            disabled={item.uploading}
          />
        </div>

        {/* Remove button */}
        <button
          onClick={() => onRemove(index)}
          disabled={item.uploading}
          aria-label="Remove"
          className="min-w-[44px] min-h-[44px] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {item.error && (
        <p className="text-xs text-red-500 mt-2">{item.error}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main admin page                                                    */
/* ------------------------------------------------------------------ */

export default function AdminSpoilersPage() {
  const { isAdmin, permissions, loading: adminLoading } = useIsAdmin();
  const canManage = isAdmin && permissions.includes("manage_spoilers");
  const router = useRouter();

  const [spoilers, setSpoilers] = useState<Spoiler[]>([]);
  const [sets, setSets] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [setFilter, setSetFilter] = useState<string>("");

  // Default set name for new uploads
  const [defaultSetForUpload, setDefaultSetForUpload] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("spoiler_last_set") || "";
    }
    return "";
  });

  // Staging (upload queue)
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishSuccess, setPublishSuccess] = useState<string | null>(null);

  // Remember last used set name across sessions
  const [lastSetName, setLastSetName] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("spoiler_last_set") || "";
    }
    return "";
  });

  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // Inline edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ card_name: "", set_name: "", set_number: "", spoil_date: "" });
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    if (!adminLoading && !canManage) {
      router.replace("/");
    }
  }, [canManage, adminLoading, router]);

  const reload = useCallback(async () => {
    const [spoilersRes, setsRes] = await Promise.all([
      loadSpoilersAdminAction(setFilter || undefined),
      loadSpoilerSetsAdminAction(),
    ]);
    if (spoilersRes.success) setSpoilers(spoilersRes.spoilers);
    if (setsRes.success) setSets(setsRes.sets);
    setLoading(false);
  }, [setFilter]);

  useEffect(() => {
    if (!canManage) return;
    reload();
  }, [canManage, reload]);

  // -- File staging --
  const handleFilesSelected = (files: File[]) => {
    setPublishSuccess(null);
    const today = new Date().toISOString().split("T")[0];
    const defaultSet = defaultSetForUpload || setFilter || lastSetName || "";
    const newStaged: StagedFile[] = files.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      cardName: "",
      setName: defaultSet,
      setNumber: "",
      spoilDate: today,
      uploading: false,
    }));
    setStaged((prev) => [...prev, ...newStaged]);
  };

  const updateStaged = (index: number, updates: Partial<StagedFile>) => {
    setStaged((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...updates } : item))
    );
  };

  const removeStaged = (index: number) => {
    setStaged((prev) => {
      URL.revokeObjectURL(prev[index].preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  // -- Publish all staged --
  const handlePublishAll = async () => {
    // Validate all have card names and set names
    const invalid = staged.find((s) => !s.cardName.trim() || !s.setName.trim());
    if (invalid) {
      setPublishError("All cards need a name and set name.");
      return;
    }

    setPublishing(true);
    setPublishError(null);
    setPublishSuccess(null);

    // Remember the set name for next time
    const firstSetName = staged[0]?.setName.trim();
    if (firstSetName) {
      setLastSetName(firstSetName);
      setDefaultSetForUpload(firstSetName);
      localStorage.setItem("spoiler_last_set", firstSetName);
    }

    let publishedCount = 0;
    for (let i = 0; i < staged.length; i++) {
      const item = staged[i];
      updateStaged(i, { uploading: true, error: undefined });

      try {
        // Upload image to Vercel Blob
        const formData = new FormData();
        formData.append("file", item.file);
        const uploadRes = await fetch("/api/spoilers/upload", {
          method: "POST",
          body: formData,
        });

        if (!uploadRes.ok) {
          const err = await uploadRes.json();
          updateStaged(i, { uploading: false, error: err.error || "Upload failed" });
          continue;
        }

        const { url } = await uploadRes.json();

        // Get image dimensions
        const dims = await getImageDimensions(item.preview);

        // Create spoiler record
        const res = await createSpoilerAction({
          card_name: item.cardName.trim(),
          set_name: item.setName.trim(),
          set_number: item.setNumber.trim() || undefined,
          image_url: url,
          image_width: dims.width,
          image_height: dims.height,
          spoil_date: item.spoilDate,
        });

        if (!res.success) {
          updateStaged(i, { uploading: false, error: res.error || "Failed to save" });
          continue;
        }

        // Clean up this staged item
        URL.revokeObjectURL(item.preview);
        updateStaged(i, { uploading: false });
        publishedCount++;
      } catch {
        updateStaged(i, { uploading: false, error: "Unexpected error" });
      }
    }

    // Remove successfully published items
    setStaged((prev) => prev.filter((item) => !!item.error));
    setPublishing(false);
    if (publishedCount > 0) {
      setPublishSuccess(
        `Published ${publishedCount} card${publishedCount !== 1 ? "s" : ""} successfully.`
      );
    }
    await reload();
  };

  // -- Toggle visibility --
  const handleToggleVisibility = async (id: string, visible: boolean) => {
    await updateSpoilerAction(id, { visible });
    setSpoilers((prev) =>
      prev.map((s) => (s.id === id ? { ...s, visible } : s))
    );
  };

  // -- Edit spoiler --
  const startEdit = (spoiler: Spoiler) => {
    setEditingId(spoiler.id);
    setEditForm({
      card_name: spoiler.card_name,
      set_name: spoiler.set_name,
      set_number: spoiler.set_number || "",
      spoil_date: spoiler.spoil_date,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditSaving(false);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setEditSaving(true);
    const res = await updateSpoilerAction(editingId, {
      card_name: editForm.card_name,
      set_name: editForm.set_name,
      set_number: editForm.set_number || null,
      spoil_date: editForm.spoil_date,
    });
    setEditSaving(false);
    if (res.success) {
      setSpoilers((prev) =>
        prev.map((s) =>
          s.id === editingId
            ? { ...s, card_name: editForm.card_name.trim(), set_name: editForm.set_name.trim(), set_number: editForm.set_number.trim() || null, spoil_date: editForm.spoil_date }
            : s
        )
      );
      setEditingId(null);
    }
  };

  // -- Toggle set visibility --
  const handleToggleSetVisibility = async (setName: string, visible: boolean) => {
    await toggleSetVisibilityAction(setName, visible);
    await reload();
  };

  // -- Delete --
  const handleDelete = async (id: string) => {
    // Delete blob image
    const spoiler = spoilers.find((s) => s.id === id);
    if (spoiler) {
      await fetch("/api/spoilers/upload", {
        method: "DELETE",
        body: JSON.stringify({ url: spoiler.image_url }),
        headers: { "Content-Type": "application/json" },
      });
    }

    await deleteSpoilerAction(id);
    setSpoilers((prev) => prev.filter((s) => s.id !== id));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  // -- Bulk visibility --
  const handleBulkVisibility = async (visible: boolean) => {
    const ids = Array.from(selected);
    await updateVisibilityBulkAction(ids, visible);
    setSpoilers((prev) =>
      prev.map((s) => (ids.includes(s.id) ? { ...s, visible } : s))
    );
  };

  // -- Bulk delete --
  const handleBulkDelete = async () => {
    const ids = Array.from(selected);

    // Delete blob images
    for (const id of ids) {
      const spoiler = spoilers.find((s) => s.id === id);
      if (spoiler) {
        await fetch("/api/spoilers/upload", {
          method: "DELETE",
          body: JSON.stringify({ url: spoiler.image_url }),
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    await deleteSpoilersBulkAction(ids);
    setSelected(new Set());
    await reload();
  };

  // -- Selection --
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === spoilers.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(spoilers.map((s) => s.id)));
    }
  };

  if (adminLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-muted-foreground" />
      </div>
    );
  }

  if (!canManage) return null;

  // Group spoilers by set for display
  const spoilersBySet: Record<string, Spoiler[]> = {};
  for (const s of spoilers) {
    if (!spoilersBySet[s.set_name]) spoilersBySet[s.set_name] = [];
    spoilersBySet[s.set_name].push(s);
  }

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Manage Spoilers</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Upload and manage card spoilers for upcoming sets.
            </p>
          </div>
          <Badge variant="secondary">{spoilers.length} total</Badge>
        </div>

        {/* Upload zone */}
        <div className="mb-8 border border-border rounded-lg p-5 bg-card">
          <h2 className="text-base font-semibold mb-3">Add Spoilers</h2>

          {/* Default set name for new uploads */}
          <div className="mb-3">
            <div className="relative">
              <Input
                placeholder="Default set name for new uploads"
                value={defaultSetForUpload}
                onChange={(e) => setDefaultSetForUpload(e.target.value)}
                list="default-set-suggestions"
                disabled={publishing}
              />
              <datalist id="default-set-suggestions">
                {sets.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
          </div>

          <ImageDropZone onFilesSelected={handleFilesSelected} disabled={publishing} />

          {/* Success message */}
          {publishSuccess && staged.length === 0 && (
            <p className="mt-3 text-sm text-green-600 dark:text-green-400">{publishSuccess}</p>
          )}

          {/* Staged items */}
          {staged.length > 0 && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-muted-foreground">
                  {staged.length} card{staged.length !== 1 ? "s" : ""} ready to publish
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      staged.forEach((s) => URL.revokeObjectURL(s.preview));
                      setStaged([]);
                    }}
                    disabled={publishing}
                  >
                    Clear all
                  </Button>
                  <Button
                    size="sm"
                    onClick={handlePublishAll}
                    disabled={publishing || staged.length === 0}
                  >
                    {publishing ? "Publishing..." : `Publish ${staged.length} card${staged.length !== 1 ? "s" : ""}`}
                  </Button>
                </div>
              </div>

              {publishError && (
                <p className="text-sm text-red-500">{publishError}</p>
              )}

              {staged.map((item, i) => (
                <StagingRow
                  key={i}
                  item={item}
                  index={i}
                  existingSets={sets}
                  defaultSetName={setFilter}
                  onChange={updateStaged}
                  onRemove={removeStaged}
                />
              ))}
            </div>
          )}
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-3 mb-4">
          <select
            value={setFilter}
            onChange={(e) => setSetFilter(e.target.value)}
            className="h-10 rounded-md border-2 border-input bg-background px-3 text-sm"
          >
            <option value="">All sets</option>
            {sets.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          {selected.size > 0 && (() => {
            const selectedSpoilers = spoilers.filter((s) => selected.has(s.id));
            const allVisible = selectedSpoilers.every((s) => s.visible);
            const allHidden = selectedSpoilers.every((s) => !s.visible);
            return (
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-sm text-muted-foreground">
                  {selected.size} selected
                </span>
                {!allHidden && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleBulkVisibility(false)}
                  >
                    Hide selected
                  </Button>
                )}
                {!allVisible && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleBulkVisibility(true)}
                  >
                    Show selected
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-600 border-red-300 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-900/20"
                  onClick={() => setBulkDeleteOpen(true)}
                >
                  Delete selected
                </Button>
              </div>
            );
          })()}
        </div>

        {/* Spoiler list grouped by set */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-muted-foreground" />
          </div>
        ) : spoilers.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <p className="text-sm">No spoilers yet. Upload some above.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Select all */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selected.size === spoilers.length && spoilers.length > 0}
                onChange={selectAll}
                className="rounded border-input"
              />
              <span className="text-xs text-muted-foreground">Select all</span>
            </div>

            {Object.entries(spoilersBySet).map(([setName, setSpoilers]) => {
              const allVisible = setSpoilers.every((s) => s.visible);
              const someVisible = setSpoilers.some((s) => s.visible);
              return (
                <div key={setName} className="border border-border rounded-lg overflow-hidden">
                  {/* Set header */}
                  <div className="flex items-center justify-between px-4 py-3 bg-muted/50">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm">{setName}</h3>
                      <Badge variant="outline" className="text-xs">
                        {setSpoilers.length}
                      </Badge>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        handleToggleSetVisibility(setName, !allVisible)
                      }
                      className="text-xs"
                    >
                      {allVisible
                        ? "Hide all"
                        : someVisible
                          ? "Show all"
                          : "Show all"}
                    </Button>
                  </div>

                  {/* Cards table */}
                  <div className="divide-y divide-border">
                    {setSpoilers.map((spoiler) => (
                      <div key={spoiler.id}>
                        {editingId === spoiler.id ? (
                          /* Inline edit mode */
                          <div className="px-4 py-3 bg-muted/20">
                            <div className="flex items-start gap-3">
                              <div className="w-10 h-14 flex-shrink-0 rounded overflow-hidden bg-muted">
                                <Image
                                  src={spoiler.image_url}
                                  alt={spoiler.card_name}
                                  width={40}
                                  height={56}
                                  className="w-full h-full object-contain"
                                />
                              </div>
                              <div className="flex-1 grid grid-cols-2 gap-2">
                                <Input
                                  placeholder="Card name"
                                  value={editForm.card_name}
                                  onChange={(e) => setEditForm((f) => ({ ...f, card_name: e.target.value }))}
                                  disabled={editSaving}
                                  className="col-span-2 sm:col-span-1"
                                />
                                <div className="relative col-span-2 sm:col-span-1">
                                  <Input
                                    placeholder="Set name"
                                    value={editForm.set_name}
                                    onChange={(e) => setEditForm((f) => ({ ...f, set_name: e.target.value }))}
                                    list="edit-set-suggestions"
                                    disabled={editSaving}
                                  />
                                  <datalist id="edit-set-suggestions">
                                    {sets.map((s) => (
                                      <option key={s} value={s} />
                                    ))}
                                  </datalist>
                                </div>
                                <Input
                                  placeholder="Set # (optional)"
                                  value={editForm.set_number}
                                  onChange={(e) => setEditForm((f) => ({ ...f, set_number: e.target.value }))}
                                  disabled={editSaving}
                                />
                                <Input
                                  type="date"
                                  value={editForm.spoil_date}
                                  onChange={(e) => setEditForm((f) => ({ ...f, spoil_date: e.target.value }))}
                                  disabled={editSaving}
                                />
                              </div>
                            </div>
                            <div className="flex justify-end gap-2 mt-2">
                              <Button variant="outline" size="sm" onClick={cancelEdit} disabled={editSaving}>
                                Cancel
                              </Button>
                              <Button size="sm" onClick={saveEdit} disabled={editSaving || !editForm.card_name.trim() || !editForm.set_name.trim()}>
                                {editSaving ? "Saving..." : "Save"}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          /* Normal display row */
                          <div
                            className={`flex items-center gap-3 px-4 py-3 ${
                              !spoiler.visible ? "opacity-50" : ""
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selected.has(spoiler.id)}
                              onChange={() => toggleSelect(spoiler.id)}
                              className="rounded border-input flex-shrink-0 w-4 h-4"
                            />

                            {/* Thumbnail */}
                            <div className="w-10 h-14 flex-shrink-0 rounded overflow-hidden bg-muted">
                              <Image
                                src={spoiler.image_url}
                                alt={spoiler.card_name}
                                width={40}
                                height={56}
                                className="w-full h-full object-contain"
                              />
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">
                                {spoiler.card_name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {spoiler.set_number && (
                                  <span className="mr-2">{spoiler.set_number}</span>
                                )}
                                Spoil: {spoiler.spoil_date}
                              </p>
                            </div>

                            {/* Status */}
                            <Badge
                              variant={spoiler.visible ? "default" : "secondary"}
                              className="flex-shrink-0 text-xs cursor-pointer"
                              onClick={() =>
                                handleToggleVisibility(spoiler.id, !spoiler.visible)
                              }
                            >
                              {spoiler.visible ? "Visible" : "Hidden"}
                            </Badge>

                            {/* Edit */}
                            <button
                              onClick={() => startEdit(spoiler)}
                              aria-label="Edit spoiler"
                              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>

                            {/* Delete */}
                            <button
                              onClick={() => setDeleteTarget(spoiler.id)}
                              aria-label="Delete spoiler"
                              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-muted-foreground hover:text-red-500 transition-colors flex-shrink-0"
                            >
                              <svg
                                className="w-4 h-4"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                />
                              </svg>
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Delete confirmation dialog */}
        <ConfirmationDialog
          open={!!deleteTarget}
          onOpenChange={() => setDeleteTarget(null)}
          onConfirm={() => {
            if (deleteTarget) handleDelete(deleteTarget);
          }}
          title="Delete spoiler"
          description="This will permanently remove the spoiler and its image."
          confirmLabel="Delete"
        />

        {/* Bulk delete confirmation */}
        <ConfirmationDialog
          open={bulkDeleteOpen}
          onOpenChange={setBulkDeleteOpen}
          onConfirm={handleBulkDelete}
          title={`Delete ${selected.size} spoiler${selected.size !== 1 ? "s" : ""}?`}
          description="This will permanently remove all selected spoilers and their images."
          confirmLabel="Delete all"
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getImageDimensions(
  src: string
): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = src;
  });
}
