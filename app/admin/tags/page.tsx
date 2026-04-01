"use client";

import { useState, useEffect, useRef } from "react";
import { HexColorPicker } from "react-colorful";
import TopNav from "../../../components/top-nav";
import { useIsAdmin } from "../../../hooks/useIsAdmin";
import { useRouter } from "next/navigation";
import {
  createGlobalTagAction,
  updateGlobalTagAction,
  deleteGlobalTagAction,
  loadGlobalTagsAdminAction,
} from "./actions";

interface GlobalTag {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

function getContrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? "#1f2937" : "#ffffff";
}

function ColorPickerPopover({
  color,
  onChange,
}: {
  color: string;
  onChange: (c: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hexInput, setHexInput] = useState(color);
  const ref = useRef<HTMLDivElement>(null);

  // Keep input in sync when color changes externally (e.g. from the wheel)
  useEffect(() => {
    setHexInput(color);
  }, [color]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function handleHexInputChange(value: string) {
    setHexInput(value);
    // Only propagate when it looks like a valid full hex color
    const normalized = value.startsWith("#") ? value : `#${value}`;
    if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
      onChange(normalized);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-9 h-9 rounded-lg border-2 border-border shadow-sm flex-shrink-0 transition-transform hover:scale-105"
        style={{ backgroundColor: color }}
        title="Pick color"
      />
      {open && (
        <div className="absolute z-50 mt-2 left-0 shadow-xl rounded-xl border border-border bg-card p-3">
          <HexColorPicker color={color} onChange={onChange} />
          <div className="mt-2 flex items-center gap-2">
            <div
              className="w-6 h-6 rounded flex-shrink-0 border border-black/10"
              style={{ backgroundColor: color }}
            />
            <input
              type="text"
              value={hexInput}
              onChange={(e) => handleHexInputChange(e.target.value)}
              onBlur={() => setHexInput(color)} // reset display if invalid on blur
              placeholder="#6366f1"
              maxLength={7}
              className="flex-1 px-2 py-1 text-xs font-mono rounded border border-border bg-card focus:outline-none focus:ring-2 focus:ring-ring"
              spellCheck={false}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminTagsPage() {
  const { isAdmin, permissions, loading: adminLoading } = useIsAdmin();
  const canManageTags = isAdmin && permissions.includes('manage_tags');
  const router = useRouter();

  const [tags, setTags] = useState<GlobalTag[]>([]);
  const [loading, setLoading] = useState(true);

  // New tag form
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6366f1");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("#6366f1");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Deleting
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!adminLoading && !canManageTags) {
      router.replace("/");
    }
  }, [canManageTags, adminLoading, router]);

  useEffect(() => {
    if (!canManageTags) return;
    loadGlobalTagsAdminAction().then((res) => {
      if (res.success) setTags(res.tags as GlobalTag[]);
      setLoading(false);
    });
  }, [isAdmin]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    const res = await createGlobalTagAction(newName, newColor);
    setCreating(false);
    if (!res.success) {
      setCreateError(res.error || "Failed to create tag");
    } else {
      setNewName("");
      setNewColor("#6366f1");
      // Reload
      const reload = await loadGlobalTagsAdminAction();
      if (reload.success) setTags(reload.tags as GlobalTag[]);
    }
  }

  function startEdit(tag: GlobalTag) {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color);
    setEditError(null);
  }

  async function handleSaveEdit() {
    if (!editingId) return;
    setEditError(null);
    setSaving(true);
    const res = await updateGlobalTagAction(editingId, editName, editColor);
    setSaving(false);
    if (!res.success) {
      setEditError(res.error || "Failed to save");
    } else {
      setEditingId(null);
      const reload = await loadGlobalTagsAdminAction();
      if (reload.success) setTags(reload.tags as GlobalTag[]);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    const res = await deleteGlobalTagAction(id);
    setDeletingId(null);
    if (res.success) {
      setTags((prev) => prev.filter((t) => t.id !== id));
    }
  }

  if (adminLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400" />
      </div>
    );
  }

  if (!canManageTags) return null;

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <div className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold mb-1">Manage Tags</h1>
        <p className="text-sm text-muted-foreground mb-8">
          These tags are available for deck owners to apply to their decks.
        </p>

        {/* Create new tag */}
        <form onSubmit={handleCreate} className="mb-10 bg-card rounded-xl border border-border p-5 jayden-gradient-bg">
          <h2 className="text-base font-semibold mb-4">New Tag</h2>
          <div className="flex items-center gap-3">
            <ColorPickerPopover color={newColor} onChange={setNewColor} />
            <input
              type="text"
              placeholder="Tag name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={50}
              className="flex-1 px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div
              className="px-3 py-1.5 rounded-full text-sm font-medium flex-shrink-0"
              style={{
                backgroundColor: newColor,
                color: getContrastColor(newColor),
              }}
            >
              {newName || "Preview"}
            </div>
            <button
              type="submit"
              disabled={creating || !newName.trim()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex-shrink-0"
            >
              {creating ? "Creating…" : "Create"}
            </button>
          </div>
          {createError && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">{createError}</p>
          )}
        </form>

        {/* Tag list */}
        <div className="bg-card rounded-xl border border-border divide-y divide-border jayden-gradient-bg">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400" />
            </div>
          ) : tags.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">
              No tags yet. Create one above.
            </p>
          ) : (
            tags.map((tag) => (
              <div key={tag.id} className="flex items-center gap-3 px-5 py-3">
                {editingId === tag.id ? (
                  <>
                    <ColorPickerPopover color={editColor} onChange={setEditColor} />
                    <input
                      autoFocus
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      maxLength={50}
                      className="flex-1 px-3 py-1.5 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveEdit();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                    <div
                      className="px-3 py-1 rounded-full text-sm font-medium flex-shrink-0"
                      style={{
                        backgroundColor: editColor,
                        color: getContrastColor(editColor),
                      }}
                    >
                      {editName || "Preview"}
                    </div>
                    {editError && (
                      <span className="text-xs text-red-500">{editError}</span>
                    )}
                    <button
                      onClick={handleSaveEdit}
                      disabled={saving}
                      className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                    >
                      {saving ? "Saving…" : "Save"}
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-3 py-1.5 border border-border rounded-lg text-sm hover:bg-muted"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <div
                      className="w-5 h-5 rounded-full flex-shrink-0 border border-black/10"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span
                      className="px-2.5 py-0.5 rounded-full text-sm font-medium flex-shrink-0"
                      style={{
                        backgroundColor: tag.color,
                        color: getContrastColor(tag.color),
                      }}
                    >
                      {tag.name}
                    </span>
                    <span className="flex-1" />
                    <button
                      onClick={() => startEdit(tag)}
                      className="px-3 py-1.5 border border-border rounded-lg text-sm hover:bg-muted transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(tag.id)}
                      disabled={deletingId === tag.id}
                      className="px-3 py-1.5 border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 rounded-lg text-sm hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
                    >
                      {deletingId === tag.id ? "Deleting…" : "Delete"}
                    </button>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
