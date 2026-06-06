"use client";
import React, { useState, useEffect, useRef } from "react";
import CardImage from "./CardImage";
import type { Card } from "../utils";

interface SpotlightPanelProps {
  card: Card | null;
  price: number | null;
  onClear: () => void;
  player1Name: string;
  player2Name: string;
  player1Score: number;
  player2Score: number;
  onPlayer1NameChange: (name: string) => void;
  onPlayer2NameChange: (name: string) => void;
  onPlayer1ScoreChange: (score: number) => void;
  onPlayer2ScoreChange: (score: number) => void;
  onResetScoreboard: () => void;
}

function PlayerScore({
  name,
  score,
  onNameChange,
  onScoreChange,
}: {
  name: string;
  score: number;
  onNameChange: (name: string) => void;
  onScoreChange: (score: number) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(name);

  return (
    <div className="flex flex-col items-center min-w-0 flex-1">
      {/* Name */}
      {isEditing ? (
        <input
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={() => {
            onNameChange(editValue.trim() || name);
            setIsEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onNameChange(editValue.trim() || name);
              setIsEditing(false);
            }
          }}
          className="w-full text-center text-base font-medium bg-transparent border-b border-border outline-none text-foreground px-1 h-7 leading-7"
          autoFocus
        />
      ) : (
        <button
          onClick={() => {
            setEditValue(name);
            setIsEditing(true);
          }}
          className="text-base font-medium text-muted-foreground hover:text-foreground transition-colors truncate max-w-full cursor-text h-7 leading-7 border-b border-transparent"
          title="Click to edit name"
        >
          {name}
        </button>
      )}

      {/* Score */}
      <span className="text-5xl font-bold text-foreground tabular-nums mt-1">
        {score}
      </span>

      {/* +/- buttons */}
      <div className="flex items-center gap-3 mt-6">
        <button
          onClick={() => onScoreChange(Math.max(0, score - 1))}
          disabled={score <= 0}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-muted hover:bg-muted/70 text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label={`Decrease ${name} score`}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4" />
          </svg>
        </button>
        <button
          onClick={() => onScoreChange(Math.min(7, score + 1))}
          disabled={score >= 7}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-muted hover:bg-muted/70 text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label={`Increase ${name} score`}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function Scoreboard({
  player1Name,
  player2Name,
  player1Score,
  player2Score,
  onPlayer1NameChange,
  onPlayer2NameChange,
  onPlayer1ScoreChange,
  onPlayer2ScoreChange,
  onReset,
}: {
  player1Name: string;
  player2Name: string;
  player1Score: number;
  player2Score: number;
  onPlayer1NameChange: (name: string) => void;
  onPlayer2NameChange: (name: string) => void;
  onPlayer1ScoreChange: (score: number) => void;
  onPlayer2ScoreChange: (score: number) => void;
  onReset: () => void;
}) {
  return (
    <div className="w-full mt-6" style={{ maxWidth: "400px" }}>
      <div className="flex items-start gap-6 justify-center rounded-lg bg-muted/30 border border-border px-4 py-3">
        <PlayerScore
          name={player1Name}
          score={player1Score}
          onNameChange={onPlayer1NameChange}
          onScoreChange={onPlayer1ScoreChange}
        />
        <PlayerScore
          name={player2Name}
          score={player2Score}
          onNameChange={onPlayer2NameChange}
          onScoreChange={onPlayer2ScoreChange}
        />
      </div>
      <div className="flex justify-center mt-3">
        <button
          onClick={onReset}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

export default function SpotlightPanel({
  card,
  price,
  onClear,
  player1Name,
  player2Name,
  player1Score,
  player2Score,
  onPlayer1NameChange,
  onPlayer2NameChange,
  onPlayer1ScoreChange,
  onPlayer2ScoreChange,
  onResetScoreboard,
}: SpotlightPanelProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 relative">
      {/* Clear button — only when a card is spotlighted (absolute, no layout impact) */}
      {card && (
        <button
          onClick={onClear}
          className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-muted hover:bg-muted/70 text-muted-foreground hover:text-foreground transition-colors"
          title="Clear spotlight"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      {/* Card slot — same footprint whether empty or filled, so nothing shifts */}
      <div style={{ width: "min(100%, 400px)" }}>
        {card ? (
          <CardImage
            imgFile={card.imgFile}
            alt={card.name}
            className="rounded-xl w-full shadow-2xl transition-opacity duration-200"
            sizes="400px"
          />
        ) : (
          <div
            className="border-2 border-dashed border-border rounded-xl w-full"
            style={{ aspectRatio: "2.5 / 3.5" }}
          />
        )}
      </div>

      {/* Price — fixed-height row reserved in both states so the scoreboard never moves */}
      <p className="mt-3 h-7 flex items-center text-lg font-semibold text-muted-foreground">
        {card && price !== null ? `$${price.toFixed(2)}` : ""}
      </p>

      {/* Scoreboard */}
      <Scoreboard
        player1Name={player1Name}
        player2Name={player2Name}
        player1Score={player1Score}
        player2Score={player2Score}
        onPlayer1NameChange={onPlayer1NameChange}
        onPlayer2NameChange={onPlayer2NameChange}
        onPlayer1ScoreChange={onPlayer1ScoreChange}
        onPlayer2ScoreChange={onPlayer2ScoreChange}
        onReset={onResetScoreboard}
      />
    </div>
  );
}
