"use server";

import { createClient } from "../../../utils/supabase/server";
import { sendEmail } from "../../../utils/email";
import { redirect } from "next/navigation";
import { isRegistrationAdmin, requireRegistrationAdmin } from "../../../utils/adminUtils";

export async function checkAdminAccess() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isAdmin = await isRegistrationAdmin();

  if (!user || !isAdmin) {
    return { isAdmin: false, user: null };
  }

  return { isAdmin: true, user };
}

export async function getRegistrations() {
  const { isAdmin } = await checkAdminAccess();
  
  if (!isAdmin) {
    redirect("/");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("registrations")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching registrations:", error);
    return { registrations: [], error: error.message };
  }

  return { registrations: data || [], error: null };
}

export async function deleteRegistration(id: string) {
  const { isAdmin } = await checkAdminAccess();
  
  if (!isAdmin) {
    return { success: false, error: "Unauthorized" };
  }

  const supabase = await createClient();
  
  // Get the registration to check for photo
  const { data: registration } = await supabase
    .from("registrations")
    .select("photo_url")
    .eq("id", id)
    .single();

  // Delete photo from storage if it exists
  if (registration?.photo_url) {
    try {
      const urlParts = registration.photo_url.split('/');
      const fileName = urlParts[urlParts.length - 1];
      await supabase.storage.from('avatars').remove([fileName]);
    } catch (error) {
      console.error('Error deleting photo from storage:', error);
      // Continue with registration deletion even if photo deletion fails
    }
  }

  // Delete the registration record
  const { error } = await supabase
    .from("registrations")
    .delete()
    .eq("id", id);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function updateRegistration(id: string, data: {
  first_name?: string;
  last_name?: string;
  email?: string;
  discord_username?: string;
  thursday_event?: string;
  friday_event?: string;
  saturday_event?: string;
  fantasy_draft_opt_in?: boolean;
  first_nationals?: boolean;
  needs_airport_transportation?: boolean;
  needs_hotel_transportation?: boolean;
  photo_url?: string | null;
  paid?: boolean;
}) {
  const { isAdmin } = await checkAdminAccess();
  
  if (!isAdmin) {
    return { success: false, error: "Unauthorized" };
  }

  const supabase = await createClient();
  
  // Only update fields that are provided
  const updateData: any = {};
  if (data.first_name !== undefined) updateData.first_name = data.first_name;
  if (data.last_name !== undefined) updateData.last_name = data.last_name;
  if (data.email !== undefined) updateData.email = data.email;
  if (data.discord_username !== undefined) updateData.discord_username = data.discord_username || null;
  if (data.thursday_event !== undefined) updateData.thursday_event = data.thursday_event;
  if (data.friday_event !== undefined) updateData.friday_event = data.friday_event;
  if (data.saturday_event !== undefined) updateData.saturday_event = data.saturday_event;
  if (data.fantasy_draft_opt_in !== undefined) updateData.fantasy_draft_opt_in = data.fantasy_draft_opt_in;
  if (data.first_nationals !== undefined) updateData.first_nationals = data.first_nationals;
  if (data.needs_airport_transportation !== undefined) updateData.needs_airport_transportation = data.needs_airport_transportation;
  if (data.needs_hotel_transportation !== undefined) updateData.needs_hotel_transportation = data.needs_hotel_transportation;
  if (data.photo_url !== undefined) updateData.photo_url = data.photo_url;
  if (data.paid !== undefined) updateData.paid = data.paid;
  
  const { error } = await supabase
    .from("registrations")
    .update(updateData)
    .eq("id", id);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function sendBulkEmail(
  recipientIds: string[],
  subject: string,
  htmlContent: string
) {
  const { isAdmin } = await checkAdminAccess();
  
  if (!isAdmin) {
    return { success: false, error: "Unauthorized", sentCount: 0, failedCount: 0 };
  }

  const supabase = await createClient();
  
  // Get email addresses for selected recipients
  const { data: recipients, error } = await supabase
    .from("registrations")
    .select("email, first_name, last_name")
    .in("id", recipientIds);

  if (error || !recipients) {
    return { success: false, error: error?.message || "Failed to fetch recipients", sentCount: 0, failedCount: 0 };
  }

  let sentCount = 0;
  let failedCount = 0;

  // Send emails
  for (const recipient of recipients) {
    // Personalize the email with recipient name
    const personalizedHtml = htmlContent
      .replace(/\{firstName\}/g, recipient.first_name)
      .replace(/\{lastName\}/g, recipient.last_name)
      .replace(/\{fullName\}/g, `${recipient.first_name} ${recipient.last_name}`);

    const result = await sendEmail({
      to: recipient.email,
      subject,
      html: personalizedHtml,
    });

    if (result.success) {
      sentCount++;
    } else {
      failedCount++;
    }
  }

  return { 
    success: failedCount === 0, 
    sentCount, 
    failedCount,
    message: `Sent ${sentCount} email(s). ${failedCount > 0 ? `Failed: ${failedCount}` : ""}`
  };
}

export async function createTournamentFromRegistrations(
  registrationIds: string[],
  tournamentName: string
) {
  const { isAdmin, user } = await checkAdminAccess();
  
  if (!isAdmin || !user) {
    return { success: false, error: "Unauthorized" };
  }

  const supabase = await createClient();

  try {
    // 1. Create the tournament
    const { data: tournament, error: tournamentError } = await supabase
      .from("tournaments")
      .insert([
        {
          name: tournamentName,
          host_id: user.id,
        },
      ])
      .select()
      .single();

    if (tournamentError || !tournament) {
      return { success: false, error: tournamentError?.message || "Failed to create tournament" };
    }

    // 2. Fetch the selected registrations
    const { data: registrations, error: regError } = await supabase
      .from("registrations")
      .select("first_name, last_name")
      .in("id", registrationIds);

    if (regError || !registrations) {
      return { success: false, error: regError?.message || "Failed to fetch registrations" };
    }

    // 3. Create participants from registrations
    const participants = registrations.map((reg) => ({
      tournament_id: tournament.id,
      name: `${reg.first_name} ${reg.last_name}`,
    }));

    const { error: participantsError } = await supabase
      .from("participants")
      .insert(participants);

    if (participantsError) {
      return { success: false, error: participantsError.message };
    }

    return { success: true, tournamentId: tournament.id };
  } catch (error: any) {
    return { success: false, error: error.message || "An unexpected error occurred" };
  }
}
