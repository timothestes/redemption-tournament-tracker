"use client";

import { useState, useEffect } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { submitRegistration } from "./actions";
import TopNav from "../../components/top-nav";
import { createClient } from "../../utils/supabase/client";
import { NATIONALS_CONFIG } from "../config/nationals";
import { useIsAdmin } from "../../hooks/useIsAdmin";

export default function RegistrationPage() {
  const [user, setUser] = useState(null);
  const supabase = createClient();
  const { isAdmin, loading: adminLoading } = useIsAdmin();

  useEffect(() => {
    const getUser = async () => {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      setUser(currentUser);
      
      // Check if registration is admin-only (wait for admin loading to complete)
      if (NATIONALS_CONFIG.adminOnly && !adminLoading) {
        if (!currentUser || !isAdmin) {
          window.location.href = "/";
          return;
        }
      }
    };
    getUser();
  }, [adminLoading, isAdmin]);

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    discordUsername: "",
    thursdayEvent: "",
    fridayEvent: "",
    saturdayEvent: "",
    fantasyDraftOptIn: false,
    firstNationals: false,
    needsAirportTransportation: false,
    needsHotelTransportation: false,
    stayingOvernight: false,
    overnightStayNights: [] as string[],
  });

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<{
    type: "success" | "error" | null;
    message: string;
  }>({ type: null, message: "" });
  const [showThankYou, setShowThankYou] = useState(false);

  // Reset form when navigating back to registration from header
  useEffect(() => {
    const handleNavigate = () => {
      if (showThankYou) {
        setShowThankYou(false);
        setFormData({
          firstName: "",
          lastName: "",
          email: "",
          discordUsername: "",
          thursdayEvent: "",
          fridayEvent: "",
          saturdayEvent: "",
          fantasyDraftOptIn: false,
          firstNationals: false,
          needsAirportTransportation: false,
          needsHotelTransportation: false,
          stayingOvernight: false,
          overnightStayNights: [],
        });
        setPhotoFile(null);
        setPhotoPreview(null);
      }
    };

    // Listen for clicks on the page (specifically for header navigation)
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const link = target.closest('a[href="/register"]');
      if (link && showThankYou) {
        handleNavigate();
      }
    };

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [showThankYou]);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file size (max 15MB)
      if (file.size > 15 * 1024 * 1024) {
        setSubmitStatus({
          type: "error",
          message: "Picture must be smaller than 15MB",
        });
        return;
      }
      
      // Validate file type
      if (!file.type.startsWith('image/')) {
        setSubmitStatus({
          type: "error",
          message: "Please upload an image file",
        });
        return;
      }
      
      setPhotoFile(file);
      
      // Create preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhotoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitStatus({ type: null, message: "" });

    // Validate required fields
    if (!formData.firstName || !formData.lastName || !formData.email) {
      setSubmitStatus({
        type: "error",
        message: "Please fill in all required fields.",
      });
      setIsSubmitting(false);
      return;
    }

    if (!formData.thursdayEvent || !formData.fridayEvent || !formData.saturdayEvent) {
      setSubmitStatus({
        type: "error",
        message: "Please select an option for each day's event.",
      });
      setIsSubmitting(false);
      return;
    }

    // Upload photo if provided
    let photoUrl = null;
    if (photoFile) {
      setIsUploadingPhoto(true);
      const fileName = `${Date.now()}-${photoFile.name}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, photoFile);
      
      setIsUploadingPhoto(false);
      
      if (uploadError) {
        setSubmitStatus({
          type: "error",
          message: "Failed to upload picture. Please try again.",
        });
        setIsSubmitting(false);
        return;
      }
      
      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);
      
      photoUrl = publicUrl;
    }

    const result = await submitRegistration(formData, photoUrl);

    if (result.success) {
      setShowThankYou(true);
    } else {
      setSubmitStatus({
        type: "error",
        message: result.error || "An error occurred. Please try again.",
      });
    }

    setIsSubmitting(false);
  };

  return (
    <div className="flex flex-col min-h-screen">
      {user && <TopNav />}
      
      <div className="flex-1 w-full overflow-auto px-5">
        <div className="max-w-3xl mx-auto py-8">
          <h1 className="text-3xl font-bold mb-2">
            Tournament Registration
          </h1>
          <p className="text-muted-foreground mb-6">
            Register for the {NATIONALS_CONFIG.year} National Redemption Tournament
          </p>

          {showThankYou ? (
            <div className="bg-card border-2 border-border rounded-xl shadow-lg p-8 md:p-12 text-center space-y-8">
              {/* Success Icon with Animation */}
              <div className="relative">
                <div className="w-24 h-24 bg-gradient-to-br from-green-500 to-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-lg">
                  <svg
                    className="w-14 h-14 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={3}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
                {/* Decorative Rings */}
                <div className="absolute inset-0 w-24 h-24 mx-auto border-4 border-green-300 dark:border-green-700 rounded-full animate-ping opacity-20"></div>
              </div>
              
              {/* Success Message */}
              <div className="space-y-3">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground">
                  Registration Complete!
                </h2>
                <p className="text-xl text-gray-700 dark:text-gray-300">
                  Thank you for registering{formData.firstName ? `, ${formData.firstName}` : ''}! 🎉
                </p>
                <p className="text-sm text-muted-foreground">
                  We're excited to see you at Nationals {NATIONALS_CONFIG.year}
                </p>
              </div>

              {/* What's Next Section */}
              <div className="bg-muted p-6 rounded-xl shadow-md border border-border">
                <p className="font-bold text-lg mb-4 text-foreground">
                  📋 What's next?
                </p>
                <ul className="text-left space-y-3 max-w-md mx-auto">
                  <li className="flex items-start gap-3 text-gray-700 dark:text-gray-300">
                    <span className="flex-shrink-0 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center mt-0.5">
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <span>Check your email for a confirmation message</span>
                  </li>
                  <li className="flex items-start gap-3 text-gray-700 dark:text-gray-300">
                    <span className="flex-shrink-0 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center mt-0.5">
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <span>We'll send updates about the venue and schedule</span>
                  </li>
                  <li className="flex items-start gap-3 text-gray-700 dark:text-gray-300">
                    <span className="flex-shrink-0 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center mt-0.5">
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <span>Hotel and transportation details coming soon</span>
                  </li>
                </ul>
              </div>

              {/* Contact Section */}
              <div className="bg-muted p-4 rounded-lg border border-border">
                <p className="text-sm text-muted-foreground">
                  Questions? Contact Brian at{" "}
                  <a
                    href="mailto:Brianjones121191@gmail.com"
                    className="font-semibold text-foreground hover:text-green-600 dark:hover:text-green-400 underline decoration-2 underline-offset-2"
                  >
                    Brianjones121191@gmail.com
                  </a>
                </p>
              </div>

              {/* Action Button */}
              <div className="pt-4">
                <Button
                  onClick={() => {
                    setShowThankYou(false);
                    setFormData({
                      firstName: "",
                      lastName: "",
                      email: "",
                      discordUsername: "",
                      thursdayEvent: "",
                      fridayEvent: "",
                      saturdayEvent: "",
                      fantasyDraftOptIn: false,
                      firstNationals: false,
                      needsAirportTransportation: false,
                      needsHotelTransportation: false,
                      stayingOvernight: false,
                      overnightStayNights: [],
                    });
                    setPhotoFile(null);
                    setPhotoPreview(null);
                  }}
                  variant="outline"
                  className="font-semibold px-8 py-3 rounded-lg shadow-md hover:shadow-lg transition-all duration-200"
                  size="lg"
                >
                  ➕ Register Another Person
                </Button>
              </div>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-lg shadow-sm p-8">
              <form onSubmit={handleSubmit} className="space-y-6">
            {/* Personal Information */}
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">
                Personal Information
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">
                    First Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="firstName"
                    type="text"
                    required
                    value={formData.firstName}
                    onChange={(e) =>
                      setFormData({ ...formData, firstName: e.target.value })
                    }
                    className="w-full"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="lastName">
                    Last Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="lastName"
                    type="text"
                    required
                    value={formData.lastName}
                    onChange={(e) =>
                      setFormData({ ...formData, lastName: e.target.value })
                    }
                    className="w-full"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">
                  Email Address <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                  className="w-full"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="discordUsername">Discord Username</Label>
                <Input
                  id="discordUsername"
                  type="text"
                  value={formData.discordUsername}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      discordUsername: e.target.value,
                    })
                  }
                  placeholder="(optional)"
                  className="w-full"
                />
              </div>
            </div>

            {/* Picture Upload Section */}
            <div className="space-y-4 pt-2">
              <h2 className="text-xl font-semibold">
                Name Tag Picture
              </h2>
              
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Upload a picture to use on your custom name tag (optional). Max 15MB.
                </p>
                <input
                  id="photo"
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoChange}
                  className="block w-full text-sm text-gray-900 dark:text-gray-300 file:ml-2 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-green-50 file:text-green-700 hover:file:bg-green-100 dark:file:bg-green-900/20 dark:file:text-green-400 dark:hover:file:bg-green-900/30 cursor-pointer"
                />
                {photoPreview && (
                  <div className="mt-4 pt-3 border-t border-border">
                    <p className="text-sm font-medium text-muted-foreground mb-3">Preview:</p>
                    <img
                      src={photoPreview}
                      alt="Picture preview"
                      className="w-32 h-32 object-cover rounded-lg border-2 border-border shadow-sm"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Event Selection */}
            <div className="space-y-4 pt-4">
              <h2 className="text-xl font-semibold">
                Event Selection
              </h2>

              {/* Thursday */}
              <div className="space-y-3 p-4 bg-white dark:bg-gray-800 rounded-lg border-2 border-gray-300 dark:border-gray-600">
                <h3 className="font-semibold">
                  Thursday <span className="text-red-500">*</span> <span className="text-sm text-muted-foreground font-normal">({NATIONALS_CONFIG.eventDates.thursday})</span>
                </h3>
                <div className="space-y-2">
                  {NATIONALS_CONFIG.events.thursday.map((event) => (
                    <button
                      key={event.value}
                      type="button"
                      onClick={() =>
                        setFormData({
                          ...formData,
                          thursdayEvent: event.value,
                        })
                      }
                      className={`w-full flex items-start space-x-3 p-3 transition-all ${
                        formData.thursdayEvent === event.value
                          ? 'text-blue-600 dark:text-blue-400'
                          : 'hover:text-blue-500 dark:hover:text-blue-400'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        formData.thursdayEvent === event.value
                          ? 'bg-blue-500 border-blue-600'
                          : 'border-gray-400 dark:border-gray-500'
                      }`}>
                        {formData.thursdayEvent === event.value && (
                          <div className="w-2 h-2 bg-white rounded-full"></div>
                        )}
                      </div>
                      <span className="text-left">
                        {event.label}{event.price ? ` - ${event.price}` : ''}
                        {event.description && (
                          <span className="text-sm text-muted-foreground block">
                            {event.description}
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Friday */}
              <div className="space-y-3 p-4 bg-white dark:bg-gray-800 rounded-lg border-2 border-gray-300 dark:border-gray-600">
                <h3 className="font-semibold">
                  Friday <span className="text-red-500">*</span> <span className="text-sm text-muted-foreground font-normal">({NATIONALS_CONFIG.eventDates.friday})</span>
                </h3>
                <div className="space-y-2">
                  {NATIONALS_CONFIG.events.friday.map((event) => (
                    <button
                      key={event.value}
                      type="button"
                      onClick={() =>
                        setFormData({
                          ...formData,
                          fridayEvent: event.value,
                        })
                      }
                      className={`w-full flex items-start space-x-3 p-3 transition-all ${
                        formData.fridayEvent === event.value
                          ? 'text-blue-600 dark:text-blue-400'
                          : 'hover:text-blue-500 dark:hover:text-blue-400'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        formData.fridayEvent === event.value
                          ? 'bg-blue-500 border-blue-600'
                          : 'border-gray-400 dark:border-gray-500'
                      }`}>
                        {formData.fridayEvent === event.value && (
                          <div className="w-2 h-2 bg-white rounded-full"></div>
                        )}
                      </div>
                      <span className="text-left">
                        {event.label}{event.price ? ` - ${event.price}` : ''}
                        {event.description && (
                          <span className="text-sm text-muted-foreground block">
                            {event.description}
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Saturday */}
              <div className="space-y-3 p-4 bg-white dark:bg-gray-800 rounded-lg border-2 border-gray-300 dark:border-gray-600">
                <h3 className="font-semibold">
                  Saturday <span className="text-red-500">*</span> <span className="text-sm text-muted-foreground font-normal">({NATIONALS_CONFIG.eventDates.saturday})</span>
                </h3>
                <div className="space-y-2">
                  {NATIONALS_CONFIG.events.saturday.map((event) => (
                    <button
                      key={event.value}
                      type="button"
                      onClick={() =>
                        setFormData({
                          ...formData,
                          saturdayEvent: event.value,
                        })
                      }
                      className={`w-full flex items-start space-x-3 p-3 transition-all ${
                        formData.saturdayEvent === event.value
                          ? 'text-blue-600 dark:text-blue-400'
                          : 'hover:text-blue-500 dark:hover:text-blue-400'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        formData.saturdayEvent === event.value
                          ? 'bg-blue-500 border-blue-600'
                          : 'border-gray-400 dark:border-gray-500'
                      }`}>
                        {formData.saturdayEvent === event.value && (
                          <div className="w-2 h-2 bg-white rounded-full"></div>
                        )}
                      </div>
                      <span className="text-left">
                        {event.label}{event.price ? ` - ${event.price}` : ''}
                        {event.description && (
                          <span className="text-sm text-muted-foreground block">
                            {event.description}
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Additional Options */}
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">
                Additional Options
              </h2>

              <div className="space-y-4">
                <div className="flex items-start space-x-3">
                  <button
                    type="button"
                    onClick={() => setFormData({...formData, fantasyDraftOptIn: !formData.fantasyDraftOptIn})}
                    className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 mt-1 ${formData.fantasyDraftOptIn ? 'bg-slate-600 border-slate-700 dark:bg-slate-500 dark:border-slate-600' : 'border-gray-300 dark:border-gray-600'}`}
                  >
                    {formData.fantasyDraftOptIn && (
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <div className="space-y-1" onClick={() => setFormData({...formData, fantasyDraftOptIn: !formData.fantasyDraftOptIn})}>
                    <Label
                      htmlFor="fantasyDraft"
                      className="font-normal cursor-pointer"
                    >
                      Would you like to be a draftable player in the Fantasy
                      Draft?
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      All players who opt in will be entered into a drawing for
                      a box of the new set even if they are not drafted
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  <button
                    type="button"
                    onClick={() => setFormData({...formData, firstNationals: !formData.firstNationals})}
                    className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 ${formData.firstNationals ? 'bg-slate-600 border-slate-700 dark:bg-slate-500 dark:border-slate-600' : 'border-gray-300 dark:border-gray-600'}`}
                  >
                    {formData.firstNationals && (
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <Label
                    htmlFor="firstNationals"
                    className="font-normal cursor-pointer"
                    onClick={() => setFormData({...formData, firstNationals: !formData.firstNationals})}
                  >
                    Is this your first National tournament?
                  </Label>
                </div>

                <div className="flex items-start space-x-3">
                  <button
                    type="button"
                    onClick={() => setFormData({...formData, needsAirportTransportation: !formData.needsAirportTransportation})}
                    className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 mt-1 ${formData.needsAirportTransportation ? 'bg-slate-600 border-slate-700 dark:bg-slate-500 dark:border-slate-600' : 'border-gray-300 dark:border-gray-600'}`}
                  >
                    {formData.needsAirportTransportation && (
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <div className="space-y-1" onClick={() => setFormData({...formData, needsAirportTransportation: !formData.needsAirportTransportation})}>
                    <Label
                      htmlFor="airportTransportation"
                      className="font-normal cursor-pointer"
                    >
                      Will you need transportation to/from{" "}
                      <a
                        href="https://maps.app.goo.gl/JSoAe6ex487NL9pU9"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Bluegrass International Airport
                      </a>
                      ?
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Shuttle times are TBD but will be sent via email when determined
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-3">
                  <button
                    type="button"
                    onClick={() => setFormData({...formData, needsHotelTransportation: !formData.needsHotelTransportation})}
                    className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 mt-1 ${formData.needsHotelTransportation ? 'bg-slate-600 border-slate-700 dark:bg-slate-500 dark:border-slate-600' : 'border-gray-300 dark:border-gray-600'}`}
                  >
                    {formData.needsHotelTransportation && (
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <div className="space-y-1" onClick={() => setFormData({...formData, needsHotelTransportation: !formData.needsHotelTransportation})}>
                    <Label
                      htmlFor="hotelTransportation"
                      className="font-normal cursor-pointer"
                    >
                      Will you need transportation between the official hotel
                      and the venue?
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Shuttle times are TBD but will be sent via email when determined
                    </p>
                  </div>
                </div>

                {/* Overnight Stay Section */}
                <div className="flex items-start space-x-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      const newStayingOvernight = !formData.stayingOvernight;
                      setFormData({
                        ...formData, 
                        stayingOvernight: newStayingOvernight,
                        overnightStayNights: newStayingOvernight ? formData.overnightStayNights : []
                      });
                    }}
                    className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 mt-1 ${formData.stayingOvernight ? 'bg-slate-600 border-slate-700 dark:bg-slate-500 dark:border-slate-600' : 'border-gray-300 dark:border-gray-600'}`}
                  >
                    {formData.stayingOvernight && (
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <div 
                    className="space-y-1 cursor-pointer" 
                    onClick={() => {
                      const newStayingOvernight = !formData.stayingOvernight;
                      setFormData({
                        ...formData, 
                        stayingOvernight: newStayingOvernight,
                        overnightStayNights: newStayingOvernight ? formData.overnightStayNights : []
                      });
                    }}
                  >
                    <Label
                      htmlFor="stayingOvernight"
                      className="font-normal cursor-pointer"
                    >
                      Do you plan to stay overnight at the venue?
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Help us plan for overnight accommodations
                    </p>
                  </div>
                </div>

                {/* Overnight Stay Nights Selection */}
                {formData.stayingOvernight && (
                  <div className="ml-9 mt-3 space-y-2 p-4 bg-white dark:bg-gray-800 rounded-lg border-2 border-gray-200 dark:border-gray-600">
                    <p className="text-sm font-medium text-muted-foreground mb-3">
                      Which nights do you plan to stay?
                    </p>
                    {NATIONALS_CONFIG.overnightStayNights.map((night) => (
                      <div key={night.value} className="flex items-center space-x-3">
                        <button
                          type="button"
                          onClick={() => {
                            const nights = formData.overnightStayNights.includes(night.value)
                              ? formData.overnightStayNights.filter(n => n !== night.value)
                              : [...formData.overnightStayNights, night.value];
                            setFormData({...formData, overnightStayNights: nights});
                          }}
                          className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 ${
                            formData.overnightStayNights.includes(night.value) 
                              ? 'bg-blue-500 border-blue-600' 
                              : 'border-gray-300 dark:border-gray-500'
                          }`}
                        >
                          {formData.overnightStayNights.includes(night.value) && (
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                        <Label
                          className="font-normal cursor-pointer text-sm"
                          onClick={() => {
                            const nights = formData.overnightStayNights.includes(night.value)
                              ? formData.overnightStayNights.filter(n => n !== night.value)
                              : [...formData.overnightStayNights, night.value];
                            setFormData({...formData, overnightStayNights: nights});
                          }}
                        >
                          {night.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Payment Information */}
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">
                Payment Information
              </h2>
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 text-blue-900 dark:text-blue-100 rounded-lg border border-blue-200 dark:border-blue-800">
                <p className="font-medium mb-2">💳 Payment at Venue</p>
                <p className="text-sm">
                  Payment is to be received at the venue (no pre-payment options). Accepted payment methods:
                </p>
                <ul className="text-sm mt-2 ml-4 space-y-1">
                  <li>• Cash</li>
                  <li>• Brian's Venmo</li>
                  <li>• Brian's PayPal</li>
                </ul>
                <p className="text-sm mt-2 text-muted-foreground">
                  Venmo and PayPal details will be provided closer to the event.
                </p>
              </div>
            </div>

            {/* Status Messages */}
            {submitStatus.type && (
              <div
                className={`p-4 rounded-lg ${
                  submitStatus.type === "success"
                    ? "bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800"
                    : "bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800"
                }`}
              >
                {submitStatus.message}
              </div>
            )}

            {/* Submit Button */}
              <div className="pt-4 flex justify-center">
                <Button
                  type="submit"
                  disabled={isSubmitting || isUploadingPhoto}
                  variant="outline"
                  className="border-2 border-blue-500 text-blue-600 hover:bg-blue-50 hover:border-blue-600 dark:border-blue-400 dark:text-blue-400 dark:hover:bg-blue-950"
                  size="lg"
                >
                  {isUploadingPhoto ? "Uploading picture..." : isSubmitting ? "Submitting..." : "Submit Registration"}
                </Button>
              </div>
            </form>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
