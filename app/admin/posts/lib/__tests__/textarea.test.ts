import { describe, it, expect } from "vitest";
import { wrapSelection, prefixLines, insertBlock, replaceOnce } from "../textarea";

describe("wrapSelection", () => {
  it("wraps the selected text and keeps it selected", () => {
    const r = wrapSelection("hello world", { start: 6, end: 11 }, "**");
    expect(r.value).toBe("hello **world**");
    expect([r.selectionStart, r.selectionEnd]).toEqual([8, 13]);
  });
  it("inserts a placeholder when nothing is selected and selects it", () => {
    const r = wrapSelection("ab", { start: 1, end: 1 }, "_", "_", "text");
    expect(r.value).toBe("a_text_b");
    expect([r.selectionStart, r.selectionEnd]).toEqual([2, 6]);
  });
  it("supports asymmetric wrappers (links)", () => {
    const r = wrapSelection("see docs", { start: 4, end: 8 }, "[", "](https://x)");
    expect(r.value).toBe("see [docs](https://x)");
  });
});

describe("prefixLines", () => {
  it("prefixes every line touched by the selection", () => {
    const r = prefixLines("one\ntwo\nthree", { start: 5, end: 9 }, "- ");
    expect(r.value).toBe("one\n- two\n- three");
  });
  it("does not double a prefix that is already there", () => {
    expect(prefixLines("- a", { start: 0, end: 0 }, "- ").value).toBe("- a");
  });
  it("works on an empty document", () => {
    const r = prefixLines("", { start: 0, end: 0 }, "## ");
    expect(r.value).toBe("## ");
    expect(r.selectionStart).toBe(3);
  });
});

describe("insertBlock", () => {
  it("surrounds the block with blank lines mid-document", () => {
    const r = insertBlock("a\nb", { start: 1, end: 1 }, "https://youtu.be/x");
    expect(r.value).toBe("a\n\nhttps://youtu.be/x\n\nb");
    expect(r.selectionStart).toBe(r.selectionEnd);
  });
  it("does not add leading blank lines at the very start", () => {
    expect(insertBlock("", { start: 0, end: 0 }, "X").value).toBe("X\n");
  });
  it("does not duplicate blank lines that already exist", () => {
    expect(insertBlock("a\n\n\n\nb", { start: 3, end: 3 }, "X").value).toBe("a\n\nX\n\nb");
  });
});

describe("replaceOnce", () => {
  it("replaces only the first occurrence", () => {
    expect(replaceOnce("x [p]() y [p]()", "[p]()", "Z")).toBe("x Z y [p]()");
  });
  it("returns the input unchanged when the needle is absent", () => {
    expect(replaceOnce("abc", "zzz", "Q")).toBe("abc");
  });
});
