"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { FaTrophy } from "react-icons/fa6";
import {
  HiCalendar,
  HiLocationMarker,
  HiClock,
  HiUser,
  HiViewList,
  HiChevronLeft,
  HiChevronRight,
} from "react-icons/hi";
import { TournamentListing } from "./actions";

// ─── Date helpers ────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00");
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatDateRange(start: string, end: string | null): string {
  if (!end || end === start) return formatDate(start);
  const s = new Date(start + "T12:00:00");
  const e = new Date(end + "T12:00:00");
  if (s.getMonth() === e.getMonth()) {
    return `${s.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}\u2013${e.getDate()}`;
  }
  return `${formatDate(start)} \u2013 ${formatDate(end)}`;
}

function getMonthKey(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00");
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function getDaysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T12:00:00");
  return Math.ceil(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
}

function toDateKey(dateStr: string): string {
  return dateStr; // already YYYY-MM-DD
}

function getTypeBadgeClasses(type: string | null): string {
  const t = (type || "").toLowerCase();
  if (t.includes("regional") || t.includes("national")) {
    return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  }
  if (t.includes("state")) {
    return "bg-primary/10 text-primary";
  }
  if (t.includes("district")) {
    return "bg-blue-500/15 text-blue-700 dark:text-blue-400";
  }
  return "bg-muted text-muted-foreground";
}

function getTypeDotColor(type: string | null): string {
  const t = (type || "").toLowerCase();
  if (t.includes("regional") || t.includes("national")) {
    return "bg-amber-500";
  }
  if (t.includes("state")) {
    return "bg-primary";
  }
  if (t.includes("district")) {
    return "bg-blue-500";
  }
  return "bg-muted-foreground/50";
}

// ─── Grouping helpers ────────────────────────────────────────

interface ListingsByMonth {
  month: string;
  listings: TournamentListing[];
}

function groupByMonth(listings: TournamentListing[]): ListingsByMonth[] {
  const groups: Map<string, TournamentListing[]> = new Map();
  for (const l of listings) {
    const key = getMonthKey(l.start_date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(l);
  }
  return Array.from(groups.entries()).map(([month, listings]) => ({
    month,
    listings,
  }));
}

function groupByDate(
  listings: TournamentListing[]
): Map<string, TournamentListing[]> {
  const map = new Map<string, TournamentListing[]>();
  for (const l of listings) {
    const key = toDateKey(l.start_date);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(l);
  }
  return map;
}

function getUniqueStates(listings: TournamentListing[]): string[] {
  const states = new Set(listings.map((l) => l.state));
  return Array.from(states).sort();
}

// ─── Calendar grid helpers ───────────────────────────────────

function getCalendarDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay(); // 0=Sun
  const totalDays = lastDay.getDate();

  const days: (number | null)[] = [];
  for (let i = 0; i < startOffset; i++) days.push(null);
  for (let d = 1; d <= totalDays; d++) days.push(d);
  // Pad to complete the last row
  while (days.length % 7 !== 0) days.push(null);
  return days;
}

function dateToKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ─── Listing Card (shared between views) ─────────────────────

function ListingCard({
  listing,
  isExpanded,
  onToggle,
}: {
  listing: TournamentListing;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const daysUntil = getDaysUntil(listing.start_date);
  const isImminent = daysUntil >= 0 && daysUntil <= 3;

  return (
    <div
      className={`group border rounded-lg transition-colors
        ${isImminent ? "border-primary/30 bg-card/90 backdrop-blur-sm" : "border-border bg-card/80 backdrop-blur-sm hover:bg-card/90"}`}
    >
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 flex items-start gap-3"
      >
        <div className="flex-shrink-0 w-20 pt-0.5">
          <div className="text-sm font-semibold text-foreground leading-tight">
            {formatDateRange(listing.start_date, listing.end_date)}
          </div>
          {isImminent && daysUntil >= 0 && (
            <div className="text-[10px] font-medium text-primary mt-0.5">
              {daysUntil === 0
                ? "Today"
                : daysUntil === 1
                  ? "Tomorrow"
                  : `In ${daysUntil} days`}
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground truncate">
              {listing.city}, {listing.state}
            </span>
            {listing.tournament_type && (
              <span
                className={`inline-flex px-1.5 py-0.5 text-[10px] font-semibold rounded uppercase tracking-wide ${getTypeBadgeClasses(listing.tournament_type)}`}
              >
                {listing.tournament_type}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            {listing.formats.length > 0 && (
              <span>
                {listing.formats
                  .map((f) => f.format.split(" - ")[0])
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .join(", ")}
              </span>
            )}
          </div>
        </div>

        <svg
          className={`w-4 h-4 text-muted-foreground/50 flex-shrink-0 mt-1 transition-transform ${isExpanded ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 pt-1 border-t border-border/50">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            {(listing.venue_name || listing.venue_address) && (
              <div className="flex items-start gap-2">
                <HiLocationMarker className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div>
                  {listing.venue_name && (
                    <div className="font-medium text-foreground">
                      {listing.venue_name}
                    </div>
                  )}
                  {listing.venue_address && (
                    <div className="text-muted-foreground text-xs">
                      {listing.venue_address}
                    </div>
                  )}
                </div>
              </div>
            )}

            {listing.start_time && (
              <div className="flex items-center gap-2">
                <HiClock className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="text-muted-foreground">
                  {listing.start_time}
                </span>
              </div>
            )}

            {listing.host_name && (
              <div className="flex items-center gap-2">
                <HiUser className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="text-muted-foreground">
                  {listing.host_name}
                </span>
              </div>
            )}

            {listing.door_fee && (
              <div className="flex items-center gap-2">
                <FaTrophy className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="text-muted-foreground">
                  Door fee: {listing.door_fee}
                </span>
              </div>
            )}
          </div>

          {listing.formats.length > 0 && (
            <div className="mt-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Formats
              </h4>
              <div className="space-y-1">
                {listing.formats.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-sm py-1 px-2 rounded bg-muted/50"
                  >
                    <span className="text-foreground">{f.format}</span>
                    <span
                      className={`text-xs font-medium ${f.entry_fee === "free" || !f.entry_fee ? "text-primary" : "text-muted-foreground"}`}
                    >
                      {f.entry_fee || "Free"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {listing.description && (
            <p className="mt-3 text-xs text-muted-foreground">
              {listing.description}
            </p>
          )}

          <div className="mt-4 flex items-center gap-3">
            <Link
              href={`/tracker/tournaments?from_listing=${listing.id}&name=${encodeURIComponent(`${listing.city} ${listing.tournament_type || ""} ${listing.start_date.slice(5)}`.trim())}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <FaTrophy className="w-3 h-3" />
              Host This Event
            </Link>
            {listing.linked_tournament_id && (
              <span className="text-xs text-primary font-medium">
                Already linked to a tournament
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Calendar View ───────────────────────────────────────────

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function CalendarView({
  listings,
  expandedId,
  setExpandedId,
}: {
  listings: TournamentListing[];
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
}) {
  const byDate = useMemo(() => groupByDate(listings), [listings]);

  // Determine initial month from first listing or today
  const initialDate = listings.length > 0
    ? new Date(listings[0].start_date + "T12:00:00")
    : new Date();

  const [viewYear, setViewYear] = useState(initialDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialDate.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const days = getCalendarDays(viewYear, viewMonth);
  const today = new Date();
  const todayKey =
    today.getFullYear() === viewYear && today.getMonth() === viewMonth
      ? today.getDate()
      : null;

  const monthLabel = new Date(viewYear, viewMonth).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  // Determine which months have events for nav bounds
  const lastListing = listings[listings.length - 1];
  const lastDate = lastListing
    ? new Date(lastListing.start_date + "T12:00:00")
    : today;

  const canGoNext =
    viewYear < lastDate.getFullYear() ||
    (viewYear === lastDate.getFullYear() && viewMonth < lastDate.getMonth());

  const firstListing = listings[0];
  const firstDate = firstListing
    ? new Date(firstListing.start_date + "T12:00:00")
    : today;

  const canGoPrev =
    viewYear > firstDate.getFullYear() ||
    (viewYear === firstDate.getFullYear() && viewMonth > firstDate.getMonth());

  const goNext = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
    setSelectedDate(null);
  };

  const goPrev = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
    setSelectedDate(null);
  };

  const selectedListings = selectedDate ? byDate.get(selectedDate) || [] : [];

  return (
    <div>
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={goPrev}
          disabled={!canGoPrev}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <HiChevronLeft className="w-5 h-5" />
        </button>
        <h2 className="text-sm font-semibold text-foreground">{monthLabel}</h2>
        <button
          onClick={goNext}
          disabled={!canGoNext}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <HiChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="text-center text-[10px] font-medium text-muted-foreground uppercase tracking-wider py-1"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 border-t border-l border-border">
        {days.map((day, i) => {
          if (day === null) {
            return (
              <div
                key={`empty-${i}`}
                className="border-r border-b border-border bg-muted/20"
              />
            );
          }

          const key = dateToKey(viewYear, viewMonth, day);
          const events = byDate.get(key);
          const hasEvents = !!events && events.length > 0;
          const isToday = day === todayKey;
          const isSelected = selectedDate === key;
          const isPast =
            new Date(viewYear, viewMonth, day) <
            new Date(today.getFullYear(), today.getMonth(), today.getDate());

          return (
            <button
              key={key}
              onClick={() => {
                if (hasEvents) {
                  setSelectedDate(isSelected ? null : key);
                  setExpandedId(null);
                }
              }}
              disabled={!hasEvents}
              className={`
                relative border-r border-b border-border
                min-h-[3rem] sm:min-h-[3.5rem] p-1
                flex flex-col items-center justify-start
                transition-colors
                ${hasEvents ? "cursor-pointer" : "cursor-default"}
                ${isSelected ? "bg-primary/10" : hasEvents ? "hover:bg-muted/50" : ""}
                ${isPast && !hasEvents ? "opacity-40" : ""}
              `}
            >
              <span
                className={`
                  text-xs tabular-nums leading-none mt-1
                  ${isToday ? "font-bold text-primary" : hasEvents ? "font-medium text-foreground" : "text-muted-foreground"}
                `}
              >
                {day}
              </span>

              {/* Event dots */}
              {hasEvents && (
                <div className="flex items-center gap-0.5 mt-1.5 flex-wrap justify-center">
                  {events.slice(0, 3).map((e, j) => (
                    <span
                      key={j}
                      className={`w-1.5 h-1.5 rounded-full ${getTypeDotColor(e.tournament_type)}`}
                    />
                  ))}
                  {events.length > 3 && (
                    <span className="text-[8px] text-muted-foreground ml-0.5">
                      +{events.length - 3}
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          State
        </div>
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
          District
        </div>
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          Regional
        </div>
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
          Local
        </div>
      </div>

      {/* Selected day listings */}
      {selectedDate && selectedListings.length > 0 && (
        <div className="mt-4 space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {formatDate(selectedDate)}
          </h3>
          {selectedListings.map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              isExpanded={expandedId === listing.id}
              onToggle={() =>
                setExpandedId(expandedId === listing.id ? null : listing.id)
              }
            />
          ))}
        </div>
      )}

      {selectedDate && selectedListings.length === 0 && (
        <div className="mt-4 py-6 text-center text-sm text-muted-foreground">
          No events on this date.
        </div>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────

export default function TournamentsClient({
  listings,
}: {
  listings: TournamentListing[];
}) {
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "calendar">("list");

  const states = getUniqueStates(listings);

  const filtered =
    stateFilter === "all"
      ? listings
      : listings.filter((l) => l.state === stateFilter);

  const grouped = groupByMonth(filtered);

  return (
    <main className="max-w-3xl mx-auto px-4 pt-8 pb-16">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Upcoming Tournaments
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {filtered.length} event{filtered.length !== 1 ? "s" : ""} scheduled
            {stateFilter !== "all" ? ` in ${stateFilter}` : ""}
          </p>
        </div>

        {/* View toggle */}
        <div className="flex items-center bg-muted rounded-md p-0.5">
          <button
            onClick={() => setView("list")}
            className={`p-1.5 rounded transition-colors ${
              view === "list"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            aria-label="List view"
          >
            <HiViewList className="w-4 h-4" />
          </button>
          <button
            onClick={() => setView("calendar")}
            className={`p-1.5 rounded transition-colors ${
              view === "calendar"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            aria-label="Calendar view"
          >
            <HiCalendar className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* State filter */}
      {states.length > 1 && (
        <div className="mb-6 flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
          <button
            onClick={() => setStateFilter("all")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors
              ${stateFilter === "all" ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`}
          >
            All states
          </button>
          {states.map((s) => (
            <button
              key={s}
              onClick={() => setStateFilter(s === stateFilter ? "all" : s)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors
                ${stateFilter === s ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Calendar View */}
      {view === "calendar" && (
        <CalendarView
          listings={filtered}
          expandedId={expandedId}
          setExpandedId={setExpandedId}
        />
      )}

      {/* List View */}
      {view === "list" && (
        <>
          {grouped.length === 0 ? (
            <div className="py-16 text-center">
              <HiCalendar className="w-8 h-8 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">
                No upcoming tournaments
                {stateFilter !== "all" ? ` in ${stateFilter}` : ""}.
              </p>
              {stateFilter !== "all" && (
                <button
                  onClick={() => setStateFilter("all")}
                  className="mt-2 text-sm text-primary hover:underline"
                >
                  Show all states
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-8">
              {grouped.map(({ month, listings: monthListings }) => (
                <section key={month}>
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 sticky top-16 bg-card/90 backdrop-blur-sm py-2 z-10 border-b border-border">
                    {month}
                  </h2>
                  <div className="space-y-2">
                    {monthListings.map((listing) => (
                      <ListingCard
                        key={listing.id}
                        listing={listing}
                        isExpanded={expandedId === listing.id}
                        onToggle={() =>
                          setExpandedId(
                            expandedId === listing.id ? null : listing.id
                          )
                        }
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {/* Source attribution */}
      <div className="mt-12 pt-6 border-t border-border text-center">
        <p className="text-xs text-muted-foreground">
          Tournament data sourced from{" "}
          <a
            href="https://www.cactusgamedesign.com/redemption/tournaments/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Cactus Game Design
          </a>
          . Updated daily.
        </p>
      </div>
    </main>
  );
}
