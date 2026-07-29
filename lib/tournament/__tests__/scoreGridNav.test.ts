import { describe, it, expect } from "vitest";
import {
  handleGridKey,
  stepLeft,
  stepRight,
  nextUnscored,
  type GridContext,
  type CellRef,
} from "../scoreGridNav";

const cell = (row: number, col: 0 | 1): CellRef => ({ row, col });

/** 4 rows, max 5, nothing scored yet, cursor at 0/P1. */
const ctx = (over: Partial<GridContext> = {}): GridContext => ({
  cursor: cell(0, 0),
  rowCount: 4,
  maxScore: 5,
  isRowComplete: () => false,
  ...over,
});

describe("stepRight / stepLeft", () => {
  it("moves P1 -> P2 within a row", () => {
    expect(stepRight(cell(1, 0), 4)).toEqual(cell(1, 1));
  });
  it("wraps P2 -> next row's P1", () => {
    expect(stepRight(cell(1, 1), 4)).toEqual(cell(2, 0));
  });
  it("returns null off the last cell", () => {
    expect(stepRight(cell(3, 1), 4)).toBeNull();
  });
  it("wraps P1 -> previous row's P2", () => {
    expect(stepLeft(cell(2, 0), 4)).toEqual(cell(1, 1));
  });
  it("returns null off the first cell", () => {
    expect(stepLeft(cell(0, 0), 4)).toBeNull();
  });
});

describe("nextUnscored", () => {
  it("finds the first incomplete row at or after the start", () => {
    const complete = (r: number) => r < 2;
    expect(nextUnscored(0, 4, complete)).toEqual(cell(2, 0));
  });
  it("wraps around to find an earlier gap", () => {
    const complete = (r: number) => r !== 1;
    expect(nextUnscored(2, 4, complete)).toEqual(cell(1, 0));
  });
  it("returns null when every row is scored", () => {
    expect(nextUnscored(0, 4, () => true)).toBeNull();
  });
});

describe("digit entry", () => {
  it("writes the digit and advances P1 -> P2", () => {
    expect(handleGridKey("3", ctx())).toEqual({
      kind: "write",
      at: cell(0, 0),
      value: 3,
      then: cell(0, 1),
    });
  });

  it("writes on P2 and advances to the next row's P1", () => {
    expect(handleGridKey("1", ctx({ cursor: cell(0, 1) }))).toEqual({
      kind: "write",
      at: cell(0, 1),
      value: 1,
      then: cell(1, 0),
    });
  });

  it("two keystrokes record a whole match and land on the next", () => {
    const first = handleGridKey("3", ctx());
    expect(first.kind).toBe("write");
    const afterFirst = first.kind === "write" ? first.then : cell(0, 0);
    const second = handleGridKey("1", ctx({ cursor: afterFirst }));
    expect(second).toEqual({
      kind: "write",
      at: cell(0, 1),
      value: 1,
      then: cell(1, 0),
    });
  });

  it("accepts a digit equal to max_score", () => {
    expect(handleGridKey("5", ctx()).kind).toBe("write");
  });

  it("rejects a digit above max_score without writing", () => {
    expect(handleGridKey("6", ctx())).toEqual({ kind: "reject", at: cell(0, 0) });
  });

  it("accepts 7 only when max_score is 7", () => {
    expect(handleGridKey("7", ctx({ maxScore: 5 })).kind).toBe("reject");
    expect(handleGridKey("7", ctx({ maxScore: 7 })).kind).toBe("write");
  });

  it("accepts 0", () => {
    expect(handleGridKey("0", ctx())).toMatchObject({ kind: "write", value: 0 });
  });

  it("parks on the first unscored row after filling the last cell", () => {
    // Rows 0 and 2 already done; we're finishing row 3, so row 1 is the gap.
    const action = handleGridKey(
      "2",
      ctx({
        cursor: cell(3, 1),
        isRowComplete: (r) => r === 0 || r === 2,
      }),
    );
    expect(action).toEqual({
      kind: "write",
      at: cell(3, 1),
      value: 2,
      then: cell(1, 0),
    });
  });

  it("holds position when the last cell completes the round", () => {
    const action = handleGridKey(
      "2",
      ctx({ cursor: cell(3, 1), isRowComplete: (r) => r !== 3 }),
    );
    expect(action).toEqual({
      kind: "write",
      at: cell(3, 1),
      value: 2,
      then: cell(3, 1),
    });
  });
});

describe("arrow navigation", () => {
  it("ArrowDown moves to the next row, same column", () => {
    expect(handleGridKey("ArrowDown", ctx({ cursor: cell(1, 1) }))).toEqual({
      kind: "move",
      to: cell(2, 1),
    });
  });

  it("ArrowUp moves to the previous row, same column", () => {
    expect(handleGridKey("ArrowUp", ctx({ cursor: cell(2, 0) }))).toEqual({
      kind: "move",
      to: cell(1, 0),
    });
  });

  it("clamps at the top and bottom instead of wrapping", () => {
    expect(handleGridKey("ArrowUp", ctx({ cursor: cell(0, 1) }))).toEqual({
      kind: "move",
      to: cell(0, 1),
    });
    expect(handleGridKey("ArrowDown", ctx({ cursor: cell(3, 0) }))).toEqual({
      kind: "move",
      to: cell(3, 0),
    });
  });

  it("ArrowLeft/Right wrap across row boundaries", () => {
    expect(handleGridKey("ArrowRight", ctx({ cursor: cell(1, 1) }))).toEqual({
      kind: "move",
      to: cell(2, 0),
    });
    expect(handleGridKey("ArrowLeft", ctx({ cursor: cell(2, 0) }))).toEqual({
      kind: "move",
      to: cell(1, 1),
    });
  });

  it("holds at the grid edges", () => {
    expect(handleGridKey("ArrowLeft", ctx({ cursor: cell(0, 0) }))).toEqual({
      kind: "move",
      to: cell(0, 0),
    });
    expect(handleGridKey("ArrowRight", ctx({ cursor: cell(3, 1) }))).toEqual({
      kind: "move",
      to: cell(3, 1),
    });
  });

  it("Home and End jump to the grid extremes", () => {
    expect(handleGridKey("Home", ctx({ cursor: cell(2, 1) }))).toEqual({
      kind: "move",
      to: cell(0, 0),
    });
    expect(handleGridKey("End", ctx({ cursor: cell(1, 0) }))).toEqual({
      kind: "move",
      to: cell(3, 1),
    });
  });
});

describe("Enter", () => {
  it("advances to the next row's P1 from either column", () => {
    expect(handleGridKey("Enter", ctx({ cursor: cell(1, 1) }))).toEqual({
      kind: "move",
      to: cell(2, 0),
    });
    expect(handleGridKey("Enter", ctx({ cursor: cell(1, 0) }))).toEqual({
      kind: "move",
      to: cell(2, 0),
    });
  });

  it("on the last row, jumps back to the first unscored row", () => {
    expect(
      handleGridKey(
        "Enter",
        ctx({ cursor: cell(3, 1), isRowComplete: (r) => r !== 2 }),
      ),
    ).toEqual({ kind: "move", to: cell(2, 0) });
  });

  it("on the last row with everything scored, holds position", () => {
    expect(
      handleGridKey("Enter", ctx({ cursor: cell(3, 0), isRowComplete: () => true })),
    ).toEqual({ kind: "move", to: cell(3, 0) });
  });
});

describe("clearing and exiting", () => {
  it("Backspace clears the cell without moving", () => {
    expect(handleGridKey("Backspace", ctx({ cursor: cell(2, 1) }))).toEqual({
      kind: "write",
      at: cell(2, 1),
      value: null,
      then: cell(2, 1),
    });
  });

  it("Delete behaves like Backspace", () => {
    expect(handleGridKey("Delete", ctx()).kind).toBe("write");
  });

  it("Escape reverts a dirty cell, then exits on the second press", () => {
    expect(handleGridKey("Escape", ctx({ isDirty: true }))).toEqual({
      kind: "revert",
      at: cell(0, 0),
    });
    expect(handleGridKey("Escape", ctx({ isDirty: false }))).toEqual({ kind: "exit" });
  });
});

describe("passthrough", () => {
  it("leaves Tab to the browser so native tab order still works", () => {
    expect(handleGridKey("Tab", ctx()).kind).toBe("passthrough");
  });

  it("ignores letters", () => {
    expect(handleGridKey("a", ctx()).kind).toBe("passthrough");
  });

  it("opens help on ?", () => {
    expect(handleGridKey("?", ctx()).kind).toBe("help");
  });

  it("does nothing at all when the round has no matches", () => {
    expect(handleGridKey("3", ctx({ rowCount: 0 })).kind).toBe("passthrough");
  });
});
