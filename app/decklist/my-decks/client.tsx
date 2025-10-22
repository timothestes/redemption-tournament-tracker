"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { 
  loadUserDecksAction, 
  deleteDeckAction, 
  duplicateDeckAction,
  loadUserFoldersAction,
  createFolderAction,
  renameFolderAction,
  deleteFolderAction,
  moveDeckToFolderAction,
  loadDeckByIdAction,
  DeckData,
  FolderData
} from "../actions";
import DeleteDeckModal from "./DeleteDeckModal";
import FolderModal from "./FolderModal";
import GeneratePDFModal from "../card-search/components/GeneratePDFModal";
import { Deck } from "../card-search/types/deck";
import { Card } from "../card-search/utils";

// Helper function to normalize deck format display
function formatDeckType(format?: string): string {
  if (!format) return "T1";
  const fmt = format.toLowerCase();
  if (fmt.includes("type 2") || fmt.includes("multi") || fmt === "t2") return "T2";
  return "T1";
}

// Helper function to get badge colors based on deck type
function getDeckTypeBadgeClasses(format?: string): string {
  const deckType = formatDeckType(format);
  if (deckType === "T2") {
    return "px-2 py-0.5 bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 rounded text-xs font-semibold";
  }
  return "px-2 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded text-xs font-semibold";
}

// Helper function to format date with time and timezone
function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  
  // Get timezone abbreviation
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tzAbbr = new Intl.DateTimeFormat('en-US', { 
    timeZoneName: 'short',
    timeZone: timezone
  }).formatToParts(date).find(part => part.type === 'timeZoneName')?.value || '';
  
  return `${month}/${day}/${year} ${hours}:${minutes}:${seconds} ${tzAbbr}`;
}

export default function MyDecksClient() {
  const router = useRouter();
  const [decks, setDecks] = useState<DeckData[]>([]);
  const [folders, setFolders] = useState<FolderData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [sortBy, setSortBy] = useState<"updated" | "created" | "name">("updated");
  const [deckToDelete, setDeckToDelete] = useState<{ id: string; name: string } | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null); // null = "My Decks"
  const [folderModal, setFolderModal] = useState<{ mode: "create" | "rename"; folderId?: string; initialName?: string } | null>(null);
  const [folderToDelete, setFolderToDelete] = useState<{ id: string; name: string } | null>(null);
  const [pdfDeck, setPdfDeck] = useState<Deck | null>(null); // For PDF generation modal

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);
    
    const [decksResult, foldersResult] = await Promise.all([
      loadUserDecksAction(),
      loadUserFoldersAction(),
    ]);
    
    if (decksResult.success) {
      setDecks(decksResult.decks);
    } else {
      setError(decksResult.error || "Failed to load decks");
    }
    
    if (foldersResult.success) {
      setFolders(foldersResult.folders);
    }
    
    setLoading(false);
  }

  async function handleDeleteDeck(deckId: string) {
    const result = await deleteDeckAction(deckId);
    if (result.success) {
      setDecks(decks.filter((d) => d.id !== deckId));
    } else {
      alert(result.error || "Failed to delete deck");
    }
  }

  async function handleDuplicateDeck(deckId: string) {
    const result = await duplicateDeckAction(deckId);
    if (result.success) {
      await loadData(); // Reload to show the new deck
    } else {
      alert(result.error || "Failed to duplicate deck");
    }
  }

  async function handleCreateFolder(name: string) {
    const result = await createFolderAction(name);
    if (result.success) {
      await loadData();
    } else {
      alert(result.error || "Failed to create folder");
    }
  }

  async function handleRenameFolder(folderId: string, newName: string) {
    const result = await renameFolderAction(folderId, newName);
    if (result.success) {
      await loadData();
    } else {
      alert(result.error || "Failed to rename folder");
    }
  }

  async function handleDeleteFolder(folderId: string) {
    const result = await deleteFolderAction(folderId);
    if (result.success) {
      setFolders(folders.filter((f) => f.id !== folderId));
      if (selectedFolder === folderId) {
        setSelectedFolder(null); // Go back to "My Decks"
      }
    } else {
      alert(result.error || "Failed to delete folder");
    }
  }

  async function handleMoveDeck(deckId: string, folderId: string | null) {
    const result = await moveDeckToFolderAction(deckId, folderId);
    if (result.success) {
      await loadData();
    } else {
      alert(result.error || "Failed to move deck");
    }
  }

  async function handleGeneratePDF(deckId: string) {
    // Load full deck data including cards
    const result = await loadDeckByIdAction(deckId);
    if (result.success && result.deck) {
      const cloudDeck = result.deck;
      
      // Convert to Deck format for PDF modal
      const deck: Deck = {
        id: cloudDeck.id,
        name: cloudDeck.name,
        description: cloudDeck.description || "",
        format: cloudDeck.format,
        folderId: cloudDeck.folder_id,
        cards: cloudDeck.cards.map((dbCard: any) => ({
          card: {
            name: dbCard.card_name,
            set: dbCard.card_set,
            imgFile: dbCard.card_img_file,
            // Minimal card data for PDF generation (just needs name for decklist)
            dataLine: "",
            officialSet: "",
            type: "",
            brigade: "",
            strength: "",
            toughness: "",
            class: "",
            identifier: "",
            specialAbility: "",
            rarity: "",
            reference: "",
            alignment: "",
            legality: "",
            testament: "",
            isGospel: false,
          } as Card,
          quantity: dbCard.quantity,
          isReserve: dbCard.is_reserve,
        })),
        createdAt: new Date(cloudDeck.created_at),
        updatedAt: new Date(cloudDeck.updated_at),
      };
      
      setPdfDeck(deck);
    } else {
      alert(result.error || "Failed to load deck");
    }
  }

  function handleNewDeck() {
    // If in a folder, pass folderId so the new deck is created in that folder
    if (selectedFolder) {
      router.push(`/decklist/card-search?folderId=${selectedFolder}&new=true`);
    } else {
      router.push("/decklist/card-search?new=true");
    }
  }

  function handleEditDeck(deckId: string) {
    router.push(`/decklist/card-search?deckId=${deckId}`);
  }

  // Filter decks based on selected folder
  const filteredDecks = selectedFolder === null 
    ? decks.filter(d => !d.folder_id) // Show uncategorized decks
    : decks.filter(d => d.folder_id === selectedFolder);

  // Sort decks
  const sortedDecks = [...filteredDecks].sort((a, b) => {
    switch (sortBy) {
      case "name":
        return a.name.localeCompare(b.name);
      case "created":
        return new Date(b.created_at!).getTime() - new Date(a.created_at!).getTime();
      case "updated":
      default:
        return new Date(b.updated_at!).getTime() - new Date(a.updated_at!).getTime();
    }
  });

  // Get selected folder name
  const selectedFolderName = selectedFolder 
    ? folders.find(f => f.id === selectedFolder)?.name || "Unknown Folder"
    : "My Decks";

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 dark:border-gray-100 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading your decks...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
          <button
            onClick={loadData}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-8">
      <div className="flex gap-6">
        {/* Left Sidebar - Folders */}
        <div className="w-64 flex-shrink-0">
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Folders</h2>
              <button
                onClick={() => setFolderModal({ mode: "create" })}
                className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                title="Create new folder"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>

            {/* My Decks (Uncategorized) */}
            <div
              onClick={() => setSelectedFolder(null)}
              className={`w-full text-left px-3 py-2 rounded-lg mb-1 transition-colors flex items-center gap-2 cursor-pointer ${
                selectedFolder === null
                  ? "bg-blue-100 dark:bg-blue-900/30 text-blue-900 dark:text-blue-100"
                  : "hover:bg-gray-100 dark:hover:bg-gray-700"
              }`}
            >
              <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <span className="flex-1">My Decks</span>
              <span className="text-sm text-gray-500">
                {decks.filter(d => !d.folder_id).length}
              </span>
            </div>

            {/* Folder List */}
            <div className="space-y-1">
              {folders.map((folder) => (
                <FolderItem
                  key={folder.id}
                  folder={folder}
                  isSelected={selectedFolder === folder.id}
                  deckCount={decks.filter(d => d.folder_id === folder.id).length}
                  onSelect={() => setSelectedFolder(folder.id!)}
                  onRename={() => setFolderModal({ mode: "rename", folderId: folder.id!, initialName: folder.name })}
                  onDelete={() => setFolderToDelete({ id: folder.id!, name: folder.name })}
                />
              ))}
            </div>

            {folders.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center mt-4">
                No folders yet.
                <br />
                Create one to organize your decks!
              </p>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold mb-2">{selectedFolderName}</h1>
              <p className="text-gray-600 dark:text-gray-400">
                {filteredDecks.length} {filteredDecks.length === 1 ? "deck" : "decks"}
              </p>
            </div>
            <button
              onClick={handleNewDeck}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"
            >
              + New Deck
            </button>
          </div>

          {/* Info Banner */}
          <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg flex items-start gap-3">
            <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <div>
              <p className="text-sm text-blue-800 dark:text-blue-200">
                <span className="font-semibold">Coming Soon:</span> Public deck sharing and community decklists are on the way!
              </p>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between mb-6 gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600 dark:text-gray-400">Sort by:</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-sm"
              >
                <option value="updated">Last Modified</option>
                <option value="created">Date Created</option>
                <option value="name">Name</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewMode("grid")}
                className={`p-2 rounded ${
                  viewMode === "grid"
                    ? "bg-gray-200 dark:bg-gray-700"
                    : "hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
                title="Grid view"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`p-2 rounded ${
                  viewMode === "list"
                    ? "bg-gray-200 dark:bg-gray-700"
                    : "hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
                title="List view"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* Decks Display */}
          {filteredDecks.length === 0 ? (
            <div className="text-center py-16">
              <svg
                className="mx-auto h-24 w-24 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
              <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-gray-100">
                No decks in {selectedFolderName.toLowerCase()}
              </h3>
              <p className="mt-2 text-gray-600 dark:text-gray-400">
                {selectedFolder ? "Create a new deck or move existing decks to this folder." : "Get started by creating your first deck!"}
              </p>
              <button
                onClick={handleNewDeck}
                className="mt-6 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"
              >
                Create A Deck
              </button>
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {sortedDecks.map((deck) => (
                <DeckCard
                  key={deck.id}
                  deck={deck}
                  folders={folders}
                  onEdit={handleEditDeck}
                  onDelete={(id, name) => setDeckToDelete({ id, name })}
                  onDuplicate={handleDuplicateDeck}
                  onMove={handleMoveDeck}
                  onGeneratePDF={handleGeneratePDF}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {sortedDecks.map((deck) => (
                <DeckListItem
                  key={deck.id}
                  deck={deck}
                  folders={folders}
                  onEdit={handleEditDeck}
                  onDelete={(id, name) => setDeckToDelete({ id, name })}
                  onDuplicate={handleDuplicateDeck}
                  onMove={handleMoveDeck}
                  onGeneratePDF={handleGeneratePDF}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deckToDelete && (
        <DeleteDeckModal
          deckName={deckToDelete.name}
          onConfirm={() => handleDeleteDeck(deckToDelete.id)}
          onClose={() => setDeckToDelete(null)}
        />
      )}

      {/* Folder Modal */}
      {folderModal && (
        <FolderModal
          mode={folderModal.mode}
          initialName={folderModal.initialName}
          onConfirm={(name) => {
            if (folderModal.mode === "create") {
              handleCreateFolder(name);
            } else if (folderModal.folderId) {
              handleRenameFolder(folderModal.folderId, name);
            }
          }}
          onClose={() => setFolderModal(null)}
        />
      )}

      {/* Delete Folder Confirmation */}
      {folderToDelete && (
        <DeleteDeckModal
          deckName={folderToDelete.name}
          onConfirm={() => handleDeleteFolder(folderToDelete.id)}
          onClose={() => setFolderToDelete(null)}
        />
      )}

      {/* Generate PDF Modal */}
      {pdfDeck && (
        <GeneratePDFModal
          deck={pdfDeck}
          onClose={() => setPdfDeck(null)}
        />
      )}
    </div>
  );
}

// Folder Item Component
function FolderItem({
  folder,
  isSelected,
  deckCount,
  onSelect,
  onRename,
  onDelete,
}: {
  folder: FolderData;
  isSelected: boolean;
  deckCount: number;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div className="relative">
      <div
        onClick={onSelect}
        className={`w-full text-left px-3 py-2 rounded-lg transition-colors flex items-center gap-2 cursor-pointer ${
          isSelected
            ? "bg-blue-100 dark:bg-blue-900/30 text-blue-900 dark:text-blue-100"
            : "hover:bg-gray-100 dark:hover:bg-gray-700"
        }`}
      >
        <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        <span className="flex-1 truncate">{folder.name}</span>
        <span className="text-sm text-gray-500">{deckCount}</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu(!showMenu);
          }}
          className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
          </svg>
        </button>
      </div>

      {showMenu && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
          <div className="absolute right-0 mt-1 w-48 bg-white dark:bg-gray-800 rounded-md shadow-lg border border-gray-200 dark:border-gray-700 z-20">
            <button
              onClick={() => {
                onRename();
                setShowMenu(false);
              }}
              className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 first:rounded-t-md"
            >
              Rename
            </button>
            <button
              onClick={() => {
                onDelete();
                setShowMenu(false);
              }}
              className="w-full text-left px-4 py-2 hover:bg-red-100 dark:hover:bg-red-900 text-red-600 dark:text-red-400 last:rounded-b-md"
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Deck Card Component (Grid View)
function DeckCard({
  deck,
  folders,
  onEdit,
  onDelete,
  onDuplicate,
  onMove,
  onGeneratePDF,
}: {
  deck: DeckData;
  folders: FolderData[];
  onEdit: (id: string) => void;
  onDelete: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onMove: (deckId: string, folderId: string | null) => void;
  onGeneratePDF: (deckId: string) => void;
}) {
  const updatedDate = formatDateTime(deck.updated_at!);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow">
      <div className="p-4">
        <div className="flex items-start justify-between mb-2">
          <h3 className="font-semibold text-lg truncate flex-1">{deck.name}</h3>
          <DropdownMenu
            folders={folders}
            currentFolderId={deck.folder_id}
            onEdit={() => onEdit(deck.id!)}
            onDelete={() => onDelete(deck.id!, deck.name)}
            onDuplicate={() => onDuplicate(deck.id!)}
            onMove={(folderId) => onMove(deck.id!, folderId)}
            onGeneratePDF={() => onGeneratePDF(deck.id!)}
          />
        </div>

        {deck.description && (
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-2">
            {deck.description}
          </p>
        )}

        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-3">
            <span className={getDeckTypeBadgeClasses(deck.format)}>
              {formatDeckType(deck.format)}
            </span>
            <span className="text-gray-600 dark:text-gray-400">
              {deck.card_count || 0} cards
            </span>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-500">
            Updated {updatedDate}
          </p>
        </div>
      </div>

      <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3">
        <button
          onClick={() => onEdit(deck.id!)}
          className="w-full px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 font-medium transition-colors"
        >
          Open Deck
        </button>
      </div>
    </div>
  );
}

// Deck List Item Component (List View)
function DeckListItem({
  deck,
  folders,
  onEdit,
  onDelete,
  onDuplicate,
  onMove,
  onGeneratePDF,
}: {
  deck: DeckData;
  folders: FolderData[];
  onEdit: (id: string) => void;
  onDelete: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onMove: (deckId: string, folderId: string | null) => void;
  onGeneratePDF: (deckId: string) => void;
}) {
  const updatedDate = formatDateTime(deck.updated_at!);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
      <div className="flex items-center gap-4 p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <span className={getDeckTypeBadgeClasses(deck.format)}>
              {formatDeckType(deck.format)}
            </span>
            <h3 className="font-semibold truncate">{deck.name}</h3>
          </div>
          {deck.description && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 truncate">
              {deck.description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-6 text-sm text-gray-600 dark:text-gray-400">
          <span>{deck.card_count || 0} cards</span>
          <span className="text-xs">Updated {updatedDate}</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onEdit(deck.id!)}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium transition-colors"
          >
            Edit
          </button>
          <DropdownMenu
            folders={folders}
            currentFolderId={deck.folder_id}
            onEdit={() => onEdit(deck.id!)}
            onDelete={() => onDelete(deck.id!, deck.name)}
            onDuplicate={() => onDuplicate(deck.id!)}
            onMove={(folderId) => onMove(deck.id!, folderId)}
            onGeneratePDF={() => onGeneratePDF(deck.id!)}
          />
        </div>
      </div>
    </div>
  );
}

// Dropdown Menu Component
function DropdownMenu({
  folders,
  currentFolderId,
  onEdit,
  onDelete,
  onDuplicate,
  onMove,
  onGeneratePDF,
}: {
  folders: FolderData[];
  currentFolderId?: string | null;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: (folderId: string | null) => void;
  onGeneratePDF: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [showMoveMenu, setShowMoveMenu] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => {
              setIsOpen(false);
              setShowMoveMenu(false);
            }}
          />
          <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-md shadow-lg border border-gray-200 dark:border-gray-700 z-20">
            <button
              onClick={() => {
                onEdit();
                setIsOpen(false);
              }}
              className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 first:rounded-t-md"
            >
              Edit
            </button>
            <button
              onClick={() => {
                onDuplicate();
                setIsOpen(false);
              }}
              className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              Duplicate
            </button>
            <button
              onClick={() => {
                onGeneratePDF();
                setIsOpen(false);
              }}
              className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              Generate PDF
            </button>
            
            {/* Move to Folder submenu */}
            <div className="relative">
              <button
                onClick={() => setShowMoveMenu(!showMoveMenu)}
                className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-between"
              >
                Move to...
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
              </button>
              
              {showMoveMenu && (
                <div className="absolute left-full top-0 ml-1 w-48 bg-white dark:bg-gray-800 rounded-md shadow-lg border border-gray-200 dark:border-gray-700 max-h-60 overflow-y-auto">
                  <button
                    onClick={() => {
                      onMove(null);
                      setIsOpen(false);
                      setShowMoveMenu(false);
                    }}
                    className={`w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 first:rounded-t-md ${
                      !currentFolderId ? "bg-blue-50 dark:bg-blue-900/20" : ""
                    }`}
                  >
                    📁 My Decks
                  </button>
                  {folders.map((folder) => (
                    <button
                      key={folder.id}
                      onClick={() => {
                        onMove(folder.id!);
                        setIsOpen(false);
                        setShowMoveMenu(false);
                      }}
                      className={`w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 last:rounded-b-md ${
                        currentFolderId === folder.id ? "bg-blue-50 dark:bg-blue-900/20" : ""
                      }`}
                    >
                      📁 {folder.name}
                    </button>
                  ))}
                  {folders.length === 0 && (
                    <div className="px-4 py-2 text-sm text-gray-500">
                      No folders available
                    </div>
                  )}
                </div>
              )}
            </div>
            
            <div className="border-t border-gray-200 dark:border-gray-700 my-1"></div>
            <button
              onClick={() => {
                onDelete();
                setIsOpen(false);
              }}
              className="w-full text-left px-4 py-2 hover:bg-red-100 dark:hover:bg-red-900 text-red-600 dark:text-red-400 last:rounded-b-md"
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
