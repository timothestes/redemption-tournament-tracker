"use client";
import React from "react";

interface MobileBottomNavProps {
  isDeckOpen: boolean;
  onToggleDeck: () => void;
  deckCardCount: number;
  onSaveDeck?: () => void;
  hasUnsavedChanges?: boolean;
  isSaving?: boolean;
  isAuthenticated?: boolean;
}

export function MobileBottomNav({
  isDeckOpen,
  onToggleDeck,
  deckCardCount,
  onSaveDeck,
  hasUnsavedChanges = false,
  isSaving = false,
  isAuthenticated = false,
}: MobileBottomNavProps) {
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex items-center justify-around h-14 pb-[env(safe-area-inset-bottom)]">
      <button
        onClick={() => { if (isDeckOpen) onToggleDeck(); }}
        className={`flex flex-col items-center gap-0.5 px-6 py-1.5 rounded-lg transition-colors ${
          !isDeckOpen
            ? "text-blue-600 dark:text-blue-400"
            : "text-gray-500 dark:text-gray-400"
        }`}
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <span className="text-xs font-medium">Search</span>
      </button>

      {isAuthenticated && onSaveDeck && deckCardCount > 0 && (
        <button
          onClick={onSaveDeck}
          disabled={isSaving || !hasUnsavedChanges}
          className={`relative flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-lg transition-colors ${
            isSaving
              ? "text-gray-400 dark:text-gray-500"
              : hasUnsavedChanges
                ? "text-green-600 dark:text-green-400"
                : "text-gray-400 dark:text-gray-500"
          }`}
        >
          {isSaving ? (
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
          )}
          <span className="text-[10px] font-medium">
            {isSaving ? "Saving" : "Save"}
          </span>
          {hasUnsavedChanges && !isSaving && (
            <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-green-500 rounded-full" />
          )}
        </button>
      )}

      <button
        onClick={onToggleDeck}
        className={`relative flex flex-col items-center gap-0.5 px-6 py-1.5 rounded-lg transition-colors ${
          isDeckOpen
            ? "text-purple-600 dark:text-purple-400"
            : "text-gray-500 dark:text-gray-400"
        }`}
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
        <span className="text-xs font-medium">Deck</span>
        {deckCardCount > 0 && (
          <span className="absolute -top-1 right-2 bg-purple-600 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
            {deckCardCount}
          </span>
        )}
      </button>
    </nav>
  );
}
