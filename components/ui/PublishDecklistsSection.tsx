"use client";

import { useState } from "react";
import { BookOpen, Globe, Undo2 } from "lucide-react";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "./dialog";
import { publishTournamentDecklistsAction, unpublishTournamentDecklistsAction } from "../../app/tracker/tournaments/actions";

interface PublishDecklistsSectionProps {
  tournamentId: string;
  tournamentEnded: boolean;
  decklistCount: number;
  isPublished: boolean;
  currentFormat: string | null;
  onPublishChange: () => void;
}

export default function PublishDecklistsSection({
  tournamentId,
  tournamentEnded,
  decklistCount,
  isPublished,
  currentFormat,
  onPublishChange,
}: PublishDecklistsSectionProps) {
  const [showDialog, setShowDialog] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState(currentFormat || "Type 1");
  const [publishing, setPublishing] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);

  // Don't show if tournament hasn't ended or no decklists attached
  if (!tournamentEnded || decklistCount === 0) return null;

  async function handlePublish() {
    setPublishing(true);
    const result = await publishTournamentDecklistsAction(tournamentId, selectedFormat);
    setPublishing(false);
    if (result.success) {
      setShowDialog(false);
      onPublishChange();
    }
  }

  async function handleUnpublish() {
    setUnpublishing(true);
    const result = await unpublishTournamentDecklistsAction(tournamentId);
    setUnpublishing(false);
    if (result.success) {
      onPublishChange();
    }
  }

  if (isPublished) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-primary/5 border border-primary/20 rounded-lg">
        <Globe className="w-4 h-4 text-primary flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">
            {decklistCount} {decklistCount === 1 ? "decklist" : "decklists"} published
          </p>
          <p className="text-xs text-muted-foreground">
            Visible on community decks page · {currentFormat || "Type 1"}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleUnpublish}
          disabled={unpublishing}
          className="flex-shrink-0 gap-1.5"
        >
          <Undo2 className="w-3.5 h-3.5" />
          {unpublishing ? "Unpublishing..." : "Unpublish"}
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-3 bg-muted/50 border border-border rounded-lg">
        <BookOpen className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">
            {decklistCount} {decklistCount === 1 ? "decklist" : "decklists"} attached
          </p>
          <p className="text-xs text-muted-foreground">
            Publish to make them visible on the community decks page
          </p>
        </div>
        <Button
          variant="success"
          size="sm"
          onClick={() => setShowDialog(true)}
          className="flex-shrink-0 gap-1.5"
        >
          <Globe className="w-3.5 h-3.5" />
          Publish All
        </Button>
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Publish Tournament Decklists</DialogTitle>
            <DialogDescription>
              This will make all {decklistCount} attached {decklistCount === 1 ? "decklist" : "decklists"} public
              and calculate final placements.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Tournament Format
              </label>
              <select
                value={selectedFormat}
                onChange={(e) => setSelectedFormat(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm"
              >
                <option value="Type 1">Type 1</option>
                <option value="Type 2">Type 2</option>
                <option value="Paragon">Paragon</option>
                <option value="Other">Other</option>
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                This format will be shown alongside the tournament results
              </p>
            </div>
          </DialogBody>

          <DialogFooter className="justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDialog(false)}
            >
              Cancel
            </Button>
            <Button
              variant="success"
              size="sm"
              onClick={handlePublish}
              disabled={publishing}
              className="gap-1.5"
            >
              <Globe className="w-3.5 h-3.5" />
              {publishing ? "Publishing..." : "Publish All"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
