"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
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
  toggleDeckPublicAction,
  loadGlobalTagsAction,
  updateDeckPreviewCardsAction,
  DeckData,
  DeckCardData,
  FolderData,
  GlobalTag,
} from "../actions";
import { GoldfishButton } from "../../goldfish/components/GoldfishButton";
import DeleteDeckModal from "./DeleteDeckModal";
import FolderModal from "./FolderModal";
import UsernameModal from "./UsernameModal";
import GeneratePDFModal from "../card-search/components/GeneratePDFModal";
import GenerateDeckImageModal from "../card-search/components/GenerateDeckImageModal";
import { Deck } from "../card-search/types/deck";
import { Card } from "../card-search/utils";

// Helper function to normalize deck format display
function formatDeckType(format?: string): string {
  if (!format) return "T1";
  const fmt = format.toLowerCase();
  if (fmt.includes("paragon")) return "Paragon";
  if (fmt.includes("type 2") || fmt.includes("multi") || fmt === "t2") return "T2";
  return "T1";
}

// Helper function to get badge colors based on deck type
function getDeckTypeBadgeClasses(format?: string): string {
  const deckType = formatDeckType(format);
  if (deckType === "T2") {
    return "px-2 py-0.5 bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 rounded text-xs font-semibold";
  }
  if (deckType === "Paragon") {
    return "px-2 py-0.5 bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 rounded text-xs font-semibold";
  }
  return "px-2 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded text-xs font-semibold";
}

function getContrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? "#1f2937" : "#ffffff";
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
  const [searchQuery, setSearchQuery] = useState("");
  const [searchAllFolders, setSearchAllFolders] = useState(true);
  const [searchScopeOpen, setSearchScopeOpen] = useState(false);
  const searchScopeRef = useRef<HTMLDivElement>(null);
  const [deckToDelete, setDeckToDelete] = useState<{ id: string; name: string } | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null); // null = "My Decks"
  const [folderModal, setFolderModal] = useState<{ mode: "create" | "rename"; folderId?: string; initialName?: string } | null>(null);
  const [folderToDelete, setFolderToDelete] = useState<{ id: string; name: string } | null>(null);
  const [pdfDeck, setPdfDeck] = useState<Deck | null>(null); // For PDF generation modal
  const [pdfDeckLegal, setPdfDeckLegal] = useState<boolean | null>(null);
  const [imageDeck, setImageDeck] = useState<Deck | null>(null); // For image generation modal
  const [imageDeckLegal, setImageDeckLegal] = useState<boolean | null>(null);
  const [usernameModalDeckId, setUsernameModalDeckId] = useState<string | null>(null);
  const [coverPickerDeckId, setCoverPickerDeckId] = useState<string | null>(null);

  // Tag filter state
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [globalTags, setGlobalTags] = useState<GlobalTag[]>([]);
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const [tagFilterInput, setTagFilterInput] = useState("");
  const tagDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tagDropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) {
        setTagDropdownOpen(false);
        setTagFilterInput("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [tagDropdownOpen]);

  useEffect(() => {
    if (!searchScopeOpen) return;
    function handleClick(e: MouseEvent) {
      if (searchScopeRef.current && !searchScopeRef.current.contains(e.target as Node)) {
        setSearchScopeOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [searchScopeOpen]);

  useEffect(() => {
    loadGlobalTagsAction().then((res) => {
      if (res.success) setGlobalTags(res.tags);
    });
  }, []);

  function toggleTagFilter(tagId: string) {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  }

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

  async function handleTogglePublic(deckId: string, currentlyPublic: boolean) {
    const result = await toggleDeckPublicAction(deckId, !currentlyPublic);
    if (result.success) {
      setDecks(decks.map(d =>
        d.id === deckId ? { ...d, is_public: !currentlyPublic } : d
      ));
    } else if ((result as any).needsUsername) {
      setUsernameModalDeckId(deckId);
    } else {
      alert(result.error || "Failed to update deck visibility");
    }
  }

  async function handleUsernameSet(_username: string) {
    const deckId = usernameModalDeckId;
    setUsernameModalDeckId(null);
    if (deckId) {
      const result = await toggleDeckPublicAction(deckId, true);
      if (result.success) {
        setDecks(prev => prev.map(d =>
          d.id === deckId ? { ...d, is_public: true } : d
        ));
      } else {
        alert(result.error || "Failed to update deck visibility");
      }
    }
  }

  function handleCopyLink(deckId: string) {
    const url = `${window.location.origin}/decklist/${deckId}`;
    navigator.clipboard.writeText(url);
  }

  function handleViewPublic(deckId: string) {
    router.push(`/decklist/${deckId}`);
  }

  async function loadDeckForModal(deckId: string): Promise<{ deck: Deck; isLegal: boolean | null } | null> {
    const result = await loadDeckByIdAction(deckId);
    if (result.success && result.deck) {
      const cloudDeck = result.deck;
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
            dataLine: "", officialSet: "", type: "", brigade: "",
            strength: "", toughness: "", class: "", identifier: "",
            specialAbility: "", rarity: "", reference: "", alignment: "",
            legality: "", testament: "", isGospel: false,
          } as Card,
          quantity: dbCard.quantity,
          isReserve: dbCard.is_reserve,
        })),
        createdAt: new Date(cloudDeck.created_at),
        updatedAt: new Date(cloudDeck.updated_at),
      };
      return { deck, isLegal: cloudDeck.is_legal ?? null };
    }
    alert(result.error || "Failed to load deck");
    return null;
  }

  async function handleGeneratePDF(deckId: string) {
    const loaded = await loadDeckForModal(deckId);
    if (loaded) {
      setPdfDeck(loaded.deck);
      setPdfDeckLegal(loaded.isLegal);
    }
  }

  async function handleGenerateImage(deckId: string) {
    const loaded = await loadDeckForModal(deckId);
    if (loaded) {
      setImageDeck(loaded.deck);
      setImageDeckLegal(loaded.isLegal);
    }
  }

  async function handleDownload(deckId: string) {
    const result = await loadDeckByIdAction(deckId);
    if (!result.success || !result.deck) return;
    const cards = result.deck.cards as { card_name: string; quantity: number; is_reserve: boolean }[];
    const main = cards.filter((c) => !c.is_reserve).sort((a, b) => a.card_name.localeCompare(b.card_name));
    const reserve = cards.filter((c) => c.is_reserve).sort((a, b) => a.card_name.localeCompare(b.card_name));
    const lines: string[] = [];
    main.forEach((c) => lines.push(`${c.quantity}\t${c.card_name}`));
    if (reserve.length > 0) {
      lines.push("");
      lines.push("Reserve:");
      reserve.forEach((c) => lines.push(`${c.quantity}\t${c.card_name}`));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${result.deck.name.replace(/\s+/g, "_")}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
  const folderDecks = selectedFolder === null
    ? decks.filter(d => !d.folder_id)
    : decks.filter(d => d.folder_id === selectedFolder);

  // Apply search filter (search all folders or just current)
  const searchSource = searchQuery.trim() && searchAllFolders ? decks : folderDecks;
  const searchedDecks = searchQuery.trim()
    ? searchSource.filter(d => d.name.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : searchSource;

  // Apply tag filter (client-side)
  const filteredDecks = selectedTagIds.length === 0
    ? searchedDecks
    : searchedDecks.filter(d => d.tags && d.tags.some(t => selectedTagIds.includes(t.id)));

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
            className="px-4 py-2 bg-green-700 text-white rounded-md hover:bg-green-800"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-3 md:px-4 py-4 md:py-8 overflow-x-hidden">

      {/* Mobile folder strip (hidden on lg+) */}
      <div className="lg:hidden mb-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          <button
            onClick={() => setSelectedFolder(null)}
            className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              selectedFolder === null
                ? "bg-blue-600 text-white"
                : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            My Decks
            <span className={`text-xs ${selectedFolder === null ? "opacity-75" : "text-gray-400 dark:text-gray-500"}`}>
              {decks.filter(d => !d.folder_id).length}
            </span>
          </button>
          {folders.map((folder) => (
            <button
              key={folder.id}
              onClick={() => setSelectedFolder(folder.id!)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                selectedFolder === folder.id
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              {folder.name}
              <span className={`text-xs ${selectedFolder === folder.id ? "opacity-75" : "text-gray-400 dark:text-gray-500"}`}>
                {decks.filter(d => d.folder_id === folder.id).length}
              </span>
            </button>
          ))}
          <button
            onClick={() => setFolderModal({ mode: "create" })}
            className="flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium border border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            + Folder
          </button>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Left Sidebar - Folders (hidden on mobile) */}
        <div className="hidden lg:block w-64 flex-shrink-0">
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
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center justify-between mb-4 md:mb-8 gap-2">
            <div className="min-w-0">
              <h1 className="text-2xl md:text-3xl font-bold mb-1 md:mb-2 truncate">{selectedFolderName}</h1>
              <p className="text-sm md:text-base text-gray-600 dark:text-gray-400">
                {filteredDecks.length} {filteredDecks.length === 1 ? "deck" : "decks"}
                {selectedTagIds.length > 0 && ` · ${selectedTagIds.length} tag${selectedTagIds.length > 1 ? "s" : ""} selected`}
              </p>
            </div>
            <button
              onClick={handleNewDeck}
              className="flex-shrink-0 px-3 md:px-6 py-2 md:py-3 border-2 border-blue-500 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-lg text-sm md:text-base font-medium transition-colors"
            >
              + New
              <span className="hidden md:inline"> Deck</span>
            </button>
          </div>

          {/* Search Bar */}
          <div className="relative mb-3" ref={searchScopeRef}>
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder={searchAllFolders ? "Search all folders..." : `Search ${selectedFolderName.toLowerCase()}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-28 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
              <button
                onClick={() => setSearchScopeOpen(prev => !prev)}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-600"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <span className="whitespace-nowrap">{searchAllFolders ? "All" : "Folder"}</span>
                <svg className={`w-3 h-3 transition-transform ${searchScopeOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
            {searchScopeOpen && (
              <div className="absolute z-50 top-full mt-1 right-0 w-48 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl overflow-hidden">
                <button
                  onClick={() => { setSearchAllFolders(true); setSearchScopeOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left transition-colors ${
                    searchAllFolders ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100" : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                  }`}
                >
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  All folders
                  {searchAllFolders && (
                    <svg className="w-4 h-4 ml-auto text-gray-700 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
                <button
                  onClick={() => { setSearchAllFolders(false); setSearchScopeOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left transition-colors ${
                    !searchAllFolders ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100" : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                  }`}
                >
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  Current folder only
                  {!searchAllFolders && (
                    <svg className="w-4 h-4 ml-auto text-gray-700 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between mb-3 gap-2 md:gap-4">
            <div className="flex items-center gap-1.5 md:gap-2 min-w-0 flex-1">
              <label className="text-sm text-gray-600 dark:text-gray-400 hidden md:inline flex-shrink-0">Sort by:</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="px-2 md:px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-xs md:text-sm min-w-0"
              >
                <option value="updated">Last Modified</option>
                <option value="created">Date Created</option>
                <option value="name">Name</option>
              </select>

              {/* Tags dropdown */}
              {globalTags.length > 0 && (
                <div className="static sm:relative" ref={tagDropdownRef}>
                  <button
                    onClick={() => { setTagDropdownOpen((o) => !o); setTagFilterInput(""); }}
                    className={`flex items-center gap-1 md:gap-1.5 px-2 md:px-3 py-1.5 border rounded-lg text-xs md:text-sm transition-colors ${
                      selectedTagIds.length > 0
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                        : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                    }`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a2 2 0 012-2z" />
                    </svg>
                    <span className="hidden sm:inline">Tags</span>
                    {selectedTagIds.length > 0 && (
                      <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-xs font-semibold bg-blue-600 text-white">
                        {selectedTagIds.length}
                      </span>
                    )}
                    <svg className={`hidden sm:block w-3.5 h-3.5 transition-transform ${tagDropdownOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {tagDropdownOpen && (
                    <div className="fixed sm:absolute inset-x-3 sm:inset-x-auto z-50 top-auto sm:top-full mt-1.5 sm:left-0 w-auto sm:w-64 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl">
                      <div className="px-3 pt-3 pb-2 border-b border-gray-100 dark:border-gray-800">
                        <input
                          autoFocus
                          type="text"
                          placeholder="Filter tags…"
                          value={tagFilterInput}
                          onChange={(e) => setTagFilterInput(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div className="max-h-64 overflow-y-auto">
                        {globalTags.filter((t) => t.name.toLowerCase().includes(tagFilterInput.toLowerCase())).length === 0 ? (
                          <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">No matches</p>
                        ) : (
                          globalTags
                            .filter((t) => t.name.toLowerCase().includes(tagFilterInput.toLowerCase()))
                            .map((tag) => {
                              const active = selectedTagIds.includes(tag.id);
                              return (
                                <button
                                  key={tag.id}
                                  onClick={() => toggleTagFilter(tag.id)}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
                                >
                                  <span className="w-4 flex-shrink-0 flex items-center justify-center">
                                    {active && (
                                      <svg className="w-3.5 h-3.5 text-gray-700 dark:text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                      </svg>
                                    )}
                                  </span>
                                  <span className="w-3 h-3 rounded-full flex-shrink-0 border border-black/10" style={{ backgroundColor: tag.color }} />
                                  <span className="text-sm text-gray-800 dark:text-gray-200">{tag.name}</span>
                                </button>
                              );
                            })
                        )}
                      </div>
                      {selectedTagIds.length > 0 && (
                        <div className="border-t border-gray-100 dark:border-gray-800">
                          <button
                            onClick={() => setSelectedTagIds([])}
                            className="w-full px-3 py-2 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
                          >
                            Clear all tags
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
              <button
                onClick={() => setViewMode("grid")}
                className={`p-1.5 md:p-2 rounded ${
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
                className={`p-1.5 md:p-2 rounded ${
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

          {/* Active tag pills banner */}
          {selectedTagIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <span className="text-xs text-gray-500 dark:text-gray-400">Filtered by:</span>
              {selectedTagIds.map((id) => {
                const tag = globalTags.find((t) => t.id === id);
                if (!tag) return null;
                return (
                  <button
                    key={id}
                    onClick={() => toggleTagFilter(id)}
                    className="flex items-center gap-1 pl-2.5 pr-1.5 py-0.5 rounded-full text-xs font-medium"
                    style={{ backgroundColor: tag.color, color: getContrastColor(tag.color) }}
                  >
                    {tag.name}
                    <svg className="w-3 h-3 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                );
              })}
            </div>
          )}

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
                {searchQuery.trim()
                  ? `No decks matching "${searchQuery.trim()}"${searchAllFolders ? " across all folders" : ""}`
                  : selectedTagIds.length > 0
                    ? "No decks match the selected tags"
                    : `No decks in ${selectedFolderName.toLowerCase()}`}
              </h3>
              <p className="mt-2 text-gray-600 dark:text-gray-400">
                {searchQuery.trim()
                  ? "Try a different search term."
                  : selectedTagIds.length > 0
                    ? "Try removing some tag filters."
                    : selectedFolder ? "Create a new deck or move existing decks to this folder." : "Get started by creating your first deck!"}
              </p>
              <button
                onClick={handleNewDeck}
                className="mt-6 px-6 py-3 bg-green-700 text-white rounded-lg hover:bg-green-800 font-medium transition-colors"
              >
                Create A Deck
              </button>
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6">
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
                  onGenerateImage={handleGenerateImage}
                  onDownload={handleDownload}
                  onTogglePublic={handleTogglePublic}
                  onCopyLink={handleCopyLink}
                  onViewPublic={handleViewPublic}
                  onEditCover={(id) => setCoverPickerDeckId(id)}
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
                  onGenerateImage={handleGenerateImage}
                  onDownload={handleDownload}
                  onTogglePublic={handleTogglePublic}
                  onCopyLink={handleCopyLink}
                  onViewPublic={handleViewPublic}
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
          onClose={() => { setPdfDeck(null); setPdfDeckLegal(null); }}
          isLegal={pdfDeckLegal}
        />
      )}

      {/* Generate Image Modal */}
      {imageDeck && (
        <GenerateDeckImageModal
          deck={imageDeck}
          onClose={() => { setImageDeck(null); setImageDeckLegal(null); }}
          isLegal={imageDeckLegal}
        />
      )}

      {/* Username Modal */}
      {usernameModalDeckId && (
        <UsernameModal
          onSuccess={handleUsernameSet}
          onClose={() => setUsernameModalDeckId(null)}
        />
      )}

      {coverPickerDeckId && (() => {
        const coverDeck = decks.find(d => d.id === coverPickerDeckId);
        return coverDeck ? (
          <CoverPickerModal
            deckId={coverPickerDeckId}
            initialCard1={coverDeck.preview_card_1 ?? null}
            initialCard2={coverDeck.preview_card_2 ?? null}
            onClose={() => setCoverPickerDeckId(null)}
            onSaved={(deckId, card1, card2) => {
              setDecks(prev => prev.map(d =>
                d.id === deckId ? { ...d, preview_card_1: card1, preview_card_2: card2 } : d
              ));
            }}
          />
        ) : null;
      })()}
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
          aria-label="Folder menu"
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
function getCardImageUrl(cardName: string | null | undefined): string | null {
  if (!cardName) return null;
  const blobBase = process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  if (!blobBase) return null;
  const sanitized = cardName.replace(/\//g, "_");
  return `${blobBase}/card-images/${sanitized}.jpg`;
}

function DeckCard({
  deck,
  folders,
  onEdit,
  onDelete,
  onDuplicate,
  onMove,
  onGeneratePDF,
  onGenerateImage,
  onDownload,
  onTogglePublic,
  onCopyLink,
  onViewPublic,
  onEditCover,
}: {
  deck: DeckData;
  folders: FolderData[];
  onEdit: (id: string) => void;
  onDelete: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onMove: (deckId: string, folderId: string | null) => void;
  onGeneratePDF: (deckId: string) => void;
  onGenerateImage: (deckId: string) => void;
  onDownload: (deckId: string) => void;
  onTogglePublic: (deckId: string, currentlyPublic: boolean) => void;
  onCopyLink: (deckId: string) => void;
  onViewPublic: (deckId: string) => void;
  onEditCover: (deckId: string) => void;
}) {
  const updatedDate = formatDateTime(deck.updated_at!);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow flex flex-col">
      {/* Image Header */}
      {formatDeckType(deck.format) === "Paragon" && deck.paragon ? (
        <div className="h-32 overflow-hidden rounded-t-lg cursor-pointer" onClick={() => onEdit(deck.id!)}>
          <Image
            src={`/paragons/Paragon ${deck.paragon}.png`}
            alt={deck.paragon}
            width={400}
            height={560}
            className="w-full h-full object-cover object-top"
          />
        </div>
      ) : (getCardImageUrl(deck.preview_card_1) || getCardImageUrl(deck.preview_card_2)) ? (
        <div className="relative h-32 overflow-hidden rounded-t-lg bg-gray-100 dark:bg-gray-900 flex items-center justify-center gap-1 px-2 py-2 cursor-pointer" onClick={() => onEdit(deck.id!)}>
          {getCardImageUrl(deck.preview_card_1) && <img src={getCardImageUrl(deck.preview_card_1)!} alt="" className="h-full object-contain rounded" />}
          {getCardImageUrl(deck.preview_card_2) && <img src={getCardImageUrl(deck.preview_card_2)!} alt="" className="h-full object-contain rounded" />}
          <button
            onClick={(e) => { e.stopPropagation(); onEditCover(deck.id!); }}
            className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/30 hover:bg-black/50 text-white/60 hover:text-white transition-colors"
            title="Change cover cards"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      ) : formatDeckType(deck.format) !== "Paragon" ? (
        <div className="h-12 rounded-t-lg bg-gray-50 dark:bg-gray-800/50 flex items-center justify-center">
          <button
            onClick={() => onEditCover(deck.id!)}
            className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            title="Set cover cards"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14" />
            </svg>
            Add cover
          </button>
        </div>
      ) : null}

      <div className="p-4 flex-1 flex flex-col">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <h3 className="font-semibold text-lg truncate">{deck.name}</h3>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${
              deck.is_public
                ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
            }`}>
              {deck.is_public ? "Public" : "Private"}
            </span>
          </div>
          <DropdownMenu
            folders={folders}
            currentFolderId={deck.folder_id}
            isPublic={!!deck.is_public}
            onEdit={() => onEdit(deck.id!)}
            onDelete={() => onDelete(deck.id!, deck.name)}
            onDuplicate={() => onDuplicate(deck.id!)}
            onMove={(folderId) => onMove(deck.id!, folderId)}
            onGeneratePDF={() => onGeneratePDF(deck.id!)}
            onGenerateImage={() => onGenerateImage(deck.id!)}
            onDownload={() => onDownload(deck.id!)}
            onTogglePublic={() => onTogglePublic(deck.id!, !!deck.is_public)}
            onCopyLink={() => onCopyLink(deck.id!)}
            onViewPublic={() => onViewPublic(deck.id!)}
          />
        </div>

        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-3">
            <span className={getDeckTypeBadgeClasses(deck.format)}>
              {formatDeckType(deck.format)}
            </span>
            <span className="text-gray-600 dark:text-gray-400">
              {deck.card_count || 0} cards
            </span>
            {deck.total_price != null && deck.total_price > 0 && (
              <span className="text-green-600 dark:text-green-400">${deck.total_price.toFixed(2)}</span>
            )}
            {deck.budget_price != null && deck.total_price != null && deck.budget_price < deck.total_price - 0.005 && (
              <span className="text-[10px] text-muted-foreground" title={`Budget: $${deck.budget_price.toFixed(2)} with cheaper printings`}>
                ↓${(deck.total_price - deck.budget_price).toFixed(2)}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-1 mt-2 mb-3">
          {deck.tags && deck.tags.length > 0 ? (
            deck.tags.slice(0, 6).map((tag) => (
              <span
                key={tag.id}
                className="px-2 py-0.5 rounded-full text-xs font-medium"
                style={{ backgroundColor: tag.color, color: getContrastColor(tag.color) }}
              >
                {tag.name}
              </span>
            ))
          ) : (
            <span className="text-xs text-gray-400 dark:text-gray-500 italic">No tags yet...</span>
          )}
        </div>

        <div className="mt-auto pt-3 border-t border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-500">
            Updated {updatedDate}
          </p>
        </div>
      </div>

      <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3 flex gap-2">
        <button
          onClick={() => onEdit(deck.id!)}
          className="flex-1 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 font-medium transition-colors"
        >
          Open Deck
        </button>
        <GoldfishButton deckId={deck.id} deckName={deck.name} format={deck.format} iconOnly />
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
  onGenerateImage,
  onDownload,
  onTogglePublic,
  onCopyLink,
  onViewPublic,
}: {
  deck: DeckData;
  folders: FolderData[];
  onEdit: (id: string) => void;
  onDelete: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onMove: (deckId: string, folderId: string | null) => void;
  onGeneratePDF: (deckId: string) => void;
  onGenerateImage: (deckId: string) => void;
  onDownload: (deckId: string) => void;
  onTogglePublic: (deckId: string, currentlyPublic: boolean) => void;
  onCopyLink: (deckId: string) => void;
  onViewPublic: (deckId: string) => void;
}) {
  const updatedDate = formatDateTime(deck.updated_at!);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
      <div className="flex items-center gap-2 md:gap-4 p-3 md:p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 md:gap-3">
            <span className={getDeckTypeBadgeClasses(deck.format)}>
              {formatDeckType(deck.format)}
            </span>
            <h3 className="font-semibold truncate text-sm md:text-base">{deck.name}</h3>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${
              deck.is_public
                ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
            }`}>
              {deck.is_public ? "Public" : "Private"}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500 dark:text-gray-400 md:hidden">
            <span>{deck.card_count || 0} cards</span>
            {deck.total_price != null && deck.total_price > 0 && (
              <span className="text-green-600 dark:text-green-400">${deck.total_price.toFixed(2)}</span>
            )}
            {deck.budget_price != null && deck.total_price != null && deck.budget_price < deck.total_price - 0.005 && (
              <span className="text-[10px] text-muted-foreground" title={`Budget: $${deck.budget_price.toFixed(2)} with cheaper printings`}>
                ↓${(deck.total_price - deck.budget_price).toFixed(2)}
              </span>
            )}
          </div>
          {deck.tags && deck.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {deck.tags.slice(0, 6).map((tag) => (
                <span
                  key={tag.id}
                  className="px-2 py-0.5 rounded-full text-xs font-medium"
                  style={{ backgroundColor: tag.color, color: getContrastColor(tag.color) }}
                >
                  {tag.name}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="hidden md:flex items-center gap-6 text-sm text-gray-600 dark:text-gray-400">
          <span>{deck.card_count || 0} cards</span>
          {deck.total_price != null && deck.total_price > 0 && (
            <span className="text-green-600 dark:text-green-400">${deck.total_price.toFixed(2)}</span>
          )}
          {deck.budget_price != null && deck.total_price != null && deck.budget_price < deck.total_price - 0.005 && (
            <span className="text-xs text-muted-foreground" title={`Budget: $${deck.budget_price.toFixed(2)} with cheaper printings`}>
              ↓${(deck.total_price - deck.budget_price).toFixed(2)}
            </span>
          )}
          <span className="text-xs">Updated {updatedDate}</span>
        </div>

        <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
          <button
            onClick={() => onEdit(deck.id!)}
            className="px-2 md:px-4 py-1.5 md:py-2 bg-green-700 text-white rounded-md hover:bg-green-800 text-xs md:text-sm font-medium transition-colors"
          >
            Edit
          </button>
          <DropdownMenu
            folders={folders}
            currentFolderId={deck.folder_id}
            isPublic={!!deck.is_public}
            onEdit={() => onEdit(deck.id!)}
            onDelete={() => onDelete(deck.id!, deck.name)}
            onDuplicate={() => onDuplicate(deck.id!)}
            onMove={(folderId) => onMove(deck.id!, folderId)}
            onGeneratePDF={() => onGeneratePDF(deck.id!)}
            onGenerateImage={() => onGenerateImage(deck.id!)}
            onDownload={() => onDownload(deck.id!)}
            onTogglePublic={() => onTogglePublic(deck.id!, !!deck.is_public)}
            onCopyLink={() => onCopyLink(deck.id!)}
            onViewPublic={() => onViewPublic(deck.id!)}
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
  isPublic,
  onEdit,
  onDelete,
  onDuplicate,
  onMove,
  onGeneratePDF,
  onGenerateImage,
  onDownload,
  onTogglePublic,
  onCopyLink,
  onViewPublic,
}: {
  folders: FolderData[];
  currentFolderId?: string | null;
  isPublic: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: (folderId: string | null) => void;
  onGeneratePDF: () => void;
  onGenerateImage: () => void;
  onDownload: () => void;
  onTogglePublic: () => void;
  onCopyLink: () => void;
  onViewPublic: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function handleToggle() {
    if (!isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const menuHeight = 400; // conservative estimate for full menu
      const openUp = spaceBelow < menuHeight && rect.top > spaceBelow;

      setMenuStyle({
        position: "fixed" as const,
        right: window.innerWidth - rect.right,
        ...(openUp
          ? { bottom: window.innerHeight - rect.top + 4 }
          : { top: rect.bottom + 4 }),
        zIndex: 50,
      });
    }
    setIsOpen(!isOpen);
  }

  // Reposition on scroll/resize while open
  useEffect(() => {
    if (!isOpen || !buttonRef.current) return;
    function reposition() {
      if (!buttonRef.current) return;
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUp = spaceBelow < 400 && rect.top > spaceBelow;
      setMenuStyle({
        position: "fixed" as const,
        right: window.innerWidth - rect.right,
        ...(openUp
          ? { bottom: window.innerHeight - rect.top + 4 }
          : { top: rect.bottom + 4 }),
        zIndex: 50,
      });
    }
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [isOpen]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={handleToggle}
        className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => {
              setIsOpen(false);
              setShowMoveMenu(false);
            }}
          />
          <div
            ref={menuRef}
            style={menuStyle}
            className="w-52 bg-white dark:bg-gray-800 rounded-md shadow-lg border border-gray-200 dark:border-gray-700"
          >
            <button
              onClick={() => {
                onEdit();
                setIsOpen(false);
              }}
              className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 first:rounded-t-md flex items-center gap-2"
            >
              <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit
            </button>
            <button
              onClick={() => {
                onDuplicate();
                setIsOpen(false);
              }}
              className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
            >
              <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Duplicate
            </button>
            <button
              onClick={() => {
                onGeneratePDF();
                setIsOpen(false);
              }}
              className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
            >
              <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              Generate PDF
            </button>
            <button
              onClick={() => {
                onGenerateImage();
                setIsOpen(false);
              }}
              className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
            >
              <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Generate Image
            </button>
            <button
              onClick={() => {
                onDownload();
                setIsOpen(false);
              }}
              className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
            >
              <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download .txt
            </button>

            {/* Sharing section */}
            <div className="border-t border-gray-200 dark:border-gray-700 my-1"></div>
            <button
              onClick={() => {
                onTogglePublic();
                setIsOpen(false);
              }}
              className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
            >
              {isPublic ? (
                <>
                  <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  Make Private
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Make Public
                </>
              )}
            </button>
            {isPublic && (
              <>
                <button
                  onClick={() => {
                    onCopyLink();
                    setLinkCopied(true);
                    setTimeout(() => setLinkCopied(false), 2000);
                  }}
                  className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                >
                  <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  {linkCopied ? "Link Copied!" : "Copy Share Link"}
                </button>
                <button
                  onClick={() => {
                    onViewPublic();
                    setIsOpen(false);
                  }}
                  className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                >
                  <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  View Public Page
                </button>
              </>
            )}

            {/* Move to Folder submenu */}
            <div className="border-t border-gray-200 dark:border-gray-700 my-1"></div>
            <div className="relative">
              <button
                onClick={() => setShowMoveMenu(!showMoveMenu)}
                className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
              >
                <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <span className="flex-1">Move to...</span>
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
                    My Decks
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
                      {folder.name}
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
              className="w-full text-left px-4 py-2 hover:bg-red-100 dark:hover:bg-red-900 text-red-600 dark:text-red-400 last:rounded-b-md flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Cover Picker Modal — pick preview cards for a deck
function CoverPickerModal({
  deckId,
  initialCard1,
  initialCard2,
  onClose,
  onSaved,
}: {
  deckId: string;
  initialCard1: string | null;
  initialCard2: string | null;
  onClose: () => void;
  onSaved: (deckId: string, card1: string | null, card2: string | null) => void;
}) {
  const [cards, setCards] = useState<DeckCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewCard1, setPreviewCard1] = useState<string | null>(initialCard1);
  const [previewCard2, setPreviewCard2] = useState<string | null>(initialCard2);
  const [activeSlot, setActiveSlot] = useState<1 | 2>(1);
  const [saving, setSaving] = useState(false);
  const [coverSearch, setCoverSearch] = useState("");

  useEffect(() => {
    loadDeckByIdAction(deckId).then((result) => {
      if (result.success && result.deck) {
        setCards((result.deck as any).cards?.filter((c: DeckCardData) => !c.is_reserve) || []);
      }
      setLoading(false);
    });
  }, [deckId]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const filteredCards = coverSearch.trim()
    ? cards.filter(c => c.card_name.toLowerCase().includes(coverSearch.trim().toLowerCase()))
    : cards;
  const sortedCards = [...filteredCards].sort((a, b) => a.card_name.localeCompare(b.card_name));

  async function handleSelect(imgFile: string) {
    const c1 = activeSlot === 1 ? imgFile : previewCard1;
    const c2 = activeSlot === 2 ? imgFile : previewCard2;
    if (activeSlot === 1) setPreviewCard1(imgFile);
    else setPreviewCard2(imgFile);
    const nextSlot = activeSlot === 1 ? 2 : 1;
    setActiveSlot(nextSlot as 1 | 2);
    setSaving(true);
    const result = await updateDeckPreviewCardsAction(deckId, c1, c2);
    setSaving(false);
    if (result.success) {
      onSaved(deckId, c1, c2);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/60" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-t-xl sm:rounded-xl shadow-2xl w-full sm:max-w-2xl flex flex-col max-h-[95vh] sm:max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 pt-4 sm:pt-5 pb-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h2 className="text-base sm:text-lg font-semibold">Cover Cards</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Card slots */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 flex-shrink-0">
          <div className="flex gap-4 justify-center mb-2">
            {([1, 2] as const).map((slot) => {
              const imgFile = slot === 1 ? previewCard1 : previewCard2;
              const imgUrl = imgFile ? getCardImageUrl(imgFile) : null;
              const isActive = activeSlot === slot;
              return (
                <button
                  key={slot}
                  onClick={() => setActiveSlot(slot)}
                  className={`relative w-16 sm:w-24 aspect-[2.5/3.5] rounded-lg overflow-hidden border-2 transition-all ${
                    isActive
                      ? "border-blue-500 ring-2 ring-blue-300 dark:ring-blue-700"
                      : "border-gray-300 dark:border-gray-600 hover:border-gray-400"
                  } bg-gray-100 dark:bg-gray-800`}
                >
                  {imgUrl ? (
                    <img src={imgUrl} alt={`Cover ${slot}`} className="w-full h-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
                      <svg className="w-5 h-5 mb-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                      </svg>
                      <span className="text-[10px]">Card {slot}</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          <p className="text-center text-xs text-gray-500 dark:text-gray-400">
            {saving ? "Saving..." : `Click a card below to set cover card ${activeSlot}`}
          </p>
        </div>

        {/* Search */}
        <div className="px-4 sm:px-6 pb-3 flex-shrink-0">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search cards..."
              value={coverSearch}
              onChange={(e) => setCoverSearch(e.target.value)}
              className="w-full pl-8 pr-8 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {coverSearch && (
              <button onClick={() => setCoverSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 pb-4 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
            </div>
          ) : cards.length === 0 ? (
            <p className="text-center text-sm text-gray-500 py-8">No cards in this deck yet.</p>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-7 gap-2">
              {sortedCards.map((card) => (
                <button
                  key={`${card.card_name}|${card.card_set}`}
                  onClick={() => handleSelect(card.card_img_file || "")}
                  className="relative rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 hover:border-blue-500 hover:scale-105 transition-all"
                  style={{ aspectRatio: "2.5/3.5" }}
                  title={card.card_name}
                >
                  <img src={getCardImageUrl(card.card_img_file || "") || ""} alt={card.card_name} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
