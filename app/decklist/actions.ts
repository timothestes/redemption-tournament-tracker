"use server";

import { createClient } from "../../utils/supabase/server";
import { revalidatePath } from "next/cache";

// Types matching the database schema
export interface DeckData {
  id?: string;
  user_id?: string;
  name: string;
  description?: string;
  format?: string;
  folder_id?: string | null;
  is_public?: boolean;
  card_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface DeckCardData {
  id?: string;
  deck_id?: string;
  card_name: string;
  card_set?: string;
  card_img_file?: string;
  quantity: number;
  is_reserve: boolean;
}

export interface SaveDeckParams {
  deckId?: string; // If provided, update existing deck; if not, create new
  name: string;
  description?: string;
  format?: string;
  folderId?: string | null;
  cards: DeckCardData[];
}

/**
 * Save a deck (create new or update existing)
 */
export async function saveDeckAction(params: SaveDeckParams) {
  try {
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        success: false,
        error: "You must be logged in to save a deck",
      };
    }

    const { deckId, name, description, format, folderId, cards } = params;

    // Calculate card count (main deck only, excluding reserve)
    const cardCount = cards
      .filter(card => !card.is_reserve)
      .reduce((sum, card) => sum + card.quantity, 0);

    if (deckId) {
      // Update existing deck
      const { data: deck, error: deckError } = await supabase
        .from("decks")
        .update({
          name,
          description: description || null,
          format: format || null,
          folder_id: folderId || null,
          card_count: cardCount,
          updated_at: new Date().toISOString(),
        })
        .eq("id", deckId)
        .eq("user_id", user.id) // Ensure user owns the deck
        .select()
        .single();

      if (deckError) {
        console.error("Error updating deck:", deckError);
        return {
          success: false,
          error: "Failed to update deck",
        };
      }

      // Delete existing cards
      const { error: deleteError } = await supabase
        .from("deck_cards")
        .delete()
        .eq("deck_id", deckId);

      if (deleteError) {
        console.error("Error deleting old deck cards:", deleteError);
        return {
          success: false,
          error: "Failed to update deck cards",
        };
      }

      // Insert updated cards
      if (cards.length > 0) {
        const cardsToInsert = cards.map((card) => ({
          deck_id: deckId,
          card_name: card.card_name,
          card_set: card.card_set || null,
          card_img_file: card.card_img_file || null,
          quantity: card.quantity,
          is_reserve: card.is_reserve,
        }));

        const { error: insertError } = await supabase
          .from("deck_cards")
          .insert(cardsToInsert);

        if (insertError) {
          console.error("Error inserting deck cards:", insertError);
          return {
            success: false,
            error: "Failed to save deck cards",
          };
        }
      }

      revalidatePath("/decklist/my-decks");
      revalidatePath(`/decklist/card-search`);

      return {
        success: true,
        deckId: deck.id,
        message: "Deck updated successfully",
      };
    } else {
      // Create new deck
      const { data: deck, error: deckError } = await supabase
        .from("decks")
        .insert({
          user_id: user.id,
          name,
          description: description || null,
          format: format || null,
          folder_id: folderId || null,
          card_count: cardCount,
        })
        .select()
        .single();

      if (deckError) {
        console.error("Error creating deck:", deckError);
        return {
          success: false,
          error: "Failed to create deck",
        };
      }

      // Insert cards
      if (cards.length > 0) {
        const cardsToInsert = cards.map((card) => ({
          deck_id: deck.id,
          card_name: card.card_name,
          card_set: card.card_set || null,
          card_img_file: card.card_img_file || null,
          quantity: card.quantity,
          is_reserve: card.is_reserve,
        }));

        const { error: insertError } = await supabase
          .from("deck_cards")
          .insert(cardsToInsert);

        if (insertError) {
          console.error("Error inserting deck cards:", insertError);
          // Rollback: delete the deck we just created
          await supabase.from("decks").delete().eq("id", deck.id);
          return {
            success: false,
            error: "Failed to save deck cards",
          };
        }
      }

      revalidatePath("/decklist/my-decks");

      return {
        success: true,
        deckId: deck.id,
        message: "Deck created successfully",
      };
    }
  } catch (error) {
    console.error("Error in saveDeckAction:", error);
    return {
      success: false,
      error: "An unexpected error occurred",
    };
  }
}

/**
 * Load all decks for the current user
 */
export async function loadUserDecksAction() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        success: false,
        error: "You must be logged in to view your decks",
        decks: [],
      };
    }

    const { data: decks, error } = await supabase
      .from("decks")
      .select(`
        *,
        deck_cards (
          quantity,
          is_reserve
        )
      `)
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("Error loading decks:", error);
      return {
        success: false,
        error: "Failed to load decks",
        decks: [],
      };
    }

    // Calculate main deck count for each deck from the actual cards
    const decksWithCounts = (decks || []).map((deck: any) => {
      const mainDeckCount = (deck.deck_cards || [])
        .filter((card: any) => !card.is_reserve)
        .reduce((sum: number, card: any) => sum + card.quantity, 0);
      
      return {
        ...deck,
        card_count: mainDeckCount,
        deck_cards: undefined, // Remove cards array from response (not needed in list view)
      };
    });

    return {
      success: true,
      decks: decksWithCounts,
    };
  } catch (error) {
    console.error("Error in loadUserDecksAction:", error);
    return {
      success: false,
      error: "An unexpected error occurred",
      decks: [],
    };
  }
}

/**
 * Load a specific deck by ID with all its cards
 */
export async function loadDeckByIdAction(deckId: string) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        success: false,
        error: "You must be logged in to view this deck",
        deck: null,
      };
    }

    // Load deck
    const { data: deck, error: deckError } = await supabase
      .from("decks")
      .select("*")
      .eq("id", deckId)
      .single();

    if (deckError) {
      console.error("Error loading deck:", deckError);
      return {
        success: false,
        error: "Deck not found",
        deck: null,
      };
    }

    // Check permissions (user owns deck or deck is public)
    if (deck.user_id !== user.id && !deck.is_public) {
      return {
        success: false,
        error: "You don't have permission to view this deck",
        deck: null,
      };
    }

    // Load deck cards
    const { data: cards, error: cardsError } = await supabase
      .from("deck_cards")
      .select("*")
      .eq("deck_id", deckId)
      .order("card_name");

    if (cardsError) {
      console.error("Error loading deck cards:", cardsError);
      return {
        success: false,
        error: "Failed to load deck cards",
        deck: null,
      };
    }

    return {
      success: true,
      deck: {
        ...deck,
        cards: cards || [],
      },
    };
  } catch (error) {
    console.error("Error in loadDeckByIdAction:", error);
    return {
      success: false,
      error: "An unexpected error occurred",
      deck: null,
    };
  }
}

/**
 * Delete a deck
 */
export async function deleteDeckAction(deckId: string) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        success: false,
        error: "You must be logged in to delete a deck",
      };
    }

    // Delete deck (cards will be cascade deleted)
    const { error } = await supabase
      .from("decks")
      .delete()
      .eq("id", deckId)
      .eq("user_id", user.id); // Ensure user owns the deck

    if (error) {
      console.error("Error deleting deck:", error);
      return {
        success: false,
        error: "Failed to delete deck",
      };
    }

    revalidatePath("/decklist/my-decks");

    return {
      success: true,
      message: "Deck deleted successfully",
    };
  } catch (error) {
    console.error("Error in deleteDeckAction:", error);
    return {
      success: false,
      error: "An unexpected error occurred",
    };
  }
}

/**
 * Duplicate a deck
 */
export async function duplicateDeckAction(deckId: string, newName?: string) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        success: false,
        error: "You must be logged in to duplicate a deck",
      };
    }

    // Load the original deck
    const loadResult = await loadDeckByIdAction(deckId);
    if (!loadResult.success || !loadResult.deck) {
      return {
        success: false,
        error: loadResult.error || "Failed to load deck",
      };
    }

    const originalDeck = loadResult.deck;

    // Create new deck with copied data
    const saveResult = await saveDeckAction({
      name: newName || `${originalDeck.name} (Copy)`,
      description: originalDeck.description,
      format: originalDeck.format,
      folderId: originalDeck.folder_id,
      cards: originalDeck.cards,
    });

    if (!saveResult.success) {
      return {
        success: false,
        error: saveResult.error || "Failed to duplicate deck",
      };
    }

    revalidatePath("/decklist/my-decks");

    return {
      success: true,
      deckId: saveResult.deckId,
      message: "Deck duplicated successfully",
    };
  } catch (error) {
    console.error("Error in duplicateDeckAction:", error);
    return {
      success: false,
      error: "An unexpected error occurred",
    };
  }
}

/**
 * Folder Management Actions
 */

export interface FolderData {
  id?: string;
  user_id?: string;
  parent_folder_id?: string | null;
  name: string;
  created_at?: string;
}

/**
 * Load all folders for the current user
 */
export async function loadUserFoldersAction() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        success: false,
        error: "You must be logged in to view folders",
        folders: [],
      };
    }

    const { data: folders, error } = await supabase
      .from("deck_folders")
      .select("*")
      .eq("user_id", user.id)
      .order("name");

    if (error) {
      console.error("Error loading folders:", error);
      return {
        success: false,
        error: "Failed to load folders",
        folders: [],
      };
    }

    return {
      success: true,
      folders: folders || [],
    };
  } catch (error) {
    console.error("Error in loadUserFoldersAction:", error);
    return {
      success: false,
      error: "An unexpected error occurred",
      folders: [],
    };
  }
}

/**
 * Create a new folder
 */
export async function createFolderAction(name: string, parentFolderId?: string | null) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        success: false,
        error: "You must be logged in to create a folder",
      };
    }

    if (!name || name.trim().length === 0) {
      return {
        success: false,
        error: "Folder name cannot be empty",
      };
    }

    if (name.length > 100) {
      return {
        success: false,
        error: "Folder name must be 100 characters or less",
      };
    }

    const { data: folder, error } = await supabase
      .from("deck_folders")
      .insert({
        user_id: user.id,
        name: name.trim(),
        parent_folder_id: parentFolderId || null,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating folder:", error);
      return {
        success: false,
        error: "Failed to create folder",
      };
    }

    revalidatePath("/decklist/my-decks");

    return {
      success: true,
      folder,
      message: "Folder created successfully",
    };
  } catch (error) {
    console.error("Error in createFolderAction:", error);
    return {
      success: false,
      error: "An unexpected error occurred",
    };
  }
}

/**
 * Rename a folder
 */
export async function renameFolderAction(folderId: string, newName: string) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        success: false,
        error: "You must be logged in to rename a folder",
      };
    }

    if (!newName || newName.trim().length === 0) {
      return {
        success: false,
        error: "Folder name cannot be empty",
      };
    }

    if (newName.length > 100) {
      return {
        success: false,
        error: "Folder name must be 100 characters or less",
      };
    }

    const { error } = await supabase
      .from("deck_folders")
      .update({ name: newName.trim() })
      .eq("id", folderId)
      .eq("user_id", user.id);

    if (error) {
      console.error("Error renaming folder:", error);
      return {
        success: false,
        error: "Failed to rename folder",
      };
    }

    revalidatePath("/decklist/my-decks");

    return {
      success: true,
      message: "Folder renamed successfully",
    };
  } catch (error) {
    console.error("Error in renameFolderAction:", error);
    return {
      success: false,
      error: "An unexpected error occurred",
    };
  }
}

/**
 * Delete a folder
 */
export async function deleteFolderAction(folderId: string) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        success: false,
        error: "You must be logged in to delete a folder",
      };
    }

    // Check if folder has decks
    const { data: decksInFolder, error: checkError } = await supabase
      .from("decks")
      .select("id")
      .eq("folder_id", folderId)
      .limit(1);

    if (checkError) {
      console.error("Error checking folder contents:", checkError);
      return {
        success: false,
        error: "Failed to delete folder",
      };
    }

    if (decksInFolder && decksInFolder.length > 0) {
      return {
        success: false,
        error: "Cannot delete folder that contains decks. Move or delete the decks first.",
      };
    }

    // Delete folder
    const { error } = await supabase
      .from("deck_folders")
      .delete()
      .eq("id", folderId)
      .eq("user_id", user.id);

    if (error) {
      console.error("Error deleting folder:", error);
      return {
        success: false,
        error: "Failed to delete folder",
      };
    }

    revalidatePath("/decklist/my-decks");

    return {
      success: true,
      message: "Folder deleted successfully",
    };
  } catch (error) {
    console.error("Error in deleteFolderAction:", error);
    return {
      success: false,
      error: "An unexpected error occurred",
    };
  }
}

/**
 * Move a deck to a folder (or remove from folder)
 */
export async function moveDeckToFolderAction(deckId: string, folderId: string | null) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        success: false,
        error: "You must be logged in to move a deck",
      };
    }

    const { error } = await supabase
      .from("decks")
      .update({ folder_id: folderId })
      .eq("id", deckId)
      .eq("user_id", user.id);

    if (error) {
      console.error("Error moving deck:", error);
      return {
        success: false,
        error: "Failed to move deck",
      };
    }

    revalidatePath("/decklist/my-decks");

    return {
      success: true,
      message: folderId ? "Deck moved to folder" : "Deck removed from folder",
    };
  } catch (error) {
    console.error("Error in moveDeckToFolderAction:", error);
    return {
      success: false,
      error: "An unexpected error occurred",
    };
  }
}
