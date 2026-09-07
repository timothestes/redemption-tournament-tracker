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

const BUTTONS: Array<{ action: ToolbarAction; label: string; Icon: typeof Bold }> = [
  { action: "bold", label: "Bold", Icon: Bold },
  { action: "italic", label: "Italic", Icon: Italic },
  { action: "heading", label: "Heading", Icon: Heading2 },
  { action: "quote", label: "Quote", Icon: Quote },
  { action: "list", label: "Bulleted list", Icon: List },
  { action: "link", label: "Link", Icon: Link2 },
  { action: "card", label: "Mention a card (or type [[)", Icon: WalletCards },
  { action: "deck", label: "Embed a deck", Icon: Layers },
  { action: "image", label: "Upload image", Icon: ImageIcon },
  { action: "youtube", label: "Embed YouTube video", Icon: Youtube },
  { action: "audio", label: "Upload audio", Icon: Music },
];

export default function MarkdownToolbar({
  onAction,
  disabled,
}: {
  onAction: (action: ToolbarAction) => void;
  disabled?: boolean;
}) {
  return (
    <div role="toolbar" aria-label="Formatting" className="flex flex-wrap gap-1 rounded-t-md bg-muted/60 p-1">
      {BUTTONS.map(({ action, label, Icon }) => (
        <button
          key={action}
          type="button"
          title={label}
          aria-label={label}
          disabled={disabled}
          // Keep the textarea's focus and selection when a button is clicked.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onAction(action)}
          className="inline-flex h-11 min-w-11 items-center justify-center rounded-md px-2 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-50"
        >
          <Icon className="h-5 w-5" aria-hidden />
        </button>
      ))}
    </div>
  );
}
