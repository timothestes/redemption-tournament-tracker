"use client";

import { DeckCheckResult, DeckCheckIssue } from "@/utils/deckcheck/types";
import { DeckValidation } from "../utils/deckValidation";

interface DeckLegalityChecklistProps {
  clientValidation: DeckValidation;
  serverResult: DeckCheckResult | null;
  isChecking: boolean;
  totalCards: number;
  format?: string;
}

const T1_RULE_CATEGORIES = [
  {
    id: "structure",
    label: "Deck Structure",
    ruleIds: ["t1-deck-size", "t1-reserve-size", "t1-reserve-contents"],
  },
  {
    id: "lost-souls",
    label: "Lost Souls",
    ruleIds: ["t1-lost-soul-count"],
  },
  {
    id: "dominants",
    label: "Dominants",
    ruleIds: ["t1-dominant-limit", "t1-dominant-unique", "t1-mutual-exclusion"],
  },
  {
    id: "quantities",
    label: "Card Quantities",
    ruleIds: [
      "t1-quantity-multi-brigade",
      "t1-quantity-ls-ability",
      "t1-quantity-special-ability",
      "t1-quantity-vanilla",
      "t1-special-card",
    ],
  },
  {
    id: "banned",
    label: "Banned Cards",
    ruleIds: ["t1-banned-card"],
  },
  {
    id: "sites-cities",
    label: "Sites & Cities",
    ruleIds: ["t1-sites-cities"],
  },
];

const T2_RULE_CATEGORIES = [
  {
    id: "structure",
    label: "Deck Structure",
    ruleIds: ["t2-deck-size", "t2-reserve-size", "t1-reserve-contents"],
  },
  {
    id: "lost-souls",
    label: "Lost Souls",
    ruleIds: ["t2-lost-soul-count"],
  },
  {
    id: "dominants",
    label: "Dominants",
    ruleIds: ["t1-dominant-limit", "t1-dominant-unique", "t1-mutual-exclusion"],
  },
  {
    id: "quantities",
    label: "Card Quantities",
    ruleIds: [
      "t2-quantity-3plus-brigade",
      "t2-quantity-2-brigade",
      "t2-quantity-ls-ability",
      "t2-quantity-sa-site-city",
      "t2-quantity-artifact-fortress",
      "t2-quantity-character-enhancement",
      "t2-quantity-vanilla-site",
      "t1-special-card",
    ],
  },
  {
    id: "balance",
    label: "Good/Evil Balance",
    ruleIds: ["t2-good-evil-balance"],
  },
  {
    id: "banned",
    label: "Banned Cards",
    ruleIds: ["t1-banned-card"],
  },
  {
    id: "sites-cities",
    label: "Sites & Cities",
    ruleIds: ["t1-sites-cities"],
  },
];

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M11.667 3.5L5.25 9.917 2.333 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M10.5 3.5L3.5 10.5M3.5 3.5l7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className ?? ""}`} width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
      <path d="M12.5 7a5.5 5.5 0 00-5.5-5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function getIssuesForCategory(issues: DeckCheckIssue[], ruleIds: string[]): DeckCheckIssue[] {
  return issues.filter((issue) => ruleIds.includes(issue.rule));
}

function clientIssuesToDeckCheckIssues(validation: DeckValidation): DeckCheckIssue[] {
  return validation.issues.map((issue) => {
    let rule = "unknown";
    switch (issue.category) {
      case "size": rule = "t1-deck-size"; break;
      case "souls": rule = "t1-lost-soul-count"; break;
      case "dominants": rule = "t1-dominant-limit"; break;
      case "quantity": rule = "t1-quantity-vanilla"; break;
      case "reserve": rule = "t1-reserve-size"; break;
      case "format":
      case "paragon": rule = "t1-deck-size"; break;
    }
    return { type: issue.type, rule, message: issue.message };
  });
}

export default function DeckLegalityChecklist({
  clientValidation,
  serverResult,
  isChecking,
  totalCards,
  format,
}: DeckLegalityChecklistProps) {
  const isT2 = format?.toLowerCase().includes("type 2") || format?.toLowerCase().includes("multi");
  const categories = isT2 ? T2_RULE_CATEGORIES : T1_RULE_CATEGORIES;

  if (totalCards === 0) {
    return (
      <div className="rounded-lg bg-gray-800/30 px-4 py-3">
        <p className="text-xs text-gray-500">Empty Deck</p>
      </div>
    );
  }

  const useServer = serverResult !== null;
  const isValid = useServer ? serverResult.valid : clientValidation.isValid;
  const issues: DeckCheckIssue[] = useServer
    ? serverResult.issues
    : clientIssuesToDeckCheckIssues(clientValidation);

  const errorIssues = issues.filter((i) => i.type === "error");
  const errorCount = errorIssues.length;

  // Group errors by category for the error detail section
  const failedCategories = categories.map((cat) => {
    const catErrors = getIssuesForCategory(errorIssues, cat.ruleIds);
    return { ...cat, errors: catErrors };
  }).filter((cat) => cat.errors.length > 0);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div
        className={`rounded-lg px-4 py-3 ${
          isChecking && !useServer
            ? "bg-gray-800/30"
            : isValid
              ? "bg-green-950/40"
              : "bg-red-950/40"
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isChecking && !useServer ? (
              <>
                <Spinner className="text-gray-400" />
                <span className="text-sm font-semibold text-gray-400">Checking...</span>
              </>
            ) : isValid ? (
              <>
                <CheckIcon className="text-green-400" />
                <span className="text-sm font-semibold text-green-400">
                  {useServer ? "Tournament Legal" : "Passed Basic Checks"}
                </span>
              </>
            ) : (
              <>
                <XIcon className="text-red-400" />
                <span className="text-sm font-semibold text-red-400">
                  {errorCount} {errorCount === 1 ? "Issue" : "Issues"} Found
                </span>
              </>
            )}
          </div>
          <a
            href="https://landofredemption.com/wp-content/uploads/2026/03/Deck_Building_Rules_1.3.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
          >
            Rules v1.3
          </a>
        </div>

        {/* Category checklist — compact row */}
        <div className="grid grid-cols-3 gap-x-3 gap-y-1 mt-2.5">
          {categories.map((category) => {
            const hasFailed = getIssuesForCategory(errorIssues, category.ruleIds).length > 0;
            return (
              <div key={category.id} className="flex items-center gap-1">
                {hasFailed ? (
                  <XIcon className="shrink-0 text-red-400 w-3 h-3" />
                ) : (
                  <CheckIcon className="shrink-0 text-gray-600 w-3 h-3" />
                )}
                <span
                  className={`text-[11px] leading-none ${
                    hasFailed ? "text-red-400 font-medium" : "text-gray-600"
                  }`}
                >
                  {category.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Error details — separate section, only when there are failures */}
      {failedCategories.length > 0 && (
        <div className="space-y-2">
          {failedCategories.map((cat) => (
            <div key={cat.id} className="rounded-lg bg-red-950/20 px-4 py-2.5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <XIcon className="shrink-0 text-red-400 w-3.5 h-3.5" />
                <span className="text-xs font-semibold text-red-400">{cat.label}</span>
              </div>
              <div className="space-y-1.5 ml-5">
                {cat.errors.map((issue, idx) => (
                  <p key={idx} className="text-xs leading-snug text-red-300/80">
                    {issue.message}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
