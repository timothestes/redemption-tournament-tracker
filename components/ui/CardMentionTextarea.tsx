"use client";

import { useState, type ChangeEvent, type RefObject, type TextareaHTMLAttributes } from "react";
import CardPicker from "@/components/ui/CardPicker";
import { opensCardPicker } from "@/app/articles/lib/markdown";
import { searchCardNames } from "@/lib/cards/search";

// A plain textarea where typing "[[" opens the card picker and a pick inserts
// `[[Card Name]]` — the article editor's move, minus its toolbar and undo
// stack, for surfaces that are just a box of markdown.
//
// Search runs in the browser against the generated card index. That index is
// already in the bundle everywhere this is used (the deck builder and the deck
// page both render cards from it); anywhere else it would be new weight.

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onChange: (next: string) => void;
  /** The caller's own ref, when it needs one (auto-resize, focus). */
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
};

const search = async (query: string) => searchCardNames(query, 12);

export default function CardMentionTextarea({ value, onChange, textareaRef, ...rest }: Props) {
  const [picker, setPicker] = useState({ open: false, from: 0, to: 0 });

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    const caret = e.target.selectionStart;
    onChange(next);
    if (opensCardPicker(next, caret, (e.nativeEvent as InputEvent).inputType)) {
      setPicker({ open: true, from: caret - 2, to: caret });
    }
  };

  // Replaces the "[[" that opened the picker, then puts the caret after the
  // mention so typing carries on where it left off.
  const onPick = (name: string) => {
    const text = `[[${name}]]`;
    const caret = picker.from + text.length;
    setPicker((p) => ({ ...p, open: false }));
    onChange(value.slice(0, picker.from) + text + value.slice(picker.to));
    requestAnimationFrame(() => {
      const el = textareaRef?.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  return (
    <>
      <textarea {...rest} ref={textareaRef} value={value} onChange={handleChange} />
      <CardPicker
        open={picker.open}
        initialQuery=""
        search={search}
        onPick={onPick}
        onClose={() => {
          setPicker((p) => ({ ...p, open: false }));
          requestAnimationFrame(() => textareaRef?.current?.focus());
        }}
      />
    </>
  );
}
