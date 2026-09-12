import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProposalRow } from "@/app/forge/lib/proposals";
import type { DesignCard } from "@/app/forge/lib/designCard";

// Server actions and the router are only reachable from the Accept/Deny handlers,
// which a static render never fires.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/app/forge/lib/proposals", () => ({ acceptProposal: vi.fn(), denyProposal: vi.fn() }));
vi.mock("@/app/forge/lib/comments", () => ({ addComment: vi.fn() }));

import ProposalDiff from "@/app/forge/cards/[cardId]/ProposalDiff";

const PROPOSED: DesignCard = {
  name: "Panic Demon",
  cardType: ["EvilCharacter"],
  brigades: ["Orange"],
  rawText: "If drafted, yell \"Panic Demon!\" and collect all other panic demons.",
};

const proposal = (baseVersionId: string | null): ProposalRow => ({
  id: "p1",
  cardId: "c1",
  baseVersionId,
  resultingVersionId: null,
  closedBy: null,
  summary: "Text obviously wont fit. But the idea is cool",
  status: "open",
  proposedSnapshot: PROPOSED,
  createdBy: "u1",
  createdAt: "2026-09-11T00:00:00Z",
  closedAt: null,
  proposerName: "Undude",
  approverName: null,
});

const render = (baseVersionId: string | null, current: DesignCard) =>
  renderToStaticMarkup(
    React.createElement(ProposalDiff, {
      proposal: proposal(baseVersionId),
      current,
      artUrl: "/forge/api/art?id=a1",
      finishedUrl: null,
      canReview: true,
      cardStatus: "draft",
    })
  );

describe("ProposalDiff card preview", () => {
  // A first proposal has no base version, so `current` arrives as {}. Pairing that
  // against the proposal put an art tile captioned "Untitled" with no body text in
  // the "Current" slot, which reads as a card that got wiped rather than as one
  // that does not exist yet.
  it("shows a single face for a new card, with no empty Current slot", () => {
    const html = render(null, {});
    expect(html).toContain("New card \u2014 first proposal");
    expect(html).toContain(">Card preview<");
    expect(html).not.toContain(">Current<");
    expect(html).not.toContain("Untitled");
    expect(html).toContain("Panic Demon");
  });

  it("still pairs Current against Proposed once the card has a released version", () => {
    const html = render("v1", { name: "Panic Demon", rawText: "Old text." });
    expect(html).toContain(">Current<");
    expect(html).toContain(">Proposed<");
    expect(html).not.toContain(">Card preview<");
    expect(html).toContain("Old text.");
  });
});
