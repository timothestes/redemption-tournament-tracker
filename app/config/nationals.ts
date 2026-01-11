// Nationals Tournament Configuration
// Update these values for each year's tournament

interface EventOption {
  value: string;
  label: string;
  price: string | null;
  description?: string;
}

interface NationalsConfig {
  year: number;
  displayName: string;
  dates: string;
  datesShort: string;
  adminOnly: boolean;
  emailSubject: string;
  events: {
    thursday: EventOption[];
    friday: EventOption[];
    saturday: EventOption[];
  };
}

export const NATIONALS_CONFIG: NationalsConfig = {
  // Tournament year
  year: 2026,
  
  // Display name for navigation and headings
  displayName: "Nationals 2026",
  
  // Tournament dates
  dates: "July 23-25, 2026",
  datesShort: "July 23-25",
  
  // Access control - set to true to make registration admin-only
  adminOnly: false,
  
  // Email subject line
  emailSubject: "Registration Confirmed - Nationals 2026",
  
  // Event configurations by day
  events: {
    thursday: [
      {
        value: "booster_draft",
        label: "Booster Draft (GoC x3, II x2, T2C x2)",
        price: "$35"
      },
      {
        value: "type2_2player",
        label: "Type 2 2-Player",
        price: "TBD"
      },
      {
        value: "none",
        label: "None",
        price: null
      },
    ],
    friday: [
      {
        value: "type1_2player",
        label: "Type 1 2-Player",
        price: "TBD"
      },
      {
        value: "typeA_2player",
        label: "Type A 2-Player",
        price: "TBD",
        description: "for players under 13 years old"
      },
      {
        value: "none",
        label: "None",
        price: null
      },
    ],
    saturday: [
      {
        value: "teams",
        label: "Teams",
        price: "TBD"
      },
      {
        value: "sealed_deck",
        label: "Sealed Deck (K/L, IR, II, T2C)",
        price: "$25"
      },
      {
        value: "none",
        label: "None",
        price: null
      },
    ],
  },
};
