// Nationals Tournament Configuration
// Update these values for each year's tournament

interface EventOption {
  value: string;
  label: string;
  price: string | null;
  description?: string;
}

interface OvernightStayNight {
  value: string;
  label: string;
}

interface NationalsConfig {
  year: number;
  displayName: string;
  dates: string;
  datesShort: string;
  adminOnly: boolean;
  emailSubject: string;
  eventDates: {
    thursday: string;
    friday: string;
    saturday: string;
  };
  events: {
    thursday: EventOption[];
    friday: EventOption[];
    saturday: EventOption[];
  };
  overnightStayNights: OvernightStayNight[];
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
  
  // Event dates
  eventDates: {
    thursday: "July 23",
    friday: "July 24",
    saturday: "July 25",
  },

  // Overnight stay options
  overnightStayNights: [
    { value: "wednesday", label: "Wednesday Night (July 22)" },
    { value: "thursday", label: "Thursday Night (July 23)" },
    { value: "friday", label: "Friday Night (July 24)" },
    { value: "saturday", label: "Saturday Night (July 25)" },
  ],
  
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
        price: "$10"
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
        price: "$10"
      },
      {
        value: "typeA_2player",
        label: "Type A 2-Player",
        price: "$10",
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
        price: "$10"
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
