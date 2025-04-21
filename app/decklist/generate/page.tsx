"use client";

import { useState } from "react";
import { Button, ToggleSwitch } from "flowbite-react";
import ToastNotification from "../../../components/ui/toast-notification";

export default function GenerateDeckList() {
  const [decklist, setDecklist] = useState("");
  const [deckType, setDeckType] = useState("type_1");
  const [name, setName] = useState("");
  const [event, setEvent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ url: string; message: string } | null>(null);
  const [showAlignment, setShowAlignment] = useState(false);

  const validateForm = (list: string, name: string, event: string): { valid: boolean; message?: string } => {
    if (!list.trim()) {
      return { valid: false, message: "Decklist cannot be empty" };
    }

    if (!name.trim()) {
      return { valid: false, message: "Name is required" };
    }

    if (name.length > 50) {
      return { valid: false, message: "Name must be 50 characters or less" };
    }

    if (!event.trim()) {
      return { valid: false, message: "Event is required" };
    }

    if (event.length > 100) {
      return { valid: false, message: "Event must be 100 characters or less" };
    }

    // Check reasonable length (e.g., max 10000 characters)
    if (list.length > 10000) {
      return { valid: false, message: "Decklist is too long" };
    }

    const lines = list.split("\n").filter(line => line.trim());
    
    // Check each non-empty line format
    for (const line of lines) {
      // Skip empty lines and "Reserve:" or "Tokens:" markers
      if (!line.trim() || line.trim() === "Reserve:" || line.trim() === "Tokens:") continue;
      
      // Each line should start with a number followed by whitespace and a card name
      const match = line.match(/^\d+[\t ]+.+/);
      if (!match) {
        return { 
          valid: false, 
          message: "Each line must start with a number, followed by spaces or a tab, then a card name" 
        };
      }
    }

    return { valid: true };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    
    const validation = validateForm(decklist, name, event);
    if (!validation.valid) {
      setError(validation.message || "Invalid form data");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_TOURNAMENT_API_ENDPOINT}/v1/generate-decklist`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          decklist,
          decklist_type: deckType,
          name,
          event,
          show_alignment: showAlignment,
        }),
      });

      const data = await response.json();

      if (data.status === "error") {
        throw new Error(data.message);
      }

      setSuccess({
        url: data.data.downloadUrl,
        message: data.message,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate decklist");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 w-full flex flex-col gap-6 max-w-2xl mx-auto p-5">
      <div className="w-full">
        <h2 className="text-2xl font-semibold mb-4">Generate Deck Check PDF</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Player Name
                <span className="text-xs text-gray-500 ml-2">
                  (Required)
                </span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full p-2 border rounded-md bg-background"
                placeholder="Your name"
                maxLength={50}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">
                Event
                <span className="text-xs text-gray-500 ml-2">
                  (Required)
                </span>
              </label>
              <input
                type="text"
                value={event}
                onChange={(e) => setEvent(e.target.value)}
                className="w-full p-2 border rounded-md bg-background"
                placeholder="Tournament or event name"
                maxLength={100}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Deck Type
              </label>
              <select
                value={deckType}
                onChange={(e) => setDeckType(e.target.value)}
                className="w-full p-2 border rounded-md bg-background"
              >
                <option value="type_1">Type 1</option>
                <option value="type_2">Type 2</option>
              </select>
            </div>
            
            <div className="flex flex-col gap-4">
              <label className="block text-sm font-medium">
                PDF Options
              </label>
              <div className="flex items-center justify-between">
                <ToggleSwitch
                  label="Show Card Alignments"
                  checked={showAlignment}
                  onChange={setShowAlignment}
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Lackey Decklist
              <span className="text-xs text-gray-500 ml-2">
                (Build a deck in{" "}
                <a 
                  href="https://landofredemption.com/installing-lackey-with-redemption-plugin/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:underline"
                >
                  Lackey
                </a>
                , then click the "Copy" button and paste here)
              </span>
            </label>
            <textarea
              value={decklist}
              onChange={(e) => setDecklist(e.target.value)}
              className="w-full h-64 p-2 font-mono text-sm border rounded-md bg-background"
              placeholder="1 Card Name [Set]"
            />
          </div>

          <Button 
            type="submit" 
            disabled={loading || !decklist.trim()}
            outline
            gradientDuoTone="greenToBlue"
            className="w-full flex items-center gap-3"
          >
            {loading ? "Generating..." : "Generate Deck Check PDF"}
          </Button>
        </form>

        {error && (
          <div className="mt-4">
            <ToastNotification
              message={error}
              type="error"
              show={!!error}
              onClose={() => setError(null)}
            />
          </div>
        )}

        {success && (
          <div className="mt-6">
            <div className="mt-4 p-8 bg-green-50 dark:bg-green-900/20 border-2 border-green-200 dark:border-green-900 rounded-lg flex flex-col items-center">
              <h3 className="text-2xl font-semibold text-green-700 dark:text-green-400 mb-4">
                🎉 Your Deck Check PDF is Ready!
              </h3>
              <Button
                onClick={() => window.open(success.url, '_blank')}
                gradientDuoTone="purpleToBlue"
                size="lg"
                className="font-semibold min-w-[200px] justify-center"
              >
                Download PDF
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}