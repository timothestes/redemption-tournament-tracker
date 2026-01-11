"use client";

import { useState, useEffect } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Checkbox } from "../../../components/ui/checkbox";
import TopNav from "../../../components/top-nav";
import { createClient } from "../../../utils/supabase/client";
import { getRegistrations, deleteRegistration, sendBulkEmail, updateRegistration, createTournamentFromRegistrations } from "./actions";
import { useRouter } from "next/navigation";
import { ADMIN_WHITELIST } from "../config";
import { NATIONALS_CONFIG } from "../../config/nationals";

interface Registration {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  discord_username: string | null;
  thursday_event: string;
  friday_event: string;
  saturday_event: string;
  fantasy_draft_opt_in: boolean;
  first_nationals: boolean;
  needs_airport_transportation: boolean;
  needs_hotel_transportation: boolean;
  photo_url: string | null;
  paid: boolean;
  created_at: string;
}

export default function AdminRegistrationsPage() {
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [filteredRegistrations, setFilteredRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showTournamentModal, setShowTournamentModal] = useState(false);
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [viewingPhoto, setViewingPhoto] = useState<{url: string, name: string} | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState<string | null>(null);
  const [tournamentName, setTournamentName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingRegistration, setEditingRegistration] = useState<Registration | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [emailSubject, setEmailSubject] = useState("");
  const [emailContent, setEmailContent] = useState("");
  const [sending, setSending] = useState(false);
  const [showEmailLimitsInfo, setShowEmailLimitsInfo] = useState(true);
  
  // Filter states
  const [searchTerm, setSearchTerm] = useState("");
  const [thursdayFilter, setThursdayFilter] = useState("all");
  const [fridayFilter, setFridayFilter] = useState("all");
  const [saturdayFilter, setSaturdayFilter] = useState("all");
  const [firstNationalsFilter, setFirstNationalsFilter] = useState("all");
  const [fantasyDraftFilter, setFantasyDraftFilter] = useState("all");
  const [airportTransportFilter, setAirportTransportFilter] = useState("all");
  const [hotelTransportFilter, setHotelTransportFilter] = useState("all");
  const [photoFilter, setPhotoFilter] = useState("all");
  const [paidFilter, setPaidFilter] = useState("all");
  
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    const checkAccess = async () => {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      setUser(currentUser);

      // Check if user is admin
      if (!currentUser || !ADMIN_WHITELIST.includes(currentUser.email || "")) {
        router.push("/");
        return;
      }

      setIsAdmin(true);
      await loadRegistrations();
    };

    checkAccess();

    // Load dismissed state from localStorage
    const dismissed = localStorage.getItem('emailLimitsInfoDismissed');
    if (dismissed === 'true') {
      setShowEmailLimitsInfo(false);
    }
  }, []);

  const loadRegistrations = async () => {
    setLoading(true);
    const { registrations: data } = await getRegistrations();
    setRegistrations(data);
    setFilteredRegistrations(data);
    setLoading(false);
  };

  // Apply filters whenever filters or registrations change
  useEffect(() => {
    let filtered = [...registrations];

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter((reg) =>
        reg.first_name.toLowerCase().includes(term) ||
        reg.last_name.toLowerCase().includes(term) ||
        reg.email.toLowerCase().includes(term) ||
        (reg.discord_username?.toLowerCase() || "").includes(term)
      );
    }

    // Event filters
    if (thursdayFilter !== "all") {
      filtered = filtered.filter((reg) => reg.thursday_event === thursdayFilter);
    }
    if (fridayFilter !== "all") {
      filtered = filtered.filter((reg) => reg.friday_event === fridayFilter);
    }
    if (saturdayFilter !== "all") {
      filtered = filtered.filter((reg) => reg.saturday_event === saturdayFilter);
    }

    // Boolean filters
    if (firstNationalsFilter !== "all") {
      filtered = filtered.filter((reg) => reg.first_nationals === (firstNationalsFilter === "yes"));
    }
    if (fantasyDraftFilter !== "all") {
      filtered = filtered.filter((reg) => reg.fantasy_draft_opt_in === (fantasyDraftFilter === "yes"));
    }
    if (airportTransportFilter !== "all") {
      filtered = filtered.filter((reg) => reg.needs_airport_transportation === (airportTransportFilter === "yes"));
    }
    if (hotelTransportFilter !== "all") {
      filtered = filtered.filter((reg) => reg.needs_hotel_transportation === (hotelTransportFilter === "yes"));
    }
    if (photoFilter !== "all") {
      filtered = filtered.filter((reg) => photoFilter === "yes" ? reg.photo_url !== null : reg.photo_url === null);
    }
    if (paidFilter !== "all") {
      filtered = filtered.filter((reg) => reg.paid === (paidFilter === "yes"));
    }

    setFilteredRegistrations(filtered);
  }, [
    registrations,
    searchTerm,
    thursdayFilter,
    fridayFilter,
    saturdayFilter,
    firstNationalsFilter,
    fantasyDraftFilter,
    airportTransportFilter,
    hotelTransportFilter,
    photoFilter,
    paidFilter,
  ]);

  const handleDelete = async (id: string) => {
    if (deleteConfirm !== id) {
      setDeleteConfirm(id);
      return;
    }

    const result = await deleteRegistration(id);
    if (result.success) {
      await loadRegistrations();
      setDeleteConfirm(null);
    } else {
      alert(`Error deleting registration: ${result.error}`);
    }
  };

  const handleEdit = (registration: Registration) => {
    setEditingRegistration(registration);
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!editingRegistration) return;

    const result = await updateRegistration(editingRegistration.id, {
      first_name: editingRegistration.first_name,
      last_name: editingRegistration.last_name,
      email: editingRegistration.email,
      discord_username: editingRegistration.discord_username || "",
      thursday_event: editingRegistration.thursday_event,
      friday_event: editingRegistration.friday_event,
      saturday_event: editingRegistration.saturday_event,
      fantasy_draft_opt_in: editingRegistration.fantasy_draft_opt_in,
      first_nationals: editingRegistration.first_nationals,
      needs_airport_transportation: editingRegistration.needs_airport_transportation,
      needs_hotel_transportation: editingRegistration.needs_hotel_transportation,
      paid: editingRegistration.paid,
    });

    if (result.success) {
      await loadRegistrations();
      setShowEditModal(false);
      setEditingRegistration(null);
    } else {
      alert(`Error updating registration: ${result.error}`);
    }
  };

  const toggleSelection = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredRegistrations.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredRegistrations.map((r) => r.id)));
    }
  };

  const selectFiltered = () => {
    setSelectedIds(new Set(filteredRegistrations.map((r) => r.id)));
  };

  const clearFilters = () => {
    setSearchTerm("");
    setThursdayFilter("all");
    setFridayFilter("all");
    setSaturdayFilter("all");
    setFirstNationalsFilter("all");
    setFantasyDraftFilter("all");
    setAirportTransportFilter("all");
    setHotelTransportFilter("all");
    setPaidFilter("all");
  };

  const handleCreateTournament = async () => {
    if (!tournamentName.trim()) {
      alert("Please enter a tournament name");
      return;
    }

    if (selectedIds.size === 0) {
      alert("Please select at least one registration");
      return;
    }

    setCreating(true);
    const result = await createTournamentFromRegistrations(
      Array.from(selectedIds),
      tournamentName
    );
    setCreating(false);

    if (result.success && result.tournamentId) {
      // Redirect to the tournament page immediately
      router.push(`/tracker/tournaments/${result.tournamentId}`);
    } else {
      alert(`Error creating tournament: ${result.error}`);
    }
  };

  const handleSendEmail = async () => {
    if (selectedIds.size === 0) {
      alert("Please select at least one recipient");
      return;
    }

    if (!emailSubject || !emailContent) {
      alert("Please provide both subject and content");
      return;
    }

    setSending(true);
    const result = await sendBulkEmail(
      Array.from(selectedIds),
      emailSubject,
      emailContent
    );
    setSending(false);

    if (result.success) {
      alert(result.message);
      setShowEmailModal(false);
      setEmailSubject("");
      setEmailContent("");
      setSelectedIds(new Set());
    } else {
      alert(`Error: ${result.error || result.message}`);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatEventName = (event: string) => {
    if (!event || event === "none") return "None";
    return event
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  // Photo management functions
  const handleDeletePhoto = async (registrationId: string) => {
    const registration = registrations.find(r => r.id === registrationId);
    if (!registration?.photo_url) return;

    if (!confirm('Are you sure you want to delete this photo?')) return;

    try {
      // Extract filename from URL
      const urlParts = registration.photo_url.split('/');
      const fileName = decodeURIComponent(urlParts[urlParts.length - 1]);
      
      console.log('Attempting to delete file:', fileName);
      console.log('Full URL:', registration.photo_url);

      // Delete from storage
      const { data, error: storageError } = await supabase.storage
        .from('avatars')
        .remove([fileName]);

      console.log('Delete response:', { data, error: storageError });

      if (storageError) {
        console.error('Storage error details:', storageError);
        throw storageError;
      }

      // Update database
      const result = await updateRegistration(registrationId, {
        photo_url: null,
      });

      if (result.success) {
        // Clear photo filter so the user doesn't disappear from view
        if (photoFilter === 'yes') {
          setPhotoFilter('all');
        }
        await loadRegistrations();
        setViewingPhoto(null);
        console.log('Photo deleted successfully');
      } else {
        alert(`Error updating registration: ${result.error}`);
      }
    } catch (error) {
      console.error('Full error:', error);
      alert(`Error deleting photo: ${error}`);
    }
  };

  const handleReplacePhoto = async (registrationId: string, file: File) => {
    const registration = registrations.find(r => r.id === registrationId);
    if (!registration) return;

    // Validate file
    if (file.size > 15 * 1024 * 1024) {
      alert('Picture must be smaller than 15MB');
      return;
    }

    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file');
      return;
    }

    setUploadingPhoto(registrationId);

    try {
      // Delete old photo if exists
      if (registration.photo_url) {
        const urlParts = registration.photo_url.split('/');
        const oldFileName = decodeURIComponent(urlParts[urlParts.length - 1]);
        const { error: deleteError } = await supabase.storage
          .from('avatars')
          .remove([oldFileName]);
        
        if (deleteError) {
          console.error('Error deleting old photo:', deleteError);
          // Continue anyway - don't block upload if delete fails
        }
      }

      // Upload new photo
      const fileName = `${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);

      // Update database
      const result = await updateRegistration(registrationId, {
        photo_url: publicUrl,
      });

      if (result.success) {
        await loadRegistrations();
        setUploadingPhoto(null);
      } else {
        alert(`Error updating registration: ${result.error}`);
        setUploadingPhoto(null);
      }
    } catch (error) {
      alert(`Error replacing photo: ${error}`);
      setUploadingPhoto(null);
    }
  };

  const handleDownloadPhoto = async (photoUrl: string, name: string) => {
    try {
      const response = await fetch(photoUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name.replace(/\s+/g, '_')}.jpg`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      alert(`Error downloading photo: ${error}`);
    }
  };

  const handleBulkDownloadPhotos = async () => {
    const selectedRegs = registrations.filter(r => selectedIds.has(r.id) && r.photo_url);
    
    if (selectedRegs.length === 0) {
      alert('No photos to download from selected registrations');
      return;
    }

    // Download each photo individually
    for (const reg of selectedRegs) {
      if (reg.photo_url) {
        await handleDownloadPhoto(reg.photo_url, `${reg.first_name}_${reg.last_name}`);
        // Add small delay to avoid overwhelming the browser
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
  };

  const getPhotosWithCount = () => {
    const selectedWithPhotos = registrations.filter(r => selectedIds.has(r.id) && r.photo_url).length;
    return selectedWithPhotos;
  };

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="flex flex-col min-h-screen">
      {user && <TopNav />}

      <div className="flex-1 w-full overflow-auto px-5">
        <div className="max-w-7xl mx-auto py-8">
          <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold mb-2">Registration Admin</h1>
              <p className="text-muted-foreground">
                Manage Nationals {NATIONALS_CONFIG.year} registrations
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-sm text-muted-foreground">
                Total: {registrations.length} | Filtered: {filteredRegistrations.length} | Selected: {selectedIds.size}
              </div>
              {selectedIds.size > 0 && (
                <>
                  <Button
                    onClick={() => setShowEmailModal(true)}
                    variant="outline"
                    className="border-2 border-green-500 text-green-600 hover:bg-green-50 dark:border-green-400 dark:text-green-400 dark:hover:bg-green-950"
                  >
                    Send Email to Selected
                  </Button>
                  <Button
                    onClick={handleBulkDownloadPhotos}
                    variant="outline"
                    className="border-2 border-purple-500 text-purple-600 hover:bg-purple-50 dark:border-purple-400 dark:text-purple-400 dark:hover:bg-purple-950"
                    disabled={getPhotosWithCount() === 0}
                  >
                    Download Photos ({getPhotosWithCount()})
                  </Button>
                  <Button
                    onClick={() => setShowTournamentModal(true)}
                    variant="outline"
                    className="border-2 border-blue-500 text-blue-600 hover:bg-blue-50 dark:border-blue-400 dark:text-blue-400 dark:hover:bg-blue-950"
                  >
                    Create Tournament ({selectedIds.size})
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Email Limits Info */}
          {showEmailLimitsInfo && (
            <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-1">
                    Email Sending Limits (Resend Free Tier)
                  </h3>
                  <div className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
                    <p>• <strong>Daily Limit:</strong> 100 emails per day</p>
                    <p>• <strong>Monthly Limit:</strong> 3,000 emails per month</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setShowEmailLimitsInfo(false);
                    localStorage.setItem('emailLimitsInfoDismissed', 'true');
                  }}
                  className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 flex-shrink-0"
                  aria-label="Dismiss"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Filters Section */}
          <div className="bg-card border rounded-lg shadow-sm p-6 mb-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Filters</h2>
              <div className="flex gap-2">
                <Button
                  onClick={selectFiltered}
                  variant="outline"
                  size="sm"
                  disabled={filteredRegistrations.length === 0}
                  className="text-xs"
                >
                  Select All Filtered ({filteredRegistrations.length})
                </Button>
                <Button
                  onClick={clearFilters}
                  variant="outline"
                  size="sm"
                  className="text-xs"
                >
                  Clear Filters
                </Button>
              </div>
            </div>

            {/* Search */}
            <div>
              <Label htmlFor="search">Search (Name, Email, Discord)</Label>
              <Input
                id="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search registrations..."
                className="mt-1"
              />
            </div>

            {/* Event Filters */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="thursday">Thursday Event</Label>
                <select
                  id="thursday"
                  value={thursdayFilter}
                  onChange={(e) => setThursdayFilter(e.target.value)}
                  className="mt-1 flex h-10 w-full rounded-md border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                >
                  <option value="all">All</option>
                  <option value="booster_draft">Booster Draft</option>
                  <option value="type2_2player">Type 2 (2-Player)</option>
                  <option value="none">None</option>
                </select>
              </div>

              <div>
                <Label htmlFor="friday">Friday Event</Label>
                <select
                  id="friday"
                  value={fridayFilter}
                  onChange={(e) => setFridayFilter(e.target.value)}
                  className="mt-1 flex h-10 w-full rounded-md border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                >
                  <option value="all">All</option>
                  <option value="type1_2player">Type 1 (2-Player)</option>
                  <option value="typeA_2player">Type A (2-Player)</option>
                  <option value="none">None</option>
                </select>
              </div>

              <div>
                <Label htmlFor="saturday">Saturday Event</Label>
                <select
                  id="saturday"
                  value={saturdayFilter}
                  onChange={(e) => setSaturdayFilter(e.target.value)}
                  className="mt-1 flex h-10 w-full rounded-md border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                >
                  <option value="all">All</option>
                  <option value="teams">Teams</option>
                  <option value="sealed_deck">Sealed Deck</option>
                  <option value="none">None</option>
                </select>
              </div>
            </div>

            {/* Additional Filters */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              <div>
                <Label htmlFor="firstNats">First Nationals?</Label>
                <select
                  id="firstNats"
                  value={firstNationalsFilter}
                  onChange={(e) => setFirstNationalsFilter(e.target.value)}
                  className="mt-1 flex h-10 w-full rounded-md border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                >
                  <option value="all">All</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>

              <div>
                <Label htmlFor="fantasy">Fantasy Draft?</Label>
                <select
                  id="fantasy"
                  value={fantasyDraftFilter}
                  onChange={(e) => setFantasyDraftFilter(e.target.value)}
                  className="mt-1 flex h-10 w-full rounded-md border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                >
                  <option value="all">All</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>

              <div>
                <Label htmlFor="airport">Airport Transport?</Label>
                <select
                  id="airport"
                  value={airportTransportFilter}
                  onChange={(e) => setAirportTransportFilter(e.target.value)}
                  className="mt-1 flex h-10 w-full rounded-md border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                >
                  <option value="all">All</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>

              <div>
                <Label htmlFor="hotel">Hotel Transport?</Label>
                <select
                  id="hotel"
                  value={hotelTransportFilter}
                  onChange={(e) => setHotelTransportFilter(e.target.value)}
                  className="mt-1 flex h-10 w-full rounded-md border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                >
                  <option value="all">All</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>

              <div>
                <Label htmlFor="photo">Has Photo?</Label>
                <select
                  id="photo"
                  value={photoFilter}
                  onChange={(e) => setPhotoFilter(e.target.value)}
                  className="mt-1 flex h-10 w-full rounded-md border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                >
                  <option value="all">All</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>

              <div>
                <Label htmlFor="paid">Paid?</Label>
                <select
                  id="paid"
                  value={paidFilter}
                  onChange={(e) => setPaidFilter(e.target.value)}
                  className="mt-1 flex h-10 w-full rounded-md border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                >
                  <option value="all">All</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-gray-100"></div>
            </div>
          ) : filteredRegistrations.length === 0 ? (
            <div className="text-center py-12 bg-card border rounded-lg">
              <p className="text-muted-foreground">
                {registrations.length === 0 ? "No registrations yet" : "No registrations match your filters"}
              </p>
            </div>
          ) : (
            <div className="bg-card border rounded-lg shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-4 py-3 text-left">
                        <Checkbox
                          checked={selectedIds.size === filteredRegistrations.length && filteredRegistrations.length > 0}
                          onCheckedChange={toggleSelectAll}
                        />
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-semibold">Name</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold">Photo</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold">Email</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold">Discord</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold">Thursday</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold">Friday</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold">Saturday</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold">Options</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold">Paid</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold">Registered</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredRegistrations.map((reg) => (
                      <tr key={reg.id} className="hover:bg-muted/50">
                        <td className="px-4 py-3">
                          <Checkbox
                            checked={selectedIds.has(reg.id)}
                            onCheckedChange={() => toggleSelection(reg.id)}
                          />
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {reg.first_name} {reg.last_name}
                        </td>
                        <td className="px-4 py-3">
                          {reg.photo_url ? (
                            <button
                              onClick={() => setViewingPhoto({ url: reg.photo_url!, name: `${reg.first_name} ${reg.last_name}` })}
                              className="w-10 h-10 rounded-md overflow-hidden border-2 border-border hover:border-green-500 transition-colors"
                            >
                              <img
                                src={reg.photo_url}
                                alt={`${reg.first_name} ${reg.last_name}`}
                                className="w-full h-full object-cover"
                              />
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                const input = document.createElement('input');
                                input.type = 'file';
                                input.accept = 'image/*';
                                input.onchange = (e) => {
                                  const file = (e.target as HTMLInputElement).files?.[0];
                                  if (file) {
                                    handleReplacePhoto(reg.id, file);
                                  }
                                };
                                input.click();
                              }}
                              className="w-10 h-10 rounded-md flex items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-green-500 hover:bg-green-50 dark:hover:bg-green-950 transition-colors"
                              title="Upload photo"
                            >
                              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm">{reg.email}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {reg.discord_username || "-"}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {formatEventName(reg.thursday_event)}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {formatEventName(reg.friday_event)}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {formatEventName(reg.saturday_event)}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <div className="flex flex-col gap-1 text-xs">
                            {reg.fantasy_draft_opt_in && (
                              <span className="text-green-600 dark:text-green-400">
                                Fantasy Draft
                              </span>
                            )}
                            {reg.first_nationals && (
                              <span className="text-blue-600 dark:text-blue-400">
                                First Nationals
                              </span>
                            )}
                            {reg.needs_airport_transportation && (
                              <span className="text-purple-600 dark:text-purple-400">
                                Airport
                              </span>
                            )}
                            {reg.needs_hotel_transportation && (
                              <span className="text-purple-600 dark:text-purple-400">
                                Hotel
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Checkbox
                            checked={reg.paid || false}
                            onCheckedChange={async (checked) => {
                              const result = await updateRegistration(reg.id, { paid: checked === true });
                              if (result.success) {
                                await loadRegistrations();
                              } else {
                                alert(`Error updating paid status: ${result.error}`);
                              }
                            }}
                          />
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {formatDate(reg.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleEdit(reg)}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleDelete(reg.id)}
                            >
                              {deleteConfirm === reg.id ? "Confirm?" : "Delete"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Email Modal */}
        {showEmailModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-card border rounded-lg shadow-lg max-w-2xl w-full max-h-[90vh] overflow-auto">
              <div className="p-6">
                <h2 className="text-2xl font-bold mb-4">
                  Send Email to {selectedIds.size} Recipient(s)
                </h2>

                <div className="space-y-4">
                  <div>
                    <Label htmlFor="subject">Subject</Label>
                    <Input
                      id="subject"
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}
                      placeholder="Email subject"
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label htmlFor="content">Email Content (HTML)</Label>
                    <textarea
                      id="content"
                      value={emailContent}
                      onChange={(e) => setEmailContent(e.target.value)}
                      placeholder="You can use {firstName}, {lastName}, or {fullName} for personalization"
                      className="mt-1 flex min-h-[300px] w-full rounded-md border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:border-green-500"
                    />
                    <p className="text-sm text-muted-foreground mt-1">
                      You can use basic HTML tags for formatting. Variables: {"{firstName}"}, {"{lastName}"}, {"{fullName}"}
                    </p>
                  </div>

                  <div className="bg-muted p-3 rounded text-sm">
                    <strong>Preview variables:</strong>
                    <ul className="mt-1 ml-4 list-disc">
                      <li>{"{firstName}"} - Recipient's first name</li>
                      <li>{"{lastName}"} - Recipient's last name</li>
                      <li>{"{fullName}"} - Full name</li>
                    </ul>
                  </div>
                </div>

                <div className="flex gap-3 mt-6">
                  <Button
                    onClick={handleSendEmail}
                    disabled={sending}
                    variant="outline"
                    className="flex-1 border-2 border-green-500 text-green-600 hover:bg-green-50 dark:border-green-400 dark:text-green-400 dark:hover:bg-green-950"
                  >
                    {sending ? "Sending..." : `Send to ${selectedIds.size} recipient(s)`}
                  </Button>
                  <Button
                    onClick={() => setShowEmailModal(false)}
                    variant="outline"
                    disabled={sending}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tournament Modal */}
        {showTournamentModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-card border rounded-lg shadow-lg max-w-md w-full">
              <div className="p-6">
                <h2 className="text-2xl font-bold mb-4">
                  Create Tournament
                </h2>

                <div className="space-y-4">
                  <div>
                    <Label htmlFor="tournamentName">Tournament Name</Label>
                    <Input
                      id="tournamentName"
                      value={tournamentName}
                      onChange={(e) => setTournamentName(e.target.value)}
                      placeholder={`e.g., Nationals ${NATIONALS_CONFIG.year} Main Event`}
                      className="mt-1"
                      autoFocus
                    />
                  </div>

                  <div className="bg-muted p-3 rounded text-sm">
                    <strong>Selected Participants: {selectedIds.size}</strong>
                    <p className="mt-1 text-muted-foreground">
                      A tournament will be created with these {selectedIds.size} participant(s).
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 mt-6">
                  <Button
                    onClick={handleCreateTournament}
                    disabled={!tournamentName.trim() || creating}
                    variant="outline"
                    className="flex-1 border-2 border-blue-500 text-blue-600 hover:bg-blue-50 dark:border-blue-400 dark:text-blue-400 dark:hover:bg-blue-950"
                  >
                    {creating ? "Creating..." : "Create Tournament"}
                  </Button>
                  <Button
                    onClick={() => {
                      setShowTournamentModal(false);
                      setTournamentName('');
                    }}
                    variant="outline"
                    disabled={creating}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Edit Modal */}
        {showEditModal && editingRegistration && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-card border rounded-lg shadow-lg max-w-2xl w-full max-h-[90vh] overflow-auto">
              <div className="p-6">
                <h2 className="text-2xl font-bold mb-4">
                  Edit Registration
                </h2>

                <div className="space-y-4">
                  {/* Personal Information */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="edit-firstName">First Name</Label>
                      <Input
                        id="edit-firstName"
                        value={editingRegistration.first_name}
                        onChange={(e) => setEditingRegistration({...editingRegistration, first_name: e.target.value})}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="edit-lastName">Last Name</Label>
                      <Input
                        id="edit-lastName"
                        value={editingRegistration.last_name}
                        onChange={(e) => setEditingRegistration({...editingRegistration, last_name: e.target.value})}
                        className="mt-1"
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="edit-email">Email</Label>
                    <Input
                      id="edit-email"
                      type="email"
                      value={editingRegistration.email}
                      onChange={(e) => setEditingRegistration({...editingRegistration, email: e.target.value})}
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label htmlFor="edit-discord">Discord Username</Label>
                    <Input
                      id="edit-discord"
                      value={editingRegistration.discord_username || ""}
                      onChange={(e) => setEditingRegistration({...editingRegistration, discord_username: e.target.value})}
                      className="mt-1"
                      placeholder="Optional"
                    />
                  </div>

                  {/* Event Selections */}
                  <div className="space-y-3 pt-4 border-t">
                    <h3 className="font-semibold">Event Selections</h3>
                    
                    <div>
                      <Label htmlFor="edit-thursday">Thursday Event</Label>
                      <select
                        id="edit-thursday"
                        value={editingRegistration.thursday_event}
                        onChange={(e) => setEditingRegistration({...editingRegistration, thursday_event: e.target.value})}
                        className="mt-1 flex h-10 w-full rounded-md border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                      >
                        <option value="booster_draft">Booster Draft</option>
                        <option value="type2_2player">Type 2 (2-Player)</option>
                        <option value="none">None</option>
                      </select>
                    </div>

                    <div>
                      <Label htmlFor="edit-friday">Friday Event</Label>
                      <select
                        id="edit-friday"
                        value={editingRegistration.friday_event}
                        onChange={(e) => setEditingRegistration({...editingRegistration, friday_event: e.target.value})}
                        className="mt-1 flex h-10 w-full rounded-md border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                      >
                        <option value="type1_2player">Type 1 (2-Player)</option>
                        <option value="typeA_2player">Type A (2-Player)</option>
                        <option value="none">None</option>
                      </select>
                    </div>

                    <div>
                      <Label htmlFor="edit-saturday">Saturday Event</Label>
                      <select
                        id="edit-saturday"
                        value={editingRegistration.saturday_event}
                        onChange={(e) => setEditingRegistration({...editingRegistration, saturday_event: e.target.value})}
                        className="mt-1 flex h-10 w-full rounded-md border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                      >
                        <option value="teams">Teams</option>
                        <option value="sealed_deck">Sealed Deck</option>
                        <option value="none">None</option>
                      </select>
                    </div>
                  </div>

                  {/* Additional Options */}
                  <div className="space-y-3 pt-4 border-t">
                    <h3 className="font-semibold">Additional Options</h3>
                    
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="edit-fantasy"
                        checked={editingRegistration.fantasy_draft_opt_in}
                        onCheckedChange={(checked) => setEditingRegistration({...editingRegistration, fantasy_draft_opt_in: checked as boolean})}
                      />
                      <Label htmlFor="edit-fantasy" className="font-normal cursor-pointer">
                        Fantasy Draft Opt-in
                      </Label>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="edit-firstNats"
                        checked={editingRegistration.first_nationals}
                        onCheckedChange={(checked) => setEditingRegistration({...editingRegistration, first_nationals: checked as boolean})}
                      />
                      <Label htmlFor="edit-firstNats" className="font-normal cursor-pointer">
                        First Nationals
                      </Label>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="edit-airport"
                        checked={editingRegistration.needs_airport_transportation}
                        onCheckedChange={(checked) => setEditingRegistration({...editingRegistration, needs_airport_transportation: checked as boolean})}
                      />
                      <Label htmlFor="edit-airport" className="font-normal cursor-pointer">
                        Needs Airport Transportation
                      </Label>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="edit-hotel"
                        checked={editingRegistration.needs_hotel_transportation}
                        onCheckedChange={(checked) => setEditingRegistration({...editingRegistration, needs_hotel_transportation: checked as boolean})}
                      />
                      <Label htmlFor="edit-hotel" className="font-normal cursor-pointer">
                        Needs Hotel Transportation
                      </Label>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="edit-paid"
                        checked={editingRegistration.paid}
                        onCheckedChange={(checked) => setEditingRegistration({...editingRegistration, paid: checked as boolean})}
                      />
                      <Label htmlFor="edit-paid" className="font-normal cursor-pointer">
                        Paid
                      </Label>
                    </div>
                  </div>

                  {/* Photo Upload Section */}
                  <div className="space-y-3 pt-4 border-t">
                    <h3 className="font-semibold">Name Tag Photo (15mb size limit)</h3>
                    
                    {editingRegistration.photo_url ? (
                      <div className="flex items-start gap-4">
                        <img
                          src={editingRegistration.photo_url}
                          alt="Current photo"
                          className="w-24 h-24 rounded-lg object-cover border-2 border-border"
                        />
                        <div className="flex flex-col gap-2">
                          <Button
                            onClick={() => {
                              const input = document.createElement('input');
                              input.type = 'file';
                              input.accept = 'image/*';
                              input.onchange = (e) => {
                                const file = (e.target as HTMLInputElement).files?.[0];
                                if (file) {
                                  handleReplacePhoto(editingRegistration.id, file);
                                  setShowEditModal(false);
                                  setEditingRegistration(null);
                                }
                              };
                              input.click();
                            }}
                            variant="outline"
                            size="sm"
                          >
                            Replace Photo
                          </Button>
                          <Button
                            onClick={() => {
                              if (confirm('Delete this photo?')) {
                                handleDeletePhoto(editingRegistration.id);
                                setShowEditModal(false);
                                setEditingRegistration(null);
                              }
                            }}
                            variant="destructive"
                            size="sm"
                          >
                            Delete Photo
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <Button
                          onClick={() => {
                            const input = document.createElement('input');
                            input.type = 'file';
                            input.accept = 'image/*';
                            input.onchange = (e) => {
                              const file = (e.target as HTMLInputElement).files?.[0];
                              if (file) {
                                handleReplacePhoto(editingRegistration.id, file);
                                setShowEditModal(false);
                                setEditingRegistration(null);
                              }
                            };
                            input.click();
                          }}
                          variant="outline"
                          size="sm"
                        >
                          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          Upload Photo
                        </Button>
                        <p className="text-xs text-muted-foreground mt-2">No photo uploaded yet</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-3 mt-6">
                  <Button
                    onClick={handleSaveEdit}
                    variant="outline"
                    className="flex-1 border-2 border-green-500 text-green-600 hover:bg-green-50 dark:border-green-400 dark:text-green-400 dark:hover:bg-green-950"
                  >
                    Save Changes
                  </Button>
                  <Button
                    onClick={() => {
                      setShowEditModal(false);
                      setEditingRegistration(null);
                    }}
                    variant="outline"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Photo View Modal */}
        {viewingPhoto && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setViewingPhoto(null)}>
            <div className="bg-card border rounded-lg shadow-lg max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold">
                    {viewingPhoto.name}
                  </h2>
                  <button
                    onClick={() => setViewingPhoto(null)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="mb-4">
                  <img
                    src={viewingPhoto.url}
                    alt={viewingPhoto.name}
                    className="w-full h-auto max-h-[60vh] object-contain rounded-lg border-2 border-border"
                  />
                </div>

                <div className="flex gap-3">
                  <Button
                    onClick={() => handleDownloadPhoto(viewingPhoto.url, viewingPhoto.name)}
                    variant="outline"
                    className="flex-1"
                  >
                    Download
                  </Button>
                  <Button
                    onClick={() => {
                      const reg = registrations.find(r => r.photo_url === viewingPhoto.url);
                      if (reg) {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = 'image/*';
                        input.onchange = (e) => {
                          const file = (e.target as HTMLInputElement).files?.[0];
                          if (file) {
                            handleReplacePhoto(reg.id, file);
                            setViewingPhoto(null);
                          }
                        };
                        input.click();
                      }
                    }}
                    variant="outline"
                    className="flex-1 border-blue-500 text-blue-600 hover:bg-blue-50 dark:border-blue-400 dark:text-blue-400"
                  >
                    Replace
                  </Button>
                  <Button
                    onClick={() => {
                      const reg = registrations.find(r => r.photo_url === viewingPhoto.url);
                      if (reg) {
                        handleDeletePhoto(reg.id);
                      }
                    }}
                    variant="destructive"
                    className="flex-1"
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
