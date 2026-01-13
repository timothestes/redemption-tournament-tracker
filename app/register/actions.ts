"use server";

import { createClient } from "../../utils/supabase/server";
import { sendEmail, getRegistrationConfirmationEmail } from "../../utils/email";
import { NATIONALS_CONFIG } from "../config/nationals";

export interface RegistrationData {
  firstName: string;
  lastName: string;
  email: string;
  discordUsername?: string;
  thursdayEvent: string;
  fridayEvent: string;
  saturdayEvent: string;
  fantasyDraftOptIn: boolean;
  firstNationals: boolean;
  needsAirportTransportation: boolean;
  needsHotelTransportation: boolean;
}

export async function submitRegistration(data: RegistrationData, photoUrl: string | null = null) {
  const supabase = await createClient();

  const { error } = await supabase.from("registrations").insert({
    first_name: data.firstName,
    last_name: data.lastName,
    email: data.email,
    discord_username: data.discordUsername || null,
    thursday_event: data.thursdayEvent,
    friday_event: data.fridayEvent,
    saturday_event: data.saturdayEvent,
    fantasy_draft_opt_in: data.fantasyDraftOptIn,
    first_nationals: data.firstNationals,
    needs_airport_transportation: data.needsAirportTransportation,
    needs_hotel_transportation: data.needsHotelTransportation,
    photo_url: photoUrl,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  // Send confirmation email
  const emailHtml = getRegistrationConfirmationEmail(
    data.firstName,
    data.lastName,
    data.thursdayEvent,
    data.fridayEvent,
    data.saturdayEvent
  );

  await sendEmail({
    to: data.email,
    subject: NATIONALS_CONFIG.emailSubject,
    html: emailHtml,
  });

  return { success: true };
}
