"use client";

import { Bold, Italic, Heading2, Quote, List, Link2, Image as ImageIcon, Youtube, Music, WalletCards, Layers } from "lucide-react";

export type ToolbarAction =
  | "bold"
  | "italic"
  | "heading"
  | "quote"
  | "list"
  | "link"
  | "card"
  | "deck"
  | "image"
  | "youtube"
  | "audio";

type ToolbarButton = { action: ToolbarAction; label: string; Icon: typeof Bold; shortcut?: string };

// Three groups (text, references, media) so the row reads at a glance.
// `shortcut` is the letter bound with Cmd/Ctrl in the editor's onKeyDown;
// it lands in `title` only, so the accessible name stays the bare label.
const GROUPS: ToolbarButton[][] = [
  [
    { action: "bold", label: "Bold", Icon: Bold, shortcut: "B" },
    { action: "italic", label: "Italic", Icon: Italic, shortcut: "I" },
    { action: "heading", label: "Heading", Icon: Heading2 },
    { action: "quote", label: "Quote", Icon: Quote },
    { action: "list", label: "Bulleted list", Icon: List },
  ],
  [
    { action: "link", label: "Link", Icon: Link2, shortcut: "K" },
    { action: "card", label: "Mention a card (or type [[)", Icon: WalletCards },
    { action: "deck", label: "Embed a deck", Icon: Layers },
  ],
  [
    { action: "image", label: "Upload image", Icon: ImageIcon },
    { action: "youtube", label: "Embed YouTube video", Icon: Youtube },
    { action: "audio", label: "Upload audio", Icon: Music },
  ],
];

export default function MarkdownToolbar({
  onAction,
  disabled,
}: {
  onAction: (action: ToolbarAction) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      // One row: 36px buttons fit the desktop write pane; touch devices keep
      // 44px targets (data-input-mode is set on <html> by useInputMode) and
      // scroll the row sideways instead of wrapping to a second line.
      className="no-scrollbar flex gap-3 overflow-x-auto rounded-t-md bg-muted/60 p-1 lg:flex-wrap lg:overflow-visible"
    >
      {GROUPS.map((group, i) => (
        <div key={i} className="flex shrink-0 gap-0.5">
          {group.map(({ action, label, Icon, shortcut }) => (
            <button
              key={action}
              type="button"
              title={shortcut ? `${label} (Ctrl+${shortcut} / \u2318${shortcut})` : label}
              aria-label={label}
              disabled={disabled}
              // Keep the textarea's focus and selection when a button is clicked.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onAction(action)}
              className="inline-flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-50 [html[data-input-mode=touch]_&]:h-11 [html[data-input-mode=touch]_&]:min-w-11"
            >
              <Icon className="h-5 w-5" aria-hidden />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
